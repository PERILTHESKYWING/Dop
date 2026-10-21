# Storytime studio (hub)

Hand-drawn style story animations, directed by your Claude accounts, inside the Dop hub. Open the hub and press **Storytime studio** (or go to `<hub address>/studio.html`). Same password as the hub. Works on phone and computer; nothing to install. The only extra (optional) step is the nightly learning job on your PC (below).

## Using it
1. **New story**: type the idea. Pick *Director + critic* (2 accounts) or *Director only* (cheaper), and a model (Sonnet by default). This opens a hub thread for the team.
2. While the team works, the page shows a demo story. Keep the page open: it draws each new version the moment it is saved, and sends the team a picture of it (the "contact sheet") so the critic can look.
3. The **sample** (1-2 scenes, under 25 s) appears by itself. Press play, scrub, tap the scene chips. **Voice on** reads the captions and lines with your device's voice (preview only).
4. **Feedback** tab: write what to change in your own words and press *Send to the team*. Tick *Make this a rule for every story* for things that should always hold. 👍 / 👎 rate the current version. The new revision appears by itself (a toast says "Revision N is in").
5. **Team** tab: the director's and critic's notes and your own feedback, in order. **Cast** tab: the model sheet every shot is drawn from. **Look** tab: sliders for frames per second, hold (frames per drawing), boil, wobble, line width, paper and colour slip; they preview at once, *Ask the team to use this* sends them, *Also make it my default* saves them for new stories. **Rules** tab: the studio's rules.
6. Happy with the sample: **Sample approved: make the full video**. The team extends it, keeping the approved characters and moves.
7. **Save video** records the whole video in the browser (it plays in real time; keep the page open): MP4 on Safari and recent Chrome, WebM elsewhere. It has captions and no sound; add a voice in any editor if you want one.

## How it looks hand-made
- Characters are drawn by code from a short cast spec (hair style and colour, clothes, build, glasses, freckles...), so a character is the same drawing in every shot. No image generator, so no drifting faces.
- Every line is a filled pen ribbon that swells, thins and tapers; it wanders a little off the true shape; closed shapes start at a seam and overshoot it.
- Colour fills are a separate, rougher shape that slips off the outline (like a print or a quick colour pass).
- Poses are held for `hold` frames (on twos by default at 12 fps). Each new drawing re-seeds part of the line noise ("boil"), cycling three variants as traced frames do, so even a held pose shimmers.
- 14 reusable moves (idle, talk, walk, wave, nod, shake, shrug, point, jump, think, facepalm, cheer, cry, laugh), each 2-6 drawings with anticipation and a held end pose; 8 faces (eyebrows carry most of it); mouths flap irregularly while talking; blinks.
- Paper grain on top, simple wobbly backgrounds (8 kinds) and props (10 kinds), speech bubbles with tails, caption banner.

## Parts
- `hub/studio/schema.js`: the project format. `validateProject` never throws: it fills defaults (your default look as the base style), clamps numbers, drops unknown values and lists what it changed; only a project with no cast or no scenes is refused. `lintProject` finds craft problems (bubbles too short to read, actors overlapping, speech without talk, look-alike cast, sample too long). `schemaText()` is the format in six lines for agents.
- `hub/studio/draw.js` (pen, wobble, boil, fills), `rig.js` (body, face, hair, extras), `moves.js` (the moves), `render.js` (timeline, backgrounds, bubbles, captions, camera, canvas and SVG painters). Pure JS, no DOM except the canvas painter, so the tests render frames in Node.
- `hub/studio.html`: the page. Polls `studio-get` every 3 s with `since=rev&seen=<newest note time>` (answers `{same:true}` while nothing changed: one or two store reads).
- `hub/lib/studio.js`: store, page API, MCP tools, the team brief (`studioBrief`).

## Store keys (`hub:studio:*`)
`seq`, `index` (hash id → meta), `p:<id>` project JSON (latest), `r:<id>` last 10 revisions, `n:<id>` notes (100), `sheet:<id>` latest PNG (base64 + rev), `log` (feedback / rate / rule / full, 500), `rules` (`{text, style, version}`), `refs` (hash id → meta), `refseq`, `refimg:<ref>:<n>` (one key per picture, base64).

