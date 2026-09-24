// machines.js — the five contraptions, each built from Jolt constraints.
//
//   pendulum  a motor-driven escape wheel and a heavy bob on a world hinge
//   gearbox   a three-gear train (two `gear` couplings) whose output drum
//             winches a crate up and down its guide through `rackAndPinion`,
//             while a `pulley` rope hangs a counterweight off the crate
//   piston    crank + connecting rod + piston: two hinges and a slider turn
//             rotation into reciprocation; the rod is a real body
//   cradle    five balls on V-shaped `distance` ropes, elastic collisions
//   bridge    a deck of planks hinged end to end, hung on ropes and anchored
//             to two towers, with a breakingImpulse on every joint
//
// Builders add everything they make to `rig` (rig.js) and set rig.nudge and
// rig.probe (the bodies readouts and tests look at).

import { q } from "/lib/kit/math3d.js";
import { rig, body, joint, motorJoint, hinge, slider, fixture, prop, cable, pos, flipMotor } from "./rig.js";
import { gearMesh, pulleyMesh, crankMesh, conrodMesh, plankMesh, steel, slab } from "./parts.js";

/** Cylinders run along local +Y; this turns them into axles along world Z. */
const AXLE_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
const X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
const IRON = { color: '#1e293b', roughness: 0.8, metallic: 0.2 };        // frames, bases, towers

export const MACHINES = {
    pendulum: {
        title: 'Clockwork Pendulum',
        desc: 'A heavy bob swinging on a world hinge in front of a motor-driven escape wheel.',
        view: { target: [0, 4.5, 0], dist: 15 }, controls: ['motor'],
    },
    gearbox: {
        title: 'Gearbox & Winch',
        desc: 'Three gears (two gear couplings) drive a drum that winches a crate up and down its guide (rackAndPinion). A pulley rope hangs a counterweight off the crate.',
        view: { target: [1.0, 3.8, 0], dist: 16 }, controls: ['motor'],
    },
    piston: {
        title: 'Piston & Crankshaft',
        desc: 'A motor turns the crank; a connecting rod on two hinges drives the piston along its slider. Rotation in, reciprocation out.',
        view: { target: [0, 3.9, 0], dist: 13 }, controls: ['motor'],
    },
    cradle: {
        title: "Newton's Cradle",
        desc: 'Five steel balls on V-shaped ropes pass momentum along the row. Elasticity sets how much of it survives each hit.',
        view: { target: [0, 3.5, 0], dist: 13 }, controls: ['restitution'],
    },
    bridge: {
        title: 'Suspension Bridge',
        desc: 'Planks hinged end to end, hung on ropes and anchored to two towers. Every joint breaks past its impulse limit: turn the joint strength down, then drop the load.',
        // The span runs along Z: look at it from the side, not down it.
        view: { target: [0, 3.0, 0], dist: 17, yaw: -1.15 }, controls: ['strength'],
    },
};

/** Kick a body by a velocity change (mass-scaled impulse). */
function kick(tag, dvx, dvy, dvz) {
    const m = Physics.getBodyProperties(tag).mass;
    Physics.addImpulse(tag, dvx * m, dvy * m, dvz * m);
    Physics.activate(tag);
}

/** A point fixed in a body's frame, as world-space, given where it was at build time. */
function attached(tag, local) {
    return () => {
        const t = Physics.getTransform(tag);
        const o = q.rot(t.rotation, local);
        return { x: t.position.x + o.x, y: t.position.y + o.y, z: t.position.z + o.z };
    };
}

// --- 1. clockwork pendulum ------------------------------------------------------

function pendulum(s, st) {
    fixture({ shape: 'box', halfExtents: { x: 0.4, y: 4.2, z: 0.3 }, position: { x: 0, y: 4.2, z: -0.8 } }, IRON);
    prop(slab(s, 2.0, 0.2, 0.4, 0, 8.2, 0.2, '#334155'));           // top beam over the bob

    const wheelP = { x: 0, y: 5.5, z: -0.3 };
    const wheel = body({ shape: 'cylinder', radius: 1.2, halfHeight: 0.15, position: wheelP, rotation: AXLE_Z,
        mass: 5, gravityFactor: 0 }, { mesh: gearMesh(1.2, 0.15, 14, '#d4af37') });
    motorJoint({ type: 'hinge', body1: wheel.tag, point1: wheelP, point2: wheelP, axis: Z }, 2.0, 200, st.motorSpeed);

    // A 5.2 m arm swinging in the z = 0.6 plane, released 2.2 m out.
    const pivot = { x: 0, y: 7.8, z: 0.6 }, arm = 5.2, out = 2.2;
    const bob = body({ shape: 'sphere', radius: 0.65, position: { x: out, y: pivot.y - Math.sqrt(arm * arm - out * out), z: pivot.z },
        mass: 25, linearDamping: 0.005, angularDamping: 0.005, restitution: 0.85 }, steel());
    joint({ type: 'hinge', body1: bob.tag, point1: pivot, point2: pivot, axis: Z });
    cable('#d4af37', 0.04, () => pivot, () => pos(bob.tag));

    rig.nudge = () => kick(bob.tag, 3, 0, 0);
    rig.probe = { wheel: wheel.tag, bob: bob.tag, pivot };
}

