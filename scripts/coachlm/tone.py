"""An optional third reader: ChatGPT (OpenAI's API) reviews the TONE of Kami's answers.

It only ever returns numbers and one short note: {"tone", "warmth", "clarity", "fit"} from 0 to 10
and a sentence on the biggest tone fix. The note is for XIAO to read (tone_review.py reports,
the generation folder); it never becomes training text, and nothing here is used by the website.
KataGo's truth check stays the first gate; the tone score only nudges the order of answers that
already passed (pool.answer_quality, weight W_TONE).

Cost control: one answer per call, a short prompt, at most tone_cap calls per run and
tone_daily_cap per day (config.py; KAMI_TONE_CAP, KAMI_TONE_DAILY_CAP), a pause between calls,
and it stops for the rest of the run on 429 (rate limit or no credit), 401 or 403.
With no OPENAI_API_KEY it does nothing. The API is billed on platform.openai.com, separately
from a ChatGPT Plus subscription (Plus does not include API use).

The tone rules are XIAO's: the rules in eval/coach/rubric.json with "topic": "tone", or the
built-in TONE_RULES below (written from XIAO's critique) while the rubric has none.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
import urllib.error
import urllib.request
from pathlib import Path

from judge import RUBRIC_FILE
from util import log, read_json, write_json

ENDPOINT = 'https://api.openai.com/v1/chat/completions'
MODELS_URL = 'https://api.openai.com/v1/models'
MAX_TOKENS = 300                 # the reply is a small JSON object
MAX_QUESTION_CHARS = 300
MAX_ANSWER_CHARS = 2500
FIELDS = ('tone', 'warmth', 'clarity', 'fit')
CAP_REACHED = 'call cap reached (tone_cap per run / tone_daily_cap per day)'

# XIAO's tone notes (critique of the analysis batch), used when rubric.json has no "tone" rules.
TONE_RULES = [
    'Calm, patient and human: a warm, expressive companion, not a lecturer.',
    'Answer first and stay concise: a simple question gets a simple answer; no repetition, no generic summary.',
    'Encourage without empty praise; correct mistakes honestly.',
    'A good move gets brief, specific praise with a playful touch (like "two birds with one stone 🐦").',
    'When two moves are practically equal, say so and "play your style 😊" instead of quoting tiny differences.',
    'Open openings are relaxed and a little cheeky ("no single correct move").',
    'An obvious blunder gets one short cheeky line ("donated an entire dragon 🐉🎁") and one lesson, not a lecture.',
    'Tsumego (life and death, tesuji): direct, Yes or No first, no winrates.',
    'When two good moves differ in style, offer the choice (peaceful or fight ⚔️).',
    'Humour is secondary to teaching; emoji sparingly (one or two at most); never mock the player.',
    'No engine jargon (visits, policy, winrate decimals).',
]

SYSTEM = """You review the tone of answers that Kami, a Go (baduk) teacher, wrote for a student.
An engine already checked the Go content: judge tone and style only.
The teacher's tone rules:
{rules}
The situation line names the voice that fits: celebrate (a good move: brief, specific, playful praise), relaxed (open opening or near-equal moves: a little cheeky, "play your style"), teach (a real difference: honest and clear), blunder (one short cheeky line, one lesson), tsumego (Yes or No first, no winrates), overview. A style choice offers peaceful or fighting play.
Give whole numbers from 0 (poor) to 10 (excellent):
- tone: overall, how well it follows the rules
- warmth: calm, human, encouraging without empty praise, never mocking
- clarity: answer first, concise, plain words, no repetition or jargon
- fit: the voice suits the question and situation
Reply with JSON only: {{"tone": n, "warmth": n, "clarity": n, "fit": n, "note": "one short sentence: the biggest tone fix"}}"""


def _when_text(when) -> str:
    """A rule's condition (rubric "when", read against the task's situation) as a few words."""
    if not isinstance(when, dict) or not when:
        return ''
    parts = []
    for k, v in when.items():
        if k == 'ask':           # a pattern on the question's words: the reviewer sees the question itself
            continue
        if v is True:
            parts.append(str(k))
        elif v is False:
            parts.append(f'not {k}')
        elif isinstance(v, list):
            parts.append(f'{k}={"/".join(map(str, v))}')
        else:
            parts.append(f'{k}={v}')
    return f' (when {", ".join(parts)})' if parts else ''


def tone_rules(path: Path = RUBRIC_FILE) -> list[str]:
    """Texts of the rubric's rules with topic "tone" ([] when there are none or no file)."""
    try:
        rules = json.loads(Path(path).read_text(encoding='utf-8')).get('rules', [])
    except (OSError, ValueError, AttributeError):
        return []
    out = []
    for r in rules if isinstance(rules, list) else []:
        if not isinstance(r, dict) or not isinstance(r.get('text'), str) or not r['text'].strip():
            continue
        topic = r.get('topic')
        if topic == 'tone' or (isinstance(topic, list) and 'tone' in topic):
            out.append(r['text'].strip() + _when_text(r.get('when')))
    return out


