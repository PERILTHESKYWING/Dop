---
name: dop-lean-session
description: Use at the start of any Dop task to keep the session small, cheap and on target.
---
# Lean session
1. Read `CLAUDE.md` only. Never open `README.md` (24 KB) or `package-lock.json` whole. Open the one `docs/handoff/<topic>.md` that matches the task, or Grep the README for a term. `docs/handoff/project-instructions.md` part 2 is history: open it only when asked what a past thread built.
2. One task per thread. If the message holds several asks, do the first and say the rest should be separate threads, naming which files each owns so they do not collide.
3. Find before reading: Grep or Glob, then Read with offset and limit. Do not read a whole source file to find one function.
4. Do not pull weights, datasets, lockfiles or long logs into context. Summarise with wc, head, jq or grep.
5. Check once at the end (see dop-verify), not after every edit.
6. Reply short, plain, answer first: what changed, check results, the one thing to merge or do. No step-by-step recap.
7. A finished thread leaves anything worth remembering (decision, gotcha) in the matching `docs/handoff/` note in the same PR, not in chat.