// --- 2. gearbox & winch ---------------------------------------------------------

function gearbox(s, st) {
    const y = 3.5;
    // The backplate every axle and the crate guide are mounted on.
    fixture({ shape: 'box', halfExtents: { x: 3.4, y: 1.6, z: 0.1 }, position: { x: -1.0, y, z: -0.7 } }, IRON);
    // Collision cylinders sit inside the pitch circle so meshing gears do not
    // rub; the gear constraints are what couples them.
    const wheel = (x, r, halfT, mass, mesh) => {
        const p = { x, y, z: 0 };
        const w = body({ shape: 'cylinder', radius: r * 0.9, halfHeight: halfT, position: p, rotation: AXLE_Z, mass, gravityFactor: 0 }, { mesh });
        return { tag: w.tag, r, p };
    };
    const g1 = wheel(-3.2, 0.8, 0.16, 15, gearMesh(0.8, 0.16, 10, '#e65c00'));
    const g2 = wheel(-1.2, 1.2, 0.16, 30, gearMesh(1.2, 0.16, 15, '#d4af37'));
    const g3 = wheel(0.9, 0.9, 0.22, 25, pulleyMesh(0.9, 0.22, '#4facfe'));
    // Negative gain: a positive motor speed hoists (see the rack ratio below).
    const motor = motorJoint({ type: 'hinge', body1: g1.tag, point1: g1.p, point2: g1.p, axis: Z }, -0.6, 5000, st.motorSpeed);
    const h1 = motor.handle, h2 = hinge(g2.tag, g2.p, Z), h3 = hinge(g3.tag, g3.p, Z);
    // A gear couples two EXISTING hinges; ratio = r2 / r1 (teeth2 / teeth1).
    joint({ type: 'gear', body1: g1.tag, body2: g2.tag, hingeAxis1: Z, hingeAxis2: Z, ratio: g2.r / g1.r, constraint1: h1, constraint2: h2 });
    joint({ type: 'gear', body1: g2.tag, body2: g3.tag, hingeAxis1: Z, hingeAxis2: Z, ratio: g3.r / g2.r, constraint1: h2, constraint2: h3 });

    // The crate rides a vertical guide (a slider); rackAndPinion couples the
    // drum's hinge to it, one drum radian per r metres of rope. Negative: the
    // drum turning anticlockwise (seen from +Z) pays rope out.
    const crateP = { x: 2.5, y: 1.3, z: 0 }, lo = 0, hi = 4.1;       // starts at the bottom
    const crate = body({ shape: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, position: crateP, mass: 35, linearDamping: 0.1 },
        { color: '#ff8008', roughness: 0.5 });
    const guide = slider(crate.tag, Y, lo, hi);
    joint({ type: 'rackAndPinion', body1: g3.tag, body2: crate.tag, hingeAxis1: Z, sliderAxis: Y,
        ratio: -1 / g3.r, constraint1: h3, constraint2: guide });
    for (const dx of [-0.62, 0.62]) prop(slab(s, 0.06, 3.0, 0.06, crateP.x + dx, 3.2, 0, '#475569'));

    // The winch reverses short of its end stops instead of stalling on them
    // (then ignores the stop for a second while the crate turns round).
    let hold = 0;
    rig.ticks.push(() => {
        if (hold > 0) { hold--; return; }
        const travel = pos(crate.tag).y - crateP.y;
        const vy = Physics.getVelocity(crate.tag).linear.y;
        if ((travel > hi - 0.25 && vy > 0) || (travel < lo + 0.25 && vy < 0)) { flipMotor(motor); hold = 60; }
    });

    // Counterweight on a pulley rope over two fixed sheaves, tied to the crate.
    // No maxLength: the rope's length is fixed at its build-time length.
    const weightP = { x: 5.0, y: 5.7, z: 0 };
    const weight = body({ shape: 'cylinder', radius: 0.45, halfHeight: 0.6, position: weightP, mass: 30, linearDamping: 0.3 },
        { color: '#718096', roughness: 0.3, metallic: 0.8 });
    const f1 = { x: crateP.x, y: 6.5, z: 0 }, f2 = { x: weightP.x, y: 6.5, z: 0 };
    const top1 = { x: 0, y: 0.5, z: 0 }, top2 = { x: 0, y: 0.6, z: 0 };
    joint({ type: 'pulley', body1: crate.tag, body2: weight.tag,
        bodyPoint1: { x: crateP.x, y: crateP.y + top1.y, z: 0 }, fixedPoint1: f1,
        bodyPoint2: { x: weightP.x, y: weightP.y + top2.y, z: 0 }, fixedPoint2: f2, ratio: 1 });
    for (const f of [f1, f2]) {
        const sheave = prop(pulleyMesh(0.4, 0.1, '#64748b')(s));
        sheave.x = f.x; sheave.y = f.y; sheave.z = f.z; sheave.rx = 90;
    }
    prop(slab(s, 1.6, 0.1, 0.12, (f1.x + f2.x) / 2, 7.0, 0, '#334155'));     // sheave beam
    cable('#e2e8f0', 0.03, () => f1, () => f2);
    cable('#e2e8f0', 0.03, () => ({ x: g3.p.x + g3.r, y, z: 0 }), () => ({ x: f1.x - 0.4, y: f1.y, z: 0 }));   // drum to sheave
    cable('#e2e8f0', 0.03, attached(crate.tag, top1), () => f1);
    cable('#e2e8f0', 0.03, attached(weight.tag, top2), () => f2);

    rig.nudge = () => kick(weight.tag, 3, 0, 0);
    rig.probe = { crate: crate.tag, weight: weight.tag, gears: [g1.tag, g2.tag, g3.tag], radii: [g1.r, g2.r, g3.r], motor, crateY0: crateP.y };
}

