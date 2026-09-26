# Procedural artwork

## Sunrise meadow (`meadow.html`, `render-meadow.mjs`)

`meadow.html` paints the app's background, a sunrise over a meadow with a lone tree, entirely in code.
It uses a seeded PRNG, gradient noise, fBm and domain warping for the sky and clouds, a space-colonisation
tree and about 190k Canvas grass blades. The result is tone-mapped and dithered, and it is deterministic:
the same seed always gives the same pixels. `render-meadow.mjs` drives the page in headless Chromium
(Playwright) and writes these files:

| file | size | use |
| --- | --- | --- |
| `public/art/meadow.webp` | 2560×1440 | desktop background |
| `public/art/meadow-1280.webp` | 1280×720 | smaller screens and the first paint |
| `public/art/meadow-tall.webp` | 1080×1920 | portrait and phone (re-composed, not cropped) |
| `public/art/clouds.webp` | 2560×720, transparent | cloud wisps that tile horizontally, for a slow CSS drift |

Regenerate everything (about 30 s) with:

```sh
node tools/art/render-meadow.mjs                     # add --only landscape,tall,clouds for a subset
node tools/art/render-meadow.mjs --preview /tmp/art  # also writes lossless PNG previews
```

Playwright is taken from the project or the global npm root. Set `PLAYWRIGHT_NODE_PATH` or `CHROMIUM_PATH` to
point elsewhere. To look at a preview, open `meadow.html` directly, optionally with `?preset=tall&w=540&h=960`.
Composition and colours live in `PRESETS` and `palettes()` in `meadow.html`. Each WebP is saved at the highest
quality that fits its byte budget.

## Theme paintings (`render-theme.mjs`, `sakura.html`, `mist.html`, `aurora.html`)

Each background theme besides the sunrise has its own generator page. The pages share `artkit.js`, which
holds the seeded PRNG, noise (Perlin, fBm, ridged, periodic), OKLab ramps, linear-light float buffers,
blur, bloom, tone mapping, dither and grain, and a WebP encoder that binary-searches the highest quality that
fits a byte budget. Every page exposes `ThemeArt.render(preset, w, h)`, `ThemeArt.strip(name, w, h)` and
`ThemeArt.jobs`. `render-theme.mjs` drives them in headless Chromium and writes `public/art/<theme>/`.

- **Sakura dusk** (`sakura.html`): a cherry tree grown by space colonisation, with about 6000 blossom
  clusters lit by the setting sun. Also a pagoda on violet hills, a still lake mirroring the sky, and a
  grassy bank strewn with petals.
- **Misty peaks** (`mist.html`): eight ranges of blue ridges at first light, painted with aerial
  perspective. Every ridge has the same body colour seen through more or less fog, and the fog is warm
  towards the sun. The scene also has valley fog, rim light on the crests, sun rays, treelines of spruce
  silhouettes, and large spruce framing the view.
- **Aurora night** (`aurora.html`): curtains of northern lights built by splatting light columns along
  folded curves, with the rays converging towards the zenith. There are also stars, the Milky Way and a
  crescent moon. The snowy range is a heightfield rendered like a voxel landscape (moonlit, snow on the
  gentler slopes). A lake mirrors everything, with a lit cabin on the far shore and snowy spruce in front.

Each theme has a landscape painting, a portrait painting that is re-composed rather than cropped, a
picker thumbnail and transparent (or, for the aurora, black) strips for the CSS animation. Sizes are as
rendered:

| file | pixels | bytes | use |
| --- | --- | --- | --- |
| `sakura/sakura.webp` | 2560×1440 | 438,484 | desktop |
| `sakura/sakura-1280.webp` | 1280×720 | 154,590 | smaller screens |
| `sakura/sakura-tall.webp` | 1080×1920 | 304,814 | portrait and phone |
| `sakura/petals.webp` | 512×64 | 5,144 | 8 petal sprites for the falling petals |
| `sakura/glints.webp` | 1280×360 | 39,752 | two frames of sparkles on the sun's path, cross-faded |
| `sakura/mist.webp` | 1024×64 | 16,000 | haze band along the far shore (tiles sideways) |
| `sakura/thumb.webp` | 480×270 | 25,994 | theme picker |
| `mist/mist.webp` | 2560×1440 | 350,724 | desktop |
| `mist/mist-1280.webp` | 1280×720 | 149,884 | smaller screens |
| `mist/mist-tall.webp` | 1080×1920 | 277,218 | portrait and phone |
| `mist/fog.webp` | 768×192 | 39,726 | two bands of fog (each tiles sideways) that drift at three depths |
| `mist/thumb.webp` | 480×270 | 25,992 | theme picker |
| `aurora/aurora.webp` | 2560×1440 | 417,052 | desktop |
| `aurora/aurora-1280.webp` | 1280×720 | 150,814 | smaller screens |
| `aurora/aurora-tall.webp` | 1080×1920 | 309,486 | portrait and phone |
| `aurora/light-a.webp`, `light-b.webp` | 1280×720 | 59,584 / 58,462 | the aurora light alone on black, rays in two other phases, screened and cross-faded |
| `aurora/light-a-tall.webp`, `light-b-tall.webp` | 540×960 | 31,298 / 30,706 | the same for the portrait painting |
| `aurora/thumb.webp` | 480×270 | 25,416 | theme picker |
| `sunrise/thumb.webp` | 480×270 | 25,694 | theme picker (made from `meadow.webp`) |

Regenerate with:

```sh
node tools/art/render-theme.mjs sakura                    # one theme (sakura about 25 s, mist 20 s, aurora 25 s)
node tools/art/render-theme.mjs all                       # the three themes and the sunrise thumbnail
node tools/art/render-theme.mjs aurora --only landscape   # a subset of the page's jobs
node tools/art/render-theme.mjs mist --preview /tmp/art   # also write lossless PNG previews
```

Open a page directly to preview it, optionally with `?preset=tall&w=540&h=960` or `?strip=fog&w=768&h=192`.
Composition lives in each page's `PRESETS`. The CSS in `src/styles/scenery.css` places the glow and the
animated layers with the same numbers: the sun, moon, horizon and fog lines are positions in the painting.
If you move one in a preset, move it there too. The CSS references each theme's files only under its
`.scene-<id>` class, so a browser downloads only the art of the theme on screen.

## Kaya board texture (`kaya.html`, `render-kaya.mjs`)

`kaya.html` paints the board's wood grain from seeded value noise. `render-kaya.mjs` renders it in headless
Chromium and writes `public/art/kaya.webp` (1024×1024), lowering the WebP quality until the file fits its size
budget. Regenerate it with:

```sh
node tools/art/render-kaya.mjs   # options: --seed 7 --size 1024 --max-kb 150 --quality 0.92 --out public/art/kaya.webp
```

## Origin

All of this artwork is original. It was generated procedurally by these scripts for DOPPELGÄNGER and contains
no photographs, textures or other third-party assets, so it is under the same terms as the rest of this
repository's own code.
