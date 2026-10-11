#!/usr/bin/env bash
# Positions from KataGo's own self-play (katagoarchive.org/kata1, the public training run's
# data, free to download; katagotraining.org asks bulk downloaders to use this archive):
# one of the newest 30 daily files, streamed and cut off once enough rows are kept, so the
# whole file is never downloaded or stored.
#   kata.sh <out.dpd> <max rows> <seed>
set -uo pipefail
OUT=$1; ROWS=$2; SEED=$3
IDX=https://katagoarchive.org/kata1/trainingdata/
LIST=$( (curl -sfL -m 60 "${IDX}index.html" || curl -sfL -m 60 "$IDX") | grep -oE 'href="[^"]*\.(tgz|tar\.gz|tar|tar\.bz2)"' | sed -E 's/^href="(\.\/)?//; s/"$//' | sort -u)
if [ -z "$LIST" ]; then
  echo "::warning::katagoarchive.org lists no training data files; no KataGo self-play positions this run."
  exit 0
fi
echo "$LIST" | tail -n 3
FILE=$(echo "$LIST" | tail -n 30 | shuf -n 1 --random-source=<(yes "$SEED"))
case "$FILE" in http*) URL=$FILE ;; *) URL=$IDX$FILE ;; esac
echo "reading $URL"
curl -sfL --speed-limit 50000 --speed-time 120 "$URL" \
  | python3 -I scripts/student/kata_npz.py --tar - --max-rows "$ROWS" --keep 0.1 --seed "$SEED" --out "$OUT"
CODE=${PIPESTATUS[1]}
[ "$CODE" = 0 ] || { echo "::warning::no KataGo self-play positions read from $URL"; rm -f "$OUT"; }
exit 0
