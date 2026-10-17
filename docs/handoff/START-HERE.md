# ⚫⚪ START HERE: Dop × Kami handoff

```
   ●○   D O P      the local-first Go trainer        (dop.vercel.app)
  ○●○  K A M I     the Go coach that shows its work  (kami/, second Vercel project)
   ●
        KataGo thinks.  Code checks.  Words come last.
```

**As of 2026-10-17.** Kami is now **Kiai** (landing page, Ikki logo, kaya board, Skim/Dive/Abyss): `kami.md` › Kiai, renders in `kiai-art.md`. Kami's teacher voice from XIAO's critique (round 2): `kami-engine.md` › Round 2. Built positions (diagrams) and the rubric: `kami-diagrams.md`. Read this first in a new session, then `CLAUDE.md` (hard rules). Open the other notes in `docs/handoff/` only when a task needs them.

---

## 1 · The idea in one breath

General LLMs can't read a Go board, so they invent lines with confidence. **Kami** does it the other way round:

1. **KataGo reads.** A planner in code decides *what* to read: the asked move, the reply, a refutation, or two lines played out to see where a slow move goes wrong.
2. **Code turns the reads into facts.** Every number and every move in an answer comes from a read, and hovering a `[[v1]]` chip plays that line on the board.
3. **A writer only rewords.** Gemini on Myoshu today, Kami's own small model later. `checkAnswer` rejects any invented move or number, and the engine's own text is the fallback.

```
 question ─▶ question.ts ─▶ explain() ───────────────▶ facts · concepts · [[variations]]
                              │  planner.ts  (what to read)          │
                              │  consequence.ts (where it goes wrong)│
                              │  concepts.ts (key point, sente, ...) ▼
                 KataGo ◀─────┘  b18 on GPU / b10 on CPU  text.ts (facts) + teach.ts (voice) ─▶ writer
                                                          situation.ts picks the tone            (Gemini / own model)
                                                                          └▶ checkAnswer ✔/✘
```

## 2 · Where things stand

