# Dop hub in the cloud: every account, every device

One page (`https://dop-hub.vercel.app`, or whatever name Vercel gives it) where you send prompts from any phone or computer. A Claude **coordinator** splits each prompt into **threads**, like the Claude project you are in now. Each thread runs on one of your Claude accounts with the model you pick. Agents on different accounts ask each other questions through the hub. When an account runs low, its agent writes a handover and the work moves to another account. Code: `hub/`. Tests: `tests/hub-cloud.test.ts`.

## How it fits together
- **Hub**: a free Vercel project (`hub/` folder) with storage in Upstash Redis (free). It holds threads, messages, handovers and accounts. Your password protects the page.
- **Connector**: each account adds the hub to claude.ai as a custom connector, using its own private link. This gives Claude on that account the hub tools in chats, on the phone, in cloud Claude Code sessions and in Claude Code on a PC.
- **Routines** (Pro and Max): a saved cloud Claude Code task, one for each account and model. The hub starts a routine through Claude's routine trigger as soon as there is work, so a thread starts within seconds. Each started session reads its thread from the hub and works on the repo.
- **Free accounts**: Claude Code and routines are paid-only, so a free account can't be started by the hub. It still connects: open a chat (phone or web), say "check the Dop hub", and it picks up the non-code work queued for it, like questions, writing and reviews.

## One-time setup (about 10 minutes)
### 1. Create the Vercel project
1. On vercel.com: **Add New**, then **Project**, then import **PERILTHESKYWING/Dop** again (yes, the same repo).
2. Project name: `dop-hub`. **Root Directory**: click Edit and choose `hub`. Framework Preset: **Other**. Leave the build settings empty.
3. **Environment Variables**: add `HUB_PASSWORD` set to a password you choose.
4. Click **Deploy**.
5. In the new project open **Storage**, then **Connect Database**. Pick the Upstash Redis store the Dop site already uses (its keys don't clash), or create a free one. Connect it to `dop-hub`.
6. Open **Deployments**, then the last deployment's menu, then **Redeploy**.
7. Open the project's link, enter your password, and add it to your phone's home screen.

### 2. Add each account
On the hub page, press **Add account**, give it a short name (like *Main*) and its plan, then **Save**. Press **Connect** on its card and follow the steps it shows:
1. **Connector** (every plan, including free): sign in to claude.ai as that account, then go to **Settings**, **Connectors**, **Add custom connector**. Name it *Dop hub*, paste the link, choose **no sign-in**, and press **Add**.
2. **Routines** (Pro and Max): on claude.ai/code open **Routines**, then **New routine**. Set the repo to PERILTHESKYWING/Dop, turn the Dop hub connector on, choose a model, add an **API trigger**, and paste the prompt the page shows. Copy the routine id (`trig_...`) and its token (shown once). Then press **Edit** on the account in the hub and paste them. Make one routine per model you want for that account (for example Opus and Sonnet on Max, Sonnet and Haiku on Pro). The hub's model menu uses whichever routines exist.
3. **PC (optional)**: `claude mcp add --transport http dop-hub "<the link>"`. For automatic low-usage warnings from the PC, set `HUB_MCP_URL` to the link and use `hub/pc-statusline.mjs` as the status line.

## Using it
- **Project chat**: type what you want. The coordinator (Haiku by default, change it in Settings) opens threads and posts where each one went. Tick **One thread, skip the coordinator** to save usage on simple asks.
- **A thread**: reply to steer it, change its **Model** or **Account** from the menus (the next session uses them), **Mark done**, or **Start again** if it stopped.
- **Accounts**: usage bars, **Running low** (also set automatically by agents and by the PC status line), **Usage is back**.
- **Skills**: skills saved on your Claude account (taste, work-habits, dop-dev and the rest) load in cloud sessions and chats on that account by themselves, and the repo's `.claude/skills` load in every cloud session. Each account needs its own copies saved (see `.claude/account-skills/`).

## Handover when an account runs low
Agents save a handover (what's done, the exact next step, the branch) after each milestone. When an account is marked low, or the PC status line passes 85%, its agents are told to write the handover and stop, and new work goes to other accounts. If a working thread goes quiet for 15 minutes, the hub starts it again on another account from the last handover. That can happen at most once every 30 minutes per thread, and you can turn it off in Settings.

## Usage and cost (measured 2026-10-20)
- One coordinator run with Claude Code on Haiku took 4 turns: 3 to 15k new tokens (input, cache writes and output) and about 180k cached reads, roughly US$0.003 to 0.005 at API prices. Before the single-call `hub_route`, the same job on Sonnet took 6 turns and about $0.12.
- The hub's own messages to agents are small: about 500 tokens to route one prompt.
- The page shows **Hub overhead, last 5 hours**: the hub's own messages plus 12k tokens per coordinator run. The default budget is 60k. Over budget, prompts skip the coordinator and each becomes one thread. You can change the budget in Settings.
- **Not verified:** Anthropic doesn't publish the free plan's 5-hour limit as a number, so I can't prove the hub stays under half of it. The overhead figures above are measured, and the budget lets you cap them.
- Upstash: the page checks for news every 4 seconds while it's open (1 request), and agents waiting for messages check every 3 seconds. That's well inside Upstash's free monthly allowance for normal use.

## Limits
- Free accounts can't be started remotely or run code (no Claude Code on free). They only work when you open a chat on them.
- A routine can be started at most 30 times an hour, and an account at most 100 times an hour through the trigger. The hub stays under 28 per routine.
- Routines are marked experimental by Anthropic, so the trigger may change.
- The local PC-only hub (`tools/hub/`, `hub.md`) still works for offline use. This cloud hub doesn't replace its live push into running PC sessions.
