# Robot model attribution

| Assets | Source | Licence |
|--------|--------|---------|
| `panda/` arm | [MuJoCo Menagerie: franka_emika_panda](https://github.com/google-deepmind/mujoco_menagerie/tree/main/franka_emika_panda) | Apache 2.0 (`panda/LICENSE`) |
| `iiwa/` arm | [MuJoCo Menagerie: kuka_iiwa_14](https://github.com/google-deepmind/mujoco_menagerie/tree/main/kuka_iiwa_14) | BSD 3-Clause, via Drake (`iiwa/LICENSE`) |
| `robotiq-2f85/` | [MuJoCo Menagerie: robotiq_2f85](https://github.com/google-deepmind/mujoco_menagerie/tree/71f066ad0be9cd271f7ed58c030243ef157af9f4/robotiq_2f85) | BSD 2-Clause, ROS-Industrial (`robotiq-2f85/LICENSE`) |
| `handumi-kuka/` | Owner-provided `handumi_kuka.urdf`, STL parts and Arducam visual GLB | Supplied by the site owner; no third-party licence added |

## Conversion and mounting

Visual meshes are simplified and exported as compact GLBs; collision meshes,
raw CAD and source downloads are excluded from the website. Arm meshes use up
to 12,000 faces per source part; gripper meshes use up to 6,000. The HandUMI
camera retains its board/lens colours. Shared geometry serves both KUKA arms,
with the original orange-and-gray finish on the left and white body panels on the right.

The Panda stock hand is replaced by a Robotiq 2F-85 at its 107 mm flange offset.
Its joint frames, offset follower pivots and closed linkage follow the source
MJCF. Sampled closure poses hold each coupler at its zero-angle stop and solve
the spring/follower angles, without a physics engine in the browser.

Both KUKA arms carry the complete HandUMI assembly at the 45 mm flange offset.
The supplied URDF defines mesh scale, camera position and the two prismatic
finger axes. Fixed components are merged into one mesh; each moving jaw has
its own mesh. The URDF's mount-face frame and fingertip-centre offset are kept.

Arm angles retain the MJCF joint convention. HandUMI `grip` is half the opening
in metres (0 to 0.037). For Robotiq, the existing 0 to 0.04 display command maps
closed to open through the coupled joint samples; it is not a hardware command.

The KUKA visual model remains the iiwa 14 R820, as indicated in the caption.

## Regenerating

```powershell
pip install trimesh fast-simplification numpy scipy
python tools/convert_robots.py assets/robots
python tools/convert_grippers.py "C:/path/to/handumi_kuka"
python tools/generate_robot_motion.py
```

The local source folder must contain `handumi_kuka.urdf` and its referenced
meshes. Downloaded source files are cached under the ignored `.preview/`
directory. The gripper converter replaces any prior tool links; the obsolete
Panda `hand.glb`, `left_finger.glb` and `right_finger.glb` are not used.

Display motion uses full tool position and orientation IK with joint limits,
keeping the fingertips downward and the HandUMI cameras facing outward.
The generator checks orientation and position errors between playback samples
and closes each loop onto its starting joint posture.
