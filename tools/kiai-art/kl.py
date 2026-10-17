"""Shared Blender helpers for Kiai's rendered art (run with Blender's Python, `pip install bpy`).

Everything is procedural: the kaya grain, slate and shell stones, bowls and sky are built here,
so the art can be re-rendered without any downloaded textures.
"""
import math
import bpy
import bmesh
from mathutils import Vector


def lin(hexstr, a=1.0):
    """sRGB hex -> linear RGBA, as Blender colour sockets expect."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


def reset(samples=64, res=(1024, 1024), transparent=False, denoise=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 8
    sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    sc.render.image_settings.color_depth = '8'
    return sc


def nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt


def principled(nt, **kw):
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    for k, v in kw.items():
        p.inputs[k].default_value = v
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(p.outputs[0], out.inputs[0])
    return p, out


def ramp(nt, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    while len(els) > len(stops):
        els.remove(els[-1])
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = lin(col) if isinstance(col, str) else col
    return r


# honey amber, matched by eye and by mean colour to XIAO's reference board (critique round 2)
KAYA = [(0.0, '#cf9248'), (0.3, '#be7c3b'), (0.6, '#a9682e'), (1.0, '#7f4719')]


def kaya_material(name='kaya', scale=1.0, lines_image=None, tone=0.0, contrast=1.8, horizontal=False, palette=None):
    """Masame kaya: fine straight grain along the board's length, pale gold, oiled satin finish.
    Object coordinates are metres; the grain runs along Y. `tone` darkens (+) or lightens (-),
    `contrast` scales the grain. `horizontal` lays the lines along X and Y with Z across them:
    the sides of a masame board, where the long grain shows as horizontal stripes."""
    mat = bpy.data.materials.new(name)
    nt = nodes(mat)
    L = nt.links
    p, out = principled(nt, **{'Roughness': 0.34, 'Coat Weight': 0.3, 'Coat Roughness': 0.2, 'Specular IOR Level': 0.45})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale * 0.06, scale)  # stretch along Y: straight grain
    if horizontal:
        mp.inputs['Scale'].default_value = (scale * 0.06, scale * 0.06, scale)
        mp.inputs['Rotation'].default_value = (0.0, math.radians(90), 0.0)   # bands across Z
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    # slow wander of the grain lines
    warp = nt.nodes.new('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 0.9
    warp.inputs['Detail'].default_value = 3.0
    L.new(mp.outputs[0], warp.inputs['Vector'])
    # a large, slow offset across the grain squeezes and spreads the lines, so their spacing never repeats
    mix = nt.nodes.new('ShaderNodeVectorMath'); mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = (0.03, 0.0, 0.0)
    L.new(warp.outputs['Color'], mix.inputs[0]); L.new(mp.outputs[0], mix.inputs[2])
    # fine growth lines (~0.7 mm apart) and wider bands (latewood clusters)
    fine = nt.nodes.new('ShaderNodeTexWave'); fine.wave_type = 'BANDS'; fine.bands_direction = 'X'
    fine.inputs['Scale'].default_value = 420.0
    fine.inputs['Distortion'].default_value = 0.5
    fine.inputs['Detail'].default_value = 2.0
    fine.inputs['Detail Scale'].default_value = 0.6
    fine.wave_profile = 'SAW'
    L.new(mix.outputs[0], fine.inputs['Vector'])
    # wider light and dark bands of uneven width: noise stretched along the grain, not a repeating wave
    wide = nt.nodes.new('ShaderNodeTexNoise')
    wide.inputs['Scale'].default_value = 34.0
    wide.inputs['Detail'].default_value = 6.0
    wide.inputs['Roughness'].default_value = 0.62
    L.new(mix.outputs[0], wide.inputs['Vector'])
    blot = nt.nodes.new('ShaderNodeTexNoise')
    blot.inputs['Scale'].default_value = 1.6
    blot.inputs['Detail'].default_value = 4.0
    L.new(tc.outputs['Object'], blot.inputs['Vector'])
    # combine: fine lines sharpened, modulated by the wide bands
    sharp = nt.nodes.new('ShaderNodeMath'); sharp.operation = 'POWER'; sharp.inputs[1].default_value = 6.0
    L.new(fine.outputs['Fac'], sharp.inputs[0])
    wideR = ramp(nt, [(0.3, (0.0, 0, 0, 1)), (0.5, (0.4, 0, 0, 1)), (0.72, (1.0, 0, 0, 1))])
    L.new(wide.outputs['Fac'], wideR.inputs[0])
    m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY_ADD'
    L.new(sharp.outputs[0], m1.inputs[0]); m1.inputs[1].default_value = 0.2 * contrast
    sepw = nt.nodes.new('ShaderNodeSeparateColor'); L.new(wideR.outputs['Color'], sepw.inputs[0])
    m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'; m2.inputs[1].default_value = 0.34 * contrast
    L.new(sepw.outputs[0], m2.inputs[0])
    L.new(m2.outputs[0], m1.inputs[2])
    m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY_ADD'
    L.new(blot.outputs['Fac'], m3.inputs[0]); m3.inputs[1].default_value = 0.25
    L.new(m1.outputs[0], m3.inputs[2])
    m4 = nt.nodes.new('ShaderNodeMath'); m4.operation = 'ADD'; m4.inputs[1].default_value = tone + 0.03
    L.new(m3.outputs[0], m4.inputs[0])
    col = ramp(nt, palette or KAYA)
    L.new(m4.outputs[0], col.inputs[0])
    base = col.outputs['Color']
    if lines_image is not None:
        img = nt.nodes.new('ShaderNodeTexImage'); img.image = lines_image; img.interpolation = 'Cubic'
        uv = nt.nodes.new('ShaderNodeTexCoord')
        L.new(uv.outputs['UV'], img.inputs['Vector'])
        mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
        mixc.inputs['B'].default_value = lin('#141210')
        L.new(img.outputs['Alpha'], mixc.inputs['Factor'])
        L.new(base, mixc.inputs['A'])
        base = mixc.outputs['Result']
        # lacquer lines are glossier and a touch raised
        rmix = nt.nodes.new('ShaderNodeMix'); rmix.data_type = 'FLOAT'
        rmix.inputs['A'].default_value = 0.36; rmix.inputs['B'].default_value = 0.2
        L.new(img.outputs['Alpha'], rmix.inputs['Factor'])
        L.new(rmix.outputs['Result'], p.inputs['Roughness'])
    L.new(base, p.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.04; bump.inputs['Distance'].default_value = 0.0002
    L.new(sharp.outputs[0], bump.inputs['Height'])
    L.new(bump.outputs[0], p.inputs['Normal'])
    return mat


def slate_material():
    mat = bpy.data.materials.new('slate')
    nt = nodes(mat)
    L = nt.links
    p, _ = principled(nt, **{'Base Color': lin('#0b0c0f'), 'Roughness': 0.5, 'Specular IOR Level': 0.5,
                              'Coat Weight': 0.12, 'Coat Roughness': 0.3})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 900; n.inputs['Detail'].default_value = 6
    L.new(tc.outputs['Object'], n.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.08; bump.inputs['Distance'].default_value = 0.00003
    L.new(n.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs[0], p.inputs['Normal'])
    r = ramp(nt, [(0.3, (0.48, 0, 0, 1)), (0.7, (0.54, 0, 0, 1))])
    L.new(n.outputs['Fac'], r.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateColor'); L.new(r.outputs['Color'], sep.inputs[0])
    L.new(sep.outputs[0], p.inputs['Roughness'])
    return mat


def shell_material(seed=0):
    """Clamshell (hamaguri): warm white with faint growth stripes, polished, a little translucent."""
    import random
    rnd = random.Random(seed)
    mat = bpy.data.materials.new(f'shell{seed}')
    nt = nodes(mat)
    L = nt.links
    p, _ = principled(nt, **{'Roughness': 0.16, 'Specular IOR Level': 0.5, 'Subsurface Weight': 0.25,
                              'Subsurface Radius': (0.0012, 0.0010, 0.0008), 'Subsurface Scale': 1.0,
                              'Coat Weight': 0.35, 'Coat Roughness': 0.08})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    ang = rnd.uniform(0, math.tau)
    d = rnd.uniform(0.025, 0.045)
    mp.inputs['Location'].default_value = (d * math.cos(ang), d * math.sin(ang), 0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'RINGS'; w.rings_direction = 'SPHERICAL'
    w.inputs['Scale'].default_value = rnd.uniform(420, 560)
    w.inputs['Distortion'].default_value = 1.4    # higher reads as a cross-hatch up close
    w.inputs['Detail'].default_value = 2.0
    w.inputs['Detail Scale'].default_value = 0.4
    L.new(mp.outputs[0], w.inputs['Vector'])
    r = ramp(nt, [(0.0, '#f3efe5'), (0.55, '#f0eadf'), (0.85, '#e9e2d4'), (1.0, '#e1d8c6')])
    L.new(w.outputs['Fac'], r.inputs[0])
    L.new(r.outputs['Color'], p.inputs['Base Color'])
    return mat


def lathe(name, profile, segments=96):
    """Revolve a list of (radius, z) points around Z into a smooth closed mesh."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segments):
            a = i / segments * math.tau
            if r < 1e-6:
                ring.append(bm.verts.new((0, 0, z)))
                break
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(segments):
                bm.faces.new((a[0], b[i], b[(i + 1) % segments]))
        elif len(b) == 1:
            for i in range(segments):
                bm.faces.new((a[i], b[0], a[(i + 1) % segments]))
        else:
            for i in range(segments):
                bm.faces.new((a[i], a[(i + 1) % segments], b[(i + 1) % segments], b[i]))
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # outward normals
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    return ob


