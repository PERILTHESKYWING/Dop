# Moving the hub out of Dop (for any project)

## What already works without moving anything
The hub never reads the Dop code. Each Claude routine picks its own repo, so the same hub can already run agents on any project: make a routine on that repo and add it to an account (hub-cloud.md, Part 2). Only the words the hub says ("Dop hub", "XIAO") were Dop's, and two Vercel settings now change them:
- `HUB_PROJECT`: the project's name (default `Dop`). The page title, the agents' rules, the coordinator, the connector name and "check the … hub" all use it. If it is not `Dop`, the rules point agents at "the skill that fits" instead of the `dop-*` skills.
- `HUB_OWNER`: who the agents work for (default `XIAO`).

To set one: Vercel › the hub project › **Settings** › **Environment Variables** › add the name and value › **Save**, then **Deployments** › **⋯** on the top one › **Redeploy**. Nothing else changes: the link, accounts, routines and threads stay.

One hub serves one project name at a time. For a second project with its own threads, make a second hub (hub-cloud.md, Part 1) with its own `HUB_PROJECT`.

## Moving the code to its own repo (optional)
Do this only if you want the hub's code out of the Dop repo. Everything in `hub/` is self-contained (no imports from the rest of Dop).

1. **Make the new repo.** On github.com: **+** (top right) › **New repository**. Name it, e.g. `dop-hub`. Leave every box unticked (no README). **Create repository**. Copy its address (the `https://github.com/…/….git` link).
2. **Copy the hub into it.** Either:
   - on a PC with the Dop repo: `bash scripts/hub-export.sh <the link from step 1>`, or
   - ask a Claude Code session on Dop: "add the repo <name> and run scripts/hub-export.sh with its link".

   The new repo now has the hub at its root, with its history. Dop is unchanged.
3. **Point the existing Vercel project at it** (keeps the same link, password, storage and all accounts, so no connector or routine needs changing). On vercel.com open the hub project (`dop-hub`):
   1. **Settings** › **Git** › **Disconnect**, confirm.
   2. Same page: **Connect Git Repository** › GitHub › pick the new repo. If it isn't listed, click **Adjust GitHub App Permissions** and allow it.
   3. **Settings** › **Build and Deployment** (may be called **General**) › **Root Directory** › **Edit** › clear the box (the hub is at the root now) › **Save**.
   4. **Deployments** › **⋯** on the top one › **Redeploy**. Open the hub link and sign in to check.
4. **Tidy Dop (later, once step 3 works).** Delete `hub/`, `tests/hub-cloud.test.ts`, this file, `hub-cloud.md` and the hub line in `CLAUDE.md`, in one PR. Until then, changes to `hub/` in Dop no longer deploy, so make hub changes in the new repo.

Notes
- Tests: `tests/hub-cloud.test.ts` runs in Dop's vitest. The new repo has no test runner yet; copy that file over with vitest if you keep developing the hub there.
- `tools/hub/` (the PC-only hub, hub.md) is separate and older; it can stay in Dop or be copied the same way (`git subtree split --prefix=tools/hub`).
- Routine prompts already say "the Dop hub connector". After changing `HUB_PROJECT`, new Connect screens show the new name; old routines keep working because the connector link, not its name, is what counts.
