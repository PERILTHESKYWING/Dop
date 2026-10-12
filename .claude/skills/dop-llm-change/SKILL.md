---
name: dop-llm-change
description: Use when adding or changing any LLM call, prompt, coach chat, Ask or Forge text in Dop.
---
# LLM change
- Read `docs/handoff/llm.md` first.
- Model is Gemini Flash on the free tier: at most one call per user turn unless the feature truly needs more; reuse cached answers; keep prompts short and send only the numbers needed.
- The LLM explains KataGo's numbers and real data. It never invents positions or analysis; keep or extend the code checker that rejects ungrounded answers.
- Key stays server-side in `api/` (`LLM_API_KEY`, `LLM_MODEL`, `LLM_PROVIDER`). Never `VITE_`, never committed.
- The feature must work with no LLM: show the KataGo-only fallback and test it.
- Update `docs/handoff/llm.md` in the same PR.
