# Kami site (now Kiai)
Summary: Kami, renamed **Kiai** on 2026-10-17, is a separate Go analyst chat site in `kami/`, built on Dop's engine. KataGo reads the position in the browser, `explain` (src/lib/coach/explain) turns reads into facts and variations, and a writer words them. Dop's own site and build are unchanged.

## What it does
- Tiers (picker in the composer, version from `KAMI_VERSION`): Hane (engine text, thinking off), Tesuji (engine text, medium), Myoshu (one Gemini call, high). Kami Local (beta) shows only when `kami/src/config.ts` has a model repo and the browser has WebGPU.
- Questions (`kami/src/lib/question.ts`): a point like R16 → why-move; "why not / what about X" → why-not; "move 37" → why-move on the position before move 37; "what should I play" → best; else overview. A move already on the board is asked about in the position before it.
- Concept questions go to the library (`findConcepts`): when the text names a concept, asks "what is X?" without board words, or the board is empty. Empty library → short honest fallback. Myoshu may add one LLM expansion; any board coordinate in it rejects it.
- Answers: "Thought for Ns" lists the real `onThought` steps; `[[vN]]` become chips. Hover (mouse) or tap (phone, pinned) plays the line as numbered stones with `highlight` points and the note; leaving restores the board.
- Writers (`kami/src/lib/writer.ts`): Myoshu sends `buildLmPrompt(explanation)` to task `kami-write` (`shared/kami.ts`, plain text). The answer must pass `checkAnswer`; a throw shows "Wording unchecked, showing engine text", a fail or no LLM shows the engine text with its own note. If `GET /api/llm` says no key, no POST is made.
- Look (2026-10-16, XIAO: "copy Claude"): Claude's palette, light and dark (Settings › General), serif answers, thin scrollbars with no arrow buttons. Sidebar folds to an icon rail (state in `kami.sideFolded`); its foot is an account button with a Claude-style menu (Settings Ctrl+,, Usage, Get help, Learn more). No accounts in Kami: the name comes from Settings.
- Board panel (`kami/src/ui/BoardPanel.tsx`, round 2 on 2026-10-16): the players (stone, name, captures; the side to play is highlighted) and the gear share the top row, which runs to the top of the window (`.work.split` grid: the chat title bar sits over the chat only). Under them a thin eval bar (Black's win %, White's win %, lead; faded while KataGo reads). Then the board as large as the column allows (`useSquare`, grows when the splitter widens the column) and one row with the move slider (drag or tap anywhere; shows "12 / 30") and Trend / Blunders / Performance tabs (icons only when the column is narrow). An open graph has a header with × (also Esc, or the tab again); in a wide, short column it sits beside the board. Gear: best moves, territory, coordinates, pass, undo, paste/open SGF, new 19/13/9. Arrow keys, Home and End step through the game. `kami/src/ui/Splitter.tsx`: drag the line between chat and board (desktop: board width `kami.boardWidth`, chat keeps 380 px; phones: board height `kami.boardHeight`, 25–75%); double-click resets. Numbers come only from KataGo (`kami/src/lib/analysis.ts`).
- Performance tab (`ui/Performance.tsx`, chess.com's review card): accuracy per side (chess.com formula on win % lost per move, `lib/review.ts`), counts of Brilliant / Great / Best / Mistake / Miss / Blunder with chess.com-style icons (`ui/ClassIcon.tsx`; tap a count to jump to the next one), Game Rating (`lib/rating.ts`: Dop's level system, bundled b10 at visits 0 in a second engine that stops after, calibration copied from `public/level/` by `kami/vite.config.ts`), and an icon per phase from its accuracy (tooltip: the phase rating). Classes come from the trend reads (`lossFromEvals` + `classifyMove`); Brilliant = an only move (Great) whose b10 policy was under 12%, a stand-in for Dop's 5d find rate. A 46-move test game rated in about 45 s in headless Chromium on the sandbox CPU.
- Hover: `[[vN]]` chips, `[[dN]]` built-position chips (`Explanation.illustrations`, from the answers thread) and every board point in answer text, thoughts and facts (`kami/src/lib/points.ts`) show on the board; a chip right after the same point is dropped. Settings › Board › Preview moves on hover turns hover off (tap still pins).
- Settings (`kami/src/lib/settings.ts` + `ui/Settings.tsx`): one `SETTINGS` list drawn by group (General, Board, KataGo, Positions) plus Usage, Data (export, delete all) and About. Add a definition to add a setting; the answers thread owns the Positions keys (`positions.minWinrate`, default 30%). KataGo visits and time cap feed `analysis.ts`; Network (auto/b18/b10) feeds `engine.ts` after a reload.
- Round 2 of "Smarter Kami AI" (2026-10-16):
  - Go terms in answers (about 50: miai, ryou-sente, moyo, aji, sente, gote, keima…) have a dotted underline the first time they appear; hover or focus shows a short definition, tap pins it, "More about X" asks the library. Data in `src/lib/coach/glossary.ts` (`findTerms`); UI in `kami/src/lib/terms.ts` and `ui/Term.tsx`. Miai and double sente use XIAO's exact wording.
  - Questions carry an intent (`question.ts`): kill, live, tesuji ("Can I kill this group?" is answered Yes / No / It depends first), ahead ("who is ahead?"), biggest ("what is the biggest move?").
  - Settings › Profile: level (beginner, intermediate, strong) and style (solid, territory, influence, fighting, or Kami's guess). `kami/src/lib/style.ts` learns the style from the last 60 board clicks (not clicks on KataGo's candidates): a guess needs 8+ moves and a 45% share; a chosen style overrides it. `answer.ts` passes it to `explain` as `student`.
  - A problem answer (`Explanation.view`) and library examples open zoomed on their corner; a header button switches to the whole board.
- Conversations (new, rename, delete) and each chat's board live in IndexedDB (`kami` db), localStorage if blocked. Board: click to play, undo, pass, step through a game, paste or open an SGF (also: paste SGF text into the composer), new 19/13/9 board.

## Kiai (2026-10-17, XIAO's rebrand)
- Name Kiai, mascot Ikki the razorbill, models Skim / Dive / Abyss (ids still hane / tesuji / myoshu; `src/lib/coach/explain/types.ts`), local beta "Night Dive". Code identifiers, CSS classes and `kami.*` storage keys keep the old name so saved chats and settings carry over.
- Logo (`kami/src/ui/Logo.tsx`, `kami/public/favicon.svg`): Ikki's head, front view, tilted 9°, black and white, from XIAO's photo. Under 40 px it drops the bill grooves and thickens the white lines.
- Look: sky palette (tokens at the top of `kami/src/styles.css`), Archivo with the width axis (wide display type), the kaya board skin (`ui/skin.ts` → `Board`'s `skin` prop), Ikki on answers, stone-shaped idea chips, a sinking-mark "Thinking" indicator and depth marks (`ui/Depth.tsx`) for the models.
- Landing page (`ui/Landing.tsx`, `ui/landing.css`, lazy-loaded by `main.tsx`): shown on a first visit (no `kiai.entered` in localStorage) or at `#welcome`; "Open Kiai" sets the flag. A 3 s intro video (`/kiai/flight.mp4`, skipped on reduced motion, autoplay refusal, or after one play per tab), then the hero (board above the clouds), a real answer beside the real board (`ui/landingDemo.ts`, from `scripts/kami-critique.ts --only 10`), depths, on-device, Ikki, CTA. A dive gauge on the left reads 0–120 m as you scroll. Always light; no CSS gradients.
- Art: every image and the video are path-traced in Blender from code, no downloaded textures; see `docs/handoff/kiai-art.md`.

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
