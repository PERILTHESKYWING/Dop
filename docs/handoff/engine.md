# Engine
Summary: KataGo's network runs as WASM/WebGPU in the browser; our own PUCT search (`src/lib/engine/mcts.ts`) runs on top.

- Build: `engine/build-engine.sh` (katago-webgpu + `engine/patches/`) makes `public/engine/kataeval.wasm` (SIMD, -O3) and `kataeval-compat.wasm` (no SIMD). Needs emsdk; in the cloud sandbox GitHub archive tarballs are blocked, so the zlib port must be supplied from a git clone (see the patch notes in the build script).
- After any change in `public/engine`, bump `ENGINE_FILES` in `src/lib/engine/browserEngine.ts`.
- Speed work already done: SIMD, several worker lanes tuned per device (`tuning.ts`), fp16 on GPU only when answers match, symmetry NN cache (`nncache.ts`), pipelined evals, early stop, scout-then-deepen reviews (`pipeline.ts`), heat/battery governor (`governor.ts`), cool mode, opening book (`public/book`), big-network anchors (anchorWeight 0.5).
- Gumbel root search exists but is off: measured worse at low visits.
- KataGo's utility-spread exploration (`cpuctStdevScale` 0.85) is on since 2026-10-12: against native KataGo (2000 visits, 180 positions) it found the best move 4-6 points more often at 32-256 visits. Measure search changes with `scripts/search-eval.ts refs --native` (needs the native binary in `KATAGO`), not against our own deep search.
- The live "N/s" readout is wall-clock evals per second (it used to sum overlapping worker calls and showed about a third of the real rate).
- Tried 2026-10-12 and dropped: lazy-loading pages. On a throttled phone profile the split build drew the first page 150-450 ms later than one bundle (extra round trip), so the app stays one bundle.
- Small b10 net: winrate is derived from its score estimate (matched desktop KataGo better than its value head).
- PC helper (`public/pc-helper/dop_pc.py`, 127.0.0.1:7474) lends native KataGo / training to the site; the phone works without it. Since 2026-10-12 it opens a Cloudflare quick tunnel by default (the only way a phone can reach it: the site is https, the helper http, so a phone browser can't call the PC's home-network address). Phone links by QR code (Settings on the PC); a restarted helper announces its new tunnel to `/api/account?action=pc-here` and the phone finds it via `pc-where` (needs the Upstash store). Wrong codes lock it for a minute after 20 tries.
- The helper also runs the bundled b10 (`"net":"small"`, nnRandomize off) so the phone's Doppelgänger moves and the queue's first-look pass go to the PC when the local engine would be b10 (`pcSmallIfSame`, `pcSmallEngine` in `src/state/pc.ts`); any PC failure falls back here. Native b10 vs the browser's b10: same top move in 9-10 of 11 positions, lead within 0.34 points (not bit-identical).
- Chrome's Local Network Access needs `targetAddressSpace: 'loopback'` for 127.0.0.1 ('local' was refused, so the PC site could not reach the helper before this fix).
- DopNet student network (`scripts/student/README.md`, `tools/student`) stays disabled until its gate beats b10.
- Benchmarks: Settings › Benchmark, `scripts/engine-bench.mjs`, `scripts/ai-eval.ts` (use a fresh cache per review). Only ever measured on a 4-core cloud CPU, never a real GPU.
