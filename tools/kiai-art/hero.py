"""The landing hero: Kiai's kaya board, mid-game (a real game, 34 moves), on a pale stone table
high above the cloud sea. Rendered on a transparent background with the same sun and sky as the
cloud plate; compose.py lays it over the out-of-focus plate.
Usage: python hero.py OUT.png W H SAMPLES [VIEW]   (VIEW: wide | macro | plate)
`plate` is the wide shot with the table only: the site draws the board, stones and bowls live in
3D on top (kami/src/three), with this camera (written next to OUT as JSON)."""
import sys, os, json, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kl import reset, world_sky, sun, camera, plane, lin, nodes, principled, stone
from scene import board, bowl, pt, BT

out, W, H, S = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
view = sys.argv[5] if len(sys.argv) > 5 else 'wide'
sc = reset(samples=S, res=(W, H), transparent=True, denoise=(view != 'macro'))   # the close-up keeps its grain: no denoiser
sc.view_settings.exposure = -1.15
sc.view_settings.look = 'AgX - Punchy'
SUN_EL, SUN_AZ = 21, 250          # same sky as clouds.py
world_sky(sun_elev_deg=SUN_EL, sun_rot_deg=SUN_AZ, strength=0.3)
sun(elev_deg=SUN_EL, azim_deg=SUN_AZ - 90, energy=3.2, angle_deg=0.55)

# honed white marble tabletop: faint grey veins, soft mottling, a fine bump so it is not a flat plane
m = bpy.data.materials.new('marble'); nt = nodes(m)
p, _ = principled(nt, **{'Roughness': 0.42, 'Specular IOR Level': 0.45, 'Coat Weight': 0.15, 'Coat Roughness': 0.25})
tc = nt.nodes.new('ShaderNodeTexCoord')
mot = nt.nodes.new('ShaderNodeTexNoise'); mot.inputs['Scale'].default_value = 7; mot.inputs['Detail'].default_value = 8
nt.links.new(tc.outputs['Object'], mot.inputs['Vector'])
vein = nt.nodes.new('ShaderNodeTexWave'); vein.wave_type = 'BANDS'; vein.bands_direction = 'DIAGONAL'
vein.inputs['Scale'].default_value = 1.4; vein.inputs['Distortion'].default_value = 6; vein.inputs['Detail'].default_value = 6
vein.inputs['Detail Scale'].default_value = 1.6; vein.inputs['Detail Roughness'].default_value = 0.6
nt.links.new(tc.outputs['Object'], vein.inputs['Vector'])
vr = nt.nodes.new('ShaderNodeMapRange'); vr.inputs['From Min'].default_value = 0.78; vr.inputs['From Max'].default_value = 1.0; vr.interpolation_type = 'SMOOTHERSTEP'
nt.links.new(vein.outputs['Fac'], vr.inputs['Value'])
base = nt.nodes.new('ShaderNodeMix'); base.data_type = 'RGBA'
base.inputs['A'].default_value = lin('#e9e8e4'); base.inputs['B'].default_value = lin('#dddcd8')
nt.links.new(mot.outputs['Fac'], base.inputs['Factor'])
veined = nt.nodes.new('ShaderNodeMix'); veined.data_type = 'RGBA'
nt.links.new(vr.outputs[0], veined.inputs['Factor']); nt.links.new(base.outputs['Result'], veined.inputs['A'])
veined.inputs['B'].default_value = lin('#cfd1d4')   # soft cloudy veins, not cracks
nt.links.new(veined.outputs['Result'], p.inputs['Base Color'])
fine = nt.nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 900; fine.inputs['Detail'].default_value = 2
nt.links.new(tc.outputs['Object'], fine.inputs['Vector'])
bmp = nt.nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = 0.04
nt.links.new(fine.outputs['Fac'], bmp.inputs['Height']); nt.links.new(bmp.outputs['Normal'], p.inputs['Normal'])
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.0, -0.55, -0.02))
table = bpy.context.active_object
table.scale = (2.4, 1.9, 0.04)   # far edge just behind the board: beyond it, the drop to the clouds
bpy.ops.object.transform_apply(scale=True)
bv = table.modifiers.new('bevel', 'BEVEL'); bv.width = 0.004; bv.segments = 3
table.data.materials.append(m)

if view != 'plate':
    # board, turned a little for a three-quarter view
    pos = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pos.json')))   # the landing's game, 34 moves
    root = bpy.data.objects.new('set', None); bpy.context.scene.collection.objects.link(root)
    b = board(contrast=1.8 if view == 'wide' else 3.6)   # up close the sheen flattens the grain: draw it stronger
    rnd = random.Random(5)
    mats = {}
    for i, (gtp, c) in enumerate(pos['stones']):
        x, y = pt(gtp)
        s = stone(f'st{i}', 'b' if c == 1 else 'w', seed=i * 7 + 1, mats=mats)
        s.location = (x + rnd.uniform(-0.0011, 0.0011), y + rnd.uniform(-0.0011, 0.0011), BT + s.location.z)
        s.parent = root
    b.parent = root
    for ob in bpy.data.objects:
        if ob.name == 'lines':
            ob.parent = root
    # both bowls on the right, so the left of the frame stays open sky and cloud for the page's words
    w_bowl = bowl((0.17, 0.335, 0), 'w', n=120, seed=2, lid_at=None, mats=mats)
    b_bowl = bowl((0.385, 0.13, 0), 'b', n=120, seed=3, lid_at=None, mats=mats)
    root.rotation_euler.z = math.radians(-9)

if view in ('wide', 'plate'):
    # 39 mm, 16 degrees above the board: board low and right, the cloud sea and sky beyond the edge
    cam = camera((-0.40, -1.16, 0.36), (-0.11, 0.52, 0.12), lens=39, dof={'f': 4.0, 'dist': 1.2})
else:
    # close on the stones around Q10, where the example question is asked
    a = math.radians(-9)
    qx, qy = pt('Q10')
    tx, ty = qx * math.cos(a) - qy * math.sin(a), qx * math.sin(a) + qy * math.cos(a)
    cam = camera((tx - 0.10, ty - 0.17, 0.25), (tx, ty, BT + 0.004), lens=100)   # steep enough that the sky's sheen does not wash out the grain
    cd = cam.data
    cd.dof.use_dof = True
    cd.dof.focus_distance = (cam.location - __import__('mathutils').Vector((tx, ty + 0.01, BT))).length
    cd.dof.aperture_fstop = 3.2
if view == 'plate':
    # the camera the live board must match (Blender: Z up, metres; lens over a 36 mm sensor width)
    json.dump({'loc': list(cam.location), 'target': [-0.11, 0.52, 0.12], 'lens': 39, 'sensor': 36, 'width': W, 'height': H,
               'sun': {'elev': SUN_EL, 'azim': SUN_AZ - 90}, 'board_rot_z': -9, 'table_top': 0.0},
              open(os.path.splitext(out)[0] + '.json', 'w'), indent=1)
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
