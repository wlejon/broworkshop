// ragdoll.js — humanoid ragdolls: articulated bodies, per-part impulses, and
// the two ways to drive a ragdoll toward a pose.
//
// A ragdoll is the one place where "a body" stops being a useful unit. Thirteen
// capsules joined by swing-twist constraints behave like nothing you can build
// out of primitives: the joints are what carry force from a punched forearm
// into the pelvis, and the cone limits are what stop the elbow bending the
// wrong way. So the demo is built around the two things you cannot see from a
// still frame — the joints holding, and the joints being POWERED.
//
// The pose drive is the headline. Physics.createRagdoll exposes both of Jolt's
// drive modes and they feel completely different:
//
//   driveToPose           motorised. Position motors on every swing+twist
//                         joint chase the target's parent-relative rotations.
//                         The ragdoll is still a pile of rigid bodies falling
//                         under gravity — it just develops muscle tone. Set it
//                         once; the motors persist until stopDrive().
//   driveToPoseKinematic  hard tracking. Part velocities are set so each part
//                         reaches its target TRANSFORM in dt. Positions are
//                         honoured, so this one actually stands the ragdoll up
//                         — and it shoves anything in the way, because the
//                         parts are still real bodies.
//
// Motorised drive settles into the pose and then sags under load; kinematic
// drive snaps to it and refuses to be pushed. Toggle the checkbox mid-drive and
// the difference is unmistakable.
//
// Target poses are computed by forward kinematics over the same part spec that
// built the ragdoll (see buildPose below), so a pose is authored as a handful
// of per-joint rotation deltas rather than as 91 hand-tuned floats.

const DEG = Math.PI / 180;

// --- Minimal quaternion helpers ---------------------------------------------
// Physics speaks {x,y,z,w}; Camera's helpers speak arrays and are camera-shaped.
// Four functions is cheaper than an adapter.

const qmul = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qaxis = (ax, ay, az, a) => {
    const s = Math.sin(a / 2);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) };
};
const QI = { x: 0, y: 0, z: 0, w: 1 };

/** Rotate a {x,y,z} vector by a quaternion. */
function qrot(q, v) {
    const { x, y, z, w } = q;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return {
        x: v.x + w * tx + (y * tz - z * ty),
        y: v.y + w * ty + (z * tx - x * tz),
        z: v.z + w * tz + (x * ty - y * tx),
    };
}

/** Shortest angle between two orientations, radians. */
function qangle(a, b) {
    const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    return 2 * Math.acos(Math.min(1, d));
}

// --- The humanoid ------------------------------------------------------------
//
// Model space, feet at y ≈ 0, facing +Z. Parents strictly before children —
// Jolt requires it and createRagdoll will reject the array otherwise.
//
// Capsules are Y-axis-aligned in part-local space, which is free for the spine
// and the legs and costs a 90-degree bind rotation for each arm. That bind
// rotation is why the arms also need an explicit twistAxis: the default twist
// axis is the parent->child bind direction, which for a shoulder is sideways,
// and a shoulder that twists about its own length is exactly right.
const HALF = Math.SQRT1_2;

