---
name: premortem
description: Use when the user types /premortem, and automatically before any big, risky or multi-round task: imagine it already failed, list the likeliest reasons, and change the plan to prevent them.
---
# /premortem

Assume the task is finished and the user is unhappy with it. Work out why before any work starts.

1. State the goal in one line, the way the user would judge it (what they will look at, and what "good" means to them).
2. List 5 to 8 concrete ways it failed. Draw on:
   - misreading the ask, or doing part of it and calling it done;
   - the result looking fine in tests but wrong to the user (on a phone, in the real app, against their reference);
   - unmeasured claims (speed, strength, quality);
   - breaking something that already worked;
   - cost (tokens, money, free-tier limits) or setup the user finds hard;
   - past feedback from this user being repeated (check memory, /taste rules and handoff notes).
3. Rate each one: likelihood (high, medium, low) and damage (high, medium, low).
4. For every high item, add one prevention step to the plan: a check, a measurement, a screenshot, or a question to ask now.
5. Output, short:
   - Goal: one line.
   - Top risks: a table of risk, likelihood, damage, prevention.
   - Plan changes: the steps added.
   - Question for the user: only if a high risk can't be prevented without their answer (at most one, with a recommended option).
6. Then carry on with the work using the updated plan, unless the user only asked for the premortem.

When it runs automatically, keep it to a few lines in the plan or status, not a separate essay. No generic risks that apply to every task.
