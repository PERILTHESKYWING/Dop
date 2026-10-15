import random

from conftest import make_task
from selfplay import hardest, loc_to_gtp, make_requests, pass_rate, sample_tasks, task_moves, update_stats


def test_loc_to_gtp_matches_the_site():
    assert loc_to_gtp(0, 19) == 'A19'            # y = 0 is the top row
    assert loc_to_gtp(18, 19) == 'T19'           # no I column
    assert loc_to_gtp(8, 19) == 'J19'
    assert loc_to_gtp(18 * 19, 19) == 'A1'
    assert loc_to_gtp(-1, 19) is None and loc_to_gtp(361, 19) is None


def test_moves_from_explanation_and_prompt():
    assert task_moves(make_task(1)) == [('Q16', 'best'), ('D4', 'refutation')]
    t = {'prompt': 'Variations:\n- [[v1]] Best: the corner (best, loses 0 pts): B R16, W Q17\n'
                   '- [[v2]] Slow (alternative, loses 4.5 pts): B D4, W C3'}
    assert task_moves(t) == [('R16', 'best'), ('D4', 'alternative')]


def test_requests_ask_new_questions_once():
    tasks = {'train-001': make_task(1), 'train-002': make_task(2)}
    asked = set()
    first = make_requests(tasks, ['train-001', 'missing'], asked)
    assert first == [
        {'taskId': 'train-001', 'question': {'kind': 'why-move', 'move': 'Q16', 'text': 'Why is Q16 the right move here?'}},
        {'taskId': 'train-001', 'question': {'kind': 'why-not', 'move': 'D4', 'text': 'Why not D4?'}},
    ]
    assert make_requests(tasks, ['train-001'], asked) == []      # nothing asked twice
    assert len(make_requests(tasks, ['train-002'], asked, per_task=1)) == 1


def test_hard_tasks_are_found_and_oversampled():
    stats = update_stats({}, [('a', False), ('a', False), ('b', True), ('b', True), ('c', True), ('c', False)])
    assert pass_rate(stats, 'a') < pass_rate(stats, 'c') < pass_rate(stats, 'b')
    assert hardest(stats, ['a', 'b', 'c', 'never-seen'], 2) == ['a', 'c']
    ids = [f't{i}' for i in range(40)]
    stats = update_stats({}, [(t, i >= 4) for i, t in enumerate(ids)])     # t0..t3 always fail
    rng = random.Random(0)
    hard_hits = sum(len({'t0', 't1', 't2', 't3'} & set(sample_tasks(ids, stats, 8, 0.9, rng))) for _ in range(50))
    easy_hits = sum(len({'t0', 't1', 't2', 't3'} & set(sample_tasks(ids, stats, 8, 0.0, rng))) for _ in range(50))
    assert hard_hits > 2 * easy_hits
    picked = sample_tasks(ids, stats, 8, 0.5, rng)
    assert len(picked) == len(set(picked)) == 8
    assert sample_tasks(['x'], {}, 5, 0.5, rng) == ['x']
