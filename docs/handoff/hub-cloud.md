# Dop hub: setup

You type a task on one page, from your phone or computer. A Claude coordinator splits it into threads and hands them to your Claude accounts. Paid accounts do the coding; free accounts help with questions, research and writing.

## Part 1: make the hub (once, about 5 minutes)
1. Sign in to **vercel.com** (a new account is fine). Click **Add New** › **Project**. If Vercel asks, connect GitHub and allow it to see the **Dop** repo. Pick **Dop**.
2. Name it `dop-hub`. Next to **Root Directory**, click **Edit** and pick `hub`.
3. Open **Environment Variables** and add one: name `HUB_PASSWORD`, value any password you like.
4. Click **Deploy**.
5. In the new project, open **Storage** › **Create** › **Upstash Redis** (free plan) › connect it to `dop-hub`. Then open **Deployments**, click the **⋯** on the top one, and choose **Redeploy**.

Now open the hub's link and type your password. On your phone, use "Add to Home Screen".

## Part 2: add a paid account (Pro or Max)
1. On the hub page: **Add account**, type a name (like *Main*), choose the plan, **Save**.
2. Press **Connect** on that account and copy the link.
3. On claude.ai, signed in as that account: **Settings** › **Connectors** › **Add custom connector**. Name it *Dop hub*, paste the link, tick **No sign-in** (claude.ai marks it Detected; leave any OAuth client choice alone) and press **Add**; if a **Connect** button appears, press it (no sign-in page should open). **Test link** on the Connect screen checks the link first; **New link** makes a fresh one (connectors and routines using the old link stop working until you add the new one). Add stays grey while "Sign in now" with "Use your own OAuth client" is picked (it wants a client ID), until Name and URL both have text, or if that account already has a connector with the same link (**New link** fixes that). Use the link from the hub's main address (Vercel › Domains); single-deployment links are locked behind a Vercel login and fail with a sign-in error.
4. On claude.ai/code: **Routines** › **New routine**. Pick the Dop repo and a model, turn on the Dop hub connector, add an **API trigger**, and paste the prompt from the Connect screen. Copy the routine's id and token into the hub (**Edit** on that account). Repeat for each model you want on that account.

## Part 3: add a free helper account (repeat for each one)
1. On the hub page: **Add account**, type a name (like *Helper1*), choose **free**, **Save**.
2. Press **Connect** and copy the link.
3. On claude.ai or the Claude phone app, signed in as that account: **Settings** › **Connectors** › **Add custom connector**. Name it *Dop hub*, paste the link, tick **No sign-in** (claude.ai marks it Detected; leave any OAuth client choice alone) and press **Add**; if a **Connect** button appears, press it (no sign-in page should open). **Test link** on the Connect screen checks the link first; **New link** makes a fresh one (connectors and routines using the old link stop working until you add the new one). Add stays grey while "Sign in now" with "Use your own OAuth client" is picked (it wants a client ID), until Name and URL both have text, or if that account already has a connector with the same link (**New link** fixes that). Use the link from the hub's main address (Vercel › Domains); single-deployment links are locked behind a Vercel login and fail with a sign-in error.

To put a helper to work, open a chat on it and type: **check the Dop hub**. It does one task, then asks the hub for the next.

## Using it
- Type a task in **Project chat**. The coordinator opens threads and says where each went, with a card per thread.
- The buttons under the box pick, for that task: **Model** (Auto lets the coordinator choose), **Thinking** (Low, Medium, High, Max) and **Accounts** (any, or tick one or more; only those accounts work on it). **One thread** skips the coordinator. The picks are remembered on that device.
- Tasks that need code go to paid accounts and start within seconds. Tasks that don't need code wait for a free helper; open a chat on it and type **check the Dop hub**.
- In a thread you can reply, change its **Model**, **Thinking** or **Accounts**, or press **Mark done**.
- The **Team** panel shows each account's 5-hour and weekly limits (% used and when each resets), sorted with the freest first. At 85% of either the hub marks it low and moves new work elsewhere; the thread continues from its last handover. **Usage** on a card lets you type the numbers in or mark it **Running low** by hand.

---

## Details (only if you need them)
- **How starting works**: a routine is a saved cloud task on one account with one model. The hub starts it through Claude's routine trigger (at most 30 times an hour per routine, 100 an hour per account). Each session reads its thread from the hub and works on the repo. Routines are marked experimental by Anthropic.
- **Why free helpers wait for you**: free plans can't run Claude Code or routines, so the hub can't start them. They only work when a chat is open, and they never get coding work.
- **Skills**: skills saved on an account load by themselves in that account's chats and cloud sessions; the repo's `.claude/skills` load in every cloud session. Each account needs its own copies (see `.claude/account-skills/`).
- **Handover**: agents save what's done, the exact next step and the branch after each milestone. If a working thread goes quiet for 15 minutes, the hub restarts it on another account from that handover (at most once every 30 minutes per thread; it can be turned off in Settings).
- **Usage** (measured 2026-10-20): one coordinator run on Haiku took 4 turns, 3 to 15k new tokens plus about 180k cached reads, about US$0.004 at API prices. The hub's own messages are about 500 tokens per prompt. The page shows the hub's overhead for the last 5 hours against a budget (default 60k tokens, set in Settings); over budget, prompts skip the coordinator. Anthropic doesn't publish the free plan's 5-hour limit as a number, so staying under half of it can't be proven.
- **Thinking level**: routines have no effort setting the hub can change, so the level goes in as words Claude Code reads: Medium adds "think", High "think hard", Max "ultrathink" at the top of the start message, plus a line in the brief. Not measured yet whether this changes how long the sessions think.
- **Where usage numbers come from**: every 5 minutes (or **Refresh**) the hub asks Claude's usage endpoint (`api/oauth/usage`, undocumented) with the account's routine token. If Claude refuses that token the card says so; then type the numbers in from claude.ai › Settings › Usage, or let a PC agent's status line (`hub/pc-statusline.mjs`) report them every 10 minutes. Free plans have no routine token, so they need one of those two.
- **Saving usage**: turn on **One thread** under the box for simple tasks.
- **PC agents (optional)**: `claude mcp add --transport http dop-hub "<link>"`. Set `HUB_MCP_URL` to the link and use `hub/pc-statusline.mjs` as the status line to report low usage automatically.
- **Storage**: the page checks for news every 4 seconds while it's open, and waiting agents check every 3 seconds, well inside Upstash's free allowance.
- **PC-only version**: `tools/hub/` (see `hub.md`) still works offline.
- Code: `hub/`. Tests: `tests/hub-cloud.test.ts`.
