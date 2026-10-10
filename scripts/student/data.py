"""Reading `.dpd` teacher records (README.md) into training batches."""
from __future__ import annotations

import numpy as np
import torch

from model import POINTS, SYM, planes_from_bytes, self_komi

DPD = np.dtype([
    ('board', 'u1', (361,)),
    ('to_play', 'u1'),
    ('source', 'u1'),
    ('pad', 'u1'),
    ('komi', '<f4'),
    ('win', '<f4'),
    ('lead', '<f4'),
    ('visits', '<u4'),
    ('pol', '<u2', (24, 2)),
    ('own', 'i1', (361,)),
    ('has_own', 'u1'),
    ('pad2', 'u1', (2,)),
])
assert DPD.itemsize == 840


def read_dpd(*paths: str) -> np.ndarray:
    parts = [np.fromfile(p, dtype=DPD) for p in paths]
    return np.concatenate(parts) if parts else np.zeros(0, DPD)


def batch(rec: np.ndarray, augment: bool, rng: np.random.Generator) -> dict[str, torch.Tensor]:
    """Records -> tensors, each under a random board symmetry when augment is set."""
    n = len(rec)
    board = rec['board'].copy()
    own = rec['own'].astype(np.float32) / 127.0
    pol = np.zeros((n, POINTS + 1), np.float32)
    loc = rec['pol'][:, :, 0].astype(np.int64)
    p = rec['pol'][:, :, 1].astype(np.float32) / 65535.0
    valid = loc != 65535
    rows = np.repeat(np.arange(n)[:, None], 24, axis=1)
    if augment:
        syms = rng.integers(0, 8, n)
        for s in range(1, 8):
            m = syms == s
            if not m.any():
                continue
            perm = SYM[s]  # point -> point under the symmetry
            nb = np.empty_like(board[m])
            nb[:, perm] = board[m]
            board[m] = nb
            no = np.empty_like(own[m])
            no[:, perm] = own[m]
            own[m] = no
            l = loc[m]
            onb = valid[m] & (l < POINTS)
            l2 = l.copy()
            l2[onb] = perm[l[onb]]
            loc[m] = l2
    np.add.at(pol, (rows[valid], loc[valid]), p[valid])
    pol /= np.maximum(pol.sum(axis=1, keepdims=True), 1e-6)
    return {
        'planes': torch.from_numpy(planes_from_bytes(board, rec['to_play'])),
        'komi': torch.from_numpy(self_komi(rec['komi'], rec['to_play'])),
        'policy': torch.from_numpy(pol),
        'win': torch.from_numpy(np.clip(rec['win'], 0, 1).astype(np.float32)),
        'lead': torch.from_numpy(rec['lead'].astype(np.float32)),
        'own': torch.from_numpy(own),
        'has_own': torch.from_numpy(rec['has_own'].astype(np.float32)),
        'search': torch.from_numpy((rec['visits'] > 1).astype(np.float32)),
    }
