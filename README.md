# DOPPELGÄNGER

A local-first training lab that studies **one** Go player. Import your SGF games; KataGo analyses them in your
browser; DOPPELGÄNGER learns how you actually decide, finds the decisions you get wrong again and again, and
trains exactly those with blind positions until the numbers show the habit has changed.

```
your SGFs → KataGo analysis → position features → recurring-decision statistics (+ optional LLM naming)
  → player fingerprint & weaknesses → Forge training → blind tests → updated model → harder training
```

Everything (games, analyses, profile, training history) stays in your browser's IndexedDB. The only server
piece is an optional LLM proxy.

## What is in it

| Page | What it does |
| --- | --- |
| **Dashboard** | First-run checks (WebGPU, WASM, KataGo network, LLM), analysed games/positions, biggest and improving weakness, Player DNA, weakness map, training history. |
| **Game Library** | Drag in many SGFs, in any common encoding (UTF-8, GBK/GB18030, Big5, Shift_JIS, EUC-KR). Asks which side you played when the player names don't say. Resumable background analysis queue: a quick network look at every game first, then a tree search of every position. Komi follows the rules (Fox's KM[0] becomes the standard komi, with a warning and a picker). |
| **Game Review** | Live analysis as in Lizzie: KataGo keeps searching the move on screen, with candidate discs (winrate, visits, score) and a table that refine as it reads; Space pauses. Winrate and score graph, hover a candidate for its line, click it to try it on the analysis board. Ownership, policy heatmap, decision errors, "find similar", and what your copy expects on your turns. |
| **Player DNA** | Fingerprint on 11 axes, each weakness with its evidence positions and confidence. |
| **Doppelgänger** | The copy of you: how often it names your actual move (vs KataGo's policy alone), your habits in plain words, where you and KataGo disagree and what it costs, and a game against your copy. |
| **Forge** | Show → play → commit → reveal. Original positions, similar ones, counterexamples (look-alikes needing the opposite decision) and boundary cases; adaptive levels; optional one-tap reasons. The analysis board is one tap away. |
| **Blind Tests** | "Do I really know this?": 10–20 blind positions per weakness, scored against what the old habit would get right by default. The analysis board is available here too. |
| **Position Search** | Positions like this one across your games: board, game/move, your move, KataGo's move, evaluation difference and the associated weakness. |
| **Opponent Profiles** | Openings, corner sequences, fighting, invasion and strategy tendencies from a rival's SGFs. |
| **Engine & Settings** | Network choice (or load a network file), WebGPU/CPU, safe mode, visits, LLM connection test, the practice winrate floor, appearance, the model lab, storage. |

### Live analysis and the tree search
The browser build of KataGo evaluates positions with its network only, so DOPPELGÄNGER runs its own
tree search (PUCT, as KataGo does) on top of it. Game analysis searches every position, and the position
on screen keeps being searched ("pondering"): visits climb and the numbers refine while you watch, and one
search tree follows you through the game. The network itself does not learn in the browser; KataGo gets
stronger on a position by searching it longer. Settings has the visits per position for game analysis and
an optional cap for live analysis. For the small built-in network, winrates are derived from its score
estimate, which on a game analysed with desktop KataGo (via Lizzie) matched it far better than its value head.

### The analysis board
In Forge, Blind Tests and Game Review you can open a live analysis board at any time: play moves for either
side, undo and redo, and see KataGo's winrate, score lead, candidate moves with their lines, the policy
heatmap and territory refine as it searches. Opening it before you answer marks that answer as assisted:
it is recorded, but it does not count toward mastery or blind-test scores.

### Practice positions stay playable
Forge, blind tests and engine-made variations only use positions where the side that is behind still has at
least 30% to win, so there is always a real decision to make. They also skip positions not worth drilling:
early-opening choices where little is at stake, ordinary moves that lost little, and positions where several
moves are about equally good. The limit can be set from 10% to 45% in
Engine & Settings.

### How weaknesses are found (numbers never come from the LLM)
Each move is classified into decision contexts ("the opponent just played a probe next to your safe group",
"there is a small weak group of yours", …) and whether it made that decision's typical error, with KataGo's
loss as the judge. A weakness needs at least 3 errors in 2+ games and a Bayesian confidence ≥ 75% that your
error rate in that context is above your own median rate. The LLM, if configured, only names and groups
patterns in compressed, representative evidence; every pattern it returns must cite real evidence ids or it
is discarded, and its confidence is capped by the statistics.

### The Doppelgänger model
A conditional-logit model over KataGo's top policy moves plus your move, with 21 interpretable features,
initialised to KataGo's policy and trained on your games (held out by game). It predicts the move *you* would
play, and its weights read as habits ("extends small weak stones", "answers locally"). It is a behavioural
model, not a claim to simulate you perfectly.

### Your level (rank estimate)
Every analysed game side gives a few numbers measured on the bundled network's first look at each position:
how often the move was KataGo's first choice or in its top three, how likely the network found it, points lost
per move, and the share of mistakes and blunders. `public/level/calibration.json` says, for every Fox rank from
18k to 9d, what those numbers typically are and how much they vary from game to game. The app scores every rank
by how well it explains all of a player's games, and shows the best estimate with an 80% range, per phase too.
Games analysed with another network are measured again with the bundled one (one look per position, no search).
The same corpus gives each rank's error rate per decision type, so weaknesses a player makes much more often
than players of their level are trained first.

Rebuilding the calibration (it ran in the cloud on CPU; about 450 games an hour on 4 cores):

```
# one SGF path per line, ranks read from BR/WR (e.g. a sample of github.com/featurecat/go-dataset)
for p in 0 1 2 3; do npx tsx scripts/rank-corpus.ts --list files.txt --part $p --parts 4 --out corpus/part-$p.jsonl & done; wait
npx tsx scripts/rank-fit.ts corpus/part-*.jsonl   # writes public/level/calibration.json and prints held-out accuracy
```

### Ask about this position
In Review, questions about the position go to the language model together with a fact sheet made from
KataGo's analysis (candidates, values, lines, groups and their status). The model may ask KataGo to check up to
three lines first, which the browser searches. Any coordinate, winrate or point figure in the answer that is not
in KataGo's facts sends the answer back once for correction and is otherwise flagged under it (`shared/ask.ts`).

### Copies of other players, and the strength dial
Opponent profiles train the same copy on an imported player's analysed games, and you can play against it.
When playing any copy you can set a strength: the copy keeps choosing the moves its player tends to choose, but
each move's cost (KataGo's look after it, against the best alternative) is weighed against what a player of the
chosen rank typically loses per move (`src/lib/profile/strength.ts`).

