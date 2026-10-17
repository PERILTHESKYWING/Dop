"""Quick kaya swatches for tuning: top-down patches with the app's light. Prints mean colour and
grain strength (std of column means; the grain runs down the columns).
Usage: python woodtest.py OUT_DIR"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import numpy as np
from kl import reset, world_color, sun, camera, plane, kaya_material
out = sys.argv[1]
TRIES = json.loads(os.environ.get('TRIES', '[{}]'))
for i, t in enumerate(TRIES):
    sc = reset(samples=12, res=(384, 384), denoise=False)
    sc.view_settings.exposure = t.pop('exposure', -0.35)
    if 'view' in t:
        sc.view_settings.view_transform = t.pop('view'); sc.view_settings.look = 'None'
    world_color('#eef3f8', 0.75)
    sun(elev_deg=52, azim_deg=135, energy=2.6, angle_deg=22)
    plane('wood', 0.5, 0.5, kaya_material('k', **t))
    camera((0, 0, 1.0), (0, 0, 0), ortho=0.11)
    p = os.path.join(out, f't{i}.png')
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    a = np.asarray(bpy.data.images.load(p).pixels[:]).reshape(384, 384, 4)[..., :3] * 255
    print('TRY', i, 'mean', a.reshape(-1, 3).mean(0).round(), 'grain', a.mean(axis=(0, 2)).std().round(2))
