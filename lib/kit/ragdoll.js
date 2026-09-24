// lib/kit/ragdoll.js — a 12-part humanoid ragdoll rig for Physics.createRagdoll.
//
// Model space, feet at y ~ 0, facing +Z. Parents come strictly before
// children (Jolt requires it). Capsules are Y-aligned in part space, which is
// free for the spine and legs and costs a 90-degree bind rotation per arm;
// that is why the arms also carry an explicit twistAxis (the default twist
// axis is the parent->child bind direction, sideways for a shoulder).
//
// A POSE here is a map of part name -> rotation delta ({x,y,z,w}), each in its
// part's LOCAL frame and applied after the bind rotation. `{}` is exactly the
// bind (standing) pose, so animation clips and target poses are a handful of
// per-joint rotations rather than 84 floats. buildPose() forward-kinematics
// one into the flat world pose the drive calls take.
//
//   import { spawnRagdoll, buildPose } from "/lib/kit/ragdoll.js";
//   const r = spawnRagdoll(scene, { position: { x: 0, y: 3, z: 0 } });
//   r.rd.driveToPose(buildPose({ upperArmR: q.axis(0, 0, 1, Math.PI / 2) }));
//
// (Skinned-mesh humanoid clips live in lib/kit/humanoid.js; this is the
// physics rig.)

import { q, QI } from "./physics3d.js";

const DEG = Math.PI / 180;
const HALF = Math.SQRT1_2;

export const PARTS = [
    { name: 'pelvis', shape: 'capsule', halfHeight: 0.09, radius: 0.13,
      position: { x: 0, y: 0.95, z: 0 } },
    { name: 'spine', parent: 'pelvis', shape: 'capsule', halfHeight: 0.10, radius: 0.12,
      position: { x: 0, y: 1.22, z: 0 },
      joint: { point: { x: 0, y: 1.08, z: 0 }, normalHalfConeAngle: 30 * DEG, twistMin: -25 * DEG, twistMax: 25 * DEG } },
    { name: 'chest', parent: 'spine', shape: 'capsule', halfHeight: 0.11, radius: 0.15,
      position: { x: 0, y: 1.50, z: 0 },
      joint: { point: { x: 0, y: 1.36, z: 0 }, normalHalfConeAngle: 25 * DEG, twistMin: -20 * DEG, twistMax: 20 * DEG } },
    { name: 'head', parent: 'chest', shape: 'sphere', radius: 0.12,
      position: { x: 0, y: 1.82, z: 0 },
      joint: { point: { x: 0, y: 1.66, z: 0 }, normalHalfConeAngle: 40 * DEG, twistMin: -50 * DEG, twistMax: 50 * DEG } },

    // Right arm (+X): Rz(-90) lays the capsule along +X.
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

    // Legs: no bind rotation, a leg already runs along the capsule's Y.
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

export const PART_NAMES = PARTS.map((p) => p.name);
export const partIndex = (name) => PART_NAMES.indexOf(name);
const parentOf = PARTS.map((p) => (p.parent == null ? -1 : PART_NAMES.indexOf(p.parent)));

/** Pelvis height in the bind pose: the standing root height. */
export const PELVIS_BIND_Y = PARTS[0].position.y;

// Rig constants derived from PARTS (the single source of truth):
//   rel[i]  parent-relative bind rotation
//   armA[i] parent centre -> joint pivot, in the parent's bind frame
//   armB[i] joint pivot -> part centre, in the child's bind frame
const rel = [], armA = [], armB = [];
for (let i = 0; i < PARTS.length; i++) {
    const p = PARTS[i];
    const bindRot = p.rotation || QI;
    const pi = parentOf[i];
    if (pi < 0) { rel.push(bindRot); armA.push({ x: 0, y: 0, z: 0 }); armB.push({ x: 0, y: 0, z: 0 }); continue; }
    const parentRot = PARTS[pi].rotation || QI;
    rel.push(q.mul(q.conj(parentRot), bindRot));
    const pivot = (p.joint && p.joint.point) || p.position;
    const pp = PARTS[pi].position;
    armA.push(q.rot(q.conj(parentRot), { x: pivot.x - pp.x, y: pivot.y - pp.y, z: pivot.z - pp.z }));
    armB.push(q.rot(q.conj(bindRot), { x: p.position.x - pivot.x, y: p.position.y - pivot.y, z: p.position.z - pivot.z }));
}

/**
 * Forward-kinematics a pose (name -> local delta) into the world pose array
 * the drives take: 7 floats per part, [px,py,pz, qx,qy,qz,qw].
 * driveToPose reads only the parent-relative rotations, so the root frame is
 * irrelevant there; driveToPoseKinematic and setPose read positions too.
 * rootPos defaults to the bind pelvis at the origin.
 */
export function buildPose(deltas, rootPos, rootRot) {
    const d = deltas || {};
    const n = PARTS.length;
    const out = new Float32Array(n * 7);
    const wr = new Array(n), wp = new Array(n);
    for (let i = 0; i < n; i++) {
        const dl = d[PARTS[i].name] || QI;
        const pi = parentOf[i];
        if (pi < 0) {
            wr[i] = q.mul(rootRot || QI, q.mul(rel[i], dl));
            wp[i] = rootPos || { x: 0, y: PELVIS_BIND_Y, z: 0 };
        } else {
            wr[i] = q.mul(wr[pi], q.mul(rel[i], dl));
            const a = q.rot(wr[pi], armA[i]);
            const b = q.rot(wr[i], armB[i]);
            wp[i] = { x: wp[pi].x + a.x + b.x, y: wp[pi].y + a.y + b.y, z: wp[pi].z + a.z + b.z };
        }
        const o = i * 7;
        out[o] = wp[i].x; out[o + 1] = wp[i].y; out[o + 2] = wp[i].z;
        out[o + 3] = wr[i].x; out[o + 4] = wr[i].y; out[o + 5] = wr[i].z; out[o + 6] = wr[i].w;
    }
    return out;
}

/** Part i of a flat pose array as { p, r }. */
export function posePart(pose, i) {
    const o = i * 7;
    return {
        p: { x: pose[o], y: pose[o + 1], z: pose[o + 2] },
        r: { x: pose[o + 3], y: pose[o + 4], z: pose[o + 5], w: pose[o + 6] },
    };
}

/** Per-part blend of two flat poses: positions lerp, rotations slerp. */
export function lerpPose(a, b, t) {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length / 7; i++) {
        const A = posePart(a, i), B = posePart(b, i);
        const r = q.slerp(A.r, B.r, t);
        const o = i * 7;
        out[o] = A.p.x + (B.p.x - A.p.x) * t;
        out[o + 1] = A.p.y + (B.p.y - A.p.y) * t;
        out[o + 2] = A.p.z + (B.p.z - A.p.z) * t;
        out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w;
    }
    return out;
}

