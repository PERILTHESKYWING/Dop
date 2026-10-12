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
