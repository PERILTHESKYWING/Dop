import json

import numpy as np
import pytest

pytest.importorskip('safetensors')

from conftest import write_fake_adapter  # noqa: E402
from merge import combine, fold, hive_weights, load_adapter, lora_scale  # noqa: E402


def rnd(seed, *shape):
    return np.random.default_rng(seed).normal(size=shape)


def test_combine_is_exact_when_rank_is_enough():
    f = [(rnd(1, 2, 5), rnd(2, 6, 2), 1.0), (rnd(3, 3, 5), rnd(4, 6, 3), 0.5)]
    w = [0.7, 0.3]
    a, b = combine(f, w, rank=5)
    want = 0.7 * 1.0 * f[0][1] @ f[0][0] + 0.3 * 0.5 * f[1][1] @ f[1][0]
    assert a.shape == (5, 5) and b.shape == (6, 5)
    assert np.allclose(b @ a, want, atol=1e-5)


def test_combine_truncates_to_best_rank_r():
    f = [(rnd(5, 4, 7), rnd(6, 8, 4), 1.0), (rnd(7, 4, 7), rnd(8, 8, 4), 1.0)]
    a, b = combine(f, [0.5, 0.5], rank=3)
    full = 0.5 * (f[0][1] @ f[0][0] + f[1][1] @ f[1][0])
    u, s, vt = np.linalg.svd(full)
    best = (u[:, :3] * s[:3]) @ vt[:3]                      # Eckart-Young optimum
    assert np.allclose(b @ a, best, atol=1e-4)
    assert np.allclose(np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=0), atol=1e-4)  # balanced split


def test_combine_pads_when_rank_exceeds():
    a, b = combine([(rnd(1, 1, 3), rnd(2, 2, 1), 1.0)], [1.0], rank=4)
    assert a.shape == (4, 3) and b.shape == (2, 4) and np.allclose(a[2:], 0)


def test_fold_files_mixed_ranks_and_scales(tmp_path):
    write_fake_adapter(tmp_path / 'a', rank=2, seed=1)
    write_fake_adapter(tmp_path / 'b', rank=4, seed=2)
    cfg_b = json.loads((tmp_path / 'b' / 'adapter_config.json').read_text())
    cfg_b['lora_alpha'] = 8                                  # scale 2
    (tmp_path / 'b' / 'adapter_config.json').write_text(json.dumps(cfg_b))
    fold([tmp_path / 'a', tmp_path / 'b'], [3.0, 1.0], rank=6, out=tmp_path / 'm')   # weights normalised to .75/.25
    ca, ma = load_adapter(tmp_path / 'a')
    cb, mb = load_adapter(tmp_path / 'b')
    cm, mm = load_adapter(tmp_path / 'm')
    assert cm['r'] == 6 and cm['lora_alpha'] == 6 and lora_scale(cm) == 1.0
    for name in mm:
        want = 0.75 * lora_scale(ca) * ma[name][1] @ ma[name][0] + 0.25 * lora_scale(cb) * mb[name][1] @ mb[name][0]
        assert np.allclose(mm[name][1] @ mm[name][0], want, atol=1e-4)


def test_resize_keeps_the_delta(tmp_path):
    write_fake_adapter(tmp_path / 'a', rank=3, seed=4)
    fold([tmp_path / 'a'], [1.0], rank=8, out=tmp_path / 'up')
    _c, ma = load_adapter(tmp_path / 'a')
    _c, mu = load_adapter(tmp_path / 'up')
    for name in ma:
        assert np.allclose(mu[name][1] @ mu[name][0], ma[name][1] @ ma[name][0], atol=1e-4)


def test_hive_weights_are_fitness_proportional():
    assert hive_weights(0.0, 1.0) == (0.0, 1.0)
    wh, wm = hive_weights(3.0, 1.0)
    assert (wh, wm) == (0.75, 0.25)
    wh2, wm2 = hive_weights(3.0, 2.0)
    assert wm2 > wm and abs(wh2 + wm2 - 1) < 1e-12
    assert hive_weights(1.0, 0.0)[1] > 0                     # a zero-fitness member still leaves a trace


def test_fold_rejects_bad_weights(tmp_path):
    write_fake_adapter(tmp_path / 'a', rank=2, seed=1)
    with pytest.raises(ValueError):
        fold([tmp_path / 'a'], [0.0], 2, tmp_path / 'x')
    with pytest.raises(ValueError):
        fold([tmp_path / 'a'], [1.0, 1.0], 2, tmp_path / 'x')
