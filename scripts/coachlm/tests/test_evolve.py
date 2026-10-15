"""The whole population loop with a fake model, the stub verify CLI and a fake judge."""
import json

import pytest

pytest.importorskip('safetensors')

import evolve  # noqa: E402
from conftest import write_fake_adapter  # noqa: E402
from evolve import Evolution, prune  # noqa: E402
from truth import tag_member  # noqa: E402
from util import read_json, read_jsonl  # noqa: E402


class FakeBackend:
    """Each trained member gets a fixed answer quality; low quality invents a fact (Z99)."""

    def __init__(self, crash_on_train=None):
        self.trained, self.answer_calls, self.crash_on_train = [], [], crash_on_train

    def answer(self, adapter_dir, member, tasks, k, temperature, greedy, done, on_rows, deadline=None):
        q = json.loads((adapter_dir / 'fake.json').read_text())['quality']
        rows = []
        for t in tasks:
            for s in range(k):
                tag = tag_member(member, s)
                if (t['id'], tag) in done:
                    continue
                if q < 0.35 and (s == 0 or greedy):
                    text = f'Z99 is the move for {t["id"]}.'
                else:
                    text = f'Q16 because the corner matters ({t["id"]}). ' + 'more depth ' * int(q * 15)
                rows.append({'id': t['id'], 'member': tag, 'text': text})
                done.add((t['id'], tag))
        self.answer_calls.append((member, len(rows), greedy))
        on_rows(rows)
        return len(rows)

    def train(self, init_dir, out_dir, genes, sft_rows, dpo_rows, sft_steps, dpo_steps, deadline=None):
        if self.crash_on_train is not None and len(self.trained) == self.crash_on_train:
            self.crash_on_train = None
            raise KeyboardInterrupt
        q = 0.2 + 0.25 * (len(self.trained) % 4)                  # a fixed spread: 0.2 (invents facts) .. 0.95
        write_fake_adapter(out_dir, int(genes['rank']), seed=len(self.trained), quality=q)
        self.trained.append({'init': init_dir, 'sft': sft_rows, 'dpo': dpo_rows, 'steps': (sft_steps, dpo_steps)})
        return {'sft_rows': len(sft_rows)}

    def close(self):
        pass


class FakeJudge:
    def __init__(self, cap=100):
        self.calls, self.cap, self.stopped = 0, cap, ''

    @property
    def enabled(self):
        return self.calls < self.cap

    def budget_left(self):
        return max(0, self.cap - self.calls)

    def sample(self, groups, share, rng):
        return groups[: self.budget_left()]

    def score(self, task, texts):
        if self.calls >= self.cap:
            return [None] * len(texts)
        self.calls += 1
        return [min(1.0, len(t) / 150) for t in texts]


@pytest.fixture(autouse=True)
def node_ok(monkeypatch):
    monkeypatch.setattr(evolve, 'node_status', lambda cfg: (True, 'stub node'))


def run(cfg, backend=None, judge=None, gens=1, deadline=None, clock=None):
    evo = Evolution(cfg, backend or FakeBackend(), judge or FakeJudge(), name='pc', **({'clock': clock} if clock else {}))
    return evo, evo.run(deadline=deadline, max_generations=gens)


def test_two_generations_end_to_end(cfg, tasks_on_disk):
    train, ev = tasks_on_disk
    backend = FakeBackend()
    evo, msg = run(cfg, backend, gens=2)
    assert msg == 'finished 2 generation(s)'
    st = evo.state
    assert st['generation'] == 3 and st['phase'] == 'breed'
    assert len(st['members']) == 2                               # top half kept; next breed refills to 4
    assert len(backend.trained) == 4 + 2                         # 4 founders, then 2 children
    assert backend.trained[0]['init'] is None and backend.trained[0]['steps'] == (cfg.first_sft_steps, 0)
    assert all(t['init'] is not None for t in backend.trained[4:])   # children start from hive or a parent
    # hive holds every eliminated member; their dirs are gone
    assert len(st['hive']['folded']) == 4
    assert (cfg.path('hive') / 'adapter_config.json').exists()
    for mid in st['hive']['folded']:
        assert not cfg.path('members', mid).exists()
    # ...but their pool rows stay
    pool_members = {r.get('member') for r in read_jsonl(cfg.path('pool.jsonl.gz'))}
    assert {f'pc/{m}' for m in st['hive']['folded']} & pool_members
    # champion exists and is the best evaluated so far
    assert (cfg.path('champion') / 'adapter_config.json').exists() and st['champion']['fit']['truthRate'] > 0
    # eval set never leaks into the pool or the training rows
    eval_ids = {t['id'] for t in ev}
    assert not any(r.get('taskId') in eval_ids for r in read_jsonl(cfg.path('pool.jsonl.gz')))
    for t in backend.trained:
        assert not any(r['task']['id'] in eval_ids for r in t['sft'] + t['dpo'])
    # children trained on pool data from other members (hivemind), including pairs
    later = backend.trained[4:]
    assert any(t['dpo'] for t in later)
    assert any(r['text'] != r['task']['reference'] for t in later for r in t['sft'])
    # logs and chart
    log = list(read_jsonl(cfg.path('log.jsonl')))
    assert [r['generation'] for r in log] == [1, 2]
    assert 'champion quality' in cfg.path('chart.txt').read_text()
    # self-play: requests written and the factory's tasks joined the train set via the pool
    assert any(r['kind'] == 'task' for r in read_jsonl(cfg.path('pool.jsonl.gz')))
    assert len(evo.tasks) > len(train)


