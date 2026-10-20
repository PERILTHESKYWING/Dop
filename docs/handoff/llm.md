# LLM usage
Summary: Gemini Flash (free tier) explains numbers that KataGo and the data supply; code checks its claims.

- Proxy: `api/llm.ts` → `shared/llmServer.ts`, task-based (`ask-position`, `chat`, `forge-problems`, ...). Env: `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`.
- Pattern everywhere: gather KataGo/pro/user-stat facts in the browser first, one model call, a code checker (`shared/chat.ts` checkAnswer, `shared/ask.ts`) verifies coordinates and figures, at most one correction round.
- Coach chat `#/chat`: up to 3 extra KataGo probes batched, then a final call; Deep mode adds a review pass only when there are checkable claims.
- Forge problems: positions come only from KataGo-verified `public/problems/bank.json`; the LLM writes text in one batched call per set (`shared/forgeWriter.ts`), with fallback text when no LLM.
- Never tested against real Gemini from the sandbox (no key); tests stub `/api/llm`.
- Kami (`kami/`): task `kami-write` in `shared/kami.ts`, see `kami.md`. Only the ultraGO thinking level calls it (one call per answer). Since 2026-10-20 the prompt asks for Kiai's own engine voice (the draft's sentences and order, only clearer; no chat habits, no clause dashes, emoji only where the draft has one), and `kiaiVoice` in `kami/src/lib/writer.ts` strips assistant openers/closers and dashes before `checkAnswer`. XIAO: never show the provider's name in the app.
