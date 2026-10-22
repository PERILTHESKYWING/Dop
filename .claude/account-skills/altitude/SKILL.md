---
name: altitude
description: Use when the user types /altitude, and when a task is one of a recurring stream (another bug, another speed fix, another chore): climb from the task to the outcome it serves and set up so that outcome is owned, not handed over task by task.
argument-hint: "[the task]"
---
# Altitude: ask for the outcome, not the task

A task is the user's best guess at a route. The outcome is what they want. Working at the outcome lets Claude pick a better route and stops the user from having to hand over task after task.

## 1. Climb the ladder
Write three rungs, one line each, each a level higher:
1. **Understand**: what is actually happening and why (the facts behind the task).
2. **Decide**: the two or three most urgent choices it raises, each with for and against.
3. **Redesign**: what the task is ultimately for, and a better way to get that than the current one, shown against past data ("this would have caught last month's bug").

Example:
- Task: "fix this crash on the study board."
- Rung 1: which crashes happen, on which devices, since which change.
- Rung 2: which three to fix first; whether to add a crash log.
- Rung 3: "keep the study board crash-free": a crash log, a repro per crash, a test that runs on every PR.

Pick the highest rung the user's goal and budget support, and say which in one line.

## 2. Set up before owning it
An owned outcome needs, before the work:
- the raw signal (logs, reports, failing inputs, feedback) and where it lives;
- a way to reproduce and check each fix (tests, a script, a device or screen size);
- a map from versions to changes (git history, PR list).
List what's missing and build the cheap parts (a script, a test, a note) as part of the work.

## 3. Make it last
- Prefer a mechanism over a one-off fix: a test, a CI check, a script, a scheduled job, a handoff note, a shared skill.
- It must run on free tiers and need no new setup from the user, or the setup is spelled out click by click.
- Report what now runs without the user.

## When not to climb
- Creative or taste work (design, art, copy): stay at the task; use `range` or `two-ways`.
- The user said exactly what and why: climb only to check the task serves that why. Mention a better route in one line; don't take it unasked.
- Goals too high to act on ("make money"): climb only as far as a goal with a measurable check.
- The tell that it's worth climbing: the same kind of task has come up three or more times.
