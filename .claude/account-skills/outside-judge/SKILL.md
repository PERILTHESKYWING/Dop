---
name: outside-judge
description: Use automatically on any task whose result can be checked (code, speed, strength, a design, data, a claim): before starting, pick a check that isn't Claude's own opinion, set the pass line, run it, and report its numbers.
---
# Outside judge

Models agree too easily, with the user and with themselves. Don't let the work grade itself: something else says pass or fail, ideally a tool that runs in seconds.

## 1. Before the work
Name the judge and the pass line in one line. Prefer, in this order:
1. A tool that runs now: tests, typecheck, build, a benchmark, a measuring script, a screenshot against a reference, a validator.
2. Data the work wasn't built from: a held-out set, or history ("would this have caught last month's bug?").
3. A reviewer that didn't see the work being made: a fresh subagent or another hub account, given only the goal and the result.
4. The user, last, with one specific question ("does the board feel faster on your phone? yes/no").
If no judge exists, building a small one (a test, a measuring script) is part of the task.

## 2. During
- Run the judge after each meaningful change while it's cheap, not only at the end.
- Never change the judge or the pass line to make a result pass. If the judge is wrong, say why and fix it openly.

## 3. Report
- Give the judge's own numbers: before and after, same settings, with the noise where it's measurable. Include results that didn't help.
- Say "not checked" plainly for anything no judge covered. Never "should work".

## Dop judges
- Every PR: `npm run typecheck`, `npm test`, `npm run build` (`dop-verify`).
- Speed or strength: `scripts/ai-eval.ts`, Settings › Benchmark.
- Visual: `design-shots`, then `design-critic-panel`.
- Coach text: checked against KataGo's numbers for the same position; any claim not in the data fails.
