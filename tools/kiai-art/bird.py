"""Ikki, a razorbill (Alca torda), built from lofted cross-sections. Units: metres.
The bird faces +Y, wings along X, Z up. Sleek, not fat: a 0.39 m bird with a 0.66 m span."""
import math
import bpy
import bmesh
from mathutils import Vector
from kl import lin, nodes, principled, ramp

# (y, half-width, half-height, z-centre) from tail tip to bill tip. Deep chest, thick neck, big
# blocky head, a short wedge tail and a deep, flat-sided bill: sleek, but an auk, not a torpedo.
BODY = [
    (-0.168, 0.002, 0.0010, 0.006),
    (-0.155, 0.012, 0.0032, 0.006),   # short wedge tail
    (-0.132, 0.021, 0.0085, 0.005),
    (-0.102, 0.030, 0.0195, 0.002),
    (-0.066, 0.0375, 0.0305, -0.001),
    (-0.030, 0.041, 0.0345, -0.003),  # deepest at the breast
    (0.005, 0.0395, 0.0335, -0.001),
    (0.034, 0.034, 0.0300, 0.003),
    (0.057, 0.0295, 0.0272, 0.007),   # thick neck
    (0.077, 0.0295, 0.0282, 0.009),   # big head
    (0.095, 0.0275, 0.0272, 0.010),
    (0.109, 0.0225, 0.0242, 0.010),
    (0.120, 0.0135, 0.0210, 0.009),   # bill base: deep and narrow
    (0.131, 0.0090, 0.0198, 0.007),
    (0.142, 0.0074, 0.0178, 0.005),
    (0.152, 0.0060, 0.0142, 0.002),
    (0.160, 0.0045, 0.0096, -0.002),
    (0.166, 0.0031, 0.0052, -0.006),  # hooked tip
    (0.169, 0.0012, 0.0018, -0.009),
]


def loft(name, sections, n=40, sq=2.2):
    """Superelliptic cross-sections (exponent sq) lofted along Y, capped."""
    bm = bmesh.new()
    rings = []
    for (y, hw, hh, zc) in sections:
        ring = []
        for i in range(n):
            a = i / n * math.tau
            c, s = math.cos(a), math.sin(a)
            x = hw * math.copysign(abs(c) ** (2 / sq), c)
            z = zc + hh * math.copysign(abs(s) ** (2 / sq), s)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
    return ob


