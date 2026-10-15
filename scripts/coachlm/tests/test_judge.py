import json
import random

from conftest import make_task
from judge import Judge, build_prompt, parse_scores


def reply(n, val=4):
    return json.dumps({'scores': [{'i': i, 'clarity': val, 'depth': val, 'usefulness': val} for i in range(n)]})


class FakePost:
    def __init__(self, statuses=None):
        self.calls, self.statuses = [], list(statuses or [])

    def __call__(self, model, body, key):
        self.calls.append(model)
        status = self.statuses.pop(0) if self.statuses else 200
        n = body['contents'][0]['parts'][0]['text'].count('Answer ')
        return status, reply(n) if status == 200 else ''


def test_no_key_skips_cleanly(cfg):
    post = FakePost()
    j = Judge(cfg, key='', post=post)
    assert not j.enabled and j.budget_left() == 0
    assert j.score(make_task(1), ['a', 'b']) == [None, None]
    assert post.calls == []


def test_hard_cap_per_run(cfg):
    cfg.judge_cap, cfg.judge_daily_cap = 3, 100
    post = FakePost()
    j = Judge(cfg, key='k', post=post, sleep=lambda s: None)
    got = [j.score(make_task(i), ['x', 'y']) for i in range(6)]
    assert len(post.calls) == 3 and j.calls == 3
    assert got[0] == [0.75, 0.75] and got[5] == [None, None]
    assert j.stopped == 'call cap reached'


def test_daily_cap_survives_restarts(cfg):
    cfg.judge_cap, cfg.judge_daily_cap = 10, 2
    Judge(cfg, key='k', post=FakePost(), sleep=lambda s: None).score(make_task(1), ['x'])
    j2 = Judge(cfg, key='k', post=FakePost(), sleep=lambda s: None)   # a new run the same day
    assert j2.budget_left() == 1


def test_rate_limit_stops_the_run(cfg):
    post = FakePost([429])
    j = Judge(cfg, key='k', post=post, sleep=lambda s: None)
    assert j.score(make_task(1), ['x']) == [None]
    assert not j.enabled and j.score(make_task(2), ['x']) == [None] and len(post.calls) == 1


def test_retired_model_falls_through(cfg):
    post = FakePost([404, 200])
    j = Judge(cfg, key='k', post=post, sleep=lambda s: None)
    assert j.score(make_task(1), ['x']) == [0.75]
    assert post.calls[0] != post.calls[1]


def test_waits_between_calls(cfg):
    cfg.judge_min_interval = 7
    waits, t = [], [1000.0]
    j = Judge(cfg, key='k', post=FakePost(), sleep=waits.append, now=lambda: t[0])
    j.score(make_task(1), ['x'])
    j.score(make_task(2), ['x'])
    assert waits and abs(waits[-1] - 7) < 1e-9


def test_parse_scores_only_takes_numbers():
    text = 'Sure! {"scores": [{"i": 1, "clarity": 5, "depth": 5, "usefulness": 5, "rewrite": "B R16 wins"}, {"i": 0, "clarity": 9}]}'
    assert parse_scores(text, 2) == [None, 1.0]
    assert parse_scores('not json', 2) == [None, None]
    assert parse_scores(json.dumps({'scores': [{'i': 7, 'clarity': 3, 'depth': 3, 'usefulness': 3}]}), 2) == [None, None]
    assert parse_scores(json.dumps({'scores': [{'clarity': 1, 'depth': 1, 'usefulness': 1}]}), 1) == [0.0]


def test_sample_respects_share_and_budget(cfg):
    cfg.judge_cap, cfg.judge_daily_cap, cfg.judge_batch = 2, 100, 3
    j = Judge(cfg, key='k', post=FakePost(), sleep=lambda s: None)
    groups = [(make_task(i), [{'text': str(k)} for k in range(5)]) for i in range(10)]
    picked = j.sample(groups, share=0.5, rng=random.Random(1))
    assert len(picked) == 2 and all(len(a) <= 3 for _t, a in picked)


def test_prompt_contains_facts_and_answers():
    p = build_prompt(make_task(1), ['first', 'second'])
    assert 'Black leads' in p and 'Answer 0:' in p and 'Answer 1:\nsecond' in p
