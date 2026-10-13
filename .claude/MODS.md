# Claude mods for Dop
They only change how Claude works on this repo; the site does not use them.

- `lean-tokens`: refuses whole-file reads of big files (README, lockfile, weights, data, node_modules), quiets `npm install`, caps `git log` at 30, trims very long npm/vitest/tsc/vite output to its start and end.
- `dop-guard`: blocks keys or `VITE_` secrets in source, draft PRs, force-push to main, committing `.env` or stray weights; reminds to bump `ENGINE_FILES` after editing `public/engine`.

No install: both live in `.claude/skills/<name>/`, and Claude Code loads a plugin from the project's skills folder once the workspace is trusted (accept the trust prompt when you first open the repo; run `/reload-plugins` if you accepted it mid-session). `claude plugin list` shows them under "Skills-directory plugins".

Optional, for use outside this repo (terminal Claude Code):
```
/plugin install lean-tokens --marketplace PERILTHESKYWING/Dop
/plugin install dop-guard --marketplace PERILTHESKYWING/Dop
```

Checks: `claude plugin validate .claude/skills/<name>` and `claude plugin test .claude/skills/<name>`.