| Piece | Where | State |
|---|---|---|
| Explain engine | `src/lib/coach/explain/` | ✅ merged (#33), fixed in #38 |
| Kami site | `kami/` | ✅ merged (#34), fixed in #38 |
| Answer checker, task factory, daily workflow | `src/lib/coach/answerCheck.ts`, `scripts/coachlm/*.ts`, `.github/workflows/coach-lm.yml` | ✅ merged (#35) |
| Trainer, population + hivemind | `scripts/coachlm/*.py`, `public/pc-helper/start-kami-training-windows.bat` | ✅ merged (#36), never run on the real GPU |
| Concept library, 48 ideas + 17 checked boards | `src/lib/coach/library/` | ✅ merged (#37) |
| Board panel = Dop's study board in Kami | `kami/src/ui/BoardPanel.tsx`, `kami/src/lib/analysis.ts` | ✅ merged (#39), **not yet checked in a browser** |
| Kami on Vercel, keys | Vercel `kami` project | ✅ set up by XIAO (2026-10-15) |

No PRs are open at the time of writing.

### Round 2 of "Smarter Kami AI" (2026-10-16): XIAO's critique applied
- **Teacher voice** (`teach.ts`, `situation.ts`): answer first in Go words, the reason from the board, numbers only as support. Relaxed "play your style" in open openings, a celebration for an equal move, a short cheeky blunder line, Yes/No first for "can I kill it?", the whole-board picture first for overviews, "Plot twist" when lines transpose, "peaceful game or a fight?" for two different good moves.
- **New reads**: what the opponent does if you pass (purposes, saved stones), double sente / reverse sente, sente follow-ups, a calm keima option, move order.
- **Life and death**: a local solver (`lifeDeath.ts`) proves or fails to prove problems; no winrates in problem answers.
- **No invented stones**: game cut-outs with made-up walls and writer-built positions are gone; textbook diagrams need 10+ real stones.
- **Site**: hover definitions for Go terms, Settings › Profile (level, style; Kami learns your style), question intents, zoom on problems.
- **Rubric v1** (34 rules from the critique) and an optional **ChatGPT tone reviewer** for training only (`kami-training.md`).

### What #39 did (2026-10-15)

- The board panel uses Dop's own pieces: the eval bar with the change from the last move, best-move discs, territory, step buttons, Trend / Blunder / Performance tabs, and the tools row.
- **Eval and best moves:** KataGo reads the board position at 120 visits. Results are cached, and a stale read (you have already moved on) is skipped.
- **Trend:** while a trend tab is open, every position in the game is read at 60 visits in the background ("Reading the game… n/N"). Closing the tab or changing the line stops it.
- **Size:** 42% of the width in the right column on wide screens. On phones at most half the screen height; the board fills what is left.
- Player names are kept for loaded games.
- Dop's `Live.tsx` changed only in that the candidate helpers moved to `src/lib/analysis/candidates.ts`; it re-exports them, so Dop's behaviour is the same.
- **Timings (sandbox, one Node thread, bundled b10 network, not a browser):**
  - A 200-visit board read took 11.3 s; 120 visits should take about 7 s (estimate, not measured directly). A cached re-read took 43 ms.
  - A 60-visit trend read took about 3.2 s per position, so a 120-move game is about 6 minutes on one thread. A browser with several workers should be faster. Not measured on a device.

### What #38 fixed (2026-10-15)

- 🐞 **Set-up stones were misread everywhere** (Dop too). Handicap games, SGFs with AB/AW and library boards went to the engine as "all Black, then all White", and the network misjudged them: 4 opening stones read **B+13.0 instead of W+0.9**. `engineMoves` now alternates them with passes, so they read exactly like real moves. Stored analyses of games with set-up stones are redone automatically, and only those.
- 🧠 **Strong network in Kami:** kata1 **b18** on computers with WebGPU (Dop's own rule), b10 on phones and CPUs, and b10 on any device where the GPU crashed once.
- 🗣️ **Questions understood:**
  - "Why was my move bad?" used to get the opponent's next move. It now judges your last move.
  - "What should I have played?" now goes back to before your move.
  - "Why was R16 bad?" 30 moves later now goes back to R16.
- 🎯 **Answers say the real reason:**
  - "After O16, White takes B9 itself, the point Black should have played."
  - When there's no key point, it says where the opponent answers.
- 🧹 **No more fake insights:**
  - "Worse from the first move" (which only meant "you didn't play there") is gone.
  - Per-region point sums that contradicted the real loss are gone.
  - Raw "(0.2)" ownership became percentages, e.g. "White's (85%)".
- 🔬 **Deeper reads:** line reads get 64+ visits, up from 11–19. Tesuji medium reads average 333 visits, up from 191 (b10 in Node; b18 on a GPU is faster, not yet measured).
- 🔁 `PROMPT_VERSION` → 2, so the daily workflow rebuilds the training tasks and the test set with the fixed engine.

### Why Kami explains so little (diagnosed 2026-10-15)

- The writer may be off: without `LLM_API_KEY` on the `kami` project, Kami shows the engine's fallback text, which reads as "here is the best move". Check this first.
- The facts are thin. The writer gets the best move, the score lead, a few lines, ownership and a few concepts. That says what KataGo prefers, not why.
- Few concepts match: 45 ideas and 17 checked boards.
- Dop's coach sounds better because Gemini brings its own Go knowledge. Kami's checker rejects anything it can't tie to a number, so it stays quiet. This is the trade-off to fix, not to drop.

## 3 · Two decisions for XIAO (needed before threads A and B)

1. **Board size vs the half-screen rule.** You asked for a bigger board, and earlier for the panel never to take more than half the screen. Today the phone board is about 170 px tall on an 844 px phone (an estimate; it was about 340 px before the rule). Options:
   - **a.** Keep 50%. Make the desktop board bigger by widening the Kami board column to 50% of the width (it is 42% now). Phones stay small.
   - **b.** Raise the phone cap to 60% of the height. The board is about 250 px on an 844 px phone.
   - **c.** On phones, move the tools and tabs below the chat, so the board gets the whole 50%.
   - **Recommended: a + c.** Tell me which.

2. **"The AI sets up any position"**: decided 2026-10-16, XIAO asked for built positions that pass several checks with KataGo last (see `kami-diagrams.md`). The original proposal:
   - The writer may ask for a set-up diagram (stones with colour and point). Code places them.
   - Code checks the set-up is legal (`replay`), then KataGo reads it.
   - The explanation may only state what that read shows. A claim that doesn't match the read is dropped.
   - Each set-up is labelled as an illustration and shown on the board.
   - Cost: at most one extra Gemini call per answer (free tier). Ask before any paid API.

## 4 · Threads for the next session

One task per thread, one PR each. File ownership is listed so the threads don't collide. Start a thread only after its decision is made.

| Thread | Goal | Owns (only these files) | Waits for |
|---|---|---|---|
| **A · Board size and right-hand panel** | Bigger board. Buttons, tabs and functions match Dop's study board: Best moves, Territory, Numbers, Heat map, Pass, AI analysis. Data and Skill only if their data can come across. | `kami/src/ui/BoardPanel.tsx`, `kami/src/styles.css` (board section only), `kami/src/App.tsx` (layout only) | Decision 1 |
| **B · AI sets up positions** | The writer may ask for a checked set-up diagram; KataGo reads it; the answer may state only what the read shows. | `shared/kami.ts`, `kami/src/lib/writer.ts`, `kami/src/lib/answer.ts`, `src/lib/coach/explain/setup.ts` (new), and the one rule line in `CLAUDE.md` | Decision 2, and cost OK |
| **C · Explanation depth ("why")** | Reason facts from the board and the lines: liberties before and after, captures in the line, the opponent's best answer, the nearest concept. The writer gets them, and every one is checkable. | `src/lib/coach/explain/facts.ts` (new), `src/lib/coach/explain/text.ts` | Nothing |
| **D · Browser check** | Open Kami on a phone and a PC. Note whether the sizes look right. Time one real board read and one trend read. Write the numbers into `docs/handoff/kami.md`. | `docs/handoff/kami.md` (numbers only) | XIAO runs it on the device and reports back |

## 5 · Map of the notes

| Note | Open it when |
|---|---|
| `ux.md` | board screens, the study board's layout and rules |
| `kami.md` | site structure, board panel, deploy, network choice, how questions are parsed |
| `kami-engine.md` | planner, consequence search, concepts, budgets, measured speeds |
| `kami-factory.md` | training tasks, verifier, daily workflow, PROMPT_VERSION |
| `kami-training.md` | the PC trainer, hivemind, setup click by click |
| `kami-library.md` | adding concepts or KataGo-checked examples |
| `engine.md` | anything that changes KataGo itself (incl. `engineMoves`) |
| `open-items.md` | what was never verified |

## 6 · Best next moves (ranked)

1. **Decide** the two items in section 3.
2. **Browser check** (thread D): sizes on phone and PC, and real timings.
3. **Threads A, B and C** in parallel, once their decisions are in.
4. **Later** (still open):
   - Measure b18 in Kami on a PC: time per answer at Tesuji medium and high. Retune `budgets.ts` from real numbers.
   - Put Forge problems back into the training tasks. They were left out because KataGo read them as decided games, which was the set-up stone bug. Re-check a sample first (`kami-factory.md`).
   - First real training night on the 5070. Check that `chart.txt` goes up, then run `export.py --upload` and set `LOCAL_MODEL.repo` in `kami/src/config.ts` to `<your HF user>/kami-coach-web` to switch on *Kami Local*.
   - Ladder reader for the explainer. Ladders, thickness and aji are the ideas it can't detect yet.
   - Blind test page: Kami vs a raw LLM on the same positions, to prove the "best Go explainer" claim with numbers.

## 7 · Your checklist (XIAO)

- [x] Merge #38 (2026-10-15).
- [x] Kami on Vercel, with keys (you said it is set up).
- [x] Merge #39 (2026-10-15).
- [ ] **Look at the board panel** on your phone and PC. Tell me what looks wrong, with a screenshot if you can.
- [ ] **Answer decisions 1 and 2** in section 3.
- [ ] **Actions → "Kami coach tasks" → Run workflow**, if it hasn't run since #38. It builds version-2 tasks and the test set.
- [ ] **RTX 5070:** double-click `start-kami-training-windows.bat`. The installs and the keys are in `kami-training.md`.
- [ ] Optional, paid: an **OpenAI API key** for the ChatGPT tone reviewer (training only; `kami-training.md` › ChatGPT tone reviewer). Put it in the .bat prompt or Kaggle Secrets, never in a chat.
- [ ] Rate the round-2 answers on the critique page, like round 1.

## 8 · Hard-won gotchas

- **Never feed set-up stones as a block.** Always go through `engineMoves(setup, moves, toPlay)`.
- **Read noise is real.** Reads under about 50 visits move leads by 1–2 points. Never build a claim on one.
- **Ownership is not points.** Region sums swing with every trade; only searched leads are scores.
- **A difference from the first move is usually just where the stone went.** Name it as "where X belongs", not as a discovery.
- **The opponent's reply is the best explanation.** If it lands on KataGo's move, say so first.
- `LM_SYSTEM` is copied in `shared/kami.ts` (a test keeps them equal), and changing what the writer sees means bumping `PROMPT_VERSION` (4 since round 2: tone, situation and Kami's draft in the input).
- **Never invent board features.** No framed cut-outs of the game, no writer-built positions (XIAO, item 19). Textbook diagrams need 10+ real stones and no frame.
- Vercel caches `/engine` for a week: bump `ENGINE_FILES` when `public/engine` changes. Both sites share it.
- **Board reads start KataGo on the first stone**, not the first question. On a PC with WebGPU that downloads the b18 network (about 97 MB) at that moment.
- **Trend reads are the slow part.** On one thread, about 3 s per position at 60 visits. They run in the background and never block the board.
- **Stale board reads are skipped** (`wanted` in `kami/src/lib/analysis.ts`), so fast stepping doesn't queue reads nobody will see.
- **Pure modules in `src/lib` must not import types from `.tsx` files.** The build fails with TS6142 ("--jsx is not set"). Move the type or copy its shape, as `candidates.ts` does.
- **Kami reuses Dop's `src/components` pieces** (`PlayersBar`, `Stepper`, `TrendPanel`, `BlunderPanel`). Kami's CSS copies the few variables and classes they need (`--glass`, `--glass-2`, `--blur`, `.stone-dot`, `.mono`). If Dop's board look changes, check Kami too.
- **Cloud sessions:** `gh pr create` fails (GraphQL is blocked). Use `gh api repos/PERILTHESKYWING/Dop/pulls -X POST -f title=... -f head=<branch> -f base=main -F draft=false -F body=@<file>`.
- **The stop hook needs `origin/<branch>`** to exist. In the shallow clone, after a push run `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>`.

## 9 · Paste this to start the next session

```
Continue Dop/Kami in PERILTHESKYWING/Dop. Read docs/handoff/START-HERE.md first, then CLAUDE.md.
Use the repo skills (start with dop-lean-session). Task: <what you want>.
```
