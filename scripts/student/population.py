"""The hivemind: a population of student networks trained side by side, the winner seeding
the next generation (population-based training, Jaderberg et al. 2017).

  python scripts/student/population.py plan --population population.json --minds 7 --run 42
      -> JSON list of minds for the workflow's matrix: {id, lr, searchWeight, seed}
  python scripts/student/population.py arena --population population.json --val val.dpd \
      --minds 'minds/*.pt' [--champion champion.pt] --out champion.pt --report arena.json

Each run every mind starts from the champion (when there is one) with its own learning
rate, weight on the teacher's search results and seed: the champion's own settings, and
nudges up and down from them. The arena scores every mind and the old champion on a fixed
validation set (positions the training never sees) and keeps the best; its settings become
the centre of the next generation.
"""
from __future__ import annotations

import argparse
import glob
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

DEFAULT = {'lr': 1e-3, 'searchWeight': 2.0}


def load_pop(path: str) -> dict:
    p = Path(path)
    if p.exists():
        return json.loads(p.read_text())
    return {'champion': None, 'settings': DEFAULT, 'generations': [], 'samples': 0, 'runs': 0}


def plan(a):
    pop = load_pop(a.population)
    s = pop.get('settings') or DEFAULT
    lr, sw = s['lr'], s['searchWeight']
    rng = random.Random(a.run)
    nudges = [(1, 1), (2, 1), (0.5, 1), (1, 2), (1, 0.5), (1.5, 1.5), (0.7, 1.4), (1.4, 0.7)]
    minds = []
    for i in range(a.minds):
        if i < len(nudges):
            fl, fs = nudges[i]
        else:
            fl, fs = 2 ** rng.uniform(-1, 1), 2 ** rng.uniform(-1, 1)
        minds.append({
            'id': i,
            'lr': float(f'{min(5e-3, max(5e-5, lr * fl)):.2e}'),
            'searchWeight': round(min(8.0, max(0.5, sw * fs)), 2),
            'seed': a.run * 100 + i,
        })
    print(json.dumps(minds))


def score(res: dict) -> float:
    """Lower is better: the policy's distance from the teacher plus the win-rate error."""
    return res['policyLoss'] + 4.0 * res['winError']


def arena(a):
    # Only the arena needs PyTorch (the plan runs on a bare machine).
    import torch
    from data import read_dpd
    from model import DopNet
    from train import validate

    pop = load_pop(a.population)
    val = read_dpd(*sorted(glob.glob(a.val)))
    entrants = []
    for path in sorted(glob.glob(a.minds)):
        ck = torch.load(path, map_location='cpu', weights_only=False)
        entrants.append((path, ck))
    if a.champion and Path(a.champion).exists():
        entrants.append(('champion', torch.load(a.champion, map_location='cpu', weights_only=False)))
    if not entrants:
        print('no minds to judge')
        return
    rows = []
    for name, ck in entrants:
        net = DopNet(**ck['args'])
        net.load_state_dict(ck['model'])
        res = validate(net, val)
        rows.append({'name': name, 'score': score(res), 'val': {k: v for k, v in res.items() if k != 'exitCurve'}, 'meta': ck.get('meta', {})})
        print(f'{name}: score {score(res):.4f} top1 {res["top1"]:.3f} winError {res["winError"]:.4f} exit {res["exitRate"]:.0%}', flush=True)
    rows.sort(key=lambda r: r['score'])
    best = rows[0]
    changed = best['name'] != 'champion'
    trained = sum(r['meta'].get('samples', 0) - pop.get('samples', 0) for r in rows if r['name'] != 'champion' and r['meta'].get('samples', 0) > pop.get('samples', 0))
    if changed:
        ck = next(ck for name, ck in entrants if name == best['name'])
        # Its validation numbers on the common set, and the exit threshold from it.
        ck.setdefault('meta', {})['arena'] = best['val']
        ck['exit_threshold'] = best['val']['exitThreshold']
        torch.save(ck, a.out)
        m = best['meta']
        pop['settings'] = {'lr': m.get('lr', DEFAULT['lr']), 'searchWeight': m.get('searchWeight', DEFAULT['searchWeight'])}
        pop['champion'] = {'name': m.get('name'), 'score': best['score'], 'val': best['val']}
        pop['samples'] = m.get('samples', pop.get('samples', 0))
    pop['runs'] = pop.get('runs', 0) + 1
    pop['mindSamples'] = pop.get('mindSamples', 0) + max(0, trained)
    pop['generations'] = (pop.get('generations') or [])[-200:] + [{
        'run': a.run, 'winner': best['name'], 'changed': changed,
        'scores': [{'name': Path(r['name']).stem, 'score': round(r['score'], 4), 'top1': round(r['val']['top1'], 4), 'winError': round(r['val']['winError'], 4)} for r in rows],
    }]
    Path(a.population).write_text(json.dumps(pop, indent=1))
    Path(a.report).write_text(json.dumps({'changed': changed, 'best': best, 'rows': rows}, indent=1, default=str))
    print(f'champion {"replaced by " + best["name"] if changed else "kept"}')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--population', required=True)
    p.add_argument('--minds', type=int, default=7)
    p.add_argument('--run', type=int, default=0)
    r = sub.add_parser('arena')
    r.add_argument('--population', required=True)
    r.add_argument('--val', required=True)
    r.add_argument('--minds', required=True)
    r.add_argument('--champion')
    r.add_argument('--out', required=True)
    r.add_argument('--report', default='arena.json')
    r.add_argument('--run', type=int, default=0)
    a = ap.parse_args()
    plan(a) if a.cmd == 'plan' else arena(a)


if __name__ == '__main__':
    main()
