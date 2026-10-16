"""The population loop. One generation:

  breed     refill the population: children start from the hive adapter or a top survivor,
            with mutated genes (learning rate, rank, data mix, temperature, hard-task share),
            and get a short train on the pool (SFT on winners + early references, DPO on pairs)
  answer    every member answers its train tasks (k samples at its temperature)
  verify    KataGo truth check of every answer (required; verify.ts)
  judge     Gemini scores a small sample of passing answers (optional, capped); the ChatGPT
            tone reviewer scores a few more for tone (optional, capped, tone.py)
  pool      good answers and (better, worse) pairs from ANY member go into the shared pool;
            task pass rates feed hard-task mining
  eval      new members answer the fixed held-out eval subset (greedy); fitness = truth gate
            first, then coverage, depth, and judge
  select    best member becomes champion only if it beats the old one (no regressions);
            the bottom half is folded into the hive adapter (fitness-weighted) and deleted,
            its pool rows stay
  selfplay  question-maker writes new why-not questions on the hardest positions; the
            factory turns them into tasks when Node is there
  log       log.jsonl + chart.txt, disk pruning, pool sync

Every phase saves state.json, so a run killed at any point resumes where it stopped.
"""
from __future__ import annotations

import math
import random
import time
from pathlib import Path

import selfplay
from config import GENES, default_genes
from merge import fold, hive_weights
from pool import Pool, answer_quality, rows_for_task
from tone import ToneJudge
from truth import VerifyError, make_tasks, node_status, untag_member, verify
from util import (append_jsonl, copy_dir, dir_size, log, read_json, read_jsonl, remove, text_key, write_json,
                  write_jsonl)

STATE_VERSION = 1
PHASES = ['breed', 'answer', 'verify', 'judge', 'pool', 'eval', 'select', 'selfplay', 'log']
HIVE_DECAY = 0.9          # older folds fade a little each time a new member is folded in
HIVE_RANK = 32
MAX_ROWS = 2000


class Stop(Exception):
    pass


# ---------------------------------------------------------------- genes ----

def mutate(genes: dict, rng: random.Random, n: int | None = None) -> tuple[dict, list[str]]:
    """Change one or two genes, always staying inside each gene's range."""
    out = dict(default_genes())
    out.update(genes or {})
    names = sorted(GENES)
    changed = rng.sample(names, n if n is not None else rng.choice([1, 1, 2]))
    for k in changed:
        low, high, how, _d = GENES[k]
        if how == 'log':
            out[k] = float(min(high, max(low, out[k] * math.exp(rng.gauss(0, 0.5)))))
        elif how == 'lin':
            out[k] = float(min(high, max(low, out[k] + rng.gauss(0, 0.15 * (high - low)))))
        else:
            choices = list(low)
            i = choices.index(out[k]) if out[k] in choices else len(choices) // 2
            out[k] = choices[min(len(choices) - 1, max(0, i + rng.choice([-1, 1])))]
    return out, changed


# -------------------------------------------------------------- fitness ----

def eval_fitness(scores: list[dict | None], judged: list[float]) -> dict:
    """Fitness record from one member's eval scores (None = unchecked, counts as a fail)."""
    n = len(scores)
    ok = [s for s in scores if s]
    passed = [s for s in ok if s.get('pass') and s.get('truth', 0) >= 1]
    q = [answer_quality(s) if s else 0.0 for s in scores]
    return {
        'n': n, 'pass': len(passed),
        'truthRate': round(len(passed) / n, 4) if n else 0.0,
        'truth': round(sum(s.get('truth', 0) for s in ok) / n, 4) if n else 0.0,
        'coverage': round(sum(s.get('coverage', 0) for s in passed) / n, 4) if n else 0.0,
        'depth': round(sum(s.get('depth', 0) for s in passed) / n, 4) if n else 0.0,
        'quality': round(sum(q) / n, 4) if n else 0.0,
        'judge': round(sum(judged) / len(judged), 4) if judged else None,
    }


def quality_of(fit: dict, use_judge: bool) -> float:
    if use_judge and fit.get('judge') is not None:
        return 0.8 * fit['quality'] + 0.2 * fit['judge']
    return fit['quality']


