// Mechanical Sandbox: the HUD controls act live on the running machine
// (motor, gravity, elasticity, joint strength), the bridge breaks only when
// it should, and Space / R / the buttons / left-drag work through real input.
// Run: scripts/validate.sh demos/mechanical-sandbox

import { check, eq, near, test, done, frames, setValue, text, clickOn, press, shot } from "/lib/kit/test.js";
import { state, switchMachine, vp, grab } from "/app/sandbox.js";
import { rig } from "/app/rig.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";

frames(10);

const P = (tag) => Physics.getTransform(tag).position;

test('motor speed retargets every motor live, times its machine gain', () => {
    switchMachine('piston');
    frames(20);
    setValue('#motor', 2);
    eq(text('#motorV'), '2.0x');
    frames(30);
    near(Math.abs(Physics.getVelocity(rig.probe.crank).angular.z), 8, 0.8, 'crank at 2 x gain 4');
    setValue('#motor', 1);
});

test('gravity slider sets the world gravity', () => {
    setValue('#gravity', 3.5);
    eq(text('#gravityV'), '3.5 m/s²');
    near(Physics.getGravity().y, -3.5, 1e-4);
    setValue('#gravity', 9.8);
    near(Physics.getGravity().y, -9.8, 1e-4);
});

test('elasticity applies to the cradle balls without a rebuild', () => {
    switchMachine('cradle');
    setValue('#restitution', 0.6);
    for (const t of rig.probe.balls) near(Physics.getBodyProperties(t).restitution, 0.6, 1e-4);
    setValue('#restitution', 0.99);
});

test('strength slider retargets the intact bridge joints live', () => {
    switchMachine('bridge');
    eq(rig.breakable.length, 22, 'every hanger and hinge is breakable');
    setValue('#strength', 3000);
    eq(text('#strengthV'), '3000 N·s');
    for (const h of rig.breakable) near(Physics.getConstraintBreakingImpulse(h), 3000, 1e-3);
});

test('a strong bridge carries the load; a weak one breaks and says so', () => {
    setValue('#strength', 5000);
    switchMachine('bridge');
    clickOn('#drop');
    frames(120);
    eq(rig.broken.size, 0, 'nothing breaks at 5000');
    eq(rig.bodies.size, 8, 'the load is a machine body');
    setValue('#strength', 200);
    switchMachine('bridge');
    eq(rig.bodies.size, 7, 'reset swept the load away');
    clickOn('#drop');
    frames(120);
    check(rig.broken.size > 0, `joints broke at 200 (${rig.broken.size})`);
    eq(+text('#broken'), rig.broken.size);
    eq(+text('#constraints'), 22 - rig.broken.size, 'constraint count drops');
    check(/broke/.test(text('#status')), `status (${text('#status')})`);
    shot('bridge-broken');
    setValue('#strength', 1200);
});

test('Space pauses the physics, the camera keeps working', () => {
    switchMachine('pendulum');
    frames(10);
    clickOn('#stage');
    frames(1);
    press(' ');
    check(state.paused && bro.time.scale === 0, 'paused');
    const a = P(rig.probe.bob);
    const dist = vp.cam.dist;
    frames(20);
    const b = P(rig.probe.bob);
    near(b.x, a.x, 1e-6, 'bob frozen');
    check(/paused/.test(text('#status')), 'status says paused');
    eq(vp.cam.dist, dist);
    press(' ');
    check(!state.paused && bro.time.scale === 1, 'resumed');
    frames(10);
    check(Math.abs(P(rig.probe.bob).x - b.x) > 1e-3, 'moving again');
});

test('R and the Reset button rebuild the machine in its start pose', () => {
    switchMachine('pendulum');
    const start = P(rig.probe.bob).x;
    frames(40);
    check(Math.abs(P(rig.probe.bob).x - start) > 0.3, 'swung away');
    press('r');
    frames(1);
    near(P(rig.probe.bob).x, start, 0.05, 'R reset');
    frames(40);
    clickOn('#reset');
    frames(1);
    near(P(rig.probe.bob).x, start, 0.05, 'button reset');
});

test('Nudge kicks the machine', () => {
    switchMachine('pendulum');
    frames(2);
    const v0 = Physics.getVelocity(rig.probe.bob).linear.x;
    clickOn('#nudge');
    frames(1);
    check(Physics.getVelocity(rig.probe.bob).linear.x > v0 + 1.5, 'bob kicked along +x');
});

test('left-drag grabs a machine part and pulls it; releasing lets go', () => {
    switchMachine('pendulum');
    press(' ');                              // freeze the bob so the click lands on it
    const r = vp.canvas.getBoundingClientRect();
    const view = Camera.orbitViewOpts(vp.cam, vp.canvas);
    const b = P(rig.probe.bob);
    const s = worldToScreen([b.x, b.y, b.z], view, r.width, r.height);
    press(' ');
    const x = r.left + s.x, y = r.top + s.y;
    mouseMove(x, y);
    mouseDown(x, y, 0);
    frames(1);
    eq(grab.grabbed, rig.probe.bob, 'grabbed the bob');
    const before = P(rig.probe.bob).y;
    mouseMove(x, y - 150);
    frames(30);
    check(P(rig.probe.bob).y > before + 0.5, `dragged up (${before.toFixed(2)} -> ${P(rig.probe.bob).y.toFixed(2)})`);
    mouseUp(x, y - 150, 0);
    frames(1);
    eq(grab.grabbed, null, 'released');
});

test('a click on the floor grabs nothing', () => {
    const r = vp.canvas.getBoundingClientRect();
    mouseDown(r.left + 20, r.bottom - 20, 0);
    frames(1);
    eq(grab.grabbed, null);
    mouseUp(r.left + 20, r.bottom - 20, 0);
});

frames(10);
done('mechanical-sandbox controls');
