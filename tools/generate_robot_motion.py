"""Generate display motions with full tool position AND orientation constraints.

Run after convert_grippers.py. Requires numpy and scipy; this only builds the
website animation and is not a hardware trajectory controller.
"""

import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
FPS = 12
STEP_SECONDS = 1.5


def transform(position, rotation=None):
    result = np.eye(4)
    result[:3, 3] = position
    if rotation is not None:
        result[:3, :3] = rotation
    return result


class Arm:
    def __init__(self, model, base, yaw):
        kin = json.loads((ROOT / f"assets/robots/{model}/kinematics.json").read_text())
        self.links = kin["links"][:8]
        self.fixed = []
        for link in self.links:
            quat = link.get("quat") or [1, 0, 0, 0]
            self.fixed.append(transform(link["pos"], Rotation.from_quat([*quat[1:], quat[0]]).as_matrix()))
        self.limits = np.array([link["joint"]["range"] for link in self.links if link["joint"]])
        # Browser world (Y up) -> source MJCF world (Z up).
        self.base = transform([base[0], -base[2], base[1]], Rotation.from_euler("z", yaw).as_matrix())
        if model == "iiwa":
            # HandUMI CAD fingertip centre relative to the link7 origin:
            # flange 45 mm + assembly-root TCP, including its small XY offset.
            self.tool = transform([0.00353923, 0.001187424, 0.045 + 0.177840393])
        else:
            # Robotiq base_mount + base + pinch site, attached at Panda flange.
            self.tool = transform([0, 0, 0.107 + 0.007 + 0.0038 + 0.145],
                                  Rotation.from_euler("z", -np.pi / 2).as_matrix())

    def fk(self, q):
        result = self.base.copy()
        for index, fixed in enumerate(self.fixed):
            result = result @ fixed
            if index:
                result = result @ transform([0, 0, 0], Rotation.from_rotvec(
                    np.array(self.links[index]["joint"]["axis"]) * q[index - 1]).as_matrix())
        return result @ self.tool

    def solve(self, target, rotation, previous):
        def residual(q):
            actual = self.fk(q)
            angular = Rotation.from_matrix(rotation @ actual[:3, :3].T).as_rotvec()
            return np.r_[4 * (actual[:3, 3] - target), angular, 0.001 * (q - previous)]
        solved = least_squares(residual, previous, bounds=(self.limits[:, 0] + 0.005,
                               self.limits[:, 1] - 0.005), max_nfev=200,
                               ftol=1e-10, xtol=1e-10, gtol=1e-10)
        actual = self.fk(solved.x)
        assert np.linalg.norm(actual[:3, 3] - target) < 0.0002, (target, actual[:3, 3])
        assert Rotation.from_matrix(rotation @ actual[:3, :3].T).magnitude() < 0.002
        return solved.x


def track(arm, waypoints, rotation, seed):
    frames, grips, targets = [], [], []
    # All waypoints use browser Y-up coordinates and metres per finger.
    q = arm.solve(np.array([waypoints[0][0], -waypoints[0][2], waypoints[0][1]]), rotation, seed)
    initial = q.copy()
    for start, end in zip(waypoints, waypoints[1:] + waypoints[:1]):
        for i in range(round(FPS * STEP_SECONDS)):
            u = i / (FPS * STEP_SECONDS)
            u = u ** 3 * (10 - 15 * u + 6 * u * u)  # zero velocity/acceleration at stops
            point = np.array(start) + (np.array(end) - start) * u
            target = np.array([point[0], -point[2], point[1]])
            q = arm.solve(target, rotation, q)
            frames.append(np.round(q, 7).tolist())
            grips.append(round(point[3], 6))
            targets.append(target)
    # Resolve the redundant joint back onto the starting posture during the
    # final stationary waypoint, so repeating the animation cannot snap.
    count = round(FPS * STEP_SECONDS)
    assert np.linalg.norm(np.array(waypoints[-1][:3]) - waypoints[0][:3]) < 1e-8
    begin = np.array(frames[-count])
    for i in range(count):
        u = i / (count - 1)
        u = u ** 3 * (10 - 15 * u + 6 * u * u)
        frames[-count + i] = np.round(begin + (initial - begin) * u, 7).tolist()
    # Validate between playback frames too, where the viewer interpolates q.
    max_angle, max_position, min_height = 0, 0, float("inf")
    for i, first in enumerate(frames):
        second = np.array(frames[(i + 1) % len(frames)])
        for u in (0, 0.25, 0.5, 0.75):
            pose = arm.fk(np.array(first) * (1 - u) + second * u)
            max_angle = max(max_angle, Rotation.from_matrix(rotation @ pose[:3, :3].T).magnitude())
            min_height = min(min_height, pose[2, 3])
            target = targets[i] * (1 - u) + targets[(i + 1) % len(frames)] * u
            max_position = max(max_position, np.linalg.norm(pose[:3, 3] - target))
    print(f"{len(frames)} frames: orientation error {np.degrees(max_angle):.3f} deg; "
          f"position error {max_position * 1000:.2f} mm; min TCP height {min_height:.3f} m")
    assert max_angle < np.radians(0.5)
    assert max_position < 0.002
    assert np.max(np.abs(np.diff(np.array(frames), axis=0))) < 0.09
    return {"q": frames, "grip": grips}


