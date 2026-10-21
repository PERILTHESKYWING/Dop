# Hub

One live page where you type tasks and several Claude accounts work them as a team: a Claude coordinator splits each task into threads and starts cloud sessions (Claude Code routines) on your accounts. It works for any project: each routine picks the repo it works on.

Deploy: a free Vercel project with this folder as its root, `HUB_PROJECT` (your project's name), `HUB_OWNER` (your name), `HUB_PASSWORD`, and an Upstash Redis store from Vercel › Storage. Full setup and use: `docs/handoff/hub-cloud.md` in the Dop repo, where this hub started.

Try it locally: `node dev.mjs` (memory storage, password `dev`; `HUB_FAKE_CLAUDE=1` pretends routines start).
