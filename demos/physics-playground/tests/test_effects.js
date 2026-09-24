// tests/test_effects.js — the breakyard (breakingImpulse joints, the broken-
// constraint stream) and the contact viewer (manifolds, the impulse estimate,
// the impact meter and camera shake), plus the all-bays clear.
//
// Contact events are read through the world's one drain (sim/world.js
// `events`), subscribed here, rather than from the panel's capped `recent`
// list: with drawAll on, the bridge and the yard fill that list in a frame.

import { test, check, done, frames, clickOn, setValue, shot } from "/lib/kit/test.js";
import * as view from "/app/view.js";
import { events } from "/app/sim/world.js";
import { spawn, clearAll, bodyCount } from "/app/sim/spawn.js";
import { setAreaEnabled } from "/app/sim/areas.js";
import { bridge, BRIDGE, rubble, brokenCount, jointCount, dropWreckingBall, rebuildBridge } from "/app/sim/bridge.js";
import { state as cstate, recent, shakeOffset, clearContacts, setFocus } from "/app/sim/contacts.js";
import { machineDebris, craneLoad, loadPiston, fireTurret, machines } from "/app/sim/machines.js";
import { mechanisms } from "/app/sim/bench.js";
import { spawnRagdoll, ragdollCount } from "/app/sim/ragdolls.js";
import { buildCloth, softBodies } from "/app/sim/softbody.js";
import * as fx from "/app/ui/effects.js";

advanceTime(200);

const log = (s) => console.log('        ' + s);
function reset() { clearAll(); advanceTime(120); }
for (const k of ['lowgrav', 'water', 'well']) setAreaEnabled(k, false);

// --- breakable joints ---------------------------------------------------------------

function smashAt(threshold) {
    rebuildBridge();
    fx.setBreakThreshold(threshold);
    advanceTime(600);                         // let the deck settle first
    dropWreckingBall(900, 12);
    advanceTime(3000);
    return { broken: brokenCount(), joints: jointCount() };
}

test('breakingImpulse: the same impact, only the threshold changed', () => {
    reset();
    const tough = smashAt(30000);
    log(`${tough.broken} of ${tough.joints} joints broke at 30000 N·s`);
    check(tough.broken === 0, 'a high threshold survives intact');
    const fragile = smashAt(400);
    log(`${fragile.broken} of ${fragile.joints} broke at 400 N·s: ` +
        bridge.log.slice(0, 4).map((o) => `${o.kind}#${o.index}`).join(', '));
    check(fragile.broken > 0, 'a low threshold snaps joints');
    check(bridge.log.length === fragile.broken && bridge.log.every((o) => bridge.joints.some((j) => j.handle === o.handle)),
          'getBrokenConstraints reported bridge joint handles');
    const lowest = Math.min(...bridge.planks.map((p) => Physics.getTransform(p.tag).position.y));
    log(`lowest plank y=${lowest.toFixed(2)} (deck line ${BRIDGE.y})`);
    check(lowest < BRIDGE.y - 1.0, 'the deck fell where its joints let go');
    frames(25);
    check(document.querySelector('#stBroken').textContent === `${fragile.broken} / ${fragile.joints}`, 'broken readout');
    check(document.querySelectorAll('#breakLog > div').length > 0 && !/no joints/.test(document.querySelector('#breakLog').textContent),
          'break log lists joints');
    rebuildBridge();
    fx.setBreakThreshold(30000);
    advanceTime(600);
    check(brokenCount() === 0 && rubble.size === 0 &&
          Math.abs(Physics.getTransform(bridge.planks[6].tag).position.y - BRIDGE.y) < 0.4, 'rebuild is a real reset');
    fx.setBreakThreshold(900);
});

test('bridge panel: threshold slider and hint', () => {
    clickOn('#tabs [data-tab="bridge"]');
    setValue('#breakParams input[type="range"]', 25000);
    check(fx.state.breakThreshold === 25000 && bridge.threshold === 25000, 'slider sets the threshold');
    check(/indestructible/.test(document.querySelector('#breakHint').textContent), 'hint: ' + document.querySelector('#breakHint').textContent);
    setValue('#breakParams input[type="range"]', 900);
    check(/realistic/.test(document.querySelector('#breakHint').textContent), 'hint follows back');
    clickOn('#tabs [data-tab="sandbox"]');
});

// --- contact manifolds -----------------------------------------------------------------

/** Collect raw 'added' events touching `tags` while fn runs. */
function collect(tags, fn) {
    const got = [];
    const sub = (list) => {
        for (const e of list) if (e.type === 'added' && !e.sensor && (tags.has(e.body1) || tags.has(e.body2))) got.push(e);
    };
    events.onContacts(sub);
    try { fn(); } finally { events.off(sub); }
    return got;
}

