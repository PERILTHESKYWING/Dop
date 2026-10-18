"""Ikki's 3-second flight, the bird layer: a camera tracking alongside a razorbill at full speed,
rendered on a transparent background with real motion blur on the beating wings. compose_flight.py
puts the streaking sky behind it. Lit by the same sun and sky as clouds.py.
Usage: python flight.py OUT_DIR W H SAMPLES [F0 F1]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kl import reset, world_sky, sun, camera
from bird import build, flap

out, W, H, S = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
f0, f1 = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1, 90)
FPS, N = 30, 90
BEAT = 5.0            # wingbeats a second: auks whirr
SURGE = 2.25          # seconds: Ikki pulls away out of frame

sc = reset(samples=S, res=(W, H), transparent=True)
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 1, N
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.35
sc.view_settings.exposure = -1.0
SUN_EL, SUN_AZ = 21, 250
world_sky(sun_elev_deg=SUN_EL, sun_rot_deg=SUN_AZ, strength=0.3)
sun(elev_deg=SUN_EL, azim_deg=SUN_AZ - 90, energy=3.2, angle_deg=0.55)

root, wings = build()
CAM = (1.04, 0.86, 0.62)    # in front and to the right of Ikki, 25 degrees above, 1.5 m off
cam = camera(CAM, (0.0, 0.02, 0.0), lens=50)


def at(f):
    t = (f - 1) / FPS
    # the body bobs with each beat and rolls a touch; after SURGE it accelerates forward and climbs
    bob = 0.006 * math.sin(t * BEAT * math.tau + 0.9)
    k = max(0.0, t - SURGE)
    ahead = 2.6 * k * k
    root.location = (0.0, ahead + 0.01 * math.sin(t * 1.7), bob + 0.04 * k * k)
    root.rotation_euler = (math.radians(-2 + 3 * math.sin(t * 2.1) - 6 * k), math.radians(4 * math.sin(t * 1.3)), 0.0)
    flap(wings, (t * BEAT) % 1.0, amp=1.0)
    # a hand-held tracking camera: tiny drift and roll
    cam.location = (CAM[0] + 0.01 * math.sin(t * 3.1), CAM[1] + 0.012 * math.sin(t * 2.3), CAM[2] + 0.008 * math.sin(t * 4.2))


for f in range(1, N + 1):
    at(f)
    for ob in (root, cam):
        ob.keyframe_insert('location', frame=f)
        ob.keyframe_insert('rotation_euler', frame=f)
    for sh, wr in wings.values():
        sh.keyframe_insert('rotation_euler', frame=f)
        wr.keyframe_insert('rotation_euler', frame=f)
for ob in bpy.data.objects:
    ad = ob.animation_data
    if ad and ad.action:
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'

os.makedirs(out, exist_ok=True)
for f in range(f0, f1 + 1):
    sc.frame_set(f)
    sc.render.filepath = os.path.join(out, f'b{f:03d}.png')
    bpy.ops.render.render(write_still=True)
