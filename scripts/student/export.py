"""Checkpoint -> .dopnet file (README.md), plus reference outputs for checking the runtime.

  python scripts/student/export.py --ckpt mind.pt --out public/student/dopnet.dopnet [--fixtures f.json --dpd sample.dpd]
  python scripts/student/export.py --random --out fixture.dopnet --fixtures fixture.json   (a random network, for tests)
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from model import DopNet, PLANES, POINTS, planes_from_bytes, self_komi, ternarize  # noqa: E402


def fold_bn(bn: torch.nn.BatchNorm2d):
    sd = (bn.running_var + bn.eps).sqrt()
    scale = bn.weight / sd
    shift = bn.bias - bn.running_mean * scale
    return scale.detach(), shift.detach()


def pack_t2(t: torch.Tensor) -> bytes:
    v = t.flatten().to(torch.int64).numpy()
    codes = np.where(v > 0, 1, np.where(v < 0, 3, 0)).astype(np.uint8)
    pad = (-len(codes)) % 4
    codes = np.concatenate([codes, np.zeros(pad, np.uint8)]).reshape(-1, 4)
    packed = codes[:, 0] | (codes[:, 1] << 2) | (codes[:, 2] << 4) | (codes[:, 3] << 6)
    return packed.astype(np.uint8).tobytes()


def tensors_of(net: DopNet) -> dict[str, tuple[str, torch.Tensor]]:
    """name -> (dtype, tensor) in the file's layout (README.md)."""
    out: dict[str, tuple[str, torch.Tensor]] = {}
    f = lambda t: ('f32', t.detach().float().contiguous())  # noqa: E731
    s, b = fold_bn(net.stem_bn)
    out['stem.w'] = f(net.stem.weight * s[:, None, None, None])
    out['stem.b'] = f(b)
    out['stem.komi'] = f(net.stem_komi)
    for i, blk in enumerate(net.blocks, start=1):
        for k, conv, bn in ((1, blk.conv1, blk.bn1), (2, blk.conv2, blk.bn2)):
            t, alpha = ternarize(conv.weight.detach())
            sc, sh = fold_bn(bn)
            out[f'block{i}.conv{k}'] = ('t2', t)
            out[f'block{i}.s{k}'] = f(alpha * sc)
            out[f'block{i}.b{k}'] = f(sh)
        if blk.gpool is not None:
            out[f'block{i}.gpool.w'] = f(blk.gpool.weight)
            out[f'block{i}.gpool.b'] = f(blk.gpool.bias)
    out['exit.policy.w'] = f(net.exit_policy.weight.flatten())
    out['exit.policy.b'] = f(net.exit_policy.bias)
    out['exit.pass.w'] = f(net.exit_pass.weight.flatten())
    out['exit.pass.b'] = f(net.exit_pass.bias)
    out['exit.v1.w'] = f(net.exit_v1.weight)
    out['exit.v1.b'] = f(net.exit_v1.bias)
    out['exit.v2.w'] = f(net.exit_v2.weight)
    out['exit.v2.b'] = f(net.exit_v2.bias)
    out['head.p1.w'] = f(net.p1.weight.flatten(1))
    out['head.p1.b'] = f(net.p1.bias)
    out['head.pg.w'] = f(net.pg.weight)
    out['head.p2.w'] = f(net.p2.weight.flatten())
    out['head.p2.b'] = f(net.p2.bias)
    out['head.pass.w'] = f(net.pass_.weight.flatten())
    out['head.pass.b'] = f(net.pass_.bias)
    out['head.v1.w'] = f(net.v1.weight)
    out['head.v1.b'] = f(net.v1.bias)
    out['head.v2.w'] = f(net.v2.weight)
    out['head.v2.b'] = f(net.v2.bias)
    out['head.own.w'] = f(net.own.weight.flatten())
    out['head.own.b'] = f(net.own.bias)
    return out


