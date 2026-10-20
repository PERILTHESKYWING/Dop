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
- The buttons under the box pick, for that task: **Model** (Auto lets the coordinator choose), **Thinking** (Claude's own levels: Low, Medium, High, xHigh, Max), **Accounts** (any, or tick one or more; only those accounts work on it) and **Solo / Team of 2-4** (how many accounts work one thread together). **One thread** skips the coordinator. The picks are remembered on that device.
- Tasks that need code go to paid accounts and start within seconds. Tasks that don't need code wait for a free helper; open a chat on it and type **check the Dop hub**.
- In a thread you can reply, change its **Model**, **Thinking** or **Accounts**, or press **Mark done**. The **⋯** menu archives a thread (hidden under **Archived** at the bottom of the list, no new sessions, can be restored) or deletes it with its messages.
- Each account card says **✓ Connected** once its connector link has been used with the right key, or **Not connected yet**.
- The **Team** panel shows each account's 5-hour and weekly limits (% used and when each resets), sorted with the freest first. When an account has less than the **minimum usage left** (Settings, default 15%, so 85% used) of either limit, the hub marks it low and moves new work elsewhere; its threads continue from their last handover. The coordinator sees each account's % left, and among equally busy accounts the one with the most left goes first. **Usage** on a card lets you type the numbers in or mark it **Running low** by hand.
- **Thinking**: while an agent works, its thread shows Claude Code's own thinking line (the ✻ spinner, a verb like *Pondering…* and the time so far) for each account on it, and Project chat shows one for the coordinator until it answers. Agents may post a short `thinking` note at key decisions. **✻ Thinking** at the top of a thread shows them folded (default), open or hidden, and per account. Other agents never receive these notes, so they cost the hub nothing. An agent's full private reasoning stays in its session (**Open session**).
- **Clawd**, Claude Code's mascot, redrawn from its terminal sprite (the same pixels and colour), sits by the hub name and scuttles while any thread is working. It also waves on the sign-in page and walks across an empty Project chat.
- **Team threads**: with Team of 2-4 (or when the coordinator picks a team for a big task), the hub starts a lead and members on different accounts, all with enough usage left, in one thread. The lead posts a plan (one part and branch per member), members wait for it, then each works its part. Every post reaches the whole team; `hub_post` with `to` addresses one teammate. Each member keeps its own handover; a member quiet for 15 minutes is replaced on another account from its handover while the lead carries on. A member's **done** closes only its part; the lead merges, opens the PR and closes the thread. If fewer accounts are free than asked, the thread says so and goes on with fewer. Each member is one more session, so it costs usage on that account.

---

## Details (only if you need them)
- **How starting works**: a routine is a saved cloud task on one account with one model. The hub starts it through Claude's routine trigger (at most 30 times an hour per routine, 100 an hour per account). Each session reads its thread from the hub and works on the repo. Routines are marked experimental by Anthropic.
- **Why free helpers wait for you**: free plans can't run Claude Code or routines, so the hub can't start them. They only work when a chat is open, and they never get coding work.
- **Skills**: skills saved on an account load by themselves in that account's chats and cloud sessions; the repo's `.claude/skills` load in every cloud session. Each account needs its own copies (see `.claude/account-skills/`).
- **Handover**: agents save what's done, the exact next step and the branch after each milestone. If a working thread goes quiet for 15 minutes, the hub restarts it on another account from that handover (at most once every 30 minutes per thread; it can be turned off in Settings).
- **Usage** (measured 2026-10-20): one coordinator run on Haiku took 4 turns, 3 to 15k new tokens plus about 180k cached reads, about US$0.004 at API prices. The hub's own messages are about 500 tokens per prompt. The page shows the hub's overhead for the last 5 hours against a budget (default 60k tokens, set in Settings); over budget, prompts skip the coordinator. Anthropic doesn't publish the free plan's 5-hour limit as a number, so staying under half of it can't be proven.
- **Thinking level**: routines have no effort setting the hub can change, so the level goes in as words Claude Code reads at the top of the start message: Medium "think", High "think hard", xHigh "think harder", Max "ultrathink", plus a line in the brief. Not measured yet whether this changes how long the sessions think.
- **Where usage numbers come from**: every 5 minutes (or **Refresh**) the hub asks Claude's usage endpoint (`api/oauth/usage`, undocumented) with the account's routine token. If Claude refuses that token the card shows Claude's reason and Settings › Connection log gets a USAGE line; then type the numbers in from claude.ai › Settings › Usage, or let a PC agent's status line (`hub/pc-statusline.mjs`) report them every 10 minutes. Free plans have no routine token, so they need one of those two.
- **Saving usage**: turn on **One thread** under the box for simple tasks.
- **PC agents (optional)**: `claude mcp add --transport http dop-hub "<link>"`. Set `HUB_MCP_URL` to the link and use `hub/pc-statusline.mjs` as the status line to report low usage automatically.
- **Speed**: one page refresh is one store round trip (measured with 80 ms per trip: 82 ms, was 1,535 ms and 25 trips), the page only fetches messages it doesn't have, opens from its last view on reload, and shows your message before the hub answers. Settings › Speed shows the last refresh time.
- **Storage**: the page checks for news every 3 seconds while it's open, and waiting agents check every 3 seconds, well inside Upstash's free allowance.
- **PC-only version**: `tools/hub/` (see `hub.md`) still works offline.
- Code: `hub/`. Tests: `tests/hub-cloud.test.ts`.
