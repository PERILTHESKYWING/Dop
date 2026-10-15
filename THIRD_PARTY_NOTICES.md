# Third-party notices

DOPPELGÄNGER includes or downloads the following third-party software and data.

## Included in this repository

### KataGo and katago-webgpu (MIT)
`public/engine/kataeval.{js,wasm}` and `public/engine/kataeval-compat.{js,wasm}` are compiled from
[saigo-online/katago-webgpu](https://github.com/saigo-online/katago-webgpu), a WebGPU/WebAssembly port of
[KataGo](https://github.com/lightvector/KataGo) by David J Wu ("lightvector") and contributors, at commit
`d5ad1c0423dba989c60a2f06b1848e7eec2b5941` (see `public/engine/SOURCE_COMMIT.txt`). They were built with
`engine/build-engine.sh`, which applies the small patch in `engine/patches/` (it fixes an ownership-buffer
double free and a search perspective bug, exposes root statistics, and adds batched evaluation with move
history). The full KataGo licence, including
its notices for bundled libraries, ships in `public/engine/LICENSE-KataGo.txt`.

`public/engine/bench-positions.json` holds analysis results (moves, winrates, score leads) produced by the
official KataGo v1.16.4 binary with the built-in network, as the benchmark's reference; no KataGo binary ships.

The compiled engine statically links:

- **Dawn / emdawnwebgpu** (BSD 3-Clause), Google's WebGPU implementation bindings for Emscripten.
- **Eigen 3** (MPL 2.0), used by the CPU fallback backend. Source: https://gitlab.com/libeigen/eigen
- **zlib** (zlib licence), for reading `.bin.gz` networks. Copyright (C) Jean-loup Gailly and Mark Adler.
- **half** (MIT) and other small headers vendored by KataGo, listed in `LICENSE-KataGo.txt`.
- The **Emscripten** runtime (MIT / University of Illinois NCSA).

### Built-in KataGo network (MIT)
`public/models/g170e-b10c128-s1141046784-d204142634.bin.gz` is the 10-block network from KataGo's g170 run.
It is taken from `cpp/tests/models/` of the KataGo source tree as included in katago-webgpu at the commit
above, where it falls under the same MIT licence ("all other content in this repo", see
`public/engine/LICENSE-KataGo.txt`). It ships with the site so analysis works when network downloads are
blocked, and it is the default on the CPU.

### Fonts (SIL Open Font License 1.1)
Bundled from the `@fontsource-variable` npm packages. The full licence texts ship in `public/licenses/`.

- **Archivo**, Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)

### Artwork (original, no third-party images)
The background paintings (`public/art/meadow*.webp`, `public/art/clouds.webp`) and the board's wood texture
(`public/art/kaya.webp`) were generated procedurally for this project by the scripts in `tools/art/`. They
contain no photographs or other third-party images, so no third-party licence applies.

### Rank calibration statistics
`public/level/calibration.json` holds statistics (averages, spreads and counts per rank) computed by
`scripts/rank-corpus.ts` and `scripts/rank-fit.ts` from a random sample of games in the Fox Go dataset
(https://github.com/featurecat/go-dataset, distributed under GPL-3.0), and from OGS games played from 2022 on,
taken from the OGS archive at https://za3k.com/ogs/ (games from online-go.com, redistributed with OGS's
permission; the compilation is released into the public domain). `.github/workflows/game-data.yml` keeps a
sample of those OGS games in this repository's "game-data" release for the training workflow. Professional
and AI games for the top of the scale also come from https://github.com/yenw/computer-go-dataset, Japanese
title matches from https://homepages.cwi.nl/~aeb/go/games/ (public domain) and KataGo rating games from
https://katagoarchive.org/kata1/. No game records are included in the site.

### Move difficulty and professional game statistics
`public/coach/difficulty.json` holds fitted coefficients computed by `scripts/move-corpus.ts` and
`scripts/move-fit.ts` from sampled positions of Fox games (above) and professional games from
https://github.com/yenw/computer-go-dataset. `public/pro/openings.json` holds counts of the moves professionals
played in positions from the first 40 moves of that collection's professional games (73,519 games, 1940 to
2017), made by `scripts/pro-openings.ts`. No game records from either collection are included.

### JavaScript dependencies (bundled into the site)
- **React** and **React DOM** (MIT), Meta Platforms, Inc. and affiliates.
- **zustand** (MIT), Paul Henschel and contributors.
- **idb** (ISC), Jake Archibald.
- **qrcode-generator** (MIT), Kazuhiko Arase. QR Code is a registered trademark of DENSO WAVE INCORPORATED.

Build-time tools (Vite, TypeScript, Vitest, tsx) are not shipped to users.

## Downloaded at runtime (not included)

Apart from the built-in network above, network weights are **not** bundled. The browser downloads them on
first use and caches them locally.

- **kata1 networks** (`kata1-b28c512nbt-…`, `kata1-b18c384nbt-…`) from
  [katagotraining.org](https://katagotraining.org/networks/). These are produced by the KataGo distributed
  training project; see https://katagotraining.org/network_license/ for their licence terms.
- **g170-b6c96**, a tiny test network included in the katago-webgpu repository under its MIT licence,
  fetched from jsDelivr or raw.githubusercontent.com when chosen.
- A network file the user loads from their own computer stays in that browser's cache.
- The **PC helper** (`pc-helper/dop_pc.py`), run by the user on their own PC, downloads KataGo (MIT) from its
  GitHub releases, a kata1 network, the built-in g170e-b10c128 network, and Cloudflare's `cloudflared`
  (Apache 2.0) for the phone link.
- The **Kami training kit** (`scripts/coachlm/`, `pc-helper/start-kami-training-windows.bat`), run by the user
  on their own PC or Kaggle, downloads a base language model from Hugging Face: **Qwen3-1.7B** by default
  (Qwen team, Alibaba Cloud, Apache 2.0), or Qwen2.5-1.5B-Instruct / Qwen3-0.6B (Apache 2.0) if chosen. The
  models it publishes (LoRA adapters and a merged ONNX export) are derived from that base and keep its
  Apache 2.0 licence. It installs PyTorch (BSD-3-Clause), NumPy (BSD-3-Clause), Hugging Face transformers,
  peft, trl, accelerate, datasets, tokenizers, safetensors and huggingface_hub (Apache 2.0), and for the
  export optimum and optimum-onnx (Apache 2.0), ONNX and onnx-ir (Apache 2.0) and ONNX Runtime (MIT). The
  optional writing judge sends answers to Google's Gemini API under the user's own key.

## Demo data

`public/demo/demo.json` holds synthetic games generated by `scripts/generate-demo.ts`: bots that sample from
KataGo's policy (g170e-b10c128 network) with injected habits, analysed by the same engine. The players
("Mira", "Tessa", club members) are fictional.