### Model lab
A small pattern model is trained in a Web Worker on your KataGo data, benchmarked against KataGo's choices,
and the positions it gets most wrong are queued for deeper analysis. Datasets and model versions are kept.
It is far weaker than KataGo and never presented otherwise.

## Engine

KataGo runs in a Web Worker as WebAssembly compiled from
[saigo-online/katago-webgpu](https://github.com/saigo-online/katago-webgpu) (`public/engine/`). The same binary
uses WebGPU when available and falls back to an Eigen CPU backend. Networks are downloaded on first use and
cached in the Cache API; they are never committed.

- Automatic choice: with WebGPU, `kata1-b18c384nbt`; without WebGPU, the built-in `g170e-b10c128`, which ships in
  `public/models/` so analysis works even where downloads are blocked. `kata1-b28c512nbt` (strongest, 260 MB)
  is opt-in.
- If a network fails to download, load or pass a quick health check, the next one is tried, ending with the
  built-in network on the CPU. A graphics card that crashes is remembered and skipped until you retry it.
  Stalled downloads time out, and a cut-off file or an HTML error page is detected instead of cached.
- **Load a network file** in Engine & Settings accepts a `.bin.gz` downloaded by hand from katagotraining.org.
- Analysis of your games pauses while you use the analysis board, so the board answers first.
- kata1 networks are fetched through the same-origin path `/katago-models/…`, which `vercel.json` (and the Vite
  dev proxy) rewrites to `media.katagotraining.org`; the direct URL is tried next.
- Every stored evaluation records engine build, network, network version and visits.
- Human-style policy (`humanPolicy`) needs KataGo's human SL network, whose metadata encoder this WebGPU build
  cannot load yet; the network is listed as unsupported and the field stays empty.

Rebuild the engine with `engine/build-engine.sh` (needs emsdk and Eigen headers).

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

Click **Explore the demo first** on the first-run screen to explore with a fictional player ("Mira") whose games were
played and analysed by the real engine (`npm run demo:generate` rebuilds them).

## Deploy (Vercel)

1. Import the repository in Vercel. The framework preset is Vite; `vercel.json` sets the build, the SPA
   fallback, the network download rewrite, and the `/api/llm` function.
2. Optional LLM: in **Project Settings → Environment Variables** add
   - `LLM_API_KEY`: your Google AI Studio key
   - `LLM_PROVIDER`: `Google AI Studio`
   - `LLM_MODEL`: `Gemini` or an exact id. `Gemini` tries `gemini-flash-latest`, then
     `gemini-3-flash-preview`, `gemini-flash-lite-latest` and `gemini-3.1-flash-lite`, skipping models that are
     busy or retired.

   Redeploy after adding them, then press **Test connection** in Engine & Settings: it makes one tiny real
   call and shows which model answered, or the exact error. The key is read only by the serverless function (`api/llm.ts`) and sent to
   Google in a request header; it is never included in the client bundle or returned by the API. Do not
   prefix these variables with `VITE_`. For local development put them in `.env` (git-ignored); see
   `.env.example`.
3. Without these variables everything works; pattern names come from the built-in statistical signatures.

Any static host works for the site itself. Without the `/katago-models` rewrite the kata1 networks need
CORS from katagotraining.org; the small networks work anywhere.

## Browser support

Chrome/Edge 113+ (WebGPU), Safari 18+/Firefox with WebGPU enabled; other modern browsers use the CPU
backend. Unsupported browsers, missing networks, bad SGFs and LLM failures are reported in the UI and the
rest of the app keeps working.

## Licences
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
