"""KataGo's own training data -> `.dpd` teacher records (README.md).

KataGo's public run (katagoarchive.org/kata1, free to download) publishes every position its
self-play searched, with the search's visit counts, win rate, lead and the game's final
ownership: hundreds of millions of positions labelled by the strongest networks there are,
with a search of hundreds to thousands of visits. This turns them into the student's
training records, so the student learns from KataGo's best network without a single
position being labelled on our machines.

    curl -sL https://katagoarchive.org/kata1/trainingdata/<day>.tgz \
      | python3 scripts/student/kata_npz.py --tar - --max-rows 200000 --out labels-kata.dpd
    python3 scripts/student/kata_npz.py --npz a.npz b.npz --out labels.dpd

Only 19x19 rows with a real (full-search) policy target are kept. KataGo's inputs are
relative to the player to move, so records are written with Black to move (the student
only ever sees "own" and "opponent" stones) and komi turned round to match.
Field meanings: KataGo cpp/dataio/trainingwrite.h and cpp/neuralnet/nninputs.cpp (V7).
"""
from __future__ import annotations

import argparse
import io
import sys
import tarfile
import zipfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from dpd import DPD  # noqa: E402

POINTS = 361
# globalTargetsNC channels.
G_WIN, G_LOSS, G_NORESULT = 16, 17, 18  # the search's own win/loss/no result at this move
G_LEAD = 21
G_POLICY_W = 26
G_OWN_W = 27
G_LEAD_W = 29
G_KOMI = 47  # komi, from the point of view of the player to move
G_VISITS = 60


def convert(npz, rng: np.random.Generator, keep: float = 1.0) -> np.ndarray:
    """One npz (a loaded mapping) -> DPD records."""
    packed = npz['binaryInputNCHWPacked']  # [N, C, ceil(pos/8)] uint8
    gin = npz['globalInputNC']
    pol = npz['policyTargetsNCMove']  # [N, 2, pos+1] int16
    gt = npz['globalTargetsNC']
    vt = npz['valueTargetsNCHW']  # [N, 5, 19, 19] int8
    n = packed.shape[0]
    bits = np.unpackbits(packed, axis=2)[:, :, :POINTS]  # [N, C, 361]
    if bits.shape[2] < POINTS or pol.shape[2] != POINTS + 1:
        return np.zeros(0, DPD)  # a data file made for another board size
    on_board = bits[:, 0].sum(1) == POINTS
    has_policy = gt[:, G_POLICY_W] > 0
    ok = on_board & has_policy
    if keep < 1.0:
        ok &= rng.random(n) < keep
    idx = np.nonzero(ok)[0]
    if len(idx) == 0:
        return np.zeros(0, DPD)
    b = bits[idx].astype(np.uint8)
    out = np.zeros(len(idx), DPD)

    stone = b[:, 1] * 1 + b[:, 2] * 2  # own -> black (1), opponent -> white (2)
    libs = b[:, 3] * 1 + b[:, 4] * 2 + b[:, 5] * 3
    ko = b[:, 6]
    # History planes 9, 10, 11: the last move, the one before, the one before that.
    rec = np.zeros_like(stone)
    for k, plane in ((3, 11), (2, 10), (1, 9)):
        rec = np.where(b[:, plane] == 1, k, rec)
    out['board'] = (stone | (libs << 2) | (ko << 4) | (rec << 5)).astype(np.uint8)
    out['to_play'] = 1
    out['source'] = 4  # KataGo self-play (README.md)
    g = gt[idx].astype(np.float32)
    komi_self = g[:, G_KOMI] if gt.shape[1] > G_KOMI else gin[idx, 5].astype(np.float32) * 15.0
    out['komi'] = -komi_self  # Black to move: points for White = minus the mover's komi
    out['win'] = np.clip(g[:, G_WIN] + 0.5 * g[:, G_NORESULT], 0, 1)
    out['lead'] = np.where(g[:, G_LEAD_W] > 0, g[:, G_LEAD], 0.0)
    visits = g[:, G_VISITS] if gt.shape[1] > G_VISITS else np.full(len(idx), 400.0)
    out['visits'] = np.maximum(2, visits).astype(np.uint32)

    # Policy: the search's visit shares, top 24 moves (pass = 361).
    p = np.maximum(pol[idx, 0].astype(np.float32), 0)
    p /= np.maximum(p.sum(1, keepdims=True), 1e-6)
    top = np.argsort(-p, axis=1)[:, :24]
    share = np.take_along_axis(p, top, axis=1)
    loc = np.where(share > 0, top, 65535).astype(np.uint16)
    prob = np.where(share > 0, np.round(share * 65535), 65535).astype(np.uint16)
    out['pol'][:, :, 0] = loc
    out['pol'][:, :, 1] = prob

    own_w = g[:, G_OWN_W] > 0
    own = vt[idx, 0].reshape(len(idx), POINTS).astype(np.int16) * 127
    out['own'] = np.where(own_w[:, None], own, 0).astype(np.int8)
    out['has_own'] = own_w.astype(np.uint8)
    return out


def npz_members(tar_src):
    """Yield loaded npz mappings from a tar stream ('-' = stdin), stopping cleanly when it ends."""
    f = sys.stdin.buffer if tar_src == '-' else open(tar_src, 'rb')
    try:
        with tarfile.open(fileobj=f, mode='r|*') as tf:
            for m in tf:
                if not m.isfile() or not m.name.endswith('.npz'):
                    continue
                data = tf.extractfile(m).read()
                try:
                    yield m.name, np.load(io.BytesIO(data))
                except (zipfile.BadZipFile, ValueError, OSError) as e:
                    print(f'skipped {m.name}: {e}', file=sys.stderr)
    except (tarfile.ReadError, EOFError, OSError) as e:
        print(f'stream ended: {e}', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tar', help="a tar(.gz) of npz files, '-' for stdin")
    ap.add_argument('--npz', nargs='*', default=[])
    ap.add_argument('--max-rows', type=int, default=200000)
    ap.add_argument('--keep', type=float, default=0.25, help='share of each file kept (spreads the rows over more games)')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    sources = ((p, np.load(p)) for p in a.npz) if a.npz else npz_members(a.tar)
    total, files = 0, 0
    with open(a.out, 'wb') as out:
        for name, npz in sources:
            recs = convert(npz, rng, a.keep)
            recs = recs[: a.max_rows - total]
            recs.tofile(out)
            total += len(recs)
            files += 1
            if files % 20 == 0:
                print(f'{files} files, {total} records', file=sys.stderr, flush=True)
            if total >= a.max_rows:
                break
    print(f'{total} records from {files} files -> {a.out}', file=sys.stderr)
    if total == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
