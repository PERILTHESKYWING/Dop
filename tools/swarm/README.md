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
| 2026-10-27 r1 | 8 (all 10; phone 7 from seven) | 8 (nine), 7 (artist) |
| 2026-10-27 r2 | 8 (all 10; phone 8 from all) | 8 (all 10) |

Daily runs: shots for a run live in the run's scratchpad (before = main, after = the merged branch). The journey script walks the phone Settings list (`goPage`); the app script has a sixth state, `5-hover-candidate` (desktop hovers a candidate disc, phone taps a coordinate that is one of KataGo's choices). Stop servers by pid or with a script file: `pkill -f "port 4291"` in a one-line shell also kills that shell.

The critics' open wishes after 2026-10-27 round 2, which are the start of the next run (none reached 9 yet; trust reached 9 from three Kiai critics and two hub critics):
- Kiai: board keyboard focus ring, and a focus shot in the set; secondary grey text at 14 px; landing "Who is ahead?" ownership drawn as stepped squares (soft per-point fills instead); landing board coordinates and a caption for its mark numbers; the readout's position count vs the answer's (say "53 of 229"); phone line preview shows 8 of 9 moves; a size budget for the entry chunk (index 105 kB gzip after this run) and a median-of-5 /app paint bench; seal 棋譜並べ mixes kana with kanji seals.
- Hub: after several "Show earlier" in a 500-message thread, the worst frame is 133-167 ms (main 83-133) while warming; full-screen backdrop blur on sheets (flat dim on phones); phone Threads tab tiles and Filter on one grid, selected tile without the black underline; Calm working line still shows the ✱; Look wallpapers (Dawn, Sea, Forest, Night sky) clash with paper-and-ink; Studio "No stories yet" beside the playing demo; Mark usage reset button is big on phone; desktop rail meta at 12 px could be 13; sidebar tan is loud in light mode.
- Runs: if a swarm PR paused at usage limits is older than a merged newer run, port its unique parts instead of merging (2026-10-27 closed #118 this way). `kill $!` after `npx vite preview` leaves the server running; stop it by port (see shoot scripts) or with `node node_modules/.bin/vite`.
