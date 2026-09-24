// sim/bench.js — the mechanism bench and the collideConnected pair.
//
// `gear`, `rackAndPinion` and `pulley` shipped in bro's binding layer with no
// caller. All three are measured in the tests:
//
//   gear           couples two EXISTING hinge handles; rate(A)/rate(B) == ratio
//   rackAndPinion  couples a pinion hinge to a rack slider
//   pulley         one rope over two fixed pivots, no motor at all
//
// Note the gear/rack shape: they do NOT take pivots and axes and build their
// own joints. They take the HANDLES of two constraints you already made and
// couple those constraints' axes. Get that backwards and nothing happens and
// nothing complains.

import { addBody, addStatic, rod } from "/lib/kit/physics3d.js";
import { v3 } from "/lib/kit/math3d.js";
import { ctx } from "./ctx.js";
import { YARD_Z } from "./machines.js";

/** key -> bench entry: 'gears' | 'rack' | 'pulley'. */
export const mechanisms = new Map();

// `scenery` does not collide with itself, which is what a display bench needs:
// the rack's travel carries it through the gear train's volume, and on a
// self-colliding layer it shoulders the driven gear round (measured ratios
// anywhere from 0.32 to 1.96 instead of the exact value the constraint gives).
const BENCH_LAYER = 'scenery';

// Cylinders bind along +Y; a quarter turn about X lays the axle along +Z so
// the wheels stand upright and mesh in the XY plane.
const AXLE_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
const Z = { x: 0, y: 0, z: 1 };

/** A toothed wheel: teeth are purely visual, but a smooth spinning cylinder looks stationary. */
function wheelMesh(s, r, halfH, color, teeth) {
    const root = s.createNode('wheel');
    root.add(s.createMesh({ mesh: 'cylinder', radius: r, halfHeight: halfH, segments: 24, color, roughness: 0.45 }));
    for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        root.add(s.createMesh({ mesh: 'box', halfW: 0.08, halfH: halfH + 0.02, halfD: 0.09,
            x: Math.cos(a) * (r + 0.06), z: Math.sin(a) * (r + 0.06), color: '#20242a', roughness: 0.6 }));
    }
    return root;
}

/** A free-spinning wheel on a world hinge along +Z. */
function hingedWheel(x, y, r, halfH, mass, color, teeth) {
    const p = { x, y, z: YARD_Z };
    const w = addBody(ctx.scene, {
        shape: 'cylinder', radius: r, halfHeight: halfH, position: p, rotation: AXLE_Z,
        mass, gravityFactor: 0, friction: 0.9, layer: BENCH_LAYER,
    }, { mesh: (s) => wheelMesh(s, r, halfH, color, teeth) });
    const hinge = Physics.createConstraint({ type: 'hinge', body1: w.tag, body2: -1, point1: p, point2: p, axis: Z });
    return { ...w, hinge, x };
}

export function buildBench() {
    buildCollidePair();
    buildGearTrain();
    buildRackAndPinion();
    buildPulley();
    return mechanisms;
}

// --- collideConnected -------------------------------------------------------------
//
// Two 0.5 m spheres on a rope capped at 0.4 m, SHORTER than the sum of their
// radii, so the flag decides whether joint or collision wins. Off (default),
// the pair is excluded from collision and the spheres merge at 0.40 m; on,
// contact pushes them apart past the rope's own limit. No runtime setter, so
// the toggle rebuilds the constraint.

const CC = { x: 10, y: 4.2 };
let cc = null;

function buildCollidePair() {
    const anchor = addStatic(ctx.scene, { shape: 'sphere', radius: 0.5, position: { x: CC.x, y: CC.y, z: YARD_Z }, layer: 'static' },
        { color: '#7f8b99', roughness: 0.6 }).tag;
    const ball = addBody(ctx.scene, { shape: 'sphere', radius: 0.5, position: { x: CC.x, y: CC.y - 0.4, z: YARD_Z },
        layer: 'player', mass: 20, restitution: 0.1 }, { color: '#4fa3ff', roughness: 0.4 });
    cc = { anchor, ball: ball.tag, node: ball.node, handle: 0, enabled: false };
    setCollideConnected(false);
}

export function setCollideConnected(on) {
    if (!cc) return false;
    if (cc.handle) Physics.destroyConstraint(cc.handle);
    cc.enabled = !!on;
    cc.handle = Physics.createConstraint({
        type: 'distance', body1: cc.anchor, body2: cc.ball,
        point1: { x: CC.x, y: CC.y, z: YARD_Z }, point2: { x: CC.x, y: CC.y - 0.4, z: YARD_Z },
        minDistance: 0.0, maxDistance: 0.4, collideConnected: !!on,
    });
    Physics.activate(cc.ball);
    return true;
}