def stone_profile(diam=0.022, thick=0.0092, k=0.8, steps=40):
    """Double-convex stone: z = h * (1 - u^2)^k on each side (u = r / R), rounded rim.
    Centre of the top face first, round the rim, back to the centre of the bottom face."""
    R, h = diam / 2, thick / 2
    top = []
    for i in range(steps + 1):
        u = math.sin(i / steps * math.pi / 2)  # points crowd towards the rim, where it curves most
        top.append((R * u, h * max(0.0, 1 - u * u) ** k))
    bottom = [(r, -z) for (r, z) in reversed(top[:-1])]
    return top + bottom


def stone(name, color='b', seed=0, mats={}):
    diam, thick = (0.0223, 0.0086) if color == 'b' else (0.0220, 0.0088)
    ob = lathe(name, stone_profile(diam, thick))
    ob.location.z = thick / 2
    key = 'slate' if color == 'b' else f'shell{seed % 6}'
    if key not in mats:
        mats[key] = slate_material() if color == 'b' else shell_material(seed % 6)
    ob.data.materials.append(mats[key])
    ob.rotation_euler.z = (seed * 2.399) % math.tau
    return ob


def sun(elev_deg=55, azim_deg=135, energy=4.0, angle_deg=6.0, color='#fff6ea'):
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = energy
    ld.angle = math.radians(angle_deg)
    ld.color = lin(color)[:3]
    ob = bpy.data.objects.new('sun', ld)
    bpy.context.scene.collection.objects.link(ob)
    # direction the light travels: from azimuth/elevation toward origin
    el, az = math.radians(elev_deg), math.radians(azim_deg)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    return ob


