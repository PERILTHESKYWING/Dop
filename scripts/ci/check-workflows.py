#!/usr/bin/env python3
"""House rules for GitHub Actions workflows, so new ones run as reliably as the old ones.

    python3 scripts/ci/check-workflows.py            # every .github/workflows/*.yml
    python3 scripts/ci/check-workflows.py a.yml ...  # just these

Run by workflow-check.yml on every pull request that touches a workflow; each rule comes from
a real failure (docs/handoff/training.md, "Workflow rules"). Exit code 1 when a rule is broken.
"""
import glob
import re
import sys

import yaml

WRAPPER = 'bash scripts/ci/step.sh {0}'
# The first major of each action that runs on Node 24 (Node 20 is being removed from runners).
MIN_MAJOR = {
    'actions/checkout': 5,
    'actions/setup-node': 5,
    'actions/setup-python': 6,
    'actions/cache': 5,
    'actions/download-artifact': 7,
    'actions/upload-artifact': 6,
}

problems = []


def bad(path, where, msg):
    problems.append(f'{path}: {where}: {msg}')


def check(path):
    with open(path, encoding='utf-8') as f:
        wf = yaml.safe_load(f)
    if not isinstance(wf, dict) or not isinstance(wf.get('jobs'), dict):
        bad(path, 'file', 'no jobs')
        return
    shell = ((wf.get('defaults') or {}).get('run') or {}).get('shell')
    if shell != WRAPPER:
        bad(path, 'defaults', f'set `defaults: run: shell: {WRAPPER}` at the top level')
    for name, job in wf['jobs'].items():
        where = f'job {name}'
        if 'uses' in job:  # a reusable workflow call runs elsewhere
            continue
        runs_on = str(job.get('runs-on', ''))
        if 'latest' in runs_on or not re.match(r'^(ubuntu|windows|macos)-[0-9]', runs_on):
            bad(path, where, f'runs-on `{runs_on}`: pin an image such as ubuntu-24.04 (`-latest` moves to a new OS without warning)')
        if 'timeout-minutes' not in job:
            bad(path, where, 'add timeout-minutes (a stuck job otherwise holds a machine for 6 hours)')
        job_shell = ((job.get('defaults') or {}).get('run') or {}).get('shell')
        uses_wrapper = (job_shell or shell) == WRAPPER
        checked_out = False
        for i, step in enumerate(job.get('steps') or []):
            sw = f'{where}, step {step.get("name") or step.get("uses") or i + 1}'
            uses = step.get('uses', '')
            if uses.startswith('actions/checkout'):
                checked_out = True
            if uses:
                action, _, ref = uses.partition('@')
                if action == 'actions/upload-artifact':
                    bad(path, sw, 'use ./.github/actions/upload (retries a failed upload) instead of actions/upload-artifact')
                m = re.match(r'v(\d+)', ref)
                if action in MIN_MAJOR and (not m or int(m.group(1)) < MIN_MAJOR[action]):
                    bad(path, sw, f'{action} needs @v{MIN_MAJOR[action]} or newer (older majors run on Node 20)')
                if action.startswith('./') and not checked_out:
                    bad(path, sw, 'a local action needs actions/checkout before it')
            if 'run' in step and uses_wrapper and not step.get('shell') and not checked_out:
                bad(path, sw, 'runs before actions/checkout, so scripts/ci/step.sh is not there yet: check out first, '
                    'or give this job `defaults: run: shell: bash -e {0}`')


def main():
    github = '--github' in sys.argv
    paths = [a for a in sys.argv[1:] if a != '--github'] or sorted(glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml'))
    for p in paths:
        try:
            check(p)
        except yaml.YAMLError as e:
            bad(p, 'file', f'not valid YAML: {e}')
    for p in problems:
        print(f'::error::{p}' if github else p)
    print(f'{len(paths)} workflows checked, {len(problems)} problems')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
