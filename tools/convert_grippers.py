"""Build the website grippers without copying source CAD into the repository.

Usage: python tools/convert_grippers.py /path/to/handumi_kuka
Requires trimesh, fast-simplification, numpy and scipy. Run after convert_robots.py.
"""

import argparse
import copy
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
import trimesh
from scipy.optimize import least_squares

from convert_robots import collect_defaults, resolve, transform, walk_bodies

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/robots"
CACHE = ROOT / ".preview/robotiq-source"
REVISION = "71f066ad0be9cd271f7ed58c030243ef157af9f4"
RAW = f"https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/{REVISION}/robotiq_2f85"
FACE_BUDGET = 6000


def download(name):
    path = CACHE / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # Cache the pinned revision separately from any exploratory downloads.
    path = path.with_name(REVISION[:8] + "-" + path.name)
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(f"{RAW}/{name}", timeout=45).read())
    return path


def compact(mesh):
    if mesh.visual.kind in ("vertex", "face"):
        # The camera GLB uses five vertex colours in one mesh. Simplify each
        # colour region separately so decimation keeps its board/lens colours.
        colors, labels = np.unique(mesh.visual.face_colors, axis=0, return_inverse=True)
        parts = []
        for index, color in enumerate(colors):
            part = mesh.submesh([np.flatnonzero(labels == index)], append=True)
            budget = max(100, round(FACE_BUDGET * len(part.faces) / len(mesh.faces)))
            if len(part.faces) > budget:
                part = part.simplify_quadric_decimation(face_count=budget)
            part.visual = trimesh.visual.ColorVisuals(mesh=part, face_colors=color)
            parts.append(part)
        return trimesh.util.concatenate(parts)
    material = copy.deepcopy(mesh.visual.material) if hasattr(mesh.visual, "material") else None
    if len(mesh.faces) > FACE_BUDGET:
        mesh = mesh.simplify_quadric_decimation(face_count=FACE_BUDGET)
    if material is not None:
        mesh.visual = trimesh.visual.TextureVisuals(material=material)
    return mesh


def colored(mesh, rgba):
    mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        baseColorFactor=rgba, metallicFactor=0.15, roughnessFactor=0.55))
    return mesh


def save_scene(scene, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(scene.export(file_type="glb"))
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.1f} KiB", flush=True)


def attach(robot, links, flange, gripper):
    path = OUT / robot / "kinematics.json"
    kin = json.loads(path.read_text())
    # The arm ends at link7; replace any existing tool (also makes reruns safe).
    kin["links"] = kin["links"][:8]
    for link in links:
        link = copy.deepcopy(link)
        if link["parent"] == -1:
            link["parent"] = 7
            link["pos"] = (np.array(link["pos"]) + flange).tolist()
        else:
            link["parent"] += 8
        kin["links"].append(link)
    kin["gripper"] = gripper
    path.write_text(json.dumps(kin, indent=1) + "\n")


