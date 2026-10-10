"""Train the student network on teacher records (`.dpd`).

  python scripts/student/train.py --data 'labels/*.dpd' --out mind.pt [--init champion.pt]
      [--minutes 300] [--lr 1e-3] [--batch 256] [--search-weight 2] [--seed 1] [--threads 4]

Distillation: the student's policy, win rate, lead and ownership follow the teacher's
(cross-entropy to the teacher's policy or search visit shares, binary cross-entropy to its
win rate). Records from the teacher's search count `--search-weight` times. The early-exit
heads learn the same targets plus an error output: how far their own answer is from the
teacher's, which the runtime uses to decide when the exit's answer is good enough.

Writes the checkpoint with validation numbers and a calibrated exit threshold.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from model import DopNet, TernaryConv3x3  # noqa: E402
from data import batch, read_dpd  # noqa: E402


def losses(out, b, search_weight: float):
    w = 1.0 + (search_weight - 1.0) * b['search']
    w = w / w.mean()
    lp = -(b['policy'] * F.log_softmax(out['policy'], dim=1)).sum(1)
    lv = F.binary_cross_entropy_with_logits(out['value'][:, 0], b['win'], reduction='none')
    ll = F.huber_loss(out['value'][:, 1], b['lead'] / 20, delta=0.5, reduction='none')
    lo = (F.binary_cross_entropy_with_logits(2 * out['own'], (b['own'] + 1) / 2, reduction='none').mean(1) * b['has_own'])
    ep = out['exit_policy']
    elp = -(b['policy'] * F.log_softmax(ep, dim=1)).sum(1)
    elv = F.binary_cross_entropy_with_logits(out['exit_value'][:, 0], b['win'], reduction='none')
    ell = F.huber_loss(out['exit_value'][:, 1], b['lead'] / 20, delta=0.5, reduction='none')
    with torch.no_grad():
        overlap = torch.minimum(F.softmax(ep, dim=1), b['policy']).sum(1)
        err = ((torch.sigmoid(out['exit_value'][:, 0]) - b['win']).abs() + 0.5 * (1 - overlap)).clamp(0, 1)
    le = F.binary_cross_entropy_with_logits(out['exit_value'][:, 2], err, reduction='none')
    total = (lp + 1.5 * lv + 0.5 * ll + 0.5 * lo + 0.7 * elp + 1.0 * elv + 0.3 * ell + 0.5 * le) * w
    return total.mean(), {'policy': lp.mean().item(), 'value': lv.mean().item(), 'exit_policy': elp.mean().item(), 'exit_value': elv.mean().item()}


@torch.no_grad()
def validate(net: DopNet, val: np.ndarray, bs: int = 512):
    """Top-1 agreement with the teacher, win-rate error, for the final and the exit heads,
    and the exit rate and combined numbers at a range of thresholds."""
    net.eval()
    rng = np.random.default_rng(0)
    rows = []
    for i in range(0, len(val), bs):
        b = batch(val[i:i + bs], False, rng)
        out = net(b['planes'], b['komi'])
        best = b['policy'].argmax(1)
        rows.append(torch.stack([
            (out['policy'].argmax(1) == best).float(),
            (out['exit_policy'].argmax(1) == best).float(),
            (torch.sigmoid(out['value'][:, 0]) - b['win']).abs(),
            (torch.sigmoid(out['exit_value'][:, 0]) - b['win']).abs(),
            torch.sigmoid(out['exit_value'][:, 2]),
            -(b['policy'] * F.log_softmax(out['policy'], dim=1)).sum(1),
        ], dim=1))
    m = torch.cat(rows).numpy()
    res = {
        'positions': int(len(m)),
        'top1': float(m[:, 0].mean()),
        'exitTop1': float(m[:, 1].mean()),
        'winError': float(m[:, 2].mean()),
        'exitWinError': float(m[:, 3].mean()),
        'policyLoss': float(m[:, 5].mean()),
    }
    # Exit threshold: the largest that keeps the combined answers within 1 point of top-1
    # agreement and 5% of win-rate error of the full network.
    best_thr, curve = 0.0, []
    for thr in [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3]:
        ex = m[:, 4] < thr
        top1 = np.where(ex, m[:, 1], m[:, 0]).mean()
        werr = np.where(ex, m[:, 3], m[:, 2]).mean()
        curve.append({'threshold': thr, 'exitRate': float(ex.mean()), 'top1': float(top1), 'winError': float(werr)})
        if top1 >= res['top1'] - 0.01 and werr <= res['winError'] * 1.05:
            best_thr = thr
    res['exitThreshold'] = best_thr
    res['exitRate'] = next((c['exitRate'] for c in curve if c['threshold'] == best_thr), 0.0)
    res['exitCurve'] = curve
    net.train()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', nargs='+', required=True, help='.dpd files or globs')
    ap.add_argument('--val-data', nargs='*', default=[], help='a fixed validation set (else 2% held out)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--init', help='start from this checkpoint (same shape)')
    ap.add_argument('--minutes', type=float, default=30)
    ap.add_argument('--max-steps', type=int, default=0)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--wd', type=float, default=1e-4)
    ap.add_argument('--search-weight', type=float, default=2.0)
    ap.add_argument('--channels', type=int, default=64)
    ap.add_argument('--blocks', type=int, default=6)
    ap.add_argument('--exit-block', type=int, default=3)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--threads', type=int, default=0)
    ap.add_argument('--name', default='mind')
    a = ap.parse_args()
    if a.threads:
        torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    rng = np.random.default_rng(a.seed)

    files = sorted({f for pat in a.data for f in glob.glob(pat)})
    recs = read_dpd(*files)
    if a.val_data:
        val = read_dpd(*sorted({f for pat in a.val_data for f in glob.glob(pat)}))
        train = recs
    else:
        idx = rng.permutation(len(recs))
        nval = max(256, len(recs) // 50)
        val, train = recs[idx[:nval]], recs[idx[nval:]]
    print(f'{len(files)} files, {len(train)} training records ({(train["visits"] > 1).mean():.0%} from search), {len(val)} validation', flush=True)

    args = dict(c=a.channels, blocks=a.blocks, exit_block=a.exit_block)
    net = DopNet(**args)
    meta_before = {}
    if a.init and Path(a.init).exists():
        ck = torch.load(a.init, map_location='cpu', weights_only=False)
        if ck['args'] == args:
            net.load_state_dict(ck['model'])
            meta_before = ck.get('meta', {})
            print(f'from {a.init} ({meta_before.get("samples", 0)} samples seen)', flush=True)
        else:
            print(f'{a.init} has another shape; starting fresh', flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd)
    # A fresh network learns with float weights for the first part, then ternary
    # (quantisation-aware training from a float start converges far better).
    fresh = not meta_before
    float_until = 0.3 if fresh else 0.0

    def set_quant(q: bool):
        for m in net.modules():
            if isinstance(m, TernaryConv3x3):
                m.quant = q

    set_quant(not fresh)

    t0 = time.time()
    budget = a.minutes * 60
    step, seen = 0, 0
    est_steps = None
    log = []
    net.train()
    while True:
        elapsed = time.time() - t0
        if elapsed > budget or (a.max_steps and step >= a.max_steps):
            break
        if step == 30:
            est_steps = int(budget / (elapsed / 30)) if not a.max_steps else a.max_steps
        frac = step / est_steps if est_steps else 0.0
        if fresh and frac >= float_until and est_steps:
            set_quant(True)
            fresh = False
            print(f'step {step}: ternary weights from here on', flush=True)
        lr = a.lr * (min(1.0, (step + 1) / 200)) * (0.5 * (1 + math.cos(math.pi * min(1.0, frac))) * 0.95 + 0.05)
        for g in opt.param_groups:
            g['lr'] = lr
        pick = rng.integers(0, len(train), a.batch)
        b = batch(train[pick], True, rng)
        out = net(b['planes'], b['komi'])
        loss, parts = losses(out, b, a.search_weight)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
        opt.step()
        step += 1
        seen += a.batch
        if step % 200 == 0:
            print(f'step {step} ({elapsed / 60:.1f} min) loss {loss.item():.3f} ' + ' '.join(f'{k} {v:.3f}' for k, v in parts.items()), flush=True)
            log.append({'step': step, 'loss': loss.item(), **parts})

    set_quant(True)
    res = validate(net, val)
    print(json.dumps({k: v for k, v in res.items() if k != 'exitCurve'}), flush=True)
    meta = {
        'name': a.name,
        'samples': meta_before.get('samples', 0) + seen,
        'records': int(len(train)),
        'searchShare': float((train['visits'] > 1).mean()),
        'minutes': round((time.time() - t0) / 60, 1),
        'lr': a.lr,
        'searchWeight': a.search_weight,
        'seed': a.seed,
        'val': res,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({'args': args, 'model': net.state_dict(), 'meta': meta, 'exit_threshold': res['exitThreshold']}, a.out)
    Path(a.out).with_suffix('.json').write_text(json.dumps(meta, indent=1))
    print(f'saved {a.out}', flush=True)


if __name__ == '__main__':
    main()
