"""Composite Ikki's flight from the renders: the out-of-focus cloud plate streaking past, cloud
wisps at two distances (the near ones blur into streaks and veil the bird for a moment), the bird
layer from flight.py, a hand-held shake and film grain. The shot ends by punching into a cloud,
which the landing page fades out of.
Usage: python compose_flight.py PLATE.png BIRD_DIR OUT_DIR W H [F0 F1]"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageFilter

plate_path, bird_dir, out_dir, W, H = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
N = 90
F0, F1 = (int(sys.argv[6]), int(sys.argv[7])) if len(sys.argv) > 7 else (1, N)
os.makedirs(out_dir, exist_ok=True)
rnd = np.random.default_rng(7)
R = random.Random(7)

# ---- background: the plate, scaled to leave room for the pan, out of focus
plate = Image.open(plate_path).convert('RGB')
scale = H * 1.18 / plate.height
plate = plate.resize((round(plate.width * scale), round(plate.height * scale)), Image.LANCZOS)
plate = plate.filter(ImageFilter.GaussianBlur(H * 0.005))
P = np.asarray(plate).astype(np.float32) / 255
P = np.concatenate([P, P[:, ::-1]], axis=1)    # the plate and its mirror image: room for a fast pan
PW, PH = P.shape[1], plate.height
PAN = (PW - W - 36) / (N - 1)                  # px per frame, ~40 at 1080p; leaves room for the shake margin
BIRD = 0.74                                    # the bird layer's scale: smaller and further off reads as real
Y0 = int((PH - H) * 0.42)                      # puts the horizon a little above the middle
HOR = PH * 0.45                                # the plate's horizon row (scaled plate), for the parallax


def hblur(a, L):
    """Box blur along x of length L (motion blur), edge-padded."""
    L = int(L)
    if L < 2:
        return a
    pad = np.pad(a, ((0, 0), (L, L), (0, 0)), mode='edge')
    c = np.cumsum(pad, axis=1, dtype=np.float64)
    h = L // 2
    out = (c[:, L + h:L + h + a.shape[1]] - c[:, L - (L - h):L - (L - h) + a.shape[1]]) / L
    return out.astype(np.float32)


def fbm(w, h, seed, octaves=6, base=6):
    g = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = base * 2 ** o
        small = g.random((max(2, n * h // w), n)).astype(np.float32)
        im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        acc += amp * np.asarray(im).astype(np.float32) / 255
        tot += amp
        amp *= 0.55
    return acc / tot


def wisp(w, h, seed):
    """A torn cloud: fbm through a soft ellipse, white on top, a touch blue-grey underneath."""
    n = fbm(w, h, seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    e = 1 - (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    a = np.clip((n - 0.5) * 4.5 + e * 0.9 - 0.3, 0, 1) ** 1.4 * np.clip(e * 2, 0, 1)   # torn, with holes
    shade = 1 - 0.13 * (yy / h)
    rgb = np.stack([shade * 0.975, shade * 0.985, shade * 1.0], -1)
    return np.concatenate([rgb, a[..., None]], -1).astype(np.float32)


# (first frame, y centre as a fraction of H, size as a fraction of H, px per frame, peak alpha, near?)
TRACKS = [
    (-30, 0.78, 0.28, 95, 0.7, False), (-6, 0.26, 0.16, 80, 0.4, False), (12, 0.86, 0.35, 110, 0.75, False),
    (30, 0.16, 0.13, 70, 0.35, False), (44, 0.70, 0.30, 100, 0.7, False), (60, 0.34, 0.15, 85, 0.4, False),
    (4, 0.62, 0.22, 120, 0.6, False), (20, 0.30, 0.12, 105, 0.35, False), (36, 0.82, 0.26, 130, 0.65, False),
    (52, 0.58, 0.18, 125, 0.5, False), (66, 0.22, 0.12, 100, 0.35, False),
    (22, 0.55, 0.9, 520, 0.42, True), (58, 0.40, 1.1, 560, 0.38, True),
]
wisps = []
for i, (f0, yc, sz, v, al, near) in enumerate(TRACKS):
    hh = int(H * sz)
    ww = int(hh * R.uniform(2.2, 3.2))
    img = wisp(ww, hh, 100 + i)
    blur = v * 0.5 * (1.3 if near else 1.0)
    img = np.concatenate([hblur(img[..., :3] * img[..., 3:], blur), hblur(img[..., 3:], blur)], -1)
    if near:  # close to the lens: very soft
        pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), 'RGBA').filter(ImageFilter.GaussianBlur(H * 0.03))
        img = np.asarray(pil).astype(np.float32) / 255
    wisps.append(dict(f0=f0, y=int(yc * H - hh / 2), v=v, al=al, near=near, img=img))


def over(dst, src_premul, x, y, alpha_scale):
    """Composite a premultiplied RGBA layer onto dst at (x, y), clipped."""
    h, w = src_premul.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = src_premul[y0 - y:y1 - y, x0 - x:x1 - x]
    a = s[..., 3:] * alpha_scale
    dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - a) + s[..., :3] * alpha_scale


# a smooth hand-held shake
sx = np.cumsum(rnd.normal(0, 0.6, N)); sy = np.cumsum(rnd.normal(0, 0.5, N))
sx -= np.linspace(sx[0], sx[-1], N); sy -= np.linspace(sy[0], sy[-1], N)
M = 10  # margin around the frame for the shake
for f in range(F0, F1 + 1):
    i = f - 1
    # parallax: the cloud tops near the bottom of the frame are closer, so they slide past faster
    # and streak longer than the horizon. Bands of rows, each with its own speed; the mirrored plate
    # tiles, so the index can wrap.
    bg = np.empty((H + 2 * M, W + 2 * M, 3), np.float32)
    rows = np.arange(Y0 - M, Y0 + H + M)
    for b0 in range(0, H + 2 * M, 4):
        r = rows[b0:b0 + 4]
        d = 1 + 2.2 * min(1.0, max(0.0, (r.mean() - HOR) / (Y0 + H - HOR)))
        cols = (int(8 + i * PAN * d) + np.arange(-int(PAN * d * 3), W + 2 * M + int(PAN * d * 3))) % PW
        band = P[r][:, cols]
        L = int(PAN * d * 2.6)
        k = int(PAN * d * 3)
        bg[b0:b0 + len(r)] = hblur(band, L)[:, k:k + W + 2 * M]
    bg = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255   # no band edges
    for wv in wisps:
        if wv['near']:
            continue
        wx = int(W + 2 * M - (i - wv['f0']) * wv['v'])
        over(bg, wv['img'], wx, wv['y'] + M, wv['al'])
    frame = bg
    bp = os.path.join(bird_dir, f'b{f:03d}.png')
    if os.path.exists(bp):
        # as Ikki surges at the end, the layer grows back to full frame so the bird leaves through
        # the frame's edge, never through the edge of its own render
        u = min(1.0, max(0.0, (f - 64) / 14))
        sb = BIRD + (1 - BIRD) * u * u * (3 - 2 * u)
        bw, bh = round(W * sb), round(H * sb)
        b = np.asarray(Image.open(bp).convert('RGBA').resize((bw, bh), Image.LANCZOS)).astype(np.float32) / 255
        prem = np.concatenate([b[..., :3] * b[..., 3:], b[..., 3:]], -1)
        over(frame, prem, M + (W - bw) // 2, M + (H - bh) // 2, 1.0)
    for wv in wisps:
        if not wv['near']:
            continue
        wx = int(W + 2 * M - (i - wv['f0']) * wv['v'])
        over(frame, wv['img'], wx, wv['y'] + M, wv['al'])
    # the last half second: into a cloud
    k = max(0.0, (f - 76) / 12)
    if k > 0:
        fog = np.array([0.93, 0.955, 0.975], np.float32)
        frame = frame * (1 - min(1, k ** 1.6)) + fog * min(1, k ** 1.6)
    ox, oy = int(round(sx[i])), int(round(sy[i]))
    frame = frame[M + oy:M + oy + H, M + ox:M + ox + W]
    lum_noise = rnd.normal(0, 0.011, (H, W, 1)).astype(np.float32)
    frame = np.clip(frame + lum_noise, 0, 1)
    Image.fromarray((frame * 255 + 0.5).astype(np.uint8)).save(os.path.join(out_dir, f'f{f:03d}.png'))
    print('frame', f, flush=True)
