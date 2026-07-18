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

// =============================================================================
// Chunk 2 — the garage: three controllers, one circuit.
// =============================================================================
//
// Everything below measures a difference that only the RIGHT controller can
// produce. A tracked vehicle that merely drives has proved nothing — plenty of
// wheeled vehicles drive. The proof is the neutral turn: heading swinging
// through more than a radian while the hull stays inside its own length, which
// no steered vehicle in the world can do. Likewise the lean controller is only
// demonstrated by running the identical manoeuvre twice and showing that the
// only thing changed — one boolean — is what decides whether the bike stays up.

const { garage } = app;

/** Unwrapped heading (radians) from the chassis' own forward vector. */
function headingOf(v) {
    const o = v.chassisNode.localToWorld(0, 0, 0);
    const f = v.chassisNode.localToWorld(0, 0, 1);
    return Math.atan2(f.x - o.x, f.z - o.z);
}
const originOf = (v) => v.chassisNode.localToWorld(0, 0, 0);

/**
 * Hold a set of actions on the ACTIVE vehicle for `ms`, sampling as it goes.
 *
 * Heading is accumulated as wrapped per-sample deltas rather than read as an
 * end-to-end difference. That is not fussiness: a pivoting tank sweeps several
 * radians, atan2 wraps at ±π, and a naive end-minus-start reading of a 2.7 rad
 * pivot comes back as -3.6 rad — the wrong magnitude AND the wrong sign. It
 * cost a full round of confused probing to notice, so it is done properly here.
 *
 * @returns {{turned, travelled, maxSideslip, samples}} turned = signed radians
 */
function manoeuvre(actions, ms, slice = 100) {
    const v = garage.active;
    for (const k in car.held) car.setHeld(k, false);
    for (const a of actions) car.setHeld(a, true);

    const start = { ...originOf(v) };
    let prevHeading = headingOf(v);
    let prev = { ...start };
    let turned = 0, maxSideslip = 0, samples = 0;

    for (let t = 0; t < ms; t += slice) {
        advanceTime(slice);
        const h = headingOf(v);
        let d = h - prevHeading;
        while (d > Math.PI) d -= 2 * Math.PI;      // unwrap
        while (d < -Math.PI) d += 2 * Math.PI;
        turned += d;
        prevHeading = h;

        // Sideslip: the angle between where the vehicle is POINTING and where
        // it is actually going. It is the direct measure of lateral grip — a
        // tyre that has let go sends the car somewhere other than where the
        // nose is aimed — so it is what the friction presets are judged on.
        const p = originOf(v);
        const dx = p.x - prev.x, dz = p.z - prev.z;
        const step = Math.hypot(dx, dz);
        if (step > 0.15) {
            const o = v.chassisNode.localToWorld(0, 0, 0);
            const f = v.chassisNode.localToWorld(0, 0, 1);
            const fx = f.x - o.x, fz = f.z - o.z;
            const ang = Math.abs(Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz));
            maxSideslip = Math.max(maxSideslip, ang * 180 / Math.PI);
            samples++;
        }
        prev = { ...p };
    }
    for (const k in car.held) car.setHeld(k, false);

    const end = originOf(v);
    return {
        turned,
        travelled: Math.hypot(end.x - start.x, end.z - start.z),
        maxSideslip, samples,
    };
}

/** Put the ACTIVE vehicle back on the start line, at rest and settled. */
function resetActive() {
    for (const k in car.held) car.setHeld(k, false);
    garage.toStart(garage.active);
    advanceTime(1000);
}

/**
 * Guided version of manoeuvre() for the active vehicle — the same centerline
 * autopilot the car's tests use, so a run that lasts several seconds is still
 * on the road at the end of it. Straight-line running is not an option for
 * anything longer than about three seconds: the circuit curves, and a vehicle
 * held straight ploughs into the gravel and then into the tank's own ramps.
 */
function guideActive(actions, ms, slice = 100) {
    const v = garage.active;
    for (const k in car.held) car.setHeld(k, false);
    for (const a of actions) car.setHeld(a, true);
    for (let t = 0; t < ms; t += slice) {
        const o = v.chassisNode.localToWorld(0, 0, 0);
        const f = v.chassisNode.localToWorld(0, 0, 1);
        const aim = world.edge(world.nearestIndex(o.x, o.z) + 10, 0);
        const fx = f.x - o.x, fz = f.z - o.z;
        const dx = aim.x - o.x, dz = aim.z - o.z;
        const err = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
        car.setHeld('steerRight', err > 0.10);
        car.setHeld('steerLeft', err < -0.10);
        advanceTime(slice);
    }
    for (const k in car.held) car.setHeld(k, false);
}