export const PARTS = [
    { name: 'pelvis', shape: 'capsule', halfHeight: 0.09, radius: 0.13,
      position: { x: 0, y: 0.95, z: 0 } },

    { name: 'spine', parent: 'pelvis', shape: 'capsule', halfHeight: 0.10, radius: 0.12,
      position: { x: 0, y: 1.22, z: 0 },
      joint: { point: { x: 0, y: 1.08, z: 0 }, normalHalfConeAngle: 30 * DEG,
               twistMin: -25 * DEG, twistMax: 25 * DEG } },

    { name: 'chest', parent: 'spine', shape: 'capsule', halfHeight: 0.11, radius: 0.15,
      position: { x: 0, y: 1.50, z: 0 },
      joint: { point: { x: 0, y: 1.36, z: 0 }, normalHalfConeAngle: 25 * DEG,
               twistMin: -20 * DEG, twistMax: 20 * DEG } },

    { name: 'head', parent: 'chest', shape: 'sphere', radius: 0.12,
      position: { x: 0, y: 1.82, z: 0 },
      joint: { point: { x: 0, y: 1.66, z: 0 }, normalHalfConeAngle: 40 * DEG,
               twistMin: -50 * DEG, twistMax: 50 * DEG } },

    // Right arm (+X). Rotated -90 deg about Z lays the capsule along +X.
    { name: 'upperArmR', parent: 'chest', shape: 'capsule', halfHeight: 0.11, radius: 0.055,
      position: { x: 0.40, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: -HALF, w: HALF },
      joint: { point: { x: 0.26, y: 1.58, z: 0 }, twistAxis: { x: 1, y: 0, z: 0 },
               normalHalfConeAngle: 85 * DEG, twistMin: -60 * DEG, twistMax: 60 * DEG } },
    { name: 'lowerArmR', parent: 'upperArmR', shape: 'capsule', halfHeight: 0.11, radius: 0.048,
      position: { x: 0.68, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: -HALF, w: HALF },
      joint: { point: { x: 0.54, y: 1.58, z: 0 }, twistAxis: { x: 1, y: 0, z: 0 },
               normalHalfConeAngle: 75 * DEG, twistMin: -20 * DEG, twistMax: 20 * DEG } },

    // Left arm (-X), mirrored.
    { name: 'upperArmL', parent: 'chest', shape: 'capsule', halfHeight: 0.11, radius: 0.055,
      position: { x: -0.40, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: HALF, w: HALF },
      joint: { point: { x: -0.26, y: 1.58, z: 0 }, twistAxis: { x: 1, y: 0, z: 0 },
               normalHalfConeAngle: 85 * DEG, twistMin: -60 * DEG, twistMax: 60 * DEG } },
    { name: 'lowerArmL', parent: 'upperArmL', shape: 'capsule', halfHeight: 0.11, radius: 0.048,
      position: { x: -0.68, y: 1.58, z: 0 }, rotation: { x: 0, y: 0, z: HALF, w: HALF },
      joint: { point: { x: -0.54, y: 1.58, z: 0 }, twistAxis: { x: 1, y: 0, z: 0 },
               normalHalfConeAngle: 75 * DEG, twistMin: -20 * DEG, twistMax: 20 * DEG } },

    // Legs. No bind rotation: a leg already runs along the capsule's own Y.
    { name: 'upperLegR', parent: 'pelvis', shape: 'capsule', halfHeight: 0.16, radius: 0.075,
      position: { x: 0.14, y: 0.62, z: 0 },
      joint: { point: { x: 0.14, y: 0.85, z: 0 }, twistAxis: { x: 0, y: -1, z: 0 },
               normalHalfConeAngle: 70 * DEG, twistMin: -30 * DEG, twistMax: 30 * DEG } },
    { name: 'lowerLegR', parent: 'upperLegR', shape: 'capsule', halfHeight: 0.16, radius: 0.062,
      position: { x: 0.14, y: 0.22, z: 0 },
      joint: { point: { x: 0.14, y: 0.42, z: 0 }, twistAxis: { x: 0, y: -1, z: 0 },
               normalHalfConeAngle: 65 * DEG, twistMin: -10 * DEG, twistMax: 10 * DEG } },

    { name: 'upperLegL', parent: 'pelvis', shape: 'capsule', halfHeight: 0.16, radius: 0.075,
      position: { x: -0.14, y: 0.62, z: 0 },
      joint: { point: { x: -0.14, y: 0.85, z: 0 }, twistAxis: { x: 0, y: -1, z: 0 },
               normalHalfConeAngle: 70 * DEG, twistMin: -30 * DEG, twistMax: 30 * DEG } },
    { name: 'lowerLegL', parent: 'upperLegL', shape: 'capsule', halfHeight: 0.16, radius: 0.062,
      position: { x: -0.14, y: 0.22, z: 0 },
      joint: { point: { x: -0.14, y: 0.42, z: 0 }, twistAxis: { x: 0, y: -1, z: 0 },
               normalHalfConeAngle: 65 * DEG, twistMin: -10 * DEG, twistMax: 10 * DEG } },
];

