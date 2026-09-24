// sim/ragdolls.js — humanoid ragdolls: articulated bodies, per-part impulses,
// and both ways to drive a ragdoll toward a pose.
//
// Twelve parts on swing-twist joints (the rig is lib/kit/ragdoll.js). The
// joints carry force from a punched forearm into the pelvis and the cone
// limits stop the elbow bending backwards. Physics.createRagdoll exposes both
// of Jolt's drives, and they feel completely different:
//
//   driveToPose           motorised: position motors on every joint chase the
//                         pose's parent-relative rotations. Still a pile of
//                         bodies under gravity, it just gains muscle tone.
//                         Set once; the motors persist until stopDrive().
//   driveToPoseKinematic  hard tracking: part velocities are set so each part
//                         reaches its target TRANSFORM in dt. It stands the
//                         figure up, and shoves whatever is in the way. Must be
//                         re-issued every step (updateRagdolls).

import { q } from "/lib/kit/math3d.js";
import { spawnRagdoll as spawnRig, buildPose, poseError as rigPoseError, jointResidual as rigResidual,
         PART_NAMES, PELVIS_BIND_Y } from "/lib/kit/ragdoll.js";
import { ctx } from "./ctx.js";

export { PART_NAMES };
const DEG = Math.PI / 180;

// Poses are per-part local deltas on top of the bind pose ({} = standing).
// upperArmR binds at Rz(-90) along +X; a local Rz(+90) cancels that and the
// arm points straight up. Mirrored on the left.
export const POSES = {
    stand: {},
    reach: {
        upperArmR: q.axis(0, 0, 1, 90 * DEG),
        upperArmL: q.axis(0, 0, 1, -90 * DEG),
        spine:     q.axis(1, 0, 0, -10 * DEG),
    },
    tuck: {
        spine:     q.axis(1, 0, 0, 25 * DEG),
        chest:     q.axis(1, 0, 0, 20 * DEG),
        upperLegR: q.axis(1, 0, 0, -75 * DEG),
        upperLegL: q.axis(1, 0, 0, -75 * DEG),
        lowerLegR: q.axis(1, 0, 0, 70 * DEG),
        lowerLegL: q.axis(1, 0, 0, 70 * DEG),
        upperArmR: q.axis(0, 0, 1, 55 * DEG),
        upperArmL: q.axis(0, 0, 1, -55 * DEG),
    },
};
export const POSE_NAMES = Object.keys(POSES);

/** id -> { id, rd, nodes, meshes, drive } */
export const ragdolls = new Map();
const partByTag = new Map();          // part body tag -> { entry, index }
let nextId = 1;

export const ragdollCount = () => ragdolls.size;
export function totalPartCount() {
    let n = 0;
    for (const e of ragdolls.values()) n += e.rd.partCount;
    return n;
}

export function spawnRagdoll(pos = { x: 0, y: 3, z: 0 }, opts = {}) {
    const h = spawnRig(ctx.scene, {
        position: pos, rotation: opts.rotation, layer: opts.layer || 'player',
        // A modest spring: too stiff and the motorised drive stops being
        // distinguishable from the kinematic one.
        motor: { frequency: opts.frequency ?? 12, damping: opts.damping ?? 1.0 },
    });
    const entry = {
        id: nextId++, ...h,
        drive: { mode: 'off', pose: 'stand' },     // replayed per frame when kinematic
    };
    ragdolls.set(entry.id, entry);
    h.tags.forEach((tag, index) => partByTag.set(tag, { entry, index }));
    return entry;
}

/** Several at once, scattered, random yaw, a little spin: "ragdoll rain". */
export function ragdollRain(n = 5, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const e = spawnRagdoll({
            x: -6 + Math.random() * 20, y: 6 + i * 1.6 + Math.random() * 2, z: -6 + Math.random() * 12,
        }, { rotation: q.axis(0, 1, 0, Math.random() * Math.PI * 2), ...opts });
        e.rd.addImpulse((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3);
        out.push(e);
    }
    return out;
}

/**
 * Drive a ragdoll toward a named pose. kinematic false = motorised (one call,
 * `motor` = { frequency, damping }); true = hard tracking, re-issued every
 * frame by updateRagdolls.
 */
export function driveRagdoll(entry, poseName, kinematic, motor) {
    if (!entry) return false;
    entry.drive.pose = poseName;
    entry.drive.mode = kinematic ? 'kinematic' : 'motor';
    entry.rd.activate();
    if (kinematic) { entry.rd.stopDrive(); return true; }
    return entry.rd.driveToPose(buildPose(POSES[poseName]), motor);
}

export function stopDrive(entry) {
    if (!entry) return false;
    entry.drive.mode = 'off';
    entry.rd.stopDrive();
    return true;
}

/**
 * Per-frame: re-issue kinematic targets, rooted over the ragdoll's current XZ
 * at the standing pelvis height, upright. That placement is what turns a heap
 * into a figure standing on the floor.
 */
export function updateRagdolls(dt = 1 / 60) {
    for (const e of ragdolls.values()) {
        if (e.drive.mode !== 'kinematic') continue;
        const p = Physics.getTransform(e.rd.partBody(0)).position;
        const target = buildPose(POSES[e.drive.pose], { x: p.x, y: PELVIS_BIND_Y, z: p.z });
        e.rd.driveToPoseKinematic(target, Math.max(1 / 240, dt));
    }
}

/** Mean joint-angle error against a named pose, radians. */
export const poseError = (entry, poseName) => (entry ? rigPoseError(entry.rd, POSES[poseName]) : NaN);
/** Worst joint pivot separation, metres. */
export const jointResidual = (entry) => (entry ? rigResidual(entry.rd) : NaN);

/** Body tag -> { entry, index } for ragdoll parts, else null. */
export const findPart = (tag) => partByTag.get(tag) || null;

/**
 * Punch one part, scaled by that part's mass so a jab at the forearm and one
 * at the pelvis are the same punch.
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

// --- selection: the selected part is recoloured in place ---------------------

const SELECT_COLOR = '#7bed9f';
let marked = null;                    // { mesh, color } currently wearing SELECT_COLOR
export const selection = { entry: null, index: -1 };

export function selectPart(entry, index) {
    if (marked) { marked.mesh.color = marked.color; marked = null; }
    selection.entry = entry || null;
    selection.index = entry ? index : -1;
    if (!entry) return null;
    const mesh = entry.meshes[index];
    if (mesh) { marked = { mesh, color: mesh.color }; mesh.color = SELECT_COLOR; }
    return { entry, index, name: PART_NAMES[index] };
}

/** The ragdoll the panel acts on: the selected one, else the newest. */
export function activeRagdoll() {
    if (selection.entry && ragdolls.has(selection.entry.id)) return selection.entry;
    let last = null;
    for (const e of ragdolls.values()) last = e;
    return last;
}

export function despawnRagdoll(entry) {
    if (!entry || !ragdolls.has(entry.id)) return false;
    if (selection.entry === entry) selectPart(null, -1);
    for (const t of entry.tags) partByTag.delete(t);
    entry.destroy();
    ragdolls.delete(entry.id);
    return true;
}

export function clearRagdolls() {
    for (const e of [...ragdolls.values()]) despawnRagdoll(e);
}
