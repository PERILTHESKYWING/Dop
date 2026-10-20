# Claude mods for Dop
They only change how Claude works on this repo; the site does not use them.

- `lean-tokens`: refuses whole-file reads of big files (README, lockfile, weights, data, node_modules), quiets `npm install`, caps `git log` at 30, trims very long npm/vitest/tsc/vite output to its start and end.
- `dop-guard`: blocks keys or `VITE_` secrets in source, draft PRs, force-push to main, committing `.env` or stray weights; reminds to bump `ENGINE_FILES` after editing `public/engine`.

No install: both live in `.claude/skills/<name>/`, and Claude Code loads a plugin from the project's skills folder once the workspace is trusted (accept the trust prompt when you first open the repo; run `/reload-plugins` if you accepted it mid-session). `claude plugin list` shows them under "Skills-directory plugins".

**Claude Projects and claude.ai/code cloud sessions skip them.** The cloud container never shows a trust prompt, so the workspace stays untrusted and `claude plugin list` says the 2 skills-directory plugins "were skipped" (checked 2026-10-20; a draft-PR command was not blocked). `.claude/settings.json` (`enabledPlugins`) is ignored there for the same reason. What works: install them at user scope before Claude starts, by adding these lines to the cloud environment's Setup script (Project settings › Environment › Cloud environment › Add cloud environment):
```
claude plugin marketplace add PERILTHESKYWING/Dop
claude plugin install lean-tokens@dop-tools
claude plugin install dop-guard@dop-tools
```
Both mods only act when they block or trim something; they draw nothing on screen, so "not showing" is normal even when they run.

Optional, for use outside this repo (terminal Claude Code):
```
/plugin marketplace add PERILTHESKYWING/Dop
/plugin install lean-tokens@dop-tools
/plugin install dop-guard@dop-tools
```

Checks: `claude plugin validate .claude/skills/<name>` and `claude plugin test .claude/skills/<name>`.
