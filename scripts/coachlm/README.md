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
| `selfplay.py` | hard-task mining and the question-maker (requests.jsonl) |
| `upload.py`, `release.py` | Hugging Face and GitHub release uploads |

Tests (CPU, no network, model faked): `python -m pytest scripts/coachlm/tests`.
`tests/test_tiny_model.py` also runs the real libraries on a tiny local model when they are installed.