def robotiq():
    root = ET.parse(download("2f85.xml")).getroot()
    materials, classes = collect_defaults(root)
    links = []
    walk_bodies(root.find("worldbody/body"), -1, links, materials, classes)
    bodies = {body.get("name"): body for body in root.iter("body")}
    exported = {}
    for link in links:
        joint = bodies[link["name"]].find("joint")
        if joint is not None:
            attrs = resolve(joint, "joint", classes, "2f85")
            if "pos" in attrs:
                link["joint"]["pos"] = list(map(float, attrs["pos"].split()))
        geoms = link.pop("geoms")
        key = tuple((g["mesh"], tuple(g["rgba"])) for g in geoms)
        if key not in exported:
            scene = trimesh.Scene()
            for i, geom in enumerate(geoms):
                mesh = compact(trimesh.load(download(f"assets/{geom['mesh']}.stl"), force="mesh"))
                mesh.apply_scale(0.001)  # MJCF 2f85 mesh default: millimetres.
                mesh.apply_transform(transform(geom["pos"], geom["quat"]))
                scene.add_geometry(colored(mesh, geom["rgba"]), node_name=f"part{i}")
            name = f"{link['name']}.glb"
            save_scene(scene, OUT / "robotiq-2f85" / name)
            exported[key] = f"../robotiq-2f85/{name}"
        link["mesh"] = exported[key]

    # Solve the source MJCF closed linkage with the coupler at its open stop. In particular,
    # the follower hinge has an offset pivot; simply mirroring driver angles
    # would pull its pins apart. Store samples for lightweight browser playback.
    def rotate(angle, point):
        c, s = np.cos(angle), np.sin(angle)
        return np.array([[c, -s], [s, c]]) @ point

    driver_origin = np.array([0.0306011, 0.054904])
    coupler_origin = np.array([0.0315, -0.0041])
    spring_origin = np.array([0.0132, 0.0609])
    follower_origin = np.array([0.055, 0.0375])
    pivot = np.array([-0.018, 0.0065])
    anchor = spring_origin + follower_origin - driver_origin - coupler_origin
    samples = []
    previous = [0, 0]
    for driver in np.linspace(0, 0.799, 65):
        def residual(q):
            spring, follower = q
            follower_pin = spring_origin + rotate(spring, follower_origin + pivot) - rotate(spring + follower, pivot)
            coupler_pin = driver_origin + rotate(driver, coupler_origin + anchor)
            return follower_pin - coupler_pin
        solved = least_squares(residual, previous, xtol=1e-13, ftol=1e-13, gtol=1e-13)
        assert np.linalg.norm(residual(solved.x)) < 1e-8
        spring, follower = solved.x
        previous = solved.x
        samples.append([driver, 0, spring, follower])
    motion = {}
    for side in ("left", "right"):
        for i, part in enumerate(("driver", "coupler", "spring_link", "follower")):
            motion[f"{side}_{part}_joint"] = [round(row[i], 8) for row in reversed(samples)]
    attach("panda", links, [0, 0, 0.107], {"open": 0.04, "joints": motion})
    (OUT / "robotiq-2f85/LICENSE").write_bytes(download("LICENSE").read_bytes())
    for name in ("hand.glb", "left_finger.glb", "right_finger.glb"):
        obsolete = (OUT / "panda" / name).resolve()
        assert obsolete.is_relative_to((OUT / "panda").resolve())
        obsolete.unlink(missing_ok=True)


def urdf_origin(element):
    if element is None:
        return np.eye(4)
    xyz = list(map(float, element.get("xyz", "0 0 0").split()))
    rpy = list(map(float, element.get("rpy", "0 0 0").split()))
    result = trimesh.transformations.euler_matrix(*rpy, axes="sxyz")
    result[:3, 3] = xyz
    return result


def handumi(source):
    root = ET.parse(source / "handumi_kuka.urdf").getroot()
    by_name = {link.get("name"): link for link in root.findall("link")}
    children = {}
    for joint in root.findall("joint"):
        children.setdefault(joint.find("parent").get("link"), []).append(joint)
    scenes = {name: trimesh.Scene() for name in ("body", "finger_left", "finger_right")}
    joints = {}

    def visit(name, frame, group):
        for i, visual in enumerate(by_name[name].findall("visual")):
            spec = visual.find("geometry/mesh")
            loaded = trimesh.load(source / spec.get("filename"), force="scene")
            scale = np.diag([*map(float, spec.get("scale", "1 1 1").split()), 1])
            placement = frame @ urdf_origin(visual.find("origin")) @ scale
            color = visual.find("material/color")
            for node in loaded.graph.nodes_geometry:
                local, geometry = loaded.graph[node]
                mesh = compact(loaded.geometry[geometry].copy())
                mesh.apply_transform(placement @ local)
                if color is not None:
                    colored(mesh, list(map(float, color.get("rgba").split())))
                scenes[group].add_geometry(mesh, node_name=f"{name}_{i}_{node}")
        for joint in children.get(name, []):
            child = joint.find("child").get("link")
            child_frame = frame @ urdf_origin(joint.find("origin"))
            child_group = group
            if joint.get("type") == "prismatic":
                child_group = child
                axis = child_frame[:3, :3] @ np.array(list(map(float, joint.find("axis").get("xyz").split())))
                limit = joint.find("limit")
                joints[child] = {"name": joint.get("name"), "type": "slide", "axis": axis.tolist(),
                                 "range": [float(limit.get("lower")), float(limit.get("upper"))]}
            visit(child, child_frame, child_group)

    visit("assembly_root", np.eye(4), "body")
    links = []
    for name, scene in scenes.items():
        save_scene(scene, OUT / "handumi-kuka" / f"{name}.glb")
        links.append({"name": f"handumi_{name}", "parent": -1 if name == "body" else 0,
                      "pos": [0, 0, 0], "joint": joints.get(name), "mesh": f"../handumi-kuka/{name}.glb"})
    motion = {joint["name"]: [0, joint["range"][1]] for joint in joints.values()}
    attach("iiwa", links, [0, 0, 0.045], {"open": 0.037, "joints": motion})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handumi_source", type=Path, help="Directory containing handumi_kuka.urdf")
    args = parser.parse_args()
    robotiq()
    handumi(args.handumi_source)
