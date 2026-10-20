---
name: clarify
description: Use when the user types /clarify: ask 5 to 8 short questions as tappable choices in one batch before any work, so the job needs fewer turns.
---
# Clarify before work

Goal: one question batch, one set of answers, then the work. Every extra turn costs tokens.

## 1. Check what is already known (do not ask these)
- The user's message and this chat.
- If a repo is checked out: its `CLAUDE.md` and the one handoff note the task touches (Grep if unsure).
- The files the task probably touches: Grep or Glob, then read only the lines needed.
Anything answered there is not a question.

## 2. Ask in one batch, as tappable choices
- Ask at least 5 and at most 8 questions. Never type them as a plain list when a choice tool exists.
- Pick the tool in this order:
  1. **AskUserQuestion** (Claude Code CLI, desktop, web). If it is deferred, load it first with ToolSearch `select:AskUserQuestion`. It takes at most 4 questions per call, so for 5 to 8 send two calls in the same message (for example 4 and 3). Each question gets a `header` of 12 characters or fewer. Other is added automatically.
  2. **ask_decision** cards (project threads, where AskUserQuestion does not exist): one card per question, all posted in the same turn, `recommended` set to the default, a `reason` for it. Labels 40 bytes max, consequences one sentence. Do not also repeat the questions in a reply; end the turn with a one-line reply or no_reply_needed.
  3. Only if neither exists: one message, numbered questions with lettered options so the user can answer "1a 2b".
- Each question: one line ending in "?", 2 to 4 options, the default first marked "(Recommended)" (on cards: `recommended`), a short description per option.
- Pick the areas that fit, at least five: outcome; scope in; scope out; input data or example; constraints (cost, speed, free tiers, no new config); output (PR, file, reply, length); done check (tests or measurements); permission for anything that costs money, deletes data or changes production.
- No task text given: the first question asks for the task.
- The user may want 5 questions even when the task is clear: then check scope, output and tests, with Recommended options good enough to accept as they are.

## 3. Act on the answers
- Reply in at most 5 lines: "Doing: ... Defaults used: ..." then start. Use the Recommended option for anything skipped.
- Ask again only if the work cannot continue, and then one question only, with the same tool.
- Money, deletions or production changes wait for a clear yes.

## Rules
- Never ask what the user already answered or what the repo already says.
- No preamble and no restating the task before the questions.