def main():
    left = Arm("iiwa", [-0.5, 0, -0.1], -0.5)
    right = Arm("iiwa", [0.5, 0, -0.1], np.pi + 0.5)
    panda = Arm("panda", [-0.22, 0, -0.18], -0.524)
    left_points = [
        [-0.20, 0.28, 0.25, 0.03], [-0.20, 0.28, 0.37, 0.03],
        [-0.20, 0.08, 0.37, 0.03], [-0.20, 0.08, 0.37, 0.012],
        [-0.20, 0.28, 0.37, 0.012], [-0.13, 0.28, 0.25, 0.012],
        [-0.13, 0.28, 0.25, 0.03], [-0.20, 0.28, 0.25, 0.03],
        [-0.20, 0.28, 0.25, 0.03],
    ]
    right_points = [[-x, y, z, grip] for x, y, z, grip in left_points]
    panda_points = [
        [0.16, 0.25, 0.10, 0.04], [0.24, 0.25, 0.20, 0.04],
        [0.24, 0.105, 0.20, 0.04], [0.24, 0.105, 0.20, 0.035],
        [0.24, 0.25, 0.20, 0.035], [0.05, 0.25, 0.30, 0.035],
        [0.05, 0.08, 0.30, 0.035], [0.05, 0.08, 0.30, 0.04],
        [0.05, 0.25, 0.30, 0.04], [0.16, 0.25, 0.10, 0.04],
        [0.16, 0.25, 0.10, 0.04],
    ]
    # Tool +Z points down. HandUMI camera (+X) faces outward on each arm.
    left_rotation = np.diag([-1., 1., -1.])
    right_rotation = np.diag([1., -1., -1.])
    tracks = [track(left, left_points, left_rotation, np.array([0., 0.5, 0., -1.4, 0., 1.2, 0.])),
              track(right, right_points, right_rotation, np.array([0., 0.5, 0., -1.4, 0., 1.2, 0.]))]
    panda_track = track(panda, panda_points, right_rotation,
                        np.array([0., -0.4, 0., -2., 0., 1.6, 0.8]))
    path = ROOT / "data/trajectories.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["_README"]["purpose"] = "Optional display trajectories; without this file, the viewers hold a stationary ready pose."
    data["_README"]["sampling"] = "Smooth Cartesian waypoints sampled at 12 fps with linear interpolation between joint states."
    data["_README"]["units"] = "Arm joints: radians. HandUMI grip: metres per finger, 0 to 0.037. Robotiq grip: 0 to 0.04 maps closed to open."
    data["_README"]["provenance"] = "Display trajectories generated by tools/generate_robot_motion.py with full tool position/orientation IK, joint limits and smooth Cartesian waypoints. Tool +Z stays downward; HandUMI cameras face outward. These are illustrative motions, not hardware commands."
    data["bimanual"] = [{"name": "Coordinated tabletop motion", "fps": FPS, "loop": True, "arms": tracks}]
    data["panda"] = [{"name": "Vertical approach and transfer", "fps": FPS, "loop": True, "arms": [panda_track]}]
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
