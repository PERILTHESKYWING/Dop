"""The first teacher: KataGo's truth, through the factory's Node CLIs (thread "coach/lm-factory").

  verify: npx tsx scripts/coachlm/verify.ts --tasks <file> --answers answers.jsonl --out scores.jsonl
          answers {"id", "member", "text"} -> scores {"id", "member", "truth", "coverage", "depth", "unsupported", "pass"}
  factory: npx tsx scripts/coachlm/factory.ts --out tasks.jsonl [--n 200] [--requests requests.jsonl] [--minutes 30]

Several answers to one task by one member are told apart by the member field
("<member>~<sample>"); verify echoes it back unchanged. Verification is required: without
Node or verify.ts the loop stops with a plain message instead of training on unchecked text.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from util import log, read_jsonl, write_jsonl


class VerifyError(RuntimeError):
    pass


def tag_member(member: str, sample: int) -> str:
    return f'{member}~{sample}'


def untag_member(tagged: str) -> tuple[str, int]:
    m, _, s = tagged.rpartition('~')
    if not m:
        return tagged, 0
    try:
        return m, int(s)
    except ValueError:
        return tagged, 0


def _resolve(cmd: list[str]) -> list[str]:
    """On Windows `npx` is npx.cmd; shutil.which finds the real file."""
    exe = shutil.which(cmd[0]) or cmd[0]
    return [exe, *cmd[1:]]


def node_status(cfg) -> tuple[bool, str]:
    node = shutil.which('node')
    if not node:
        return False, 'Node.js is not installed (needed for the KataGo truth check). Install the LTS version from nodejs.org'
    try:
        out = subprocess.run([node, '--version'], capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        return False, f'Node.js did not start ({e})'
    m = re.match(r'v(\d+)', out)
    if not m or int(m.group(1)) < 20:
        return False, f'Node.js {out or "?"} is too old; install version 20 or newer from nodejs.org'
    script = Path(cfg.repo_root) / 'scripts' / 'coachlm' / 'verify.ts'
    if not script.exists() and cfg.verify_cmd[:2] == ('npx', '--yes'):
        return False, f'{script} is missing: update the repo checkout (git pull) once the factory is merged'
    return True, f'Node.js {out}'


def run_cli(cmd: list[str], cfg, timeout: float, what: str) -> None:
    try:
        p = subprocess.run(_resolve(list(cmd)), cwd=str(cfg.repo_root), capture_output=True, text=True,
                           timeout=timeout, encoding='utf-8', errors='replace')
    except FileNotFoundError as e:
        raise VerifyError(f'{what} could not start ({e}). Is Node.js installed?') from e
    except subprocess.TimeoutExpired as e:
        raise VerifyError(f'{what} took longer than {int(timeout)} s') from e
    if p.returncode != 0:
        tail = '\n'.join((p.stderr or p.stdout or '').strip().splitlines()[-8:])
        raise VerifyError(f'{what} failed (exit {p.returncode}):\n{tail}')


def verify(answers: list[dict], tasks_file: Path, work: Path, cfg, tag: str = 'train') -> list[dict | None]:
    """Scores for `answers` ({"id", "member", "text"}), in the same order (None if verify skipped one).

    Reuses an existing scores file for the same answers, so a restarted run does not re-check.
    """
    work = Path(work)
    a_path, s_path = work / f'answers-{tag}.jsonl', work / f'scores-{tag}.jsonl'
    if not answers:
        return []
    have = {(s['id'], s['member']): s for s in read_jsonl(s_path)} if s_path.exists() else {}
    if not all((a['id'], a['member']) in have for a in answers):
        write_jsonl(a_path, ({'id': a['id'], 'member': a['member'], 'text': a['text']} for a in answers))
        cmd = list(cfg.verify_cmd) + ['--tasks', str(tasks_file), '--answers', str(a_path), '--out', str(s_path)]
        log(f'checking {len(answers)} answers against KataGo\'s facts')
        run_cli(cmd, cfg, timeout=max(600, 2 * len(answers)), what='verify.ts')
        have = {(s['id'], s['member']): s for s in read_jsonl(s_path)}
    out = [have.get((a['id'], a['member'])) for a in answers]
    missing = sum(1 for s in out if s is None)
    if missing == len(out):
        raise VerifyError('verify.ts returned no scores for these answers (does it match the task file?)')
    if missing:
        log(f'verify.ts skipped {missing} of {len(out)} answers; they count as unchecked')
    return out


def make_tasks(cfg, out: Path, n: int | None = None, requests: Path | None = None, minutes: int | None = None) -> Path:
    cmd = list(cfg.factory_cmd) + ['--out', str(out)]
    if n:
        cmd += ['--n', str(n)]
    if requests:
        cmd += ['--requests', str(requests)]
    if minutes:
        cmd += ['--minutes', str(minutes)]
    run_cli(cmd, cfg, timeout=(minutes or 30) * 60 + 300, what='factory.ts')
    return out
