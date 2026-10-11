"""The hivemind: a population of student networks trained side by side, the winner seeding
the next generation (population-based training, Jaderberg et al. 2017), with evolution
over the network's shape as well as its training settings.

  python scripts/student/population.py plan --population population.json --minds 7 --run 42
      -> JSON list of minds for the workflow's matrix:
         {id, lr, searchWeight, curriculum, kataShare, mutate, changed, seed}
  python scripts/student/population.py arena --population population.json --val val.dpd \
      --minds 'minds/*.pt' ['candidates/*.pt'] [--champion champion.pt] --out champion.pt --report arena.json

Each run every mind starts from the champion (when there is one): mind 0 with the
champion's own settings, the others with one or two settings mutated (learning rate,
weight on the teacher's search, how much hard positions are favoured, share of KataGo's
own self-play data). Mind 1 also grows one block deeper and mind 2 keeps three quarters of
the channels (model.py deepen/prune), so the network's size evolves too. The arena scores
every mind and the old champion on a fixed validation set (positions the training never
sees): policy loss plus win-rate error, plus a price for being slower than the champion
(fitness), so a smaller network that is as strong wins and a bigger one has to be clearly
stronger. The winner's settings and shape become the centre of the next generation, and
every mutation's result is logged in population.json ("mutations").
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

DEFAULT = {'lr': 1e-3, 'searchWeight': 2.0, 'curriculum': 0.5, 'kataShare': 0.5}
# Each setting's range (evolution never leaves it) and whether it is nudged by multiplying.
GENES = {
    'lr': (5e-5, 5e-3, True),
    'searchWeight': (0.5, 8.0, True),
    'curriculum': (0.0, 2.0, False),
    'kataShare': (0.0, 0.95, False),
}
# A twice as expensive network must earn this much lower score (fitness = strength and speed).
COST_WEIGHT = 0.04


def load_pop(path: str) -> dict:
    p = Path(path)
    if p.exists():
        return json.loads(p.read_text())
    return {'champion': None, 'settings': DEFAULT, 'generations': [], 'samples': 0, 'runs': 0}


def mutate_gene(name: str, value: float, rng: random.Random) -> float:
    lo, hi, mult = GENES[name]
    v = value * 2 ** rng.uniform(-1, 1) if mult else value + rng.uniform(-0.25, 0.25) * (hi - lo)
    v = min(hi, max(lo, v))
    return float(f'{v:.3g}')


def plan(a):
    """The minds of one generation: the champion's settings unchanged, then children with one
    or two settings mutated, one child one block deeper and one with a quarter fewer
    channels (shape mutations, model.py), the rest random mixes."""
    pop = load_pop(a.population)
    s = {**DEFAULT, **(pop.get('settings') or {})}
    shape = pop.get('shape') or {'c': 64, 'blocks': 6}
    rng = random.Random(a.run)
    minds = []
    for i in range(a.minds):
        genes = dict(s)
        changed = []
        mutate = ''
        if i == 1:
            mutate = 'deepen' if shape['blocks'] < 12 else ''
        elif i == 2:
            mutate = 'prune:0.75' if shape['c'] > 32 else ''
        if i > 0:
            for name in rng.sample(sorted(GENES), 1 if i < 4 else 2):
                genes[name] = mutate_gene(name, genes[name], rng)
                changed.append(name)
        minds.append({
            'id': i,
            'lr': genes['lr'],
            'searchWeight': genes['searchWeight'],
            'curriculum': genes['curriculum'],
            'kataShare': genes['kataShare'],
            'mutate': mutate,
            'changed': ','.join(changed + ([mutate] if mutate else [])),
            'seed': a.run * 100 + i,
        })
    print(json.dumps(minds))


def score(res: dict) -> float:
    """Lower is better: the policy's distance from the teacher plus the win-rate error."""
    return res['policyLoss'] + 4.0 * res['winError']


