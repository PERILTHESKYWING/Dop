"""The third teacher: self-play.

Hard-task mining: every checked answer updates its task's pass count; tasks the population
fails most are oversampled next generation (each member's hardShare gene says how much).
Question-maker: for the hardest positions it writes requests.jsonl asking new why-not (and
why-move) questions about moves that are already in that task's variations, so the factory
(which only accepts those moves) can turn them into fresh tasks with KataGo's facts.
"""
from __future__ import annotations

import random
import re

GTP_COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'


def update_stats(stats: dict, results: list[tuple[str, bool]]) -> dict:
    for tid, passed in results:
        s = stats.setdefault(tid, {'n': 0, 'pass': 0})
        s['n'] += 1
        s['pass'] += 1 if passed else 0
    return stats


def pass_rate(stats: dict, tid: str) -> float:
    """Smoothed pass rate (unseen tasks count as 0.5)."""
    s = stats.get(tid) or {'n': 0, 'pass': 0}
    return (s['pass'] + 1) / (s['n'] + 2)


def hardest(stats: dict, task_ids, k: int) -> list[str]:
    seen = [t for t in task_ids if (stats.get(t) or {}).get('n', 0) > 0]
    seen.sort(key=lambda t: (pass_rate(stats, t), t))
    return seen[:k]


def sample_tasks(task_ids: list[str], stats: dict, n: int, hard_share: float, rng: random.Random) -> list[str]:
    """n distinct task ids: about hard_share of them drawn from the lower half by pass rate
    (weighted towards the hardest), the rest uniformly."""
    ids = sorted(task_ids)
    n = min(n, len(ids))
    if n <= 0:
        return []
    ranked = sorted(ids, key=lambda t: (pass_rate(stats, t), t))
    hard_pool = ranked[: max(1, len(ranked) // 2)]
    n_hard = min(len(hard_pool), round(n * max(0.0, min(1.0, hard_share))))
    picked: list[str] = []
    weights = [1.0 - pass_rate(stats, t) + 1e-3 for t in hard_pool]
    pool, w = list(hard_pool), list(weights)
    while len(picked) < n_hard and pool:
        i = rng.choices(range(len(pool)), weights=w)[0]
        picked.append(pool.pop(i))
        w.pop(i)
    rest = [t for t in ids if t not in set(picked)]
    picked += rng.sample(rest, min(n - len(picked), len(rest)))
    return picked


def loc_to_gtp(loc: int, size: int) -> str | None:
    if loc is None or loc < 0 or size <= 0 or loc >= size * size:
        return None
    x, y = loc % size, loc // size
    return f'{GTP_COLS[x]}{size - y}'


_LINE = re.compile(r'^- \[\[(v\d+)\]\][^:]*\(([a-z-]+)[^)]*\):\s*[BW] ([A-HJ-Z]\d{1,2})', re.M)


def task_moves(task: dict) -> list[tuple[str, str]]:
    """(move, variation kind) for the first move of each variation, best first; from the
    explanation when present, else from the prompt's "Variations:" lines."""
    out: list[tuple[str, str]] = []
    ex = task.get('explanation') or {}
    size = (ex.get('position') or {}).get('size') or 19
    for v in ex.get('variations') or []:
        moves = v.get('moves') or []
        if moves:
            g = loc_to_gtp(moves[0].get('loc', -1), size)
            if g:
                out.append((g, v.get('kind', '')))
    if not out:
        for m in _LINE.finditer(task.get('prompt', '')):
            out.append((m.group(3), m.group(2)))
    seen, uniq = set(), []
    for g, k in out:
        if g not in seen:
            seen.add(g)
            uniq.append((g, k))
    return uniq


def make_requests(tasks: dict[str, dict], hard_ids: list[str], asked: set, per_task: int = 2) -> list[dict]:
    """New questions about hard positions. `asked` holds "taskId|kind|move" strings and is updated."""
    out = []
    for tid in hard_ids:
        task = tasks.get(tid)
        if not task:
            continue
        made = 0
        for move, kind in task_moves(task):
            if made >= per_task:
                break
            q_kind = 'why-move' if kind == 'best' else 'why-not'
            tag = f'{tid}|{q_kind}|{move}'
            if tag in asked:
                continue
            text = f'Why is {move} the right move here?' if q_kind == 'why-move' else f'Why not {move}?'
            out.append({'taskId': tid, 'question': {'kind': q_kind, 'move': move, 'text': text}})
            asked.add(tag)
            made += 1
    return out
