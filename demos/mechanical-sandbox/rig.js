// rig.js — the active machine: everything one contraption created, so a
// switch or a reset can tear it down, and the live controls (motor speed,
// restitution, joint strength) can reach the right handles.
//
// Bodies are kit addBody entries (a PhysicsNode carries each visual, so no
// per-frame transform sync). Constraints are raw handles; motors and
// breakable joints are tracked separately because the HUD retargets them.

import { BodyGroup, rod, addStatic, removeBody } from "/lib/kit/physics3d.js";

const WORLD = -1;           // body2 for a constraint to the static world

export const rig = {
    type: null,
    scene: null,
    bodies: null,           // BodyGroup of the machine's dynamic bodies
    constraints: [],        // every handle, destroyed on clear
    statics: [],            // addStatic fixtures (towers)
    motors: [],             // { handle, gain, maxTorque, sign, speed }: target = speed * gain * sign
    probe: null,            // the machine's key bodies, for readouts and tests
    breakable: [],          // handles carrying a breakingImpulse
    broken: new Set(),      // handles Jolt reported broken
    meshes: [],             // static visuals
    ticks: [],              // per-frame visual updates (ropes, cables)
    nudge: null,            // () => void: the machine's "kick"
};

export function initRig(scene) {
    rig.scene = scene;
    rig.bodies = new BodyGroup(scene);
}

/** A dynamic body with its visual (kit addBody); look.mesh(scene) overrides the shape mesh. */
export function body(spec, look) {
    return rig.bodies.add(spec, look);
}

/** A constraint; `spec.body2` defaults to the world (-1). */
export function joint(spec) {
    const h = Physics.createConstraint({ body2: WORLD, ...spec });
    if (h < 0) throw new Error('mechanical-sandbox: createConstraint failed for ' + spec.type);
    rig.constraints.push(h);
    if (spec.breakingImpulse) rig.breakable.push(h);
    return h;
}

/**
 * A hinge (or slider) with a velocity motor the HUD's motor speed drives.
 * Returns the motor entry { handle, gain, maxTorque, sign }; `sign` is the
 * machine's own direction (a winch reversing at its end stops).
 */
export function motorJoint(spec, gain, maxTorque, speed) {
    const h = joint({ ...spec, motor: { type: 'velocity', target: speed * gain, maxTorque } });
    const m = { handle: h, gain, maxTorque, sign: 1, speed };
    rig.motors.push(m);
    return m;
}

// Machine joints hang off a static FRAME body as body1, with the moving part
// as body2. Jolt measures a constraint as body2 relative to body1, so this way
// round slider limits and motor targets read as the part's own travel and
// spin, and gear / rackAndPinion drift correction pushes the right way. The
// `body2: -1` world form gets all three backwards (ENGINE-ISSUES.md).

/** A hinge carrying `tag` on the static `frame` about `axis` through `at`. */
export function hinge(frame, tag, at, axis, extra) {
    return joint({ type: 'hinge', body1: frame, body2: tag, point1: at, point2: at, axis, ...extra });
}

/** A slider letting `tag` travel lo..hi along `axis` from where it stands, on `frame`. */
export function slider(frame, tag, axis, lo, hi) {
    return joint({ type: 'slider', body1: frame, body2: tag, axis, limitMin: lo, limitMax: hi });
}

/** A static body with its visual (kit addStatic), destroyed with the machine. */
export function fixture(spec, look) {
    const e = addStatic(rig.scene, spec, look);
    rig.statics.push(e);
    return e;
}

/** A static visual (no body) that belongs to the machine. */
export function prop(node) {
    rig.meshes.push(node);
    return node;
}

/**
 * A rod re-posed every frame between two points given by functions. With a
 * constraint `handle` it disappears once that joint breaks.
 */
export function cable(color, radius, a, b, handle) {
    const r = rod(rig.scene, color, { radius, roughness: 0.5 });
    rig.meshes.push(r);
    rig.ticks.push(() => {
        if (handle != null && rig.broken.has(handle)) r.visible = false;
        else r.set(a(), b());
    });
    r.set(a(), b());
    return r;
}

/** World position of a body, as {x,y,z}. */
export const pos = (tag) => Physics.getTransform(tag).position;

/** Tear the machine down: constraints first (they reference bodies), then bodies, then visuals. */
export function clearRig() {
    for (const h of rig.constraints) Physics.destroyConstraint(h);
    rig.bodies.clear();
    for (const e of rig.statics) removeBody(e);
    for (const m of rig.meshes) m.destroy();
    rig.constraints = [];
    rig.statics = [];
    rig.motors = [];
    rig.breakable = [];
    rig.broken = new Set();
    rig.meshes = [];
    rig.ticks = [];
    rig.nudge = null;
    rig.probe = null;
}

// --- live controls -------------------------------------------------------------

const driveMotor = (m) =>
    Physics.setConstraintMotor(m.handle, { type: 'velocity', target: m.speed * m.gain * m.sign, maxTorque: m.maxTorque });

/** Every motor to `speed` x its machine gain. */
export function setMotorSpeed(speed) {
    for (const m of rig.motors) { m.speed = speed; driveMotor(m); }
    for (const e of rig.bodies.values()) Physics.activate(e.tag);
}

/** Reverse one motor's own direction (the HUD speed keeps its sign). */
export function flipMotor(m) {
    m.sign = -m.sign;
    driveMotor(m);
}

export function setRestitution(r) {
    for (const e of rig.bodies.values()) Physics.setRestitution(e.tag, r);
}

/** Retarget every still-intact breakable joint. */
export function setBreakingImpulse(v) {
    for (const h of rig.breakable) if (!rig.broken.has(h)) Physics.setConstraintBreakingImpulse(h, v);
}

/** Feed the drained getBrokenConstraints() list; returns how many were ours. */
export function noteBroken(handles) {
    let n = 0;
    for (const h of handles) if (rig.constraints.includes(h) && !rig.broken.has(h)) { rig.broken.add(h); n++; }
    return n;
}

export function tickRig() {
    for (const t of rig.ticks) t();
}