export const PART_NAMES = PARTS.map(p => p.name);
const parentOf = PARTS.map(p => (p.parent == null ? -1 : PART_NAMES.indexOf(p.parent)));

/** Height of the pelvis in the bind pose — the "standing" root height. */
const PELVIS_BIND_Y = PARTS[0].position.y;

// --- Target poses ------------------------------------------------------------
//
// A pose is a set of rotation deltas, each expressed in its own part's LOCAL
// frame and applied AFTER the bind relative rotation. Identity everywhere is
// therefore exactly the bind pose, which is what makes 'stand' free.
//
// The arms are the readable case: upperArmR binds at Rz(-90) so the capsule
// lies along +X. A local delta of Rz(+90) cancels that back to identity, and
// the capsule points straight up. Same trick mirrored on the left.

export const POSES = {
    stand: {},
    reach: {
        upperArmR: qaxis(0, 0, 1,  90 * DEG),
        upperArmL: qaxis(0, 0, 1, -90 * DEG),
        spine:     qaxis(1, 0, 0, -10 * DEG),
    },
    tuck: {
        spine:     qaxis(1, 0, 0,  25 * DEG),
        chest:     qaxis(1, 0, 0,  20 * DEG),
        upperLegR: qaxis(1, 0, 0, -75 * DEG),
        upperLegL: qaxis(1, 0, 0, -75 * DEG),
        lowerLegR: qaxis(1, 0, 0,  70 * DEG),
        lowerLegL: qaxis(1, 0, 0,  70 * DEG),
        upperArmR: qaxis(0, 0, 1,  55 * DEG),
        upperArmL: qaxis(0, 0, 1, -55 * DEG),
    },
};
export const POSE_NAMES = Object.keys(POSES);

// Precomputed rig constants, all derived from PARTS so the spec stays the
// single source of truth:
//   rel[i] parent-relative bind rotation
//   a[i]   parent-center -> joint pivot, in the PARENT's bind frame
//   b[i]   joint pivot -> part center, in the CHILD's bind frame
const rel = [], armA = [], armB = [];
for (let i = 0; i < PARTS.length; i++) {
    const p = PARTS[i];
    const bindRot = p.rotation || QI;
    const pi = parentOf[i];
    if (pi < 0) { rel.push(bindRot); armA.push({ x: 0, y: 0, z: 0 }); armB.push({ x: 0, y: 0, z: 0 }); continue; }
    const parentRot = PARTS[pi].rotation || QI;
    rel.push(qmul(qconj(parentRot), bindRot));
    const pivot = (p.joint && p.joint.point) || p.position;
    const pp = PARTS[pi].position;
    armA.push(qrot(qconj(parentRot), { x: pivot.x - pp.x, y: pivot.y - pp.y, z: pivot.z - pp.z }));
    armB.push(qrot(qconj(bindRot),   { x: p.position.x - pivot.x, y: p.position.y - pivot.y, z: p.position.z - pivot.z }));
}

/**
 * Forward-kinematics a named pose into the world-space pose array the drive
 * calls want: partCount * 7 floats, [px,py,pz, qx,qy,qz,qw] per part.
 *
 * driveToPose only reads the parent-relative ROTATIONS, so for the motorised
 * path the root frame is irrelevant. driveToPoseKinematic reads positions too,
 * which is why the root is placed deliberately: over the ragdoll's current XZ,
 * at the bind pelvis height, upright. That placement is what turns a limp heap
 * into a figure standing on the floor.
 *
 * @param {string} poseName
 * @param {{x,y,z}} [rootPos]  - world pelvis position (default = bind height at origin)
 * @param {{x,y,z,w}} [rootRot]
 * @returns {Float32Array}
 */