// --- 3. piston & crankshaft -------------------------------------------------------

function piston(s, st) {
    const O = { x: 0, y: 2.2, z: 0 }, R = 1.0, L = 3.2, zr = 0.34;   // crank centre, throw, rod length, rod plane
    fixture({ shape: 'box', halfExtents: { x: 2.0, y: 0.4, z: 1.2 }, position: { x: 0, y: 0.4, z: 0 } }, IRON);

    const crank = body({ shape: 'cylinder', radius: 1.3, halfHeight: 0.14, position: O, rotation: AXLE_Z, mass: 40, gravityFactor: 0 },
        { mesh: crankMesh(1.3, 0.14, R, zr, '#c59b27') });
    motorJoint({ type: 'hinge', body1: crank.tag, point1: O, point2: O, axis: Z }, 4.0, 8000, st.motorSpeed);

    // Assembled at top dead centre: pin straight above the crank centre, rod
    // vertical, piston on top. Each joint is a world-space pivot.
    const pin = { x: 0, y: O.y + R, z: zr }, wrist = { x: 0, y: O.y + R + L, z: zr };
    const rod = body({ shape: 'box', halfExtents: { x: 0.11, y: L / 2, z: 0.08 }, position: { x: 0, y: O.y + R + L / 2, z: zr }, mass: 4 },
        { mesh: conrodMesh(L, 0.22, '#94a3b8') });
    const headP = { x: 0, y: wrist.y + 0.3, z: zr };
    const head = body({ shape: 'cylinder', radius: 0.72, halfHeight: 0.45, position: headP, mass: 10, linearDamping: 0.05 },
        { color: '#cbd5e1', roughness: 0.2, metallic: 0.85 });
    joint({ type: 'hinge', body1: crank.tag, body2: rod.tag, point1: pin, point2: pin, axis: Z });
    joint({ type: 'hinge', body1: rod.tag, body2: head.tag, point1: wrist, point2: wrist, axis: Z });
    slider(head.tag, Y, -2 * R - 0.1, 0.1);

    // The bore: two guide rails and a head casting either side of the stroke
    // (an opaque sleeve would hide the piston it is there to show).
    for (const dx of [-0.84, 0.84]) prop(slab(s, 0.1, 1.7, 0.2, dx, headP.y - 0.9, zr, '#334155', { metallic: 0.6, roughness: 0.45 }));
    prop(slab(s, 1.0, 0.12, 0.3, 0, headP.y + 0.9, zr, '#475569'));

    rig.nudge = () => kick(rod.tag, 2, 0, 0);
    rig.probe = { crank: crank.tag, head: head.tag, rod: rod.tag, centre: O, throw: R, rodLength: L, headY0: headP.y };
}

// --- 4. Newton's cradle ---------------------------------------------------------------

