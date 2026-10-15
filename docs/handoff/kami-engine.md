# Kami engine (explain)
Summary: the engine-only explainer behind Kami, in `src/lib/coach/explain/`. KataGo does the reading; code decides what to read and writes text only from the reads' numbers.

## Files
- `index.ts`: `explain` (the contract's ExplainFn) and `explainWithBudget` (same, explicit Budget; for the bench and the factory). Also exports `budgetFor`.
- `budgets.ts`: `budgetFor(model, thinking)`. Hane = 2 reads, no lines. Tesuji/Myoshu grow with the level. `maxMs` is a hard cap; slow machines just get fewer visits.
- `reader.ts`: every read goes through it (reads and time budget, abort, thinking steps). Each read gets the share of the time left that its visits are of the visits still planned.
- `planner.ts`: `runPlan` returns Findings. best/overview: best line, 1-2 alternatives, the opponent's answer to the best move, and with reads to spare the runner-up played out against it. why-move/why-not: read the asked move, compare with the best:
  - under 0.5 pts: "about as good" (or "a good move" when it reads better than the first look at the best);
  - 3+ pts with a local reply (or 10+ pts anyway): refutation from the reply's PV, one more read if the trusted PV is under 6 moves;
  - otherwise: consequence search (Hane: the reply's line as a what-if);
  - the asked move is the best: compared with the runner-up the same way.
- `consequence.ts`: both lines are read at the same plies. A read's PV is followed for `trustedLen(visits)` = 2·ln(visits/4) moves (2-12), then read again. Regions are zoneOf's 9 (not connected areas: those change shape between reads, so "it stays" can't be checked). Turning point: a region at least 2.5 pts (summed ownership) worse for the mover, staying at 60% of that to the end (1.5x needed if first seen at the last read). Of the regions that turn, the one worst at the end is reported. A turn at ply 1 is the stone itself, so it is shown at the last read. A region that gained 2.5+ in exchange is named (a trade).
- `concepts.ts`: sente (local reply and tenuki costs 1.5+ pts, or 95% of 40+ visits local), gote (contact play, reply elsewhere), weak group (loose group ownership -0.3..0.35), dead group (alive 0.3+ in the better line, -0.6 or less in the asked line), territory/influence (sure gains on lines 1-4 / unsure gains on line 5+; small losses only), urgent (best move next to a weak group, elsewhere 1.5+ worse), big point (open space, line 3-4), tenuki (0.5+ better than answering locally), miai (top two within 0.6 pts and the best move's reply is the other).
- Not detected (no reliable signal from these reads): ladder (would need a ladder reader on the board), thickness, overconcentration, aji.
- `text.ts`: one Fact per checked statement; summary and sections reuse facts or number-free glue; `numbersIn` + a last guard drops any sentence with a number not in facts, concept evidence or variation notes.
- Abort: `explain` rejects with the signal's reason (AbortError) and makes no more reads; it doesn't wait for a read in flight.

## Measured (2026-10-15)
`npx tsx scripts/explain-bench.ts`: WASM b10 in Node, 1 thread, idle 2-core cloud box, cold NN cache per answer, 11 positions (10 from `public/engine/bench-positions.json`, 1 hand-made opening). Node does about 20 visits/s.

| model/thinking | mean reads | mean visits | mean s | max s | turning points |
|---|---|---|---|---|---|
| hane/off | 2 | 28 | 1.5 | 1.6 | - |
| hane/medium | 2 | 56 | 3.0 | 3.1 | - |
| tesuji/off | 3 | 86 | 3.7 | 4.0 | 4 of 6 lines |
| tesuji/low | 4 | 125 | 5.0 | 6.0 | 5 of 6 |
| tesuji/medium | 7 | 191 | 7.5 | 10.0 | 6 of 6 |
| tesuji/high | 10 | 304 | 11.7 | 15.9 | 6 of 6 |
| myoshu/medium | 11 | 414 | 16.2 | 21.1 | 6 of 6 |

- At these caps Node reaches only about a third of the target visits. With the caps tripled (`--time-scale 3`) Tesuji medium reads its full plan: mean 400 visits, 17.5 s, max 23.9 s; turning points 4 of 5 lines. So a browser needs about 2.4x one Node thread to read it all inside 10 s; a slower one answers in 10 s with fewer visits. No browser or laptop was measured.
- Per-question time plans (2-read answers no longer save time for reads that never come): Tesuji medium 179 -> 191 mean visits, 6.5 -> 7.5 s mean.
- Losses against native KataGo at 1600 visits (same positions, b10): native 1.4 / 1.8 / 3.2 / 3.8 / 4.3 / 43 pts; Tesuji medium said 1.6-1.9 / 1.3-1.7 / 2.6-3.1 / 3.2 / 3.4 / 46-49 depending on time.

## Gotchas
- `EngineRead.ownership` is the network's output at the read's root, not averaged over the search: compare only reads at the same ply (same side to move).
- Line reads at 10-48 visits have 1-2 pts of noise in their leads; only "at move N" facts use them.
- The asked move read on its own can score better than the root's first look at the best move (different visits): handled as "a good move", never "worse by -2".
- Zone sums can be big in a trade (13 pts lost in one region, 11 gained in another): the text names both regions.
- In a bench, one NN cache across runs makes later runs look faster. Other threads' engine runs on this 2-core box doubled wall times once; the bench prints CPU ms and the load average.
- Untested: the browser prober from the Kami site, miai on real games (it never fired on the 11 positions; unit tests only).
