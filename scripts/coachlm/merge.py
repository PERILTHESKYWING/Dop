"""Weighted merging of LoRA adapters, done on the adapter files (no base model, no GPU).

Why this method: every member is a LoRA delta (dW = scale * B @ A) on the same base, all
descended from the same lineage and trained on the same job, so the right "average" is the
average of the deltas themselves (a model soup in delta space):

    dW_hive = sum_i w_i * dW_i,   w_i proportional to fitness, sum w_i = 1

then re-factored to a fixed rank with the best possible rank-r approximation (truncated SVD).
This is peft's add_weighted_adapter(combination_type="svd") idea, which is "linear" merging
done on the full deltas. We do not use peft's plain "linear" (it averages A and B separately,
which adds meaningless cross terms B_i A_j and needs equal ranks) or TIES (its sign election
is for merging different tasks; our members are siblings on one task, and on factored A/B it
is not exact either). Ranks are a gene, so members differ in rank; this handles that too.

Fast: the stacked factors are low rank, so the SVD runs on an R x R core (R = sum of ranks)
after two thin QRs, never on the full out x in matrix. Exact up to float rounding.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

A_SUFFIX, B_SUFFIX = '.lora_A.weight', '.lora_B.weight'
WEIGHTS = 'adapter_model.safetensors'
CONFIG = 'adapter_config.json'


def lora_scale(cfg: dict) -> float:
    r = cfg['r']
    alpha = cfg.get('lora_alpha', r)
    return alpha / (r ** 0.5) if cfg.get('use_rslora') else alpha / r


def combine(factors: list[tuple[np.ndarray, np.ndarray, float]], weights: list[float], rank: int) -> tuple[np.ndarray, np.ndarray]:
    """factors: [(A (r_i, in), B (out, r_i), scale_i)]. Returns (A', B') of rank `rank` with
    B' @ A' = best rank-`rank` approximation of sum_i w_i * scale_i * B_i @ A_i."""
    a_cat = np.concatenate([np.asarray(a, dtype=np.float64) for a, _b, _s in factors], axis=0)
    b_cat = np.concatenate([np.asarray(b, dtype=np.float64) * (w * s) for (_a, b, s), w in zip(factors, weights)], axis=1)
    qb, rb = np.linalg.qr(b_cat)              # (out, R), (R, R)
    qa, ra = np.linalg.qr(a_cat.T)            # (in, R), (R, R)
    u, sv, vt = np.linalg.svd(rb @ ra.T)      # core (R, R)
    r = min(rank, len(sv))
    root = np.sqrt(np.maximum(sv[:r], 0))
    b_new = (qb @ u[:, :r]) * root            # (out, r)
    a_new = root[:, None] * (vt[:r] @ qa.T)   # (r, in)
    if r < rank:                              # keep one rank for the whole adapter
        a_new = np.concatenate([a_new, np.zeros((rank - r, a_new.shape[1]))], axis=0)
        b_new = np.concatenate([b_new, np.zeros((b_new.shape[0], rank - r))], axis=1)
    return a_new.astype(np.float32), b_new.astype(np.float32)


def _load_tensors(path: Path) -> dict[str, np.ndarray]:
    try:
        from safetensors.torch import load_file
        return {k: v.float().cpu().numpy() for k, v in load_file(str(path)).items()}
    except ImportError:
        from safetensors.numpy import load_file
        return {k: v.astype(np.float32) for k, v in load_file(str(path)).items()}


def load_adapter(d: Path) -> tuple[dict, dict[str, tuple[np.ndarray, np.ndarray]]]:
    d = Path(d)
    cfg = json.loads((d / CONFIG).read_text(encoding='utf-8'))
    if cfg.get('rank_pattern') or cfg.get('alpha_pattern'):
        raise ValueError(f'{d}: per-module ranks are not supported')
    t = _load_tensors(d / WEIGHTS)
    mods = {}
    for k, a in t.items():
        if k.endswith(A_SUFFIX):
            m = k[: -len(A_SUFFIX)]
            b = t.get(m + B_SUFFIX)
            if b is not None:
                mods[m] = (a, b)
    return cfg, mods


def save_adapter(d: Path, cfg: dict, mods: dict[str, tuple[np.ndarray, np.ndarray]]) -> None:
    from safetensors.numpy import save_file
    d = Path(d)
    d.mkdir(parents=True, exist_ok=True)
    tensors = {}
    for m, (a, b) in mods.items():
        tensors[m + A_SUFFIX] = np.ascontiguousarray(a, dtype=np.float32)
        tensors[m + B_SUFFIX] = np.ascontiguousarray(b, dtype=np.float32)
    save_file(tensors, str(d / WEIGHTS), metadata={'format': 'pt'})
    (d / CONFIG).write_text(json.dumps(cfg, indent=1), encoding='utf-8')


def fold(dirs: list[Path], weights: list[float], rank: int, out: Path) -> None:
    """Write the weighted delta-average of the adapters in `dirs` to `out` as a rank-`rank`
    adapter with scale 1 (lora_alpha = r). Weights are normalised to sum to 1."""
    if not dirs or len(dirs) != len(weights):
        raise ValueError('need one weight per adapter')
    total = float(sum(weights))
    if total <= 0:
        raise ValueError('weights must add up to more than 0')
    weights = [w / total for w in weights]
    loaded = [load_adapter(d) for d in dirs]
    names = sorted(set().union(*(m.keys() for _c, m in loaded)))
    mods = {}
    for name in names:
        factors, ws = [], []
        for (cfg, m), w in zip(loaded, weights):
            if name in m:
                a, b = m[name]
                factors.append((a, b, lora_scale(cfg)))
                ws.append(w)
        mods[name] = combine(factors, ws, rank)
    cfg = dict(loaded[0][0])
    targets = set()
    for c, _m in loaded:
        t = c.get('target_modules') or []
        targets |= set([t] if isinstance(t, str) else t)
    cfg.update({'r': rank, 'lora_alpha': rank, 'use_rslora': False, 'rank_pattern': {}, 'alpha_pattern': {},
                'target_modules': sorted(targets)})
    save_adapter(out, cfg, mods)


def hive_weights(hive_mass: float, fitness: float) -> tuple[float, float]:
    """Weights for folding one member into the hive: the hive keeps everything folded so far
    in proportion to its accumulated fitness mass."""
    f = max(1e-3, fitness)
    total = hive_mass + f
    return hive_mass / total, f / total
