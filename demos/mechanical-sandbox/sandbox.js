// sandbox.js — the stage, the HUD and the loop around the five machines.
//
// Physics auto-steps the default world. Pause is bro.time.scale = 0: physics
// stops accumulating time while rAF keeps firing, so the camera still orbits
// a frozen machine. The live controls go straight to the handles rig.js keeps:
// motor speed x each machine's own gain, restitution, and setBreakingImpulse on
// every still-intact joint.
//
// Tests import this module (main.js is only the entry point).

import { boot } from "/lib/kit/app.js";
import { segmented, fpsMeter } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { sceneViewport, orbitRotation, localPoint } from "/lib/kit/viewport3d.js";
import { physicsEvents, pickRay, raycast, grabber } from "/lib/kit/physics3d.js";
import { rig, initRig, clearRig, tickRig, setMotorSpeed, setRestitution, setBreakingImpulse, noteBroken } from "./rig.js";
import { MACHINES, buildMachine, dropLoad } from "./machines.js";

const $ = (s) => document.querySelector(s);
const { status } = boot();

export const state = { machine: 'pendulum', motorSpeed: 1.0, gravity: 9.8, restitution: 0.99, breakingImpulse: 1200, paused: false };

// --- stage ------------------------------------------------------------------------

const YAW = -0.4, PITCH = -0.25;
export const vp = sceneViewport('#stage', {
    orbit: { target: [0, 3.5, 0], rot: orbitRotation(YAW, PITCH), dist: 16, fov: 45, near: 0.1, far: 250 },
    controls: { minDist: 3 },
});
export const scene = vp.scene;

scene.setAmbient([0.08, 0.10, 0.14]);
scene.setToneMap({ mode: 'aces', exposure: 1.1 });
scene.createLight({ type: 'directional', direction: [-0.5, -1.0, -0.4], color: [1.0, 0.96, 0.90], intensity: 2.8, castsShadow: true, name: 'sun' });
scene.createLight({ type: 'directional', direction: [0.6, -0.5, 0.5], color: [0.4, 0.65, 0.95], intensity: 1.2, name: 'fill' });
scene.createLight({ type: 'directional', direction: [0.0, -0.8, -0.8], color: [0.95, 0.65, 0.4], intensity: 0.8, name: 'rim' });

// The studio floor: a physics slab (top at y = 0) under a round stage with an
// accent ring.
Physics.createBody({ shape: 'box', static: true, halfExtents: { x: 50, y: 0.5, z: 50 }, position: { x: 0, y: -0.5, z: 0 } });
scene.createMesh({ mesh: 'cylinder', radius: 25, halfHeight: 0.1, segments: 64, y: -0.1, color: '#0e131d', roughness: 0.7, metallic: 0.3 });
scene.createMesh({ mesh: Mesh.torus(25.0, 0.1, 64, 16), color: '#1e293b', emissive: 0.3, emissiveColor: '#e65c00' });

Physics.setGravity(0, -state.gravity, 0);
initRig(scene);

// --- broken joints: the one drain of getBrokenConstraints ---------------------------

export const events = physicsEvents();
events.onBroken((handles) => {
    const n = noteBroken(handles);
    if (n) status.warn(`${n} joint${n > 1 ? 's' : ''} broke (${rig.broken.size} so far)`);
});

// --- machines -----------------------------------------------------------------------

const picker = segmented('#machines', Object.fromEntries(Object.entries(MACHINES).map(([k, m]) => [k, m.title])), {
    value: state.machine, onChange: (v) => switchMachine(v),
});

const ROWS = { motor: '#motorRow', restitution: '#restitutionRow', strength: '#strengthRow' };

/** Tear down the current machine and build `type` (also the Reset button). */
export function switchMachine(type) {
    const m = MACHINES[type];
    if (!m) return false;
    grab.end();
    clearRig();
    state.machine = type;
    picker.value = type;
    buildMachine(type, state);
    $('#title').textContent = m.title;
    $('#desc').textContent = m.desc;
    for (const [k, sel] of Object.entries(ROWS)) $(sel).hidden = !m.controls.includes(k);
    vp.reframe(m.view.target, m.view.dist, { yaw: m.view.yaw ?? YAW, pitch: PITCH });
    status.ok(`${m.title} built`);
    refreshStats();
    return true;
}

