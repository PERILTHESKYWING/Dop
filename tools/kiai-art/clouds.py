"""The sky plate: a sea of cumulus seen from above it, under a physical sky. Used behind Ikki's
flight (panned and streaked) and, out of focus, behind the hero board.
Usage: python clouds.py OUT.png W H SAMPLES"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kl import reset, world_sky, sun, camera, lin, nodes

out, W, H, S = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
sc = reset(samples=S, res=(W, H))
sc.cycles.volume_bounces = 6
sc.cycles.max_bounces = 8
sc.cycles.volume_step_rate = 4.0
sc.cycles.volume_max_steps = 256
sc.view_settings.exposure = -1.0
SUN_EL, SUN_AZ = 21, 250
world_sky(sun_elev_deg=SUN_EL, sun_rot_deg=SUN_AZ, strength=0.3)
sun(elev_deg=SUN_EL, azim_deg=SUN_AZ - 90, energy=3.2, angle_deg=0.55)


def cloud_material(name, base, top, scale_m, cover):
    """Billowy cumulus: noise density that thins with height, so only the bumps reach the top."""
    m = bpy.data.materials.new(name)
    nt = nodes(m)
    L = nt.links
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = lin('#ffffff')
    vol.inputs['Anisotropy'].default_value = 0.45
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Generated'], sep.inputs[0])
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / scale_m,) * 3
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = 6.0; n.inputs['Roughness'].default_value = 0.55; n.inputs['Lacunarity'].default_value = 2.1
    L.new(mp.outputs[0], n.inputs['Vector'])
    # h: 0 at the bottom of the box, 1 at the top
    # widen the noise's narrow spread around 0.5 so the billows reach very different heights
    wide = nt.nodes.new('ShaderNodeMapRange'); wide.inputs['From Min'].default_value = 0.3; wide.inputs['From Max'].default_value = 0.7
    wide.clamp = False
    L.new(n.outputs['Fac'], wide.inputs['Value'])
    hcut = nt.nodes.new('ShaderNodeMath'); hcut.operation = 'MULTIPLY_ADD'; hcut.inputs[1].default_value = 1.0
    hcut.inputs[2].default_value = 1 - cover - 0.3
    L.new(sep.outputs['Z'], hcut.inputs[0])
    d = nt.nodes.new('ShaderNodeMath'); d.operation = 'SUBTRACT'
    L.new(wide.outputs[0], d.inputs[0]); L.new(hcut.outputs[0], d.inputs[1])
    dens = nt.nodes.new('ShaderNodeMapRange'); dens.inputs['From Min'].default_value = 0.0; dens.inputs['From Max'].default_value = 0.05
    dens.inputs['To Max'].default_value = 0.06
    L.new(d.outputs[0], dens.inputs['Value'])
    L.new(dens.outputs[0], vol.inputs['Density'])
    o = nt.nodes.new('ShaderNodeOutputMaterial'); L.new(vol.outputs[0], o.inputs['Volume'])
    return m


def box(name, loc, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)   # object coordinates in metres, for the noise
    ob.data.materials.append(mat)
    return ob


# the cloud sea: 700 m below, 26 x 14 km, tops up to ~500 m thick
box('sea', (0, 9000, -450), (30000, 19000, 500), cloud_material('sea', 0, 0, 650, 0.5))
# a line of taller cumulus far off
box('towers', (2500, 12000, -100), (16000, 3000, 1400), cloud_material('towers', 0, 0, 700, 0.45))

camera((0, 0, 0), (0, 1000, -30), lens=24)
bpy.context.scene.camera.data.clip_end = 60000
bpy.context.scene.render.filepath = out
bpy.ops.render.render(write_still=True)
