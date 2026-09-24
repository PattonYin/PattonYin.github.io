// 3D robot viewers — 2× KUKA LBR iiwa (bimanual) and Franka Emika Panda.
//
// Uses the REAL robot meshes and kinematics, converted from MuJoCo Menagerie
// into per-link GLB + kinematics.json by tools/convert_robots.py and
// tools/convert_grippers.py (including the local HandUMI URDF). See
// assets/robots/ATTRIBUTION.md for sources and licences.
//
// ── Joint convention (matches the source MJCF, so real logs replay directly) ─
// All 7 arm joints are hinges about their own local Z; each link's fixed frame
// (pos + quat) comes straight from the MJCF, so the effective axes are the real
// robot's. Gripper joint axes and coupled opening poses come from kinematics.json.
// Angles are radians.
//
// Note Panda's joint4 range is [-3.07, -0.07] — it never reaches 0, so an
// all-zero pose is invalid for the Panda (it is valid for the iiwa).
//
// ── Trajectory replay ───────────────────────────────────────────────────────
// data/trajectories.json:
//   { "<setup>": [ { "name": "...", "fps": 10, "loop": true,
//                    "arms": [ { "q": [[j1..j7], ...], "grip": [0.04, ...] } ] } ] }
// One `arms` entry per arm (2 for bimanual, 1 for panda). `grip` is optional,
// in metres per finger for HandUMI; 0 to 0.04 maps closed to open for Robotiq.
// With no file the viewers use a stationary ready pose.
//
// ── Adding props (tables, camera mounts, fixtures) ──────────────────────────
// Define window.robotSceneExtras BEFORE this module runs:
//   window.robotSceneExtras = { bimanual(ctx) { ctx.scene.add(mount); }, panda(ctx) {} };
// ctx = { scene, THREE, colors, viewer, makeMaterial, addShadow }. Called on
// every (re)build, so props survive theme changes. data-robot-table="false" on a
// canvas skips the built-in table.

let THREE, OrbitControls, GLTFLoader, RoomEnvironment;

function reportViewerFailure(message) {
    document.querySelectorAll('.viewer').forEach(panel => {
        panel.classList.remove('viewer--loading');
        panel.classList.add('viewer--failed');
        const fallback = panel.querySelector('.viewer-fallback');
        if (fallback) fallback.textContent = message;
    });
}

function onReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn);
    } else {
        fn();
    }
}

// Imported dynamically so a blocked/offline CDN is reportable rather than a
// silent module-load failure that leaves the viewers mysteriously empty.
try {
    THREE = await import('three');
    OrbitControls = (await import('three/addons/controls/OrbitControls.js')).OrbitControls;
    GLTFLoader = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
    RoomEnvironment = (await import('three/addons/environments/RoomEnvironment.js')).RoomEnvironment;
} catch (err) {
    console.error('three.js failed to load:', err);
    onReady(() => reportViewerFailure(
        'three.js could not be loaded from unpkg.com, which the 3D viewers require. ' +
        'Check your network connection or any content blocker.'
    ));
}

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ARM_JOINT = /^joint[1-7]$/;

// ============================================
// Theme integration
// ============================================

function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
        surface: read('--surface', '#f9fafb'),
        border: read('--border', '#e5e7eb'),
        foreground: read('--foreground', '#111827'),
        accent: read('--accent', '#3b82f6'),
        isDark: document.documentElement.getAttribute('data-theme') === 'dark'
    };
}

// ============================================
// Setups
// ============================================

const SETUPS = {
    bimanual: {
        model: 'iiwa',
        label: '2× KUKA LBR iiwa',
        table: { width: 2.0, depth: 1.2 },
        // Facing each other across a shared workspace. The second yaw is
        // PI - (-0.5): mirroring a placement about the YZ plane flips handedness,
        // which a rotation can't do, so PI - yaw is the closest equivalent and is
        // what actually points the second arm at the shared payload.
        arms: [
            { position: [-0.5, 0, -0.1], yaw: -0.5 },
            { position: [0.5, 0, -0.1], yaw: Math.PI + 0.5, armColor: '#eeeeee' }
        ],
        payload: [0, 0.06, 0.22],
        camera: [1.9, 1.5, 2.3],
        target: [0, 0.45, 0]
    },
    panda: {
        model: 'panda',
        label: 'Franka Emika Panda + Robotiq 2F-85',
        table: { width: 1.4, depth: 1.05 },
        arms: [{ position: [-0.22, 0, -0.18], yaw: -0.524 }],
        payload: [0.24, 0.05, 0.2],
        camera: [1.4, 1.2, 1.75],
        target: [0, 0.4, 0]
    }
};

