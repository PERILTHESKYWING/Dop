# Kami task factory and answer checker
Summary: how training tasks for Kami's own writer model are made, checked and stored.

## Files
- `src/lib/coach/answerCheck.ts`: `checkAnswer(ex, text)` and `checkConceptAnswer(entry, text)`. Pure code, used by the site, verify.ts and the trainer's scores. Tests: `tests/answer-check.test.ts`.
- `scripts/coachlm/factory.ts`: makes tasks. `tasks.ts`: task format, split, concept prompt, jsonl io. `verify.ts`: scores answers. `merge.ts`: joins task files for the release.
- `.github/workflows/coach-lm.yml`: daily 08:23 UTC plus "Run workflow". `eval/coach/sample.jsonl`: 20 real factory tasks for tests.

## Contract (the Python trainer reads exactly this)
- Release `coach-lm`: `tasks.jsonl.gz` (train), `eval.jsonl.gz` (held-out test set, never trained on), `pool.jsonl.gz` (trainer's). Optional: if the trainer uploads `requests.jsonl(.gz)`, the next run answers it.
- Task line: `{id, promptVersion, kind: position|concept, split: train|eval, system: LM_SYSTEM, prompt, reference, explanation (no ownership) | null, concept: id | null}`. Position prompt = `buildLmPrompt(explanation)`; concept prompt = `buildConceptPrompt` in `scripts/coachlm/tasks.ts` (question, name, level, the library's text as facts, "no coordinates"). Reference = summary + sections (concept: short + body).
- `factory.ts --out f [--n 200] [--split train|eval] [--requests r.jsonl] [--minutes 30] [--existing tasks.jsonl.gz] [--seed s] [--sources ogs,titles,broadcast,demo,pro] [--games ogs-recent.jsonl.gz] [--sgf-dir titles]`. Request: `{taskId, question: {kind, move: "R16"|null, text}}`; a move must appear in that task's variations, else the request is dropped.
- `verify.ts --tasks f[.gz] (--answers a.jsonl | --self) --out scores.jsonl [--rubric eval/coach/rubric.json]`; score `{id, member, truth, coverage, depth, unsupported, pass, rubric, broken}` (rubric: kami-diagrams.md).

## Checker rules
- truth: every coordinate, number and `[[vN]]` must come from facts, concept hits, variations (moves, labels, notes, scoreLoss) or the question. Winrates within 1 (hedged round numbers like "about 60%" within 3), either player's view and gaps between two; points within 0.6 (hedged: 15%), gaps but not sums. "3-3", "3rd line", "3k", "19x19" are not figures. "move N" must fit the game plus the longest line; "N moves" must fit a line. Bare integers 0-2 and point figures up to 1 are free. I5 and Q20 always fail.
- coverage: average over groups present: facts used (of up to 6), variations referenced (of up to 4), concepts named or referenced (of up to 3), the asked move named.
- depth: causal words (0.1 each, max 0.3), refutation/consequence/what-if refs or examples (max 0.3), Go terms (0.1 each, max 0.3), 0.1 for 3+ sentences that are not mostly figures.
- pass: truth 1 and coverage >= 0.4. Concept answers: truth 0 if any coordinate; coverage = share of key terms (name or alias, up to 6 words of `short`, up to 3 related).

## How the factory works
- Positions from 2022 on only (since 2026-10-16): OGS games from the `game-data` release (`--games`), Japanese title games with DT 2022+ (`--sgf-dir`, the workflow fetches them from cwi.nl), and the repo's 2026 demo and broadcast games. The 1940-2017 pro walks only with `--sources pro`. A verified diagram also becomes an `<id>-own-diagram` task whose reference carries a DIAGRAM block. Per position: best, overview, why-not on candidates 2-5 (root read, 200 visits), why-move on the move actually played. Train = Tesuji/medium, eval = Tesuji/high.
- Split = hash of the canonical position (all 8 symmetries) or of the concept id; about 10% eval. Ids hash prompt version + position + kind + move (template wording ignored), so duplicates never reach the engine; a position whose "best" task exists is skipped before reading.
- A task whose own reference fails `checkAnswer` truth is dropped and counted (training on it would teach invention).
- Concept tasks (no engine) take at most a fifth of a run; none while `CONCEPTS` is empty.

## Workflow
- `prepare` creates the release if missing and compares the test set's promptVersion with `PROMPT_VERSION` (grep, no npm). `eval` (only then) and `tasks` run in parallel, one factory per core, 45 min each by default.
- The test set is uploaded only with at least 50 tasks; it is never rebuilt until PROMPT_VERSION changes. To rebuild it on purpose, bump PROMPT_VERSION.
- Tasks merge = old file + new files, dedupe by id, train split only. The upload is refused if the merged file is smaller than the old one, and the old file must download when it exists.

## Numbers (2026-10-15, cloud sandbox, 2 cores, one factory, the stand-in one-read explain)
- Train: 13.4 tasks/min (60 tasks, 3.3 s per explain). Eval (high): 7.4 tasks/min (20 tasks, 6.9 s per explain). Thread 1's real explain reads more, so expect fewer; re-measure after it merges.
- verify: 40,000 answers in 6.8 s = 171 µs per answer.
- References' own scores (80 tasks): pass 80/80, truth 1.000, coverage 0.829 (the stand-in does not name the asked move in why-not answers), depth 0 (one sentence).
- Gzipped task ~170 bytes with the stand-in explanation.

## Gotchas
- Forge problems are not a source: on their tsumego frame KataGo sees a decided game (best move pass, 0% or 100%, about 80 points). 0 of 44 sampled problems had an open fight.
- Old-version tasks stay in tasks.jsonl.gz after a PROMPT_VERSION bump (new ids, nothing deleted): the trainer must keep only `promptVersion == max`.
- The concept prompt lives in `scripts/coachlm/tasks.ts`; if the site asks the LM concept questions it should use the same text.
- Demo and broadcast positions (~10k) run out after some weeks; pro walks keep going.
- 2026-10-15: PROMPT_VERSION 2 after the explainer fixes (setup stones, wording, deeper reads); the next daily run rebuilds the test set. Forge problems were left out because KataGo read them as decided games ("pass" on top). That was the setup-stone bug in `engineMoves`, now fixed, so problems can likely go back into the mix: re-check a sample before adding them.
