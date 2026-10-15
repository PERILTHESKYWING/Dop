import random

from config import GENES, default_genes
from evolve import beats, eval_fitness, fitness_scalar, mutate, rank_key, rank_members, render_chart


def fit(truth_rate, quality, judge=None):
    return {'truthRate': truth_rate, 'quality': quality, 'judge': judge, 'coverage': quality, 'depth': quality}


def test_mutate_stays_in_range_and_changes_little():
    rng = random.Random(3)
    g = default_genes()
    for _ in range(300):
        new, changed = mutate(g, rng)
        assert 1 <= len(changed) <= 2
        for k, (low, high, how, _d) in GENES.items():
            if how == 'choice':
                assert new[k] in low
            else:
                assert low <= new[k] <= high
        assert all(new[k] == g[k] for k in GENES if k not in changed)
        g = new


def test_mutate_rank_moves_to_a_neighbour():
    rng = random.Random(1)
    new, _ = mutate({**default_genes(), 'rank': 16}, rng, n=6)
    assert new['rank'] in (8, 32)


def test_truth_gate_comes_first():
    gate = 0.95
    honest_plain = fit(1.0, 0.2)
    eloquent_liar = fit(0.9, 0.99)
    assert rank_key(honest_plain, False, gate) > rank_key(eloquent_liar, False, gate)
    assert rank_key(fit(0.9, 0.1), False, gate) > rank_key(fit(0.5, 0.9), False, gate)  # below the gate: truth decides
    assert rank_key(None, False, gate) < rank_key(fit(0.0, 0.0), False, gate)


def test_judge_only_orders_within_the_gate():
    gate = 0.95
    a, b = fit(1.0, 0.50, judge=0.9), fit(1.0, 0.55, judge=0.1)
    assert rank_key(a, True, gate) > rank_key(b, True, gate)       # judge tips it
    assert rank_key(a, False, gate) < rank_key(b, False, gate)     # without the judge, quality decides


def test_champion_no_regression():
    gate = 0.95
    champ = fit(1.0, 0.5)
    assert beats(fit(1.0, 0.6), champ, False, gate)
    assert not beats(fit(1.0, 0.5), champ, False, gate)           # a tie is not a win
    assert not beats(fit(0.97, 0.9), champ, False, gate)          # better words, worse truth: rejected
    assert not beats(fit(1.0, 0.4), champ, False, gate)
    assert beats(fit(0.5, 0.1), None, False, gate)                # first champion
    weak = fit(0.6, 0.0)
    assert beats(fit(0.7, 0.0), weak, False, gate) and not beats(fit(0.55, 0.9), weak, False, gate)


def test_rank_members_and_scalar():
    members = {'m1': {'fit': fit(1.0, 0.3), 'born': 1}, 'm2': {'fit': fit(0.5, 0.9), 'born': 1},
               'm3': {'fit': fit(1.0, 0.7), 'born': 2}, 'm4': {'fit': None, 'born': 2}}
    assert rank_members(members, False, 0.95) == ['m3', 'm1', 'm2', 'm4']
    assert fitness_scalar(members['m3']['fit'], False, 0.95) > fitness_scalar(members['m2']['fit'], False, 0.95)


def test_eval_fitness_counts_unchecked_as_fail():
    s_ok = {'truth': 1.0, 'pass': True, 'coverage': 0.8, 'depth': 0.4}
    s_bad = {'truth': 0.5, 'pass': False, 'coverage': 0.9, 'depth': 0.9}
    f = eval_fitness([s_ok, s_bad, None, s_ok], [0.5, 0.7])
    assert f['n'] == 4 and f['pass'] == 2 and f['truthRate'] == 0.5
    assert f['coverage'] == 0.4                                     # only passing answers count
    assert f['judge'] == 0.6


def test_chart_renders():
    rows = [{'generation': 1, 'champion': {'fit': fit(1.0, 0.5)}, 'championChanged': True, 'pool': {'good': 3, 'pair': 1},
             'trainPass': 0.8}]
    text = render_chart(rows)
    assert '1*' in text and '#' * 20 in text and '3/1' in text
