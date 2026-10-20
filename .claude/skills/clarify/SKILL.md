---
name: clarify
description: Use when the user types /clarify. Asks at least 5 short questions with the AskUserQuestion tool before any work, so the job needs fewer back-and-forth turns and fewer tokens.
argument-hint: "[the task in a few words]"
disable-model-invocation: true
---
# Clarify before work

Goal: one question batch, one set of answers, then the work. Every extra turn costs tokens.

## 1. Check what is already known (do not ask these)
- The user's message and this chat.
- In the Dop repo: `CLAUDE.md`, and only the `docs/handoff/` note the task touches (Grep if unsure).
- The files the task probably touches: Grep or Glob, then read only the lines needed.
Anything answered there is not a question.

## 2. Ask with AskUserQuestion
- Ask at least 5 and at most 8 questions with the AskUserQuestion tool (if it is deferred, load it first with ToolSearch `select:AskUserQuestion`). In a project thread, where AskUserQuestion does not exist, post one `ask_decision` card per question in the same turn instead, with `recommended` set; never fall back to a typed list while either tool exists.
- AskUserQuestion takes at most 4 questions per call. For 5 to 8 questions, send two AskUserQuestion calls in the same message (for example 4 and 3), so the user sees one batch and answers once.
- Each question has a `header` of 12 characters or fewer, one line ending in "?", and 2 to 4 options. List the default first and end its label with "(Recommended)". Give each option a short description. Other is added automatically, so do not add it.
- Pick the areas that fit the task, at least five in total:
  1. Outcome: what should be true when this is done?
  2. Scope in: which files, screens or features are included?
  3. Scope out: what must not change?
  4. Input: which data, file or example should be used?
  5. Constraints: cost, speed, size, free tiers, no new config or dependencies?
  6. Output: a PR, a file, a reply? How long or how detailed?
  7. Done check: which tests or measurements prove it works?
  8. Permission: anything that costs money, deletes data or changes production settings needs an explicit yes.
- If the user gave no task text, the first question asks for the task, with an option such as "Type it in Other". The rest cover the likely goal, scope, constraints, output and checks.
- The user may want at least 5 questions even when the task is clear. Then the questions check scope, output and tests, and the Recommended options are good enough to accept as they are.

## 3. Act on the answers
- Reply in at most 5 lines: "Doing: ... Defaults used: ..." Then start the work. Use the Recommended option for any question the user skipped.
- Ask again only if the work cannot continue without a missing answer, and then ask that one question only, with AskUserQuestion.
- If the task costs money, deletes data or changes production settings, wait for a clear yes before doing it.

## Rules
- Never ask something the user already answered in this chat.
- Never ask for something you can find by reading the repo.
- No preamble and no restating the task before the questions.
