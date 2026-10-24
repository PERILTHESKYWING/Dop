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

## Results
| Round | Kiai median | Hub median |
|---|---|---|
| 1 | 6 | 7 |
| 2 | 7 | 8 (all 10) |
| 3 | 8 (all 10) | polish only |

The critics' open wishes after round 3, which are the start of the next round:
- Kiai: fewer Settings tabs on a phone (a list or "More"); seals all the same height on one baseline; path dots that fill in proportion and have 3:1 rings; a hover caption that explains the previewed move; a visible `:focus-visible` ring everywhere, with a coordinate's line opening on focus; phone labels at 11 CSS px or more (a critic measured about 7); one heading face in Settings; one alignment on the last landing slide on a phone; the visit count next to Q9 in the landing hero; bilingual hover on Go terms (扳 / ハネ).
- Hub: see `docs/handoff/hub-cloud.md`.
