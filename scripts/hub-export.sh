#!/usr/bin/env bash
# Copy the hub (hub/, with its history) into its own repository.
#   bash scripts/hub-export.sh                      makes the branch hub-standalone (hub/ at the root)
#   bash scripts/hub-export.sh <new-repo-git-url>   also pushes it there as main
# Dop itself is not changed. Steps around it: docs/handoff/hub-split.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git branch -D hub-standalone >/dev/null 2>&1 || true
git subtree split --prefix=hub -b hub-standalone
echo "Made branch hub-standalone: $(git rev-list --count hub-standalone) commits, hub/ at its root."
if [ $# -ge 1 ]; then
  git push "$1" hub-standalone:main
  echo "Pushed to $1 (branch main)."
else
  echo "To push it: bash scripts/hub-export.sh https://github.com/<you>/<new-repo>.git"
fi
