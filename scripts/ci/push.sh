#!/usr/bin/env bash
# Pushes the commits a workflow made, rebasing on whatever landed meanwhile (other training
# runs commit to main too). Tries 5 times with growing waits, then fails the step, so a
# result is never silently lost the way the old `for i in 1 2 3 ... done` loops allowed.
for try in 1 2 3 4 5; do
  git pull --rebase -q && git push && exit 0
  echo "push attempt $try failed; trying again"
  sleep $((try * 15))
done
echo "::error::Could not push the results after 5 tries."
exit 1
