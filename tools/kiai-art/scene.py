"""The Kiai set: a 2-sun table kaya board with lacquered lines, slate and shell stones, two bowls."""
import math
import os
import tempfile
import random
import bpy
from kl import lin, kaya_material, slate_material, shell_material, lathe, stone, plane, nodes, principled, ramp

SX, SY = 0.022, 0.0237           # line spacing across / along (real boards are a touch longer)
BW, BL, BT = 0.424, 0.454, 0.06   # board width, length, thickness
COLS = 'ABCDEFGHJKLMNOPQRST'

# A natural opening (AI-era 3-3 joseki in two corners), Black to play.
OPENING = ['Q16', 'D16', 'Q4', 'D4', 'C17', 'D17', 'C16', 'C15', 'B15', 'B14', 'B16', 'C13',
           'C3', 'D3', 'C4', 'C5', 'B5', 'B6', 'B4', 'C7', 'R10', 'O17']


def pt(name):
    c = COLS.index(name[0])
    r = int(name[1:]) - 1
    return ((c - 9) * SX, (r - 9) * SY)


def grid_image(px=4096):
    """Alpha image of the lines and star points for the board's top face (UV 0..1)."""
    from PIL import Image, ImageDraw
    W, H = px, int(px * BL / BW)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = W / BW  # pixels per metre
    lw = max(2, int(0.0009 * k))
    ox, oy = (BW - 18 * SX) / 2, (BL - 18 * SY) / 2
    for i in range(19):
        x = (ox + i * SX) * k
        d.line([(x, oy * k), (x, (oy + 18 * SY) * k)], fill=(0, 0, 0, 255), width=lw)
        y = (oy + i * SY) * k
        d.line([(ox * k, y), ((ox + 18 * SX) * k, y)], fill=(0, 0, 0, 255), width=lw)
    # the outer frame is drawn a little heavier on real boards
    d.rectangle([ox * k - lw, oy * k - lw, (ox + 18 * SX) * k + lw, (oy + 18 * SY) * k + lw], outline=(0, 0, 0, 255), width=lw + 1)
    r = 0.002 * k
    for cx in (3, 9, 15):
        for cy in (3, 9, 15):
            x, y = (ox + cx * SX) * k, (oy + cy * SY) * k
            d.ellipse([x - r, y - r, x + r, y + r], fill=(0, 0, 0, 255))
    img = img.transpose(Image.FLIP_TOP_BOTTOM)
    path = os.path.join(tempfile.gettempdir(), 'kiai-grid.png')
    img.save(path)
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    return im


def lines_material(img):
    mat = bpy.data.materials.new('lacquer')
    nt = nodes(mat)
    L = nt.links
    p, out = principled(nt, **{'Base Color': lin('#1a120c'), 'Roughness': 0.55})   # rough enough to stay dark at grazing angles
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; tx.interpolation = 'Cubic'
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    L.new(tx.outputs['Alpha'], mix.inputs[0]); L.new(tr.outputs[0], mix.inputs[1]); L.new(p.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs[0])
    return mat


def board(at=(0, 0, 0), contrast=1.8):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(at[0], at[1], at[2] + BT / 2))
    b = bpy.context.active_object
    b.name = 'board'
    b.scale = (BW, BL, BT)
    bpy.ops.object.transform_apply(scale=True)
    bev = b.modifiers.new('bevel', 'BEVEL'); bev.width = 0.0018; bev.segments = 4
    b.data.materials.append(kaya_material('kaya_board', scale=1.0, contrast=contrast))
    b.data.materials.append(kaya_material('kaya_side', scale=1.0, tone=0.25, horizontal=True))   # sides: darker, long grain
    for poly in b.data.polygons:
        poly.use_smooth = True
        poly.material_index = 0 if poly.normal.z > 0.5 else 1
    lines = plane('lines', BW, BL, lines_material(grid_image()), loc=(at[0], at[1], at[2] + BT + 0.00006))
    return b


def bowl_material():
    """Turned mulberry: reddish brown, grain running across the bowl, deep lacquer gloss."""
    mat = bpy.data.materials.new('bowlwood')
    nt = nodes(mat)
    L = nt.links
    p, _ = principled(nt, **{'Roughness': 0.3, 'Coat Weight': 0.8, 'Coat Roughness': 0.06})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (9, 2.5, 9)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Z'
    w.inputs['Scale'].default_value = 3.2; w.inputs['Distortion'].default_value = 2.2; w.inputs['Detail'].default_value = 4
    w.inputs['Detail Scale'].default_value = 1.2
    L.new(mp.outputs[0], w.inputs['Vector'])
    r = ramp(nt, [(0, '#5a2a12'), (0.45, '#4c220e'), (0.7, '#633016'), (1, '#401c0b')])
    L.new(w.outputs['Fac'], r.inputs[0]); L.new(r.outputs['Color'], p.inputs['Base Color'])
    return mat


BOWL = [(0.0, 0.0), (0.040, 0.0), (0.050, 0.004), (0.060, 0.014), (0.067, 0.03), (0.069, 0.045), (0.066, 0.06),
        (0.060, 0.072), (0.0565, 0.0765), (0.053, 0.0765), (0.0525, 0.072), (0.058, 0.06), (0.0605, 0.045),
        (0.059, 0.03), (0.053, 0.018), (0.04, 0.011), (0.0, 0.009)]
LID = [(0.0, 0.03), (0.03, 0.028), (0.05, 0.02), (0.06, 0.01), (0.0645, 0.002), (0.0645, 0.0), (0.058, 0.0),
       (0.0575, 0.004), (0.045, 0.014), (0.025, 0.02), (0.0, 0.022)]


def bowl(at, color, n=150, seed=1, with_lid=True, lid_at=None, mats={}):
    m = mats.setdefault('bowl', bowl_material())
    b = lathe(f'bowl_{color}', BOWL, 128)
    b.location = at
    b.data.materials.append(m)
    rnd = random.Random(seed)
    # a heap of stones: layered rings, randomly tilted, dome on top
    k = 0
    for layer in range(8):
        z = 0.013 + layer * 0.0075
        rmax = min(0.050, 0.044 + layer * 0.004) - max(0, layer - 5) * 0.014
        ring_n = int(10 + rmax * 260)
        for i in range(ring_n):
            if k >= n:
                break
            a = rnd.uniform(0, math.tau)
            rr = rmax * math.sqrt(rnd.uniform(0.0, 1.0))
            s = stone(f'{color}heap{k}', color, seed=k + seed * 100)
            s.location = (at[0] + rr * math.cos(a), at[1] + rr * math.sin(a), at[2] + z + rnd.uniform(0, 0.003))
            s.rotation_euler = (rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, math.tau))
            k += 1
    if with_lid and lid_at is not None:
        lid = lathe(f'lid_{color}', LID, 128)
        lid.location = lid_at
        lid.rotation_euler = (math.pi, 0, 0)  # upturned, holding captures
        lid.location.z += 0.03
        lid.data.materials.append(m)
    return b


def stones_on_board(moves, at=(0, 0, 0), seed=7):
    rnd = random.Random(seed)
    out = []
    for i, mv in enumerate(moves):
        x, y = pt(mv)
        color = 'b' if i % 2 == 0 else 'w'
        s = stone(f'mv{i}', color, seed=i * 13 + seed)
        # real stones never sit exactly on the point
        s.location = (at[0] + x + rnd.uniform(-0.0012, 0.0012), at[1] + y + rnd.uniform(-0.0012, 0.0012), at[2] + BT + s.location.z)
        out.append(s)
    return out
