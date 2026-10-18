"""Kiai's board art for the app: a top-down kaya surface and stone sprites (stone, and its shadow).
Usage: python sprites.py OUT_DIR
Writes wood.png, b0..b3.png, w0..w5.png (stone only, transparent) and shadow.png (shadow only).
Lighting matches the app board: key light from the upper left, so shadows fall down-right."""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kl import reset, world_color, sun, camera, plane, kaya_material, stone

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
D = 0.0223                 # black stone diameter; the sprite is 1.25 stone diameters across
SPRITE = D * 1.25


def light():
    world_color('#eef3f8', 0.75)
    sun(elev_deg=52, azim_deg=135, energy=2.6, angle_deg=22)


def setup(res, transparent=True, samples=96, exposure=-0.35, denoise=True):
    sc = reset(samples=samples, res=res, transparent=transparent, denoise=denoise)
    sc.view_settings.exposure = exposure
    light()
    return sc


def save(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# 1) the wood: a 0.44 m square of kaya seen from straight above, evenly lit
if not os.path.exists(os.path.join(out, 'wood.png')):
    sc = setup((1536, 1536), transparent=False, samples=64, denoise=False)   # the denoiser smears the fine grain
    plane('wood', 0.5, 0.5, kaya_material('kaya_top'))
    camera((0, 0, 1.0), (0, 0, 0), ortho=0.44)
    save(os.path.join(out, 'wood.png'))

# 2) stones: transparent, no shadow; a hidden kaya floor still bounces warm light into them
for color, n in (('b', 4), ('w', 6)):
    for i in range(n):
        sc = setup((256, 256), exposure=-0.1)
        floor = plane('floor', 0.3, 0.3, kaya_material('kaya_floor'))
        floor.visible_camera = False
        floor.visible_shadow = False
        s = stone(f's{i}', color, seed=i * 7 + 3, mats={})  # each reset() empties the file
        s.rotation_euler.z = i * 1.3
        camera((0, 0, 0.5), (0, 0, 0), ortho=SPRITE)
        save(os.path.join(out, f'{color}{i}.png'))

# 3) the shadow alone (cast + contact), on a shadow catcher; twice the extent so the soft edge fits
sc = setup((256, 256), samples=128)
floor = plane('catcher', 0.3, 0.3, kaya_material('kaya_floor'))
floor.is_shadow_catcher = True
s = stone('s', 'b', mats={})
s.visible_camera = False
camera((0, 0, 0.5), (0, 0, 0), ortho=SPRITE * 2)
save(os.path.join(out, 'shadow.png'))
