"""Review the tone of Kami's answers with ChatGPT (OpenAI's API) and write a short report.

    python scripts/coachlm/tone_review.py answers.jsonl              # tasks and/or answers, one JSON per line
    python scripts/coachlm/tone_review.py critique.json              # Kami's critique batch {"items": [...]}
    python scripts/coachlm/tone_review.py gen-answers.jsonl --tasks tasks.jsonl
    python scripts/coachlm/tone_review.py answers.jsonl --dry-run    # print the prompts: no API call, no key needed

Each line (or critique item) can carry the answer as "text", "answer" (a string, or
{"summary", "sections": [{"title", "text"}]}) or a task's "reference"; the question comes from
"question", the task's explanation or the "Question:" line of its prompt, and the situation
from "situation" or explanation.situation. Writes <out>.json and <out>.md (default: tone-review
in the data folder), lowest tone first.

Scores and one note per answer only: nothing here writes training text, and the website never
uses it. The same caps as training apply (tone_cap per run, tone_daily_cap per day, shared with
the trainer's count), and OPENAI_API_KEY is read from the environment or the data folder's .env.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from config import load_config, load_env_file  # noqa: E402
from tone import (FIELDS, MAX_TOKENS, ToneJudge, build_prompt, question_of, situation_line, situation_of,  # noqa: E402
                  system_prompt)
from util import log, read_jsonl  # noqa: E402


def sections_text(d: dict) -> str:
    """summary + sections as one text (same as referenceOf in scripts/coachlm/tasks.ts)."""
    parts = [str(d.get('summary') or '').strip()]
    for s in d.get('sections') or []:
        if isinstance(s, dict):
            parts.append(f'{str(s.get("title") or "").strip()}\n{str(s.get("text") or "").strip()}'.strip())
    return '\n\n'.join(p for p in parts if p)


def answer_text(r: dict) -> str:
    """The answer to review: its own text first, the engine's reference last."""
    for k in ('text', 'answer', 'reference'):
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            t = sections_text(v)
            if t:
                return t
    c = r.get('concept')
    if isinstance(c, dict):        # a critique concept item: the library's own text
        return sections_text({'summary': c.get('short'), 'sections': c.get('body')})
    return ''


def read_rows(path: Path) -> list:
    """Rows of a JSONL (.jsonl / .jsonl.gz) file, or of a JSON file ({"items": [...]}, a list, or one object)."""
    if path.suffix == '.json':
        data = json.loads(path.read_text(encoding='utf-8'))
        if isinstance(data, dict) and isinstance(data.get('items'), list):
            return data['items']
        return data if isinstance(data, list) else [data]
    return list(read_jsonl(path))


def load_items(path: Path, tasks_path: Path | None = None) -> list[dict]:
    """Normalised items {"id", "question", "situation", "kind", "text"} (question and situation may be empty)."""
    tasks = {t['id']: t for t in read_jsonl(tasks_path) if isinstance(t, dict) and 'id' in t} if tasks_path else {}
    items = []
    for i, r in enumerate(read_rows(path)):
        if not isinstance(r, dict):
            continue
        ctx = dict(tasks.get(r.get('id'), {}))
        if isinstance(r.get('task'), dict):
            ctx.update(r['task'])
        ctx.update({k: r[k] for k in ('question', 'situation', 'kind', 'prompt', 'explanation') if r.get(k) is not None})
        if not ctx.get('situation') and isinstance(r.get('answer'), dict) and isinstance(r['answer'].get('situation'), dict):
            ctx['situation'] = r['answer']['situation']
        rid = str(r.get('id', ctx.get('id', i + 1)))
        if r.get('member'):
            rid += f' {r["member"]}'
        items.append({'id': rid, 'question': question_of(ctx), 'situation': situation_of(ctx), 'kind': ctx.get('kind'),
                      'text': answer_text(r)})
    return items


def _cell(s) -> str:
    return ' '.join(str(s).split()).replace('|', '\\|')


