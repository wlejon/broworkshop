// tests/drive.js — the harness Torque's behavioural tests share: the page's
// own app handles, a counting check, and the input-level drivers (held
// actions, the centerline autopilot, the heading-unwrapping manoeuvre).
//
// Nothing here reaches past the input layer: every driver steers through the
// same held-action flags a human's keys set.
//
// Playback under advanceTime() is deterministic, so the same run gives the
// same numbers every time; the thresholds in the tests are margins around
// measured behaviour, not guesses.

// app.js is imported, not main.js: a driver script importing the page's ENTRY
// module gets a second evaluation of it (ENGINE-ISSUES.md), i.e. a second
// circuit and garage stacked on the first.
import * as app from '/app/app.js';
export { app };
export const { car, world, cameras, scene, state, garage, audio, rumble } = app;

let failures = 0;

/** A named check that logs and counts rather than throwing, so one physics miss does not hide the rest. */
export function check(name, ok, detail) {
    if (ok) console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
    else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

/** End of a test file: the verdict line, then fail the run if anything did. */
export function finish(label) {
    console.log('==============================================================');
    console.log(failures === 0 ? `${label}: ALL CHECKS PASSED` : `${label}: ${failures} CHECK(S) FAILED`);
    assert(failures === 0, `${failures} check(s) failed`);
}

export const section = (title) => console.log(`--- ${title} ${'-'.repeat(Math.max(3, 58 - title.length))}`);

/**
 * The car's position through its CURRENT chassis node. A body tag captured
 * once goes stale the moment a tyre-preset change rebuilds the constraint;
 * the wrapper's getter always points at the live vehicle.
 */
export const livePos = () => car.chassisNode.localToWorld(0, 0, 0);

/** Release every held action. */
export function releaseAll() {
    for (const k in car.held) car.setHeld(k, false);
}

/** Hold a set of actions for `ms` of virtual time. */
export function drive(actions, ms) {
    releaseAll();
    for (const a of actions) car.setHeld(a, true);
    advanceTime(ms);
    for (const a of actions) car.setHeld(a, false);
}

/**
 * Signed heading error (radians) from vehicle `v`'s nose to a centerline
 * sample ten ahead. An ANGLE, not a raw cross product: the cross product
 * scales with the aim distance, and thresholding it directly saws the wheel
 * lock-to-lock at ~1° of error — enough to trip the car over.
 */
export function aimError(v) {
    const o = v.chassisNode.localToWorld(0, 0, 0);
    const f = v.chassisNode.localToWorld(0, 0, 1);
    const aim = world.edge(world.nearestIndex(o.x, o.z) + 10, 0);
    const fx = f.x - o.x, fz = f.z - o.z;
    const dx = aim.x - o.x, dz = aim.z - o.z;
    return Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
}

/** One autopilot correction: steer toward the centerline ahead. */
export function steerToLine(v) {
    const err = aimError(v || garage.active);
    car.setHeld('steerRight', err > 0.10);
    car.setHeld('steerLeft', err < -0.10);
}

/**
 * Hold `actions` on the ACTIVE vehicle while the autopilot keeps it on the
 * road. Straight-line running is no good past about three seconds: the
 * circuit curves, and a vehicle held straight ploughs into the gravel.
 */
export function driveGuided(actions, ms, slice = 100) {
    const v = garage.active;
    releaseAll();
    for (const a of actions) car.setHeld(a, true);
    for (let t = 0; t < ms; t += slice) {
        steerToLine(v);
        advanceTime(slice);
    }
    releaseAll();
}

/** The car back on the start line, at rest, past the respawn settle window. */
export function reset() {
    car.respawn(world.spawn.position, world.spawn.rotation);
    releaseAll();
    advanceTime(900);
}

/** The car dropped onto centerline sample `i`, `lift` metres up, settled. */
export function placeCarAt(i, lift = 1.2, settleMs = 900) {
    const p = world.edge(i, 0);
    car.respawn({ x: p.x, y: p.y + lift, z: p.z }, world.quatYaw(world.yawAt(i)));
    if (settleMs) advanceTime(settleMs);
}

/** Unwrapped heading (radians) from the chassis' own forward vector. */
export function headingOf(v) {
    const o = v.chassisNode.localToWorld(0, 0, 0);
    const f = v.chassisNode.localToWorld(0, 0, 1);
    return Math.atan2(f.x - o.x, f.z - o.z);
}
export const originOf = (v) => v.chassisNode.localToWorld(0, 0, 0);

/**
 * Hold a set of actions on the ACTIVE vehicle for `ms`, sampling as it goes.
 *
 * Heading is accumulated as wrapped per-sample deltas rather than read as an
 * end-to-end difference: a pivoting tank sweeps several radians, atan2 wraps
 * at ±π, and a naive end-minus-start reading of a 2.7 rad pivot comes back as
 * -3.6 rad — the wrong magnitude AND the wrong sign.
 *
 * Sideslip is the angle between where the vehicle points and where it is
 * going: the direct measure of lateral grip, so it is what the friction
 * presets are judged on.
 *
 * @returns {{turned, travelled, maxSideslip, samples}} turned = signed radians
 */
export function manoeuvre(actions, ms, slice = 100) {
    const v = garage.active;
    releaseAll();
    for (const a of actions) car.setHeld(a, true);

    const start = { ...originOf(v) };
    let prevHeading = headingOf(v);
    let prev = { ...start };
    let turned = 0, maxSideslip = 0, samples = 0;

    for (let t = 0; t < ms; t += slice) {
        advanceTime(slice);
        const h = headingOf(v);
        let d = h - prevHeading;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turned += d;
        prevHeading = h;

        const p = originOf(v);
        const dx = p.x - prev.x, dz = p.z - prev.z;
        if (Math.hypot(dx, dz) > 0.15) {
            const f = v.chassisNode.localToWorld(0, 0, 1);
            const fx = f.x - p.x, fz = f.z - p.z;
            const ang = Math.abs(Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz));
            maxSideslip = Math.max(maxSideslip, ang * 180 / Math.PI);
            samples++;
        }
        prev = { ...p };
    }
    releaseAll();

    const end = originOf(v);
    return { turned, travelled: Math.hypot(end.x - start.x, end.z - start.z), maxSideslip, samples };
}

/** Put the ACTIVE vehicle back on the start line, at rest and settled. */
export function resetActive() {
    releaseAll();
    garage.toStart(garage.active);
    advanceTime(1000);
}

/**
 * Screenshot into tests/out/shots, named for the app. Frames the chase view
 * (or whatever camera is live) exactly as a player would see it.
 */
export function portrait(name) {
    flush();
    screenshot('tests/out/shots/games_torque-' + name + '.png');
}
