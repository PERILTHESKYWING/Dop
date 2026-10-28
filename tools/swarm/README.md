# Improvement swarm: builders, fixed shots, 10 critics

XIAO asked (2026-10-22) for a swarm that keeps improving Kiai (`kami/`) and the Dop hub (`hub/`), so that people who hate AI apps like them. Every change ships only once **10 critics** score it **8/10 or more** (median), and after that the same loop runs again with a higher bar. XIAO's picks: critics are AI-hating strangers mixed with Go players and designers; Kiai login is email + password (free, Dop's `/api/account`); the level-up is a study path 30k→9d plus days in a row; the name stays Kiai; the lead may merge its own PR once it scores 8+ and passes the checks. Effort: critics medium, builders high, ideators xhigh.

## The loop
1. **Ideate** (xhigh): one spec per area (Kiai looks, Kiai feature, hub). Write the spec into the scratchpad, never into the product.
2. **Build** (high): one builder per area, each in its own worktree and branch. They never push. The lead merges them into the thread branch.
3. **Shoot**: the same fixed shot set every round (scripts below), desktop 1440x900 and phone 390x844, light and dark, all from **one** integrated build.
4. **Critique** (medium): 10 critics, personas and rubric frozen in `CRITICS.md`. Resume the **same** critic agents each round so their pairwise "better/same/worse" means something. Strict JSON out.
5. **Accept fixes**: a fix is accepted when 2 or more critics ask for it, or when it is measurable (contrast, size, ms). Write `FIXES-Rn.md` and split it between fixers by file ownership.
6. Repeat until the median overall is 8 or more. Then: run typecheck, test and build; push **once**; open the PR and mark it ready; merge when the checks are green.
7. **Higher bar**: the next round starts from the open fixes the critics left, and the gate goes up one point (round 2 of the routine: median 9).

## Scripts (Playwright is preinstalled in the cloud sandbox)
- `kiai-landing-shots.cjs OUT 1 '?kiai3d'`: landing chapters 0-5. Needs `npm run kami:build` and a preview on port 4291.
- `LEVEL=default kiai-app-shots.cjs OUT light|dark both`: app states 0-4 (empty, game, thinking, answer, hover) on the landing's demo game. The board rect must be identical in all 5 states.
- `SCHEME=light|dark OUT=dir kiai-journey-shots.cjs`: sidebar foot, Settings › Journey, Account (signed out, create, recovery code, signed in). Needs the account API (`kami:dev` memory store).
- `node hub-seed-server.mjs` (with `BIG=1` for the long list), then `hub-shots.cjs OUT`: a seeded fake hub (memory store, fake Claude). The seed is for screenshots only and is not product data.
- `BIG=1 LONG=500 PORT=7791 node hub-seed-server.mjs`, then `[ALL=1] node hub-feed-perf.cjs http://localhost:7791 6 2000`: long-thread speed on a 390 px phone with 4x CPU throttle; prints thread-open ms and dropped frames during a fling (median and p90). `ALL=1` draws every message first. Run main and the branch on two ports and compare.

## Results
| Round | Kiai median | Hub median |
|---|---|---|
| 1 | 6 | 7 |
| 2 | 7 | 8 (all 10) |
| 3 | 8 (all 10) | polish only |
| 2026-10-26 r1 | 8 (all 10) | 8 (three at 7) |
| 2026-10-26 r2 | 8 (all 10) | 8 (all 10) |
| 2026-10-24 (paused, finished 10-27) | 8 (all 10, two passes) | 8 (all 10, two passes) |
| 2026-10-26 (second run, Kiai only, 3 rounds) | 8 (all 10, every round) | not shot |
| 2026-10-27 r1 | 8 (all 10; phone 7 from seven) | 8 (nine), 7 (artist) |
| 2026-10-27 r2 | 8 (all 10; phone 8 from all) | 8 (all 10) |
| 2026-10-28 r1 (critics 1-5) | 7 (7,7,8,8,7) | 7 (7,7,7,7,6) |
| 2026-10-28 r2 (1-5) | 8 (7,8,8,8,7) | 7 (7,7,8,8,6) |
| 2026-10-28 r3 (6-10) | 8 (8,7,8,8,8) | 7 (7,7,8,7,7) |
| 2026-10-28 r4 (1-5) / r5 (6-10), last score of each critic | 8 (nine at 8, accessibility 7) | 7.5 (four at 8, five at 7, artist 6) |

Two runs of this routine overlapped on 2026-10-26 and built the same wishes twice; the second run ported only what main lacked (PR for 2026-10-27). Before starting, check open PRs **and** `git log origin/main` for a swarm merge from today, and never reuse a branch name that already exists on origin.

Daily runs: shots for a run live in the run's scratchpad (before = main, after = the merged branch). The journey script walks the phone Settings list (`goPage`); the app script has a sixth state, `5-hover-candidate` (desktop hovers a candidate disc, phone taps a coordinate that is one of KataGo's choices). Stop servers by pid or with a script file: `pkill -f "port 4291"` in a one-line shell also kills that shell.

The critics' open wishes after 2026-10-28 (gate not met: hub median 7.5, and the artist (hub 6) and accessibility (Kiai 7) critics sit below their last 8; PR left open for the next run). Done this run from the 10-27 list: board keyboard play with an ink focus ring and a stone-sized point (shot `6-board-focus`), "53 of 160 positions in the last read" with "N positions in 2 reads" on the answer card, 14 px grey help, flat sheet dim (the hub has no backdrop-filter left), Calm working line as a still green ring, phone tiles and Filter on one grid with no fake "open" tile, quiet Mark usage reset, Studio demo line and a faint disabled Send, ink checkbox and no number spinner in sheets, Threads tab marked inside a thread. Rail meta was already 13 px or more (only avatar initials are 12).
- Kiai: phone candidate rings without a number (R10, N8, R8 are bare; asked by 4 critics; they are drawn in the 3D canvas `setPale`, so the label has to go there); board labels and chrome at 11-13 px (accessibility); the board focus ring hugs the panel, not the wood; Journey seals cut off at the bottom of the sheet, and a meaning under each seal; phone answer card does not say "KataGo read"; the speed figure is one raw sample; LLM disclosure only on the last landing frame; lazy-load the 3D board chunk (143 kB gzip) after first paint.
- Hub: the artist marks Studio down for being code-drawn art (asks for "Use my own drawings" first and a "drawn by code" tag on frames; a product question for XIAO, not a fix); the sheet dim still reads weak to three critics (now 55% black); phone thread opens with the task card cut under the header; desktop rail text links under 24 px targets; phone Threads header takes ~490 px before the first thread; Alt card shows red twice (word and bar); Studio phone note dot and 11 px caption; login and Filter placeholders near 3.5:1; Lively verb shimmer repaints (off by default); "Show earlier" warm-up frames (unchanged from 10-27).
- Runs: if a swarm PR paused at usage limits is older than a merged newer run, port its unique parts instead of merging (on 2026-10-27 three runs overlapped: #118 was merged with a port in #120 while #121 ported the same parts again; #121 kept its later, critic-scored versions). `kill $!` after `npx vite preview` leaves the server running; stop it by port (see shoot scripts) or with `node node_modules/.bin/vite`.
