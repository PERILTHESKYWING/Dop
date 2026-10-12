# Claude mods for Dop
Optional. They only change how Claude works on this repo; the site does not use them.

- `lean-tokens`: refuses whole-file reads of big files (README, lockfile, weights, data, node_modules), quiets `npm install`, caps `git log` at 30, trims very long npm/vitest/tsc/vite output to its start and end.
- `dop-guard`: blocks keys or `VITE_` secrets in source, draft PRs, force-push to main, committing `.env` or stray weights; reminds to bump `ENGINE_FILES` after editing `public/engine`.

Install (a terminal Claude Code session, not the desktop Code tab):
```
/plugin install lean-tokens --marketplace PERILTHESKYWING/Dop
/plugin install dop-guard --marketplace PERILTHESKYWING/Dop
```
Answer `y` to "Add marketplace?", then press Enter to pick the user scope.

The skills in `.claude/skills/` need no install: Claude Code loads them from the repo.
