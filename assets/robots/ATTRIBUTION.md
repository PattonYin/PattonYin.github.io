# Robot model attribution

The GLB meshes and `kinematics.json` files here are derived from
[MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie).

| Folder  | Source model                     | Licence                    |
|---------|----------------------------------|----------------------------|
| `panda/` | `franka_emika_panda`            | Apache 2.0 (see `panda/LICENSE`) |
| `iiwa/`  | `kuka_iiwa_14`                  | BSD 3-Clause, via Drake (see `iiwa/LICENSE`) |

## What was changed

For each robot, the MJCF was parsed to extract the body tree — exact joint
frames (`pos`/`quat`), joint axes, and joint types — into `kinematics.json`.
Each link's *visual* geoms were then merged (keeping per-part material colours,
so the KUKA grey/orange livery and Panda's white/black survive), decimated to
≤12 000 faces per part, and exported as one binary GLB per link.

Collision geoms were dropped. Original visual meshes were 37.5 MB of ASCII OBJ;
these GLBs are 5.3 MB total.

Joint angles follow the source MJCF convention, so real logged joint states
replay without remapping: all-zero q is the upright home pose, the 7 arm joints
are hinges about their local Z, and Panda's two finger joints are prismatic
along local Y (0–0.04 m).

## Note on the iiwa

Menagerie ships `kuka_iiwa_14` only — there is no iiwa 7 model. The 14 is used
here. Externally the two are near-identical; the link lengths differ slightly
(iiwa 7 R800 reaches 800 mm, the iiwa 14 R820 reaches 820 mm), so if you need
the 7 specifically, swap in its meshes and update `kinematics.json` link offsets.

## Regenerating

The converter script is `tools/convert_robots.py`. It downloads from Menagerie,
so it needs network access:

```
pip install trimesh fast-simplification
python tools/convert_robots.py assets/robots
FACE_BUDGET=6000 python tools/convert_robots.py assets/robots   # smaller/lower-poly
```