// ============================================
// Model loading
// ============================================

const modelCache = new Map();

async function fetchModel(name) {
    if (modelCache.has(name)) return modelCache.get(name);

    const promise = (async () => {
        const base = `assets/robots/${name}`;
        const res = await fetch(`${base}/kinematics.json`);
        if (!res.ok) throw new Error(`kinematics.json missing for ${name}`);
        const kin = await res.json();

        const loader = new GLTFLoader();
        const meshes = new Map();

        await Promise.all(kin.links.filter(l => l.mesh).map(async link => {
            const gltf = await loader.loadAsync(`${base}/${link.mesh}`);
            gltf.scene.traverse(o => {
                if (!o.isMesh) return;
                // Menagerie bakes fairly metallic values; dial them back so the
                // arms read correctly under an indoor environment map.
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach(m => {
                    m.metalness = Math.min(m.metalness ?? 0.2, 0.18);
                    m.roughness = Math.max(m.roughness ?? 0.5, 0.42);
                });
            });
            meshes.set(link.name, gltf.scene);
        }));

        return { kin, meshes };
    })();

    modelCache.set(name, promise);
    return promise;
}

// Builds one instance. Meshes are cloned, so the two iiwa share geometry and
// materials — the second arm costs no extra download or GPU memory.
const armMaterials = new WeakMap();

function armMaterial(material, color) {
    const { r, g, b } = material.color;
    const orange = r > g * 1.5 && g > b * 1.5;
    const shell = Math.abs(r - g) < 0.001 && Math.abs(g - b) < 0.001 && r > 0.35 && r < 0.45;
    if (!orange && !shell) return material;
    if (!armMaterials.has(material)) armMaterials.set(material, new Map());
    const variants = armMaterials.get(material);
    if (!variants.has(color)) {
        const variant = material.clone();
        variant.color.set(color);
        variants.set(color, variant);
    }
    return variants.get(color);
}

function instantiate({ kin, meshes }, armColor) {
    const frames = [];
    const joints = new Map();
    const robotRoot = new THREE.Group(); // Z-up, as authored

    kin.links.forEach(link => {
        const frame = new THREE.Object3D();
        frame.position.fromArray(link.pos);
        if (link.quat) {
            const [w, x, y, z] = link.quat; // MJCF is wxyz, three.js is xyzw
            // normalize() is essential, not defensive: MJCF quaternions may be
            // unnormalised, and Matrix4.compose turns |q| != 1 into scale that
            // compounds down the chain.
            frame.quaternion.set(x, y, z, w).normalize();
        }

        // Joint motion applies on top of the fixed frame; children hang off it.
        const jointNode = new THREE.Object3D();
        frame.add(jointNode);

        const mesh = meshes.get(link.name);
        if (mesh) {
            const clone = mesh.clone(true);
            // Object3D.clone SHARES geometry and materials with the cached
            // template. Flag them so disposeScene() leaves them alone —
            // disposing here would break every later instantiation.
            clone.traverse(o => {
                o.userData.sharedAsset = true;
                if (armColor && o.isMesh && !link.name.startsWith('handumi_') && link.name !== 'link7') {
                    o.material = Array.isArray(o.material)
                        ? o.material.map(m => armMaterial(m, armColor)) : armMaterial(o.material, armColor);
                }
            });
            jointNode.add(clone);
        }

        (link.parent === -1 ? robotRoot : frames[link.parent].jointNode).add(frame);
        frames.push({ frame, jointNode });

        if (link.joint) {
            joints.set(link.joint.name, {
                node: jointNode,
                axis: new THREE.Vector3().fromArray(link.joint.axis),
                type: link.joint.type,
                range: link.joint.range,
                pivot: link.joint.pos ? new THREE.Vector3().fromArray(link.joint.pos) : null
            });
        }
    });

    // MuJoCo is Z-up; three.js scenes here are Y-up. This conversion gets its
    // OWN group: placement (position/yaw) must be applied in the outer Y-up
    // frame, or the yaw composes with the -90° tilt and lays the robot over.
    const zUp = new THREE.Group();
    zUp.rotation.x = -Math.PI / 2;
    zUp.add(robotRoot);

    const object = new THREE.Group();
    object.add(zUp);

    const armJoints = [...joints.keys()].filter(n => ARM_JOINT.test(n)).sort();
    return { object, joints, armJoints, gripper: kin.gripper };
}

