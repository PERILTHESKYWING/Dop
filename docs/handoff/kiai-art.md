# Kiai art (renders)
Summary: Kiai's board skin, landing images and intro video come from `tools/kiai-art/` (Blender 5 as a Python module, Cycles on CPU). All materials, the razorbill and the clouds are procedural; nothing is downloaded. Outputs go to `kami/public/kiai/` (committed, small).

## Setup
- `python3 -m venv venv && venv/bin/pip install bpy pillow numpy` (Python 3.11+, about 400 MB). ffmpeg for the video.
- Run each script with that Python from `tools/kiai-art/`. The hero's position is `pos.json` (34 moves of bench game g70dd864b0bcbfc05; the same stones are in `kami/src/ui/landingDemo.ts`).

## Scripts
- `kl.py` shared: kaya (masame grain, amber matched to XIAO's reference board; `contrast`, `palette`, `horizontal` for the sides), slate and clamshell stones (lathed double-convex), sky, sun, camera. `woodtest.py OUT` renders quick swatches and prints mean colour and grain strength (reference board top: about rgb 164/100/44 with lines; our wood 180/116/61).
- `scene.py` board (lacquer lines texture, darker sides), bowls with heaped stones, stones on points with a little jitter.
- `sprites.py OUT` the app board: `wood.png` (top-down, no denoise so the grain stays sharp), `b0-3`, `w0-5`, `shadow` → convert to `.webp` in `kami/public/kiai/board/`.
- `clouds.py OUT W H S` the sky plate: a cumulus sea 300 m below (volumes, 6 bounces so they stay white), sun 21° up. 2560×960 at 24 samples took about 9 min on 4 cores.
- `hero.py OUT W H S wide|macro` the board on a stone table on a transparent background; `compose_hero.py` lays it over the defocused plate with matched horizon → `hero.webp`, `hero-tall.webp`. `macro` is the close-up for the on-device section (rendered without the denoiser so the grain survives; `compose_macro.py` puts it over a defocused patch of sky). The app's board column uses `sky.webp`, a washed-out crop of the plate.
- `bird.py` Ikki: lofted body (deep chest, thick neck, deep bill with the white band and eye line), covert panels and 23 individual flight feathers a wing (white tips on the secondaries), `flap()`. Plumage is kept matte: any real specular on the black back reads as a pale plastic shell.
- `flight.py OUT W H S` 90 frames of the bird alone (transparent, motion blur on the wings) from a tracking camera; Ikki surges away after 2.25 s. `compose_flight.py` adds the streaking plate, torn cloud wisps (two near ones veil the bird), shake, grain and the closing cloud; ffmpeg encodes `flight.mp4` (+ `flight-poster.webp`):
  `ffmpeg -framerate 30 -i comp/f%03d.png -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart flight.mp4`. 1440×810 bird frames at 16 samples take about 4 s each on 4 cores.

## Honest state
- Critique rounds by 5 Haiku critics (bird, VFX, Go equipment, logo, art direction). Round 1 scores: bird 3/10, board 4/10, stones 3/10, logo 3/10. Round 2 scores are in the PR. The bird is still the weakest part: the body has no real feather surface.
