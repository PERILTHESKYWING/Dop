# DOPPELGÄNGER (Dop)

Local-first Go training site: in-browser KataGo analyses the user's SGFs, models how they play (their "copy"), and trains their weak decisions. Main features now: the free AI study board and Doppelgänger. Owner: XIAO (GitHub PERILTHESKYWING).

Stack: React 19 + TypeScript + Vite, zustand, IndexedDB (idb), Web Workers, KataGo compiled to WASM (`engine/`), Vercel serverless `api/` (LLM proxy, accounts). Heavy jobs run in GitHub Actions.

## Hard rules
- LLM is Gemini **Flash on the free tier**; minimise calls per turn. Key stays server-side (`LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`), never `VITE_`, never committed. The app must work with no LLM.
- The LLM explains KataGo's numbers; it never invents analysis or board features (no made-up walls or stones). A position built to explain an idea is shown only after code checks and a final KataGo read (docs/handoff/kami-diagrams.md).
- ChatGPT (OpenAI API, `OPENAI_API_KEY`) is a training-only tone reviewer (`scripts/coachlm/tone.py`); the sites never call it.
- Never commit network weights except the bundled `public/models/g170e-b10c128-*.bin.gz`. Keep `THIRD_PARTY_NOTICES.md` current.
- Hosting is Vercel Hobby (free) and XIAO finds Vercel setup hard: avoid new config, spell out any step.
- Vercel Hobby allows about 100 deployments a day across Dop, Kami and the hub, and every push builds all three. Push once per thread when the work is done, never after each edit (details: `hub-cloud.md`).
- Bump `ENGINE_FILES` whenever `public/engine` changes (Vercel caches /engine for a week).
- Measure speed/strength claims (scripts/ai-eval.ts, Settings › Benchmark) and report honest numbers.
- PRs: mark ready (not draft) once built and tested.

## Checks
`npm run typecheck`, `npm test`, `npm run build`.

## More context (open only when relevant)
New session? Start with `docs/handoff/START-HERE.md` (state, checklist, next steps).

`README.md` is the full feature/engine/deploy guide (long). Short topic notes in `docs/handoff/`:
- `ux.md` board screens and UI decisions
- `engine.md` WASM engine, search, speed work
- `llm.md` coach chat, Ask, Forge text
- `training.md` Actions workflows and releases
- `data.md` game datasets and their limits
- `doppel.md` how the copy plays, its mistakes, evolution, measurements
- `open-items.md` unfinished or unverified things
- `kami.md` + `kami-*.md` Kami site, explain engine, factory, trainer, library
- `studio.md` storytime animation studio in the hub (backend, tools, nightly learning)
- `hub-cloud.md` Dop hub on Vercel (hub/): coordinator, threads, every account and device; `hub.md` the PC-only version (tools/hub/); `hub-split.md` using the hub for other projects or moving it to its own repo
- `project-instructions.md` paste-ready project instructions + thread/PR history
- `.claude/skills/` task checklists (lean session, verify, ship PR, engine change, LLM change, and `/clarify`, which asks 5+ questions in one batch before a task) and two hook mods, `lean-tokens` and `dop-guard`, that load on their own (see `.claude/MODS.md`)
