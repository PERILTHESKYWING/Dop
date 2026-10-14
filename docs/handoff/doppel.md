# Doppelgänger copy
Summary: how the copy picks its moves and mistakes, what evolves, and what was measured (2026-10-14, thread "Make the Doppelgänger feel like me").

## Why it didn't feel like the player before
- Natural mode never measured a move's cost: it sampled KataGo's raw first-look list reweighted by 21 habit weights, keeping anything over 10% of the favourite.
- One set of habits for the whole game; no openings of the player's own; mistakes not tied to how the player errs.

## How it works now (`src/lib/profile/`)
- `doppel.ts`: 34 features (21 old + 11 shapes from `shape.ts` + "follows its own last move" + "KataGo's 2nd/3rd choice"). Phase (opening/middle/endgame) and situation (behind < 30% / level / ahead > 70%) weight blocks on top of the whole-game weights, pulled harder toward zero (`l2Phase`, `l2Sit`). Corrections (`fix`, `neg`) train with weight 3. Model `algo` 3.
- `human.ts`: the choice. weight = habits^faithfulness · prior^(1-f), style leanings, / temperature, then −max(0, loss−0.3)/τ, + γ·log(prior/maxPrior) for mistakes (natural-looking), + typeK·log(mult) for the player's mistake kinds (SIGNATURES bits). τ is solved per phase × situation cell so the copy's expected loss on the player's positions equals the player's loss on moves among the candidates. Tilt: τ × tilt^tiltK on the move after a 3+ point mistake. Guard drops: loss ≥ guardLoss with prior < guardPrior, and 1.5+ point self-atari of 2+ stones, filling an own eye, leaving a living 3+ stone group in atari that KataGo's move saves, landing deep in settled territory. Book moves mix in by count/(count + bookAlpha).
- `book.ts`: own opening book, 8-symmetry canonical keys (two-lane hash), up to 6000 positions, built from examples' `bookAt`.
- `copyTrain.ts`: full training. Test = every 5th game; measured copy (habits, book, mistakes) from the other 4 → `metrics.play`; the kept copy learns from all.
- `evolve.ts` + `genome.ts`: 11 genes, population 8, 3 elites, scored on a 4th of the non-test games. Fitness = log-likelihood + 1.5 × exact-move rate − 0.5 × |log loss gap|. Population lives on the model (`evo`), so every update carries on; fitness is re-scored when the data changes.
- Worker: `copy.worker.ts` → `copyJob.ts`; `state/copy.ts` falls back to the page's thread if the worker fails. Rebuild trains with the best genes, then 2 generations run in the background (skipped in cool mode); "Evolve" runs 4.
- `dials.ts`: presets + dials, stored in kv `copyDials` (syncs). "Not me" corrections in kv `copyFeedback` (max 400), learned at the next retrain.
- Play (`Doppelganger.tsx` readWith): on the copy's turn it now always measures up to ~11 candidates (copy's likely moves ≥3% of its favourite, max 8, + KataGo top 3 + book moves) with one network look each.
- Only the 3 newest `doppel` versions are kept (`putCopyModel`).

## Measured (scripts/doppel-data.ts → scripts/doppel-eval.ts, b10 network look per candidate)
Two Fox 5k players (西瓜乖, mht099), 101 games, test 20 games (1,912 moves):

| Copy | Exact move | Log-lik | Opening pts/mistakes | Middle | Endgame | Obvious blunders |
|---|---|---|---|---|---|---|
| Old Natural mode | 38.5% | -2.527 | 0.58 / 8.2% | 2.42 / 41.3% | 2.96 / 42.8% | 0.5% |
| New, default genes | 40.9% | -2.364 | 0.51 / 6.7% | 2.12 / 36.6% | 2.71 / 38.4% | 0.0% |
| New, evolved (6 gens) | 42.2% | -2.343 | 0.60 / 8.2% | 2.30 / 39.6% | 2.88 / 41.0% | 0.0% |
| Player (moves in top 10) | | | 0.66 / 10.1% | 2.61 / 44.1% | 3.04 / 41.8% | 0.6% |

- 19.9% of these players' moves are outside KataGo's top 10 (5.5 pts each); the copy never plays those, so mistakes are matched on the rest.
- Ablations: the opening book is worth +1.2 pts exact-move and +0.08 log-lik; mistake kinds and tilt changed these numbers by under 0.2 pts (kept: they shape which mistakes, which these averages barely see); the guard costs a little likelihood (players do make those blunders 0.6% of the time) and is on because XIAO asked for fewer obvious blunders.
- Habits alone (no mistake model): top-1 47.3% → 47.6%. The shape and phase features barely help prediction at 5k; the gains come from costs, book and evolution.

## Open
- Not yet measured on XIAO's own games (they live only in the browser); the Copy page shows the same numbers after a retrain.
- In-app the mistake profile uses KataGo's search values from the analysis; play uses one network look per candidate (noisier).