def test_survivors_are_not_re_evaluated(cfg, tasks_on_disk):
    backend = FakeBackend()
    run(cfg, backend, gens=1)
    evo, _ = run(cfg, backend, gens=1)
    eval_answers = [c for c in backend.answer_calls if c[2]]
    assert len(eval_answers) == 4 + 2                            # founders once, then only the 2 children


def test_champion_never_regresses(cfg, tasks_on_disk):
    backend = FakeBackend()
    evo, _ = run(cfg, backend, gens=1)
    first = evo.state['champion']
    worse = dict(first['fit'], truthRate=first['fit']['truthRate'] - 0.25, quality=1.0)
    for m in evo.state['members'].values():                      # pretend the next generation is worse on truth
        m['fit'] = dict(worse, evalKey=evo.eval_key)
    evo.state['phase'] = 'select'
    evo.phase_select(evo.state['generation'])
    assert evo.state['champion']['member'] == first['member']


def test_resume_after_crash_does_not_repeat_work(cfg, tasks_on_disk):
    backend = FakeBackend(crash_on_train=2)
    with pytest.raises(KeyboardInterrupt):
        run(cfg, backend, gens=1)
    st = read_json(cfg.path('state.json'))
    assert st['phase'] == 'breed' and len(st['members']) == 2
    backend2 = FakeBackend()
    evo, msg = run(cfg, backend2, gens=1)
    assert msg == 'finished 1 generation(s)' and len(backend2.trained) == 2   # only the missing two
    answers = list(read_jsonl(cfg.path('gens', 'g0001', 'gen-answers.jsonl')))
    keys = [(a['id'], a['member']) for a in answers]
    assert len(keys) == len(set(keys)) == 4 * cfg.train_tasks * cfg.samples


def test_resume_mid_answers(cfg, tasks_on_disk):
    class Stopper(FakeBackend):
        def answer(self, *a, **kw):
            if len(self.answer_calls) == 2:
                raise KeyboardInterrupt
            return super().answer(*a, **kw)
    with pytest.raises(KeyboardInterrupt):
        run(cfg, Stopper(), gens=1)
    assert read_json(cfg.path('state.json'))['phase'] == 'answer'
    evo, msg = run(cfg, FakeBackend(), gens=1)
    answers = list(read_jsonl(cfg.path('gens', 'g0001', 'gen-answers.jsonl')))
    assert len(answers) == len({(a['id'], a['member']) for a in answers}) == 4 * cfg.train_tasks * cfg.samples


def test_time_limit_stops_cleanly(cfg, tasks_on_disk):
    t = [0.0]

    class Slow(FakeBackend):
        def train(self, *a, **kw):
            t[0] += 100
            return super().train(*a, **kw)
    evo, msg = run(cfg, Slow(), gens=5, deadline=250, clock=lambda: t[0])
    assert msg == 'time limit reached'
    st = read_json(cfg.path('state.json'))
    assert len(st['members']) == 2                               # third child cut short and not kept
    assert not cfg.path('members', 'm0003').exists()


def test_judge_cap_keeps_ranking_fair(cfg, tasks_on_disk):
    evo, _ = run(cfg, judge=FakeJudge(cap=1), gens=1)
    assert evo.judge.calls == 1                                   # train sampling held back to leave budget for eval
    ms = evo.state['members']
    for m in ms.values():
        m['fit'] = dict(m['fit'], judge=0.5)
    evo.state['champion']['fit'] = dict(evo.state['champion']['fit'], judge=0.5)
    assert evo._use_judge()
    next(iter(ms.values()))['fit']['judge'] = None                # one unjudged member: judge ignored for all
    assert not evo._use_judge()


def test_no_eval_set_refuses(cfg, tasks_on_disk):
    cfg.path('tasks', 'eval.jsonl.gz').unlink()
    evo, msg = run(cfg, gens=1)
    assert 'refusing' in msg


def test_prune_keeps_what_matters(cfg, tasks_on_disk):
    evo, _ = run(cfg, gens=2)
    for g in (1, 2, 3):
        (cfg.path('gens', f'g{g:04d}')).mkdir(parents=True, exist_ok=True)
    (cfg.path('export')).mkdir(exist_ok=True)
    (cfg.path('export', 'big.onnx')).write_bytes(b'0' * 200_000)
    cfg.disk_cap_gb = 1e-4                                        # 100 kB: everything prunable goes
    prune(cfg, evo.state)
    assert not cfg.path('export').exists()
    assert cfg.path('gens', 'g0003').exists()                     # the current generation stays
    assert not cfg.path('gens', 'g0001').exists()
    for keep in ('pool.jsonl.gz', 'state.json', 'hive', 'champion'):
        assert cfg.path(keep).exists()
    assert all(cfg.path('members', m).exists() for m in evo.state['members'])


def test_base_model_change_is_refused(cfg, tasks_on_disk):
    run(cfg, gens=1)
    cfg.base_model = 'another/model'
    with pytest.raises(SystemExit, match='trained tiny/test-model'):
        Evolution(cfg, FakeBackend(), FakeJudge())