def rank_key(fit: dict | None, use_judge: bool, gate: float) -> tuple:
    """Truth gate first: members that pass it rank above all that don't, by quality; the rest by truth rate."""
    if not fit:
        return (-1, 0.0)
    if fit['truthRate'] >= gate:
        return (1, round(quality_of(fit, use_judge), 6))
    return (0, fit['truthRate'])


def fitness_scalar(fit: dict | None, use_judge: bool, gate: float) -> float:
    k = rank_key(fit, use_judge, gate)
    return max(0.0, k[0] + k[1])


def beats(cand: dict, champ: dict | None, use_judge: bool, gate: float) -> bool:
    """A new champion must rank higher and must not check worse on truth (no regressions)."""
    if not champ:
        return True
    return rank_key(cand, use_judge, gate) > rank_key(champ, use_judge, gate) and cand['truthRate'] >= champ['truthRate']


def rank_members(members: dict, use_judge: bool, gate: float) -> list[str]:
    return sorted(members, key=lambda m: (rank_key(members[m].get('fit'), use_judge, gate), members[m].get('born', 0), m),
                  reverse=True)


# -------------------------------------------------------------- backend ----

class HFBackend:
    """The real thing: transformers + peft + trl on the GPU (generate.py, train.py)."""

    def __init__(self, cfg):
        from generate import Base
        self.cfg = cfg
        self.base = Base(cfg)

    def answer(self, adapter_dir, member, tasks, k, temperature, greedy, done, on_rows, deadline=None):
        from generate import answer
        return answer(self.base, adapter_dir, member, tasks, k, temperature, greedy, done, on_rows, deadline)

    def train(self, init_dir, out_dir, genes, sft_rows, dpo_rows, sft_steps, dpo_steps, deadline=None):
        from train import train_member
        return train_member(self.base, init_dir, out_dir, genes, sft_rows, dpo_rows, sft_steps, dpo_steps, self.cfg, deadline)

    def close(self):
        self.base.free()


# ------------------------------------------------------------ evolution ----

