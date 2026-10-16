"""The ChatGPT tone reviewer (tone.py, tone_review.py) and how its score blends into quality.
No network: the HTTP layer is faked (a fake post function, or a fake urlopen)."""
import io
import json
import random
import time
import urllib.error

import pytest

import run
import tone
import tone_review
from conftest import make_task
from evolve import Evolution
from pool import W_RUBRIC, W_TONE, answer_quality, rows_for_task
from tone import ToneJudge, build_prompt, parse_review, system_prompt, tone_rules
from truth import tag_member
from util import read_json, read_jsonl, write_jsonl


def reply(t=8, w=7, c=9, f=6, note='Lead with the answer.'):
    return json.dumps({'tone': t, 'warmth': w, 'clarity': c, 'fit': f, 'note': note})


class FakePost:
    """Stands in for tone._post: (status, text, info) per call, from a script."""

    def __init__(self, statuses=None, infos=None, text=None):
        self.calls, self.bodies = [], []
        self.statuses, self.infos, self.text = list(statuses or []), list(infos or []), text

    def __call__(self, body, key):
        self.calls.append(body['model'])
        self.bodies.append(body)
        status = self.statuses.pop(0) if self.statuses else 200
        info = self.infos.pop(0) if self.infos else {}
        if status != 200:
            return status, '', info
        return 200, self.text(body['messages'][1]['content']) if self.text else reply(), info


class FakeHTTP:
    """Stands in for urllib.request.urlopen: answers each model from a script {model: (status, payload)}."""

    def __init__(self, script):
        self.script, self.requests = script, []

    def __call__(self, req, timeout=None):
        body = json.loads(req.data)
        self.requests.append((req, body))
        status, payload = self.script[body['model']]
        data = json.dumps(payload).encode()
        if status != 200:
            raise urllib.error.HTTPError(req.full_url, status, 'error', {}, io.BytesIO(data))
        return io.BytesIO(data)


