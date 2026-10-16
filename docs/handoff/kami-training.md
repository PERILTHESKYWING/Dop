# Kami training (coach LM trainer)
Summary: `scripts/coachlm/*.py` grows Kami's own small Go-explaining model on XIAO's PC (RTX 5070, 12 GB) or a free Kaggle GPU. KataGo does the thinking; the model only learns to reword checked facts. Nothing here has run on a real GPU yet (see "Tested").

## What the loop does (one generation, `evolve.py`)
1. **Breed**: refill the population (default 8 LoRA adapters on one shared base). Children start from the hive adapter or a top survivor, with 1-2 mutated genes (learning rate, LoRA rank, data mix = engine-reference share and DPO share, sampling temperature, hard-task share), then a short train: SFT on pool winners (+ engine references, mostly early on), then DPO (trl) on pool pairs. The DPO reference is the child's own starting adapter.
2. **Answer**: each member answers its train tasks, k=2 samples.
3. **Verify** (teacher 1, required): `verify.ts` scores every answer against KataGo's facts. No Node or no verify: the run stops; it never trains on unchecked text.
4. **Judge** (teacher 2, optional): Gemini scores a small sample of passing answers (clarity, depth, usefulness, numbers only, never training text). Hard cap 40 calls per run and per day; stops on a rate limit; nothing happens without a key. Optional too: the ChatGPT tone reviewer (see below) scores a few answers for tone.
5. **Pool** (hivemind): every good answer and every (better, worse) pair from any member goes into `pool.jsonl.gz`. Rows are never removed.
6. **Eval**: new members answer a fixed held-out subset of `eval.jsonl.gz` (greedy). Fitness: truth gate first (95 % must pass), then coverage, depth, and the judge (judge only counts when every compared member was judged).
7. **Select**: the best member becomes champion only if it ranks higher and is not worse on truth. The bottom half is folded into the hive and deleted; its pool rows stay.
8. **Self-play** (teacher 3): the hardest tasks (lowest pass rate) are oversampled next time, and the question-maker writes `requests.jsonl` (new why-not / why-move questions on moves from those tasks' variations) for `factory.ts`; the new tasks join the pool.
9. **Log**: `log.jsonl` and `chart.txt` (one bar per generation) in the data folder; disk pruning; pool sync.

## Hivemind design
- One append-only pool for all members, machines and generations, deduped by text, synced to the `coach-lm` release as `pool.jsonl.gz` (download, merge, upload the union). A race between two uploads can drop rows from the release copy, but each machine keeps its local pool and puts them back on its next sync.
- Hive adapter: fitness-weighted average of eliminated members' LoRA *deltas* (dW = B·A·scale), re-cut to rank 32 by truncated SVD (`merge.py`; peft's "svd" combination, i.e. linear merging on the full deltas). Not peft "linear" (averages A and B separately: cross terms, equal ranks only) and not TIES (sign election is for merging different tasks; members are siblings on one task). Older folds fade by 0.9 each fold. The same math changes a child's rank.
- Eval tasks never enter the pool or training data (checked in code and tests).

## Contract (with coach/lm-factory and coach/kami-site)
- Reads `tasks.jsonl.gz` and `eval.jsonl.gz` from release `coach-lm`; writes `pool.jsonl.gz` there. If the release has no tasks yet, it runs `factory.ts --n 200` locally and holds out `split: eval` tasks (or 15 % by id hash).
- `verify.ts --tasks <jsonl>`: the trainer passes a plain .jsonl with just that generation's tasks (or the eval subset). The answers' `member` is opaque and must be echoed back: `<run>/<member>~<sample>` or `champion~0`.
- Requests: `{"taskId", "question": {"kind": "why-not"|"why-move", "move": "Q16", "text"}}`, moves only from the task's variations (first move each).
- Hugging Face: `<hf-user>/kami-coach` (folders `champion/`, `hive/`, `kami.json`) and `<hf-user>/kami-coach-web` (transformers.js layout: `onnx/model_q4f16.onnx`, `onnx/model_q4.onnx`, `config.json` with `transformers.js_config.kv_cache_dtype`). Both public.
- Site: `pipeline('text-generation', '<hf-user>/kami-coach-web', { device: 'webgpu', dtype: 'q4f16' })`, messages `[system: task.system, user: buildLmPrompt(...)]`, chat template with `enable_thinking: false`. No change to `types.ts`, `prompt.ts` or `answerCheck.ts`.

## Base model
Qwen3-1.7B (Apache-2.0): newest small Apache model with transformers.js WebGPU support (`qwen3`), stronger than Qwen2.5-1.5B at the same browser cost; thinking is switched off. Fallbacks in `config.py`: `qwen2.5-1.5b` (most proven in transformers.js), `qwen3-0.6b` (phones, quick tests). Set `"base_model"` in `<data folder>\config.json`. A data folder is tied to one base.

