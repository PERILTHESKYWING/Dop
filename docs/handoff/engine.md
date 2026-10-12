# Engine
Summary: KataGo's network runs as WASM/WebGPU in the browser; our own PUCT search (`src/lib/engine/mcts.ts`) runs on top.

- Build: `engine/build-engine.sh` (katago-webgpu + `engine/patches/`) makes `public/engine/kataeval.wasm` (SIMD, -O3) and `kataeval-compat.wasm` (no SIMD). Needs emsdk; in the cloud sandbox GitHub archive tarballs are blocked, so the zlib port must be supplied from a git clone (see the patch notes in the build script).
- After any change in `public/engine`, bump `ENGINE_FILES` in `src/lib/engine/browserEngine.ts`.
- Speed work already done: SIMD, several worker lanes tuned per device (`tuning.ts`), fp16 on GPU only when answers match, symmetry NN cache (`nncache.ts`), pipelined evals, early stop, scout-then-deepen reviews (`pipeline.ts`), heat/battery governor (`governor.ts`), cool mode, opening book (`public/book`), big-network anchors (anchorWeight 0.5).
- Gumbel root search exists but is off: measured worse at low visits.
- Small b10 net: winrate is derived from its score estimate (matched desktop KataGo better than its value head).
- PC helper (`public/pc-helper/dop_pc.py`, 127.0.0.1:7474) lends native KataGo / training to the site; the phone works without it.
- DopNet student network (`scripts/student/README.md`, `tools/student`) stays disabled until its gate beats b10.
- Benchmarks: Settings › Benchmark, `scripts/engine-bench.mjs`, `scripts/ai-eval.ts` (use a fresh cache per review). Only ever measured on a 4-core cloud CPU, never a real GPU.