def write_dopnet(net: DopNet, path: Path, name: str, exit_threshold: float, meta: dict):
    blob = bytearray()
    index = {}
    for key, (dtype, t) in tensors_of(net).items():
        data = pack_t2(t) if dtype == 't2' else t.numpy().astype('<f4').tobytes()
        while len(blob) % 4:
            blob.append(0)
        index[key] = {'shape': list(t.shape), 'dtype': dtype, 'offset': len(blob), 'bytes': len(data)}
        blob += data
    header = {'format': 1, 'name': name, 'size': 19, 'planes': PLANES, **net.cfg, 'exitThreshold': exit_threshold, 'meta': meta, 'tensors': index}
    hb = json.dumps(header, separators=(',', ':')).encode()
    hb += b' ' * ((-len(hb)) % 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(b'DOPN' + struct.pack('<II', 1, len(hb)) + hb + bytes(blob))
    return len(hb) + len(blob) + 12


@torch.no_grad()
def reference(net: DopNet, boards: np.ndarray, to_play: np.ndarray, komi: np.ndarray) -> list[dict]:
    net.eval()
    planes = torch.from_numpy(planes_from_bytes(boards, to_play))
    sk = torch.from_numpy(self_komi(komi, to_play))
    out = net(planes, sk)
    res = []
    for i in range(len(boards)):
        res.append({
            'board': boards[i].tolist(),
            'toPlay': int(to_play[i]),
            'komi': float(komi[i]),
            'exitPolicy': [round(float(v), 5) for v in out['exit_policy'][i]],
            'exitValue': [round(float(v), 5) for v in out['exit_value'][i]],
            'policy': [round(float(v), 5) for v in out['policy'][i]],
            'value': [round(float(v), 5) for v in out['value'][i]],
            'own': [round(float(v), 5) for v in out['own'][i]],
        })
    return res


def random_boards(n: int, rng: np.random.Generator):
    boards = np.zeros((n, POINTS), np.uint8)
    for i in range(n):
        density = rng.uniform(0.05, 0.6)
        stone = np.where(rng.random(POINTS) < density, rng.integers(1, 3, POINTS), 0)
        libs = np.where(stone > 0, rng.integers(0, 4, POINTS), 0)
        b = stone | (libs << 2)
        empty = np.flatnonzero(stone == 0)
        if len(empty) and rng.random() < 0.5:
            b[rng.choice(empty)] |= 1 << 4
        stones = np.flatnonzero(stone > 0)
        for k, p in enumerate(rng.choice(stones, size=min(3, len(stones)), replace=False)):
            b[p] |= (k + 1) << 5
        boards[i] = b
    return boards, rng.integers(1, 3, n).astype(np.uint8), rng.choice([0.0, 6.5, 7.0, 7.5, -3.0], n).astype(np.float32)


def randomize(net: DopNet, seed: int):
    """Random batch-norm statistics and head weights, so a fixture exercises everything."""
    g = torch.Generator().manual_seed(seed)
    for m in net.modules():
        if isinstance(m, torch.nn.BatchNorm2d):
            m.running_mean.copy_(torch.randn(m.num_features, generator=g) * 0.3)
            m.running_var.copy_(torch.rand(m.num_features, generator=g) + 0.5)
            m.weight.data.copy_(torch.randn(m.num_features, generator=g) * 0.5 + 1)
            m.bias.data.copy_(torch.randn(m.num_features, generator=g) * 0.2)
    net.stem_komi.data.copy_(torch.randn(net.stem_komi.shape, generator=g) * 0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt')
    ap.add_argument('--random', action='store_true')
    ap.add_argument('--out', required=True)
    ap.add_argument('--name', default='dopnet')
    ap.add_argument('--exit-threshold', type=float, default=None)
    ap.add_argument('--fixtures')
    ap.add_argument('--dpd', help='take fixture positions from these records')
    ap.add_argument('--count', type=int, default=6)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    meta: dict = {}
    if a.random:
        torch.manual_seed(a.seed)
        net = DopNet()
        randomize(net, a.seed)
        thr = 0.05
    else:
        ck = torch.load(a.ckpt, map_location='cpu', weights_only=False)
        net = DopNet(**ck['args'])
        net.load_state_dict(ck['model'])
        meta = ck.get('meta', {})
        thr = ck.get('exit_threshold', 0.05)
    if a.exit_threshold is not None:
        thr = a.exit_threshold
    net.eval()
    n = write_dopnet(net, Path(a.out), a.name, thr, meta)
    print(f'wrote {a.out} ({n / 1024:.0f} KB)')
    if a.fixtures:
        rng = np.random.default_rng(a.seed)
        if a.dpd:
            sys.path.insert(0, str(Path(__file__).parent))
            from data import read_dpd
            rec = read_dpd(a.dpd)[: a.count]
            boards, tp, komi = rec['board'], rec['to_play'], rec['komi']
        else:
            boards, tp, komi = random_boards(a.count, rng)
        Path(a.fixtures).write_text(json.dumps({'net': Path(a.out).name, 'positions': reference(net, boards, tp, komi)}))
        print(f'wrote {a.fixtures}')


if __name__ == '__main__':
    main()
