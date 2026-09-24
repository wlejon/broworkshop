// tests/test_rigid.js — the sandbox bay: spawning, area fields, materials,
// runtime body properties, the layer matrix, step rate + interpolation,
// scene sync, the material race, a stress rain, and mouse picking.
//
// Every assertion measures a DIFFERENCE only the feature under test explains:
// same shape, same drop, same duration, one variable. advanceTime() playback
// is deterministic, so the numbers are reproducible run to run.

import { test, check, done, frames, press, shot } from "/lib/kit/test.js";
import { pickRay } from "/lib/kit/physics3d.js";
import * as app from "/app/view.js";
import { stage } from "/app/sim/stage.js";
import { LAYER_NAMES, setPair, collides, resetLayers } from "/app/sim/layers.js";
import { AREA_DEFS, setAreaEnabled, setAreaParam } from "/app/sim/areas.js";
import { bodies, bodyCount, spawn, despawn, clearAll, materialRace, rain } from "/app/sim/spawn.js";
import * as sandbox from "/app/ui/sandbox.js";

advanceTime(200);

const tf = (t) => Physics.getTransform(t).position;
const y = (t) => tf(t).y;
const x = (t) => tf(t).x;
const log = (s) => console.log('        ' + s);
function reset() { clearAll(); sandbox.select(null); advanceTime(120); }
const ZONES = ['lowgrav', 'water', 'well'];

test('scaffold: lanes, layers, zones', () => {
    check(Object.keys(stage.lanes).length === 3, 'three lanes');
    check(stage.lanes.ice.friction < 0.1, 'ice is slick');
    check(stage.lanes.rubber.restitution > 0.8, 'rubber is bouncy');
    check(LAYER_NAMES.length === 6, 'six layers');
    check(AREA_DEFS.length === 3, 'three area zones');
});

test('spawning + registry', () => {
    reset();
    const s1 = spawn('box', { x: 0, y: 6, z: 0 }, { layer: 'player' });
    const s2 = spawn('compound', { x: 2, y: 6, z: 0 }, { layer: 'debris' });
    check(bodyCount() === 2, 'count tracks spawns');
    check(bodies.get(s1.tag).kind === 'box' && bodies.get(s2.tag).kind === 'compound', 'registry keyed by tag');
    despawn(s2.tag);
    check(bodyCount() === 1, 'despawn removes one');
    clearAll();
    check(bodyCount() === 0, 'clearAll empties registry');
    check(Physics.getTransform(stage.lanes.ice.body) !== undefined, 'clearAll spares the stage');
});

test('low-gravity field slows a fall; off restores it', () => {
    reset();
    setAreaEnabled('lowgrav', true);
    setAreaParam('lowgrav', 'gravityScale', 0.12);
    const a = spawn('sphere', { x: 8, y: 8.5, z: -6 }, { linearDamping: 0 });
    const b = spawn('sphere', { x: -8, y: 8.5, z: -6 }, { linearDamping: 0 });
    advanceTime(1000);
    const dIn = 8.5 - y(a.tag), dOut = 8.5 - y(b.tag);
    log(`fell ${dIn.toFixed(3)} m inside vs ${dOut.toFixed(3)} m outside`);
    check(dIn < dOut * 0.5, 'low-gravity body falls measurably slower');
    reset();
    setAreaEnabled('lowgrav', false);
    const c = spawn('sphere', { x: 8, y: 8.5, z: -6 }, { linearDamping: 0 });
    advanceTime(1000);
    check(Math.abs((8.5 - y(c.tag)) - dOut) < 0.25, 'disabling the zone restores normal fall');
    setAreaEnabled('lowgrav', true);
});

test('water field damps a fall', () => {
    reset();
    setAreaEnabled('water', true);
    const wet = spawn('sphere', { x: 8, y: 4.5, z: 0 }, { linearDamping: 0 });
    const dry = spawn('sphere', { x: -8, y: 4.5, z: 0 }, { linearDamping: 0 });
    advanceTime(1000);
    const dWet = 4.5 - y(wet.tag), dDry = 4.5 - y(dry.tag);
    log(`sank ${dWet.toFixed(3)} m in water vs ${dDry.toFixed(3)} m in air`);
    check(dWet < dDry * 0.6, 'high-damping zone slows a body');
});