/**
 * Mean parent-relative rotation error of a ragdoll against a pose, radians.
 * The honest measure of a motorised drive: driveToPose powers the JOINTS, it
 * does not move the figure anywhere. The undriven root is excluded.
 */
export function poseError(rd, deltas) {
    const d = deltas || {};
    const lp = rd.localPose();
    let sum = 0;
    for (let i = 1; i < rd.partCount; i++) {
        const target = q.mul(rel[i], d[PARTS[i].name] || QI);
        sum += q.angle(posePart(lp, i).r, target);
    }
    return sum / (rd.partCount - 1);
}

/**
 * Worst joint separation across the ragdoll, metres. A swing-twist joint pins
 * one POINT shared by parent and child (not the centre distance, which a
 * rotating hip changes legitimately), so reconstruct each pivot from both
 * sides and compare. A healthy ragdoll reports millimetres.
 */
export function jointResidual(rd) {
    const pose = rd.pose();
    let worst = 0;
    for (let i = 1; i < rd.partCount; i++) {
        const par = posePart(pose, parentOf[i]), me = posePart(pose, i);
        const a = q.rot(par.r, armA[i]);
        const b = q.rot(me.r, armB[i]);
        worst = Math.max(worst, Math.hypot(
            (par.p.x + a.x) - (me.p.x - b.x),
            (par.p.y + a.y) - (me.p.y - b.y),
            (par.p.z + a.z) - (me.p.z - b.z)));
    }
    return worst;
}

const DEFAULT_COLORS = { skin: '#d8a37a', cloth: '#4f6fa8', boots: null };
function partColor(name, c) {
    if (name === 'head' || name.startsWith('lowerArm')) return c.skin;
    if (c.boots && name.startsWith('lowerLeg')) return c.boots;
    return c.cloth;
}

/**
 * Create a humanoid ragdoll and its visuals: one PhysicsNode per part (the
 * parts are ordinary bodies, so they sync and interpolate like any body).
 * opts: { position, rotation, layer, linearDamping = 0.08, angularDamping = 0.15,
 *         motor: { frequency = 12, damping = 1, maxTorque = -1 },
 *         colors: { skin, cloth, boots }, pose (flat array: start in it) }.
 * Returns { rd, nodes, meshes, tags, destroy() }.
 */
export function spawnRagdoll(scene, opts) {
    const o = opts || {};
    const m = o.motor || {};
    const rd = Physics.createRagdoll({
        position: o.position || { x: 0, y: 0, z: 0 },
        ...(o.rotation ? { rotation: o.rotation } : {}),
        ...(o.layer ? { layer: o.layer } : {}),
        linearDamping: o.linearDamping ?? 0.08,
        angularDamping: o.angularDamping ?? 0.15,
        motor: { frequency: m.frequency ?? 12, damping: m.damping ?? 1.0, maxTorque: m.maxTorque ?? -1 },
        parts: PARTS,
    });
    if (o.pose) rd.setPose(o.pose);
    const colors = { ...DEFAULT_COLORS, ...(o.colors || {}) };
    const nodes = [], meshes = [], tags = [];
    for (let i = 0; i < rd.partCount; i++) {
        const spec = PARTS[i];
        const tag = rd.partBody(i);
        const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
        const color = partColor(spec.name, colors);
        const mesh = spec.shape === 'sphere'
            ? scene.createMesh({ mesh: 'sphere', radius: spec.radius, segments: 18, rings: 14, color, roughness: 0.7 })
            : scene.createMesh({ mesh: 'capsule', radius: spec.radius, halfHeight: spec.halfHeight, segments: 14, color, roughness: 0.75 });
        node.add(mesh);
        nodes.push(node); meshes.push(mesh); tags.push(tag);
    }
    return {
        rd, nodes, meshes, tags,
        /** Bodies AND joints go together; there is no removing a single part. */
        destroy() {
            for (const n of nodes) n.destroy();
            rd.destroy();
        },
    };
}