def system_prompt(rules: list[str] | None = None) -> str:
    rules = rules if rules is not None else (tone_rules() or TONE_RULES)
    return SYSTEM.format(rules='\n'.join(f'{i + 1}. {r}' for i, r in enumerate(rules)))


def question_of(task: dict) -> str:
    """The student's question: task.question, the explanation's question, or the prompt's "Question:" line."""
    q = task.get('question')
    if isinstance(q, dict):
        q = q.get('text')
    if isinstance(q, str) and q.strip():
        return q.strip()
    ex = task.get('explanation')
    if isinstance(ex, dict) and isinstance(ex.get('question'), dict):
        q = ex['question'].get('text')
        if isinstance(q, str) and q.strip():
            return q.strip()
    for line in str(task.get('prompt') or '').splitlines():
        if line.startswith('Question:'):
            return line[len('Question:'):].strip()
    return ''


def situation_of(task: dict) -> dict | None:
    ex = task.get('explanation')
    for s in (task.get('situation'), ex.get('situation') if isinstance(ex, dict) else None):
        if isinstance(s, dict):
            return s
    return None


def situation_line(task: dict) -> str:
    """One short line from explanation.situation (tone, gap, tsumego, open), or '' when unknown."""
    s = situation_of(task)
    if s is None:
        return 'Situation: a concept question (no board)' if task.get('kind') == 'concept' else ''
    parts = [f'{k}={s[k]}' for k in ('tone', 'gap') if isinstance(s.get(k), str) and s[k] and s[k] != 'none']
    if s.get('tsumego'):
        parts.append('tsumego')
    if s.get('open'):
        parts.append('open position')
    if s.get('styleChoice'):
        parts.append('style choice')
    return 'Situation: ' + ', '.join(parts) if parts else ''


def build_prompt(task: dict, text: str) -> str:
    lines = [f'Question: {question_of(task)[:MAX_QUESTION_CHARS] or "(not given)"}']
    sit = situation_line(task)
    if sit:
        lines.append(sit)
    lines += ['Answer:', (text or '').strip()[:MAX_ANSWER_CHARS]]
    return '\n'.join(lines)


def request_body(model: str, system: str, user: str, effort: bool = True) -> dict:
    body = {
        'model': model,
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
        'response_format': {'type': 'json_object'},
        'max_completion_tokens': MAX_TOKENS,
    }
    # Reasoning models spend completion tokens on thinking first: keep that tiny so the JSON fits.
    if effort and (model.startswith('gpt-5') or model[:2] in ('o1', 'o3', 'o4')):
        body['reasoning_effort'] = 'minimal'
    return body