console.log('--- the garage ----------------------------------------------');
{
    check('three vehicles, three controllers',
          garage.car.vehicle.type === 'wheeled' &&
          garage.tank.vehicle.type === 'tracked' &&
          garage.bike.vehicle.type === 'motorcycle',
          `${garage.car.vehicle.type} / ${garage.tank.vehicle.type} / ${garage.bike.vehicle.type}`);
    check('each reports the expected wheel count',
          garage.car.vehicle.wheelCount === 4 &&
          garage.tank.vehicle.wheelCount === 10 &&
          garage.bike.vehicle.wheelCount === 2,
          `car ${garage.car.vehicle.wheelCount}, tank ${garage.tank.vehicle.wheelCount}` +
          ` (2 tracks x 5), bike ${garage.bike.vehicle.wheelCount}`);
    check('the tank has exactly two tracks',
          garage.tank.telemetry().wheels.filter(w => w.track === 0).length === 5 &&
          garage.tank.telemetry().wheels.filter(w => w.track === 1).length === 5,
          '5 road wheels per side');

    // Switching must move the parented cameras onto the new chassis — otherwise
    // you drive the tank while watching the car.
    app.selectVehicle('tank');
    check('switching vehicles switches the active handle',
          garage.activeKind === 'tank' && garage.active.kind === 'tank',
          garage.activeKind);
    check('the chase camera re-parents onto the new chassis',
          cameras.mount === garage.tank.chassisNode, 'mounted on the tank hull');
    const cw = cameras.chase.localToWorld(0, 0, 0);
    const tw = originOf(garage.tank);
    check('and follows it in world space',
          Math.hypot(cw.x - tw.x, cw.z - tw.z) < 14,
          `${Math.hypot(cw.x - tw.x, cw.z - tw.z).toFixed(2)} m astern of the hull`);
}

console.log('--- the tank pivots on the spot -----------------------------');
// THE tracked-vehicle proof. Same held actions a human uses; the only thing
// that makes this possible is that the two tracks are commanded to equal and
// opposite rates, so the hull rotates about its own centre.
{
    app.selectVehicle('tank');
    resetActive();
    {
        // Ten independently sprung road wheels, all of them carrying load. A
        // tank riding on two of them would still pivot, so this is what says
        // the suspension geometry is real rather than incidentally working.
        const t = garage.tank.telemetry();
        const down = t.wheels.filter(w => w.contact).length;
        check('the tank rides on all ten road wheels', down === 10, `${down}/10 in contact`);
        check('and the suspension is evenly loaded across them',
              t.wheels.every(w => w.compression > 0.1 && w.compression < 0.9),
              t.wheels.map(w => w.compression.toFixed(2)).join(' '));
    }
    const pivot = manoeuvre(['steerRight', 'handbrake'], 4000);
    check('neutral turn swings the hull through a large angle',
          Math.abs(pivot.turned) > 1.2,
          `${(pivot.turned * 180 / Math.PI).toFixed(0)}° of heading change`);
    check('...while the hull barely moves',
          pivot.travelled < 3.0,
          `${pivot.travelled.toFixed(2)} m of travel (hull is 5.2 m long)`);
    // The ratio is the headline: degrees turned per metre travelled. A steered
    // vehicle cannot get this number off the floor.
    check('pivot is rotation without translation',
          Math.abs(pivot.turned) / Math.max(0.05, pivot.travelled) > 1.0,
          `${(Math.abs(pivot.turned) / Math.max(0.05, pivot.travelled)).toFixed(2)} rad/m`);

    resetActive();
    const straight = manoeuvre(['throttle'], 4000);
    check('equal track input drives the tank straight',
          Math.abs(straight.turned) < 0.35 && straight.travelled > 12,
          `${straight.travelled.toFixed(1)} m, ${(straight.turned * 180 / Math.PI).toFixed(1)}° of drift`);

    const tt = garage.tank.telemetry();
    check('and both tracks report the same speed when going straight',
          Math.abs(tt.tracks.split) < Math.max(0.8, Math.abs(tt.tracks.left) * 0.15),
          `left ${tt.tracks.left.toFixed(2)}, right ${tt.tracks.right.toFixed(2)} m/s`);

    // Per-track telemetry during a pivot: the two tracks must run OPPOSITE ways.
    // Sampled at 2.5 s rather than immediately — 7.8 tonnes on a 27:1 first gear
    // takes about a second and a half to spin up, and reading the tracks before
    // then measures the drivetrain still loading, not the turn.
    resetActive();
    car.setHeld('steerRight', true); car.setHeld('handbrake', true);
    for (let t = 0; t < 2500; t += 100) advanceTime(100);
    const tp = garage.tank.telemetry();
    car.setHeld('steerRight', false); car.setHeld('handbrake', false);
    check('in a neutral turn the tracks counter-rotate',
          tp.tracks.left * tp.tracks.right < 0 && Math.abs(tp.tracks.split) > 1.0,
          `left ${tp.tracks.left.toFixed(2)}, right ${tp.tracks.right.toFixed(2)} m/s`);
    check('the HUD reports the neutral turn', tp.neutralTurn === true, 'neutralTurn flag set');

    // The handling contrast the app claims: the tank is much slower than the
    // car. Both get the identical run — throttle only, three seconds, straight
    // off the same line — because that is the only way the comparison is fair.
    // Deliberately NOT the guided autopilot: for a tank "steer" means slowing a
    // track, so a car-tuned autopilot correcting every 100 ms scrubs its speed
    // to nothing and would have measured the test harness rather than the tank.
    resetActive();
    manoeuvre(['throttle'], 3000);
    const tankTop = Math.abs(garage.tank.telemetry().speed);
    app.selectVehicle('car');
    resetActive();
    manoeuvre(['throttle'], 3000);
    const carTop = Math.abs(garage.car.telemetry().speed);
    check('the tank is markedly slower than the car', tankTop < carTop * 0.8 && tankTop > 3,
          `tank ${tankTop.toFixed(1)} m/s vs car ${carTop.toFixed(1)} m/s over the same 3 s`);
}

