// tests/test_smoke.js — behavioural smoke test for Torque.
//
// A vehicle constraint that throws no errors has proved nothing. Every check
// here measures a DIFFERENCE that only working vehicle physics can explain:
// the car covers ground under throttle and stops under brakes, left lock and
// right lock displace it to opposite sides of where it started, the wheels
// carry angular velocity and steer angle that respond to input, the suspension
// compresses on landing, and the parented chase camera arrives somewhere new
// after the car moves.
//
// Playback under advanceTime() is deterministic, so the same run gives the
// same numbers every time; the thresholds below are margins around measured
// behaviour, not guesses.

const app = await import('/app/app.js');

let failures = 0;
function check(name, ok, detail) {
    if (ok) console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
    else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

const { car, world, cameras, scene, state } = app;
const CHASSIS = car.vehicle.chassisBody;

const pos = () => Physics.getTransform(CHASSIS).position;
const camWorld = () => cameras.chase.localToWorld(0, 0, 0);

/** Hold a set of actions for `ms` of virtual time. */
function drive(actions, ms) {
    for (const k in car.held) car.setHeld(k, false);
    for (const a of actions) car.setHeld(a, true);
    advanceTime(ms);
    for (const a of actions) car.setHeld(a, false);
}

// A crude autopilot, used wherever a test needs the car to still be ON the
// road several seconds later. It steers through exactly the same held-action
// flags a human uses — nothing here reaches past the input layer — by aiming
// at a centerline sample a little way ahead and picking a side from the sign
// of the heading error.
function driveGuided(actions, ms, slice = 100) {
    for (const k in car.held) car.setHeld(k, false);
    for (const a of actions) car.setHeld(a, true);
    for (let t = 0; t < ms; t += slice) {
        const o = car.chassisNode.localToWorld(0, 0, 0);
        const f = car.chassisNode.localToWorld(0, 0, 1);
        const aim = world.edge(world.nearestIndex(o.x, o.z) + 10, 0);
        const fx = f.x - o.x, fz = f.z - o.z;
        const dx = aim.x - o.x, dz = aim.z - o.z;
        // Signed heading error as an ANGLE, not a raw cross product. The cross
        // product scales with how far away the aim point is, so thresholding it
        // directly makes the autopilot saw the wheel lock-to-lock at ~1° of
        // error — which slaloms the car hard enough to trip it over, and would
        // have been blamed on the vehicle rather than on the test.
        const err = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
        car.setHeld('steerRight', err > 0.10);
        car.setHeld('steerLeft', err < -0.10);
        advanceTime(slice);
    }
    for (const k in car.held) car.setHeld(k, false);
}

/** Back to the start line, at rest, with a couple of settling frames. */
function reset() {
    car.respawn(world.spawn.position, world.spawn.rotation);
    for (const k in car.held) car.setHeld(k, false);
    advanceTime(900);   // past the respawn settle window: drivetrain back to idle
}

// Let the app's first frames run and the car settle onto its springs.
advanceTime(600);

console.log('--- scaffold -------------------------------------------------');
check('scene context', !!scene, typeof scene);
check('track built', world.samples.length === world.N, `${world.N} samples`);
check('four surfaces', Object.keys(world.surfaceBodies).length === 4,
      Object.keys(world.surfaceBodies).join(','));
check('ice patch is low grip', world.surfaceBodies.ice !== world.surfaceBodies.tarmac,
      `ice=${world.surfaceBodies.ice} tarmac=${world.surfaceBodies.tarmac}`);
check('circuit has a banked corner',
      world.samples.some(s => Math.abs(s.bank) > 0.08),
      `maxBank=${Math.max(...world.samples.map(s => Math.abs(s.bank))).toFixed(3)} rad`);
const flatFrom = Math.round(world.N * 0.32), flatTo = Math.round(world.N * 0.42);
check('circuit has a flat corner',
      world.samples.slice(flatFrom, flatTo).every(s => Math.abs(s.bank) < 0.01),
      `samples ${flatFrom}..${flatTo} unbanked`);
const ys = world.samples.map(s => s.position.y);
check('circuit has elevation change', Math.max(...ys) - Math.min(...ys) > 6,
      `${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m`);
check('the start line is level', Math.abs(world.sampleAt(1).position.y -
      world.sampleAt(-1).position.y) < 0.05,
      `Δy=${(world.sampleAt(1).position.y - world.sampleAt(-1).position.y).toFixed(4)} m`);
check('vehicle is wheeled with 4 wheels',
      car.vehicle.type === 'wheeled' && car.vehicle.wheelCount === 4,
      `${car.vehicle.type} x${car.vehicle.wheelCount}`);

console.log('--- the car sits on the road ---------------------------------');
reset();
{
    const t = car.telemetry();
    const onGround = t.wheels.filter(w => w.contact).length;
    check('all four wheels find the road', onGround === 4, `${onGround}/4 in contact`);
    check('suspension is loaded at rest',
          t.wheels.every(w => w.compression > 0.05 && w.compression < 0.95),
          t.wheels.map(w => w.compression.toFixed(2)).join(' '));
    check('at rest the car is not moving', Math.abs(t.speed) < 0.5,
          `${t.speed.toFixed(3)} m/s`);
}

console.log('--- throttle accelerates -------------------------------------');
reset();
const start = { ...pos() };
driveGuided(['throttle'], 4000);
const afterThrottle = { ...pos() };
const throttleTelem = car.telemetry();
const travelled = Math.hypot(afterThrottle.x - start.x, afterThrottle.z - start.z);
check('throttle covers ground', travelled > 25, `${travelled.toFixed(1)} m in 4 s`);
check('throttle builds speed', throttleTelem.speed > 8,
      `${throttleTelem.speed.toFixed(1)} m/s (${throttleTelem.kmh.toFixed(0)} km/h)`);
check('engine is turning', throttleTelem.rpm > 1000, `${throttleTelem.rpm.toFixed(0)} rpm`);
check('gearbox shifted up', throttleTelem.gear >= 2, `gear ${throttleTelem.gear}`);

console.log('--- braking decelerates --------------------------------------');
// Braking and coasting are run over the SAME stretch of road from the same
// entry speed, so gradient and surface cancel out and the only difference
// left is the brake torque.
{
    reset();
    driveGuided(['throttle'], 3000);
    const entry = car.telemetry().speed;
    drive(['brake'], 900);
    const braked = car.telemetry().speed;

    reset();
    driveGuided(['throttle'], 3000);
    const entry2 = car.telemetry().speed;
    drive([], 900);
    const coasted = car.telemetry().speed;

    // Not an exact match, deliberately. Physics.setPosition resets the BODY,
    // but the drivetrain is separate state inside the controller and there is
    // no API to zero it — the car's respawn holds full brake for 0.6 s to spin
    // it down, which converges to within a few percent rather than exactly.
    // The two runs only have to enter at a comparable speed for the
    // brake-vs-coast comparison below to be fair.
    check('both runs enter at a comparable speed',
          Math.abs(entry - entry2) < entry * 0.12,
          `${entry.toFixed(3)} vs ${entry2.toFixed(3)} m/s`);
    check('brakes scrub speed', braked < entry - 4,
          `${entry.toFixed(1)} → ${braked.toFixed(1)} m/s in 0.9 s`);
    check('braking beats coasting', (entry - braked) > (entry2 - coasted) * 2.5,
          `brake lost ${(entry - braked).toFixed(2)}, coast lost ${(entry2 - coasted).toFixed(2)} m/s`);
}

console.log('--- steering ------------------------------------------------');
// Left and right lock from the same start must displace the car to OPPOSITE
// sides of the straight-ahead run. Measured in the spawn frame's right vector
// so track curvature does not contaminate the reading.
{
    const s0 = world.sampleAt(0);
    const lateral = (p) => (p.x - world.spawn.position.x) * s0.right.x
                         + (p.z - world.spawn.position.z) * s0.right.z;

    reset(); drive(['throttle'], 2500); const straight = lateral(pos());
    reset(); drive(['throttle', 'steerLeft'], 2500);  const left = lateral(pos());
    reset(); drive(['throttle', 'steerRight'], 2500); const right = lateral(pos());

    check('left and right go opposite ways',
          (left - straight) < -1.5 && (right - straight) > 1.5,
          `left ${(left - straight).toFixed(2)} m, right ${(right - straight).toFixed(2)} m`);
}

console.log('--- wheels respond ------------------------------------------');
reset();
{
    const restSpin = car.telemetry().wheels.map(w => w.spin);
    drive(['throttle'], 1500);
    const rolling = car.telemetry();
    const moved = rolling.wheels.filter((w, i) => Math.abs(w.spin - restSpin[i]) > 1e-3).length;
    check('wheel spin advances', moved === 4, `${moved}/4 wheels rotated`);
    check('wheels carry angular velocity',
          rolling.wheels.every(w => w.angularVelocity > 3),
          rolling.wheels.map(w => w.angularVelocity.toFixed(1)).join(' '));
    check('driven rears spin at least as fast as the fronts',
          rolling.wheels[2].angularVelocity > rolling.wheels[0].angularVelocity - 1,
          `front ${rolling.wheels[0].angularVelocity.toFixed(1)}, rear ${rolling.wheels[2].angularVelocity.toFixed(1)}`);

    // Steer angle must follow the input and reverse with it. The rears never
    // steer, which is the control that proves the number is per-wheel state
    // rather than a chassis-wide value.
    reset(); drive(['throttle', 'steerLeft'], 1500);
    const wl = car.telemetry().wheels;
    reset(); drive(['throttle', 'steerRight'], 1500);
    const wr = car.telemetry().wheels;
    check('front wheels steer opposite ways',
          wl[0].steerDeg > 5 && wr[0].steerDeg < -5,
          `left-lock ${wl[0].steerDeg.toFixed(1)}°, right-lock ${wr[0].steerDeg.toFixed(1)}°`);
    check('rear wheels never steer',
          Math.abs(wl[2].steerDeg) < 0.01 && Math.abs(wr[3].steerDeg) < 0.01,
          `${wl[2].steerDeg.toFixed(3)}° / ${wr[3].steerDeg.toFixed(3)}°`);

    // Wheel MESHES follow the constraint, not a separate animation.
    reset();
    drive(['throttle'], 1200);
    car.syncWheels();
    const ws = car.vehicle.wheelState(1);
    const node = car.wheelNodes[1].quaternion;
    const dq = Math.abs(node[0] - ws.rotation.x) + Math.abs(node[1] - ws.rotation.y)
             + Math.abs(node[2] - ws.rotation.z) + Math.abs(node[3] - ws.rotation.w);
    check('wheel mesh takes the constraint quaternion', dq < 1e-5, `Δq=${dq.toExponential(1)}`);
}

console.log('--- the ice patch is really low grip -------------------------');
// Same car, same launch, two surfaces. On tarmac the tyres hook up and the
// wheel's surface speed stays close to the car's; on ice the driven wheels
// spin far faster than the car moves. That gap is the slip ratio, and it is
// the entire mechanism chunk 2's per-wheel friction demo builds on.
function launchAt(sampleIndex, ms) {
    const p = world.edge(sampleIndex, 0);
    car.respawn({ x: p.x, y: p.y + 1.2, z: p.z }, world.quatYaw(world.yawAt(sampleIndex)));
    advanceTime(900);
    drive(['throttle'], ms);
    return car.telemetry();
}
{
    const onTarmac = launchAt(Math.round(world.N * 0.17), 1200);
    const onIce = launchAt(world.iceRange[0] + 6, 1200);
    const rearSlip = (t) => (Math.abs(t.wheels[2].slip) + Math.abs(t.wheels[3].slip)) / 2;
    check('the car is standing on the ice body',
          onIce.wheels.filter(w => world.isIce(w.contactBody)).length >= 3,
          `${onIce.wheels.filter(w => world.isIce(w.contactBody)).length}/4 wheels on ice`);
    check('driven wheels slip far more on ice', rearSlip(onIce) > rearSlip(onTarmac) * 2,
          `tarmac ${rearSlip(onTarmac).toFixed(2)}, ice ${rearSlip(onIce).toFixed(2)}`);
    check('and the car accelerates less on ice', onIce.speed < onTarmac.speed * 0.7,
          `tarmac ${onTarmac.speed.toFixed(2)}, ice ${onIce.speed.toFixed(2)} m/s`);
}

console.log('--- upright on the flat -------------------------------------');
// Chassis local +Y in world space; 1.0 means perfectly level. A car that
// flips or leans over on a straight run fails here.
reset();
{
    const upness = () => {
        const up = car.chassisNode.localToWorld(0, 1, 0);
        const o = car.chassisNode.localToWorld(0, 0, 0);
        return up.y - o.y;
    };
    let worst = 1;
    for (let i = 0; i < 20; i++) { driveGuided(['throttle'], 400, 200); worst = Math.min(worst, upness()); }
    check('car stays upright over 8 s of driving', worst > 0.80,
          `min up·Y = ${worst.toFixed(3)}`);
}

console.log('--- suspension compresses on landing -------------------------');
// Drop the chassis from height onto the road and watch the springs take it.
reset();
{
    const p = world.edge(9, 0);
    car.respawn({ x: p.x, y: p.y + 4.5, z: p.z }, world.quatYaw(world.yawAt(9)));
    // Two ticks, not one: wheelState is published by the physics step, so the
    // frame immediately after a teleport still reports the pre-teleport wheels.
    advanceTime(32);
    const airborne = car.telemetry().wheels.map(w => w.compression);
    let peak = 0;
    for (let i = 0; i < 60; i++) {           // ~1 s in 16 ms slices
        advanceTime(16);
        peak = Math.max(peak, ...car.telemetry().wheels.map(w => w.compression));
    }
    check('suspension is extended in the air',
          Math.max(...airborne) < 0.2, `max ${Math.max(...airborne).toFixed(2)}`);
    check('suspension compresses on impact', peak > 0.55, `peak ${peak.toFixed(2)}`);
}

console.log('--- cameras -------------------------------------------------');
{
    reset();
    check('chase is the active camera node', cameras.sceneActiveName() === 'chase',
          String(cameras.sceneActiveName()));

    // The chase camera is never repositioned by app code — it is parented.
    // If its world position tracks the chassis, the hierarchy carried it.
    const c0 = camWorld(), p0 = pos();
    driveGuided(['throttle'], 3000);
    const c1 = camWorld(), p1 = pos();
    const camMoved = Math.hypot(c1.x - c0.x, c1.z - c0.z);
    const carMoved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    check('chase camera tracks the chassis', camMoved > carMoved * 0.7,
          `car ${carMoved.toFixed(1)} m, camera ${camMoved.toFixed(1)} m`);
    const behind = Math.hypot(c1.x - p1.x, c1.z - p1.z);
    check('chase camera stays behind the car', behind > 5 && behind < 12,
          `${behind.toFixed(2)} m astern`);

    cameras.select(1);
    check('bonnet camera activates', cameras.sceneActiveName() === 'bonnet',
          String(cameras.sceneActiveName()));
    const b = cameras.bonnet.localToWorld(0, 0, 0);
    check('bonnet camera sits on the car',
          Math.hypot(b.x - p1.x, b.z - p1.z) < 2.5,
          `${Math.hypot(b.x - p1.x, b.z - p1.z).toFixed(2)} m from chassis`);

    cameras.select(2);
    check('trackside camera activates', cameras.sceneActiveName() === 'trackside',
          String(cameras.sceneActiveName()));
    const t0 = cameras.trackside.localToWorld(0, 0, 0);
    advanceTime(200);
    const t1 = cameras.trackside.localToWorld(0, 0, 0);
    check('trackside camera does NOT ride the car',
          Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z) < 1e-4, 'fixed post');
    cameras.select(0);
}

console.log('--- lap timing ----------------------------------------------');
reset();
{
    const before = state.respawns;
    // Nudge the car forward off the line and check progress advances along
    // the centerline — the same index the lap counter watches.
    const i0 = state.progress;
    driveGuided(['throttle'], 3000);
    check('progress advances along the centerline', state.progress > i0,
          `sample ${i0} → ${state.progress}`);
    check('no respawn was needed', state.respawns === before,
          `${state.respawns - before} respawn(s)`);
}

// A frame for the record: the chase camera, a few seconds into a lap.
reset();
cameras.select(0);
driveGuided(['throttle'], 6000);
car.setHeld('throttle', true);
advanceTime(400);
screenshot('torque.png');
car.setHeld('throttle', false);

console.log('==============================================================');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
assert(failures === 0, `${failures} check(s) failed`);