def fitness(res: dict, cost: float, champion_cost: float) -> float:
    """Score plus a price for being slower than the champion (a reward for being faster)."""
    return score(res) + COST_WEIGHT * math.log2(max(cost, 1.0) / max(champion_cost, 1.0))


def arena(a):
    # Only the arena needs PyTorch (the plan runs on a bare machine).
    import torch
    from data import read_dpd
    from model import DopNet, cost as net_cost
    from train import validate

    pop = load_pop(a.population)
    val = read_dpd(*sorted(glob.glob(a.val)))
    entrants = []
    for path in sorted({p for g in a.minds for p in glob.glob(g)}):
        ck = torch.load(path, map_location='cpu', weights_only=False)
        entrants.append((path, ck))
    if a.champion and Path(a.champion).exists():
        entrants.append(('champion', torch.load(a.champion, map_location='cpu', weights_only=False)))
    if not entrants:
        print('no minds to judge')
        return
    champ_ck = next((ck for name, ck in entrants if name == 'champion'), None)
    champ_cost = net_cost(champ_ck['args']['c'], champ_ck['args']['blocks']) if champ_ck else net_cost(64, 6)
    rows = []
    for name, ck in entrants:
        net = DopNet(**ck['args'])
        net.load_state_dict(ck['model'])
        res = validate(net, val)
        c = net_cost(ck['args']['c'], ck['args']['blocks'])
        fit = fitness(res, c, champ_cost)
        rows.append({'name': name, 'score': fit, 'strength': score(res), 'cost': c, 'shape': ck['args'],
                     'val': {k: v for k, v in res.items() if k != 'exitCurve'}, 'meta': ck.get('meta', {})})
        print(f'{name}: fitness {fit:.4f} (strength {score(res):.4f}, {ck["args"]["c"]}x{ck["args"]["blocks"]}) '
              f'top1 {res["top1"]:.3f} winError {res["winError"]:.4f} exit {res["exitRate"]:.0%}', flush=True)
    rows.sort(key=lambda r: r['score'])
    # What each mutation did, against the champion's own score this run.
    base = next((r['score'] for r in rows if r['name'] == 'champion'), None)
    if base is not None:
        log = pop.get('mutations') or []
        for r in rows:
            ch = r['meta'].get('changed')
            if r['name'] != 'champion' and ch:
                log.append({'run': a.run, 'changed': ch, 'gain': round(base - r['score'], 4), 'won': r is rows[0]})
        pop['mutations'] = log[-500:]
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
        pop['settings'] = {k: m.get(k, DEFAULT[k]) for k in DEFAULT}
        pop['shape'] = {'c': ck['args']['c'], 'blocks': ck['args']['blocks']}
        pop['champion'] = {'name': m.get('name'), 'score': best['score'], 'val': best['val']}
        pop['samples'] = m.get('samples', pop.get('samples', 0))
    pop['runs'] = pop.get('runs', 0) + 1
    pop['mindSamples'] = pop.get('mindSamples', 0) + max(0, trained)
    pop['generations'] = (pop.get('generations') or [])[-200:] + [{
        'run': a.run, 'winner': best['name'], 'changed': changed,
        'scores': [{'name': Path(r['name']).stem, 'score': round(r['score'], 4), 'strength': round(r['strength'], 4), 'shape': f"{r['shape']['c']}x{r['shape']['blocks']}",
                    'changed': r['meta'].get('changed', ''), 'top1': round(r['val']['top1'], 4), 'winError': round(r['val']['winError'], 4)} for r in rows],
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
    r.add_argument('--minds', nargs='+', required=True, help='checkpoint globs')
    r.add_argument('--champion')
    r.add_argument('--out', required=True)
    r.add_argument('--report', default='arena.json')
    r.add_argument('--run', type=int, default=0)
    a = ap.parse_args()
    plan(a) if a.cmd == 'plan' else arena(a)


if __name__ == '__main__':
    main()
