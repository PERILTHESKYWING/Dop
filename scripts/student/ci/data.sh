#!/usr/bin/env bash
# The training window from the "ai-training" release: the newest label parts plus a random
# sample of older ones (the whole history would not fit on a machine).
#   data.sh <newest> <older> <seed>  -> labels/*.dpd, val.dpd (when there is one)
set -euo pipefail
NEW=$1; OLD=$2; SEED=$3
mkdir -p labels
ASSETS=$(gh release view ai-training --json assets -q '.assets[] | [.createdAt, .name] | @tsv' 2>/dev/null | sort -r || true)
PARTS=$(echo "$ASSETS" | awk -F'\t' '$2 ~ /^labels-.*\.dpd\.gz$/ {print $2}')
PICK=$( { echo "$PARTS" | head -n "$NEW"; echo "$PARTS" | tail -n +$((NEW + 1)) | shuf --random-source=<(yes "$SEED") | head -n "$OLD"; } | grep . || true)
for f in $PICK; do gh release download ai-training -p "$f" -D labels --clobber; done
for f in labels/*.gz; do [ -e "$f" ] && gunzip -f "$f"; done
gh release download ai-training -p val.dpd.gz -D . --clobber 2>/dev/null && gunzip -f val.dpd.gz || true
echo "training window: $(ls labels | wc -l) parts, $(du -sh labels | cut -f1)"