console.log('--- the lean controller holds the bike up -------------------');
// The showpiece, run as a controlled experiment: the SAME corner, twice, with
// one boolean changed between the runs and nothing else touched.
{
    // Entry speed is kept low and the corner is taken off the throttle on
    // purpose. Driven hard, the bike runs wide across the gravel and hits the
    // armco inside two seconds — and a bike knocked over by a barrier proves
    // nothing about a lean spring. At walking-pace entry both runs stay on the
    // road for the whole manoeuvre, so the ONLY difference between them is the
    // boolean.
    function corner(leanOn) {
        garage.bike.setLean(leanOn);
        resetActive();
        manoeuvre(['throttle'], 600);                 // gather a little speed
        const v = garage.bike;
        let peak = 0;
        for (const k in car.held) car.setHeld(k, false);
        car.setHeld('steerRight', true);              // coast through the corner
        for (let t = 0; t < 2200; t += 100) {
            advanceTime(100);
            peak = Math.max(peak, Math.abs(v.telemetry().leanDeg));
        }
        for (const k in car.held) car.setHeld(k, false);
        return { peak, final: Math.abs(v.telemetry().leanDeg) };
    }

    app.selectVehicle('bike');
    check('the bike is the active vehicle', garage.activeKind === 'bike', garage.activeKind);

    const on = corner(true);
    const off = corner(false);

    check('lean controller ON: the bike stays upright through the corner',
          on.peak < 15,
          `peak roll ${on.peak.toFixed(1)}°, ending at ${on.final.toFixed(1)}°`);
    check('lean controller OFF: the same corner puts it down',
          off.peak > 45,
          `peak roll ${off.peak.toFixed(1)}°, ending at ${off.final.toFixed(1)}°`);
    check('the contrast is decisive, not marginal',
          off.peak > on.peak * 3,
          `${off.peak.toFixed(1)}° without the spring vs ${on.peak.toFixed(1)}° with it`);
    check('and the telemetry flags the fall',
          garage.bike.telemetry().fallen === true, 'fallen flag set with lean off');

    // Switching it back on is a live recovery, not a rebuild.
    garage.bike.setLean(true);
    resetActive();
    advanceTime(600);
    check('re-enabling the controller restores the bike',
          Math.abs(garage.bike.telemetry().leanDeg) < 12 &&
          garage.bike.leanEnabled === true,
          `${garage.bike.telemetry().leanDeg.toFixed(1)}° after re-enabling`);
}

