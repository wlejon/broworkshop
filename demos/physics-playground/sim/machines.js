// sim/machines.js — SixDOF constraints as machine tools.
//
// A SixDOF constraint is six independent switches (three translations, three
// rotations), each locked, limited to a range, or free, and each able to carry
// a position or velocity MOTOR. So this module builds machines, not joints:
//
//   crane   a slewing mast (rotationY free + velocity motor) carrying a winch
//           (translationY limited + position motor) chained off the mast, so
//           the winch frame slews with the crane for free
//   piston  one limited translationY with a position motor that holds a
//           loaded platform against gravity indefinitely
//   turret  rotationY + rotationZ position motors re-aimed every frame at a
//           moving drone: motors as a control surface, not a setup flourish
//
// Every axis is switchable live from the panel. Jolt bakes the DoF layout into
// the constraint at construction, so a switch destroys and rebuilds it from the
// machine's spec; the bodies are untouched and a slewing crane keeps its
// momentum. Axis indicators (bars beside each pivot) show the layout in-world.

import { addStatic, addBody, BodyGroup, rod } from "/lib/kit/physics3d.js";
import { quatYTo, q, v3 } from "/lib/kit/math3d.js";
import { ctx, scene } from "./ctx.js";

/** The yard sits behind the -Z perimeter on its own pad, clear of the sandbox rain. */
export const YARD_Z = -18;

/** key -> machine entry (see addMachine). */
export const machines = new Map();
/** Payloads and shells the machines produce; swept by "clear all". */
export const machineDebris = new BodyGroup(scene);

export const AXIS_NAMES = ['translationX', 'translationY', 'translationZ', 'rotationX', 'rotationY', 'rotationZ'];
export const AXIS_MODES = ['locked', 'limited', 'free'];
export const AXIS_COLOR = { X: '#ff5a5a', Y: '#7bed9f', Z: '#5aa9ff' };

/** Axis spec ('locked' | 'free' | {min,max}) -> mode name. */
export function modeOf(spec) {
    if (spec === 'free') return 'free';
    if (spec && typeof spec === 'object') return 'limited';
    return 'locked';
}

// --- axis indicators -----------------------------------------------------------
//
// Beside the pivot, not at it: every pivot here is inside the body it
// constrains, so an honest indicator AT the pivot is hidden in solid geometry.
// The cluster sits toward the yard camera and a faint leader ties it back.
//   locked short dark stub · limited medium coloured bar · free long glowing bar
// Rotation axes are drawn on the negative side with a collar of pips. A mode
// change moves length, radius, emissive and pips, and emissiveColor is
// construction-time, so the set is rebuilt on each change.

const INDICATOR_OFFSET = { x: 0, y: 0.6, z: -2.8 };

function buildIndicators(m) {
    for (const n of m.indicatorNodes) n.destroy();
    m.indicatorNodes = [];
    if (!m.showAxes) return;
    const sc = ctx.scene;
    const p = v3.add(m.pivot, INDICATOR_OFFSET);
    const leader = rod(sc, '#3a4048', { radius: 0.015 });
    leader.set(p, m.pivot);
    m.indicatorNodes.push(leader.mesh, sc.createMesh({
        mesh: 'sphere', radius: 0.07, segments: 8, rings: 6, x: m.pivot.x, y: m.pivot.y, z: m.pivot.z,
        color: '#ffffff', emissive: 1.2, emissiveColor: '#ffffff', roughness: 1,
    }));
    const dirs = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } };
    for (const letter of ['X', 'Y', 'Z']) {
        for (const kind of ['translation', 'rotation']) {
            const mode = modeOf(m.axes[kind + letter]);
            const isRot = kind === 'rotation';
            const d = v3.scale(dirs[letter], isRot ? -1 : 1);
            const len = mode === 'locked' ? 0.35 : mode === 'limited' ? 0.8 : 1.4;
            const color = mode === 'locked' ? '#4a4e56' : AXIS_COLOR[letter];
            const bar = sc.createMesh({
                mesh: 'cylinder', radius: mode === 'locked' ? 0.045 : 0.06, halfHeight: len / 2, segments: 10,
                color, roughness: 0.5, ...(mode === 'free' ? { emissive: 2.2, emissiveColor: color } : {}),
            });
            const c = v3.add(p, v3.scale(d, len / 2));
            bar.x = c.x; bar.y = c.y; bar.z = c.z;
            bar.quaternion = quatYTo(d.x, d.y, d.z);
            m.indicatorNodes.push(bar);
            if (!isRot || mode === 'locked') continue;
            // Pip collar: an orthonormal pair around d.
            const u = Math.abs(d.y) > 0.5 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
            const e1 = { x: u.y * d.z - u.z * d.y, y: u.z * d.x - u.x * d.z, z: u.x * d.y - u.y * d.x };
            const e2 = { x: d.y * e1.z - d.z * e1.y, y: d.z * e1.x - d.x * e1.z, z: d.x * e1.y - d.y * e1.x };
            for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2;
                const at = v3.add(v3.add(p, v3.scale(d, len * 0.55)),
                    v3.add(v3.scale(e1, Math.cos(a) * 0.28), v3.scale(e2, Math.sin(a) * 0.28)));
                m.indicatorNodes.push(sc.createMesh({
                    mesh: 'sphere', radius: 0.045, segments: 8, rings: 6, x: at.x, y: at.y, z: at.z,
                    color, emissive: 1.5, emissiveColor: color, roughness: 1,
                }));
            }
        }
    }
}