export const getCollideConnected = () => (cc ? cc.enabled : false);

/** Live centre separation of the jointed pair: the proof, as a number. */
export function collideSeparation() {
    if (!cc) return NaN;
    return v3.dist(Physics.getTransform(cc.ball).position, { x: CC.x, y: CC.y, z: YARD_Z });
}

// --- gear train -------------------------------------------------------------------

const GEAR_X = 15;
const gearSpec = (g, ratio) => ({
    type: 'gear', body1: g.driver.tag, body2: g.driven.tag, hingeAxis1: Z, hingeAxis2: Z,
    ratio, constraint1: g.driver.hinge, constraint2: g.driven.hinge,
});

function buildGearTrain() {
    // BOTH hinges first: the gear couples two existing constraint handles.
    const driver = hingedWheel(GEAR_X, 3.2, 1.0, 0.22, 30, '#c9a227', 14);
    const driven = hingedWheel(GEAR_X + 1.65, 3.2, 0.5, 0.22, 30, '#a8703a', 8);
    const g = {
        key: 'gears', label: 'Gear train', driver, driven, ratio: 2.0, speed: 0,
        hint: 'A `gear` constraint couples two EXISTING hinge handles. Drive A and B follows at exactly 1/ratio the angle.',
    };
    g.handle = Physics.createConstraint(gearSpec(g, 2.0));       // B turns twice per turn of A
    mechanisms.set('gears', g);
    setGearDrive(2.5);
}

/** Drive the input hinge; the output follows through the gear. */
export function setGearDrive(radPerSec) {
    const g = mechanisms.get('gears');
    if (!g) return false;
    g.speed = radPerSec;
    Physics.activate(g.driver.tag); Physics.activate(g.driven.tag);
    return Physics.setConstraintMotor(g.driver.hinge,
        radPerSec === 0 ? { type: 'off' } : { type: 'velocity', target: radPerSec, maxTorque: 20000 });
}

/**
 * Dead stop. The gears carry gravityFactor 0 and no damping, so cutting the
 * drive leaves them coasting forever; a known start state needs this.
 */
export function resetGears() {
    const g = mechanisms.get('gears');
    if (!g) return false;
    setGearDrive(0);
    for (const t of [g.driver.tag, g.driven.tag]) {
        Physics.setAngularVelocity(t, 0, 0, 0);
        Physics.setLinearVelocity(t, 0, 0, 0);
        Physics.activate(t);
    }
    return true;
}

/**
 * Change the coupling ratio by rebuilding the constraint. A gear locks the two
 * hinge angles as they are when CREATED, so rebuilding mid-spin re-datums
 * against whatever the gears were doing: callers that care resetGears() first.
 */
export function setGearRatio(ratio) {
    const g = mechanisms.get('gears');
    if (!g) return false;
    Physics.destroyConstraint(g.handle);
    g.ratio = ratio;
    g.handle = Physics.createConstraint(gearSpec(g, ratio));
    return true;
}

// --- rack and pinion ------------------------------------------------------------------

const RACK = { x: 20, y: 2.72 };

function buildRackAndPinion() {
    const pinion = hingedWheel(RACK.x, 2.0, 0.55, 0.2, 20, '#c9a227', 10);
    const p = { x: RACK.x, y: RACK.y, z: YARD_Z };
    const rack = addBody(ctx.scene, { shape: 'box', halfExtents: { x: 2.4, y: 0.16, z: 0.22 }, position: p,
        mass: 25, gravityFactor: 0, layer: BENCH_LAYER }, { color: '#8fa3b8', roughness: 0.5 });
    const rackSlider = Physics.createConstraint({
        type: 'slider', body1: rack.tag, body2: -1, point1: p, point2: p,
        axis: { x: 1, y: 0, z: 0 }, limitMin: -2.2, limitMax: 2.2,
    });
    const handle = Physics.createConstraint({
        type: 'rackAndPinion', body1: pinion.tag, body2: rack.tag,
        hingeAxis1: Z, sliderAxis: { x: 1, y: 0, z: 0 },
        ratio: 2.5, constraint1: pinion.hinge, constraint2: rackSlider,
    });
    mechanisms.set('rack', {
        key: 'rack', label: 'Rack & pinion', pinion, pinionHinge: pinion.hinge, rack, rackSlider, handle,
        home: RACK.x, speed: 0,
        hint: 'A pinion hinge coupled to a rack slider. Drive the pinion; the rack translates at ratio times the pinion angle.',
    });
    setRackDrive(1.6);
}

