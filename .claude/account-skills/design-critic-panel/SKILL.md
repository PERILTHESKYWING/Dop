---
name: design-critic-panel
description: Use when judging or iterating a visual design (landing page, app screen, board, logo) with critic agents, so scores are stable, comparable across rounds and lead to concrete fixes.
---
# Design critic panel

Why: past Kiai rounds used 5-10 Haiku critics scoring 0-10 from scratch. Scores sat at 4.5-7.7, swung about ±1 between rounds, and critics flipped advice (one round asked for X, the next for the opposite). This setup fixes the causes: no anchors, no memory, absolute scores, too-weak judges.

## 1. Inputs, frozen for the whole run
- **Rubric**: the user's own lines (e.g. XIAO's 8 rubric lines) verbatim, each with what a 3, 6 and 9 look like. Never reword it between rounds.
- **Anchors**: 2-3 reference images the user likes (a 9) and one they called bad (a 3). Every critic sees them every round.
- **Decisions log**: things the user already decided (e.g. "no gradients, no glow, no pulses", "text at least 17 px", "no small grey text under titles"). Critics may not reopen them.
- **Stills**: the same set every round: desktop 1440x900 and phone 390x844, same scroll points, same theme, from headless Chromium. Add a crop at 2x for detail work (stones, wood, logo).

## 2. Critics
- Use a strong vision model for judging (Sonnet or Opus class); keep Haiku for cheap pre-checks only.
- 5 critics, each owning 1-2 rubric lines (not everything), plus one generalist.
- Each critic gets: rubric, anchors, decisions log, this round's stills, last round's stills, and last round's accepted fixes.

## 3. Scoring: pairwise first, absolute second
- Main question: "Is this round better, same or worse than last round on your lines, and why?" Pairwise judgments are far less noisy than 0-10.
- Then a 0-10 per line, anchored to the reference images, with one sentence of evidence pointing at a region of a still.
- Output strict JSON: `{line, verdict: better|same|worse, score, evidence, fix: {where, what, how_to_check}}`. At most 3 fixes, ranked.

## 4. Aggregate
- Median per line, not mean. Report the spread; if critics disagree by more than 2, show both views instead of averaging.
- A fix is accepted only when 2+ critics ask for it, or one critic plus a measurable check (pixel colour vs reference, contrast ratio, font size, overlap test).
- Measure what can be measured instead of asking a critic (e.g. sampled board colour rgb vs reference, text sizes, WCAG contrast).

## 5. Loop and stop
- Apply only accepted fixes, one round at a time, re-render the same stills.
- Keep a round table: round, median per line, accepted fixes, what changed.
- Stop when the gate is met, after 2 rounds with no median gain, or at the user's round limit. Never silently keep going past it.

## 6. Report to the user
- Before/after stills side by side, the round table, what is still open, and honest numbers (say when gains are within noise).
