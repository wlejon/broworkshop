// Mechanical Sandbox: every machine builds from its button, tears down
// cleanly, and its constraints do what the machine claims (gear ratios, a
// smooth winch, a full piston stroke, momentum through the cradle).
// Run: scripts/validate.sh demos/mechanical-sandbox

import { check, eq, near, test, done, frames, text, clickOn, shot } from "/lib/kit/test.js";
import { state, switchMachine } from "/app/sandbox.js";
import { rig } from "/app/rig.js";
import { MACHINES } from "/app/machines.js";
import { q } from "/lib/kit/physics3d.js";

frames(10);

const P = (tag) => Physics.getTransform(tag).position;
const W = (tag) => Physics.getVelocity(tag).angular;
const button = (type) => [...document.querySelectorAll('#machines button')].find((b) => b.dataset.value === type);
const shown = (sel) => !document.querySelector(sel).hidden;

test('boots on the pendulum with its controls', () => {
    eq(state.machine, 'pendulum');
    eq(document.querySelectorAll('#machines button').length, 5);
    eq(text('#title'), 'Clockwork Pendulum');
    check(shown('#motorRow') && !shown('#restitutionRow') && !shown('#strengthRow'), 'only the motor row');
});

test('each button builds its machine, rows and counts; switching leaks nothing', () => {
    const want = { pendulum: [2, 2], gearbox: [5, 8], piston: [3, 4], cradle: [5, 10], bridge: [7, 22] };
    const before = Physics.getBodyCount ? Physics.getBodyCount() : null;
    for (const type of Object.keys(MACHINES)) {
        clickOn(button(type));
        frames(10);
        eq(rig.type, type);
        check(button(type).classList.contains('active'), `${type} button active`);
        eq(text('#title'), MACHINES[type].title);
        eq(+text('#bodies'), want[type][0], `${type} bodies`);
        eq(rig.constraints.length, want[type][1], `${type} constraints`);
        for (const [row, key] of [['#motorRow', 'motor'], ['#restitutionRow', 'restitution'], ['#strengthRow', 'strength']]) {
            eq(shown(row), MACHINES[type].controls.includes(key), `${type} ${row}`);
        }
        shot('machine-' + type);
    }
    clickOn(button('pendulum'));
    frames(2);
    if (before != null) eq(Physics.getBodyCount(), before, 'body count back where it started');
});

test('pendulum: the bob swings through the bottom and the escape wheel turns at gain 2', () => {
    switchMachine('pendulum');
    const { bob, wheel, pivot } = rig.probe;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < 40; i++) {
        frames(3);
        const b = P(bob);
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
        near(Math.hypot(b.x - pivot.x, b.y - pivot.y), 5.2, 0.05, 'arm length holds');
    }
    check(maxX > 1.5 && minX < -1.5, `swings both ways (${minX.toFixed(2)}..${maxX.toFixed(2)})`);
    near(W(wheel).z, 2 * state.motorSpeed, 0.1, 'wheel speed');
});

test('gearbox: gear ratios, a smooth winch, and the counterweight follows', () => {
    switchMachine('gearbox');
    const p = rig.probe;
    frames(20);
    const [w1, w2, w3] = p.gears.map((g) => W(g).z);
    near(w2 / w1, -p.radii[0] / p.radii[1], 0.02, 'g1 -> g2');
    near(w3 / w2, -p.radii[1] / p.radii[2], 0.02, 'g2 -> g3');
    // Positive motor speed hoists, at drum speed x drum radius, every frame
    // (a mis-signed drift correction jitters the crate by tenths of a metre).
    const y0 = P(p.crate).y, sum0 = P(p.crate).y + P(p.weight).y;
    let last = y0;
    for (let i = 0; i < 30; i++) {
        frames(2);
        const y = P(p.crate).y;
        check(y > last - 1e-3, `crate climbs monotonically (${last.toFixed(3)} -> ${y.toFixed(3)})`);
        last = y;
    }
    near((last - y0) / (60 * 0.016), Math.abs(w3) * p.radii[2], 0.08, 'crate speed = drum rim speed');
    near(P(p.crate).y + P(p.weight).y, sum0, 0.05, 'the rope keeps crate + counterweight height constant');
    check(/^\d/.test(text('#readout')) && text('#readoutLabel') === 'crate lift', 'crate lift readout');
});

test('gearbox: the winch reverses at its top stop and on the Reverse button', () => {
    switchMachine('gearbox');
    const p = rig.probe;
    let top = 0;
    for (let i = 0; i < 80 && p.motor.sign === 1; i++) { frames(10); top = Math.max(top, P(p.crate).y - p.crateY0); }
    eq(p.motor.sign, -1, 'flipped at the stop');
    check(top > 3.6, `reached the top (${top.toFixed(2)} m)`);
    frames(40);
    check(Physics.getVelocity(p.crate).linear.y < -0.2, 'now lowering');
    clickOn('#reverse');
    frames(20);
    eq(state.motorSpeed, -1);
    near(+document.querySelector('#motor').value, -1, 1e-6, 'slider follows');
    check(Physics.getVelocity(p.crate).linear.y > 0.2, 'Reverse hoists again');
    clickOn('#reverse');
});

test('piston: a full 2 m stroke, the rod riding the crank pin', () => {
    switchMachine('piston');
    const p = rig.probe;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 60; i++) {
        frames(1);
        const y = P(p.head).y - p.headY0;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        near(P(p.head).x, 0, 0.02, 'piston stays on its axis');
        // The rod's lower eye stays on the crank pin circle.
        const t = Physics.getTransform(p.rod), o = q.rot(t.rotation, { x: 0, y: -p.rodLength / 2, z: 0 });
        near(Math.hypot(t.position.x + o.x - p.centre.x, t.position.y + o.y - p.centre.y), p.throw, 0.03, 'rod eye on the pin');
    }
    near(hi - lo, 2 * p.throw, 0.12, `stroke (${lo.toFixed(2)}..${hi.toFixed(2)})`);
    near(Math.abs(W(p.crank).z), 4 * state.motorSpeed, 0.5, 'crank at gain 4');
});

test("cradle: the released ball's momentum leaves through the far ball", () => {
    switchMachine('cradle');
    const { balls } = rig.probe;
    const speed = (t) => { const v = Physics.getVelocity(t).linear; return Math.hypot(v.x, v.y, v.z); };
    let peakLast = 0, firstAtPeak = 0;
    for (let i = 0; i < 120; i++) {          // a quarter swing of the 4.2 m ropes is ~1 s
        frames(1);
        const s = speed(balls[4]);
        if (s > peakLast) { peakLast = s; firstAtPeak = speed(balls[0]); }
    }
    check(peakLast > 3, `far ball flies off (${peakLast.toFixed(2)} m/s)`);
    check(firstAtPeak < peakLast * 0.35, `released ball mostly stops (${firstAtPeak.toFixed(2)})`);
});

frames(10);
done('mechanical-sandbox machines');