export function setRackDrive(radPerSec) {
    const r = mechanisms.get('rack');
    if (!r) return false;
    r.speed = radPerSec;
    Physics.activate(r.pinion.tag); Physics.activate(r.rack.tag);
    return Physics.setConstraintMotor(r.pinionHinge,
        radPerSec === 0 ? { type: 'off' } : { type: 'velocity', target: radPerSec, maxTorque: 8000 });
}

/**
 * Park the rack at the centre of its travel: at a constant drive it reaches
 * the slider limit in a couple of seconds and then measures nothing.
 */
export function resetRack() {
    const r = mechanisms.get('rack');
    if (!r) return false;
    setRackDrive(0);
    Physics.setPosition(r.rack.tag, r.home, RACK.y, YARD_Z);
    Physics.setLinearVelocity(r.rack.tag, 0, 0, 0);
    Physics.setAngularVelocity(r.pinion.tag, 0, 0, 0);
    Physics.activate(r.rack.tag);
    Physics.activate(r.pinion.tag);
    return true;
}

/** Rack travel from home, metres. */
export function rackOffset() {
    const r = mechanisms.get('rack');
    return r ? Physics.getTransform(r.rack.tag).position.x - r.home : NaN;
}

// --- pulley -----------------------------------------------------------------------------

const PULLEY_X = 25;

function buildPulley() {
    const box = (x, mass, color) => addBody(ctx.scene, {
        shape: 'box', halfExtents: { x: 0.4, y: 0.4, z: 0.4 }, position: { x, y: 3.0, z: YARD_Z },
        mass, friction: 0.8, layer: BENCH_LAYER,
    }, { color, roughness: 0.6 });
    const heavy = box(PULLEY_X - 1.6, 120, '#8c2f2c');
    const light = box(PULLEY_X + 1.6, 25, '#4fa3ff');

    // The gantry the rope runs over (visual only; the pivots are world points).
    const s = ctx.scene;
    s.createMesh({ mesh: 'box', halfW: 2.2, halfH: 0.14, halfD: 0.16, x: PULLEY_X, y: 6.4, z: YARD_Z, color: '#5a6069', roughness: 0.8 });
    for (const x of [PULLEY_X - 2.1, PULLEY_X + 2.1]) {
        s.createMesh({ mesh: 'box', halfW: 0.14, halfH: 3.2, halfD: 0.16, x, y: 3.2, z: YARD_Z, color: '#5a6069', roughness: 0.85 });
    }
    const f1 = { x: PULLEY_X - 1.6, y: 6.3, z: YARD_Z };
    const f2 = { x: PULLEY_X + 1.6, y: 6.3, z: YARD_Z };
    const handle = Physics.createConstraint({
        type: 'pulley', body1: heavy.tag, body2: light.tag,
        bodyPoint1: { x: PULLEY_X - 1.6, y: 3.4, z: YARD_Z }, fixedPoint1: f1,
        bodyPoint2: { x: PULLEY_X + 1.6, y: 3.4, z: YARD_Z }, fixedPoint2: f2,
        ratio: 1.0,
    });
    mechanisms.set('pulley', {
        key: 'pulley', label: 'Pulley', heavy, light, handle, f1, f2,
        ropes: [rod(s, '#20242a', { radius: 0.03 }), rod(s, '#20242a', { radius: 0.03 })],
        hint: 'One rope of fixed total length over two pivots. No motor: the 120 kg side descends and hauls the 25 kg side up.',
    });
}

/** Level the pulley pair again so it can run once more. */
export function resetPulley() {
    const p = mechanisms.get('pulley');
    if (!p) return false;
    for (const [b, x] of [[p.heavy.tag, PULLEY_X - 1.6], [p.light.tag, PULLEY_X + 1.6]]) {
        Physics.setPosition(b, x, 3.0, YARD_Z);
        Physics.setRotation(b, 0, 0, 0, 1);
        Physics.setLinearVelocity(b, 0, 0, 0);
        Physics.setAngularVelocity(b, 0, 0, 0);
        Physics.activate(b);
    }
    return true;
}

/** Redraw the pulley ropes from the live transforms. */
export function updateBench() {
    const p = mechanisms.get('pulley');
    if (!p) return;
    const hp = Physics.getTransform(p.heavy.tag).position;
    const lp = Physics.getTransform(p.light.tag).position;
    p.ropes[0].set({ x: hp.x, y: hp.y + 0.4, z: hp.z }, p.f1);
    p.ropes[1].set({ x: lp.x, y: lp.y + 0.4, z: lp.z }, p.f2);
}

/** Bench defaults: gears at 2.5 rad/s, rack centred at 1.6 rad/s, pulley level. */
export function resetBench(gearSpeed = 2.5, rackSpeed = 1.6) {
    resetGears();
    setGearDrive(gearSpeed);
    resetRack();
    setRackDrive(rackSpeed);
    resetPulley();
    return true;
}
