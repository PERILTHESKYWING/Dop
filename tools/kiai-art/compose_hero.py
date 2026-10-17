"""Lay the hero render (transparent background) over the cloud plate, defocused the way an 85 mm
lens at f/4 would see clouds far below, plus light grain. Writes the wide and a tall crop.
Usage: python compose_hero.py HERO.png PLATE.png OUT.webp [TALL_OUT.webp]"""
import sys
import numpy as np
from PIL import Image, ImageFilter

hero = Image.open(sys.argv[1]).convert('RGBA')
plate = Image.open(sys.argv[2]).convert('RGB')
W, H = hero.size
# match the plate's horizon and angular scale to the hero camera (39 mm, 8 degrees down at the
# centre) from the plate's own camera (24 mm, 1.7 degrees down); then defocus it
import math
HERO_F, HERO_PITCH, PLATE_F, PLATE_PITCH = 39, math.atan2(0.24, 1.70), 24, math.atan2(30, 1000)
s = (W / 36 * HERO_F) / (plate.width / 36 * PLATE_F)          # plate px -> hero px
pw, ph = round(plate.width * s), round(plate.height * s)
plate = plate.resize((pw, ph), Image.LANCZOS)
hor_plate = ph / 2 - math.tan(PLATE_PITCH) * (plate.width / 36 * PLATE_F) * s
hor_hero = H / 2 - math.tan(HERO_PITCH) * (W / 36 * HERO_F)
y0 = round(hor_plate - hor_hero)
x0 = (pw - W) // 2
bg = plate.crop((x0, y0, x0 + W, y0 + H)).filter(ImageFilter.GaussianBlur(W * 0.0035))
bg.paste(hero, (0, 0), hero)
a = np.asarray(bg).astype(np.float32)
a += np.random.default_rng(3).normal(0, 2.2, a.shape[:2])[..., None]
img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
img.save(sys.argv[3], 'WEBP', quality=86, method=6)
if len(sys.argv) > 4:
    # phones: a tall crop centred on the board
    th = H
    tw = int(th * 0.62)
    cx = int(W * 0.70)
    img.crop((cx - tw // 2, 0, cx + tw // 2, th)).save(sys.argv[4], 'WEBP', quality=84, method=6)
