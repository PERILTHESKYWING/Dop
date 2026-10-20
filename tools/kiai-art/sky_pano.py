"""The landing's sky: a full 360 x 180 degree panorama (equirectangular) of a sea of cumulus seen
from 200 m above its tops, under a physical sky with a low afternoon sun. The landing uses it
as the 3D scene's background and its light, so every camera angle sees the same sky.

Usage: python sky_pano.py OUT.png W SAMPLES      (W wide, W/2 tall; 4096 at 24 samples for the site)

The sun is in the picture (a small disc); its direction is also written next to OUT as JSON
(azimuth from +Y towards +X, elevation), so the site's sun light matches the clouds' shading.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kl import lin, nodes, reset, sun, world_sky

out, W, S = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sc = reset(samples=S, res=(W, W // 2))
sc.cycles.volume_bounces = 6
sc.cycles.max_bounces = 8
sc.cycles.volume_step_rate = 4.0
sc.cycles.volume_max_steps = 256
sc.view_settings.exposure = -1.0
SUN_EL, SUN_AZ = 16, 230
world_sky(sun_elev_deg=SUN_EL, sun_rot_deg=SUN_AZ, strength=0.3)
sun(elev_deg=SUN_EL, azim_deg=SUN_AZ - 90, energy=3.2, angle_deg=0.55)


def cloud_material(name, scale_m, cover):
    """Billowy cumulus: noise density that thins with height, so only the bumps reach the top."""
    m = bpy.data.materials.new(name)
    nt = nodes(m)
    L = nt.links
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = lin('#ffffff')
    vol.inputs['Anisotropy'].default_value = 0.45
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs[0])
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / scale_m,) * 3
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = 6.0
    n.inputs['Roughness'].default_value = 0.55
    n.inputs['Lacunarity'].default_value = 2.1
    L.new(mp.outputs[0], n.inputs['Vector'])
    wide = nt.nodes.new('ShaderNodeMapRange')
    wide.inputs['From Min'].default_value = 0.3
    wide.inputs['From Max'].default_value = 0.7
    wide.clamp = False
    L.new(n.outputs['Fac'], wide.inputs['Value'])
    hcut = nt.nodes.new('ShaderNodeMath')
    hcut.operation = 'MULTIPLY_ADD'
    hcut.inputs[1].default_value = 1.0
    hcut.inputs[2].default_value = 1 - cover - 0.3
    L.new(sep.outputs['Z'], hcut.inputs[0])
    d = nt.nodes.new('ShaderNodeMath')
    d.operation = 'SUBTRACT'
    L.new(wide.outputs[0], d.inputs[0])
    L.new(hcut.outputs[0], d.inputs[1])
    dens = nt.nodes.new('ShaderNodeMapRange')
    dens.inputs['From Min'].default_value = 0.0
    dens.inputs['From Max'].default_value = 0.05
    dens.inputs['To Max'].default_value = 0.06
    L.new(d.outputs[0], dens.inputs['Value'])
    L.new(dens.outputs[0], vol.inputs['Density'])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    L.new(vol.outputs[0], o.inputs['Volume'])
    return m


def box(name, loc, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)  # object coordinates in metres, for the noise
    ob.data.materials.append(mat)
    return ob


# the cloud sea all round, 700 m below at its base; a few lines of taller cumulus far off
box('sea', (0, 0, -450), (60000, 60000, 500), cloud_material('sea', 650, 0.5))
towers = cloud_material('towers', 700, 0.45)
for i, (ang, dist, w) in enumerate([(-20, 12000, 14000), (70, 15000, 12000), (160, 13000, 16000), (250, 16000, 10000)]):
    a = math.radians(ang)
    ob = box(f'towers{i}', (dist * math.sin(a), dist * math.cos(a), -100), (w, 3000, 1400), towers)
    ob.rotation_euler[2] = -a

cd = bpy.data.cameras.new('pano')
cd.type = 'PANO'
cd.panorama_type = 'EQUIRECTANGULAR'
cd.clip_start = 0.1
cd.clip_end = 80000
cam = bpy.data.objects.new('pano', cd)
bpy.context.scene.collection.objects.link(cam)
cam.location = (0, 0, 0)
cam.rotation_euler = (math.radians(90), 0, 0)  # level, facing +Y: the image centre is +Y
sc.camera = cam
sc.render.filepath = out
bpy.ops.render.render(write_still=True)

with open(os.path.splitext(out)[0] + '.json', 'w') as f:
    json.dump({'sun': {'elev': SUN_EL, 'azim': SUN_AZ}, 'centre': '+Y', 'note': 'Blender sky sun_rotation, degrees'}, f)
print('wrote', out)