function applyJoint(joint, value) {
    if (!joint) return;
    let v = value ?? 0;
    if (joint.range) v = Math.max(joint.range[0], Math.min(joint.range[1], v));
    if (joint.type === 'slide') {
        joint.node.position.copy(joint.axis).multiplyScalar(v);
    } else {
        joint.node.quaternion.setFromAxisAngle(joint.axis, v);
        if (joint.pivot) {
            joint.node.position.copy(joint.pivot).applyQuaternion(joint.node.quaternion)
                .negate().add(joint.pivot);
        }
    }
}

function setPose(robot, q, grip = 0.03) {
    robot.armJoints.forEach((name, i) => applyJoint(robot.joints.get(name), q[i]));
    if (robot.gripper) {
        const opening = Math.max(0, Math.min(1, grip / robot.gripper.open));
        Object.entries(robot.gripper.joints).forEach(([name, poses]) => {
            const sample = opening * (poses.length - 1);
            const low = Math.floor(sample);
            const high = Math.min(low + 1, poses.length - 1);
            applyJoint(robot.joints.get(name), poses[low] + (poses[high] - poses[low]) * (sample - low));
        });
    }
}

// ============================================
// Scene furniture
// ============================================

function makeMaterial(color, { rough = 0.45, metal = 0.15 } = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

let SHADOW_TEX = null;
function shadowTexture() {
    if (SHADOW_TEX) return SHADOW_TEX;
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.4)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    SHADOW_TEX = new THREE.CanvasTexture(c);
    return SHADOW_TEX;
}

function addShadow(scene, x, z, radius) {
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 2, radius * 2),
        new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.006, z);
    scene.add(mesh);
    return mesh;
}

function buildTable(width, depth, colors) {
    const group = new THREE.Group();

    // Work surface — its top face sits exactly at y = 0, the robots' floor.
    const topColor = new THREE.Color(colors.surface).offsetHSL(0, 0, colors.isDark ? 0.06 : -0.04);
    const top = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.04, depth),
        makeMaterial(topColor, { rough: 0.8, metal: 0.05 })
    );
    top.position.y = -0.02;
    group.add(top);

    // Rim, tucked below the surface and slightly wider so it only shows from
    // the side. Keep it under y = -0.04 or it covers the work surface.
    const rim = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.03, 0.03, depth + 0.03),
        makeMaterial(new THREE.Color(colors.border), { rough: 0.7, metal: 0.1 })
    );
    rim.position.y = -0.055;
    group.add(rim);

    return group;
}

// ============================================
// Trajectories
// ============================================

let TRAJECTORIES = {};

async function loadTrajectories() {
    try {
        const res = await fetch('data/trajectories.json');
        if (!res.ok) return {};
        return await res.json();
    } catch {
        return {}; // optional file - stationary ready poses are the fallback
    }
}

function sampleTrack(track, t, fps, loop) {
    const frames = track.length;
    if (!frames) return null;
    if (frames === 1) return track[0];

    const duration = frames / fps;
    const u = loop === false ? Math.min(t, duration - 1e-6) : t % duration;
    const f = u * fps;
    const i0 = Math.floor(f) % frames;
    const i1 = loop === false ? Math.min(i0 + 1, frames - 1) : (i0 + 1) % frames;
    const a = f - Math.floor(f);

    const q0 = track[i0];
    const q1 = track[i1] || q0;
    if (typeof q0 === 'number') return q0 + (q1 - q0) * a;
    return q0.map((v, k) => v + (q1[k] - v) * a);
}