class Evolution:
    def __init__(self, cfg, backend, judge, name: str = 'pc', clock=time.time, on_generation=None, tone=None):
        self.cfg, self.backend, self.judge, self.name = cfg, backend, judge, name
        self.tone = tone if tone is not None else ToneJudge(cfg)    # off (does nothing) without OPENAI_API_KEY
        self.clock = clock
        self.on_generation = on_generation
        self.deadline: float | None = None
        self.state_path = cfg.path('state.json')
        self.state = read_json(self.state_path) or self._new_state()
        if self.state.get('base') != cfg.base_id:
            raise SystemExit(f'This data folder trained {self.state.get("base")}, not {cfg.base_id}. '
                             f'Use another --data-dir or set the base model back.')
        self.load_tasks()
        self.state['promptVersionTrained'] = self.prompt_version

    # ---- state ----
    def _new_state(self) -> dict:
        return {'version': STATE_VERSION, 'base': self.cfg.base_id, 'generation': 1, 'phase': 'breed',
                'members': {}, 'nextId': 1, 'champion': None, 'hive': None, 'taskStats': {}, 'asked': [],
                'plan': None, 'breed': None, 'last': {}}

    def save(self) -> None:
        write_json(self.state_path, self.state)

    def gen_dir(self, g: int | None = None) -> Path:
        return self.cfg.path('gens', f'g{(g or self.state["generation"]):04d}')

    def member_dir(self, mid: str) -> Path:
        return self.cfg.path('members', mid)

    def pool_member(self, mid: str) -> str:
        return f'{self.name}/{mid}'

    def check_time(self) -> None:
        if self.deadline and self.clock() > self.deadline:
            raise Stop('time limit reached')

    # ---- tasks ----
    def load_tasks(self) -> None:
        cfg = self.cfg
        evals = list(read_jsonl(cfg.path('tasks', 'eval.jsonl.gz')))
        self.eval_all = {t['id']: t for t in evals}
        train = [t for t in read_jsonl(cfg.path('tasks', 'tasks.jsonl.gz'))]
        # Never train on the eval set: drop anything marked eval or sharing an eval id.
        self.pool = Pool(cfg.path('pool.jsonl.gz'), eval_ids=self.eval_all.keys())
        train += list(self.pool.tasks().values())
        train = [t for t in train if t.get('split', 'train') != 'eval' and t['id'] not in self.eval_all]
        versions = [t.get('promptVersion', 0) for t in train]
        self.prompt_version = max(versions) if versions else 0
        self.tasks = {t['id']: t for t in train if t.get('promptVersion', 0) == self.prompt_version}
        ev = sorted((t for t in evals if t.get('promptVersion', 0) == self.prompt_version), key=lambda t: text_key(t['id']))
        self.eval_tasks = ev[: cfg.eval_tasks]
        self.eval_key = text_key(*(t['id'] for t in self.eval_tasks), self.prompt_version)
        self.judged_eval = [t['id'] for t in self.eval_tasks[: cfg.judged_eval_tasks]]

    def eval_file(self) -> Path:
        p = self.cfg.path('tasks', f'eval-{self.eval_key}.jsonl')
        if not p.exists():
            write_jsonl(p, self.eval_tasks)
        return p

    def rng(self, *salt) -> random.Random:
        return random.Random(text_key(str(self.cfg.seed), self.name, str(self.state['generation']), *map(str, salt)))

    # ---- the loop ----
    def run(self, deadline: float | None = None, max_generations: int | None = None) -> str:
        self.deadline = deadline
        if not self.tasks:
            return 'no training tasks yet (tasks.jsonl.gz is missing or empty)'
        if not self.eval_tasks:
            return 'no eval tasks (eval.jsonl.gz is missing or empty); refusing to train without a held-out test'
        done = 0
        try:
            while max_generations is None or done < max_generations:
                self.check_time()
                g = self.state['generation']
                while self.state['phase'] != 'next':
                    self.check_time()
                    getattr(self, 'phase_' + self.state['phase'])(g)
                self.state['generation'] = g + 1
                self.state['phase'] = 'breed'
                self.save()
                done += 1
            return f'finished {done} generation(s)'
        except Stop as e:
            self.save()
            return str(e)

    def _advance(self, phase: str) -> None:
        i = PHASES.index(phase)
        self.state['phase'] = PHASES[i + 1] if i + 1 < len(PHASES) else 'next'
        self.save()

    # ---- breed ----
    def phase_breed(self, g: int) -> None:
        st = self.state
        if st['breed'] is None:
            st['breed'] = self._plan_children(g)
            self.save()
        for child in st['breed']:
            if child['id'] in st['members']:
                continue
            self.check_time()
            self._make_child(child, g)
        st['breed'] = None
        self._advance('breed')

    def _plan_children(self, g: int) -> list[dict]:
        st, cfg = self.state, self.cfg
        rng = self.rng('breed')
        need = cfg.population - len(st['members'])
        use_judge = self._use_judge()
        survivors = rank_members(st['members'], use_judge, cfg.truth_gate)
        center = (st['champion'] or {}).get('genes') or default_genes()
        plans = []
        for i in range(max(0, need)):
            mid = f'm{st["nextId"]:04d}'
            st['nextId'] += 1
            if st['hive'] and (i == 0 or rng.random() < cfg.hive_child_share or not survivors):
                parent, genes = 'hive', mutate(center, rng)[0]
            elif survivors:
                weights = [len(survivors) - r for r in range(len(survivors))]
                parent = rng.choices(survivors, weights=weights)[0]
                genes = mutate(st['members'][parent]['genes'], rng)[0]
            elif st['champion']:
                parent, genes = 'champion', mutate(center, rng)[0]
            else:
                parent = None
                genes = default_genes() if i == 0 else mutate(default_genes(), rng)[0]
            plans.append({'id': mid, 'parent': parent, 'genes': genes})
        return plans

    def _parent_dir(self, parent: str | None) -> Path | None:
        if parent is None:
            return None
        if parent in ('hive', 'champion'):
            d = self.cfg.path(parent)
        else:
            d = self.member_dir(parent)
        return d if (d / 'adapter_config.json').exists() else None

    def _make_child(self, child: dict, g: int) -> None:
        cfg = self.cfg
        genes = child['genes']
        src = self._parent_dir(child['parent'])
        init = None
        if src is not None:
            init = cfg.path('tmp', f'init-{child["id"]}')
            remove(init)
            fold([src], [1.0], int(genes['rank']), init)   # same delta, re-cut to the child's rank
        sft_rows, dpo_rows = self.training_rows(genes, self.rng('data', child['id']), fresh=init is None)
        total = cfg.sft_steps + cfg.dpo_steps
        if init is None:
            sft_steps, dpo_steps = cfg.first_sft_steps, 0
        else:
            dpo_steps = round(total * genes['dpoShare']) if dpo_rows else 0
            sft_steps = total - dpo_steps
        out = self.member_dir(child['id'])
        info = self.backend.train(init, out, genes, sft_rows, dpo_rows, sft_steps, dpo_steps, self.deadline)
        if init is not None:
            remove(init)
        if self.deadline and self.clock() > self.deadline:
            remove(out)           # cut short: train it again properly after a restart
            raise Stop('time limit reached')
        self.state['members'][child['id']] = {'id': child['id'], 'genes': genes, 'parent': child['parent'], 'born': g,
                                              'fit': None, 'train': info or {}}
        self.save()

    def training_rows(self, genes: dict, rng: random.Random, fresh: bool = False) -> tuple[list[dict], list[dict]]:
        """SFT rows (engine references mixed with pool winners by refShare, hard tasks
        oversampled by hardShare) and DPO rows (pool pairs)."""
        cfg, stats = self.cfg, self.state['taskStats']
        steps = cfg.first_sft_steps if fresh else cfg.sft_steps + cfg.dpo_steps
        want = min(MAX_ROWS, steps * cfg.grad_accum)
        winners = [r for r in self.pool.winners(self.prompt_version) if r['taskId'] in self.tasks]
        n_ref = want if (fresh or not winners) else round(want * genes['refShare'])
        ref_ids = [t for t, task in self.tasks.items() if task.get('reference')]
        picked = selfplay.sample_tasks(ref_ids, stats, n_ref, genes['hardShare'], rng)
        sft = [{'task': self.tasks[t], 'text': self.tasks[t]['reference']} for t in picked]
        if winners and want > len(sft):
            w = [1.0 + 4.0 * genes['hardShare'] * (1.0 - selfplay.pass_rate(stats, r['taskId'])) for r in winners]
            k = min(len(winners), want - len(sft))
            chosen = _weighted_sample(winners, w, k, rng)
            sft += [{'task': self.tasks[r['taskId']], 'text': r['text']} for r in chosen]
        pairs = [r for r in self.pool.pairs(self.prompt_version) if r['taskId'] in self.tasks]
        dpo = [{'task': self.tasks[r['taskId']], 'chosen': r['chosen'], 'rejected': r['rejected']}
               for r in rng.sample(pairs, min(len(pairs), cfg.dpo_steps * cfg.grad_accum))]
        rng.shuffle(sft)
        return sft, dpo

    # ---- answer / verify / judge / pool ----
    def phase_answer(self, g: int) -> None:
        st, cfg = self.state, self.cfg
        if st['plan'] is None:
            ids = sorted(self.tasks)
            st['plan'] = {mid: selfplay.sample_tasks(ids, st['taskStats'], cfg.train_tasks, m['genes']['hardShare'],
                                                     self.rng('plan', mid))
                          for mid, m in sorted(st['members'].items())}
            self.save()
        gd = self.gen_dir(g)
        gd.mkdir(parents=True, exist_ok=True)
        write_jsonl(gd / 'tasks.jsonl', [self.tasks[t] for t in sorted({t for ids in st['plan'].values() for t in ids})
                                          if t in self.tasks])
        out = gd / 'gen-answers.jsonl'
        done = {(a['id'], a['member']) for a in read_jsonl(out)}
        for mid, ids in sorted(st['plan'].items()):
            if mid not in st['members']:
                continue
            self.check_time()
            m = st['members'][mid]
            tasks = [self.tasks[t] for t in ids if t in self.tasks]
            self.backend.answer(self.member_dir(mid), self.pool_member(mid), tasks, cfg.samples, m['genes']['temperature'],
                                False, done, lambda rows: append_jsonl(out, rows), self.deadline)
        self.check_time()
        self._advance('answer')

    def _gen_answers(self, g: int) -> list[dict]:
        return list(read_jsonl(self.gen_dir(g) / 'gen-answers.jsonl'))

    def phase_verify(self, g: int) -> None:
        answers = self._gen_answers(g)
        verify(answers, self.gen_dir(g) / 'tasks.jsonl', self.gen_dir(g), self.cfg, tag='train')
        self._advance('verify')

    def _scored(self, g: int) -> list[dict]:
        answers = self._gen_answers(g)
        scores = {(s['id'], s['member']): s for s in read_jsonl(self.gen_dir(g) / 'scores-train.jsonl')}
        return [{**a, 'score': scores.get((a['id'], a['member']))} for a in answers]

    def phase_judge(self, g: int) -> None:
        path = self.gen_dir(g) / 'judge-train.json'
        if not path.exists():
            out = {}
            reserve = len(self.judged_eval)
            if self.judge.enabled and self.judge.budget_left() > reserve:
                groups: dict[str, list[dict]] = {}
                for a in self._scored(g):
                    if a['score'] and a['score'].get('pass') and a['id'] in self.tasks:
                        groups.setdefault(a['id'], []).append(a)
                cand = [(self.tasks[t], rows) for t, rows in sorted(groups.items())]
                for task, rows in self.judge.sample(cand, self.cfg.judge_share, self.rng('judge')):
                    if self.judge.budget_left() <= reserve:
                        break
                    for a, s in zip(rows, self.judge.score(task, [r['text'] for r in rows])):
                        if s is not None:
                            out[f'{a["id"]}|{a["member"]}'] = s
            write_json(path, out)
        self._tone_train(g)
        self._advance('judge')

    def _tone_train(self, g: int) -> None:
        """The ChatGPT tone reviewer reads every passing answer of a few tasks (one call each, at
        most tone_per_gen). Saves {"<id>|<member>": {tone, warmth, clarity, fit, note, score}}; only
        the 0-1 score reaches the pool, the notes stay in this file and never become training text."""
        path = self.gen_dir(g) / 'tone-train.json'
        if path.exists():
            return
        out = {}
        if self.tone.enabled and self.tone.budget_left() > 0:
            groups: dict[str, list[dict]] = {}
            for a in self._scored(g):
                if a['score'] and a['score'].get('pass') and a['id'] in self.tasks:
                    groups.setdefault(a['id'], []).append(a)
            cand = [(self.tasks[t], rows) for t, rows in sorted(groups.items())]
            for task, rows in self.tone.sample(cand, self.cfg.tone_per_gen, self.rng('tone')):
                for a in rows:
                    r = self.tone.score(task, a['text'])
                    if r is not None:
                        out[f'{a["id"]}|{a["member"]}'] = r
        else:
            self.tone.say_off()
        write_json(path, out)

    def phase_pool(self, g: int) -> None:
        judged = read_json(self.gen_dir(g) / 'judge-train.json', {}) or {}
        toned = read_json(self.gen_dir(g) / 'tone-train.json', {}) or {}
        by_task: dict[str, list[dict]] = {}
        results = []
        for a in self._scored(g):
            if not a['score'] or a['id'] not in self.tasks:
                continue
            member, _s = untag_member(a['member'])
            tone = (toned.get(f'{a["id"]}|{a["member"]}') or {}).get('score')
            by_task.setdefault(a['id'], []).append({'member': member, 'text': a['text'], 'score': a['score'],
                                                    'judge': judged.get(f'{a["id"]}|{a["member"]}'), 'tone': tone})
            results.append((a['id'], bool(a['score'].get('pass'))))
        for answers in by_task.values():
            # Tone counts only where it read every passing answer of the task (like with like).
            if any(x['tone'] is None for x in answers if x['score'].get('pass')):
                for x in answers:
                    x['tone'] = None
        rows = []
        for tid, answers in sorted(by_task.items()):
            rows += rows_for_task(self.tasks[tid], answers, g, self.name, self.cfg.good_min_coverage, self.cfg.pair_margin)
        added = self.pool.add(rows)
        if self.state.get('pooledGen') != g:      # count pass rates once per generation, even after a restart
            selfplay.update_stats(self.state['taskStats'], results)
            self.state['pooledGen'] = g
        self.state['last'] = {**self.state.get('last', {}), 'poolAdded': added,
                              'trainPass': round(sum(p for _t, p in results) / len(results), 4) if results else 0.0}
        self._advance('pool')

    # ---- eval ----
    def _eval_targets(self) -> list[tuple[str, Path, dict]]:
        out = []
        for mid, m in sorted(self.state['members'].items()):
            if not m.get('fit') or m['fit'].get('evalKey') != self.eval_key:
                out.append((mid, self.member_dir(mid), m))
        ch = self.state['champion']
        if ch and (not ch.get('fit') or ch['fit'].get('evalKey') != self.eval_key) and (self.cfg.path('champion') / 'adapter_config.json').exists():
            out.append(('champion', self.cfg.path('champion'), ch))
        return out

    def phase_eval(self, g: int) -> None:
        targets = self._eval_targets()
        gd = self.gen_dir(g)
        gd.mkdir(parents=True, exist_ok=True)
        out = gd / 'eval-gen.jsonl'
        if targets:
            done = {(a['id'], a['member']) for a in read_jsonl(out)}
            for name, d, _m in targets:
                self.check_time()
                self.backend.answer(d, name, self.eval_tasks, 1, 0.0, True, done, lambda rows: append_jsonl(out, rows),
                                    self.deadline)
            self.check_time()
            names = {n for n, _d, _m in targets}
            answers = [a for a in read_jsonl(out) if untag_member(a['member'])[0] in names]
            scores = verify(answers, self.eval_file(), gd, self.cfg, tag='eval')
            judged = self._judge_eval(gd, answers, scores)
            got = {(a['id'], untag_member(a['member'])[0]): s for a, s in zip(answers, scores)}
            for n in names:
                sc = [got.get((t['id'], n)) for t in self.eval_tasks]
                fit = eval_fitness(sc, judged.get(n, []))
                fit['evalKey'] = self.eval_key
                fit['generation'] = g
                if n == 'champion':
                    self.state['champion']['fit'] = fit
                else:
                    self.state['members'][n]['fit'] = fit
        self._advance('eval')

    def _judge_eval(self, gd: Path, answers: list[dict], scores: list) -> dict[str, list[float]]:
        """The judge reads every new member's answer to the same few eval tasks (one call per task)."""
        path = gd / 'judge-eval.json'
        saved = read_json(path)
        if saved is not None:
            return saved
        out: dict[str, list[float]] = {}
        if self.judge.enabled:
            by_task: dict[str, list[tuple[str, str]]] = {}
            for a, s in zip(answers, scores):
                if s and s.get('pass') and a['id'] in self.judged_eval:
                    by_task.setdefault(a['id'], []).append((untag_member(a['member'])[0], a['text']))
            tasks = {t['id']: t for t in self.eval_tasks}
            for tid in self.judged_eval:
                rows = by_task.get(tid, [])
                for i in range(0, len(rows), self.cfg.judge_batch):
                    chunk = rows[i:i + self.cfg.judge_batch]
                    for (n, _t), s in zip(chunk, self.judge.score(tasks[tid], [t for _n, t in chunk])):
                        if s is not None:
                            out.setdefault(n, []).append(s)
        write_json(path, out)
        return out

    # ---- select ----
    def _use_judge(self) -> bool:
        fits = [m.get('fit') for m in self.state['members'].values()]
        if self.state['champion']:
            fits.append(self.state['champion'].get('fit'))
        fits = [f for f in fits if f]
        return bool(fits) and all(f.get('judge') is not None for f in fits)

    def phase_select(self, g: int) -> None:
        st, cfg = self.state, self.cfg
        use_judge = self._use_judge()
        ranked = rank_members(st['members'], use_judge, cfg.truth_gate)
        last = st.setdefault('last', {})
        if 'selected' not in last or last.get('selectedGen') != g:
            best = ranked[0] if ranked else None
            changed = False
            if best and st['members'][best].get('fit'):
                champ = st['champion']
                bf = st['members'][best]['fit']
                if beats(bf, champ.get('fit') if champ else None, use_judge, cfg.truth_gate):
                    copy_dir(self.member_dir(best), cfg.path('champion'))
                    st['champion'] = {'member': best, 'run': self.name, 'genes': st['members'][best]['genes'],
                                      'generation': g, 'fit': bf}
                    changed = True
                    log(f'new champion {best}: truth {bf["truthRate"]:.2f}, quality {quality_of(bf, use_judge):.3f}')
            keep = math.ceil(cfg.population / 2)
            last.update({'selectedGen': g, 'selected': ranked[:keep], 'eliminated': ranked[keep:], 'best': best,
                         'championChanged': changed, 'useJudge': use_judge})
            self.save()
        for mid in last['eliminated']:
            if mid in st['members']:
                self.fold_into_hive(mid, use_judge)
        self._advance('select')

    def fold_into_hive(self, mid: str, use_judge: bool) -> None:
        """Fitness-weighted delta merge of an eliminated member into the hive, then delete it.
        Its pool rows are untouched."""
        st, cfg = self.state, self.cfg
        hive = st['hive'] or {'mass': 0.0, 'folded': [], 'rank': HIVE_RANK}
        d = self.member_dir(mid)
        if mid not in hive['folded'] and (d / 'adapter_config.json').exists():
            f = fitness_scalar(st['members'][mid].get('fit'), use_judge, cfg.truth_gate)
            tmp = cfg.path('tmp', 'hive-new')
            remove(tmp)
            if st['hive'] and (cfg.path('hive') / 'adapter_config.json').exists():
                mass = hive['mass'] * HIVE_DECAY
                wh, wm = hive_weights(mass, f)
                fold([cfg.path('hive'), d], [wh, wm], hive['rank'], tmp)
                hive['mass'] = mass + max(f, 1e-3)
            else:
                fold([d], [1.0], hive['rank'], tmp)
                hive['mass'] = max(f, 1e-3)
            copy_dir(tmp, cfg.path('hive'))
            remove(tmp)
            hive['folded'].append(mid)
            st['hive'] = hive
            self.save()
        remove(d)
        del st['members'][mid]
        self.save()

    # ---- self-play ----
    def phase_selfplay(self, g: int) -> None:
        st, cfg = self.state, self.cfg
        gd = self.gen_dir(g)
        req = gd / 'requests.jsonl'
        if not req.exists():
            hard = selfplay.hardest(st['taskStats'], list(self.tasks), cfg.hard_tasks)
            asked = set(st['asked'])
            rows = selfplay.make_requests(self.tasks, hard, asked)
            st['asked'] = sorted(asked)
            write_jsonl(req, rows)
            st['last']['hardTasks'] = hard
            self.save()
        new = 0
        rows = list(read_jsonl(req))
        made = gd / 'selfplay-tasks.jsonl'
        if rows and not made.exists():
            ok, why = node_status(cfg)
            if ok:
                try:
                    make_tasks(cfg, made, requests=req, minutes=cfg.factory_minutes)
                except VerifyError as e:
                    log(f'self-play questions skipped this time: {e}')
            else:
                log(f'self-play questions skipped: {why}')
        if made.exists():
            fresh = [t for t in read_jsonl(made) if t.get('split', 'train') != 'eval' and t['id'] not in self.eval_all
                     and t.get('promptVersion', 0) == self.prompt_version]
            new = self.pool.add({'kind': 'task', 'task': t, 'run': self.name, 'generation': g} for t in fresh)
            for t in fresh:
                self.tasks.setdefault(t['id'], t)
        st['last']['newTasks'] = new
        self._advance('selfplay')

    # ---- log ----
    def phase_log(self, g: int) -> None:
        st, cfg = self.state, self.cfg
        use_judge = self._use_judge()
        last = st.get('last', {})
        ch = st['champion']
        row = {
            'generation': g, 'time': int(self.clock()), 'run': self.name,
            'members': [{'id': mid, 'genes': m['genes'], 'fit': m.get('fit'), 'parent': m.get('parent')}
                        for mid, m in sorted(st['members'].items())],
            'eliminated': last.get('eliminated', []), 'best': last.get('best'),
            'champion': {'member': ch['member'], 'generation': ch['generation'], 'fit': ch.get('fit')} if ch else None,
            'championChanged': last.get('championChanged', False),
            'hive': {'mass': round(st['hive']['mass'], 4), 'folded': len(st['hive']['folded'])} if st['hive'] else None,
            'pool': self.pool.stats(), 'poolAdded': last.get('poolAdded', 0), 'trainPass': last.get('trainPass'),
            'judgeCalls': self.judge.calls, 'toneCalls': self.tone.calls,
            'hardTasks': last.get('hardTasks', []), 'newTasks': last.get('newTasks', 0),
        }
        logs = [r for r in read_jsonl(cfg.path('log.jsonl')) if r.get('generation') != g]
        write_jsonl(cfg.path('log.jsonl'), logs + [row])
        chart = render_chart(logs + [row], use_judge)
        cfg.path('chart.txt').write_text(chart, encoding='utf-8')
        log('generation done:\n' + '\n'.join(chart.splitlines()[1:2] + chart.splitlines()[-1:]))
        prune(cfg, st)
        if self.on_generation:
            try:
                self.on_generation(self, row)
            except Exception as e:           # uploads must never stop training
                log(f'after-generation step failed: {e}')
        st['last'] = {}
        st['plan'] = None
        self._advance('log')


