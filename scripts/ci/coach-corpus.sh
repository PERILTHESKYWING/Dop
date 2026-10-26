#!/usr/bin/env bash
# Puts everything the coach training has measured into corpus/ (coach-training.yml).
# From the "coach-data" release when it exists; from the seed in data/coach/seed only when
# the release has never been made. A download that fails is retried and then fails the step,
# so a network blip can never make the run start over from the seed (and later overwrite the
# stored corpus with it). Sets CORPUS_FROM=release|seed for later steps.
set -e
mkdir -p corpus
if gh release view coach-data > /dev/null 2>&1 || gh release view coach-data > /dev/null 2>&1; then
  for i in 1 2 3 4 5; do
    gh release download coach-data -p coach-corpus.tar.gz -D . --clobber && break
    [ "$i" = 5 ] && { echo "::error::Could not download coach-corpus.tar.gz from the coach-data release."; exit 1; }
    sleep $((i * 20))
  done
  tar xzf coach-corpus.tar.gz
  FROM=release
else
  gunzip -c data/coach/seed/rank.jsonl.gz > corpus/rank.jsonl
  gunzip -c data/coach/seed/moves.jsonl.gz > corpus/moves.jsonl
  FROM=seed
fi
# Professional, top professional and AI games measured when the 10d-12d scale was added.
FIRST=$(gunzip -c data/coach/seed/elite.jsonl.gz | grep -m 1 -o '"file":"[^"]*"' || true)
grep -qF "$FIRST" corpus/rank.jsonl || gunzip -c data/coach/seed/elite.jsonl.gz >> corpus/rank.jsonl
[ -n "$GITHUB_ENV" ] && echo "CORPUS_FROM=$FROM" >> "$GITHUB_ENV"
echo "corpus from the $FROM:"
wc -l corpus/*.jsonl