// --- constraint (re)construction ------------------------------------------------

/**
 * Build (or rebuild) a machine's SixDOF constraint from m.axes, then re-apply
 * every recorded motor. Only non-locked axes are listed (unlisted = locked).
 * A motor on a locked axis is inert, so it is skipped rather than pretended.
 */
export function rebuildConstraint(m) {
    if (m.handle) Physics.destroyConstraint(m.handle);
    const axes = {};
    for (const name of AXIS_NAMES) if (modeOf(m.axes[name]) !== 'locked') axes[name] = m.axes[name];
    m.handle = Physics.createConstraint({
        type: 'sixdof', body1: m.anchor, body2: m.body, point1: m.pivot, point2: m.pivot, axes,
    });
    for (const [axis, motor] of Object.entries(m.motors)) {
        if (!motor || motor.type === 'off' || modeOf(m.axes[axis]) === 'locked') continue;
        Physics.setConstraintMotor(m.handle, { axis, ...motor });
    }
    buildIndicators(m);
    return m.handle;
}

/**
 * Switch one axis between locked / limited / free and rebuild. `limited`
 * restores the machine's authored range for that axis.
 */
export function setAxisMode(key, axis, mode) {
    const m = machines.get(key);
    if (!m || !AXIS_NAMES.includes(axis) || !AXIS_MODES.includes(mode)) return false;
    m.axes[axis] = mode === 'limited' ? { ...(m.limits[axis] || { min: -1, max: 1 }) } : mode;
    rebuildConstraint(m);
    Physics.activate(m.body);
    return true;
}

/** Set (or clear, type 'off') a motor: { type: 'position'|'velocity'|'off', target, maxForce|maxTorque, frequency, damping }. */
export function setMotor(key, axis, motor) {
    const m = machines.get(key);
    if (!m) return false;
    m.motors[axis] = { ...motor };
    if (modeOf(m.axes[axis]) === 'locked') return false;       // inert until unlocked
    const ok = Physics.setConstraintMotor(m.handle, { axis, ...motor });
    Physics.activate(m.body);
    return ok;
}

/** Retarget an existing motor without restating its limits. */
export function setMotorTarget(key, axis, target) {
    const m = machines.get(key);
    const cur = m && m.motors[axis];
    if (!cur || cur.type === 'off') return false;
    return setMotor(key, axis, { ...cur, target });
}

/** Point a machine's motor at a position target, keeping its other settings. */
export function driveMotor(key, axis, target, extra = {}) {
    const m = machines.get(key);
    if (!m) return false;
    return setMotor(key, axis, {
        type: 'position', maxForce: 60000, maxTorque: 40000, frequency: 4, damping: 1,
        ...(m.motors[axis] || {}), ...extra, target,
    });
}

// --- construction ------------------------------------------------------------------

/** A dynamic machine part on the player layer. */
const part = (body, look) => addBody(ctx.scene, { layer: 'player', ...body }, look);
/** A static anchor on the static layer. */
const anchor = (body, look) => addStatic(ctx.scene, { layer: 'static', ...body }, look).tag;

function addMachine(spec) {
    const t = Physics.getTransform(spec.body);
    const m = {
        indicatorNodes: [], showAxes: true, handle: 0, motors: {}, ...spec,
        axes: { ...spec.axes }, limits: { ...spec.limits },
        // As authored, for resetMachines() after the axis grid has been played with.
        authoredAxes: { ...spec.axes },
        home: { p: { ...t.position }, q: { ...t.rotation } },
    };
    machines.set(m.key, m);
    rebuildConstraint(m);
    return m;
}

