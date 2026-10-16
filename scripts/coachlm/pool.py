"""The HIVEMIND memory: one append-only pool shared by every member, machine and generation.

Rows (one JSON object per line in pool.jsonl.gz):
  {"kind": "good", "key", "taskId", "promptVersion", "text", "member", "generation", "run",
   "scores": {"truth", "coverage", "depth", "judge"?, "tone"?, "quality"}, "ts"}
      a verified good answer (truth check passed, enough coverage)
  {"kind": "pair", "key", "taskId", "promptVersion", "chosen", "rejected", "member",
   "rejectedMember", "generation", "run", "scores": {"chosen": {...}, "rejected": {...}}, "ts"}
      a (better, worse) pair for preference training; the two answers may come from different members
  {"kind": "task", "key", "task": {...a factory task line...}, "run", "generation", "ts"}
      a self-play task (made from a question-maker request), so other machines can train on it too

Rules: rows are only ever added (an eliminated member's rows stay forever), a row with an
existing key is a duplicate and is dropped, and nothing about an eval task ever gets in
(the eval set must stay unseen). Sync merges the release copy into the local one and then
uploads the union, so PC and Kaggle runs combine. If two machines upload at the same moment
one upload can overwrite the other's, but each keeps its local pool and its next sync puts
its rows back: the union only grows.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable

from util import append_jsonl, log, read_jsonl, text_key, write_jsonl

POOL_ASSET = 'pool.jsonl.gz'

# Answer quality weights (truth is a gate, not a weight: a failing answer is worth 0).
W_COVERAGE, W_DEPTH, W_JUDGE = 0.5, 0.3, 0.2
# Share of quality that comes from XIAO's rubric (eval/coach/rubric.json, code-checked rules)
# whenever verify.ts scored it: the rubric is the human teacher's voice, so it weighs most.
W_RUBRIC = 0.5
# Share of quality from the ChatGPT tone reviewer (tone.py, 0-1) when it read the answer. It comes
# out of the non-rubric part (coverage, depth and judge shrink in proportion); the rubric keeps W_RUBRIC.
W_TONE = 0.2


def answer_quality(score: dict, judge: float | None = None, tone: float | None = None) -> float:
    """0-1 quality of one checked answer. 0 unless it passed the truth check."""
    if not score or not score.get('pass') or score.get('truth', 0) < 1:
        return 0.0
    cov, dep = float(score.get('coverage', 0)), float(score.get('depth', 0))
    if judge is None:
        base = (W_COVERAGE * cov + W_DEPTH * dep) / (W_COVERAGE + W_DEPTH)
    else:
        base = W_COVERAGE * cov + W_DEPTH * dep + W_JUDGE * float(judge)
    rubric = score.get('rubric')
    rubric = float(rubric) if isinstance(rubric, (int, float)) else None
    if tone is not None:
        w_rubric = W_RUBRIC if rubric is not None else 0.0
        tone = min(1.0, max(0.0, float(tone)))
        return (1 - w_rubric - W_TONE) * base + W_TONE * tone + (w_rubric * rubric if rubric is not None else 0.0)
    if rubric is not None:
        return (1 - W_RUBRIC) * base + W_RUBRIC * rubric
    return base


def row_key(row: dict) -> str:
    kind = row.get('kind')
    if kind == 'good':
        return text_key('good', row['taskId'], row.get('promptVersion', ''), row['text'])
    if kind == 'pair':
        return text_key('pair', row['taskId'], row.get('promptVersion', ''), row['chosen'], row['rejected'])
    if kind == 'task':
        return text_key('task', row['task']['id'])
    raise ValueError(f'unknown pool row kind {kind!r}')


class Pool:
    def __init__(self, path: Path, eval_ids: Iterable[str] = ()):
        self.path = Path(path)
        self.eval_ids = set(eval_ids)
        self.rows: list[dict] = []
        self.keys: set[str] = set()
        for r in read_jsonl(self.path):
            self._take(r)

    def _allowed(self, r: dict) -> bool:
        tid = r['task']['id'] if r.get('kind') == 'task' else r.get('taskId')
        if tid in self.eval_ids:
            return False
        if r.get('kind') == 'task' and r['task'].get('split') == 'eval':
            return False
        return True

    def _take(self, r: dict) -> bool:
        try:
            key = r.get('key') or row_key(r)
        except (KeyError, ValueError):
            return False
        if key in self.keys or not self._allowed(r):
            return False
        r['key'] = key
        self.keys.add(key)
        self.rows.append(r)
        return True

    def add(self, rows: Iterable[dict]) -> int:
        """Append new rows (duplicates and eval-task rows are dropped). Returns how many were new."""
        new = []
        for r in rows:
            r = dict(r)
            r.setdefault('ts', int(time.time()))
            if self._take(r):
                new.append(r)
        append_jsonl(self.path, new)
        return len(new)

    def merge_file(self, other: Path) -> int:
        """Union another pool file (e.g. the release copy) into this one."""
        return self.add(read_jsonl(other))

    def compact_to(self, dest: Path) -> int:
        return write_jsonl(dest, self.rows)

    # ---- views ----
    def good(self, prompt_version=None) -> list[dict]:
        return [r for r in self.rows if r['kind'] == 'good' and (prompt_version is None or r.get('promptVersion') == prompt_version)]

    def pairs(self, prompt_version=None) -> list[dict]:
        return [r for r in self.rows if r['kind'] == 'pair' and (prompt_version is None or r.get('promptVersion') == prompt_version)]

    def tasks(self) -> dict[str, dict]:
        return {r['task']['id']: r['task'] for r in self.rows if r['kind'] == 'task'}

    def winners(self, prompt_version=None, per_task: int = 2) -> list[dict]:
        """The best `per_task` good answers of each task, by quality."""
        by: dict[str, list[dict]] = {}
        for r in self.good(prompt_version):
            by.setdefault(r['taskId'], []).append(r)
        out = []
        for rows in by.values():
            rows.sort(key=lambda r: -r.get('scores', {}).get('quality', 0))
            out.extend(rows[:per_task])
        return out

    def stats(self) -> dict:
        kinds = {'good': 0, 'pair': 0, 'task': 0}
        members = set()
        for r in self.rows:
            kinds[r['kind']] = kinds.get(r['kind'], 0) + 1
            if r.get('member'):
                members.add(r['member'])
        return {**kinds, 'members': len(members)}


def _score_part(s: dict, judge: float | None, tone: float | None = None) -> dict:
    out = {k: s.get(k) for k in ('truth', 'coverage', 'depth') if k in s}
    if judge is not None:
        out['judge'] = round(judge, 3)
    if tone is not None:
        out['tone'] = round(tone, 3)
    out['quality'] = round(answer_quality(s, judge, tone), 4)
    return out


def rows_for_task(task: dict, answers: list[dict], generation: int, run: str,
                  good_min_coverage: float = 0.3, margin: float = 0.15, max_pairs: int = 3) -> list[dict]:
    """Pool rows from all members' checked answers to one task.

    `answers`: [{"member", "text", "score": {truth, coverage, depth, pass, ...}, "judge": 0-1 | None,
    "tone": 0-1 | None}] (tone: the ChatGPT tone reviewer's score; only numbers, never its note).
    Good rows: every passing answer with coverage >= good_min_coverage. Pairs: the best good
    answer against answers at least `margin` worse, invented-fact answers first (they teach
    the most), at most `max_pairs` per task. Members are mixed freely: that is the hivemind.
    """
    base = {'taskId': task['id'], 'promptVersion': task.get('promptVersion'), 'generation': generation, 'run': run}
    scored = [(answer_quality(a['score'], a.get('judge'), a.get('tone')), a) for a in answers if a.get('score')]
    goods = [(q, a) for q, a in scored if a['score'].get('pass') and a['score'].get('coverage', 0) >= good_min_coverage]
    rows = [{**base, 'kind': 'good', 'text': a['text'], 'member': a['member'],
             'scores': _score_part(a['score'], a.get('judge'), a.get('tone'))} for _q, a in goods]
    if goods:
        best_q, best = max(goods, key=lambda x: x[0])
        worse = [(q, a) for q, a in scored if a is not best and best_q - q >= margin and a['text'].strip() != best['text'].strip()]
        worse.sort(key=lambda x: (x[1]['score'].get('pass', False), x[0]))
        for _q, w in worse[:max_pairs]:
            rows.append({**base, 'kind': 'pair', 'chosen': best['text'], 'rejected': w['text'],
                         'member': best['member'], 'rejectedMember': w['member'],
                         'scores': {'chosen': _score_part(best['score'], best.get('judge'), best.get('tone')),
                                    'rejected': _score_part(w['score'], w.get('judge'), w.get('tone'))}})
    return rows


def sync(pool: Pool, cfg, token: str | None, upload: bool) -> str:
    """Merge the release's pool into ours; with upload, put the union back. Never raises on network trouble."""
    from release import fetch_asset, get_release, upload_asset
    tmp = cfg.path('tmp')
    try:
        rel = get_release(cfg.repo, cfg.release_tag, token)
    except OSError as e:
        return f'pool not synced: could not reach GitHub ({e})'
    if rel is None:
        return f'pool kept local: the {cfg.release_tag} release does not exist yet (the Coach LM workflow makes it)'
    added = 0
    try:
        remote = fetch_asset(rel, POOL_ASSET, tmp / 'remote-pool.jsonl.gz', token)
        if remote:
            added = pool.merge_file(remote)
    except OSError as e:
        log(f'could not download the shared pool ({e}); keeping ours')
    msg = f'pool: {added} rows from other runs merged in'
    if upload:
        if not token:
            return msg + '; not uploaded (no GITHUB_TOKEN)'
        out = tmp / 'pool-upload.jsonl.gz'
        n = pool.compact_to(out)
        try:
            upload_asset(rel, out, POOL_ASSET, token)
            msg += f'; uploaded {n} rows'
        except OSError as e:
            msg += f'; upload failed ({e}), will retry next generation'
    return msg
