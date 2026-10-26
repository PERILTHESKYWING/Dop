# Training workflows (GitHub Actions)
Summary: free GitHub runners do the heavy work and commit results or store them in releases; check releases before claiming progress.

| Workflow | When | Output |
| --- | --- | --- |
| `coach-training.yml` | daily 03:17 UTC | measures rank-labelled games, refits level/skill model, commits; corpus in release `coach-data` |
| `problem-bank.yml` | daily 06:43 UTC | grows `public/problems/bank.json` with native KataGo |
| `ai-training.yml` | 11:00/17:00/23:00 UTC | DopNet student, opening book, arena + gate; data in release `ai-training` |
| `ai-chain.yml` | after ai-training | trains one mind per link and re-dispatches; repo variable `AI_CHAIN=off` stops it |
| `game-data.yml` | monthly, 2nd 04:41 UTC | OGS 2022+ pick into release `game-data` |
| `broadcast-games.yml` | manual | KataGo self-play games for Live |

- Free accounts get 20 concurrent jobs, so PR smoke runs queue behind training.
- Skill scale goes to 12d (10 pro, 11 top pro, 12 AI), one decimal; the b10 measuring net can't separate 9d+ well from one game.
- Home GPU path: `scripts/student/evolve_local.py` / PC helper `--train` uploads candidates the cloud arena judges.

## Workflow rules (2026-10-26, checked by `workflow-check.yml` on every PR that touches `.github/`)
Every rule comes from a real failure; `scripts/ci/check-workflows.py` enforces them, actionlint checks syntax.
- `defaults: run: shell: bash scripts/ci/step.sh {0}` at the top of every workflow. The wrapper runs each step like `bash -e`, but at nice 10, in its own memory cgroup (machine memory minus 1.5 GB) and as the first out-of-memory victim, so a heavy step dies on its own instead of the runner going silent ("The hosted runner lost communication with the server": AI training `book`/`label`, 3 runs). A failing step's last 25 lines become an error annotation. The cgroup matters: the runner lives in `hosted-compute-agent.service` and systemd stops that whole service when anything in it is OOM-killed, so before this a step that filled memory got the job terminated (exit 143, even `always()` steps skipped). A job without checkout uses `bash -e {0}` (hub-wake).
- `runs-on: ubuntu-24.04`, never `-latest` (GitHub moves `ubuntu-latest` to Ubuntu 26 from 2026-10-19). Every job has `timeout-minutes`.
- Node 24 action majors: checkout/setup-node v6, setup-python v6, cache v5, download-artifact v8; uploads go through `./.github/actions/upload` (upload-artifact v7, retried once: "Failed to CreateArtifact: ENOTFOUND" lost a book shard).
- Matrix shards whose output is optional have `continue-on-error: true`, so one lost machine is less data, not a red run. The job that merges them uses `if: always() && !cancelled()`.
- Push results with `bash scripts/ci/push.sh` (rebases, 5 tries, fails loudly; the old 3-try loops passed even when every push failed).
- Save collected data before a step that can fail on it, and never overwrite stored data with something not built on it (`scripts/ci/coach-corpus.sh`).
- Python `tarfile` in stream mode (`r|*`) keeps every header: set `tf.members = []` each loop or a big archive runs the runner out of memory (Game data, 2026-10-16; 0.5 KB per file).

## Debugging a failed run from a Claude session
Job logs and artifacts are on a blob host the session proxy blocks, so read failures through the API: `gh api repos/PERILTHESKYWING/dop/actions/runs/<run>/jobs` (which step failed) and `gh api repos/PERILTHESKYWING/dop/check-runs/<job id>/annotations` (the wrapper's error lines). Release assets download fine with `curl -H "Accept: application/octet-stream" .../releases/assets/<id>`.

## Coach training failures (2026-10-14 to 10-25)
The learn job failed 12 days running, ~20 s into the refit: `Math.min(...data.map(...))` in `scripts/rank-fit.ts` overflowed the call stack once the corpus passed ~140k game sides (it crossed that on 10-14). Found by the step wrapper's annotation; fixed with a loop. Never spread an array that grows with the data into a function call. Since nothing was saved those days, `coach-data` stopped at 10-13. Now parts also go through `scripts/coach-parts.ts` (drops malformed rows with a warning), the corpus is saved before the refit, and branch runs never publish. Replay (`replay` input, run ids) refits from earlier runs' artifacts in minutes: use it to test and to add lost days (artifacts last 90 days).
