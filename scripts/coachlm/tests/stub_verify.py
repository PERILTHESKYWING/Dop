"""Stands in for scripts/coachlm/verify.ts in tests: same flags, same file formats.

An answer "invents" a fact when it mentions Z99 (truth 0, fails); coverage grows with length;
depth is higher when it explains ("because"). Each call is counted in $STUB_COUNT if set."""
import argparse
import gzip
import json
import os
import sys

ap = argparse.ArgumentParser()
ap.add_argument('--tasks', required=True)
ap.add_argument('--answers', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()

if os.environ.get('STUB_COUNT'):
    with open(os.environ['STUB_COUNT'], 'a') as f:
        f.write('1\n')
if os.environ.get('STUB_FAIL'):
    print('KataGo crashed (stub)', file=sys.stderr)
    sys.exit(3)

opener = gzip.open if a.tasks.endswith('.gz') else open
with opener(a.tasks, 'rt', encoding='utf-8') as f:
    ids = {json.loads(l)['id'] for l in f if l.strip()}
with open(a.answers, encoding='utf-8') as f, open(a.out, 'w', encoding='utf-8') as o:
    for line in f:
        if not line.strip():
            continue
        r = json.loads(line)
        if r['id'] not in ids:
            continue
        bad = 'Z99' in r['text']
        s = {'id': r['id'], 'member': r['member'], 'truth': 0.0 if bad else 1.0,
             'coverage': min(1.0, len(r['text']) / 200), 'depth': 0.6 if 'because' in r['text'] else 0.1,
             'unsupported': ['Z99'] if bad else [], 'pass': not bad}
        o.write(json.dumps(s) + '\n')
