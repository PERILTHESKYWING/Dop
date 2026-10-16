# Kami coach LM trainer

Grows Kami's own small Go-explaining model (default base: Qwen3-1.7B, Apache-2.0) on a home GPU
or a free Kaggle GPU. KataGo does the thinking; the model only learns to turn checked facts into
clear explanations. Setup for people: `docs/handoff/kami-training.md`. Windows one-click:
`public/pc-helper/start-kami-training-windows.bat`.

```
python scripts/coachlm/run.py --check                  # GPU, CUDA, libraries, Node, tokens
python scripts/coachlm/run.py --hours 8 --upload        # train; resumable; Ctrl+C is safe
python scripts/coachlm/run.py --schedule | --unschedule # Windows nightly task (01:00, 6 h)
python scripts/coachlm/export.py                        # champion -> ONNX q4f16/q4 for transformers.js
```

| File | Job |
| --- | --- |
| `config.py` | settings, base model choice, genes, data folder |
| `evolve.py` | the population loop (breed, answer, verify, judge, pool, eval, select, self-play, log) |
| `pool.py` | hivemind pool: append-only good answers and (better, worse) pairs from every member, synced via the `coach-lm` release |
| `merge.py` | fitness-weighted LoRA delta merge (exact, then best rank-r); hive folds and rank changes |
| `generate.py`, `train.py` | transformers + peft answering; trl SFT then DPO (reference = the member's own start) |
| `truth.py` | calls `verify.ts` / `factory.ts` (thread coach/lm-factory) |
| `judge.py` | Gemini writing judge, scores only, capped |
| `tone.py` | optional ChatGPT (OpenAI API) tone reviewer, scores + one note, capped |
| `tone_review.py` | tone report (.md + .json) for an answers JSONL or a critique JSON; `--dry-run` shows the prompts |
| `selfplay.py` | hard-task mining and the question-maker (requests.jsonl) |
| `upload.py`, `release.py` | Hugging Face and GitHub release uploads |

## ChatGPT tone reviewer (optional, paid)
With `OPENAI_API_KEY` set (PC: the .bat asks once and saves it in `%LOCALAPPDATA%\kami-train\.env`; Kaggle: a secret
named `OPENAI_API_KEY`), `tone.py` asks OpenAI's API to score the tone of a few passing answers per generation against
XIAO's tone rules (`eval/coach/rubric.json` rules with `"topic": "tone"`, built-in notes otherwise): `tone`, `warmth`,
`clarity`, `fit` (0-10) and one short note. The 0-1 mean is 20 % of answer quality (`W_TONE`, from the non-rubric part;
the rubric keeps its share). Notes never become training text; eval fitness ignores tone; the website never uses it.
No key: nothing changes.

The API is billed separately from ChatGPT Plus (Plus does not include API use): make a key at
platform.openai.com/api-keys after adding billing, and keep it in the .env or secrets only, never in chat or the repo.
Cost control: `tone_cap` / `tone_daily_cap` (30 / 30; `KAMI_TONE_CAP`, `KAMI_TONE_DAILY_CAP` or `config.json`),
`tone_per_gen` 6, and `OPENAI_MODEL` (default `gpt-5-mini`, falls back to `gpt-4.1-mini`, `gpt-4o-mini`).
```
python scripts/coachlm/tone_review.py critique.json --dry-run      # prompts and token estimate, no key, no call
python scripts/coachlm/tone_review.py gen-answers.jsonl --tasks tasks.jsonl --limit 10
```
Full steps: `docs/handoff/kami-training.md`, "ChatGPT tone reviewer".

Tests (CPU, no network, model faked): `python -m pytest scripts/coachlm/tests`.
`tests/test_tiny_model.py` also runs the real libraries on a tiny local model when they are installed.