## Estimates (not measured)
- VRAM: weights 3.4 GB (bf16); answering about 5-6 GB; SFT about 7-9 GB; DPO about 8-10 GB (the 152k-word output layer dominates). If it runs out: lower `max_len`/`dpo_max_len` in config.json or use `qwen3-0.6b`.
- Disk: venv with CUDA PyTorch about 6 GB, base model 4 GB, training files 1-2 GB (8 adapters about 70 MB each, hive, champion, pool; capped at 20 GB), export about 15 GB extra while it runs.
- Speed: roughly 45-75 minutes a generation on an RTX 5070, so 6-10 generations a night.

## XIAO's setup (Windows, once)
1. Install **Python 3.12** from python.org/downloads (tick "Add python.exe to PATH" on the first screen), **Node.js LTS** from nodejs.org, and **Git** from git-scm.com/download/win (all default options). Update the NVIDIA driver (NVIDIA app) if it is older than early 2025.
2. Optional keys (each one adds a feature; skip any):
   - **Hugging Face** (shares the trained model, needed for the Kami site to download it): huggingface.co → sign up → profile picture → Settings → Access Tokens → Create new token → Token type **Write** → name `kami` → Create token → copy.
   - **GitHub** (shares the pool between PC and Kaggle): github.com → profile picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token → name `kami-train`, expiration 1 year → Repository access: **Only select repositories** → `PERILTHESKYWING/Dop` → Permissions → Repository permissions → **Contents: Read and write** → Generate token → copy.
   - **Gemini** (writing judge): aistudio.google.com/apikey → Create API key → choose **Create API key in new project** (so it does not use the Dop site's free quota) → copy.
   - **OpenAI** (ChatGPT tone reviewer, paid, see "ChatGPT tone reviewer" below): platform.openai.com/api-keys → Create new secret key → copy.
3. Download `start-kami-training-windows.bat` (in the Dop PC helper zip from Settings, or github.com/PERILTHESKYWING/Dop/blob/main/public/pc-helper/start-kami-training-windows.bat → Download raw file) and double-click it. If Windows warns: More info → Run anyway. First run downloads about 10 GB. It asks for the four keys once (paste, Enter; Enter alone skips; an older install asks only for the new OpenAI key, once) and saves them in `%LOCALAPPDATA%\kami-train\.env`, never in the repo. Delete that file to be asked again.
4. It checks everything (`run.py --check`), asks once whether to **train every night at 01:00** (type y), then trains for 8 hours. Closing the window is safe; double-click again to continue. Remove the nightly task with `run.py --unschedule`.
5. Watch progress: `%LOCALAPPDATA%\kami-train\chart.txt` (one line per generation, `*` = new champion).
6. For the site, when the chart looks good: open Command Prompt and run
   `"%LOCALAPPDATA%\kami-train\venv\Scripts\python.exe" "%LOCALAPPDATA%\kami-train\Dop\scripts\coachlm\export.py" --upload`
   (needs about 16 GB free RAM and 15 GB free disk; makes its own small venv the first time).

## Kaggle (free GPU, about 30 h a week)
New notebook → Settings: **Accelerator: GPU T4 x2**, **Internet: on** → Add-ons → Secrets → add `HF_TOKEN`, `GITHUB_TOKEN`, `GEMINI_API_KEY`, and `OPENAI_API_KEY` if you use the tone reviewer (same values) and switch each on. Paste and run:
```
!git clone --depth 1 https://github.com/PERILTHESKYWING/Dop
!pip install -q -r Dop/scripts/coachlm/requirements.txt
!node --version || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs)
!cd Dop && npm ci --no-audit --no-fund
```
```
import os
from kaggle_secrets import UserSecretsClient
s = UserSecretsClient()
for k in ('HF_TOKEN', 'GITHUB_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY'):
    try: os.environ[k] = s.get_secret(k)
    except Exception: pass
os.environ['KAMI_DISK_CAP_GB'] = '8'
!python Dop/scripts/coachlm/run.py --hours 8 --upload --name kaggle --data-dir /kaggle/working/kami-train
```
To run without the browser open: Save Version → Save & Run All. With HF_TOKEN it starts from the shared champion and hive; with GITHUB_TOKEN its pool merges with the PC's. The T4 has no bfloat16, so it trains in float16.

## ChatGPT tone reviewer (optional)
`tone.py` asks OpenAI's API (the model behind ChatGPT) to score the **tone** of Kami's answers against XIAO's tone rules (the rubric's rules with `"topic": "tone"`, plus a fixed voice guide: celebrate, relaxed, blunder, tsumego, style choice; XIAO's notes built in if the rubric has none). Reply: `tone`, `warmth`, `clarity`, `fit` (0-10) and one short note. Numbers only reach training: the 0-1 mean counts as 20 % of an answer's quality (`W_TONE` in `pool.py`, taken from coverage/depth/judge in proportion; XIAO's rubric keeps its 50 %; only for tasks where every passing answer was reviewed). The note stays in `gens/gNNNN/tone-train.json` and reports, never in training text. Eval fitness and champion choice do not use it (too few calls to read every member). Training-only: the website never calls it. No key: nothing changes.
- **Cost (it is not free):** the API is billed on platform.openai.com, separately from a ChatGPT Plus subscription; Plus does **not** include API use. One call reads one answer (about 400-1,100 input tokens, at most 300 output). At gpt-5-mini's launch price (US$0.25 per million input tokens, $2 per million output) that is about a tenth of a cent a call, so the default 30 calls a day is about 3 cents; check platform.openai.com/docs/pricing for today's price. Safest: buy a small prepaid credit and leave auto-recharge off, so it can never spend more.
- **Caps:** `tone_cap` 30 calls per run, `tone_daily_cap` 30 per day on that machine (shared with `tone_review.py`), `tone_per_gen` 6 per generation, 2 s between calls. Change them in `<data folder>\config.json`, e.g. `{"tone_cap": 10, "tone_daily_cap": 10}`, or with `KAMI_TONE_CAP` / `KAMI_TONE_DAILY_CAP` set before the run. It stops for the run on 429 (rate limit, or `insufficient_quota` = no credit), 401 (bad key) or 403.
- **Model:** `OPENAI_MODEL` (default `gpt-5-mini`; then `gpt-4.1-mini`, `gpt-4o-mini` if a model is not available to the key).
- **Get a key:** platform.openai.com → sign in (the ChatGPT account works, billing is separate) → Settings → Billing → add a payment method and a small credit → platform.openai.com/api-keys → **Create new secret key** → name `kami-tone` → copy it (shown once). Never paste a key into a chat, an issue or the repo.
- **PC:** double-click `start-kami-training-windows.bat`; it asks once for "OpenAI API key" (paste, Enter; Enter alone skips) and saves it in `%LOCALAPPDATA%\kami-train\.env`. Or open that file in Notepad and add a line `OPENAI_API_KEY=<your key>` (optionally `OPENAI_MODEL=gpt-4.1-mini`). `run.py --check` then shows "OpenAI key works". To remove it, delete that line.
- **Kaggle:** Add-ons → Secrets → Add secret: label `OPENAI_API_KEY`, value = the key → switch it on for the notebook; the snippet above reads it. Each Kaggle session starts with a fresh folder, so only the per-run cap applies there.
- **GitHub:** nothing to do; no workflow runs the judges.
- **Report by hand:** `python scripts/coachlm/tone_review.py <answers.jsonl | critique.json> [--tasks tasks.jsonl] [--limit 10]` writes `tone-review.md` and `.json` in the data folder (lowest tone first). `--dry-run` prints the exact prompts and a token estimate without a key or a call.

## Tested (honest)
- 67 pytest tests, CPU, no network, model faked: pool append/dedupe/merge and eval guard, eliminated members' rows surviving, merge math against full SVD, selection/mutation, champion no-regression, resume after a crash mid-breed and mid-answer, time limit, disk pruning, judge caps/429/404, verify and factory through stub CLIs, request writing, run.py main/lock/schedule, uploads with Hugging Face and GitHub faked.
- Real libraries on a tiny random Qwen3-shaped model (CPU), twice: torch 2.14.1 + transformers 5.19 + peft 0.21.2 + trl 1.14.2, and the same with torch 2.9.1+cu128: answering, SFT, DPO, rank change, hive merge loaded by peft, `export.merge_into` equal to peft's merge.
- Export on that tiny model: optimum-onnx → ORT fp16 → MatMulNBits q4: q4f16 and q4 both load in onnxruntime and in transformers.js 4.3.1 (Node, CPU) and match PyTorch's greedy tokens.
- Tone reviewer: 26 pytest tests with OpenAI's HTTP faked (no key, caps, 429/401/403, 404 model fallback through a faked urlopen, JSON clamping, the blend, the CLI report and dry run) and one end-to-end loop test. No real OpenAI call was made (no key in the sandbox), so the live reply format of gpt-5-mini with `reasoning_effort: minimal` is unverified.
- Not tested: any real GPU run, VRAM and speed, Qwen3-1.7B itself, the >2 GB external-data export path, WebGPU in a browser, the .bat on Windows, schtasks, Kaggle, real verify.ts/factory.ts (not merged when this was built), real Gemini/HF/GitHub calls.

## Gotchas
- trl 1.15+ needs Triton (not shipped for Windows PyTorch): stay on trl 1.14.2.
- onnxconverter-common's fp16 leaves mixed-type Adds in Qwen3's RMSNorm; export.py uses onnxruntime's converter.
- transformers.js reads the chat template from `tokenizer_config.json`; export.py copies it there.