export function buildPose(poseName, rootPos, rootRot) {
    const deltas = POSES[poseName] || POSES.stand;
    const n = PARTS.length;
    const out = new Float32Array(n * 7);
    const wr = new Array(n), wp = new Array(n);

    for (let i = 0; i < n; i++) {
        const d = deltas[PARTS[i].name] || QI;
        const pi = parentOf[i];
        if (pi < 0) {
            wr[i] = qmul(rootRot || QI, qmul(rel[i], d));
            wp[i] = rootPos || { x: 0, y: PELVIS_BIND_Y, z: 0 };
        } else {
            wr[i] = qmul(wr[pi], qmul(rel[i], d));
            const a = qrot(wr[pi], armA[i]);
            const b = qrot(wr[i], armB[i]);
            wp[i] = { x: wp[pi].x + a.x + b.x, y: wp[pi].y + a.y + b.y, z: wp[pi].z + a.z + b.z };
        }
        const o = i * 7;
        out[o] = wp[i].x; out[o + 1] = wp[i].y; out[o + 2] = wp[i].z;
        out[o + 3] = wr[i].x; out[o + 4] = wr[i].y; out[o + 5] = wr[i].z; out[o + 6] = wr[i].w;
    }
    return out;
}

/** The parent-relative target rotations of a pose — what driveToPose acts on. */
function poseRelRotations(poseName) {
    const deltas = POSES[poseName] || POSES.stand;
    return PARTS.map((p, i) => qmul(rel[i], deltas[p.name] || QI));
}

// --- Registry ----------------------------------------------------------------

/** id -> { id, rd, nodes, drive } */
export const ragdolls = new Map();
/** part body tag -> { entry, index } — the click-to-punch lookup. */
const partIndexByTag = new Map();

let sceneRef = null;
let nextId = 1;

export function initRagdolls(scene) { sceneRef = scene; }
export const ragdollCount = () => ragdolls.size;

/** Total simulated parts across every live ragdoll — the HUD readout. */
export function totalPartCount() {
    let n = 0;
    for (const e of ragdolls.values()) n += e.rd.partCount;
    return n;
}

const SKIN = '#d8a37a';
const CLOTH = '#4f6fa8';
const PART_COLOR = (name) =>
    (name === 'head' ? SKIN :
     name.startsWith('lowerArm') ? SKIN : CLOTH);

/**
 * Spawn one ragdoll with its visuals.
 *
 * Each part gets its own PhysicsNode bound to that part's body tag — part
 * bodies are ordinary bodies, so the same visual plumbing spawn.js uses for a
 * loose box works here unchanged, and the parts inherit render interpolation
 * along with everything else.
 */
export function spawnRagdoll(pos = { x: 0, y: 3, z: 0 }, opts = {}) {
    if (!sceneRef) throw new Error('ragdoll.js: initRagdolls(scene) not called');

    const rd = Physics.createRagdoll({
        position: pos,
        rotation: opts.rotation,
        layer: opts.layer || 'player',
        linearDamping: opts.linearDamping ?? 0.08,
        angularDamping: opts.angularDamping ?? 0.15,
        // A modest default spring. Too stiff and the motorised drive stops
        // being distinguishable from the kinematic one, which would defeat the
        // whole point of offering both.
        motor: { frequency: opts.frequency ?? 12, damping: opts.damping ?? 1.0, maxTorque: opts.maxTorque ?? -1 },
        parts: PARTS,
    });

    const nodes = [];
    const meshes = [];
    for (let i = 0; i < rd.partCount; i++) {
        const spec = PARTS[i];
        const tag = rd.partBody(i);
        const node = sceneRef.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
        const color = PART_COLOR(spec.name);
        const mesh = spec.shape === 'sphere'
            ? sceneRef.createMesh({ mesh: 'sphere', radius: spec.radius, segments: 18, rings: 14, color, roughness: 0.7 })
            : sceneRef.createMesh({ mesh: 'capsule', radius: spec.radius, halfHeight: spec.halfHeight, segments: 14, color, roughness: 0.75 });
        node.add(mesh);
        nodes.push(node);
        meshes.push(mesh);
    }

    const entry = {
        id: nextId++,
        rd, nodes, meshes,
        // Kinematic drive is incremental pursuit, not a teleport — it has to be
        // re-issued every step, so the mode is stored and replayed in update().
        drive: { mode: 'off', pose: 'stand', kinematic: false },
    };
    ragdolls.set(entry.id, entry);
    for (let i = 0; i < rd.partCount; i++) partIndexByTag.set(rd.partBody(i), { entry, index: i });
    return entry;
}