test('point-gravity well pulls sideways', () => {
    // World gravity is pure -Y, so any X displacement is the well's doing.
    reset();
    setAreaEnabled('well', true);
    setAreaParam('well', 'gravityStrength', 40);
    const pulled = spawn('sphere', { x: 12.5, y: 5.5, z: 6 }, { linearDamping: 0 });
    const free = spawn('sphere', { x: -8, y: 5.5, z: 6 }, { linearDamping: 0 });
    // Short window: an inverse-square well has no core, so a body that
    // reaches the centre (~0.3 s at this strength) is slingshot out again.
    advanceTime(250);
    const moved = 12.5 - x(pulled.tag), drift = Math.abs(-8 - x(free.tag));
    log(`moved ${moved.toFixed(3)} m inward; control drifted ${drift.toFixed(4)} m`);
    check(moved > 0.3 && drift < 0.05, 'pulled toward the centre');
    setAreaParam('well', 'gravityStrength', 26);
});

test('restitution: bouncy vs dead ball', () => {
    reset();
    for (const k of ZONES) setAreaEnabled(k, false);
    const bouncy = spawn('sphere', { x: 0, y: 6, z: 0 }, { restitution: 0.95, restitutionCombine: 'max', linearDamping: 0 });
    const dead = spawn('sphere', { x: -4, y: 6, z: 0 }, { restitution: 0, restitutionCombine: 'min', linearDamping: 0 });
    let apexB = 0, apexD = 0;
    for (let i = 0; i < 240; i++) {
        advanceTime(16);
        if (i > 80) { apexB = Math.max(apexB, y(bouncy.tag)); apexD = Math.max(apexD, y(dead.tag)); }
    }
    log(`apex ${apexB.toFixed(3)} m vs ${apexD.toFixed(3)} m`);
    check(apexB > apexD * 3 && apexB > 1.0, 'high restitution rebounds higher');
});

