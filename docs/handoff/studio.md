# Storytime studio (hub)

Free AI-directed storytime animation studio inside the Dop hub. Characters are code-drawn rigs (identical in every shot); lines are redrawn every 2-3 frames with seeded wobble; Claude accounts direct and critique through hub tools. Page: `hub/studio.html` (renderer in `hub/studio/`, written by the lead). Backend: `hub/lib/studio.js`.

## Flow
1. XIAO writes an idea on the studio page: `studio-new` makes a project and a team thread (opus, xhigh, team of 2, code) whose brief is `studioBrief()`.
2. The director calls `studio_put` (validated by `hub/studio/schema.js` `validateProject`; problems mean nothing is saved). The page sees the new rev, redraws it live and uploads a PNG contact sheet (`studio-sheet`).
3. The critic calls `studio_look` (sheet as an image + `lintProject` warnings) and `studio_note`. Max 2 critique rounds per request.
4. XIAO reviews the sample, types feedback (`studio-feedback`, optional "make this a rule"): logged and sent into the thread as a prompt. Revisions appear live. `studio-full` asks for the whole video; the WebM is exported in the browser.

## Store keys (`hub:studio:*`)
`seq`, `index` (hash id → meta), `p:<id>` project JSON (latest), `r:<id>` last 10 revisions, `n:<id>` notes (100), `sheet:<id>` latest PNG (base64, rev), `log` (feedback / rate / rule / full, 500), `rules` ({text, style, version}).

## Page API (password, `/api/hub?op=`)
GET `studio-list`, `studio-get&id[&since=rev]` (`{same:true}` if unchanged), `studio-rules`, `studio-log&since=ts`.
POST `studio-new {idea,title,team,model}`, `studio-feedback {id,text,rule}`, `studio-full {id}`, `studio-sheet {id,rev,png}` (PNG base64, max 380 KB), `studio-rate {id,rev,good,note}`, `studio-rules {text,style}` (style is a patch; `null` deletes a key).

## MCP tools
`studio_get`, `studio_put`, `studio_look`, `studio_note` (in `hub/lib/studio.js`, added to the hub tool list).

## Schema contract assumed by the backend
`hub/studio/schema.js` may export `validateProject(p)` (array of problem strings, or `{problems|errors}`; empty = fine), `lintProject(p)` (array of warnings) and `FORMAT_HELP` (text returned by `studio_get`). All optional: without the file the backend only checks that the project is an object. Limit: 300 KB of JSON per project. `project` is `null` until the first `studio_put`.

## Nightly learning (PC, almost no tokens)
`node hub/studio-nightly.mjs` with `HUB_URL` and `HUB_PASSWORD` set. If no feedback is new since the last run (state in `~/.dop-studio-nightly.json`) it exits with zero tokens. Otherwise ONE `claude -p --model haiku` call (prompt about 1-3k characters: current rules + at most 40 feedback lines) returns `{rules, style}`; it is validated (`cleanStyle`, 6000-char rules cap) and saved with `studio-rules`. `--dry` prints the answer without saving.
Schedule once a night. Windows: `setx HUB_URL https://<hub>` and `setx HUB_PASSWORD <password>`, then `schtasks /create /sc daily /st 03:00 /tn DopStudio /tr "node C:\path\to\Dop\hub\studio-nightly.mjs"`. Mac/Linux cron: `0 3 * * * HUB_URL=... HUB_PASSWORD=... node ~/Dop/hub/studio-nightly.mjs`. The PC must be on and signed in to Claude Code (`claude -p`).

Tests: `tests/hub-studio.test.ts`.