def _weighted_sample(items: list, weights: list[float], k: int, rng: random.Random) -> list:
    """k distinct items, more likely the heavier ones (Efraimidis-Spirakis keys)."""
    keyed = sorted(((rng.random() ** (1.0 / max(w, 1e-9)), i) for i, w in enumerate(weights)), reverse=True)
    return [items[i] for _k, i in keyed[:k]]


def render_chart(rows: list[dict], use_judge: bool = False, width: int = 40) -> str:
    """One line per generation: the champion's quality as a bar, with truth rate and pool size."""
    lines = ['(* = new champion)', 'gen   champion quality (bar = 0..1)' + ' ' * (width - 26) + 'quality truth train-pass pool good/pairs']
    for r in rows:
        ch = (r.get('champion') or {}).get('fit') or {}
        q = quality_of(ch, use_judge) if ch else 0.0
        bar = '#' * int(round(q * width))
        mark = '*' if r.get('championChanged') else ' '
        pool = r.get('pool') or {}
        lines.append(f'{r["generation"]:>3}{mark} |{bar:<{width}}| {q:4.2f}    {ch.get("truthRate", 0):4.2f}  '
                     f'{(r.get("trainPass") or 0):4.2f}       {pool.get("good", 0)}/{pool.get("pair", 0)}')
    return '\n'.join(lines)


def managed_size(cfg) -> int:
    return sum(dir_size(cfg.path(p)) for p in ('members', 'hive', 'champion', 'gens', 'tmp', 'export', 'pool.jsonl.gz'))


def prune(cfg, state: dict) -> None:
    """Keep disk under the cap: old generation folders, then temp files, then old web exports go first.
    The pool, state, hive, champion and live members are never pruned."""
    gens = sorted(p for p in cfg.path('gens').glob('g*') if p.is_dir()) if cfg.path('gens').exists() else []
    current = f'g{state["generation"]:04d}'
    old = [p for p in gens if p.name != current]
    for p in old[: max(0, len(old) - cfg.keep_gen_dirs)]:
        remove(p)
    cap = cfg.disk_cap_gb * 1e9
    if managed_size(cfg) > cap:
        for p in [x for x in old if x.exists()] + [cfg.path('tmp'), cfg.path('export')]:
            remove(p)
            if managed_size(cfg) <= cap:
                break
    size = managed_size(cfg)
    if size > cap:
        log(f'warning: training files use {size / 1e9:.1f} GB, over the {cfg.disk_cap_gb:g} GB cap '
            f'(population, hive, champion and pool are kept)')