// Motor presets shared by build and reset.
const MOTORS = {
    crane:  ['rotationY', { type: 'velocity', target: 0, maxTorque: 40000 }],
    winch:  ['translationY', { type: 'position', target: -2.0, maxForce: 60000, frequency: 4, damping: 1 }],
    piston: ['translationY', { type: 'position', target: 0.0, maxForce: 120000, frequency: 5, damping: 1 }],
};
const TURRET_MOTOR = { type: 'position', target: 0, maxTorque: 30000, frequency: 6, damping: 1 };

const CRANE = { x: -16, mastY: 3.0, reach: 5.0 };
const PISTON_X = -6;
const TURRET = { x: 4, y: 1.7, barrel: 1.5 };

/** Build the yard pad and the three SixDOF machines. Call once. */
export function buildMachines() {
    addStatic(ctx.scene, {
        shape: 'box', halfExtents: { x: 28, y: 0.5, z: 6 }, position: { x: 0, y: -0.5, z: YARD_Z },
        layer: 'static', friction: 0.9, restitution: 0.05,
    }, { color: '#33373d', roughness: 0.95 });
    buildCrane();
    buildPiston();
    buildTurret();
    return machines;
}

function buildCrane() {
    const base = anchor({ shape: 'box', halfExtents: { x: 0.9, y: 0.5, z: 0.9 }, position: { x: CRANE.x, y: 0.5, z: YARD_Z } },
        { color: '#5a6069', roughness: 0.8 });
    // Mast + jib as ONE compound: they never move relative to each other, so a
    // joint between them would be solver cost with no behaviour.
    const mast = part({
        shape: 'compound',
        parts: [
            { shape: 'box', halfExtents: { x: 0.32, y: 2.5, z: 0.32 }, localPosition: { x: 0, y: 0, z: 0 } },
            { shape: 'box', halfExtents: { x: 2.6, y: 0.2, z: 0.25 }, localPosition: { x: 2.4, y: 2.3, z: 0 } },
            { shape: 'box', halfExtents: { x: 1.0, y: 0.2, z: 0.25 }, localPosition: { x: -1.0, y: 2.3, z: 0 } },
        ],
        position: { x: CRANE.x, y: CRANE.mastY, z: YARD_Z }, mass: 400, friction: 0.6,
    }, { color: '#c9a227', roughness: 0.6 });
    addMachine({
        key: 'crane', label: 'Crane — slew', node: mast.node,
        hint: 'rotationY free + velocity motor. Everything else locked, which is what holds a 400 kg mast upright on one joint.',
        anchor: base, body: mast.tag, pivot: { x: CRANE.x, y: CRANE.mastY, z: YARD_Z },
        axes: { rotationY: 'free' },
        limits: { rotationY: { min: -Math.PI, max: Math.PI }, translationY: { min: -1, max: 1 } },
    });
    setMotor('crane', ...MOTORS.crane);

    // translationY 0 = hook at the top (one metre under the jib tip); the motor
    // drives it down to -4.
    const hookTop = { x: CRANE.x + CRANE.reach, y: CRANE.mastY + 2.3 - 1.0, z: YARD_Z };
    const hook = part({ shape: 'box', halfExtents: { x: 0.35, y: 0.35, z: 0.35 }, position: hookTop,
        mass: 60, friction: 1.2, restitution: 0.05 }, { color: '#d94f4f', roughness: 0.5 });
    const winch = addMachine({
        key: 'winch', label: 'Crane — winch', node: hook.node,
        hint: 'translationY limited to 4 m of travel + position motor. The motor holds the hook and its load against gravity indefinitely.',
        anchor: mast.tag, body: hook.tag, pivot: hookTop,
        axes: { translationY: { min: -4, max: 0 }, rotationY: 'free' },
        limits: { translationY: { min: -4, max: 0 }, rotationY: { min: -Math.PI, max: Math.PI } },
    });
    setMotor('winch', ...MOTORS.winch);
    // The cable, redrawn every frame from the live transforms: the scene has no
    // joint visual, and an unexplained floating box is a worse demo.
    winch.cable = { rod: rod(ctx.scene, '#20242a', { radius: 0.04 }), mast: mast.tag, localTip: { x: CRANE.reach, y: 2.3, z: 0 } };
}

