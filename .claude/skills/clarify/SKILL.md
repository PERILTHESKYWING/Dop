---
name: clarify
description: Use when the user types /clarify. Asks one batch of at least 5 short questions to pin down a task before any work, so the job needs fewer back-and-forth turns and fewer tokens.
argument-hint: "[the task in a few words]"
disable-model-invocation: true
---
# Clarify before work

Goal: one question batch, one reply, then the work. Every extra turn costs tokens.

## 1. Check what is already known (do not ask these)
- The user's message and this chat.
- In the Dop repo: `CLAUDE.md`, and only the `docs/handoff/` note the task touches (Grep if unsure).
- The files the task probably touches: Grep or Glob, then read only the lines needed.
Anything answered there is not a question.

## 2. Ask one batch
- Ask at least 5 and at most 8 questions in ONE message, as a numbered list. Do not spread them over turns.
- Do not use AskUserQuestion for this: it takes at most 4 questions per call, which forces extra turns.
- Each question is one short line (under 20 words) with 2 to 4 lettered options. Mark one option "(default)".
- Pick the areas that fit the task, at least five in total:
  1. Outcome: what should be true when this is done?
  2. Scope in: which files, screens or features are included?
  3. Scope out: what must not change?
  4. Input: which data, file or example should be used?
  5. Constraints: cost, speed, size, free tiers, no new config or dependencies?
  6. Output: a PR, a file, a reply? How long or how detailed?
  7. Done check: which tests or measurements prove it works?
  8. Permission: anything that costs money, deletes data or changes production settings needs an explicit yes.
- If the user gave no task text, question 1 asks for the task in one line. The rest cover the likely goal, scope, constraints, output and checks.
- End the list with: "Reply like `1b 2 3a 4 5 - rest default`. Anything unanswered uses the default."
- The user may want at least 5 questions even when the task is clear. Then the questions check scope, output and tests, and the defaults are good enough to answer with "rest default".

## 3. Act on the answers
- Reply in at most 5 lines: "Doing: ... Defaults used: ..." Then start the work.
- Ask again only if the work cannot continue without a missing answer, and then ask that one question only.
- If the task costs money, deletes data or changes production settings, wait for a clear yes before doing it.

## Rules
- Never ask something the user already answered in this chat.
- Never ask for something you can find by reading the repo.
- No preamble and no restating the task before the questions.