def world_color(col='#dfe8f2', strength=0.8):
    w = bpy.data.worlds.new('world')
    bpy.context.scene.world = w
    nt = nodes(w)
    bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Color'].default_value = lin(col); bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def world_sky(sun_elev_deg=40, sun_rot_deg=200, strength=0.35, kind='MULTIPLE_SCATTERING', sun_disc=True):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    nt = nodes(w)
    sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = kind
    sky.sun_elevation = math.radians(sun_elev_deg)
    sky.sun_rotation = math.radians(sun_rot_deg)
    sky.sun_disc = sun_disc
    sky.altitude = 2000
    bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], out.inputs[0])
    return w, sky


def camera(loc, target, lens=50, ortho=None, dof=None):
    cd = bpy.data.cameras.new('cam')
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    cd.clip_start = 0.001
    cd.clip_end = 5000
    ob = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if dof:
        cd.dof.use_dof = True
        cd.dof.focus_distance = d.length if dof.get('dist') is None else dof['dist']
        cd.dof.aperture_fstop = dof.get('f', 2.8)
    bpy.context.scene.camera = ob
    return ob


def plane(name, sx, sy, mat=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0)], [], [(0, 1, 2, 3)])
    me.uv_layers.new(name='UVMap')
    uv = me.uv_layers[0].data
    for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv[i].uv = c
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if mat:
        me.materials.append(mat)
    return ob


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
