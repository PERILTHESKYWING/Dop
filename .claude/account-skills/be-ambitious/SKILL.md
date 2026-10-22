---
name: be-ambitious
description: Use when the user types /be-ambitious, and automatically at the start of a big or open-ended task: find the goal behind the task, pick altitude, depth or range, set an outside check, then work at that level.
argument-hint: "[the task]"
---
# /be-ambitious

Turn a task into its most useful version before starting. Three directions (from Felix Rieseberg's "three types of ambition", Oct 2026):
- **Altitude** (up): work on the outcome, not the task. Skill `altitude`.
- **Depth** (down): do it the way the best expert would, from raw material with their tools. Skill `depth`.
- **Range** (sideways): bring in other fields. Skill `range`.
Two habits hold them up: skill `outside-judge` (never grade your own work) and skill `keep-going` (don't stop at "impossible").

## Steps
1. **Goal behind the goal.** One line: what should be true once this is done, and why the user wants it. Ask "and then what?" until the answer stops changing (usually one or two hops). Example: "make the engine faster" → "a phone user gets a useful read on the study board within a second".
2. **Pick one or two directions**, rarely all three:
   - Altitude: the user is after an outcome that keeps coming back (bugs, speed, quality, a recurring chore).
   - Depth: the work has a right answer that experts reach with better data, tools or methods (engine speed, strength, data analysis, a hard bug).
   - Range: the work is open (a feature, a page, a launch, an explanation people must understand).
   Say in one line which and why the others were skipped.
3. **Plan at that level** with the chosen skill: altitude's ladder, depth's four questions, range's verbs and crew.
4. **Inputs.** List the data, tools and access the plan needs; mark what is here and what is missing. Get what you can yourself (read the repo, search, run a script). Ask for the rest once, batched.
5. **Outside check.** Name the test, measurement or reviewer that decides pass or fail, and the pass line, before any work (`outside-judge`).
6. **Brief.** Rewrite the task in at most 8 lines: goal, direction, plan in 3 to 6 steps, check and pass line.
7. **Do the work** at that level, unless the user only asked for the rewritten prompt. Before a big or risky plan, run `premortem` on it.

## Limits (ambition, paced)
- The user's rules still hold: free tiers, budgets, one task per thread, ask before anything that costs money, deletes data or changes production. Ambition changes the method, never these.
- A bigger goal than asked is a proposal, not a silent scope change. If it changes what gets delivered, say so in one line, deliver the asked task first, and take the bigger one only when it is cheap and clearly wanted.
- Altitude suits outcomes, less so taste and creative work. Range costs tokens: the full crew only for important work.
- Every "better" comes with a number from the outside check, including when it didn't help.
- When this runs automatically, steps 1 to 6 take a few lines in the plan, not an essay. Skip it for small, clear tasks.
