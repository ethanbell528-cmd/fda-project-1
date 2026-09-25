"""Bake the intro quarterback's motion from CMU motion capture into assets/motion/qb_mocap.json.

Run with Blender (tested with the portable Blender 4.5 LTS build, no add-ons needed):
    blender -b --factory-startup --python scripts/bake_mocap.py -- assets/motion/qb_mocap.json

Clips (CMU Graphics Lab Motion Capture Database, BVH conversions from
github.com/una-dinosauria/cmu-mocap):
  * drop:  subject 76 trial 11, "quick large steps backwards" (frames 90-410)
  * throw: subject 79 trial 91, "football" (frames 130-342)
The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

Output, per clip and per sampled frame (30 fps): joint positions in glTF axes (Y up), in units
of the performer's leg length (hip joint to ankle), and world rotations of the torso, head and
feet relative to the performer's rest pose (quaternions x, y, z, w). The page retargets them onto
the intro's player: limb directions from the joint positions, torso/feet from the rotations.
"""
import bpy, sys, os, math, json, tempfile, urllib.request
from mathutils import Matrix, Vector, Quaternion

OUT = sys.argv[sys.argv.index("--") + 1]
BASE = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/"
CLIPS = [  # name, file, first frame, last frame, turn about the vertical (degrees)
    ("drop", "076/76_11.bvh", 90, 410, 90.0),
    ("throw", "079/79_91.bvh", 130, 342, 0.0),
]
SRC_FPS, STEP = 120, 4
POS_JOINTS = ["Hips", "Head", "LeftArm", "LeftForeArm", "LeftHand", "LeftFingerBase", "RightArm", "RightForeArm",
              "RightHand", "RightFingerBase", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"]
ROT_JOINTS = ["Hips", "LowerBack", "Spine", "Spine1", "Neck", "Head", "LeftFoot", "RightFoot"]
C = Matrix.Rotation(-math.pi / 2, 4, "X")  # Blender (Z up) -> glTF (Y up): (x, y, z) -> (x, z, -y)
C3 = C.to_3x3()


def to_gltf_pos(v):
    return C3 @ v


def to_gltf_quat(q):
    return (C3 @ q.to_matrix() @ C3.transposed()).to_quaternion()


def fetch(rel):
    path = os.path.join(tempfile.gettempdir(), os.path.basename(rel))
    if not os.path.exists(path):
        urllib.request.urlretrieve(BASE + rel, path)
    return path


out = {"fps": SRC_FPS / STEP, "units": "leg lengths (hip joint to ankle), glTF axes, Y up",
       "pos_joints": POS_JOINTS, "rot_joints": ROT_JOINTS,
       "source": "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH via github.com/una-dinosauria/cmu-mocap",
       "clips": {}}
anchor = Vector((0.0, 0.0))  # the throw starts where the drop-back ended (horizontal hips position)
for name, rel, f0, f1, turn in CLIPS:
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_anim.bvh(filepath=fetch(rel), global_scale=1.0, use_fps_scale=False, update_scene_fps=False,
                            update_scene_duration=False, axis_forward="-Z", axis_up="Y")
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    bones, pb = arm.data.bones, arm.pose.bones
    rest_q = {n: (arm.matrix_world @ bones[n].matrix_local).to_quaternion() for n in ROT_JOINTS}
    rest = lambda n: arm.matrix_world @ bones[n].head_local
    leg = (rest("LeftUpLeg") - rest("LeftFoot")).length
    # facing correction: the rest pose must face glTF +Z (Blender -Y), like the page's player
    lr = rest("RightUpLeg") - rest("LeftUpLeg"); lr.z = 0
    fwd = Vector((0, 0, 1)).cross(lr).normalized()
    yaw = math.atan2(fwd.x, -fwd.y)  # angle from Blender -Y
    Fq = Quaternion((0, 0, 1), -yaw)
    Tq = Quaternion((0, 0, 1), math.radians(turn)) @ Fq  # full horizontal rotation applied to the motion
    Tm = Tq.to_matrix()
    sc = bpy.context.scene
    sc.frame_set(f0)
    wp = lambda n: arm.matrix_world @ pb[n].head
    h0 = Tm @ wp("Hips")
    ground = min((Tm @ wp("LeftFoot")).z, (Tm @ wp("RightFoot")).z)
    frames = list(range(f0, f1 + 1, STEP))
    P, Q, hand_prev, speed, hips_last = [], [], None, [], None
    for f in frames:
        sc.frame_set(f)
        row = []
        for n in POS_JOINTS:
            v = Tm @ wp(n)
            v = Vector(((v.x - h0.x) + anchor.x * leg, (v.y - h0.y) + anchor.y * leg, v.z - ground)) / leg
            row.extend(round(c, 4) for c in to_gltf_pos(v))
            if n == "Hips":
                hips_last = Vector((v.x, v.y))
            if n == "RightHand":
                speed.append(0.0 if hand_prev is None else (v - hand_prev).length * leg)
                hand_prev = v.copy()
        P.append(row)
        qrow = []
        for n in ROT_JOINTS:
            now = (arm.matrix_world @ pb[n].matrix).to_quaternion()
            d = Tq @ now @ rest_q[n].inverted() @ Fq.inverted()  # = turn * (Fq * rest-relative * Fq^-1): facing-corrected, then turned
            g = to_gltf_quat(d)
            qrow.extend(round(c, 5) for c in (g.x, g.y, g.z, g.w))
        Q.append(qrow)
    anchor = hips_last
    clip = {"frames": len(frames), "src": f"CMU {os.path.basename(rel)[:-4]} frames {f0}-{f1}", "pos": P, "rot": Q}
    if name == "throw":
        clip["release_index"] = max(range(len(speed)), key=lambda i: speed[i])
    out["clips"][name] = clip
    print("CLIP", name, len(frames), "leg", round(leg, 3), "facing-correction deg", round(math.degrees(yaw), 1),
          "release" if name == "throw" else "", clip.get("release_index", ""))
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print("WROTE", OUT, os.path.getsize(OUT))
