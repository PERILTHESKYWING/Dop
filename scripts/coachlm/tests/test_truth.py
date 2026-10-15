import pytest

from conftest import make_task
from truth import VerifyError, make_tasks, tag_member, untag_member, verify
from util import read_jsonl, write_jsonl


def test_member_tags_round_trip():
    assert untag_member(tag_member('pc/m0003', 2)) == ('pc/m0003', 2)
    assert untag_member('champion~0') == ('champion', 0)
    assert untag_member('plain') == ('plain', 0)


def test_verify_through_the_cli(cfg, tmp_path, monkeypatch):
    count = tmp_path / 'count'
    monkeypatch.setenv('STUB_COUNT', str(count))
    tasks = tmp_path / 'tasks.jsonl'
    write_jsonl(tasks, [make_task(1), make_task(2)])
    answers = [{'id': 'train-001', 'member': 'pc/m1~0', 'text': 'Q16 because the corner is settled.'},
               {'id': 'train-001', 'member': 'pc/m1~1', 'text': 'Z99 is huge.'},
               {'id': 'train-002', 'member': 'pc/m2~0', 'text': 'ok'}]
    s = verify(answers, tasks, tmp_path / 'work', cfg)
    assert [x['pass'] for x in s] == [True, False, True]
    assert s[1]['unsupported'] == ['Z99'] and s[0]['member'] == 'pc/m1~0'
    verify(answers, tasks, tmp_path / 'work', cfg)                 # resume: scores reused, CLI not run again
    assert count.read_text().count('1') == 1


def test_verify_failure_is_plain(cfg, tmp_path, monkeypatch):
    monkeypatch.setenv('STUB_FAIL', '1')
    tasks = tmp_path / 'tasks.jsonl'
    write_jsonl(tasks, [make_task(1)])
    with pytest.raises(VerifyError, match='KataGo crashed'):
        verify([{'id': 'train-001', 'member': 'm~0', 'text': 'x'}], tasks, tmp_path / 'w', cfg)


def test_verify_missing_command(cfg, tmp_path):
    cfg.verify_cmd = ('definitely-not-a-command-xyz',)
    tasks = tmp_path / 'tasks.jsonl'
    write_jsonl(tasks, [make_task(1)])
    with pytest.raises(VerifyError, match='could not start'):
        verify([{'id': 'train-001', 'member': 'm~0', 'text': 'x'}], tasks, tmp_path / 'w', cfg)


def test_verify_all_unknown_ids_is_an_error(cfg, tmp_path):
    tasks = tmp_path / 'tasks.jsonl'
    write_jsonl(tasks, [make_task(1)])
    with pytest.raises(VerifyError, match='no scores'):
        verify([{'id': 'nope', 'member': 'm~0', 'text': 'x'}], tasks, tmp_path / 'w', cfg)


def test_factory_with_requests(cfg, tmp_path):
    req = tmp_path / 'requests.jsonl'
    write_jsonl(req, [{'taskId': 'train-001', 'question': {'kind': 'why-not', 'move': 'D4', 'text': 'Why not D4?'}}])
    out = make_tasks(cfg, tmp_path / 'new.jsonl', requests=req, minutes=1)
    rows = list(read_jsonl(out))
    assert len(rows) == 1 and rows[0]['prompt'] == 'Question: Why not D4?'
