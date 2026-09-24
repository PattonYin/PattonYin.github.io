"""Convert MuJoCo Menagerie robot models into web-ready GLB + kinematics JSON.

Reads the MJCF, walks the body tree to get exact joint frames and axes, then
merges each link's visual meshes (preserving per-part materials), decimates them
to a web budget, and writes one GLB per link plus a kinematics description.
"""

import json
import os
from pathlib import Path
import sys
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
import trimesh

RAW = "https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main"
CACHE = str(Path(__file__).resolve().parents[1] / ".preview/robot-source")
FACE_BUDGET = int(os.environ.get("FACE_BUDGET", "12000"))

ROBOTS = {
    "panda": {"dir": "franka_emika_panda", "xml": "panda.xml"},
    "iiwa": {"dir": "kuka_iiwa_14", "xml": "iiwa14.xml"},
}


def fetch(robot_dir, asset):
    os.makedirs(f"{CACHE}/{robot_dir}", exist_ok=True)
    local = f"{CACHE}/{robot_dir}/{asset}"
    if not os.path.exists(local):
        url = f"{RAW}/{robot_dir}/assets/{asset}"
        urllib.request.urlretrieve(url, local)
    return local


def parse_quat(s):
    """MJCF quat is w x y z, and is NOT necessarily normalised.

    MuJoCo normalises quaternions internally, so files legitimately contain
    things like quat="0 0 1 1" (norm sqrt(2)). Emitting that raw makes any
    consumer that builds a matrix from it (e.g. three.js Quaternion.set +
    Matrix4.compose) pick up a scale of |q|^2 per link, which compounds down
    the kinematic chain and blows the model apart. Normalise here.
    """
    w, x, y, z = [float(v) for v in s.split()]
    q = np.array([w, x, y, z])
    n = np.linalg.norm(q)
    return q / n if n > 1e-12 else np.array([1.0, 0.0, 0.0, 0.0])


def transform(pos, quat):
    T = np.eye(4)
    if quat is not None:
        T[:3, :3] = trimesh.transformations.quaternion_matrix(quat)[:3, :3]
    if pos is not None:
        T[:3, 3] = pos
    return T


def collect_defaults(root):
    """Resolve the MJCF <default> tree into {class: {tag: attrs}}.

    Defaults inherit down the nesting, so class="finger" picks up class="panda"'s
    joint attributes and overrides axis/type on top. Without this, slide joints
    (the Panda fingers) are silently misread as Z hinges.
    """
    materials = {}
    for mat in root.iter("material"):
        rgba = mat.get("rgba", "0.5 0.5 0.5 1").split()
        materials[mat.get("name")] = [float(v) for v in rgba]

    classes = {}

    def walk(node, inherited):
        merged = {tag: dict(attrs) for tag, attrs in inherited.items()}
        for tag in ("joint", "geom"):
            el = node.find(tag)
            if el is not None:
                merged.setdefault(tag, {})
                merged[tag].update(el.attrib)
        cls = node.get("class")
        if cls:
            classes[cls] = merged
        for child in node.findall("default"):
            walk(child, merged)

    for d in root.findall("default"):
        walk(d, {})

    return materials, classes


def resolve(el, tag, classes, childclass):
    """Merge an element's own attributes over its default class's attributes."""
    cls = el.get("class") or childclass
    attrs = dict(classes.get(cls, {}).get(tag, {})) if cls else {}
    attrs.update(el.attrib)
    return attrs


def walk_bodies(body, parent_index, links, materials, classes, childclass=None):
    """Depth-first walk producing a flat link list with parent indices."""
    childclass = body.get("childclass") or childclass

    pos = body.get("pos")
    quat = body.get("quat")
    pos = [float(v) for v in pos.split()] if pos else [0, 0, 0]
    quat = parse_quat(quat) if quat else None

    joint = body.find("joint")
    joint_info = None
    if joint is not None:
        attrs = resolve(joint, "joint", classes, childclass)
        axis = attrs.get("axis", "0 0 1")
        joint_info = {
            "name": joint.get("name") or f"joint{len(links)}",
            "axis": [float(v) for v in axis.split()],
            # MJCF default joint type is hinge; slide = prismatic
            "type": attrs.get("type", "hinge"),
        }
        if attrs.get("range"):
            joint_info["range"] = [float(v) for v in attrs["range"].split()]

    geoms = []
    for geom in body.findall("geom"):
        mesh = geom.get("mesh")
        if not mesh:
            continue
        attrs = resolve(geom, "geom", classes, childclass)
        cls = geom.get("class")
        if cls == "collision" or attrs.get("group") == "3":
            continue
        rgba = materials.get(attrs.get("material"), [0.75, 0.75, 0.75, 1])
        gpos = attrs.get("pos")
        gquat = attrs.get("quat")
        geoms.append({
            "mesh": mesh,
            "rgba": rgba,
            "pos": [float(v) for v in gpos.split()] if gpos else [0, 0, 0],
            "quat": parse_quat(gquat) if gquat else None,
        })

    index = len(links)
    links.append({
        "name": body.get("name") or f"link{index}",
        "parent": parent_index,
        "pos": pos,
        "quat": None if quat is None else quat.tolist(),
        "joint": joint_info,
        "geoms": geoms,
    })

    for child in body.findall("body"):
        walk_bodies(child, index, links, materials, classes, childclass)


