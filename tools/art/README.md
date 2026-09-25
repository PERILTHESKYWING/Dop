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
