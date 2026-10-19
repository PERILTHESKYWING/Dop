"""
Washi paper for the 気合 loader: a warm off-white with soft cloudy density and long kozo fibres,
tileable. Everything is procedural (numpy + Pillow); nothing is downloaded.

    python3 tools/brand/washi.py kami/public/kiai/washi.webp [SIZE] [SEED]
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

out = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 640
rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 7)


def tile_noise(falloff: float, cutoff: float) -> np.ndarray:
    """Periodic noise from filtered white noise (FFT), so the tile wraps seamlessly."""
    f = np.fft.fftfreq(N)[:, None] ** 2 + np.fft.fftfreq(N)[None, :] ** 2
    f = np.sqrt(f)
    f[0, 0] = 1
    spec = np.fft.fft2(rng.normal(0, 1, (N, N))) / f**falloff * np.exp(-((f / cutoff) ** 2))
    n = np.real(np.fft.ifft2(spec))
    return (n - n.min()) / (n.max() - n.min())


base = np.array([241, 235, 224], dtype=float)  # warm kozo white
cloud = tile_noise(1.2, 0.05)
grain = (tile_noise(0.0, 0.35) - 0.5) * 36

lum = (cloud - 0.5) * 6 + grain * 0.3

# fibres: long thin curved strands, a little lighter (and a few darker) than the sheet
fib = np.zeros((N, N))
for _ in range(170):
    x, y = rng.random() * N, rng.random() * N
    a = rng.random() * np.pi * 2
    length = rng.uniform(40, 220)
    bend = rng.normal(0, 0.0035)
    w = rng.choice([1, 1, 1, 2])
    tone = rng.choice([1.0, 1.0, 1.0, -0.8]) * rng.uniform(0.4, 1.0)
    for s in np.arange(0, length, 0.7):
        a += bend
        x += np.cos(a) * 0.7
        y += np.sin(a) * 0.7
        ix, iy = int(x) % N, int(y) % N
        fib[iy, ix] += tone
        if w == 2:
            fib[(iy + 1) % N, ix] += tone * 0.6
fimg = Image.fromarray(((fib.clip(-1.5, 1.5) / 3 + 0.5) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
fib = (np.asarray(fimg, dtype=float) / 255 - 0.5) * 3
lum += fib * 5

rgb = (base[None, None, :] + lum[..., None] * np.array([1.0, 0.98, 0.93])).clip(0, 255).astype(np.uint8)
Image.fromarray(rgb).save(out, quality=82, method=6)
print('wrote', out)