def build(robot_key, out_dir):
    cfg = ROBOTS[robot_key]
    os.makedirs(CACHE, exist_ok=True)
    xml_local = os.path.join(CACHE, cfg["xml"])
    if not os.path.exists(xml_local):
        urllib.request.urlretrieve(f"{RAW}/{cfg['dir']}/{cfg['xml']}", xml_local)

    root = ET.parse(xml_local).getroot()
    materials, classes = collect_defaults(root)

    # mesh name -> file (MJCF <mesh file=...>; name defaults to filename stem)
    mesh_files = {}
    for m in root.iter("mesh"):
        f = m.get("file")
        if not f:
            continue
        mesh_files[m.get("name") or os.path.splitext(f)[0]] = f

    worldbody = root.find("worldbody")
    links = []
    for body in worldbody.findall("body"):
        walk_bodies(body, -1, links, materials, classes)

    os.makedirs(out_dir, exist_ok=True)
    total_bytes = 0
    kinematics = {"name": robot_key, "links": []}

    for i, link in enumerate(links):
        entry = {
            "name": link["name"],
            "parent": link["parent"],
            "pos": link["pos"],
            "joint": link["joint"],
        }
        if link["quat"]:
            entry["quat"] = link["quat"]

        if link["geoms"]:
            scene = trimesh.Scene()
            for gi, g in enumerate(link["geoms"]):
                fname = mesh_files.get(g["mesh"])
                if not fname:
                    print(f"    !! no file for mesh {g['mesh']}")
                    continue
                path = fetch(cfg["dir"], fname)
                mesh = trimesh.load(path, force="mesh", process=False)

                if len(mesh.faces) > FACE_BUDGET:
                    target = FACE_BUDGET
                    try:
                        mesh = mesh.simplify_quadric_decimation(face_count=target)
                    except TypeError:
                        mesh = mesh.simplify_quadric_decimation(target)

                T = transform(g["pos"], g["quat"])
                if not np.allclose(T, np.eye(4)):
                    mesh.apply_transform(T)

                r, gg, b, a = g["rgba"]
                mesh.visual = trimesh.visual.TextureVisuals(
                    material=trimesh.visual.material.PBRMaterial(
                        baseColorFactor=[r, gg, b, a],
                        metallicFactor=0.25,
                        roughnessFactor=0.55,
                    )
                )
                scene.add_geometry(mesh, node_name=f"{link['name']}_{gi}")

            glb_name = f"{link['name']}.glb"
            data = scene.export(file_type="glb")
            with open(os.path.join(out_dir, glb_name), "wb") as fh:
                fh.write(data)
            total_bytes += len(data)
            entry["mesh"] = glb_name
            faces = sum(len(g.faces) for g in scene.geometry.values())
            print(f"    {link['name']:<12} {glb_name:<18} {len(data)/1024:7.1f} KB  {faces:6d} faces")

        kinematics["links"].append(entry)

    with open(os.path.join(out_dir, "kinematics.json"), "w") as fh:
        json.dump(kinematics, fh, indent=1)

    print(f"  {robot_key}: {len(links)} links, {total_bytes/1024/1024:.2f} MB of GLB")
    return total_bytes


if __name__ == "__main__":
    out_root = sys.argv[1] if len(sys.argv) > 1 else "out"
    grand = 0
    for key in ROBOTS:
        print(f"== {key} (face budget {FACE_BUDGET})")
        grand += build(key, os.path.join(out_root, key))
    print(f"\nTOTAL: {grand/1024/1024:.2f} MB")
