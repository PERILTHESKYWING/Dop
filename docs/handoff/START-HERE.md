# ⚫⚪ START HERE: Dop × Kami handoff

```
   ●○   D O P      the local-first Go trainer        (dop.vercel.app)
  ○●○  K A M I     the Go coach that shows its work  (kami/, second Vercel project)
   ●
        KataGo thinks.  Code checks.  Words come last.
```

**As of 2026-10-15.** Read this first in a new session, then `CLAUDE.md` (hard rules). Open the other notes in `docs/handoff/` only when a task needs them.

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
                 KataGo ◀─────┘  b18 on GPU / b10 on CPU      text.ts ─▶ writer (Gemini / own model)
                                                                          └▶ checkAnswer ✔/✘
```

## 2 · Where things stand

| Piece | Where | State |
|---|---|---|
| Explain engine | `src/lib/coach/explain/` | ✅ merged (#33), **fixed in #38** |
| Kami site | `kami/` | ✅ merged (#34), **fixed in #38** |
| Answer checker, task factory, daily workflow | `src/lib/coach/answerCheck.ts`, `scripts/coachlm/*.ts`, `.github/workflows/coach-lm.yml` | ✅ merged (#35) |
| Trainer, population + hivemind | `scripts/coachlm/*.py`, `public/pc-helper/start-kami-training-windows.bat` | ✅ merged (#36), never run on the real GPU |
| Concept library, 45 ideas + 17 checked boards | `src/lib/coach/library/` | ✅ merged (#37) |

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
- 🔬 **Deeper reads:**
  - Line reads now get 64+ visits, up from 11–19.
  - Tesuji medium reads 333 visits on average, up from 191 (b10 in Node; b18 on a GPU is faster, not yet measured).
- 🔁 `PROMPT_VERSION` → 2, so the daily workflow rebuilds the training tasks and the test set with the fixed engine.

## 3 · Your checklist (XIAO)

- [ ] **Merge #38.**
- [ ] **Kami on Vercel** (once, if not done yet):
  1. Add New → Project → Import PERILTHESKYWING/Dop.
  2. Name it `kami`; Root Directory → `kami`.
  3. Optional: add `LLM_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL` for Myoshu.
  4. Deploy.

  Full steps are in `kami.md`. If the project already exists, the merge redeploys it by itself.
- [ ] **Test it on your computer.** The line under the board should say **"KataGo b18 (strong) · GPU"**. Paste a game, then ask "why was my move bad?".
- [ ] **Actions → "Kami coach tasks" → Run workflow.** This builds version-2 tasks and the test set.
- [ ] **RTX 5070:** double-click `start-kami-training-windows.bat`. The installs and the 3 keys are in `kami-training.md`.

## 4 · Best next moves (ranked)

1. **Measure b18 in Kami** on your PC: time per answer at Tesuji medium and high. Retune `budgets.ts` from the real numbers.
2. **Put Forge problems back into the training tasks.** They were left out because KataGo read them as decided games, which was the set-up stone bug. Re-check a sample first (`kami-factory.md`).
3. **First real training night** on the 5070. Check that `chart.txt` goes up, then run `export.py --upload` and set `LOCAL_MODEL.repo` in `kami/src/config.ts` to `<your HF user>/kami-coach-web` to switch on *Kami Local*.
4. **Ladder reader** for the explainer. Ladders, thickness and aji are the ideas it can't detect yet.
5. **Blind test page:** Kami vs a raw LLM on the same positions, to prove the "best Go explainer" claim with numbers.

## 5 · Map of the notes

| Note | Open it when |
|---|---|
| `kami.md` | site structure, deploy, network choice, how questions are parsed |
| `kami-engine.md` | planner, consequence search, concepts, budgets, measured speeds |
| `kami-factory.md` | training tasks, verifier, daily workflow, PROMPT_VERSION |
| `kami-training.md` | the PC trainer, hivemind, setup click by click |
| `kami-library.md` | adding concepts or KataGo-checked examples |
| `engine.md` | anything that changes KataGo itself (incl. `engineMoves`) |
| `open-items.md` | what was never verified |

## 6 · Hard-won gotchas

- **Never feed set-up stones as a block.** Always go through `engineMoves(setup, moves, toPlay)`.
- **Read noise is real.** Reads under about 50 visits move leads by 1–2 points. Never build a claim on one.
- **Ownership is not points.** Region sums swing with every trade; only searched leads are scores.
- **A difference from the first move is usually just where the stone went.** Name it as "where X belongs", not as a discovery.
- **The opponent's reply is the best explanation.** If it lands on KataGo's move, say so first.
- `LM_SYSTEM` is copied in `shared/kami.ts` (a test keeps them equal), and changing what the writer sees means bumping `PROMPT_VERSION`.
- Vercel caches `/engine` for a week: bump `ENGINE_FILES` when `public/engine` changes. Both sites share it.

## 7 · Paste this to start the next session

```
Continue Dop/Kami in PERILTHESKYWING/Dop. Read docs/handoff/START-HERE.md first, then CLAUDE.md.
Use the repo skills (start with dop-lean-session). Task: <what you want>.
```