test('a resting stack reports real manifolds', () => {
    reset();
    const stack = [];
    for (let i = 0; i < 3; i++) stack.push(spawn('box', { x: 0, y: 0.42 + i * 0.85, z: 0 }, { friction: 0.9, restitution: 0 }));
    const ev = collect(new Set(stack.map((s) => s.tag)), () => advanceTime(2000));
    log(`${ev.length} events, ${ev.map((c) => c.points.length).join('/')} points`);
    check(ev.length > 0 && ev.every((c) => c.points && c.points.length > 0), 'non-empty manifolds');
    check(ev.every((c) => c.normal && Math.abs(Math.hypot(c.normal.x, c.normal.y, c.normal.z) - 1) < 1e-3), 'unit normals');
    check(ev.some((c) => Math.abs(c.normal.y) > 0.95), 'a near-vertical normal on a flat lane');
    check(ev.every((c) => Math.abs(c.penetration) < 0.1), 'plausible penetration depths');
});

test('contact impulse scales with the impact; meter and shake follow', () => {
    const impact = (speed) => {
        reset();
        const b = spawn('sphere', { x: 0, y: 3, z: 0 }, { mass: 20, restitution: 0, linearDamping: 0 });
        Physics.setLinearVelocity(b.tag, 0, -speed, 0);
        Physics.activate(b.tag);
        const ev = collect(new Set([b.tag]), () => advanceTime(1600));
        return ev.length ? Math.max(...ev.map((c) => c.impulse || 0)) : 0;
    };
    const slow = impact(2), fast = impact(40);
    log(`${slow.toFixed(1)} at 2 m/s vs ${fast.toFixed(1)} at 40 m/s`);
    check(slow > 0 && fast > slow * 2.5, 'faster impact, larger impulse');

    reset();
    fx.setContactEffects(true);
    const hammer = spawn('sphere', { x: 0, y: 3, z: 0 }, { mass: 40, restitution: 0, linearDamping: 0 });
    Physics.setLinearVelocity(hammer.tag, 0, -45, 0);
    Physics.activate(hammer.tag);
    let peakShake = 0, peakMeter = 0;
    for (let i = 0; i < 40; i++) {
        advanceTime(16);
        peakShake = Math.max(peakShake, Math.hypot(...shakeOffset(i * 0.016)));
        peakMeter = Math.max(peakMeter, cstate.peakImpulse);
    }
    log(`meter peaked at ${peakMeter.toFixed(1)} N·s, shake ${peakShake.toFixed(4)}`);
    check(peakMeter > 200, 'the impact meter registers the hit');
    advanceTime(3000);
    check(peakShake > 0.002 && Math.hypot(...shakeOffset(0.25)) === 0, 'shake fires and decays to rest');
});

test('contacts panel: toggles reach the viewer, list shows the focus', () => {
    reset();
    clickOn('#tabs [data-tab="contacts"]');
    const b = spawn('box', { x: 0, y: 2, z: 0 });
    setFocus(b.tag);
    advanceTime(1500);
    frames(25);
    check(recent.length > 0 && document.querySelectorAll('#contactList .crow').length > 0, 'list shows contacts');
    check(document.querySelectorAll('#contactList .crow.hot').length > 0, 'focused rows are highlighted');
    fx.setContactsEnabled(false);
    check(cstate.enabled === false && document.querySelector('#contactParams input[type="checkbox"]').checked === false,
          'enable toggle reaches state and checkbox');
    fx.setContactsEnabled(true);
    clickOn('#btnContactClear');
    check(recent.length === 0, 'clear empties the list');
    clickOn('#tabs [data-tab="sandbox"]');
});

test('clear all sweeps every bay and repairs the bridge', () => {
    reset();
    for (let i = 0; i < 20; i++) spawn('box', { x: -6 + i * 0.6, y: 6, z: 0 });
    spawnRagdoll({ x: 0, y: 4, z: 0 });
    buildCloth('corners');
    craneLoad();
    loadPiston(2);
    fireTurret();
    fx.setBreakThreshold(300);
    dropWreckingBall(900, 10);
    advanceTime(2000);
    log(`${machineDebris.size} machine debris, ${rubble.size} rubble, ${brokenCount()} broken`);
    check(machineDebris.size >= 4 && rubble.size >= 1 && brokenCount() > 0, 'made a mess');
    clickOn('#btnClear');
    advanceTime(200);
    check(bodyCount() === 0 && ragdollCount() === 0 && softBodies.size === 0 && machineDebris.size === 0 &&
          rubble.size === 0 && brokenCount() === 0 && recent.length === 0, 'everything swept, bridge whole');
    check(machines.size === 4 && mechanisms.size === 3, 'machines and bench are fixtures');
    fx.setBreakThreshold(900);
});

test('screenshot: the breakyard mid-collapse', () => {
    view.focusView('bridge');
    fx.setBreakThreshold(400);
    dropWreckingBall(900, 12);
    advanceTime(2200);
    shot('bridge');
    view.focusView('sandbox');
});

done('physics-playground effects');
