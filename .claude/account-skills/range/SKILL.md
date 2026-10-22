---
name: range
description: Use when the user types /range or /crew, and on important open-ended work (a feature, a page, a launch, an explanation, a plan): turn the noun into verbs, bring in the fields that do them best, two of them critics, and use their methods, not role-play.
argument-hint: "[the task]"
---
# Range: bring in other fields

Look at the work through fields it never used to be worth consulting. This is where the options nobody thought of come from.

## 1. Nouns to verbs
- Write the noun the user asked for ("a landing page", "a coach reply", "a review deck").
- Write what it actually has to do, as 2 to 4 verbs with their limits. Example: a coach explanation isn't "a text"; it has to make a 10-kyu player see why a move fails, remember it, and try it on the board, in under a minute.
- Next to each verb, the field that does that verb best (teacher, game designer, editor, data scientist, sports coach, journalist, UX researcher, animator, ...).

## 2. The crew: five fields, two of them critics
- Three builders from step 1, each from a different field.
- Two critics whose only job is to find what's wrong: a red-teamer (how does this fail or get abused), a skeptic who checks every claim against data, a forensic tester, a first-time user.
- For each one, one line: what they would actually do, and their method (a lesson plan with spaced recall, a playtest, an edit pass that cuts 30%, a statistical check, a five-second test).

## 3. Methods, not voices
- No "as a teacher, ..." and no role-played conversations: they make the transcript stranger without improving the work.
- Do what each method implies: build the playtest, run the stats, cut the copy, try the abuse case.
- In the result, say in one line per field what it changed.

## Cost
- Default: run the crew inline, as one checklist in one reply. No subagents.
- Separate agents only on important work and when the user agreed: the two critics are the ones worth separating, so the work isn't grading itself. For visual work the critics are `design-critic-panel`.
- Tasks with one right answer (a typo, a speed fix) skip range; use `depth`.
- The user's style rules still hold (in Dop: plain UI, short copy, free tiers). Range may suggest bigger ideas (a 3D walk-through, a video); offer them in one line with their cost, don't build them unasked.