function buildPiston() {
    const frame = anchor({ shape: 'box', halfExtents: { x: 0.4, y: 3.0, z: 0.4 }, position: { x: PISTON_X - 1.9, y: 3.0, z: YARD_Z } },
        { color: '#5a6069', roughness: 0.85 });
    const plat = part({ shape: 'box', halfExtents: { x: 1.5, y: 0.18, z: 1.5 }, position: { x: PISTON_X, y: 0.7, z: YARD_Z },
        mass: 120, friction: 1.4, restitution: 0.0 }, { color: '#4a8fd6', roughness: 0.55 });
    addMachine({
        key: 'piston', label: 'Piston lift', node: plat.node,
        hint: 'ONE axis: translationY limited to 0..4.5 m, driven by a position motor. Load the platform and the motor still holds the target.',
        anchor: frame, body: plat.tag, pivot: { x: PISTON_X, y: 0.7, z: YARD_Z },
        axes: { translationY: { min: 0, max: 4.5 } },
        limits: { translationY: { min: 0, max: 4.5 }, rotationY: { min: -0.6, max: 0.6 } },
    });
    setMotor('piston', ...MOTORS.piston);
}

// Yaw and pitch are solved independently for two position motors: SixDOF's
// rotationY/Z are swing components of one decomposition, not a true gimbal,
// but at turret pitch angles the error is invisible and aim = two targets.
function buildTurret() {
    const ped = anchor({ shape: 'cylinder', radius: 0.7, halfHeight: 0.6, position: { x: TURRET.x, y: 0.6, z: YARD_Z } },
        { color: '#5a6069', roughness: 0.8 });
    const L = TURRET.barrel;
    const body = part({
        shape: 'compound',
        parts: [
            { shape: 'box', halfExtents: { x: 0.5, y: 0.35, z: 0.5 }, localPosition: { x: 0, y: 0, z: 0 } },
            { shape: 'box', halfExtents: { x: L, y: 0.13, z: 0.13 }, localPosition: { x: L, y: 0.1, z: 0 } },
        ],
        position: { x: TURRET.x, y: TURRET.y, z: YARD_Z }, mass: 150, gravityFactor: 0,
    }, { color: '#4b5b47', roughness: 0.7 });
    const m = addMachine({
        key: 'turret', label: 'Tracking turret', node: body.node,
        hint: 'rotationY free (traverse) + rotationZ limited (elevation), both on POSITION motors re-aimed every frame at the drone.',
        anchor: ped, body: body.tag, pivot: { x: TURRET.x, y: TURRET.y, z: YARD_Z },
        axes: { rotationY: 'free', rotationZ: { min: -0.55, max: 0.55 } },
        limits: { rotationY: { min: -2.4, max: 2.4 }, rotationZ: { min: -0.55, max: 0.55 } },
    });
    m.tracking = true;
    setMotor('turret', 'rotationY', TURRET_MOTOR);
    setMotor('turret', 'rotationZ', TURRET_MOTOR);

    // The drone: kinematic rather than a bare mesh so shells have something to hit.
    const drone = part({ shape: 'sphere', radius: 0.45, position: { x: TURRET.x + 6, y: 4, z: YARD_Z } },
        { color: '#ff4f7d', emissive: 1.4, roughness: 0.6, segments: 18 });
    Physics.setKinematic(drone.tag);
    m.drone = { ...drone, t: 0 };
}

export function setTurretTracking(on) {
    const t = machines.get('turret');
    if (!t) return false;
    t.tracking = !!on;
    const motor = on ? TURRET_MOTOR : { type: 'off' };
    setMotor('turret', 'rotationY', motor);
    setMotor('turret', 'rotationZ', motor);
    return true;
}

// --- machine products ----------------------------------------------------------------

function spawnDebris(kind, pos, o = {}) {
    const shape = kind === 'sphere'
        ? { shape: 'sphere', radius: o.radius ?? 0.3 }
        : { shape: 'box', halfExtents: o.halfExtents ?? { x: 0.3, y: 0.3, z: 0.3 } };
    return machineDebris.add({
        ...shape, position: pos, layer: 'player', mass: o.mass ?? 10,
        friction: o.friction ?? 0.7, restitution: o.restitution ?? 0.15,
    }, { color: o.color || '#c98a3a', roughness: kind === 'sphere' ? 0.5 : 0.6, emissive: o.emissive, segments: 16 });
}

/** Drop crates onto the piston platform: the load the motor must hold. */
export function loadPiston(n = 3) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(spawnDebris('box', {
            x: PISTON_X + (Math.random() - 0.5) * 1.4, y: 7 + i, z: YARD_Z + (Math.random() - 0.5) * 1.4,
        }, { halfExtents: { x: 0.35, y: 0.35, z: 0.35 }, mass: 40 }));
    }
    return out;
}

