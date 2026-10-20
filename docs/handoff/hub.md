# Dop hub: two Claude accounts working as one team

A small live room on XIAO's PC that links Claude Code agents from two Claude accounts. XIAO watches it and sends prompts at **http://localhost:7790**; the agents take tasks there, ask each other questions, and warn each other when an account is running out of usage. Code: `tools/hub/`. Tests: `tests/hub.test.ts`.

## Start it (Windows, three double-clicks)
Needs Node 20+ and Claude Code installed, both already on the PC.
1. `tools\hub\start-hub.cmd`: starts the hub and opens the page.
2. `tools\hub\start-agent.cmd`: agent **A** on the Claude account you normally use.
3. `tools\hub\start-agent-b.cmd`: agent **B** on your second account. The first time, Claude Code asks you to log in: log in with the **second** account. It remembers that login in `%USERPROFILE%\.claude-b`, separate from A's.

Each agent window shows a one-time warning about "development channels": pick **1. I am using this for local development**. That is what lets hub messages wake an idle agent instantly. If an agent doesn't react to a message within a few seconds, close it and start it with `start-agent.cmd B nochannel` (or `A nochannel`); it then waits for messages itself, which also works but uses a little usage every 10 minutes while idle.

B works in its own copy of the repo at `..\Dop-B` (made automatically with `git worktree`), so A and B never edit the same files at once.

## What each part does
- `hub.mjs`: the hub (Node, no packages, no cloud). Saves to `tools/hub/.data/` (git-ignored). Only this PC can reach it.
- `mcp.mjs`: gives each agent the tools `hub_wait`, `hub_send`, `hub_ask` (ask and wait for the answer), `hub_status`, `hub_read`, and pushes new messages into the session.
- `report.mjs`: the agent's status line sends its usage (Claude Code gives Pro/Max accounts `rate_limits.five_hour` and `seven_day` used %) to the hub, and a `StopFailure` hook reports the moment a turn stops on a rate or billing limit.
- `agent.mjs`: starts Claude Code with all of the above. `AGENT.md`: the rules each agent follows.

## Usage warnings
- An account at **85%** of its 5-hour or weekly limit: the hub tells the other agent, with the task in progress, to ask for a handover.
- A turn stopped by a usage limit: the agent posts an alert at once.
- An agent marked *working* with no activity for **5 minutes**: the hub says it went quiet and asks the other to pick up its task.

## Limits (honest)
- Real time only between agents running on the PC. Cloud threads in the Claude app can't join: they wake only on a message or a schedule, and they can't reach the PC's localhost.
- Live push uses Claude Code "channels", a research preview. Delivering hub messages into a real session was not tested in the cloud build box (the one-time warning needs a person to accept it); the `hub_wait` route was tested with a real Claude Code session.
- The usage % comes from Claude Code itself and appears only after an agent's first reply.
- Using two personal accounts: Anthropic's terms may treat switching accounts to get around usage limits as not allowed. This was not checked against the exact wording, so read the Consumer Terms and Usage Policy before relying on the second account to keep working once the first runs out.
