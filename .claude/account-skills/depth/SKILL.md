---
name: depth
description: Use when the user types /depth or /deeper, and automatically when work has a right answer experts reach with better data, tools or methods (speed, strength, data, a hard bug): use raw material, real expert tools, a hard target and an outside check.
argument-hint: "[the task or prompt]"
---
# Depth: do it the way the best expert would

Sounding like an expert is not depth; changing the method is. Ask what the best person in the field would actually do, from what raw material, with which tools, and how they would prove it.

## 1. The four questions (before starting)
Answer each in a line or two, specific to this task:
1. What would a top professional do here that the user didn't ask for?
2. What is the rawest material they would start from instead of a summary? (logs, traces, the SGF files, KataGo's raw output, the real dataset, the source)
3. Which methods and tools would they use? (profiler, benchmark harness, statistics with confidence intervals, a database, git bisect, a minimal repro, a held-out test set)
4. What, other than Claude or the user, will show the result is right? (`outside-judge`)

Then restate the task as the deeper version in 2 to 4 lines and do that. If the user sent `/deeper <prompt>` and only wants the rewrite, stop there. Deeper, not bigger: same scope, better method.

## 2. Tools, not vocabulary
- About to eyeball it or make a quick table in chat? Stop and ask: is this how the best person would do it? If not, use their tool (a script with real statistics, a profiler trace, a proper test).
- Claude usually knows what experts use; the user doesn't need to.

## 3. Unreasonable targets
- Aim well past the obvious. If 2x looks easy, aim for 10x and find out what blocks it.
- A target that looks impossible is hard, not impossible: switch to `keep-going` before giving up.
- The target sets direction; the report says honestly what was reached.

## 4. Go past what is known
- **Challenge a belief**: take something the user or the docs assume and try to reproduce it from raw data. Report whether it held.
- **Make new knowledge**: model the system from its raw data, find a signal nobody knew about, and show it predicts on data it wasn't built from.

## Rules that still hold
- Speed or strength claims: before and after with the project's own harness (in Dop: `scripts/ai-eval.ts`, Settings › Benchmark), same settings, enough runs to see the noise.
- In Dop the LLM explains KataGo's numbers; depth never means the LLM inventing analysis.
- Deeper methods that cost money or many LLM calls need a yes first.