/** Drop a heavy pallet under the crane hook. */
export function craneLoad() {
    const m = machines.get('winch');
    if (!m) return null;
    const h = Physics.getTransform(m.body).position;
    return spawnDebris('box', { x: h.x, y: h.y - 1.4, z: h.z },
        { halfExtents: { x: 0.6, y: 0.4, z: 0.6 }, mass: 90, color: '#7a5c3a' });
}

/** Fire a shell out of the barrel along its current aim. */
export function fireTurret(speed = 34) {
    const m = machines.get('turret');
    if (!m) return null;
    const t = Physics.getTransform(m.body);
    // Barrel is +X in body space: one rotation gives muzzle and direction.
    const dir = q.rot(t.rotation, { x: 1, y: 0, z: 0 });
    const muzzle = v3.add(t.position, q.rot(t.rotation, { x: TURRET.barrel * 2 + 0.4, y: 0.1, z: 0 }));
    const e = spawnDebris('sphere', muzzle, { radius: 0.18, mass: 6, color: '#ffd166', emissive: 2.0, restitution: 0.3 });
    Physics.setLinearVelocity(e.tag, dir.x * speed, dir.y * speed, dir.z * speed);
    return e;
}

export function clearMachineDebris() { machineDebris.clear(); return true; }

// --- per frame -------------------------------------------------------------------------

/** The drone flies its circuit, the turret re-aims at it, the cable is redrawn. */
export function updateMachines(dt = 1 / 60) {
    const t = machines.get('turret');
    if (t && t.drone) {
        t.drone.t += dt;
        const a = t.drone.t * 0.55;
        const target = {
            x: TURRET.x + Math.cos(a) * 7.0, y: 4.2 + Math.sin(a * 1.7) * 1.4, z: YARD_Z + Math.sin(a) * 3.4,
        };
        Physics.moveKinematic(t.drone.tag, target.x, target.y, target.z, Math.max(1 / 240, dt));
        if (t.tracking) {
            const p = Physics.getTransform(t.body).position;
            const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
            // +yaw about +Y swings the barrel's rest +X toward -Z, hence -dz.
            const yaw = Math.atan2(-dz, dx);
            const pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
            const lim = t.limits.rotationZ;
            setMotorTarget('turret', 'rotationY', yaw);
            setMotorTarget('turret', 'rotationZ', Math.max(lim.min, Math.min(lim.max, pitch)));
            t.aim = { yaw, pitch };
        }
    }
    const w = machines.get('winch');
    if (w && w.cable) {
        const mt = Physics.getTransform(w.cable.mast);
        const tip = v3.add(mt.position, q.rot(mt.rotation, w.cable.localTip));
        w.cable.rod.set(tip, Physics.getTransform(w.body).position);
    }
}

/**
 * Back to the authored axes, home poses and default motors. The axis grid is a
 * loaded gun by design (free the piston's tX and the platform slides off its
 * lift); this is the way back. A rebuilt constraint takes its frames from the
 * current transforms, so recovery is: re-lock, teleport home, rebuild again.
 */
export function resetMachines() {
    for (const m of machines.values()) {
        m.axes = { ...m.authoredAxes };
        rebuildConstraint(m);
        Physics.setPosition(m.body, m.home.p.x, m.home.p.y, m.home.p.z);
        Physics.setRotation(m.body, m.home.q.x, m.home.q.y, m.home.q.z, m.home.q.w);
        Physics.setLinearVelocity(m.body, 0, 0, 0);
        Physics.setAngularVelocity(m.body, 0, 0, 0);
        rebuildConstraint(m);
        Physics.activate(m.body);
    }
    for (const key of Object.keys(MOTORS)) setMotor(key, ...MOTORS[key]);
    setTurretTracking(true);
    clearMachineDebris();
    return true;
}

export function setShowAllAxes(on) {
    for (const m of machines.values()) { m.showAxes = !!on; buildIndicators(m); }
    return true;
}

/** Live offset of a machine's axis: metres for translations, yaw radians for rotations. */
export function machineOffset(key, axis) {
    const m = machines.get(key);
    if (!m) return NaN;
    const t = Physics.getTransform(m.body);
    if (axis === 'translationX') return t.position.x - m.pivot.x;
    if (axis === 'translationY') return t.position.y - m.pivot.y;
    if (axis === 'translationZ') return t.position.z - m.pivot.z;
    return q.yaw(t.rotation);
}
