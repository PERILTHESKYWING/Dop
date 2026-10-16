"""The second teacher: Gemini judges writing quality (clarity, depth, usefulness, and how
well the answer follows XIAO's rubric, eval/coach/rubric.json).

It only ever returns numbers. Its words are thrown away and never become training text;
KataGo's truth check stays the first gate, the judge only orders answers that already passed.

Free-tier friendly: it reads a small sample, several answers to the same task per call, waits
between calls, stops at a hard cap per run (judge_cap) and per day (judge_daily_cap), and stops
for the rest of the run on a rate-limit answer. With no GEMINI_API_KEY it does nothing.
Tip: make the key in its own Google AI Studio project so it does not use the Dop site's quota.
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from pathlib import Path

from util import log, read_json, write_json

RUBRIC_FILE = Path(__file__).resolve().parents[2] / 'eval' / 'coach' / 'rubric.json'


def rubric_text(path: Path = RUBRIC_FILE) -> str:
    """The rubric's rules as numbered lines (same as rubricText in src/lib/coach/rubric.ts), or ''."""
    try:
        rules = json.loads(path.read_text(encoding='utf-8')).get('rules', [])
    except (OSError, ValueError):
        return ''
    out = []
    for i, r in enumerate(rules):
        if isinstance(r, dict) and r.get('text'):
            out.append(f"{i + 1}. {r['text']}{' (most important)' if r.get('weight', 1) >= 3 else ''}")
    return '\n'.join(out)

ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/'

SYSTEM = """You grade answers written by a Go (baduk) teacher for a student.
Grade writing only: the facts were already checked by an engine.
For each answer give three whole numbers from 1 (poor) to 5 (excellent):
- clarity: easy to follow, direct answer first, plain language
- depth: explains why (shape, weak groups, sente and gote, territory and influence, what happens later), not just numbers
- usefulness: a student would learn something they can use in their own games
Reply with JSON only: {"scores": [{"i": 0, "clarity": n, "depth": n, "usefulness": n}, ...]} with one entry per answer."""


def system_prompt(rubric: str | None = None) -> str:
    """SYSTEM, plus the teacher's rubric (and a fourth number for it) when there is one."""
    rubric = rubric_text() if rubric is None else rubric
    if not rubric:
        return SYSTEM
    return (SYSTEM.replace('give three whole numbers', 'give four whole numbers')
            .replace('Reply with JSON only', '- rubric: how well it follows the teacher\'s rubric below\nReply with JSON only')
            .replace('"usefulness": n}', '"usefulness": n, "rubric": n}')
            + '\n\nThe teacher\'s rubric:\n' + rubric)

MAX_PROMPT_CHARS = 6000
MAX_ANSWER_CHARS = 2500


def build_prompt(task: dict, texts: list[str]) -> str:
    parts = ['The teacher was given this question and these checked facts:', task.get('prompt', '')[:MAX_PROMPT_CHARS], '']
    for i, t in enumerate(texts):
        parts += [f'Answer {i}:', t.strip()[:MAX_ANSWER_CHARS], '']
    return '\n'.join(parts)


def parse_scores(text: str, n: int) -> list[float | None]:
    """0-1 score per answer (mean of the three numbers), None when missing. Ignores any prose."""
    out: list[float | None] = [None] * n
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        start, end = (text or '').find('{'), (text or '').rfind('}')
        try:
            data = json.loads(text[start:end + 1]) if start >= 0 else {}
        except json.JSONDecodeError:
            return out
    rows = data.get('scores') if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return out
    for pos, r in enumerate(rows):
        if not isinstance(r, dict):
            continue
        i = r.get('i', pos)
        if not isinstance(i, int) or not 0 <= i < n:
            continue
        nums = []
        for k in ('clarity', 'depth', 'usefulness'):
            v = r.get(k)
            if isinstance(v, (int, float)):
                nums.append(min(5.0, max(1.0, float(v))))
        if len(nums) == 3:
            score = (sum(nums) / 3 - 1) / 4
            rv = r.get('rubric')
            if isinstance(rv, (int, float)):
                # The rubric counts as much as the other three together.
                score = 0.5 * score + 0.5 * (min(5.0, max(1.0, float(rv))) - 1) / 4
            out[i] = round(score, 4)
    return out


