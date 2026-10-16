# Kami diagrams (built positions) and the rubric
Summary: how Kami sets up a position to explain an idea, the checks it must pass, the settings, and how XIAO's critique becomes the scorer's rubric. Added 2026-10-16 (thread "Smarter Kami AI").

## The rule (XIAO, 2026-10-16)
Kami may build positions to explain a concept, but never blindly: each one passes code checks, then KataGo reads it last, and only what that read shows may be said about it. One side must not be losing by more than the "lowest win rate" setting (default 30%).

## Files
- `src/lib/coach/explain/illustrate.ts`: `DiagramSpec`, `staticChecks` (board, legal, frame, legal), `verifyDiagram` (first read, komi, even, claim, stable, optional worse read; KataGo's final read last; a framed diagram gets one komi retry), `isolate` (cut the real fight out of the game, same coordinates; null for center fights and boards under 13x13), `frameBalance`.
- `diagrams.ts`: `illustrateDefaults(model, thinking)` (off for Hane, thinking off/low), `diagramFor` (what the diagram claims), `buildDiagrams` (isolate first, then the library's textbook example for each detected concept).
- `writerDiagram.ts`: the writer's optional `DIAGRAM ... END` block (format in `LM_SYSTEM`, prompt.ts). `kami/src/lib/writer.ts` `writerDiagram` parses it, verifies it with the same checks, and keeps it or drops the block and every sentence that refers to it. checkAnswer then runs with the diagram's facts.
- Output: `Explanation.illustrations[]` (`id` d1.., `base`, `line`, `highlight`, `view`, `checks`, `read`), shown as `[[dN]]` chips; hovering plays the diagram on the board (kami/src/ui/Messages.tsx).
- Settings › Positions (`kami/src/lib/settings.ts`): `positions.minWinrate` 30%, `positions.enabled`, `positions.writerDiagrams`, `positions.visits` 200, `positions.maxKomi` 30, `positions.maxSeconds` 12. The thinking tier still decides whether diagrams run.

## Checks, in order
board (size, points on the board) → legal (replay, no suicide, no captures left hanging) → frame (tsumego frame from `src/lib/problems/frame.ts` around the corner/side, when the spec asks for one) → legal again → first KataGo read → komi (evens the game; the local value, komi minus `frameBalance`, must be within maxKomi) → even (each side ≥ minWinrate) → claim (best move is KataGo's best or within 0.5 pts; "worse" is 0.5+ pts worse) → stable (claim holds at the final, deeper read).

## Measured (2026-10-16, Node WASM b10, 1 thread)
- Bench, Tesuji/medium, 11 positions: 3 got a diagram, most others failed "claim" (KataGo prefers another move in the cut-out). Kept strict on purpose.
- Critique batch, Tesuji/high, 28 items: see the thread for the count; answers with diagrams took 9-30 s.
- The writer's own diagram is unit-tested with a scripted engine only; not yet tried with real Gemini.

## Rubric
- `eval/coach/rubric.json` (v0 seed by Claude until XIAO's critique replaces it). Rules with a `check` (require, forbid, words, leadsWithAnswer, refsDiagram, terms) are scored by `src/lib/coach/rubric.ts`; every rule's text also goes to the judge (`scripts/coachlm/judge.py`, fourth number, 50%).
- `verify.ts` adds `rubric` (0 when truth < 1) and `broken`; `pool.py` blends `answer_quality = 0.5·base + 0.5·rubric`.
- XIAO's critique: `scripts/kami-critique.ts --out f.json` makes the 28-item batch; the critique page stores feedback in the artifact's db, collection `feedback`, docs `item-<id>` and `item-general` ({rating, tags, text}). Read them with the ArtifactData tool and rewrite rubric.json from them (keep `from: "XIAO, item N"`).

## Data limits
- No free post-2022 corpus of humans explaining Go with positions exists that we found, so XIAO's rubric is the human signal. Training positions are 2022+ games only (OGS archive release, cwi title games with DT ≥ 2022, the repo's 2026 engine games); the 1940-2017 pro walks only with `--sources pro`.