## Page API (password, `/api/hub?op=`)
GET `studio-list`, `studio-get&id[&since=rev&seen=ts]`, `studio-rules`, `studio-log&since=ts`.
POST `studio-new {idea,title,team,model,thinking}`, `studio-feedback {id,text,rule}`, `studio-full {id}`, `studio-sheet {id,rev,png}` (PNG base64 or data URL, max 380 KB), `studio-rate {id,rev,good,note}`, `studio-rules {text,style}` (style is a patch; `null` deletes a key).

## MCP tools (agents)
`studio_get` (project, format, rules, recent feedback and notes), `studio_put` (saves the cleaned project as a new revision and reports what it fixed plus lint), `studio_look` (latest sheet as an image + lint; `wait_s` up to 30 waits for the newest one), `studio_note`, `studio_refs` (XIAO's do / don't references, see below). The brief tells the team: director writes, critic looks, at most 2 critique rounds per request, no branches or PRs, post `done` with one line.
The critic only gets a picture while the studio page is open somewhere (it draws the sheet). Without it the critic works from lint and the JSON.

## Nightly learning (your PC, almost no tokens)
`node hub/studio-nightly.mjs` reads the feedback log since its last run. Nothing new: it stops with zero tokens. Otherwise ONE `claude -p --model haiku` call (about 1-3k characters: current rules, the style knobs, at most 40 new feedback lines) returns updated rules and small style changes; the answer is checked and saved with `studio-rules`. Every agent reads the rules in `studio_get`, so the next story starts from them. `--dry` prints the answer without saving.

Set it up once (needs Node and Claude Code signed in on the PC, which the PC hub agent already uses):
- Windows (Command Prompt): `setx HUB_URL https://<your hub address>` and `setx HUB_PASSWORD <hub password>`, then `schtasks /create /sc daily /st 03:00 /tn DopStudio /tr "node C:\path\to\Dop\hub\studio-nightly.mjs"`.
- Mac/Linux (`crontab -e`): `0 3 * * * HUB_URL=https://<hub> HUB_PASSWORD=<pw> node ~/Dop/hub/studio-nightly.mjs`.
The PC must be on at that time.

## Limits (honest)
- Video has no sound (browser recording of the canvas only). Voice preview uses the device's speech voice.
- One body plan (front-facing with a 3/4 face turn); no side or back views, no hands with fingers, no lip sync to audio.
- The contact sheet needs the page open; agents cannot see drawings otherwise.
- Not measured yet: how many revisions a story takes, and usage per story.

Tests: `tests/hub-studio.test.ts` (backend, nightly), `tests/studio-render.test.ts` (renderer).

## References (do / don't) for the character look
XIAO teaches the look with pictures and videos: **DO** = copy this, **DON'T** = avoid this. They are studio-wide (every story), not per project.
- **Refs tab** on the page: choose DO or DON'T, pick pictures (up to 4) or one video, add title, note, tags, optional link. Pictures are shrunk in the browser to JPEG under 150 KB; a video becomes 4 frames (evenly spaced) in the browser, so no video file is stored. "Tell the team" posts a feedback line so the thread re-reads them. Tap ✕ to delete.
- **Store**: meta in hash `hub:studio:refs`, each picture in its own key (`refimg:<id>:<n>`), newest 60 references kept.
- **Page API**: GET `studio-refs`, GET `studio-ref&id&n` (`{mime,data}`), POST `studio-ref-add {kind:'do'|'dont',title,note,tags,url,type,images:[dataURL]}`, POST `studio-ref-del {id}`.
- **Agents**: `studio_refs(kind?, ref?)` returns the list plus up to 6 pictures; `studio_get` also lists them as text. The brief tells the director to read them once before drawing and follow every DO / avoid every DON'T, and the critic to compare each sheet to them and name the biggest gap. With none added, the tool says so and agents must not invent a look.
- **Uploads feature (thread #351)**: not built when this was written. Until it exists, the Refs tab is the upload path. When it lands, add its files as `url` or extra image sources in `refAdd` (hub/lib/studio.js); the tool and brief need no change.
