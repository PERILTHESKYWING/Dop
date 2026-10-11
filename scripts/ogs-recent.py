#!/usr/bin/env python3
"""
Pick recent rank-labelled games from the OGS archive (za3k.com/ogs: almost every game
played on online-go.com, redistributed with OGS's permission and released into the public
domain by its compiler) for the coach's level estimate.

Reads the "SGFs by date" tar (plain or gzip) from stdin as a stream, so the 89 GB of
games never touch the disk:

    curl -sfL https://za3k.com/ogs/.../sgfs-by-date.tar.gz | pigz -dc \
      | python3 -I scripts/ogs-recent.py --from 2022-01 --per-cell 40 --bots bots.txt --out ogs-recent.jsonl.gz

Kept: 19x19 ranked games at live or rapid speed, no handicap, 100+ moves, a real result,
both players with a settled rank between 18k and 9d, no bots. At most --per-cell games
for each month and rank (a random sample, the same every run), so every rank and every
month is represented. Output: one JSON line per game, {file, b, w, date, src, sgf}, with
b/w the sides' OGS ranks on the app's number line (1k = 0, 1d = 1); scripts/rank-fit.ts
maps OGS ranks onto Fox's.
"""
import argparse
import gzip
import json
import random
import re
import sys
import tarfile
import time
import zlib

ap = argparse.ArgumentParser()
ap.add_argument('--from', dest='start', default='2022-01', help='first month kept, YYYY-MM')
ap.add_argument('--to', dest='end', default='9999-12', help='last month kept, YYYY-MM')
ap.add_argument('--per-cell', type=int, default=40, help='games kept per month and rank')
ap.add_argument('--bots', help='file of bot user names, one per line')
ap.add_argument('--allow-truncated', action='store_true', help='a stream cut short is not an error (smoke tests)')
ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--out', required=True)
args = ap.parse_args()

bots = set()
if args.bots:
    with open(args.bots, encoding='utf-8', errors='replace') as f:
        bots = {l.strip().lower() for l in f if l.strip()}
BOT_NAME = re.compile(r'bot|katago|leela|gnugo|gnu go|pachi|fuego|\bsai\b|elfgo|golaxy|fineart|crazy ?stone', re.I)
PATH = re.compile(r'(\d{4})/(\d{2})/(\d{2})/(\d+)-[^/]*\.sgf$', re.I)
RANK = re.compile(r'^(\d+)([kd])$')


def tag(sgf, key):
    m = re.search(r'(?<![A-Z])' + key + r'\[((?:[^\]\\]|\\.)*)\]', sgf[:4000])
    return m.group(1) if m else None


def rank(raw):
    """'5k' -> -4, '1k' -> 0, '1d' -> 1; None for provisional ('?') or unreadable ranks."""
    m = RANK.match((raw or '').strip().lower())
    if not m:
        return None
    n = int(m.group(1))
    r = 1 - n if m.group(2) == 'k' else n
    return r if -17 <= r <= 9 else None


def is_bot(name):
    return not name or name.strip().lower() in bots or bool(BOT_NAME.search(name))


stats = {}
def skip(why):
    stats[why] = stats.get(why, 0) + 1


rng = random.Random(args.seed)
cells = {}  # (month, rank) -> [seen, kept list]
members = 0
t0 = time.time()
truncated = False
tf = tarfile.open(fileobj=sys.stdin.buffer, mode='r|*')
try:
    for m in tf:
        members += 1
        if members % 1_000_000 == 0:
            print(f'{members:,} files, {time.time() - t0:.0f} s, at {m.name}', file=sys.stderr, flush=True)
        if not m.isfile():
            continue
        p = PATH.search(m.name)
        if not p:
            skip('not a dated game')
            continue
        month = f'{p.group(1)}-{p.group(2)}'
        if month < args.start or month > args.end:
            skip('outside the months')
            continue
        f = tf.extractfile(m)
        sgf = f.read().decode('utf-8', 'replace') if f else ''
        if (tag(sgf, 'SZ') or '19') != '19':
            skip('not 19x19'); continue
        gc = (tag(sgf, 'GC') or '').lower().split(',')
        if 'ranked' not in gc:
            skip('unranked'); continue
        if 'live' not in gc and 'rapid' not in gc:
            skip('blitz or correspondence'); continue
        if (tag(sgf, 'HA') or '0') not in ('0', '1') or re.search(r'(?<![A-Z])AB\[', sgf[:4000]):
            skip('handicap'); continue
        result = tag(sgf, 'RE') or '?'
        if not re.match(r'^[BW]\+(R|T|[\d.]+)$', result):
            skip('no real result'); continue
        if is_bot(tag(sgf, 'PB')) or is_bot(tag(sgf, 'PW')):
            skip('bot'); continue
        b, w = rank(tag(sgf, 'BR')), rank(tag(sgf, 'WR'))
        if b is None or w is None:
            skip('rank unknown or out of range'); continue
        if len(re.findall(r';\s*[BW]\[', sgf)) < 100:
            skip('under 100 moves'); continue
        key = (month, round((b + w) / 2))
        cell = cells.setdefault(key, [0, []])
        cell[0] += 1
        game = {
            'file': f'ogs:{p.group(4)}',
            'b': b,
            'w': w,
            'date': f'{month}-{p.group(3)}',
            'src': 'ogs',
            'sgf': re.sub(r'\s*\n\s*', ' ', sgf.strip()),
        }
        # Reservoir sampling: every game of the cell equally likely to be kept.
        if len(cell[1]) < args.per_cell:
            cell[1].append(game)
        else:
            j = rng.randrange(cell[0])
            if j < args.per_cell:
                cell[1][j] = game
except (tarfile.ReadError, EOFError, zlib.error, OSError) as e:
    truncated = True
    print(f'stream ended early after {members:,} files: {e}', file=sys.stderr)

kept = sorted((g for c in cells.values() for g in c[1]), key=lambda g: g['date'], reverse=True)
with gzip.open(args.out, 'wt', encoding='utf-8') as out:
    for g in kept:
        out.write(json.dumps(g, ensure_ascii=False) + '\n')

found = sum(c[0] for c in cells.values())
print(f'{members:,} files read in {time.time() - t0:.0f} s; {found:,} games fit, {len(kept):,} kept', file=sys.stderr)
for why, n in sorted(stats.items(), key=lambda x: -x[1]):
    print(f'  skipped, {why}: {n:,}', file=sys.stderr)
months = sorted({k[0] for k in cells})
if months:
    print(f'months {months[0]} to {months[-1]}', file=sys.stderr)
by_rank = {}
for (_, r), c in cells.items():
    by_rank[r] = by_rank.get(r, 0) + len(c[1])
print('kept by rank: ' + ' '.join(f'{r}:{n}' for r, n in sorted(by_rank.items())), file=sys.stderr)
if truncated and not args.allow_truncated:
    sys.exit(1)
