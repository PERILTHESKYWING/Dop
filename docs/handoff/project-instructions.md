# Project instructions for a new Claude project
Summary: part 1 is the text to paste into the new project's instructions; part 2 is the thread and PR history, which stays here and is read only when needed.

Paste only part 1. Project instructions load into every session, so the history in part 2 would cost tokens on every turn.

## Part 1: paste this

```
This project continues DOPPELGÄNGER, my Go training site, in the repo PERILTHESKYWING/Dop. The repo's CLAUDE.md has the product, stack and hard rules; docs/handoff/ has short topic notes and the full history (docs/handoff/project-instructions.md). Open those only when a task needs them, and don't read the long README unless asked.

How I want you to work:
- One task per thread. When I send a big message with several asks, split it into parallel threads, one PR each, and say which thread owns which files so they don't collide.
- Build it, test it (npm run typecheck, npm test, npm run build), then open the PR as ready for review, not draft. Tell me in one line what to merge and anything I must do after.
- Bug reports mean: reproduce, fix, PR. Don't ask me first for reversible work.
- Ask me first before anything that costs money, deletes data, or changes production settings.
- I'm on free plans: Vercel Hobby, Gemini Flash on the Google AI Studio free tier, free GitHub Actions. Keep LLM calls per turn low. Any Vercel or GitHub step I must do: spell it out click by click, as few as possible.
- The LLM only explains KataGo's numbers and real data; it never invents analysis. A position built to explain an idea is shown only after code checks and a final KataGo read. The app must still work with no LLM.
- Measure speed or strength changes (Settings > Benchmark, scripts/ai-eval.ts) and give me honest before/after numbers, including when something didn't help.
- The free AI study board and Doppelgänger are the main features. Keep the UI plain (no gradients, short copy) and phone-friendly.
- Replies: short, plain language, answer first. No long reports in chat.
- When a thread finishes something worth remembering (a decision, a PR merged, a gotcha), add it to the matching docs/handoff note in that PR and keep CLAUDE.md small.
```

## Part 2: history (don't paste)

All PRs below are merged except #6. Detail per topic is in the other docs/handoff notes.

| Round | Thread (old project) | What it built | PR |
| --- | --- | --- | --- |
| 1 | Build Doppelgänger Go trainer | First build: SGF import, browser KataGo, player fingerprint, Forge, blind tests | #1 |
| 2 | same | Game loading fixes, LLM test connection, 30% practice floor, analysis board | #2 |
| 3 | same | Lizzie-style live analysis, our own tree search, Doppelgänger page | #3 |
| 4 | same | Landing page, home redesign, themes, icon and loader | #4 |
| 5 | Live AI broadcast + study board | 8 KataGo self-play tables, study board (betting later removed) | #5 |
| 5 | Self-improving PC trainer | Train a net from zero on XIAO's RTX 5070. Closed: can't beat existing KataGo nets | #6 closed |
| 5 | AI coach | Rank estimate, move badges, Ask about a position, opponent copies, nightly coach training | #7 |
| 6 | Grounded Go chat | #/chat, KataGo-grounded Gemini chat with a code checker | #8 |
| 6 | LLM strategy, board UX and live-game fixes | Candidate list, kifu export, live-game fixes, betting removed | #9 |
| 6 | Forge question quality rebuild | KataGo-verified problem bank, 101weiqi-style settings | #10 |
| 7-8 | Board UI polish + live game bug | Live-game floor fix, slim sidebar, Doppelgänger play view, resign/review | #11, #12 |
| 9-10 | Mobile board-first layout and accounts | Shared Fox-style BoardScreen, phone tab bar, optional accounts, board details, Performance tab | #13, #15 |
| 10 | Site-wide visual polish | One font, flat buttons, half the copy | #14 |
| 10 | Skill estimate to 12d | 12d scale, Skill tab, better rank model | #16 |
| 10 | Faster on-device KataGo | SIMD engine, parallel workers, caches, benchmark (~4.5x) | #17 |
| 11 | Stronger AI, less phone heat | Opening book, big-net anchors, cool mode, PC helper, DopNet student, AI training workflow | #18 |
| 12-13 | Recent game dataset | OGS 2022+ data, then student evolution, training chain, home GPU trainer, faster search | #19, #20 |
| 14 | Handoff | CLAUDE.md and these notes | #21 |
| Kami | Smarter Kami AI (new project) | Round 1: KataGo-checked built positions, rubric v0, 2022+ training data, critique sheet. Round 2: XIAO's critique of 28 answers applied (teacher voice, life-and-death solver, glossary hovers, Profile and style memory, rubric v1, ChatGPT tone reviewer for training) | #42, #45 |
| Kiai | Kami rebrand (2026-10-17) | Kami renamed Kiai: Ikki the razorbill logo, Skim/Dive/Abyss, landing page with a path-traced intro flight and hero (board above the clouds), kaya board skin in the app; 5 Haiku critics per round (`kiai-art.md`) | this thread's PR |

Decisions to keep: the LLM is grounded, not retrained; ChatGPT only reviews tone during training, never on the sites; betting and focus mode were removed on purpose; the PC engine bridge exists only as the optional PC helper; no free human game archive exists after May 2025. Open items are in `open-items.md`.
