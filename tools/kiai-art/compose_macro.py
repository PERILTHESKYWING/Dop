"""Macro over a defocused patch of the cloud plate, 4:3 WebP."""
import sys
from PIL import Image, ImageFilter
m = Image.open(sys.argv[1]).convert('RGBA')
plate = Image.open(sys.argv[2]).convert('RGB')
W, H = m.size
# a high crop of the plate (sky over cloud tops), heavily defocused: a 100 mm lens at f/3.2 focused 30 cm away
crop = plate.crop((plate.width // 2 - 640, 120, plate.width // 2 + 640, 120 + 960)).resize((W, H), Image.LANCZOS)
bg = crop.filter(ImageFilter.GaussianBlur(W * 0.02))
bg.paste(m, (0, 0), m)
bg.save(sys.argv[3], 'WEBP', quality=84, method=6)