def write_report(out: Path, report: dict) -> tuple[Path, Path]:
    out.parent.mkdir(parents=True, exist_ok=True)
    jp, mp = out.with_name(out.name + '.json'), out.with_name(out.name + '.md')
    jp.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
    done = [x for x in report['items'] if x.get('tone') is not None]
    lines = ['# Kami tone review', '',
             f'{report["made"]} · model {report["model"] or "-"} · {len(done)} of {len(report["items"])} answers reviewed '
             f'(caps: {report["caps"]["perRun"]} per run, {report["caps"]["perDay"]} per day) · input `{report["input"]}`']
    if report['stopped']:
        lines.append(f'Stopped early: {report["stopped"]}')
    if report['mean']:
        lines += ['', 'Mean (0-10): ' + ', '.join(f'{k} {report["mean"][k]}' for k in FIELDS)]
    lines += ['', 'Scores from ChatGPT, read against XIAO\'s tone rules; numbers and notes only, never training text. Lowest tone first.', '',
              '| Id | Question | Situation | Tone | Warmth | Clarity | Fit | Note |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for x in sorted(done, key=lambda x: (x['tone'], x['score'])):
        lines.append(f'| {_cell(x["id"])} | {_cell(x["question"])[:80]} | {_cell(x["situation"])} | {x["tone"]:g} | '
                     f'{x["warmth"]:g} | {x["clarity"]:g} | {x["fit"]:g} | {_cell(x["note"])} |')
    left = len(report['items']) - len(done)
    if left:
        lines += ['', f'{left} answer(s) not reviewed (cap reached, key refused, or no usable reply): run again tomorrow or raise the caps.']
    mp.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return jp, mp


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Review the tone of Kami's answers with ChatGPT (OpenAI API): scores and one note each")
    ap.add_argument('input', help='JSONL of tasks/answers (.jsonl, .jsonl.gz) or a Kami critique JSON ({"items": [...]})')
    ap.add_argument('--tasks', help='tasks JSONL to look questions up by id (for answer files like gen-answers.jsonl)')
    ap.add_argument('--out', help='report path without extension (default: tone-review in the data folder)')
    ap.add_argument('--limit', type=int, help='review at most this many answers (the caps still apply)')
    ap.add_argument('--data-dir', help='data folder (default %%LOCALAPPDATA%%\\kami-train or ~/.kami-train)')
    ap.add_argument('--dry-run', action='store_true', help='print the prompts and stop: no API call, no key needed')
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(errors='replace')     # emoji in a log file on Windows must not crash it
    except AttributeError:
        pass

    cfg = load_config(Path(a.data_dir) if a.data_dir else None)
    items = [x for x in load_items(Path(a.input), Path(a.tasks) if a.tasks else None) if x['text']]
    if a.limit is not None:
        items = items[: max(0, a.limit)]
    if not items:
        print(f'No answers found in {a.input}.')
        return 1

    if a.dry_run:
        system = system_prompt()
        users = [build_prompt(x, x['text']) for x in items]
        print('--- system prompt (sent with every call) ---\n' + system)
        for x, u in zip(items, users):
            print(f'\n--- user prompt: {x["id"]} ---\n{u}')
        chars = len(system) * len(users) + sum(len(u) for u in users)
        print(f'\nDry run: nothing was sent. {len(users)} call(s), about {chars // 4} input tokens in all (characters / 4), '
              f'each reply at most {MAX_TOKENS} tokens. A real run reviews at most '
              f'{min(len(users), cfg.tone_cap, cfg.tone_daily_cap)} (tone_cap {cfg.tone_cap} per run, '
              f'tone_daily_cap {cfg.tone_daily_cap} per day).')
        return 0

    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    load_env_file(cfg.path('.env'))
    judge = ToneJudge(cfg)
    if not judge.enabled:
        print(f'Tone review is off: {judge.stopped}.\n'
              f'Add a line OPENAI_API_KEY=<your key> to {cfg.path(".env")} (or set it in the environment).\n'
              'Make the key at platform.openai.com/api-keys; the API needs its own billing (ChatGPT Plus does not include it).\n'
              'Steps: docs/handoff/kami-training.md, "ChatGPT tone reviewer". --dry-run shows the prompts without a key.')
        return 1

    out_items = []
    for i, x in enumerate(items, 1):
        base = {'id': x['id'], 'question': x['question'], 'situation': situation_line(x).removeprefix('Situation: ')}
        r = judge.score(x, x['text']) if judge.enabled else None
        out_items.append({**base, **(r or {f: None for f in FIELDS})})
        if r is not None:
            log(f'{i}/{len(items)} {x["id"]}: tone {r["tone"]:g}, warmth {r["warmth"]:g}, clarity {r["clarity"]:g}, '
                f'fit {r["fit"]:g}. {r["note"]}')
    done = [x for x in out_items if x.get('tone') is not None]
    mean = {k: round(sum(x[k] for x in done) / len(done), 1) for k in FIELDS} if done else None
    report = {'made': time.strftime('%Y-%m-%d %H:%M'), 'input': str(a.input), 'model': judge.model,
              'caps': {'perRun': cfg.tone_cap, 'perDay': cfg.tone_daily_cap}, 'calls': judge.calls, 'tokens': judge.tokens,
              'reviewed': len(done), 'stopped': '' if judge.enabled else judge.stopped, 'mean': mean, 'items': out_items}
    jp, mp = write_report(Path(a.out) if a.out else cfg.path('tone-review'), report)
    print(f'\nReviewed {len(done)} of {len(items)} answers with {judge.calls} call(s) '
          f'({judge.tokens["in"]} input + {judge.tokens["out"]} output tokens).\nReport: {mp}\n        {jp}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