def ok_payload(content):
    return {'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 120, 'completion_tokens': 30}}


def no_sleep(_s):
    pass


# ---------------------------------------------------------------- judge ----

def test_no_key_does_nothing_and_says_why_once(cfg, capsys):
    post = FakePost()
    j = ToneJudge(cfg, key='', post=post)
    assert not j.enabled and j.budget_left() == 0
    assert j.score(make_task(1), 'text') is None and j.score(make_task(2), 'text') is None
    assert post.calls == []
    assert capsys.readouterr().out.count('no OPENAI_API_KEY') == 1


def test_key_and_model_from_env(cfg, monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')
    monkeypatch.setenv('OPENAI_MODEL', 'gpt-4.1-mini')
    j = ToneJudge(cfg, post=FakePost())
    assert j.enabled and j.models[0] == 'gpt-4.1-mini' and j.models.count('gpt-4.1-mini') == 1
    assert 'gpt-5-mini' in j.models


def test_parse_review_validates_and_clamps():
    r = parse_review('Sure! {"tone": 12, "warmth": -3, "clarity": 7.5, "fit": 6, "note": "Too\\n long.", "rewrite": "B R16"}')
    assert r == {'tone': 10.0, 'warmth': 0.0, 'clarity': 7.5, 'fit': 6.0, 'note': 'Too long.', 'score': round(23.5 / 40, 4)}
    four = {'tone': 5, 'warmth': 5, 'clarity': 5, 'fit': 5}
    assert parse_review(json.dumps(four)) == {**four, 'note': '', 'score': 0.5}
    assert parse_review('not json') is None and parse_review(None) is None and parse_review('[1, 2]') is None
    assert parse_review(json.dumps({'tone': 5, 'warmth': 5, 'clarity': 5})) is None            # a number missing
    assert parse_review(json.dumps({**four, 'tone': '7'})) is None                            # numbers only
    assert parse_review(json.dumps({**four, 'fit': True})) is None
    assert parse_review('{"tone": NaN, "warmth": 5, "clarity": 5, "fit": 5}') is None
    assert len(parse_review(json.dumps({**four, 'note': 'x' * 500}))['note']) == 200


def test_caps_per_run_and_per_day(cfg):
    cfg.tone_cap, cfg.tone_daily_cap = 3, 100
    post = FakePost()
    j = ToneJudge(cfg, key='k', post=post, sleep=no_sleep)
    got = [j.score(make_task(i), 'x') for i in range(5)]
    assert len(post.calls) == 3 and j.calls == 3
    assert got[0]['tone'] == 8 and got[4] is None and j.stopped.startswith('call cap')
    cfg.tone_cap, cfg.tone_daily_cap = 100, 4
    j2 = ToneJudge(cfg, key='k', post=FakePost(), sleep=no_sleep)        # a new run the same day
    assert j2.budget_left() == 1
    assert read_json(cfg.path('tone-usage.json')) == {time.strftime('%Y-%m-%d'): 3}


@pytest.mark.parametrize('status,code,words', [(429, 'rate_limit_exceeded', 'rate limited'),
                                               (429, 'insufficient_quota', 'no credit'),
                                               (401, '', 'refused'), (403, '', '403')])
def test_stops_for_the_run(cfg, status, code, words):
    post = FakePost([status], [{'code': code}])
    j = ToneJudge(cfg, key='k', post=post, sleep=no_sleep)
    assert j.score(make_task(1), 'x') is None
    assert not j.enabled and words in j.stopped
    assert j.score(make_task(2), 'x') is None and len(post.calls) == 1


def test_malformed_reply_is_none_and_the_run_goes_on(cfg):
    post = FakePost(text=lambda user: 'Nice answer!')
    j = ToneJudge(cfg, key='k', post=post, sleep=no_sleep)
    assert j.score(make_task(1), 'x') is None and j.enabled and j.calls == 1


def test_server_error_skips_one_answer(cfg):
    post = FakePost([500, 200])
    j = ToneJudge(cfg, key='k', post=post, sleep=no_sleep)
    assert j.score(make_task(1), 'x') is None and j.enabled
    assert j.score(make_task(2), 'x')['tone'] == 8


def test_waits_between_calls(cfg):
    cfg.tone_min_interval = 2
    waits, t = [], [1000.0]
    j = ToneJudge(cfg, key='k', post=FakePost(), sleep=waits.append, now=lambda: t[0])
    j.score(make_task(1), 'x')
    j.score(make_task(2), 'x')
    assert waits and abs(waits[-1] - 2) < 1e-9


def test_model_fallback_on_404_through_urlopen(cfg, monkeypatch):
    http = FakeHTTP({'gpt-5-mini': (404, {'error': {'code': 'model_not_found', 'message': 'The model does not exist'}}),
                     'gpt-4.1-mini': (200, ok_payload(reply(t=9)))})
    monkeypatch.setattr(tone.urllib.request, 'urlopen', http)
    j = ToneJudge(cfg, key='sk-test', sleep=no_sleep)
    r = j.score(make_task(1), 'Q16 is the move.')
    assert r['tone'] == 9 and j.model == 'gpt-4.1-mini' and j.tokens == {'in': 120, 'out': 30}
    assert [b['model'] for _r, b in http.requests] == ['gpt-5-mini', 'gpt-4.1-mini']
    req, body = http.requests[-1]
    assert req.full_url == tone.ENDPOINT and req.get_header('Authorization') == 'Bearer sk-test'
    assert body['response_format'] == {'type': 'json_object'} and body['max_completion_tokens'] == tone.MAX_TOKENS
    assert 'temperature' not in body and 'reasoning_effort' not in body      # gpt-4.1-mini does not reason
    assert http.requests[0][1]['reasoning_effort'] == 'minimal'
    assert [m['role'] for m in body['messages']] == ['system', 'user']
    j.score(make_task(2), 'x')                                                # the missing model stays skipped
    assert [b['model'] for _r, b in http.requests][2:] == ['gpt-4.1-mini']


def test_drops_reasoning_effort_when_refused(cfg):
    post = FakePost([400, 200], [{'code': 'unsupported_value', 'param': 'reasoning_effort', 'message': 'Unsupported value'}])
    j = ToneJudge(cfg, key='k', post=post, sleep=no_sleep)
    assert j.score(make_task(1), 'x')['tone'] == 8
    assert post.calls == ['gpt-5-mini', 'gpt-5-mini']
    assert 'reasoning_effort' in post.bodies[0] and 'reasoning_effort' not in post.bodies[1]


def test_tone_rules_from_rubric_or_built_in(tmp_path):
    p = tmp_path / 'rubric.json'
    p.write_text(json.dumps({'version': 1, 'rules': [
        {'id': 'why', 'text': 'Explain why.', 'weight': 3},
        {'id': 'cheeky-blunder', 'topic': 'tone', 'text': 'A blunder gets one cheeky line.', 'when': {'tone': 'blunder'}},
        {'id': 'tsumego-direct', 'topic': 'tone', 'text': 'Yes or No first.', 'when': {'tsumego': True}}]}))
    assert tone_rules(p) == ['A blunder gets one cheeky line. (when tone=blunder)', 'Yes or No first. (when tsumego)']
    assert '1. A blunder gets one cheeky line.' in system_prompt(tone_rules(p))
    p.write_text(json.dumps({'version': 0, 'rules': [{'id': 'why', 'text': 'Explain why.'}]}))
    assert tone_rules(p) == [] and tone_rules(tmp_path / 'missing.json') == []
    s = system_prompt()          # the repo rubric's tone rules when it has some, else XIAO's notes built in
    assert 'JSON' in s and all(r in s for r in (tone_rules() or tone.TONE_RULES))


def test_prompt_has_question_situation_and_answer():
    t = make_task(1)
    t['explanation']['situation'] = {'phase': 'opening', 'open': True, 'tsumego': False, 'gap': 'negligible', 'tone': 'relaxed'}
    assert build_prompt(t, '  Both are fine, play your style.  ').splitlines() == [
        'Question: Why not D4? (train-001)', 'Situation: tone=relaxed, gap=negligible, open position',
        'Answer:', 'Both are fine, play your style.']
    assert 'Situation' not in build_prompt(make_task(2), 'x')
    assert 'concept question' in build_prompt({'kind': 'concept', 'prompt': 'Question: What is aji?'}, 'x')
    assert len(build_prompt(t, 'y' * 9000)) < tone.MAX_ANSWER_CHARS + 200


def test_check_key_reports_a_refused_key(monkeypatch):
    def refuse(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, 'no', {}, io.BytesIO(b'{}'))
    monkeypatch.setattr(tone.urllib.request, 'urlopen', refuse)
    good, msg = tone.check_key('sk-bad')
    assert not good and '401' in msg and 'sk-bad' not in msg


def test_start_up_check_lists_openai_as_optional(cfg, monkeypatch, capsys):
    for k in ('HF_TOKEN', 'GITHUB_TOKEN', 'GEMINI_API_KEY'):
        monkeypatch.delenv(k, raising=False)
    run.check(cfg)
    assert 'no OPENAI_API_KEY: no ChatGPT tone reviewer (optional' in capsys.readouterr().out
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')
    monkeypatch.setattr(tone.urllib.request, 'urlopen', lambda req, timeout=None: io.BytesIO(b'{"data": []}'))
    run.check(cfg)
    out = capsys.readouterr().out
    assert 'OK    OpenAI key works' in out and 'sk-test' not in out


# ---------------------------------------------------------------- blend ----

def test_tone_blends_into_quality():
    s = {'pass': True, 'truth': 1, 'coverage': 0.8, 'depth': 0.5}
    base = (0.5 * 0.8 + 0.3 * 0.5) / 0.8
    assert answer_quality(s) == answer_quality(s, tone=None) == base             # no tone: exactly as before
    assert answer_quality(s, tone=1.0) == pytest.approx((1 - W_TONE) * base + W_TONE)
    r = dict(s, rubric=0.6)
    assert answer_quality(r) == pytest.approx(0.5 * base + 0.5 * 0.6)
    assert answer_quality(r, tone=0.0) == pytest.approx((1 - W_RUBRIC - W_TONE) * base + W_RUBRIC * 0.6)   # rubric keeps its share
    assert answer_quality(dict(s, judge=None), judge=0.5, tone=0.5) == pytest.approx(
        (1 - W_TONE) * (0.5 * 0.8 + 0.3 * 0.5 + 0.2 * 0.5) + W_TONE * 0.5)
    assert answer_quality(dict(s, **{'pass': False}), tone=1.0) == 0.0           # truth stays the gate


def test_pool_rows_carry_the_tone_number_only():
    sc = {'pass': True, 'truth': 1, 'coverage': 0.6, 'depth': 0.5}
    answers = [{'member': 'a', 'text': 'warm', 'score': sc, 'tone': 0.9}, {'member': 'b', 'text': 'cold', 'score': sc, 'tone': 0.1}]
    rows = rows_for_task(make_task(1), answers, 1, 'pc')
    pair = [r for r in rows if r['kind'] == 'pair']
    assert pair and pair[0]['chosen'] == 'warm' and pair[0]['scores']['chosen']['tone'] == 0.9
    assert all(set(r['scores']) <= {'truth', 'coverage', 'depth', 'tone', 'quality'} for r in rows if r['kind'] == 'good')


class OffJudge:
    calls, stopped, enabled = 0, 'off', False

    def budget_left(self):
        return 0


def _one_generation(cfg, tone_judge, answers_by_task):
    """phase_judge + phase_pool on hand-made verified answers (no model, no safetensors)."""
    evo = Evolution(cfg, None, OffJudge(), name='pc', tone=tone_judge)
    ids = sorted(evo.tasks)
    answers, scores = [], []
    for n, texts in enumerate(answers_by_task):
        for s, text in enumerate(texts):
            a = {'id': ids[n], 'member': tag_member('pc/m0001', s), 'text': text}
            answers.append(a)
            scores.append({'id': a['id'], 'member': a['member'], 'pass': True, 'truth': 1, 'coverage': 0.6, 'depth': 0.5})
    gd = evo.gen_dir(1)
    write_jsonl(gd / 'gen-answers.jsonl', answers)
    write_jsonl(gd / 'scores-train.jsonl', scores)
    evo.state['phase'] = 'judge'
    evo.phase_judge(1)
    evo.phase_pool(1)
    return evo, ids, list(read_jsonl(cfg.path('pool.jsonl.gz')))


def test_evolution_blends_tone_into_the_pool(cfg, tasks_on_disk):
    def by_text(user):
        if 'odd' in user:
            return 'no idea'                              # malformed: that task is not fully reviewed
        return reply(9, 9, 9, 9) if 'warm' in user else reply(1, 1, 1, 1)
    post = FakePost(text=by_text)
    evo, ids, pool = _one_generation(cfg, ToneJudge(cfg, key='k', post=post, sleep=no_sleep),
                                     [['warm answer', 'cold answer'], ['warm one', 'odd one']])
    toned = read_json(evo.gen_dir(1) / 'tone-train.json')
    assert len(post.calls) == 4 and len(toned) == 3 and all('note' in v for v in toned.values())
    pairs = [r for r in pool if r['kind'] == 'pair']
    assert [(p['taskId'], p['chosen'], p['rejected']) for p in pairs] == [(ids[0], 'warm answer', 'cold answer')]
    goods = {r['text']: r['scores'] for r in pool if r['kind'] == 'good'}
    assert goods['warm answer']['tone'] == 0.9 and 'tone' not in goods['warm one']   # half-reviewed task: tone ignored
    assert not any('Lead with the answer' in json.dumps(r) for r in pool)            # notes never reach training data


def test_evolution_without_a_key_changes_nothing(cfg, tasks_on_disk, capsys):
    evo, _ids, pool = _one_generation(cfg, None, [['warm answer', 'cold answer']])
    assert read_json(evo.gen_dir(1) / 'tone-train.json') == {}
    assert not [r for r in pool if r['kind'] == 'pair']                              # equal quality: no pair
    assert all('tone' not in r['scores'] for r in pool if r['kind'] == 'good')
    assert capsys.readouterr().out.count('tone reviewer off: no OPENAI_API_KEY') == 1


def test_sample_takes_whole_tasks_within_the_limit(cfg):
    cfg.tone_batch = 3
    j = ToneJudge(cfg, key='k', post=FakePost(), sleep=no_sleep)
    groups = [(make_task(i), [{'text': str(k)} for k in range(n)]) for i, n in enumerate([1, 2, 5, 3, 2])]
    picked = j.sample(groups, 6, random.Random(1))
    sizes = [len(a) for _t, a in picked]
    assert sum(sizes) == 6 and 5 not in sizes                     # too big for tone_batch: skipped
    assert sizes[-1] == 1 and all(s >= 2 for s in sizes[:-1])     # tasks it can reorder first


# ------------------------------------------------------------------ CLI ----

def critique(path):
    path.write_text(json.dumps({'made': 'x', 'items': [
        {'id': 13, 'question': 'Why not here?', 'kind': 'position',
         'answer': {'summary': 'Ouch, that donated a dragon.', 'sections': [{'title': 'Lesson', 'text': 'Check the cut first.'}],
                    'situation': {'tone': 'blunder', 'gap': 'blunder'}}},
        {'id': 24, 'question': 'What is miai?', 'kind': 'concept',
         'concept': {'short': 'Two equal points.', 'body': [{'title': 'Use', 'text': 'If one is taken, take the other.'}]}}]}))
    return path


def test_dry_run_prints_prompts_without_calling(tmp_path, monkeypatch, capsys):
    def boom(*a, **k):
        raise AssertionError('a dry run must not call the API')
    monkeypatch.setattr(tone.urllib.request, 'urlopen', boom)
    data = tmp_path / 'data'
    assert tone_review.main([str(critique(tmp_path / 'critique.json')), '--dry-run', '--data-dir', str(data)]) == 0
    out = capsys.readouterr().out
    assert 'Reply with JSON only' in out and 'Question: Why not here?' in out
    assert 'Situation: tone=blunder, gap=blunder' in out
    assert 'Ouch, that donated a dragon.\n\nLesson\nCheck the cut first.' in out
    assert 'Situation: a concept question (no board)' in out and 'Two equal points.' in out
    assert 'nothing was sent' in out and not data.exists()


def test_review_writes_a_report_and_respects_caps(tmp_path, monkeypatch, capsys):
    http = FakeHTTP({'gpt-5-mini': (200, ok_payload(reply(t=4, note='Too long | cut the summary.')))})
    monkeypatch.setattr(tone.urllib.request, 'urlopen', http)
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'config.json').write_text(json.dumps({'tone_min_interval': 0}))
    (data / '.env').write_text('OPENAI_API_KEY=sk-test\n')
    monkeypatch.setenv('OPENAI_API_KEY', '')          # the .env fills it; monkeypatch removes it afterwards
    monkeypatch.setenv('KAMI_TONE_CAP', '2')
    tasks = tmp_path / 'tasks.jsonl'
    write_jsonl(tasks, [make_task(i) for i in range(3)])
    answers = tmp_path / 'gen-answers.jsonl'
    write_jsonl(answers, [{'id': f'train-{i:03d}', 'member': 'pc/m0001~0', 'text': f'Answer {i}.'} for i in range(3)])
    assert tone_review.main([str(answers), '--tasks', str(tasks), '--data-dir', str(data), '--out', str(tmp_path / 'rep')]) == 0
    assert len(http.requests) == 2
    rep = json.loads((tmp_path / 'rep.json').read_text(encoding='utf-8'))
    assert rep['reviewed'] == 2 and len(rep['items']) == 3 and rep['items'][2]['tone'] is None
    assert rep['stopped'].startswith('call cap') and rep['caps']['perRun'] == 2 and rep['model'] == 'gpt-5-mini'
    assert rep['tokens'] == {'in': 240, 'out': 60} and rep['mean']['tone'] == 4
    md = (tmp_path / 'rep.md').read_text(encoding='utf-8')
    assert '| train-000 pc/m0001~0 | Why not D4? (train-000) |' in md and 'Too long \\| cut the summary.' in md
    assert '1 answer(s) not reviewed' in md
    assert read_json(data / 'tone-usage.json') == {time.strftime('%Y-%m-%d'): 2}
    assert 'sk-test' not in capsys.readouterr().out


def test_review_without_a_key_explains_the_setup(tmp_path, capsys):
    assert tone_review.main([str(critique(tmp_path / 'c.json')), '--data-dir', str(tmp_path / 'data')]) == 1
    out = capsys.readouterr().out
    assert 'no OPENAI_API_KEY' in out and 'platform.openai.com/api-keys' in out and 'ChatGPT Plus' in out


def test_task_lines_review_the_reference(tmp_path):
    p = tmp_path / 'tasks.jsonl'
    write_jsonl(p, [make_task(4)])
    items = tone_review.load_items(p)
    assert items[0]['text'].startswith('D4 is slow here') and items[0]['question'] == 'Why not D4? (train-004)'
