# Dop hub: steps only XIAO can do

Short, numbered steps for things the agents can't do from the cloud. Everything else about keeping accounts connected already runs by itself (see "Staying connected" in `hub-cloud.md`).

## 1. Accounts back within a minute of a reset (optional, free)

Without this, an account comes back within a minute of its usage reset while a hub page is open or any agent is working. With every page closed it can take hours, because GitHub runs the backup wake only every few hours. This step adds a free timer (Upstash QStash, 1,000 messages a day) that wakes the hub at each reset.

1. Sign in to vercel.com with the Vercel account that has the **dop-hub** project.
2. Open https://vercel.com/marketplace/upstash/upstash-qstash and press **Install** (or **Add**). Pick the **Free** plan. When it asks for a project, pick **dop-hub**.
3. Open **dop-hub** › **Settings** › **Environment Variables** and look for `QSTASH_TOKEN`.
   - If it is there, go to step 4.
   - If it isn't, open https://console.upstash.com › **QStash**. Copy `QSTASH_URL` and `QSTASH_TOKEN` from there. In **dop-hub** › **Settings** › **Environment Variables** add both with those names (Production ticked), then **Save**. Paste them only into Vercel, never into a chat.
4. Open **dop-hub** › **Deployments**, press **⋯** on the top deployment, then **Redeploy**.
5. Check it worked: open the hub, then **Settings**. Under "After a limit resets" it should say "Accounts are back at work within a minute of their reset, even with every page closed."

## 2. When a card says "Needs you" and "old link"

A connector on claude.ai still uses the link from before **New link** was pressed. The card has a **Reconnect** button.

1. In the hub open **Team**, press **Reconnect** on that account and copy the link.
2. On claude.ai, signed in as that account: **Settings** › **Connectors**. Remove the old *Dop hub* connector, then **Add custom connector**. Name it *Dop hub*, paste the link, tick **No sign-in**, press **Add**.

The card goes back to **Connected** after that account's next hub call.

## 3. When a card says "Needs you" and "refused its routine token"

Claude refused that account's routine token, so the hub can't start sessions on it. Other accounts take its work meanwhile, and the hub retries it every 30 minutes.

1. On claude.ai/code, signed in as that account: **Routines**, open the routine named on the card (Opus or Sonnet).
2. Copy its id and its API trigger token (make a new token if the old one is gone).
3. In the hub open **Team**, press **⋯** on that account, then **Edit**. Paste the id and token, and save.

The hub tries the new token at once.