console.log('--- per-wheel tire friction changes the car -----------------');
// Same corner, same entry, four sets of numbers. `drift` is the interesting
// comparison because it does not reduce grip overall — it moves it off the rear
// axle — so a car that merely got slower would NOT reproduce this result.
{
    function corner(preset) {
        app.selectVehicle('car');
        garage.setTirePreset(preset);
        resetActive();
        manoeuvre(['throttle'], 2200);                // same entry speed each run
        const entry = Math.abs(garage.car.telemetry().speed);
        const r = manoeuvre(['throttle', 'steerRight'], 2600);
        const t = garage.car.telemetry();
        const rearSlip = (Math.abs(t.wheels[2].slip) + Math.abs(t.wheels[3].slip)) / 2;
        return { ...r, entry, rearSlip, preset };
    }

    const tarmac = corner('tarmac');
    const drift = corner('drift');
    const ice = corner('ice');

    check('the preset actually reaches the wheels',
          garage.car.telemetry().wheels[3].grip.lateral === 0.20 &&
          garage.car.tirePreset === 'ice',
          `ice rear lateralFriction = ${garage.car.telemetry().wheels[3].grip.lateral}`);

    check('all three runs enter the corner at a comparable speed',
          Math.abs(tarmac.entry - drift.entry) < tarmac.entry * 0.25,
          `tarmac ${tarmac.entry.toFixed(1)}, drift ${drift.entry.toFixed(1)} m/s`);

    // Less rear lateral grip = the rear axle lets go = the car points further
    // away from where it is travelling. That is oversteer, measured.
    check('cutting rear lateral grip increases sideslip through the corner',
          drift.maxSideslip > tarmac.maxSideslip * 1.3,
          `tarmac ${tarmac.maxSideslip.toFixed(1)}°, drift ${drift.maxSideslip.toFixed(1)}° of sideslip`);
    check('...and rotates the car further through the same corner',
          Math.abs(drift.turned) > Math.abs(tarmac.turned) * 1.15,
          `tarmac ${(tarmac.turned * 180 / Math.PI).toFixed(0)}°, ` +
          `drift ${(drift.turned * 180 / Math.PI).toFixed(0)}° of yaw`);

    // Ice cuts BOTH directions, so unlike drift it also destroys traction —
    // the longitudinal slip readout is what separates the two presets.
    check('ice tyres spin up far more than tarmac does',
          ice.rearSlip > tarmac.rearSlip * 2,
          `tarmac ${tarmac.rearSlip.toFixed(2)}, ice ${ice.rearSlip.toFixed(2)} rear slip`);
    check('and ice cannot carry the corner speed tarmac can',
          ice.entry < tarmac.entry * 0.8,
          `tarmac ${tarmac.entry.toFixed(1)}, ice ${ice.entry.toFixed(1)} m/s at turn-in`);

    // Back to a sane setup, and confirm the rebuild left a working car behind.
    garage.setTirePreset('tarmac');
    resetActive();
    const back = manoeuvre(['throttle'], 2500);
    check('the car still drives after four tyre rebuilds',
          back.travelled > 12 && garage.car.vehicle.type === 'wheeled',
          `${back.travelled.toFixed(1)} m on rebuilt tarmac tyres`);
    check('the cameras survived the rebuilds',
          cameras.mount === garage.car.chassisNode, 're-parented onto the new chassis');
}

// Portraits of the two new vehicles, for the record.
app.selectVehicle('tank');
resetActive();
cameras.select(0);
manoeuvre(['throttle'], 2500);
car.setHeld('steerRight', true); car.setHeld('handbrake', true);
advanceTime(700);
screenshot('torque-tank.png');
car.setHeld('steerRight', false); car.setHeld('handbrake', false);

app.selectVehicle('bike');
garage.bike.setLean(true);
resetActive();
manoeuvre(['throttle'], 1500);
car.setHeld('throttle', true); car.setHeld('steerRight', true);
advanceTime(1200);
screenshot('torque-bike.png');
car.setHeld('throttle', false); car.setHeld('steerRight', false);

app.selectVehicle('car');
resetActive();

console.log('==============================================================');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
assert(failures === 0, `${failures} check(s) failed`);