export function nudge() { if (rig.nudge) rig.nudge(); }
/** The Drop button. The load is a rig body, so Reset sweeps it away too. */
export function drop() { const e = dropLoad(); status.set('heavy load dropped'); return e; }

export function setPaused(on) {
    state.paused = !!on;
    bro.time.scale = state.paused ? 0 : 1;
    status.set(state.paused ? 'paused (Space resumes)' : 'running');
}

// --- controls -------------------------------------------------------------------------

const motor = bindControl('#motor', { out: '#motorV', fmt: (v) => v.toFixed(1) + 'x', onChange: (v) => { state.motorSpeed = v; setMotorSpeed(v); } });
bindControl('#gravity', { out: '#gravityV', fmt: (v) => v.toFixed(1) + ' m/s²', onChange: (v) => {
    state.gravity = v;
    Physics.setGravity(0, -v, 0);
    for (const e of rig.bodies.values()) Physics.activate(e.tag);
} });
bindControl('#restitution', { out: '#restitutionV', fmt: (v) => v.toFixed(2), onChange: (v) => { state.restitution = v; setRestitution(v); } });
bindControl('#strength', { out: '#strengthV', fmt: (v) => v + ' N·s', onChange: (v) => { state.breakingImpulse = v; setBreakingImpulse(v); } });

/** The Reverse button: flip the HUD motor speed (and its slider). */
export function reverse() {
    state.motorSpeed = -state.motorSpeed;
    motor.value = state.motorSpeed;
    setMotorSpeed(state.motorSpeed);
}

$('#reset').addEventListener('click', () => switchMachine(state.machine));
$('#nudge').addEventListener('click', nudge);
$('#drop').addEventListener('click', drop);
$('#reverse').addEventListener('click', reverse);

document.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '')) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!state.paused); }
    else if (e.key === 'r' || e.key === 'R') switchMachine(state.machine);
});

// --- grabbing: only the machine's own moving parts ------------------------------------

export const grab = grabber(vp, { onRelease: () => status.set('released') });

/** Try to grab the rig body under a canvas-local pixel; returns its tag or null. */
export function grabAt(lx, ly) {
    const hit = raycast(pickRay(vp, lx, ly), 200);
    if (!hit || !rig.bodies.has(hit.bodyId)) return null;
    grab.begin(hit);
    status.set('dragging a part');
    return hit.bodyId;
}

vp.canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const [lx, ly] = localPoint(vp.canvas, ev);
    grabAt(lx, ly);
});

// --- readouts ------------------------------------------------------------------------------

const deg = (r) => (r * 180 / Math.PI).toFixed(0) + '°';
const P = (tag) => Physics.getTransform(tag).position;

/** The machine's headline number: [label, text]. */
export function readout() {
    const p = rig.probe;
    if (!p) return ['motion', '—'];
    switch (rig.type) {
        case 'pendulum': { const b = P(p.bob); return ['swing angle', deg(Math.atan2(b.x - p.pivot.x, p.pivot.y - b.y))]; }
        case 'gearbox': return ['crate lift', (P(p.crate).y - p.crateY0).toFixed(2) + ' m'];
        case 'piston': return ['piston travel', (P(p.head).y - p.headY0).toFixed(2) + ' m'];
        case 'cradle': { const v = Physics.getVelocity(p.balls[p.balls.length - 1]).linear; return ['last ball', Math.hypot(v.x, v.y, v.z).toFixed(2) + ' m/s']; }
        case 'bridge': return ['deck sag', Math.max(0, p.deckY - Math.min(...p.planks.map((t) => P(t).y))).toFixed(2) + ' m'];
    }
    return ['motion', '—'];
}

function refreshStats() {
    $('#bodies').textContent = rig.bodies.size;
    $('#constraints').textContent = rig.constraints.length - rig.broken.size;
    $('#broken').textContent = rig.broken.size;
    const [label, text] = readout();
    $('#readoutLabel').textContent = label;
    $('#readout').textContent = text;
}

// --- loop ------------------------------------------------------------------------------------

const fps = fpsMeter();
let frameNo = 0;
vp.onFrame((dt) => {
    events.pump();
    if (!state.paused) grab.update(dt);
    tickRig();
    const f = fps.tick();
    if (++frameNo % 10 === 0) {
        refreshStats();
        $('#fps').textContent = f ? f.toFixed(0) : '—';
    }
});

switchMachine(state.machine);