def feather_bump(nt, scale=320.0, strength=0.22):
    """Fine overlapping-feather texture: stretched voronoi edges plus noise."""
    L = nt.links
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 0.45, 1.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    v = nt.nodes.new('ShaderNodeTexVoronoi'); v.feature = 'DISTANCE_TO_EDGE'; v.inputs['Scale'].default_value = scale * 0.25
    L.new(mp.outputs[0], v.inputs['Vector'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8
    L.new(mp.outputs[0], nz.inputs['Vector'])
    add = nt.nodes.new('ShaderNodeMath'); add.operation = 'MULTIPLY_ADD'; add.inputs[1].default_value = 0.6
    L.new(v.outputs['Distance'], add.inputs[0]); L.new(nz.outputs['Fac'], add.inputs[2])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = strength; bump.inputs['Distance'].default_value = 0.0004
    L.new(add.outputs[0], bump.inputs['Height'])
    return bump


def seg_dist(nt, pos, a, b):
    """Distance in the (y, z) plane from the shading point to segment a-b (object space)."""
    L = nt.links
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(pos, sep.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ'); L.new(sep.outputs['Y'], comb.inputs['X']); L.new(sep.outputs['Z'], comb.inputs['Y'])
    A = Vector((a[0], a[1], 0)); B = Vector((b[0], b[1], 0)); AB = B - A
    sub = nt.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; L.new(comb.outputs[0], sub.inputs[0]); sub.inputs[1].default_value = A
    dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; L.new(sub.outputs[0], dot.inputs[0]); dot.inputs[1].default_value = AB / AB.length_squared
    cl = nt.nodes.new('ShaderNodeClamp'); L.new(dot.outputs['Value'], cl.inputs['Value'])
    sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs[0].default_value = AB; L.new(cl.outputs[0], sc.inputs['Scale'])
    pa = nt.nodes.new('ShaderNodeVectorMath'); pa.operation = 'ADD'; L.new(sc.outputs[0], pa.inputs[0]); pa.inputs[1].default_value = A
    d = nt.nodes.new('ShaderNodeVectorMath'); d.operation = 'DISTANCE'; L.new(comb.outputs[0], d.inputs[0]); L.new(pa.outputs[0], d.inputs[1])
    return d.outputs['Value'], sep


BLACK, WHITE = '#1d1e21', '#e4e3de'   # sooty black plumage (albedo ~0.012) and white (~0.75)


def body_material():
    mat = bpy.data.materials.new('plumage')
    nt = nodes(mat)
    L = nt.links
    # matte: a broad specular lobe on black plumage reads as a pale plastic shell at grazing angles
    p, _ = principled(nt, **{'Roughness': 0.86, 'Sheen Weight': 0.04, 'Sheen Roughness': 0.5,
                              'Sheen Tint': (0.45, 0.47, 0.5, 1.0), 'Specular IOR Level': 0.04})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    pos = tc.outputs['Object']
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(pos, sep.inputs[0])
    # white underparts below a line that rises towards the tail; black from the upper breast forward.
    # The edge is broken up by noise so it reads as feathers, not paint.
    m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY_ADD'; m.inputs[1].default_value = 0.06; m.inputs[2].default_value = -0.007
    L.new(sep.outputs['Y'], m.inputs[0])
    jag = nt.nodes.new('ShaderNodeTexNoise'); jag.inputs['Scale'].default_value = 260; jag.inputs['Detail'].default_value = 4
    L.new(pos, jag.inputs['Vector'])
    jag2 = nt.nodes.new('ShaderNodeMath'); jag2.operation = 'MULTIPLY_ADD'; jag2.inputs[1].default_value = 0.004; jag2.inputs[2].default_value = -0.002
    L.new(jag.outputs['Fac'], jag2.inputs[0])
    edge = nt.nodes.new('ShaderNodeMath'); edge.operation = 'ADD'; L.new(m.outputs[0], edge.inputs[0]); L.new(jag2.outputs[0], edge.inputs[1])
    diff = nt.nodes.new('ShaderNodeMath'); diff.operation = 'SUBTRACT'
    L.new(edge.outputs[0], diff.inputs[0]); L.new(sep.outputs['Z'], diff.inputs[1])   # >0 below the edge
    belly = nt.nodes.new('ShaderNodeMapRange'); belly.inputs['From Min'].default_value = -0.0008; belly.inputs['From Max'].default_value = 0.0008
    L.new(diff.outputs[0], belly.inputs['Value'])
    # the white ends in a point on the upper breast
    neck = nt.nodes.new('ShaderNodeMapRange'); neck.inputs['From Min'].default_value = 0.05; neck.inputs['From Max'].default_value = 0.038
    L.new(sep.outputs['Y'], neck.inputs['Value'])
    white = nt.nodes.new('ShaderNodeMath'); white.operation = 'MULTIPLY'
    L.new(belly.outputs[0], white.inputs[0]); L.new(neck.outputs[0], white.inputs[1])
    # the fine white line from the eye to the top of the bill base, and the white band across the bill
    d_eye, _ = seg_dist(nt, pos, (0.092, 0.0185), (0.121, 0.0275))
    eye = nt.nodes.new('ShaderNodeMapRange'); eye.inputs['From Min'].default_value = 0.0011; eye.inputs['From Max'].default_value = 0.0006
    L.new(d_eye, eye.inputs['Value'])
    band = nt.nodes.new('ShaderNodeMapRange'); band.inputs['From Min'].default_value = 0.0011; band.inputs['From Max'].default_value = 0.0006
    bd = nt.nodes.new('ShaderNodeMath'); bd.operation = 'ABSOLUTE'
    off = nt.nodes.new('ShaderNodeMath'); off.operation = 'SUBTRACT'; L.new(sep.outputs['Y'], off.inputs[0]); off.inputs[1].default_value = 0.149
    L.new(off.outputs[0], bd.inputs[0]); L.new(bd.outputs[0], band.inputs['Value'])
    w1 = nt.nodes.new('ShaderNodeMath'); w1.operation = 'MAXIMUM'; L.new(white.outputs[0], w1.inputs[0]); L.new(eye.outputs[0], w1.inputs[1])
    w2 = nt.nodes.new('ShaderNodeMath'); w2.operation = 'MAXIMUM'; L.new(w1.outputs[0], w2.inputs[0]); L.new(band.outputs[0], w2.inputs[1])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = lin(BLACK); mix.inputs['B'].default_value = lin(WHITE)
    L.new(w2.outputs[0], mix.inputs['Factor'])
    # the bill is smooth black horn: darker, glossier, no feathers
    billf = nt.nodes.new('ShaderNodeMapRange'); billf.inputs['From Min'].default_value = 0.116; billf.inputs['From Max'].default_value = 0.121
    L.new(sep.outputs['Y'], billf.inputs['Value'])
    billc = nt.nodes.new('ShaderNodeMix'); billc.data_type = 'RGBA'
    L.new(billf.outputs[0], billc.inputs['Factor']); L.new(mix.outputs['Result'], billc.inputs['A'])
    billc.inputs['B'].default_value = lin('#121314')
    keep = nt.nodes.new('ShaderNodeMix'); keep.data_type = 'RGBA'   # keep the band white on the bill
    L.new(band.outputs[0], keep.inputs['Factor']); L.new(billc.outputs['Result'], keep.inputs['A'])
    keep.inputs['B'].default_value = lin('#d9d8d2')
    L.new(keep.outputs['Result'], p.inputs['Base Color'])
    rough = nt.nodes.new('ShaderNodeMix'); rough.data_type = 'FLOAT'; rough.inputs['A'].default_value = 0.86; rough.inputs['B'].default_value = 0.3
    L.new(billf.outputs[0], rough.inputs['Factor']); L.new(rough.outputs['Result'], p.inputs['Roughness'])
    sheen = nt.nodes.new('ShaderNodeMix'); sheen.data_type = 'FLOAT'; sheen.inputs['A'].default_value = 0.04; sheen.inputs['B'].default_value = 0.0
    L.new(billf.outputs[0], sheen.inputs['Factor']); L.new(sheen.outputs['Result'], p.inputs['Sheen Weight'])
    bump = feather_bump(nt, scale=300.0, strength=0.3)
    L.new(bump.outputs[0], p.inputs['Normal'])
    return mat


def covert_material():
    """Wing coverts: sooty black above, white below, with a fine feather texture."""
    mat = bpy.data.materials.new('coverts')
    nt = nodes(mat)
    L = nt.links
    p, _ = principled(nt, **{'Roughness': 0.8, 'Sheen Weight': 0.05, 'Sheen Roughness': 0.5,
                              'Sheen Tint': (0.45, 0.47, 0.5, 1.0), 'Specular IOR Level': 0.06})
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    vt = nt.nodes.new('ShaderNodeVectorTransform'); vt.vector_type = 'NORMAL'; vt.convert_from = 'WORLD'; vt.convert_to = 'OBJECT'
    L.new(geo.outputs['True Normal'], vt.inputs[0])
    sepn = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(vt.outputs[0], sepn.inputs[0])
    under = nt.nodes.new('ShaderNodeMapRange'); under.inputs['From Min'].default_value = 0.15; under.inputs['From Max'].default_value = -0.15
    L.new(sepn.outputs['Z'], under.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = lin(BLACK); mix.inputs['B'].default_value = lin(WHITE)
    L.new(under.outputs[0], mix.inputs['Factor'])
    L.new(mix.outputs['Result'], p.inputs['Base Color'])
    bump = feather_bump(nt, scale=260.0, strength=0.35)
    L.new(bump.outputs[0], p.inputs['Normal'])
    return mat


def feather_material():
    """Flight feathers. UV u runs base -> tip, v across the vane. Sooty black above with a faint
    shaft and barb texture; dusky grey below. Object property 'tip' (0..1) whitens the tip
    (the razorbill's white trailing edge on the secondaries)."""
    mat = bpy.data.materials.new('flight')
    nt = nodes(mat)
    L = nt.links
    p, _ = principled(nt, **{'Roughness': 0.72, 'Sheen Weight': 0.05, 'Sheen Roughness': 0.5,
                              'Specular IOR Level': 0.07})
    tc = nt.nodes.new('ShaderNodeTexCoord')
    uv = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['UV'], uv.inputs[0])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    upper = nt.nodes.new('ShaderNodeMix'); upper.data_type = 'RGBA'
    upper.inputs['A'].default_value = lin(BLACK); upper.inputs['B'].default_value = lin('#76777b')
    L.new(geo.outputs['Backfacing'], upper.inputs['Factor'])
    # white tip on the secondaries
    tipprop = nt.nodes.new('ShaderNodeAttribute'); tipprop.attribute_type = 'OBJECT'; tipprop.attribute_name = 'tip'
    tipz = nt.nodes.new('ShaderNodeMapRange'); tipz.inputs['From Min'].default_value = 0.86; tipz.inputs['From Max'].default_value = 0.9
    L.new(uv.outputs['X'], tipz.inputs['Value'])
    tipw = nt.nodes.new('ShaderNodeMath'); tipw.operation = 'MULTIPLY'; L.new(tipz.outputs[0], tipw.inputs[0]); L.new(tipprop.outputs['Fac'], tipw.inputs[1])
    tipc = nt.nodes.new('ShaderNodeMix'); tipc.data_type = 'RGBA'
    L.new(tipw.outputs[0], tipc.inputs['Factor']); L.new(upper.outputs['Result'], tipc.inputs['A'])
    tipc.inputs['B'].default_value = lin(WHITE)
    # shaft: a thin paler line down the middle of the vane
    vs = nt.nodes.new('ShaderNodeMath'); vs.operation = 'SUBTRACT'; L.new(uv.outputs['Y'], vs.inputs[0]); vs.inputs[1].default_value = 0.42
    va = nt.nodes.new('ShaderNodeMath'); va.operation = 'ABSOLUTE'; L.new(vs.outputs[0], va.inputs[0])
    shaft = nt.nodes.new('ShaderNodeMapRange'); shaft.inputs['From Min'].default_value = 0.03; shaft.inputs['From Max'].default_value = 0.01
    L.new(va.outputs[0], shaft.inputs['Value'])
    sh = nt.nodes.new('ShaderNodeMix'); sh.data_type = 'RGBA'; sh.blend_type = 'ADD'
    sh.inputs['B'].default_value = (0.025, 0.025, 0.025, 1)
    L.new(shaft.outputs[0], sh.inputs['Factor']); L.new(tipc.outputs['Result'], sh.inputs['A'])
    L.new(sh.outputs['Result'], p.inputs['Base Color'])
    # barbs: fine slanted lines across the vane
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, 0.5)
    mp.inputs['Scale'].default_value = (60.0, 6.0, 1.0)
    L.new(tc.outputs['UV'], mp.inputs['Vector'])
    barb = nt.nodes.new('ShaderNodeTexWave'); barb.wave_type = 'BANDS'; barb.bands_direction = 'X'
    barb.inputs['Scale'].default_value = 3.0; barb.inputs['Distortion'].default_value = 3.0; barb.inputs['Detail'].default_value = 2.0
    L.new(mp.outputs[0], barb.inputs['Vector'])
    hb = nt.nodes.new('ShaderNodeMath'); hb.operation = 'MAXIMUM'; L.new(barb.outputs['Fac'], hb.inputs[0]); L.new(shaft.outputs[0], hb.inputs[1])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.2; bump.inputs['Distance'].default_value = 0.0002
    L.new(hb.outputs[0], bump.inputs['Height']); L.new(bump.outputs[0], p.inputs['Normal'])
    return mat


def feather_mesh(name, length, width, outer=0.55, cup=0.18, bend=0.06, pointed=False, nl=14, nw=6):
    """One flight feather lying in local XY: shaft along +Y from 0 to `length`, upper face +Z.
    The leading (outer, +X) vane is narrower; the vane is cupped and the tip bends down."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rows = []
    for i in range(nl + 1):
        t = i / nl
        grow = 0.4 + 0.6 * min(1.0, t / 0.22)
        k = max(0.0, (t - (0.55 if pointed else 0.72)) / (0.45 if pointed else 0.28))
        tipcut = (1 - k ** (1.6 if pointed else 2.0)) ** 0.5
        w = width * grow * tipcut
        w_in, w_out = w, w * outer
        row = []
        for j in range(nw + 1):
            v = j / nw
            x = -w_in + (w_in + w_out) * v
            xn = x / max(width, 1e-6)
            z = -cup * width * xn * xn - bend * length * t * t
            row.append((bm.verts.new((x, t * length, z)), t, v))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for j in range(nw):
            q = [ra[j], ra[j + 1], rb[j + 1], rb[j]]
            f = bm.faces.new([c[0] for c in q])
            for loop, c in zip(f.loops, q):
                loop[uvl].uv = (c[1], c[2])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-8)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    # make sure the faces point up (+Z)
    if sum(p.normal.z for p in me.polygons) < 0:
        me.flip_normals()
    return me


# covert panels, shoulder at x = 0: (x, leading-edge y, trailing-edge y, thickness). The flight
# feathers sit under their trailing edge.
WING = [
    (0.000, 0.030, -0.020, 0.013),
    (0.040, 0.033, -0.018, 0.010),
    (0.080, 0.035, -0.016, 0.008),
    (0.122, 0.035, -0.013, 0.006),   # wrist
    (0.150, 0.030, -0.010, 0.0045),
    (0.172, 0.024, -0.006, 0.0035),
    (0.190, 0.016, -0.002, 0.0025),
]
WRIST = 0.122


def wing_panel(name, side, stations, x0, nch=16, span_sub=4):
    """Loft a cambered, tapering wing panel between stations; x is relative to x0 (the joint).
    The trailing edge is scalloped: one rounded tip per flight feather."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    # densify spanwise by interpolation
    dense = []
    for a, b in zip(stations, stations[1:]):
        for k in range(span_sub):
            t = k / span_sub
            dense.append(tuple(a[i] + (b[i] - a[i]) * t for i in range(4)))
    dense.append(stations[-1])
    span = 0.3
    rows = []
    for (x, le, tey, th) in dense:
        tey += 0.0012 * abs(math.sin(x / 0.006 * math.pi)) * (1 if x > 0.01 else 0)   # covert tips
        top, bot = [], []
        for j in range(nch + 1):
            v = j / nch
            y = le + (tey - le) * v
            c = le - tey
            camber = 0.05 * c * math.sin(math.pi * v)
            t = th * math.sin(math.pi * v) ** 0.5 * (1 - 0.7 * v)
            top.append(bm.verts.new((side * (x - x0), y, camber + t / 2)))
            bot.append(bm.verts.new((side * (x - x0), y, camber - t / 2)))
        rows.append((top, bot, x / span))
    for (ta, ba, ua), (tb, bb, ub) in zip(rows, rows[1:]):
        for j in range(nch):
            for arr_a, arr_b, upper in ((ta, tb, True), (ba, bb, False)):
                q = [arr_a[j], arr_a[j + 1], arr_b[j + 1], arr_b[j]]
                if upper == (side > 0):
                    q.reverse()
                f = bm.faces.new(q)
                for loop in f.loops:
                    vv = loop.vert
                    if vv in arr_a:
                        loop[uvl].uv = (ua, arr_a.index(vv) / nch)
                    else:
                        loop[uvl].uv = (ub, arr_b.index(vv) / nch)
    for top, bot, _ in (rows[0], rows[-1]):
        for j in range(nch):
            try:
                bm.faces.new((top[j], top[j + 1], bot[j + 1], bot[j]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    sub = ob.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    return ob


# flight feathers. Secondaries hang from the arm (shoulder space), primaries fan from the hand
# (wrist space). (root x, length, angle back from the span axis in degrees, width)
SECONDARIES = [(0.010 + i * 0.0088, 0.046 + 0.006 * math.sin(i / 12 * math.pi), 90 - i * 2.2, 0.0085) for i in range(13)]
PRIMARIES = [(0.003 + i * 0.0062, ln, ang, 0.0082 - i * 0.00022) for i, (ln, ang) in enumerate([
    (0.060, 58), (0.068, 52), (0.077, 46), (0.087, 40), (0.097, 34),
    (0.107, 28), (0.116, 22), (0.123, 17), (0.127, 12), (0.124, 8)])]


def add_feather(name, parent, side, root, length, angle_back, width, mat, tip=0.0, pointed=False, seed=0, z=0.0):
    import random
    rnd = random.Random(seed)
    length *= rnd.uniform(0.97, 1.03)
    me = feather_mesh(name, length, width, pointed=pointed)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    ob.parent = parent
    ob['tip'] = tip
    a = math.radians(angle_back + rnd.uniform(-1.5, 1.5))
    d = (side * math.cos(a), -math.sin(a))        # direction in the wing plane
    ob.location = (side * root[0], root[1], z)
    ob.rotation_euler = (rnd.uniform(-0.03, 0.03), 0.0, math.atan2(-d[0], d[1]))
    if side < 0:
        ob.scale = (-1, 1, 1)
    return ob


def build(name='ikki'):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    body = loft(f'{name}_body', BODY)
    body.data.materials.append(body_material())
    body.parent = root
    cm, fm = covert_material(), feather_material()
    wings = {}
    for side, tag in ((1, 'R'), (-1, 'L')):
        sh = bpy.data.objects.new(f'{name}_shoulder{tag}', None)
        bpy.context.scene.collection.objects.link(sh)
        sh.parent = root
        sh.location = (side * 0.030, 0.012, 0.014)
        wr = bpy.data.objects.new(f'{name}_wrist{tag}', None)
        bpy.context.scene.collection.objects.link(wr)
        wr.parent = sh
        wr.location = (side * WRIST, 0.0, 0.0)
        arm = wing_panel(f'{name}_arm{tag}', side, [w for w in WING if w[0] <= WRIST], 0.0)
        arm.parent = sh; arm.data.materials.append(cm)
        hand = wing_panel(f'{name}_hand{tag}', side, [w for w in WING if w[0] >= WRIST], WRIST)
        hand.parent = wr; hand.data.materials.append(cm)
        for i, (x, ln, ang, wd) in enumerate(SECONDARIES):
            # each feather lies a hair lower than the one outboard of it, so they shingle
            add_feather(f'{name}_s{tag}{i}', sh, side, (x, -0.002), ln, ang, wd, fm, tip=1.0, seed=i, z=-0.0015 - 0.0001 * (13 - i))
        for i, (x, ln, ang, wd) in enumerate(PRIMARIES):
            add_feather(f'{name}_p{tag}{i}', wr, side, (x, 0.000), ln, ang, wd, fm, pointed=i > 5, seed=40 + i, z=-0.0012 - 0.00012 * i)
        wings[tag] = (sh, wr)
    em = bpy.data.materials.new('eye'); nt = nodes(em)
    principled(nt, **{'Base Color': lin('#070605'), 'Roughness': 0.05, 'Coat Weight': 1.0})
    for side in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0031, location=(side * 0.0238, 0.092, 0.0185), segments=24, ring_count=12)
        e = bpy.context.active_object
        e.data.materials.append(em)
        e.parent = root
        for p in e.data.polygons:
            p.use_smooth = True
    return root, wings


def flap(wings, phase, amp=1.0):
    """Set the wing pose for a phase in [0, 1): 0 = top of the upstroke."""
    a = math.cos(phase * math.tau)
    for tag, side in (('R', 1), ('L', -1)):
        sh, wr = wings[tag]
        sh.rotation_euler = (0.0, side * -(0.15 + 0.75 * a * amp), 0.0)
        # the hand lags and folds a little on the upstroke
        b = math.cos(phase * math.tau - 0.6)
        wr.rotation_euler = (0.0, side * -(0.25 * b * amp), side * (0.12 * max(0, b)))
