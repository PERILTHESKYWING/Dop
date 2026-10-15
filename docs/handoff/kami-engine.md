# Kami engine (explain)
Summary: the engine-only explainer behind Kami, in `src/lib/coach/explain/`. KataGo does the reading; code decides what to read and writes text only from the reads' numbers.

## Files
- `index.ts`: `explain` (the contract's ExplainFn) and `explainWithBudget` (same, explicit Budget; for the bench and the factory). Also exports `budgetFor`.
- `budgets.ts`: `budgetFor(model, thinking)`. Hane = 2 reads, no lines. Tesuji/Myoshu grow with the level. `maxMs` is a hard cap; slow machines just get fewer visits. Since 2026-10-15: fewer, deeper reads (line reads 64+ visits; Tesuji medium 8 reads, 240/100 visits, 14 s cap).
- `reader.ts`: every read goes through it (reads and time budget, abort, thinking steps). Each read gets the share of the time left that its visits are of the visits still planned.
- `planner.ts`: `runPlan` returns Findings. best/overview: best line, 1-2 alternatives, the opponent's answer to the best move, and with reads to spare the runner-up played out against it. why-move/why-not: read the asked move, compare with the best:
  - under 0.5 pts: "about as good" (or "a good move" when it reads better than the first look at the best);
  - 3+ pts with a local reply (or 10+ pts anyway): refutation from the reply's PV, one more read if the trusted PV is under 6 moves;
  - otherwise: consequence search (Hane: the reply's line as a what-if);
  - the asked move is the best: compared with the runner-up the same way.
- `consequence.ts`: both lines are read at the same plies. A read's PV is followed for `trustedLen(visits)` = 2·ln(visits/4) moves (2-12), then read again. Regions are zoneOf's 9 (not connected areas: those change shape between reads, so "it stays" can't be checked). Turning point: a region at least 2.5 pts (summed ownership) worse for the mover, staying at 60% of that to the end (1.5x needed if first seen at the last read). Of the regions that turn, the one worst at the end is reported. A turn at ply 1 is the stone itself, so it is shown at the last read. A region that gained 2.5+ in exchange is named (a trade). Wording (`turnPhrase`): a region holding the better move is "where B belongs"; one holding the asked move is "around A itself"; ownership is a share (0.6 = 80%, "leaning" under 0.6, "unsettled" under 0.2), never a raw decimal. Region ownership sums are not stated as points (they swing with every trade); only searched leads are.
- `concepts.ts`: key point first (`keyPointOf`/`keyPointHit`: the opponent's best answer to the asked move is on or next to KataGo's best move → "urgent for both sides", and no sente/gote line for the asked move), sente (local reply and tenuki costs 1.5+ pts, or 95% of 40+ visits local), gote (contact play, reply elsewhere), weak group (loose group ownership -0.3..0.35), dead group (alive 0.3+ in the better line, -0.6 or less in the asked line), territory/influence (sure gains on lines 1-4 / unsure gains on line 5+; small losses only), urgent (best move next to a weak group, elsewhere 1.5+ worse), big point (open space, line 3-4), tenuki (0.5+ better than answering locally), miai (top two within 0.6 pts and the best move's reply is the other).
- Not detected (no reliable signal from these reads): ladder (would need a ladder reader on the board), thickness, overconcentration, aji.
- `text.ts`: the summary leads with the key point ("After O16, White takes B9 itself, the point Black should have played"), else says where the opponent answers, then the turning point. One Fact per checked statement; summary and sections reuse facts or number-free glue; `numbersIn` + a last guard drops any sentence with a number not in facts, concept evidence or variation notes.
- Abort: `explain` rejects with the signal's reason (AbortError) and makes no more reads; it doesn't wait for a read in flight.

## Measured (2026-10-15, after the fixes)
`npx tsx scripts/explain-bench.ts --combos hane:off,tesuji:medium`: WASM b10 in Node, 1 thread, idle 2-core cloud box, cold NN cache per answer, 11 positions (10 from `public/engine/bench-positions.json`, 1 hand-made opening). Node does about 30 visits/s here.

| model/thinking | mean reads | mean visits | mean s | max s | turning points |
|---|---|---|---|---|---|
| hane/off | 2 | 45 | 2.0 | 2.0 | - |
| tesuji/medium | 6 | 333 | 10.6 | 12.7 | 6 of 6 lines |

- Before the fixes Tesuji medium read 191 visits in 7.5 s (line reads at 11-19 visits). Now line reads get 64+.
- Losses against native KataGo at 1600 visits (same positions): native 1.4 / 1.8 / 3.2 / 4.3 / 3.8 / 43; Tesuji medium 1.8 / 1.4 / 2.9 / 3.4 / 3.0 / 46.1.
- Browser: in headless Chromium (no WebGPU, b10, 1 CPU worker) a handicap-2 "why was my move bad?" answered in 16 s including engine start. On a computer with WebGPU Kami runs kata1 b18 (kami/src/lib/engine.ts); its speed in Kami is not measured yet.

## Gotchas
- `EngineRead.ownership` is the network's output at the read's root, not averaged over the search: compare only reads at the same ply (same side to move).
- Line reads at 10-48 visits have 1-2 pts of noise in their leads; only "at move N" facts use them.
- The asked move read on its own can score better than the root's first look at the best move (different visits): handled as "a good move", never "worse by -2".
- Zone sums can be big in a trade (13 pts lost in one region, 11 gained in another) and do not add up to the lead difference, so they are never stated as points.
- Setup stones (SGF AB/AW, handicap, library examples) must reach the engine alternating (`engineMoves` in src/lib/analysis/analyzer.ts). Fed "all Black then all White" the same 4 stones read B+13.0 instead of W+0.9; fixed 2026-10-15 for Dop and Kami.
- In a bench, one NN cache across runs makes later runs look faster. Other threads' engine runs on this 2-core box doubled wall times once; the bench prints CPU ms and the load average.
- Untested: b18 on WebGPU inside Kami, miai on real games (it never fired on the 11 positions; unit tests only).