test('runtime friction + property round-trip', () => {
    const slide = (mu) => {
        reset();
        const b = spawn('box', { x: -9, y: 0.42, z: 0 }, { friction: 0.5, restitution: 0, linearDamping: 0, angularDamping: 0 });
        Physics.setFriction(b.tag, mu);
        Physics.activate(b.tag);
        Physics.setLinearVelocity(b.tag, 8, 0, 0);
        advanceTime(1200);
        return x(b.tag) + 9;
    };
    const slick = slide(0.02), grip = slide(1.5);
    log(`slid ${slick.toFixed(3)} m at mu=0.02 vs ${grip.toFixed(3)} m at mu=1.5`);
    check(slick > grip * 1.8, 'setFriction changes slide distance');

    // Through the panel's own path: select, then setSelectedProp per field.
    reset();
    const b = spawn('box', { x: 0, y: 6, z: 0 });
    sandbox.select(b.tag);
    const want = { mass: 42, friction: 0.77, restitution: 0.66, linearDamping: 1.25, angularDamping: 2.5, gravityFactor: 0.5 };
    for (const k in want) sandbox.setSelectedProp(k, want[k]);
    const p = Physics.getBodyProperties(b.tag);
    for (const k in want) check(Math.abs(p[k] - want[k]) < 0.01, k + ' reads back');
    check(/#\d+ box on player/.test(document.querySelector('#selInfo').textContent), 'selection readout names the body');
    check(!document.querySelector('#selControls').classList.contains('disabled'), 'editor enabled with a selection');
});

test('gravityFactor 0 through the panel floats a body', () => {
    reset();
    const floaty = spawn('sphere', { x: 0, y: 8, z: 0 }, { linearDamping: 0 });
    const normal = spawn('sphere', { x: -4, y: 8, z: 0 }, { linearDamping: 0 });
    sandbox.select(floaty.tag);
    sandbox.setSelectedProp('gravityFactor', 0);
    advanceTime(900);
    log(`floaty y=${y(floaty.tag).toFixed(3)}, normal y=${y(normal.tag).toFixed(3)}`);
    check(Math.abs(y(floaty.tag) - 8) < 0.05 && y(normal.tag) < 5.5, 'floats');
    sandbox.select(null);
    check(document.querySelector('#selControls').classList.contains('disabled'), 'editor disabled when deselected');
});

test('collision layer matrix decides ramp contact', () => {
    const drop = () => {
        reset();
        const b = spawn('sphere', { x: -16, y: 7, z: 0 }, { layer: 'projectile', friction: 1.5, restitution: 0, linearDamping: 0 });
        advanceTime(1400);
        return y(b.tag);
    };
    setPair('projectile', 'scenery', true);
    const blocked = drop();
    setPair('projectile', 'scenery', false);
    const through = drop();
    log(`rested at y=${blocked.toFixed(3)} with the pair on, fell to ${through.toFixed(3)} with it off`);
    check(blocked > 1.0 && through < 0.5 && blocked - through > 1.5, 'the matrix change moved it');
    check(collides('projectile', 'scenery') === collides('scenery', 'projectile'), 'symmetric');
    resetLayers();
    check(collides('projectile', 'scenery') === false, 'reset restores the default');
    check(collides('debris', 'debris') === false && collides('player', 'debris') === true, 'default pairs');
});

test('layer matrix checkboxes drive setPair', () => {
    resetLayers(); sandbox.syncLayerMatrix();
    const i = LAYER_NAMES.indexOf('projectile'), j = LAYER_NAMES.indexOf('scenery');
    const cb = document.querySelector(`#layerMatrix input[data-i="${i}"][data-j="${j}"]`);
    const mirror = document.querySelector(`#layerMatrix input[data-i="${j}"][data-j="${i}"]`);
    check(cb && !cb.checked, 'cell reflects the default');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    flush();
    check(collides('projectile', 'scenery') === true && mirror.checked, 'checkbox sets both cells');
    resetLayers(); sandbox.syncLayerMatrix();
});

test('step rate + interpolation', () => {
    reset();
    sandbox.setStepRate(15);
    check(sandbox.state.stepHz === 15 && document.querySelector('#stStep').textContent === '15 Hz', 'rate recorded');
    const mismatches = (interp) => {
        reset();
        sandbox.setInterpolation(interp);
        const a = spawn('sphere', { x: 0, y: 40, z: 0 }, { linearDamping: 0 });
        let n = 0;
        for (let i = 0; i < 24; i++) {
            advanceTime(16);
            if (Math.abs(y(a.tag) - Physics.getTransform(a.tag, { interpolated: true }).position.y) > 1e-6) n++;
        }
        return n;
    };
    const off = mismatches(false), on = mismatches(true);
    log(`${off}/24 frames blended with interpolation off, ${on}/24 with it on`);
    check(off === 0, 'off: render pose == stepped pose');
    check(on > 4, 'on at 15 Hz: render pose blends');
    check(Physics.getInterpolation() === true && document.querySelector('#stInterp').textContent === 'on', 'toggle reflected');
    sandbox.setInterpolation(false);
    sandbox.setStepRate(60);
});

// PhysicsNode sync lives in test_physics_node.js: an engine check, isolated
// because it fails until createPhysicsNode honours `body` (ENGINE-ISSUES.md).

test('material race: ice carries a box furthest', () => {
    reset();
    for (const k of ZONES) setAreaEnabled(k, false);
    const racers = materialRace(stage);
    check(racers.length === 3, 'one racer per lane');
    advanceTime(6000);
    const at = {};
    racers.forEach((r, i) => { at[stage.MATERIALS[i].key] = x(r.tag); });
    log(`ice x=${at.ice.toFixed(2)}  concrete x=${at.concrete.toFixed(2)}  rubber x=${at.rubber.toFixed(2)}`);
    check(at.ice > -11 && at.concrete > -11 && at.rubber > -11, 'all left their ramps');
    check(at.ice - at.concrete > 3.0, 'ice beats concrete by metres');
});

test('stress rain', () => {
    reset();
    rain(120);
    check(bodyCount() === 120, 'rain spawns the requested count');
    advanceTime(1500);
    check(bodyCount() === 120, 'pile survives');
    frames(20);
    check(document.querySelector('#stBodies').textContent === '120', 'status bar counts bodies');
    clearAll();
    check(bodyCount() === 0, 'cleanup');
});

// --- picking -----------------------------------------------------------------
// The mouse path end to end: a real click on the canvas, over a body whose
// screen position comes from projecting it with the same camera.

function canvasPoint(world) {
    const r = app.vp.canvas.getBoundingClientRect();
    const s = app.vp.toScreen(world);
    return { lx: s.x, ly: s.y, cx: r.left + s.x, cy: r.top + s.y, behind: s.behind };
}

test('left-click on a body selects it', () => {
    reset();
    for (const k of ZONES) setAreaEnabled(k, false);
    const b = spawn('box', { x: 0, y: 0.42, z: 0 }, { friction: 1 });
    advanceTime(600);
    const p = tf(b.tag);
    const s = canvasPoint([p.x, p.y, p.z]);
    check(!s.behind, 'body is in view');
    click(s.cx, s.cy, 0);
    flush();
    check(sandbox.state.selected === b.tag, `clicked body selected (got ${sandbox.state.selected})`);
    check(app.grab.grabbed == null, 'mouseup released the grab');
});

test('left-click on the floor spawns there', () => {
    reset();
    // Behind the front wall's line of sight: the concrete lane, mid-field.
    const s = canvasPoint([-2, 0, -1]);
    const r = app.pickAt(s.lx, s.ly);
    check(r.kind === 'spawn' && bodyCount() === 1, 'spawned one');
    log(`spawned at (${r.point.x.toFixed(2)}, ${r.point.y.toFixed(2)}, ${r.point.z.toFixed(2)})`);
    check(Math.abs(r.point.x + 2) < 0.3 && Math.abs(r.point.z + 1) < 0.3 && Math.abs(r.point.y - 1.2) < 0.1,
        'at the clicked point, 1.2 m up');
});

test('grabber drags a body toward the cursor ray', () => {
    reset();
    const b = spawn('box', { x: 0, y: 0.42, z: 0 });
    advanceTime(400);
    const s = canvasPoint([0, 0.42, 0]);
    const r = app.pickAt(s.lx, s.ly);
    check(r.kind === 'select' && app.grab.grabbed === b.tag, 'grab began');
    // Move the "cursor" to a point 3 m up and hold.
    const t = canvasPoint([0, 3.4, 0]);
    app.grab.setRay(pickRayAt(t));
    advanceTime(1500);
    log(`grabbed box at y=${y(b.tag).toFixed(2)}`);
    check(y(b.tag) > 2.0, 'lifted toward the cursor');
    app.grab.end();
    advanceTime(1200);
    check(y(b.tag) < 1.0 && app.grab.grabbed == null, 'released, it falls back');
});

function pickRayAt(s) { return pickRay(app.vp, s.lx, s.ly); }

test('keyboard: Enter drops one, Escape deselects, Space toggles interpolation', () => {
    reset();
    press('Enter');
    check(bodyCount() === 1, `Enter drops (count ${bodyCount()})`);
    sandbox.select([...bodies.values()][0].tag);
    press('Escape');
    check(sandbox.state.selected == null, 'Escape deselects');
    press(' ');
    check(sandbox.state.interpolation === true, 'Space toggles');
    sandbox.setInterpolation(false);
});

test('screenshot: sandbox', () => {
    reset();
    for (const k of ZONES) setAreaEnabled(k, true);
    materialRace(stage);
    rain(30);
    advanceTime(2500);
    shot('sandbox');
});

done('physics-playground rigid');
