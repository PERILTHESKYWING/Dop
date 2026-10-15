from conftest import make_task
from pool import Pool, answer_quality, rows_for_task
from util import read_jsonl, write_jsonl


def good(task, text, member='pc/m1', gen=1, q=0.5):
    return {'kind': 'good', 'taskId': task, 'promptVersion': 1, 'text': text, 'member': member, 'generation': gen,
            'run': 'pc', 'scores': {'quality': q}}


def test_append_and_dedupe(tmp_path):
    p = Pool(tmp_path / 'pool.jsonl.gz')
    assert p.add([good('t1', 'A answer'), good('t1', 'A   answer'), good('t2', 'A answer')]) == 2  # whitespace-equal dupe
    assert p.add([good('t1', 'A answer', member='kaggle/m9')]) == 0                               # same text, other member
    again = Pool(tmp_path / 'pool.jsonl.gz')                                                     # appended gzip members reload
    assert len(again.rows) == 2 and again.keys == p.keys


def test_merge_two_machines(tmp_path):
    pc = Pool(tmp_path / 'pc.jsonl.gz')
    pc.add([good('t1', 'from pc'), good('t2', 'shared')])
    kg = Pool(tmp_path / 'kg.jsonl.gz')
    kg.add([good('t2', 'shared'), good('t3', 'from kaggle', member='kaggle/m2')])
    kg.compact_to(tmp_path / 'release.jsonl.gz')
    assert pc.merge_file(tmp_path / 'release.jsonl.gz') == 1
    assert {r['text'] for r in pc.good()} == {'from pc', 'shared', 'from kaggle'}
    pc.compact_to(tmp_path / 'release.jsonl.gz')          # upload = union; merging back adds nothing new
    assert kg.merge_file(tmp_path / 'release.jsonl.gz') == 1
    assert len(kg.rows) == len(pc.rows) == 3


def test_eval_tasks_never_enter(tmp_path):
    p = Pool(tmp_path / 'pool.jsonl.gz', eval_ids={'eval-001'})
    assert p.add([good('eval-001', 'leak'), {'kind': 'task', 'task': make_task(1, split='eval')},
                  {'kind': 'task', 'task': {**make_task(2), 'id': 'eval-001'}}]) == 0
    write_jsonl(tmp_path / 'remote.jsonl.gz', [good('eval-001', 'leak from another machine')])
    assert p.merge_file(tmp_path / 'remote.jsonl.gz') == 0


def test_quality_gate():
    assert answer_quality({'pass': False, 'truth': 0.5, 'coverage': 1, 'depth': 1}) == 0
    assert answer_quality({'pass': True, 'truth': 1, 'coverage': 1, 'depth': 1}) == 1
    assert abs(answer_quality({'pass': True, 'truth': 1, 'coverage': 1, 'depth': 1}, judge=0.0) - 0.8) < 1e-9


def test_rows_for_task_pairs_cross_members():
    task = make_task(1)
    s = lambda ok, cov: {'truth': 1.0 if ok else 0.0, 'pass': ok, 'coverage': cov, 'depth': 0.5}
    answers = [
        {'member': 'pc/m1', 'text': 'best', 'score': s(True, 0.9)},
        {'member': 'pc/m2', 'text': 'invented Z99', 'score': s(False, 0.9)},
        {'member': 'pc/m3', 'text': 'thin', 'score': s(True, 0.31)},
        {'member': 'pc/m4', 'text': 'nearly as good', 'score': s(True, 0.85)},
    ]
    rows = rows_for_task(task, answers, generation=3, run='pc', good_min_coverage=0.3, margin=0.15)
    goods = [r for r in rows if r['kind'] == 'good']
    pairs = [r for r in rows if r['kind'] == 'pair']
    assert {r['text'] for r in goods} == {'best', 'thin', 'nearly as good'}
    assert all(r['generation'] == 3 and r['member'] for r in goods)
    assert [p['rejected'] for p in pairs] == ['invented Z99', 'thin']     # invented facts first; near-ties skipped
    assert all(p['chosen'] == 'best' and p['member'] == 'pc/m1' for p in pairs)


def test_winners_and_tasks(tmp_path):
    p = Pool(tmp_path / 'pool.jsonl.gz')
    p.add([good('t1', 'a', q=0.2), good('t1', 'b', q=0.9), good('t1', 'c', q=0.5), {'kind': 'task', 'task': make_task(7)}])
    assert [r['text'] for r in p.winners(per_task=2)] == ['b', 'c']
    assert list(p.tasks()) == ['train-007']
    assert p.stats()['task'] == 1 and p.stats()['good'] == 3
    assert len(list(read_jsonl(tmp_path / 'pool.jsonl.gz'))) == 4
