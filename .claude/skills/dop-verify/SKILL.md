---
name: dop-verify
description: Use before opening any Dop PR to run checks cheaply and catch hard-rule breaks.
---
# Verify
1. While editing, run only what the change touches: `npx vitest run <path-or-name>` or `npx vitest related <file> --run`. Run `npm run typecheck` after type-heavy edits.
2. Once, at the end, run all three: `npm run typecheck`, `npm test`, `npm run build`. Keep output short: `... 2>&1 | tail -40`. Re-run only what failed. Report pass or fail per command.
3. Hard-rule sweep on the diff (`git diff --stat origin/main`):
   - `public/engine` changed: ENGINE_FILES bumped in `src/lib/engine/browserEngine.ts`.
   - Any `.bin.gz` other than `public/models/g170e-b10c128-*.bin.gz`: remove it.
   - `THIRD_PARTY_NOTICES.md` current if a dependency or model was added.
   - `git grep -nE 'VITE_[A-Z_]*(KEY|SECRET|TOKEN)'` returns nothing; no literal keys.
   - New LLM call: see dop-llm-change.
   - No new Vercel config unless unavoidable (then spell out the steps).
4. A speed or strength claim needs a measured before/after (see dop-engine-change). If it did not help, say so.