function sampleTrajectory(traj, t) {
    const fps = traj.fps || 10;
    return traj.arms.map(arm => ({
        q: sampleTrack(arm.q, t, fps, traj.loop),
        grip: arm.grip ? sampleTrack(arm.grip, t, fps, traj.loop) : undefined
    }));
}

// Fallback idle motion, expressed around each robot's neutral pose.
// Valid downward-facing poses when the optional motion file is unavailable.
const REST_POSES = {
    iiwa: [
        [-0.3196585, 0.2603071, -0.0455756, -1.7831835, 0.0131687, 1.0983954, -0.8696931],
        [0.3155760, 0.2564195, 0.0463070, -1.7882477, -0.0131924, 1.0972239, 0.8663879]
    ],
    panda: [[-0.0665258, -0.1958685, -0.0431810, -2.3595409, -0.0101313, 2.1638265, 0.9435765]]
};

// ============================================
// Viewer
// ============================================

class RobotViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.setupName = canvas.dataset.robotSetup;
        this.setup = SETUPS[this.setupName];
        if (!this.setup) throw new Error(`Unknown robot setup: ${this.setupName}`);

        this.panel = canvas.closest('.viewer');
        this.withTable = canvas.dataset.robotTable !== 'false';
        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.visible = false;
        this.needsRender = true;
        this.playing = !REDUCED_MOTION;
        this.robots = [];

        this.trajectories = TRAJECTORIES[this.setupName] || [];
        this.trajectoryIndex = 0;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'low-power'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearAlpha(0);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);

        // Indoor environment map — metal and plastic look flat without one.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.enablePan = false;
        this.controls.minDistance = 0.9;
        this.controls.maxDistance = 6.0;
        this.controls.maxPolarAngle = Math.PI * 0.49; // never dip below the table
        this.controls.addEventListener('change', () => { this.needsRender = true; });

        this.buildScene();
        this.observe();
        this.loop = this.loop.bind(this);
        requestAnimationFrame(this.loop);
    }

    get trajectory() {
        return this.trajectories[this.trajectoryIndex] || null;
    }

    buildScene() {
        const colors = themeColors();
        this.scene.environment = this.envMap;

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555a66, colors.isDark ? 0.5 : 0.8));

        const key = new THREE.DirectionalLight(0xffffff, colors.isDark ? 1.5 : 1.9);
        key.position.set(2.2, 3.4, 2.0);
        this.scene.add(key);

        const rim = new THREE.DirectionalLight(0xffffff, 0.4);
        rim.position.set(-2.4, 1.6, -1.8);
        this.scene.add(rim);

        if (this.withTable) {
            this.scene.add(buildTable(this.setup.table.width, this.setup.table.depth, colors));
        }

        if (this.setup.payload) {
            const size = this.setupName === 'bimanual' ? 0.09 : 0.075;
            this.payload = new THREE.Mesh(
                new THREE.BoxGeometry(size, size, size),
                makeMaterial(new THREE.Color(colors.accent), { rough: 0.35, metal: 0.1 })
            );
            this.payload.position.fromArray(this.setup.payload);
            this.scene.add(this.payload);
            addShadow(this.scene, this.setup.payload[0], this.setup.payload[2], size * 1.3);
        }

        this.camera.position.fromArray(this.setup.camera);
        this.controls.target.fromArray(this.setup.target);
        this.controls.update();

        this.setup.arms.forEach(p => addShadow(this.scene, p.position[0], p.position[2], 0.24));

        const extras = window.robotSceneExtras && window.robotSceneExtras[this.setupName];
        if (typeof extras === 'function') {
            try {
                extras({ scene: this.scene, THREE, colors, viewer: this, makeMaterial, addShadow });
            } catch (err) {
                console.error(`robotSceneExtras.${this.setupName} failed:`, err);
            }
        }

        this.resize();
    }

    async loadArms() {
        const model = await fetchModel(this.setup.model);

        this.robots = this.setup.arms.map((placement, i) => {
            const robot = instantiate(model, placement.armColor);
            robot.object.position.fromArray(placement.position);
            robot.object.rotation.y = placement.yaw;
            robot.side = i === 0 ? -1 : 1;
            this.scene.add(robot.object);
            return robot;
        });

        this.updatePose(0);
        this.needsRender = true;
    }

    // Frees only the furniture this viewer created. Robot geometry/materials are
    // shared with the module-level model cache and must survive.
    disposeScene() {
        this.scene.traverse(obj => {
            if (obj.userData.sharedAsset) return;
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => m.dispose());
            }
        });
        this.scene.clear();
        this.robots = [];
    }

    // Only the theme-coloured furniture needs rebuilding; the arms are reused.
    async refreshTheme() {
        const cam = this.camera.position.clone();
        const target = this.controls.target.clone();
        this.disposeScene();
        this.buildScene();
        await this.loadArms();
        this.camera.position.copy(cam);
        this.controls.target.copy(target);
        this.controls.update();
        this.needsRender = true;
    }

    observe() {
        this.io = new IntersectionObserver(entries => {
            this.visible = entries[0].isIntersecting;
            this.needsRender = true;
        }, { rootMargin: '120px' });
        this.io.observe(this.canvas);

        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(this.canvas.parentElement);
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.needsRender = true;
    }

    updatePose(t) {
        if (!this.robots.length) return;

        const traj = this.trajectory;
        if (traj) {
            const samples = sampleTrajectory(traj, t);
            this.robots.forEach((robot, i) => {
                const s = samples[i] || samples[0];
                if (s && s.q) setPose(robot, s.q, s.grip);
            });
        } else {
            this.robots.forEach(robot => {
                setPose(robot, REST_POSES[this.setup.model][robot.side > 0 ? 1 : 0], 0.03);
            });
        }

        if (this.payload) this.payload.rotation.y = t * 0.25;
    }

    setPlaying(on) {
        this.playing = on;
        this.needsRender = true;
    }

    loop() {
        requestAnimationFrame(this.loop);

        const active = this.visible && !document.hidden;
        if (!active) { this.clock.getDelta(); return; }

        const dt = this.clock.getDelta();
        this.controls.update();

        if (this.playing) {
            this.elapsed += dt;
            this.updatePose(this.elapsed);
            this.needsRender = true;
            this.posed = false;
        } else if (!this.posed) {
            this.updatePose(this.elapsed);
            this.posed = true;
            this.needsRender = true;
        }

        if (this.needsRender) {
            this.renderer.render(this.scene, this.camera);
            this.needsRender = false;
        }
    }
}

