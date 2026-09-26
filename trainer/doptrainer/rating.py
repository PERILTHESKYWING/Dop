"""Elo ratings from match results (Bradley-Terry, fitted by maximum likelihood).

Every game ever played between two networks goes into one fit, so each generation's rating keeps
improving as it plays more. The untrained network ("gen 0") is fixed at 0 Elo, so the number reads
as "how much stronger than random play". Each pair that has met also gets half a virtual draw, a
mild prior that keeps 16-0 results finite (about +720 Elo) without squashing real gaps much.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

ELO_PER_NAT = 400.0 / math.log(10.0)


@dataclass
class Pair:
    a: str
    b: str
    a_wins: float = 0.0
    b_wins: float = 0.0

    @property
    def games(self) -> float:
        return self.a_wins + self.b_wins


def add_result(pairs: dict[tuple[str, str], Pair], winner: str | None, p1: str, p2: str) -> None:
    """Record one game between p1 and p2. winner None means a draw or no result."""
    a, b = sorted((p1, p2))
    pair = pairs.setdefault((a, b), Pair(a, b))
    if winner is None:
        pair.a_wins += 0.5
        pair.b_wins += 0.5
    elif winner == a:
        pair.a_wins += 1
    elif winner == b:
        pair.b_wins += 1
    else:
        raise ValueError(f"winner {winner!r} is neither {p1!r} nor {p2!r}")


def fit(pairs: list[Pair], anchor: str, prior_draws: float = 0.5, iters: int = 2000) -> dict[str, tuple[float, float]]:
    """Return {player: (elo, stderr)} with `anchor` at 0.

    Players not connected to the anchor by any chain of games are left out.
    """
    players = sorted({p.a for p in pairs} | {p.b for p in pairs} | {anchor})
    connected = _component(pairs, anchor)
    players = [p for p in players if p in connected]
    idx = {p: i for i, p in enumerate(players)}
    n = len(players)
    wins = [[0.0] * n for _ in range(n)]
    for p in pairs:
        if p.a not in idx or p.b not in idx:
            continue
        i, j = idx[p.a], idx[p.b]
        wins[i][j] += p.a_wins + prior_draws / 2
        wins[j][i] += p.b_wins + prior_draws / 2

    # Minorization-maximization (Hunter 2004) on gamma = exp(rating).
    gamma = [1.0] * n
    a = idx[anchor]
    for _ in range(iters):
        delta = 0.0
        for i in range(n):
            if i == a:
                continue
            w = sum(wins[i])
            denom = 0.0
            for j in range(n):
                g = wins[i][j] + wins[j][i]
                if g:
                    denom += g / (gamma[i] + gamma[j])
            if denom <= 0 or w <= 0:
                continue
            new = w / denom
            delta = max(delta, abs(math.log(new / gamma[i])))
            gamma[i] = new
        scale = gamma[a]
        gamma = [g / scale for g in gamma]
        if delta < 1e-9:
            break

    r = [math.log(g) for g in gamma]
    out: dict[str, tuple[float, float]] = {}
    for i, p in enumerate(players):
        info = 0.0
        for j in range(n):
            g = wins[i][j] + wins[j][i]
            if g and j != i:
                q = 1.0 / (1.0 + math.exp(r[j] - r[i]))
                info += g * q * (1 - q)
        se = 0.0 if i == a else (ELO_PER_NAT / math.sqrt(info) if info > 0 else float("inf"))
        out[p] = (r[i] * ELO_PER_NAT, se)
    return out


def expected_score(elo_a: float, elo_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((elo_b - elo_a) / 400.0))


def _component(pairs: list[Pair], start: str) -> set[str]:
    adj: dict[str, set[str]] = {}
    for p in pairs:
        if p.games <= 0:
            continue
        adj.setdefault(p.a, set()).add(p.b)
        adj.setdefault(p.b, set()).add(p.a)
    seen = {start}
    stack = [start]
    while stack:
        for nxt in adj.get(stack.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


_PB = re.compile(r"PB\[([^\]]*)\]")
_PW = re.compile(r"PW\[([^\]]*)\]")
_RE = re.compile(r"RE\[([^\]]*)\]")


def games_from_sgfs(text: str) -> list[tuple[str, str, str | None]]:
    """Parse KataGo's .sgfs output (one SGF per line) into (black, white, winner-or-None)."""
    out = []
    for line in text.splitlines():
        pb, pw, re_ = _PB.search(line), _PW.search(line), _RE.search(line)
        if not (pb and pw and re_):
            continue
        black, white, result = pb.group(1), pw.group(1), re_.group(1).strip().upper()
        if result.startswith("B+"):
            out.append((black, white, black))
        elif result.startswith("W+"):
            out.append((black, white, white))
        else:
            out.append((black, white, None))
    return out


def read_sgfs_dir(d: Path) -> list[tuple[str, str, str | None]]:
    games = []
    for f in sorted(d.glob("*.sgfs")):
        games.extend(games_from_sgfs(f.read_text(encoding="utf-8", errors="replace")))
    return games
