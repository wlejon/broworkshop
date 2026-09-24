// tests/test_car.js — the circuit and the wheeled car.
//
// A vehicle constraint that throws no errors has proved nothing. Every check
// here measures a DIFFERENCE that only working vehicle physics can explain:
// the car covers ground under throttle and stops under brakes, left lock and
// right lock displace it to opposite sides of where it started, the wheels
// carry angular velocity and steer angle that respond to input, the suspension
// compresses on landing, and the parented chase camera arrives somewhere new
// after the car moves.

import {
    car, world, cameras, scene, state, check, finish, section, livePos,
    drive, driveGuided, reset, placeCarAt, portrait,
} from './drive.js';

const pos = livePos;
const camWorld = () => cameras.chase.localToWorld(0, 0, 0);

// Let the app's first frames run and the car settle onto its springs.
advanceTime(600);

section('scaffold');
check('scene context', !!scene, typeof scene);
check('track built', world.samples.length === world.N, `${world.N} samples`);
check('four surfaces', Object.keys(world.surfaceBodies).length === 4,
      Object.keys(world.surfaceBodies).join(','));
check('ice patch is its own body', world.surfaceBodies.ice !== world.surfaceBodies.tarmac,
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
check('the page shows the car picked and its HUD', document.querySelector('.veh[data-veh="car"]').classList.contains('on')
      && document.getElementById('tirePanel').style.display !== 'none','car button lit, tyre panel up');

section('the car sits on the road');
reset();
{
    const t = car.telemetry();
    const onGround = t.wheels.filter(w => w.contact).length;
    check('all four wheels find the road', onGround === 4, `${onGround}/4 in contact`);
    check('suspension is loaded at rest',
          t.wheels.every(w => w.compression > 0.05 && w.compression < 0.95),
          t.wheels.map(w => w.compression.toFixed(2)).join(' '));
    check('at rest the car is not moving', Math.abs(t.speed) < 0.5, `${t.speed.toFixed(3)} m/s`);
}

section('throttle accelerates');
reset();
{
    const start = { ...pos() };
    driveGuided(['throttle'], 4000);
    const after = { ...pos() };
    const t = car.telemetry();
    const travelled = Math.hypot(after.x - start.x, after.z - start.z);
    check('throttle covers ground', travelled > 25, `${travelled.toFixed(1)} m in 4 s`);
    check('throttle builds speed', t.speed > 8, `${t.speed.toFixed(1)} m/s (${t.kmh.toFixed(0)} km/h)`);
    check('engine is turning', t.rpm > 1000, `${t.rpm.toFixed(0)} rpm`);
    check('gearbox shifted up', t.gear >= 2, `gear ${t.gear}`);
    advanceTime(50);
    check('the cluster reads the same speed', Math.abs(+document.getElementById('kmh').textContent - t.kmh) < 15,
          `#kmh ${document.getElementById('kmh').textContent} vs ${t.kmh.toFixed(0)} km/h`);
}

section('braking decelerates');
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

    // Not an exact match, deliberately: the drivetrain is state inside the
    // controller with no API to zero it — respawn holds full brake for 0.6 s
    // to spin it down, which converges to within a few percent.
    check('both runs enter at a comparable speed', Math.abs(entry - entry2) < entry * 0.12,
          `${entry.toFixed(3)} vs ${entry2.toFixed(3)} m/s`);
    check('brakes scrub speed', braked < entry - 4, `${entry.toFixed(1)} → ${braked.toFixed(1)} m/s in 0.9 s`);
    check('braking beats coasting', (entry - braked) > (entry2 - coasted) * 2.5,
          `brake lost ${(entry - braked).toFixed(2)}, coast lost ${(entry2 - coasted).toFixed(2)} m/s`);
}

section('steering');
// Left and right lock from the same start must displace the car to OPPOSITE
// sides of the straight-ahead run, measured in the spawn frame's right vector
// so track curvature does not contaminate the reading.
{
    const s0 = world.sampleAt(0);
    const lateral = (p) => (p.x - world.spawn.position.x) * s0.right.x
                         + (p.z - world.spawn.position.z) * s0.right.z;
    reset(); drive(['throttle'], 2500); const straight = lateral(pos());
    reset(); drive(['throttle', 'steerLeft'], 2500); const left = lateral(pos());
    reset(); drive(['throttle', 'steerRight'], 2500); const right = lateral(pos());
    check('left and right go opposite ways', (left - straight) < -1.5 && (right - straight) > 1.5,
          `left ${(left - straight).toFixed(2)} m, right ${(right - straight).toFixed(2)} m`);
}