// ============================================
// Playback controls
// ============================================

function buildControls(viewer) {
    const bar = viewer.panel && viewer.panel.querySelector('.viewer-toolbar');
    if (!bar) return;

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-sm';
    playBtn.type = 'button';
    const syncLabel = () => {
        playBtn.textContent = viewer.playing ? 'Pause' : 'Play';
        playBtn.setAttribute('aria-label', viewer.playing ? 'Pause motion' : 'Play motion');
    };
    syncLabel();
    playBtn.addEventListener('click', () => {
        viewer.setPlaying(!viewer.playing);
        syncLabel();
    });
    bar.appendChild(playBtn);
}

// ============================================
// Init
// ============================================

const viewers = [];

async function init() {
    if (!THREE) return; // CDN unavailable — reportViewerFailure already ran
    const canvases = document.querySelectorAll('canvas[data-robot-setup]');
    if (!canvases.length) return;

    TRAJECTORIES = await loadTrajectories();

    canvases.forEach(canvas => canvas.closest('.viewer')?.classList.add('viewer--loading'));

    await Promise.all([...canvases].map(async canvas => {
        const panel = canvas.closest('.viewer');
        try {
            const viewer = new RobotViewer(canvas);
            viewers.push(viewer);
            await viewer.loadArms();
            panel?.classList.remove('viewer--loading');
            panel?.classList.add('viewer--ready');
            buildControls(viewer);
        } catch (err) {
            console.error('Robot viewer failed:', err);
            panel?.classList.remove('viewer--loading');
            panel?.classList.add('viewer--failed');
            const fallback = panel?.querySelector('.viewer-fallback');
            if (fallback) fallback.textContent = 'Could not load the robot model. See the console for details.';
        }
    }));

    new MutationObserver(() => viewers.forEach(v => v.refreshTheme())).observe(
        document.documentElement,
        { attributes: true, attributeFilter: ['data-theme', 'data-palette'] }
    );

    window.robotViewers = viewers;
}

onReady(init);
