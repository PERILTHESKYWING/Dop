---
name: dop-engine-change
description: Use when touching public/engine, engine/, search, or anything that changes KataGo speed or strength.
---
# Engine change
- Read `docs/handoff/engine.md` first.
- Any change under `public/engine` means bump `ENGINE_FILES` in `src/lib/engine/browserEngine.ts` (Vercel caches /engine for a week).
- Never commit network weights except the bundled `public/models/g170e-b10c128-*.bin.gz`. Update `THIRD_PARTY_NOTICES.md` if a model or dependency is added.
- Measure, do not assume: use Settings > Benchmark or `scripts/ai-eval.ts`. Record before and after numbers from the same machine and settings. Report them honestly, including no gain or a regression.
- Add what you learned (number, gotcha) to `docs/handoff/engine.md` in the same PR.