function cradle(s, st) {
    const n = 5, r = 0.42, len = 4.2, top = 6.2, zo = 0.75, pull = 2.6;
    prop(slab(s, 2.8, 0.15, zo + 0.2, 0, top, 0, '#334155', { metallic: 0.8 }));
    for (const x of [-2.7, 2.7]) for (const z of [-zo - 0.1, zo + 0.1]) prop(slab(s, 0.1, top / 2, 0.1, x, top / 2, z, '#334155'));
    const balls = [];
    for (let i = 0; i < n; i++) {
        // A 3 cm gap between balls: touching balls share one contact island and
        // the solver smears the hit across the row (far ball 1.6 m/s instead
        // of 4.1); spaced, each collision resolves as its own two-ball event.
        const x = (i - (n - 1) / 2) * r * 2.08;
        // Ball 0 starts pulled back along its arc.
        const bx = i === 0 ? x - pull : x;
        const by = i === 0 ? top - Math.sqrt(len * len - pull * pull) : top - len;
        const at = { x: bx, y: by, z: 0 };
        const ball = body({ shape: 'sphere', radius: r, position: at, mass: 12,
            restitution: st.restitution, friction: 0.02, linearDamping: 0.001, angularDamping: 0.001 }, steel('#f1f5f9'));
        // Two ropes to the frame make the V that keeps the swing in one plane.
        for (const z of [-zo, zo]) {
            const anchor = { x, y: top, z };
            joint({ type: 'distance', body1: ball.tag, point1: at, point2: anchor });
            cable('#94a3b8', 0.015, () => anchor, () => pos(ball.tag));
        }
        balls.push(ball.tag);
    }
    rig.nudge = () => kick(balls[0], 3, 0, 0);
    rig.probe = { balls };
}

// --- 5. suspension bridge -----------------------------------------------------------------

function bridge(s, st) {
    const n = 7, hw = 1.0, hh = 0.12, hd = 0.55, deckY = 1.5, hangY = 4.5, cableY = 5.0;
    const half = n * hd, towerZ = half + 0.5, strength = st.breakingImpulse;
    const edge = hw * 0.9;

    for (const sz of [-1, 1]) {
        fixture({ shape: 'box', halfExtents: { x: 1.4, y: 2.5, z: 0.5 }, position: { x: 0, y: 2.5, z: sz * towerZ } }, IRON);
    }

    const planks = [];
    for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * hd * 2;
        const p = body({ shape: 'box', halfExtents: { x: hw, y: hh, z: hd }, position: { x: 0, y: deckY, z },
            mass: 25, linearDamping: 0.1, angularDamping: 0.2 }, { mesh: plankMesh(hw, hh, hd, '#8b5a2b') });
        planks.push(p.tag);
        // Hangers: breakable ropes from the main cable down to both plank edges.
        for (const sx of [-1, 1]) {
            const hang = { x: sx * edge, y: hangY, z }, at = { x: sx * edge, y: deckY, z };
            // A rope, not a rod: it only pulls (minDistance 0), so the hinged
            // deck is not over-constrained into fighting its own hangers.
            const h = joint({ type: 'distance', body1: p.tag, point1: at, point2: hang, minDistance: 0, maxDistance: hangY - deckY, breakingImpulse: strength });
            cable('#94a3b8', 0.02, () => hang, attached(p.tag, { x: sx * edge, y: 0, z: 0 }), h);
        }
    }
    // Deck hinges: tower-plank, plank-plank ..., plank-tower.
    for (let i = 0; i <= n; i++) {
        const p = { x: 0, y: deckY, z: -half + i * hd * 2 };
        const a = i < n ? planks[i] : planks[n - 1];
        const b = i === 0 || i === n ? -1 : planks[i - 1];
        joint({ type: 'hinge', body1: a, body2: b, point1: p, point2: p, axis: X, breakingImpulse: strength });
    }
    // Main cables: tower top, over every hanger, to the other tower top.
    for (const sx of [-1, 1]) {
        const line = [{ x: sx * edge, y: cableY, z: -towerZ }];
        for (let i = 0; i < n; i++) line.push({ x: sx * edge, y: hangY, z: (i - (n - 1) / 2) * hd * 2 });
        line.push({ x: sx * edge, y: cableY, z: towerZ });
        for (let i = 0; i + 1 < line.length; i++) cable('#cbd5e1', 0.035, () => line[i], () => line[i + 1]);
    }

    rig.nudge = () => kick(planks[n >> 1], 0, 4, 0);
    rig.probe = { planks, deckY };
}

const BUILD = { pendulum, gearbox, piston, cradle, bridge };

/** Build machine `type` into the (cleared) rig; `st` is the HUD state. */
export function buildMachine(type, st) {
    rig.type = type;
    BUILD[type](rig.scene, st);
}

/** The Drop button: a 100 kg ball from above the machine's working point. */
export function dropLoad() {
    const x = rig.type === 'bridge' ? 0 : 0.5, z = rig.type === 'bridge' ? 0 : 0.5;
    return body({ shape: 'sphere', radius: 0.8, position: { x, y: 8, z }, mass: 100, restitution: 0.1 },
        { color: '#ff3838', roughness: 0.3, metallic: 0.9, segments: 20 });
}
