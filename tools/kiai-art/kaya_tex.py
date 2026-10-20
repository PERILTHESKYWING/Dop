"""Textures for the live 3D board (kami/src/three): kaya top, front and side faces, a bump map
of the grain, the bowls' mulberry, and the clamshell stripes of white stones. All procedural
(numpy), so nothing is downloaded. The top's straight masame grain runs along the board's
length, as on XIAO's reference board: honey to amber bands, fine dark latewood lines that fade
in and out, and long fibres.
Styles (the app's board choice): kaya (honey, like XIAO's reference board; also writes the bump,
bowls and shells), shinkaya (pale spruce, the common club board), dark (deep, aged wood).
Usage: python kaya_tex.py OUT_DIR [SEED] [STYLE]"""
import os
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1]
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 11
STYLE = sys.argv[3] if len(sys.argv) > 3 else 'kaya'
PREFIX = '' if STYLE == 'kaya' else f'{STYLE}-'
os.makedirs(OUT, exist_ok=True)
BW, BL = 0.424, 0.454
W = 2048
H = int(round(W * BL / BW))  # 2193: 1 px is the same on both axes


def noise1(n, f_lo, f_hi, slope, rng):
    """1D noise with power ~ f^-slope between f_lo and f_hi cycles over n samples, in [-1, 1]."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.arange(spec.size, dtype=np.float64)
    amp = np.where((f >= f_lo) & (f <= f_hi), np.maximum(f, 1) ** (-slope / 2), 0)
    x = np.fft.irfft(spec * amp, n)
    return x / (np.abs(x).max() + 1e-9)


def noise2(h, w, fu, fv, rng, slope=1.0):
    """2D noise band-limited by an ellipse: up to fu cycles across, fv along; [-1, 1]."""
    spec = np.fft.rfft2(rng.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.rfftfreq(w)[None, :] * w
    r = np.sqrt((fx / fu) ** 2 + (fy / fv) ** 2)
    amp = np.exp(-r * r) * np.maximum(np.sqrt(fx * fx + fy * fy), 1) ** (-slope / 2)
    x = np.fft.irfft2(spec * amp, (h, w))
    return x / (np.abs(x).max() + 1e-9)


def srgb(c):
    return np.array(c, dtype=np.float64) / 255.0


def ramp(t, stops):
    """Piecewise-linear colour ramp; t in [0, 1], stops [(pos, (r, g, b))]."""
    t = np.clip(t, 0, 1)[..., None]
    out = np.zeros(t.shape[:-1] + (3,))
    for (p0, c0), (p1, c1) in zip(stops[:-1], stops[1:]):
        k = np.clip((t - p0) / (p1 - p0), 0, 1)
        m = (t >= p0) & (t <= p1)
        out = np.where(m, srgb(c0) * (1 - k) + srgb(c1) * k, out)
    return out


rng = np.random.default_rng(SEED)
# straight grain, gently wandering: a sideways shift that changes slowly along the board
warp = 5.0 * noise2(H, W, 3, 2, rng, slope=2.0) + 1.6 * noise2(H, W, 10, 6, rng, slope=1.0)
U = np.arange(W)[None, :] + warp  # warped column (px)

# bands of lighter and darker wood (early and late growth over many years); the broad ones kept gentle so
# a straight-down view doesn't read as stripes
N = 4 * W
bands = 0.36 * noise1(N, 3, 40, 1.6, rng) + 0.34 * noise1(N, 30, 260, 1.2, rng) + 0.3 * noise1(N, 200, 900, 0.6, rng)
bands = (bands - bands.min()) / (bands.max() - bands.min())


def sample(arr, x):
    x = np.clip(x, 0, arr.size - 1.001) * (arr.size - 1) / (arr.size - 1)
    i = np.floor(x).astype(int)
    f = x - i
    return arr[i] * (1 - f) + arr[np.minimum(i + 1, arr.size - 1)] * f


scaleN = N / W
B = sample(bands, (U + 40) * scaleN * 0.25)  # 0.25: N covers 4 widths, so bands are ~4x wider than samples

# latewood lines: thin, irregularly spaced, each fading in and out along the board
lines = np.zeros(4 * W)
x = 0.0
while x < lines.size - 1:
    x += rng.uniform(3.5, 10) * (1.6 if rng.random() < 0.15 else 1.0)
    k = int(x)
    if k < lines.size:
        lines[k] += rng.uniform(0.35, 1.0)
# soften each line to ~1.4 px
ker = np.exp(-0.5 * (np.arange(-4, 5) / 0.75) ** 2)
lines = np.convolve(lines, ker / ker.max(), mode='same')
L = sample(lines, (U + 7) * 1.0)
fade = 0.55 + 0.45 * noise2(H, W, 60, 1.5, rng, slope=0.5)  # along the board, lines come and go
L = np.clip(L * np.clip(fade, 0, 1), 0, 1)

# long fibres: fine across, very long along
fib = noise2(H, W, 520, 9, rng, slope=0.2)
# broad tone drift across the board (no two boards are even)
tone = noise2(H, W, 2.2, 1.6, rng, slope=1.5)

# Each style: colour ramp across the growth bands, latewood colour and how strongly it shows.
# kaya is matched to the reference board (top about rgb 164/100/44 in its light): honey, quiet grain.
STYLES = {
    'kaya': ([(0.0, (232, 174, 106)), (0.35, (220, 160, 92)), (0.7, (205, 144, 77)), (1.0, (188, 126, 62))], (152, 90, 40), 0.34),
    'shinkaya': ([(0.0, (240, 214, 162)), (0.4, (234, 204, 150)), (0.75, (226, 194, 138)), (1.0, (216, 182, 124))], (186, 142, 84), 0.3),
    'dark': ([(0.0, (150, 94, 52)), (0.35, (138, 84, 45)), (0.7, (124, 74, 38)), (1.0, (110, 64, 32))], (78, 44, 22), 0.32),
}
ramp_stops, late_rgb, late_k = STYLES[STYLE]
col = ramp(B, ramp_stops)
col *= (1 + 0.045 * fib[..., None]) * (1 + 0.06 * tone[..., None])
late = srgb(late_rgb)
col = col * (1 - late_k * L[..., None]) + late * (late_k * L[..., None])
top = np.clip(col, 0, 1)

# bump: latewood sits a hair lower, fibres give a fine tooth
bump = 0.5 - 0.22 * L + 0.10 * fib + 0.04 * (B - 0.5)


def save(arr, name, q=90):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    im.save(os.path.join(OUT, name), 'WEBP', quality=q, method=6)
    return im


save(top, f'{PREFIX}kaya-top.webp', 88)
if STYLE == 'kaya':
    save(np.clip(bump, 0, 1), 'kaya-bump.webp', 85)
print('top mean rgb', (top.reshape(-1, 3).mean(0) * 255).round(1), 'size', top.shape)

# front and back faces: the same columns as the top's near edge, running down the thickness
FH = 384
front = np.repeat(top[-1:, :, :], FH, axis=0)
ff = noise2(FH, W, 520, 4, rng, slope=0.2)
front = front * (0.66 + 0.035 * ff[..., None])  # end grain drinks the light: darker than the top
save(front, f'{PREFIX}kaya-front.webp', 88)

# long sides: grain along the length (rows of the top's colour field turned on their side)
side_cols = top[:, W // 2 - FH // 2: W // 2 + FH // 2, :]  # H x FH
side = np.transpose(side_cols, (1, 0, 2)) * 0.74
save(side, f'{PREFIX}kaya-side.webp', 88)
if STYLE != 'kaya':
    sys.exit(0)

# bowls: turned mulberry, dark brown like the reference's, rings running round the bowl
rng2 = np.random.default_rng(SEED + 1)
bh, bw = 512, 1024
v = np.arange(bh)[:, None] + 9 * noise2(bh, bw, 4, 3, rng2, slope=2.0)
rings = noise1(4 * bh, 4, 80, 1.4, rng2)
rings = (rings - rings.min()) / (rings.max() - rings.min())
R = sample(rings, v * 4 * 0.5)
bfib = noise2(bh, bw, 8, 260, rng2, slope=0.2)
MULB = [(0.0, (112, 58, 34)), (0.5, (88, 42, 22)), (1.0, (62, 28, 14))]
bowl = ramp(R, MULB) * (1 + 0.05 * bfib[..., None])
save(bowl, 'bowl.webp', 86)

# clamshell: faint, slightly curved parallel stripes (grey alpha-like map, 1 = no stripe)
rng3 = np.random.default_rng(SEED + 2)
S = 512
yy, xx = np.mgrid[0:S, 0:S] / S
curve = yy + 0.05 * (xx - 0.5) ** 2 + 0.004 * noise2(S, S, 6, 6, rng3, slope=2.0)
stripes = 0.5 + 0.5 * np.sin(curve * np.pi * 2 * 34 + 1.3 * noise2(S, S, 4, 4, rng3, slope=2.0))
stripes = stripes ** 3
shell = 1 - 0.045 * stripes - 0.012 * noise2(S, S, 40, 40, rng3, slope=0.5)
save(np.repeat(shell[..., None], 3, axis=2), 'shell.webp', 86)
print('wrote', OUT)
