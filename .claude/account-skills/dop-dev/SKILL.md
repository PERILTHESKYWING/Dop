---
name: dop-dev
description: Use for any work on the Dop / Kiai Go training site (KataGo, Doppelgänger, Kami/Kiai, coach LLM) to follow its hard rules, keep the session lean, verify and ship a ready PR.
---
# Dop development

Repo: https://github.com/PERILTHESKYWING/Dop (owner XIAO). React 19 + TypeScript + Vite, zustand, IndexedDB, Web Workers, KataGo compiled to WASM (`engine/`), Vercel serverless `api/`. If the repo is checked out, its `CLAUDE.md` and `.claude/skills/` win over this file where they differ.

## Hard rules (always)
- LLM is Gemini Flash on the free tier: at most one call per user turn unless truly needed; reuse cached answers; short prompts with only the numbers needed.
- Keys stay server-side (`LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`, `OPENAI_API_KEY`): never `VITE_`, never in source, never committed, never asked for in chat. The app must work with no LLM.
- The LLM explains KataGo's numbers; it never invents analysis, stones or walls. A built position is shown only after code checks and a final KataGo read.
- ChatGPT/OpenAI is a training-only tone reviewer; the sites never call it.
- Never commit network weights except `public/models/g170e-b10c128-*.bin.gz`. Keep `THIRD_PARTY_NOTICES.md` current.
- Vercel Hobby (free); XIAO finds Vercel setup hard: avoid new config, spell out every click if one is unavoidable.
- Any change under `public/engine`: bump `ENGINE_FILES` in `src/lib/engine/browserEngine.ts` (Vercel caches /engine for a week).
- Speed or strength claims need measured before/after numbers (`scripts/ai-eval.ts`, Settings > Benchmark), same machine and settings. Report no gain or a regression honestly.
- No force-push to main; never commit `.env` (only `.env.example`).
- Ask first before anything that costs money, deletes data or changes production settings.

## Lean session
1. Read `CLAUDE.md` only. Never open `README.md` or `package-lock.json` whole. Open the one `docs/handoff/<topic>.md` that matches (ux, engine, llm, training, data, doppel, kami*, open-items) or Grep for a term.
2. Find before reading: Grep or Glob, then Read with offset and limit.
3. Keep weights, datasets, lockfiles and long logs out of context: summarise with wc, head, jq, grep; pipe long npm/vitest/tsc/vite output through `tail -40`; cap `git log` with `-n 30`; run `npm install --no-audit --no-fund --loglevel=error`.
4. One task per thread; split extra asks and name which files each owns.

## Engine or LLM change
- Engine: read `docs/handoff/engine.md`, measure, bump ENGINE_FILES, log the numbers in that note in the same PR.
- LLM: read `docs/handoff/llm.md`, keep or extend the code checker that rejects ungrounded answers, test the no-LLM fallback, update the note.

## Verify (once, at the end)
- While editing: `npx vitest run <path>` for the touched code only.
- Before the PR: `npm run typecheck`, `npm test`, `npm run build`, each `2>&1 | tail -40`; report pass or fail per command.
- Sweep the diff: ENGINE_FILES bumped if `public/engine` changed; no stray `.bin.gz`; `git grep -nE 'VITE_[A-Z_]*(KEY|SECRET|TOKEN)'` empty; no new Vercel config.

## Ship
1. Branch from fresh main, one topic per PR, small clear commits, `git push -u origin <branch>`.
2. Open the PR **ready for review, never draft** (GitHub MCP `create_pull_request` with `draft: false`, or `gh api repos/PERILTHESKYWING/Dop/pulls ...` without `draft=true`).
3. Body: Before, After, How, Checks. Plain words.
4. Leave decisions and gotchas in the matching `docs/handoff/` note in the same PR.
5. Tell XIAO in one line what to merge and any click they must do.

## Replies
Short, plain, answer first: what changed, check results, the one thing to do next.
