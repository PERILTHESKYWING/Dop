"""Honed white marble for the landing's table: soft grey mottling, a few cloudy veins and a fine
grain, as tools/kiai-art/hero.py's Blender material, but as a seamless tile the live 3D table
repeats (every 1.2 m). Pure numpy: the noise is made in the frequency domain, so it tiles.

Usage: python3 -I marble.py OUT.webp [SIZE]      (2048 for the site)
"""
import sys

import numpy as np
from PIL import Image

out = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
rng = np.random.default_rng(7)


def field(beta, lo=1.0):
    """A periodic random field with a 1/f^beta spectrum, scaled to -1..1."""
    fx = np.fft.fftfreq(N)[None, :] * N
    fy = np.fft.fftfreq(N)[:, None] * N
    f = np.hypot(fx, fy)
    f[0, 0] = 1
    amp = 1 / np.maximum(f, lo) ** (beta / 2)
    amp[0, 0] = 0
    ph = rng.uniform(0, 2 * np.pi, (N, N))
    v = np.real(np.fft.ifft2(amp * np.exp(1j * ph)))
    return np.clip(v / (2.5 * v.std()), -1, 1)


def lin(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


mott = field(3.2, 3)                      # broad clouding
warp = field(2.6, 2)                      # bends the veins
y, x = np.mgrid[0:N, 0:N] / N
# veins run diagonally (2 across, 3 down keeps the tile seamless), bent and broken by the noise
phase = 2 * np.pi * (2 * x + 3 * y) + 5.5 * warp
vein = np.exp(-(np.sin(phase) ** 2) / 0.03)             # thin where sin crosses zero
vein *= np.clip(0.5 + 0.9 * field(2.8, 2), 0, 1)        # fades in and out along its length
hair = np.exp(-(np.sin(2 * np.pi * (5 * x - 2 * y) + 9 * field(2.4, 3)) ** 2) / 0.004) * 0.35 * np.clip(field(3.0, 2), 0, 1)

a, b, v = lin('#ebeae6'), lin('#dedcd7'), lin('#c9cbce')
t = (mott * 0.5 + 0.5)[..., None]
img = a * (1 - t) + b * t
k = np.clip(vein * 0.7 + hair, 0, 1)[..., None]
img = img * (1 - k) + v * k
img += rng.normal(0, 1.6, (N, N))[..., None]             # fine grain
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out, quality=84, method=6)
print('wrote', out, N)