class Judge:
    def __init__(self, cfg, key: str | None = None, post=None, sleep=time.sleep, now=time.time):
        self.cfg = cfg
        self.key = (key if key is not None else os.environ.get('GEMINI_API_KEY', '')).strip()
        self.models = [m for m in [os.environ.get('KAMI_JUDGE_MODEL', '').strip()] + list(_chain()) if m]
        self.models = list(dict.fromkeys(self.models))
        self.post = post or _post
        self.sleep, self.now = sleep, now
        self.calls = 0
        self.stopped = '' if self.key else 'no GEMINI_API_KEY'
        self.last = 0.0
        self.usage_path = Path(cfg.data_dir) / 'judge-usage.json'

    @property
    def enabled(self) -> bool:
        return not self.stopped

    def _today_used(self) -> int:
        u = read_json(self.usage_path, {}) or {}
        return int(u.get(time.strftime('%Y-%m-%d', time.localtime(self.now())), 0))

    def _count_call(self) -> None:
        self.calls += 1
        day = time.strftime('%Y-%m-%d', time.localtime(self.now()))
        u = read_json(self.usage_path, {}) or {}
        write_json(self.usage_path, {day: int(u.get(day, 0)) + 1})

    def budget_left(self) -> int:
        if not self.enabled:
            return 0
        return max(0, min(self.cfg.judge_cap - self.calls, self.cfg.judge_daily_cap - self._today_used()))

    def score(self, task: dict, texts: list[str]) -> list[float | None]:
        """Scores for up to judge_batch answers to one task, or Nones when the judge is off or out of budget."""
        texts = texts[: self.cfg.judge_batch]
        none = [None] * len(texts)
        if not texts or self.budget_left() <= 0:
            if self.enabled and self.budget_left() <= 0:
                self.stopped = 'call cap reached'
            return none
        wait = self.cfg.judge_min_interval - (self.now() - self.last)
        if wait > 0:
            self.sleep(wait)
        body = {
            'systemInstruction': {'parts': [{'text': system_prompt()}]},
            'contents': [{'role': 'user', 'parts': [{'text': build_prompt(task, texts)}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0, 'maxOutputTokens': 1024,
                                 'thinkingConfig': {'thinkingLevel': 'low'}},
        }
        while self.models:
            if self.budget_left() <= 0:
                self.stopped = 'call cap reached'
                return none
            model = self.models[0]
            self.last = self.now()
            self._count_call()
            status, text = self.post(model, body, self.key)
            if status == 200:
                return parse_scores(text, len(texts))
            if status == 404:            # retired model id: try the next one
                self.models.pop(0)
                continue
            if status == 400 and 'thinkingConfig' in body['generationConfig']:
                body['generationConfig'].pop('thinkingConfig')
                continue
            if status == 429:
                self.stopped = 'rate limited by Gemini (free tier); judging stops for this run'
                log('judge:', self.stopped)
                return none
            if status in (401, 403):
                self.stopped = 'GEMINI_API_KEY was refused'
                log('judge:', self.stopped)
                return none
            log(f'judge: {model} answered {status}; skipping this batch')
            return none
        self.stopped = 'no Gemini model answered'
        return none

    def sample(self, groups: list[tuple[dict, list[dict]]], share: float, rng: random.Random) -> list[tuple[dict, list[dict]]]:
        """Pick about `share` of the answers, whole tasks at a time, never more batches than the budget."""
        total = sum(len(a) for _t, a in groups)
        want = max(1, round(total * share)) if total else 0
        picked, n = [], 0
        order = list(groups)
        rng.shuffle(order)
        for t, a in order:
            if n >= want or len(picked) >= self.budget_left():
                break
            picked.append((t, a[: self.cfg.judge_batch]))
            n += len(picked[-1][1])
        return picked


def _chain():
    from config import GEMINI_CHAIN
    return GEMINI_CHAIN


def _post(model: str, body: dict, key: str) -> tuple[int, str]:
    """POST one generateContent call. Returns (HTTP status, answer text without thoughts)."""
    req = urllib.request.Request(f'{ENDPOINT}{model}:generateContent', data=json.dumps(body).encode(), method='POST')
    req.add_header('content-type', 'application/json')
    req.add_header('x-goog-api-key', key)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, ''
    except OSError:
        return 0, ''
    cand = (data.get('candidates') or [{}])[0]
    parts = (cand.get('content') or {}).get('parts') or []
    return 200, ''.join(p.get('text', '') for p in parts if not p.get('thought'))


def check_key(key: str) -> tuple[bool, str]:
    """Cheap key check: list models (does not use generation quota)."""
    req = urllib.request.Request(ENDPOINT.rstrip('/') + '?pageSize=1')
    req.add_header('x-goog-api-key', key)
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True, 'Gemini key works'
    except urllib.error.HTTPError as e:
        return False, f'Gemini refused the key ({e.code}); make a new one at aistudio.google.com/apikey'
    except OSError as e:
        return False, f'could not reach Gemini ({e})'
