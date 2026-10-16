# Kami site
Summary: Kami is a separate ChatGPT-style Go coach site in `kami/`, built on Dop's engine. KataGo reads the position in the browser, `explain` (src/lib/coach/explain) turns reads into facts and variations, and a writer words them. Dop's own site and build are unchanged.

## What it does
- Tiers (picker in the composer, version from `KAMI_VERSION`): Hane (engine text, thinking off), Tesuji (engine text, medium), Myoshu (one Gemini call, high). Kami Local (beta) shows only when `kami/src/config.ts` has a model repo and the browser has WebGPU.
- Questions (`kami/src/lib/question.ts`): a point like R16 → why-move; "why not / what about X" → why-not; "move 37" → why-move on the position before move 37; "what should I play" → best; else overview. A move already on the board is asked about in the position before it.
- Concept questions go to the library (`findConcepts`): when the text names a concept, asks "what is X?" without board words, or the board is empty. Empty library → short honest fallback. Myoshu may add one LLM expansion; any board coordinate in it rejects it.
- Answers: "Thought for Ns" lists the real `onThought` steps; `[[vN]]` become chips. Hover (mouse) or tap (phone, pinned) plays the line as numbered stones with `highlight` points and the note; leaving restores the board.
- Writers (`kami/src/lib/writer.ts`): Myoshu sends `buildLmPrompt(explanation)` to task `kami-write` (`shared/kami.ts`, plain text). The answer must pass `checkAnswer`; a throw shows "Wording unchecked, showing engine text", a fail or no LLM shows the engine text with its own note. If `GET /api/llm` says no key, no POST is made.
- Look (2026-10-16, XIAO: "copy Claude"): Claude's palette, light and dark (Settings › General), serif answers, thin scrollbars with no arrow buttons. Sidebar folds to an icon rail (state in `kami.sideFolded`); its foot is an account button with a Claude-style menu (Settings Ctrl+,, Usage, Get help, Learn more). No accounts in Kami: the name comes from Settings.
- Board panel (`kami/src/ui/BoardPanel.tsx`, rebuilt 2026-10-16): one caption row with the gear (game settings: best moves, territory, coordinates, pass, undo, paste/open SGF, new 19/13/9), one thin names row, the board as large as the column allows (`useSquare`), step buttons, Trend / Blunders / Performance tabs (Dop's `Report` panels). No eval bar, no tools row. Arrow keys, Home and End step through the game. `kami/src/ui/Splitter.tsx`: drag the line between chat and board (desktop: board width `kami.boardWidth`; phones: board height `kami.boardHeight`, 25–75%); double-click resets. Numbers come only from KataGo (`kami/src/lib/analysis.ts`).
- Hover: `[[vN]]` chips, `[[dN]]` built-position chips (`Explanation.illustrations`, from the answers thread) and every board point in answer text, thoughts and facts (`kami/src/lib/points.ts`) show on the board; a chip right after the same point is dropped. Settings › Board › Preview moves on hover turns hover off (tap still pins).
- Settings (`kami/src/lib/settings.ts` + `ui/Settings.tsx`): one `SETTINGS` list drawn by group (General, Board, KataGo, Positions) plus Usage, Data (export, delete all) and About. Add a definition to add a setting; the answers thread owns the Positions keys (`positions.minWinrate`, default 30%). KataGo visits and time cap feed `analysis.ts`; Network (auto/b18/b10) feeds `engine.ts` after a reload.
- Conversations (new, rename, delete) and each chat's board live in IndexedDB (`kami` db), localStorage if blocked. Board: click to play, undo, pass, step through a game, paste or open an SGF (also: paste SGF text into the composer), new 19/13/9 board.

## Structure
- `kami/index.html`, `kami/src/main.tsx`, `App.tsx`, `ui/*` (Sidebar, Composer, Messages, BoardPanel), `lib/*` (logic, tested in `tests/kami-site.test.ts`).
- Imports from Dop: `src/components/Board.tsx`, `src/lib/engine/*` (BrowserEngine, mcts), `src/lib/go/*` (SGF, board), `src/lib/coach/*`. No Dop router, store or app shell.
- `kami/vite.config.ts`: root = kami, own `/api/llm` dev middleware, and a copy step that puts `public/engine/*`, the bundled `public/models/g170e-b10c128-*.bin.gz` and `public/art/kaya.webp` into `kami/public/` (git-ignored by `kami/.gitignore`). Nothing is committed twice.
- Scripts (root): `npm run kami:dev` (http://localhost:5174), `kami:build` (typecheck + build to `kami/dist`), `kami:preview` (http://localhost:4174). `npm run typecheck` covers kami through the root tsconfig reference.
- `kami/api/llm.ts` reuses `shared/llmServer.ts`. `kami/package.json` only sets `"type": "module"`; dependencies stay in the root package.json.
- Kami Local loads transformers.js 4.2.0 from jsDelivr with a dynamic import (`kami/src/config.ts`), never bundled. Not tested end to end: no model repo exists yet.

## Engine gotchas
- Same worker and WASM as Dop, copied at build time, so `ENGINE_FILES` in `src/lib/engine/browserEngine.ts` busts the week-long `/engine` cache on both sites. Bump it once; nothing Kami-specific.
- Kami is its own origin: the network is downloaded and cached again (about 14 MB with the engine) and the device is tuned once (first answer takes a few seconds longer).
- Network (`kami/src/lib/engine.ts` `engineAttempts`, since 2026-10-15): kata1 b18 (about 97 MB, once) on a computer with WebGPU, through `/katago-models` (rewrite in `kami/vercel.json`, proxy in `kami/vite.config.ts`, same as Dop); b10 on the CPU on phones and tablets, without WebGPU, or after the GPU failed once (`kami.gpuBroken` in localStorage). The status line under the board says which ("KataGo b18 (strong) · GPU").
- Questions (`kami/src/lib/question.ts`): "why was my move bad?", "is this move good?" and "what's wrong with it?" mean the last move, judged before it was played; "what should I have played?" is the best move there; "why was R16 bad?" goes back to R16's latest play. "What should I play?" and "what should my move be?" mean now.
- Measured 2026-10-14 in headless Chromium on the 4-core cloud box (CPU, tuning picked 1 worker): first answer 11-14 s including download, load and tuning; the stand-in `explain` at medium hit its 8 s cap at 137-160 visits. Bundle: 342 KB JS (113 KB gzip), 21 KB CSS.

## Deploy (second Vercel project, Hobby)
1. vercel.com → **Add New…** → **Project**.
2. Next to **PERILTHESKYWING/Dop** click **Import** (the same repo as Dop is fine).
3. **Project Name**: `kami`.
4. **Root Directory**: click **Edit**, pick `kami`, click **Continue**. Leave Framework, Build and Output as they are (`kami/vercel.json` sets them).
5. Optional, for Myoshu wording: open **Environment Variables** and add `LLM_API_KEY` = your Google AI Studio key, `LLM_PROVIDER` = `Google AI Studio`, `LLM_MODEL` = `Gemini`. Without them every tier still works with engine text.
6. Click **Deploy**.
7. Check: open `https://<your-kami-domain>/api/llm?test=1` (makes one tiny Gemini call), then ask the site "What should Black play here?".

If the build fails with a missing `package-lock.json` or `..`: Project → **Settings** → **Build and Deployment** → **Root Directory** → turn on **Include files outside the root directory in the Build Step** → **Save** → **Deployments** → **Redeploy**. Vercel turns this on by default for projects made after Aug 2020 (vercel.com/docs/monorepos/monorepo-faq). The function bundles `../shared` the same way.

Notes: both projects now build on every push (Hobby runs one build at a time, so they queue). Using the same Gemini key on both shares one free quota.

## Not done / unverified
- Never deployed to Vercel from here; the steps above follow Vercel's docs and Dop's working setup.
- Never called real Gemini (no key in the sandbox); tests stub `/api/llm`.
- 2026-10-16 layout checked in headless Chromium (1280×720 light/dark, 390×844 phone) with screenshots; not yet on a real phone or Windows. Node timings on the sandbox (one thread, bundled b10): a 120-visit board read about 6–11 s, a 60-visit trend read about 3.2 s.
- Kami's board has no Data or Skill tab (both need Dop's study data).
