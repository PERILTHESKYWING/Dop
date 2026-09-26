# Dop Trainer

A Go AI that teaches itself on your own graphics card, starting from random play, and gets
stronger for as long as it runs. The **Home Trainer** page of the Doppelgänger site shows its
strength climbing and lets you play the newest network at any moment.

It is KataGo's own self-play training pipeline (the same one that trained KataGo), driven by a
small Python program so it runs on Windows without extra tools:

1. **Self-play.** The current network plays 500 games against itself with KataGo's search, on the GPU.
2. **Shuffle.** The newest games are mixed into a training window.
3. **Train.** PyTorch trains the network on that window, on the GPU.
4. **Export.** The trained network becomes the next generation, and self-play switches to it.
5. **Rate.** The new generation plays rating games against earlier ones (and every fifth
   generation, against a fixed strong reference network). All results go into one Elo fit, with
   the untrained network fixed at 0.

Then it starts over. Everything is saved, so closing the window and starting it again continues
the same run.

## Start it (Windows)

1. Download **dop-trainer.zip** from the Home Trainer page and unzip it anywhere.
2. Double-click **Start-Trainer.bat**.
   - If Python 3.10 to 3.13 is not installed, it installs Python 3.12 with `winget` (or tells you
     where to get it); start the .bat again afterwards.
   - The first start downloads KataGo v1.18.1 (OpenCL build), KataGo's training scripts and
     PyTorch for CUDA 12.8, about 3 GB in total. Later starts skip this.
   - KataGo's OpenCL backend tunes itself for your GPU the first time it runs, which takes a few
     minutes.
3. Leave the window open. Open the Home Trainer page on the site; when the browser asks whether
   the site may reach devices on your local network, allow it.

Everything lives in `%USERPROFILE%\DopTrainer`: the Python environment, KataGo, the networks
(`run\models`), the self-play games and the logs (`run\logs`). To keep the folder from growing
without end, self-play data that has slid out of the training window is deleted (its row count is
remembered so the window keeps its size), and of the older networks only every tenth is kept; the
newest 20 always stay. Delete the folder to start from scratch.

On Linux or WSL, run `./start-trainer.sh` instead.

## What to expect on an RTX 5070

These are estimates, not measurements; the rating chart shows the real numbers.

- A cycle (500 games, training, rating) takes on the order of 10 to 20 minutes with the default
  6-block network, so several new generations an hour.
- The first generations are close to random. Within hours it plays purposeful moves; after a few
  days of nonstop running it should be around club level; strong amateur play takes weeks.
- KataGo's public networks took years of training on many GPUs. One GPU will not catch them.
- The 6-block network (b6c96) learns fastest early but has a ceiling. When its rating flattens
  out, start a new run with a bigger network (see Settings) and it will keep climbing, more slowly.

## Using the GPU for other things

Press **Pause** on the Home Trainer page (self-play stops at once; training and rating finish
their current step), or close the window. You can still play the trained networks while paused.

## Settings

`%USERPROFILE%\DopTrainer\trainer.json` holds all settings; edit it while the trainer is closed.

| Setting | Default | Meaning |
|---|---|---|
| `backend` | `opencl` | KataGo build. `opencl` needs only the graphics driver. `cuda` can be faster on NVIDIA; it borrows the CUDA and cuDNN libraries inside PyTorch (experimental). Run `setup` again after changing it. |
| `model_kind` | `b6c96` | Network size, from KataGo's `modelconfigs.py`. Changing it needs a fresh run (move `run` away first). `b10c128` is the next step up. |
| `games_per_cycle` | `500` | Self-play games between training steps. |
| `rating_games` | `16` | Rating games against each opponent. |
| `rating_visits` | `100` | Search size in rating games. |
| `reference_every` | `5` | Play the reference network every N generations. |
| `allowed_origins` | localhost, `*.vercel.app` | Websites allowed to talk to the trainer. Add your own domain with `--allow-origin https://example.com`. |
| `port` | `7474` | Where the website finds the trainer (`http://127.0.0.1:7474`). |

Command line, from the unzipped folder with the environment's Python
(`%USERPROFILE%\DopTrainer\venv\Scripts\python.exe`) and `PYTHONPATH` set to the folder:

```
python -m doptrainer setup [--backend opencl|cuda|trt|eigen] [--preset gpu|tiny]
python -m doptrainer run   [--allow-origin https://your.site] [--port 7474]
python -m doptrainer serve   # only play the networks trained so far, no training
python -m doptrainer status
```

`--preset tiny` is a 9×9, tiny-network smoke test that runs on a CPU in minutes.

## The rating

Every rating game ever played goes into one Bradley–Terry fit (Elo), with the untrained network
(gen 0) fixed at 0 and half a virtual draw per pairing so that clean sweeps stay finite (16-0 reads
as about +720). A gap of 200 Elo means the stronger side wins about 3 games in 4. Rating games
are on 19×19 with area scoring and komi 7.5, at 100 visits a move.

The reference is the MIT-licensed `g170e-b10c128` network from KataGo's 2020 run (the same one the
site uses as its built-in network). It is rated twice: at 1 visit (pure instinct) and at 100
visits. The first win against each is a milestone on the page.

## The local server

The trainer listens on `127.0.0.1:7474` only (nothing is reachable from other machines):

- `GET /api/status`: current step, progress, counts, latest generation.
- `GET /api/history`: every generation with its Elo, the reference ratings and all match results.
- `POST /api/play`: `{moves: [["B","Q16"],…], size, komi, rules, visits, model: "latest"|"genN"}`
  returns the network's move, Black's winrate and score lead, and its top candidates.
- `POST /api/control`: `{action: "pause"|"resume"}`.

Browsers only get answers when the page's origin is in `allowed_origins`.

## Tests

`npm run trainer:test` runs the Python unit tests (ratings, config writing, origin checks). The
full loop was checked end to end on a CPU with `--preset tiny --backend eigen`: self-play,
shuffle, training, export, rating matches, play and pause/resume.

## Licences

KataGo (MIT) and PyTorch (BSD) are downloaded by `setup` from their official releases; nothing of
theirs is included in the zip except the reference network, which ships with KataGo's MIT licence
in `reference/`.