section('wheels respond');
reset();
{
    const restSpin = car.telemetry().wheels.map(w => w.spin);
    drive(['throttle'], 1500);
    const rolling = car.telemetry();
    const moved = rolling.wheels.filter((w, i) => Math.abs(w.spin - restSpin[i]) > 1e-3).length;
    check('wheel spin advances', moved === 4, `${moved}/4 wheels rotated`);
    check('wheels carry angular velocity', rolling.wheels.every(w => w.angularVelocity > 3),
          rolling.wheels.map(w => w.angularVelocity.toFixed(1)).join(' '));
    check('driven rears spin at least as fast as the fronts',
          rolling.wheels[2].angularVelocity > rolling.wheels[0].angularVelocity - 1,
          `front ${rolling.wheels[0].angularVelocity.toFixed(1)}, rear ${rolling.wheels[2].angularVelocity.toFixed(1)}`);

    // Steer angle must follow the input and reverse with it. The rears never
    // steer: the control that proves the number is per-wheel state.
    reset(); drive(['throttle', 'steerLeft'], 1500);
    const wl = car.telemetry().wheels;
    reset(); drive(['throttle', 'steerRight'], 1500);
    const wr = car.telemetry().wheels;
    check('front wheels steer opposite ways', wl[0].steerDeg > 5 && wr[0].steerDeg < -5,
          `left-lock ${wl[0].steerDeg.toFixed(1)}°, right-lock ${wr[0].steerDeg.toFixed(1)}°`);
    check('rear wheels never steer', Math.abs(wl[2].steerDeg) < 0.01 && Math.abs(wr[3].steerDeg) < 0.01,
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

section('the ice patch is really low grip');
// Same car, same launch, two surfaces. On ice the driven wheels spin far
// faster than the car moves; that gap is the slip ratio.
{
    const launchAt = (i, ms) => { placeCarAt(i); drive(['throttle'], ms); return car.telemetry(); };
    const onTarmac = launchAt(Math.round(world.N * 0.17), 1200);
    const onIce = launchAt(world.iceRange[0] + 6, 1200);
    const rearSlip = (t) => (Math.abs(t.wheels[2].slip) + Math.abs(t.wheels[3].slip)) / 2;
    const iceWheels = onIce.wheels.filter(w => world.isIce(w.contactBody)).length;
    check('the car is standing on the ice body', iceWheels >= 3, `${iceWheels}/4 wheels on ice`);
    check('driven wheels slip far more on ice', rearSlip(onIce) > rearSlip(onTarmac) * 2,
          `tarmac ${rearSlip(onTarmac).toFixed(2)}, ice ${rearSlip(onIce).toFixed(2)}`);
    check('and the car accelerates less on ice', onIce.speed < onTarmac.speed * 0.7,
          `tarmac ${onTarmac.speed.toFixed(2)}, ice ${onIce.speed.toFixed(2)} m/s`);
    advanceTime(50);
    check('the HUD names the surface', document.getElementById('surface').textContent === state.surface,
          `#surface "${document.getElementById('surface').textContent}" vs state "${state.surface}"`);
}

section('upright on the flat');
// Chassis local +Y in world space; 1.0 means perfectly level.
reset();
{
    const upness = () => car.chassisNode.localToWorld(0, 1, 0).y - car.chassisNode.localToWorld(0, 0, 0).y;
    let worst = 1;
    for (let i = 0; i < 20; i++) { driveGuided(['throttle'], 400, 200); worst = Math.min(worst, upness()); }
    check('car stays upright over 8 s of driving', worst > 0.80, `min up·Y = ${worst.toFixed(3)}`);
}

section('suspension compresses on landing');
reset();
{
    // Two ticks, not one: wheelState is published by the physics step, so the
    // frame immediately after a teleport still reports the pre-teleport wheels.
    placeCarAt(9, 4.5, 32);
    const airborne = car.telemetry().wheels.map(w => w.compression);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
        advanceTime(16);
        peak = Math.max(peak, ...car.telemetry().wheels.map(w => w.compression));
    }
    check('suspension is extended in the air', Math.max(...airborne) < 0.2, `max ${Math.max(...airborne).toFixed(2)}`);
    check('suspension compresses on impact', peak > 0.55, `peak ${peak.toFixed(2)}`);
}

section('cameras');
{
    reset();
    check('chase is the active camera node', cameras.sceneActiveName() === 'chase', String(cameras.sceneActiveName()));

    // The chase camera is never repositioned by app code — it is parented. If
    // its world position tracks the chassis, the hierarchy carried it.
    const c0 = camWorld(), p0 = { ...pos() };
    driveGuided(['throttle'], 3000);
    const c1 = camWorld(), p1 = { ...pos() };
    const camMoved = Math.hypot(c1.x - c0.x, c1.z - c0.z);
    const carMoved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    check('chase camera tracks the chassis', camMoved > carMoved * 0.7,
          `car ${carMoved.toFixed(1)} m, camera ${camMoved.toFixed(1)} m`);
    const behind = Math.hypot(c1.x - p1.x, c1.z - p1.z);
    check('chase camera stays behind the car', behind > 5 && behind < 12, `${behind.toFixed(2)} m astern`);

    // Through the HUD's own buttons, the way a visitor switches.
    document.getElementById('camBonnet').click();
    check('bonnet camera activates', cameras.sceneActiveName() === 'bonnet', String(cameras.sceneActiveName()));
    check('and its button lights', document.getElementById('camBonnet').classList.contains('on'), 'camBonnet.on');
    const b = cameras.bonnet.localToWorld(0, 0, 0);
    check('bonnet camera sits on the car', Math.hypot(b.x - p1.x, b.z - p1.z) < 2.5,
          `${Math.hypot(b.x - p1.x, b.z - p1.z).toFixed(2)} m from chassis`);

    cameras.select(2);
    check('trackside camera activates', cameras.sceneActiveName() === 'trackside', String(cameras.sceneActiveName()));
    const t0 = cameras.trackside.localToWorld(0, 0, 0);
    advanceTime(200);
    const t1 = cameras.trackside.localToWorld(0, 0, 0);
    check('trackside camera does NOT ride the car', Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z) < 1e-4, 'fixed post');
    cameras.select(0);
}

section('lap timing');
reset();
{
    const before = state.respawns;
    const i0 = state.progress;
    driveGuided(['throttle'], 3000);
    check('progress advances along the centerline', state.progress > i0, `sample ${i0} → ${state.progress}`);
    check('no respawn was needed', state.respawns === before, `${state.respawns - before} respawn(s)`);
    check('the lap clock is not running before the line is crossed', state.currentLap == null,
          String(state.currentLap));
}

// A frame for the record: the chase camera, a few seconds into a lap.
reset();
cameras.select(0);
driveGuided(['throttle'], 6000);
car.setHeld('throttle', true);
advanceTime(400);
portrait('chase');
car.setHeld('throttle', false);

finish('torque car');
