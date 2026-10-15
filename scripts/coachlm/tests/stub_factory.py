"""Stands in for scripts/coachlm/factory.ts in tests: --requests makes one task per request."""
import argparse
import json

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--n', type=int)
ap.add_argument('--requests')
ap.add_argument('--minutes', type=int)
a = ap.parse_args()

rows = []
if a.requests:
    with open(a.requests, encoding='utf-8') as f:
        for i, line in enumerate(l for l in f if l.strip()):
            r = json.loads(line)
            q = r['question']
            rows.append({'id': f'{r["taskId"]}-sp{i}-{q["move"]}', 'promptVersion': 1, 'kind': 'position', 'split': 'train',
                         'system': 'You are Kami.', 'prompt': f'Question: {q["text"]}', 'reference': f'{q["move"]} is fine because.',
                         'concept': None, 'explanation': {}})
else:
    for i in range(a.n or 10):
        rows.append({'id': f'made-{i:03d}', 'promptVersion': 1, 'kind': 'position', 'split': 'eval' if i % 5 == 0 else 'train',
                     'system': 'You are Kami.', 'prompt': f'Question: task {i}', 'reference': f'Answer {i} because.',
                     'concept': None, 'explanation': {}})
with open(a.out, 'w', encoding='utf-8') as f:
    for r in rows:
        f.write(json.dumps(r) + '\n')
