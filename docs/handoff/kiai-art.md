# Kiai art (renders)
Summary: Kiai's flat board skin, the landing's sky-and-table plate and the live 3D board's textures come from `tools/kiai-art/` (Blender 5 as a Python module, Cycles on CPU, plus numpy). All materials and the clouds are procedural; nothing is downloaded. Outputs go to `kami/public/kiai/` (committed, small). The flight intro video and the razorbill model were dropped on 2026-10-18 (XIAO: "unnecessary and bad"); `bird.py`/`flight.py`/`compose_flight.py` stay only as history.

## Setup
- `python3 -m venv venv && venv/bin/pip install bpy pillow numpy` (Python 3.11+, about 400 MB). ffmpeg for the video.
- Run each script with that Python from `tools/kiai-art/`. The hero's position is `pos.json` (34 moves of bench game g70dd864b0bcbfc05; the same stones are in `kami/src/ui/landingDemo.ts`).

## Scripts
- `kl.py` shared: kaya (masame grain, amber matched to XIAO's reference board; `contrast`, `palette`, `horizontal` for the sides), slate and clamshell stones (lathed double-convex), sky, sun, camera. `woodtest.py OUT` renders quick swatches and prints mean colour and grain strength (reference board top: about rgb 164/100/44 with lines; our wood 180/116/61).
- `scene.py` board (lacquer lines texture, darker sides), bowls with heaped stones, stones on points with a little jitter.
- `sprites.py OUT` the app board: `wood.png` (top-down, no denoise so the grain stays sharp), `b0-3`, `w0-5`, `shadow` → convert to `.webp` in `kami/public/kiai/board/`.
- `clouds.py OUT W H S` the sky plate: a cumulus sea 300 m below (volumes, 6 bounces so they stay white), sun 21° up. 2560×960 at 24 samples took about 9 min on 4 cores.
- `kaya_tex.py OUT_DIR [SEED]` numpy textures for the live 3D board (`kami/src/three/kaya.ts`): kaya top (masame grain matched to the reference board), front, side, grain bump, bowl mulberry (dark, like the reference's), white-stone clamshell. The broad grain bands are kept gentle so a straight-down view doesn't read as stripes. Outputs go to `kami/public/kiai/3d/` as webp.
- `hero.py OUT W H S plate` the table and sky only, for the live hero: the site draws board, stones and bowls in 3D on top with the same camera (written as JSON next to OUT; copied into `kami/src/three/plate.ts`). Composed like the wide view into `kami/public/kiai/3d/plate.webp`; phones show a crop of the same plate (`PHONE_X0`/`PHONE_W` in `plate.ts`, x 1120-2320) so the whole board and both bowls fit.
- `hero.py OUT W H S wide|macro` the board on a stone table on a transparent background; `compose_hero.py` lays it over the defocused plate with matched horizon → `hero.webp`, `hero-tall.webp`. `macro` is the close-up for the on-device section (rendered without the denoiser so the grain survives; `compose_macro.py` puts it over a defocused patch of sky).
- `bird.py` Ikki: lofted body (deep chest, thick neck, deep bill with the white band and eye line), covert panels and 23 individual flight feathers a wing (white tips on the secondaries), `flap()`. Plumage is kept matte: any real specular on the black back reads as a pale plastic shell.
- `flight.py OUT W H S` 90 frames of the bird alone (transparent, motion blur on the wings) from a tracking camera; Ikki surges away after 2.25 s. `compose_flight.py` adds the streaking plate, torn cloud wisps (two near ones veil the bird), shake, grain and the closing cloud; ffmpeg encodes `flight.mp4` (+ `flight-poster.webp`):
  `ffmpeg -framerate 30 -i comp/f%03d.png -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart flight.mp4`. 1440×810 bird frames at 16 samples take about 4 s each on 4 cores.

## Honest state
- 2026-10-17 critique (5 Haiku critics): bird 3/10, board 4/10, stones 3/10, logo 3/10.
- 2026-10-18 redesign: 10 Haiku critics a round (meaning, board vs reference, glow, premium, motion, logo, app, mobile, copy, slide detector) on stills from headless Chromium; scores per round are in the PR.