/** Several at once, scattered and tumbling — the "ragdoll rain" button. */
export function ragdollRain(n = 5, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const e = spawnRagdoll({
            x: -6 + Math.random() * 20,
            y: 6 + i * 1.6 + Math.random() * 2,
            z: -6 + Math.random() * 12,
        }, {
            // A random yaw so they do not all land in the same heap facing the
            // same way, and a spin so the joints are loaded on the way down.
            rotation: qaxis(0, 1, 0, Math.random() * Math.PI * 2),
            ...opts,
        });
        e.rd.addImpulse((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
        out.push(e);
    }
    return out;
}

// --- Driving -----------------------------------------------------------------

/**
 * Start driving a ragdoll toward a named pose.
 *
 * @param {Object} entry
 * @param {string} poseName - a key of POSES
 * @param {boolean} kinematic - false = motorised (driveToPose, set once),
 *                              true = hard tracking (driveToPoseKinematic,
 *                              re-issued every frame from update()).
 */
export function driveRagdoll(entry, poseName, kinematic, motor) {
    if (!entry) return false;
    entry.drive.pose = poseName;
    entry.drive.kinematic = !!kinematic;
    entry.drive.mode = kinematic ? 'kinematic' : 'motor';
    entry.rd.activate();

    if (!kinematic) {
        // Motors persist until stopDrive, so this is a one-shot call. Positions
        // in the array are ignored; only the relative rotations matter, which
        // is why the root frame can be the plain bind frame here.
        return entry.rd.driveToPose(buildPose(poseName), motor);
    }
    // Kinematic tracking needs a real world target — see buildPose's comment.
    entry.rd.stopDrive();
    return true;
}

/** Motors off — the ragdoll goes limp again mid-air. */
export function stopDrive(entry) {
    if (!entry) return false;
    entry.drive.mode = 'off';
    entry.rd.stopDrive();
    return true;
}

/**
 * Per-frame work: re-issue kinematic targets. Nothing else needs a tick —
 * motorised drive and the part visuals both look after themselves.
 */
export function updateRagdolls(dt = 1 / 60) {
    for (const e of ragdolls.values()) {
        if (e.drive.mode !== 'kinematic') continue;
        const p = Physics.getTransform(e.rd.partBody(0)).position;
        const target = buildPose(e.drive.pose, { x: p.x, y: PELVIS_BIND_Y, z: p.z });
        e.rd.driveToPoseKinematic(target, Math.max(1 / 240, dt));
    }
}

/**
 * Mean parent-relative rotation error against a target pose, in radians.
 *
 * This is the honest measure of whether a drive is working. driveToPose does
 * not move the ragdoll anywhere — it powers the JOINTS — so "did the head go
 * up" is the wrong question. "Did every joint angle get closer to the target"
 * is the right one, and it is exactly what the motors are solving for.
 */
export function poseError(entry, poseName) {
    if (!entry) return NaN;
    const target = poseRelRotations(poseName);
    const lp = entry.rd.localPose();
    let sum = 0;
    // The root's world orientation is not driven, so it is not part of the error.
    for (let i = 1; i < entry.rd.partCount; i++) {
        const o = i * 7;
        sum += qangle({ x: lp[o + 3], y: lp[o + 4], z: lp[o + 5], w: lp[o + 6] }, target[i]);
    }
    return sum / (entry.rd.partCount - 1);
}

/**
 * Largest joint separation error across the ragdoll, in metres.
 *
 * A swing-twist constraint pins one POINT — the pivot — shared by parent and
 * child. It does not pin the distance between the two part centres, and it
 * must not: rotate a hip and the pelvis-to-thigh centre distance changes by
 * centimetres while the joint itself has not moved at all. So the honest
 * measure of "are the joints holding" is to reconstruct the pivot from each
 * side of every joint and compare. Both reconstructions use the same bind
 * offsets the rig was built from, so a healthy ragdoll reports millimetres.
 */
export function jointResidual(entry) {
    if (!entry) return NaN;
    const pose = entry.rd.pose();
    const at = (i) => ({
        p: { x: pose[i * 7], y: pose[i * 7 + 1], z: pose[i * 7 + 2] },
        q: { x: pose[i * 7 + 3], y: pose[i * 7 + 4], z: pose[i * 7 + 5], w: pose[i * 7 + 6] },
    });
    let worst = 0;
    for (let i = 1; i < entry.rd.partCount; i++) {
        const pi = parentOf[i];
        const par = at(pi), me = at(i);
        const a = qrot(par.q, armA[i]);          // parent centre -> pivot
        const b = qrot(me.q, armB[i]);           // pivot -> child centre
        const dx = (par.p.x + a.x) - (me.p.x - b.x);
        const dy = (par.p.y + a.y) - (me.p.y - b.y);
        const dz = (par.p.z + a.z) - (me.p.z - b.z);
        worst = Math.max(worst, Math.hypot(dx, dy, dz));
    }
    return worst;
}

// --- Per-part interaction ----------------------------------------------------

/** Body tag -> which ragdoll and which part, or null. */
export function findPart(tag) {
    return partIndexByTag.get(tag) || null;
}

/**
 * Punch one part. Impulse is scaled by that part's own mass so a jab at the
 * forearm and a jab at the pelvis feel like the same punch rather than the
 * forearm being launched into orbit.
 */
export function punchPart(entry, index, dir = { x: 0, y: 1, z: 0 }, strength = 12) {
    if (!entry || index < 0 || index >= entry.rd.partCount) return false;
    const tag = entry.rd.partBody(index);
    const props = Physics.getBodyProperties(tag);
    const k = strength * Math.max(0.5, props ? props.mass : 1);
    entry.rd.activate();
    Physics.addImpulse(tag, dir.x * k, dir.y * k, dir.z * k);
    return true;
}

// --- Selection marker --------------------------------------------------------
//
// The selected part is recoloured in place. `MeshNode.color` reads the current
// tint back as [r,g,b,a], so the part's own colour is stashed on select and put
// back on deselect — no extra geometry, and the whole limb lights up rather
// than a pip sitting somewhere on it. Parts carry no emissive, so the base
// colour is the entire visual and swapping it is an unambiguous read.

const SELECT_COLOR = '#7bed9f';

let markedMesh = null;      // the mesh currently wearing SELECT_COLOR
let markedColor = null;     // its original [r,g,b,a]
export const selection = { entry: null, index: -1 };

export function selectPart(entry, index) {
    if (markedMesh) { markedMesh.color = markedColor; markedMesh = null; markedColor = null; }
    selection.entry = entry || null;
    selection.index = entry ? index : -1;
    if (!entry || !sceneRef) return null;
    const mesh = entry.meshes && entry.meshes[index];
    if (mesh) {
        markedColor = mesh.color;
        markedMesh = mesh;
        mesh.color = SELECT_COLOR;
    }
    return { entry, index, name: PART_NAMES[index] };
}

/** Human-readable description of the current selection, for the HUD. */
export function selectionLabel() {
    if (!selection.entry) return null;
    return { id: selection.entry.id, index: selection.index, name: PART_NAMES[selection.index] };
}

// --- Teardown ----------------------------------------------------------------

/**
 * Destroy one ragdoll. rd.destroy() takes the bodies AND the joints — there is
 * no way to remove a single part, since destroying any part body tears down
 * the whole set anyway.
 */
export function despawnRagdoll(entry) {
    if (!entry || !ragdolls.has(entry.id)) return false;
    if (selection.entry === entry) selectPart(null, -1);
    for (let i = 0; i < entry.rd.partCount; i++) partIndexByTag.delete(entry.rd.partBody(i));
    for (const n of entry.nodes) if (n && n.destroy) n.destroy();
    entry.rd.destroy();
    ragdolls.delete(entry.id);
    return true;
}

export function clearRagdolls() {
    for (const e of [...ragdolls.values()]) despawnRagdoll(e);
}