def parse_review(text: str) -> dict | None:
    """{"tone", "warmth", "clarity", "fit"} clamped to 0-10, "note" (one line), "score" (0-1 mean),
    or None when the reply is not that JSON. Ignores any extra fields or prose."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        start, end = (text or '').find('{'), (text or '').rfind('}')
        try:
            data = json.loads(text[start:end + 1]) if start >= 0 else None
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    out = {}
    for k in FIELDS:
        v = data.get(k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return None
        out[k] = round(min(10.0, max(0.0, float(v))), 1)
    note = data.get('note')
    out['note'] = ' '.join(note.split())[:200] if isinstance(note, str) else ''
    out['score'] = round(sum(out[k] for k in FIELDS) / (10 * len(FIELDS)), 4)
    return out


class ToneJudge:
    def __init__(self, cfg, key: str | None = None, post=None, sleep=time.sleep, now=time.time):
        self.cfg = cfg
        self.key = (key if key is not None else os.environ.get('OPENAI_API_KEY', '')).strip()
        self.models = list(dict.fromkeys(m for m in [os.environ.get('OPENAI_MODEL', '').strip()] + list(_chain()) if m))
        self.post = post or _post
        self.sleep, self.now = sleep, now
        self.calls = 0
        self.tokens = {'in': 0, 'out': 0}
        self.model = ''                  # the model that answered last
        self.stopped = '' if self.key else 'no OPENAI_API_KEY'
        self.said = False
        self.last = 0.0
        self.no_effort: set[str] = set()
        self.usage_path = Path(cfg.data_dir) / 'tone-usage.json'

    @property
    def enabled(self) -> bool:
        return not self.stopped

    def say_off(self) -> None:
        """Log once why the tone reviewer is not running."""
        if self.stopped and not self.said:
            self.said = True
            log(f'tone reviewer off: {self.stopped}')

    def _stop(self, why: str) -> None:
        self.stopped, self.said = why, True
        log('tone:', why)

    def _day(self) -> str:
        return time.strftime('%Y-%m-%d', time.localtime(self.now()))

    def _today_used(self) -> int:
        u = read_json(self.usage_path, {}) or {}
        return int(u.get(self._day(), 0))

    def _count_call(self) -> None:
        self.calls += 1
        day = self._day()
        u = read_json(self.usage_path, {}) or {}
        write_json(self.usage_path, {day: int(u.get(day, 0)) + 1})

    def budget_left(self) -> int:
        if not self.enabled:
            return 0
        return max(0, min(self.cfg.tone_cap - self.calls, self.cfg.tone_daily_cap - self._today_used()))

    def score(self, task: dict, text: str) -> dict | None:
        """The tone review of one answer, or None (off, out of budget, refused or a malformed reply)."""
        if not self.enabled:
            self.say_off()
            return None
        if not (text or '').strip():
            return None
        if self.budget_left() <= 0:
            self.stopped = CAP_REACHED
            self.say_off()
            return None
        wait = self.cfg.tone_min_interval - (self.now() - self.last)
        if wait > 0:
            self.sleep(wait)
        system, user = system_prompt(), build_prompt(task, text)
        while self.models:
            if self.budget_left() <= 0:
                self.stopped = CAP_REACHED
                self.say_off()
                return None
            model = self.models[0]
            body = request_body(model, system, user, effort=model not in self.no_effort)
            self.last = self.now()
            self._count_call()
            status, content, info = self.post(body, self.key)
            if status == 200:
                self.model = model
                usage = info.get('usage') or {}
                self.tokens['in'] += int(usage.get('prompt_tokens') or 0)
                self.tokens['out'] += int(usage.get('completion_tokens') or 0)
                review = parse_review(content)
                if review is None:
                    log(f'tone: {model} gave no usable JSON (finish: {info.get("finish")}); skipping this answer')
                return review
            if status == 404 or info.get('code') == 'model_not_found':   # retired or not on this key: next model
                log(f'tone: model {model} is not available; trying the next one')
                self.models.pop(0)
                continue
            if status == 400 and 'reasoning_effort' in body and 'reasoning' in f'{info.get("param")} {info.get("message")}':
                self.no_effort.add(model)
                continue
            if status == 429:
                if info.get('code') == 'insufficient_quota':
                    self._stop('OpenAI says the API account has no credit (insufficient_quota): add billing at '
                               'platform.openai.com (ChatGPT Plus does not include API use); tone review stops for this run')
                else:
                    self._stop('rate limited by OpenAI (429); tone review stops for this run')
                return None
            if status == 401:
                self._stop('OPENAI_API_KEY was refused (401): make a new key at platform.openai.com/api-keys')
                return None
            if status == 403:
                self._stop('OpenAI refused access (403): check the key\'s project permissions or OPENAI_MODEL')
                return None
            log(f'tone: {model} answered {status}; skipping this answer')
            return None
        self._stop('no OpenAI model answered (set OPENAI_MODEL to one your key can use)')
        return None

    def sample(self, groups: list[tuple[dict, list[dict]]], limit: int, rng: random.Random) -> list[tuple[dict, list[dict]]]:
        """Whole tasks (every passing answer of a task, so tone compares like with like) that fit in
        `limit` calls and the budget. Tasks with two or more answers first: there tone can change
        which answer is the better one. Tasks with more than tone_batch answers are skipped."""
        budget = min(limit, self.budget_left())
        order = list(groups)
        rng.shuffle(order)
        order.sort(key=lambda g: len(g[1]) < 2)
        picked, n = [], 0
        for t, a in order:
            if a and len(a) <= self.cfg.tone_batch and n + len(a) <= budget:
                picked.append((t, a))
                n += len(a)
        return picked


def _chain():
    from config import OPENAI_CHAIN
    return OPENAI_CHAIN


def _error_info(e: urllib.error.HTTPError) -> dict:
    """code / param / message of an OpenAI error body ({} when there is none)."""
    try:
        err = json.loads(e.read() or b'{}').get('error') or {}
    except (ValueError, OSError, AttributeError):
        return {}
    if not isinstance(err, dict):
        return {}
    return {'code': err.get('code') or '', 'param': err.get('param') or '', 'message': str(err.get('message') or '')[:300]}


def _post(body: dict, key: str) -> tuple[int, str, dict]:
    """POST one chat completion. Returns (HTTP status, reply text, info: usage and finish, or the error's code)."""
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method='POST')
    req.add_header('content-type', 'application/json')
    req.add_header('authorization', f'Bearer {key}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, '', _error_info(e)
    except (OSError, ValueError):
        return 0, '', {}
    choice = (data.get('choices') or [{}])[0]
    return 200, (choice.get('message') or {}).get('content') or '', {'usage': data.get('usage') or {},
                                                                    'finish': choice.get('finish_reason')}


def check_key(key: str) -> tuple[bool, str]:
    """Cheap key check: list models (free; does not use credit)."""
    req = urllib.request.Request(MODELS_URL)
    req.add_header('authorization', f'Bearer {key}')
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True, 'OpenAI key works (ChatGPT tone reviewer; its calls are billed to that API account)'
    except urllib.error.HTTPError as e:
        return False, f'OpenAI refused the key ({e.code}); make a new one at platform.openai.com/api-keys'
    except OSError as e:
        return False, f'could not reach OpenAI ({e})'
