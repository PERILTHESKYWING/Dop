"""Hide the wrap seam of an equirectangular panorama (where its left and right edges meet).

Cycles' denoiser treats the two edges as unrelated, so they end up a little apart in brightness
and detail. This spreads each row's difference across the edges (half on each side, fading over
a band), then softens a few columns either side of the join.

Usage: python3 -I pano_seam.py IN.png OUT.png [BAND]
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
band = int(sys.argv[3]) if len(sys.argv) > 3 else 96
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float64)
h, w, _ = a.shape
# the step across the join, row by row (smoothed down the rows so detail is not smeared)
d = a[:, -1] - a[:, 0]
k = np.ones(9) / 9
d = np.stack([np.convolve(d[:, c], k, mode='same') for c in range(3)], axis=1)
# a big step is a cloud on one side and sky on the other, not a brightness drift: leave those
d = np.clip(d, -10, 10)
ramp = (1 - np.arange(band) / band) ** 2
a[:, :band] += d[:, None, :] * ramp[None, :, None] / 2
a[:, w - band:] -= d[:, None, :] * ramp[::-1][None, :, None] / 2
img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
# soften the join itself: roll it to the middle, blur a thin strip, roll back
rolled = np.roll(np.asarray(img), w // 2, axis=1).astype(np.float64)
R = 24
blur = np.asarray(Image.fromarray(rolled[:, w // 2 - 2 * R : w // 2 + 2 * R].astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(np.float64)
x = np.arange(-2 * R, 2 * R)
wgt = np.exp(-((x / R) ** 2) * 2)[None, :, None]   # all blur at the join, none 2R away
rolled[:, w // 2 - 2 * R : w // 2 + 2 * R] = rolled[:, w // 2 - 2 * R : w // 2 + 2 * R] * (1 - wgt) + blur * wgt
Image.fromarray(np.roll(np.clip(rolled, 0, 255).astype(np.uint8), -(w // 2), axis=1)).save(out)
print('wrote', out)
