"""Still of Ikki on a transparent background. Usage: python bird_test.py VIEW PHASE [OUT]"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import bpy, math
from kl import reset, world_sky, sun, camera, render
from bird import build, flap
v = sys.argv[1] if len(sys.argv) > 1 else 'side'
ph = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
out = sys.argv[3] if len(sys.argv) > 3 else f'bird_{v}.png'
sc = reset(samples=48, res=(960, 540), transparent=True)
world_sky(sun_elev_deg=30, sun_rot_deg=150, strength=0.3)
sun(elev_deg=30, azim_deg=60, energy=3.4, angle_deg=0.6)
root, wings = build()
flap(wings, ph)
sc.view_settings.exposure = -0.8
if v == 'side':
    camera((0.80, 0.10, 0.10), (0, 0.0, 0.0), lens=60)
elif v == 'front':
    camera((0.45, 0.55, 0.06), (0, 0.02, 0.0), lens=60)
elif v == 'below':
    camera((0.55, 0.30, -0.30), (0, 0.02, 0.0), lens=60)
else:
    camera((0.0, 0.0, 1.0), (0, 0.0, 0.0), lens=40)
render(out)
