# DOPPELGÄNGER (Dop)

Local-first Go training site: in-browser KataGo analyses the user's SGFs, models how they play (their "copy"), and trains their weak decisions. Main features now: the free AI study board and Doppelgänger. Owner: XIAO (GitHub PERILTHESKYWING).

Stack: React 19 + TypeScript + Vite, zustand, IndexedDB (idb), Web Workers, KataGo compiled to WASM (`engine/`), Vercel serverless `api/` (LLM proxy, accounts). Heavy jobs run in GitHub Actions.

## Hard rules
- LLM is Gemini **Flash on the free tier**; minimise calls per turn. Key stays server-side (`LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`), never `VITE_`, never committed. The app must work with no LLM.
- The LLM explains KataGo's numbers; it never invents positions or analysis.
- Never commit network weights except the bundled `public/models/g170e-b10c128-*.bin.gz`. Keep `THIRD_PARTY_NOTICES.md` current.
- Hosting is Vercel Hobby (free) and XIAO finds Vercel setup hard: avoid new config, spell out any step.
- Bump `ENGINE_FILES` whenever `public/engine` changes (Vercel caches /engine for a week).
- Measure speed/strength claims (scripts/ai-eval.ts, Settings › Benchmark) and report honest numbers.
- PRs: mark ready (not draft) once built and tested.

## Checks
`npm run typecheck`, `npm test`, `npm run build`.

## More context (open only when relevant)
`README.md` is the full feature/engine/deploy guide (long). Short topic notes in `docs/handoff/`:
- `ux.md` board screens and UI decisions
- `engine.md` WASM engine, search, speed work
- `llm.md` coach chat, Ask, Forge text
- `training.md` Actions workflows and releases
- `data.md` game datasets and their limits
- `open-items.md` unfinished or unverified things
- `project-instructions.md` paste-ready project instructions + thread/PR history
