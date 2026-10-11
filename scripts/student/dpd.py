"""The `.dpd` record layout (README.md), with numpy only (no PyTorch needed to write records)."""
import numpy as np

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
