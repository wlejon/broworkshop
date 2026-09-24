// tests/test_garage.js — three Jolt vehicle controllers on one circuit.
//
// Every check measures a difference only the RIGHT controller can produce. A
// tracked vehicle that merely drives has proved nothing; the proof is the
// neutral turn — heading swinging through more than a radian while the hull
// stays inside its own length. Likewise the lean controller is demonstrated by
// running the identical manoeuvre twice with one boolean changed, and the tyre
// presets by the same corner taken on four sets of numbers.

import {
    app, car, cameras, garage, check, finish, section, manoeuvre, resetActive, originOf, portrait,
} from './drive.js';

advanceTime(600);

section('the garage');
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
    const tw = garage.tank.telemetry().wheels;
    check('the tank has exactly two tracks',
          tw.filter(w => w.track === 0).length === 5 && tw.filter(w => w.track === 1).length === 5,
          '5 road wheels per side');

    // Through the HUD's button, the way a visitor picks. Switching must move
    // the parented cameras onto the new chassis — otherwise you drive the tank
    // while watching the car.
    document.querySelector('.veh[data-veh="tank"]').click();
    check('switching vehicles switches the active handle',
          garage.activeKind === 'tank' && garage.active.kind === 'tank', garage.activeKind);
    check('the picker lights the tank', document.querySelector('.veh[data-veh="tank"]').classList.contains('on'),
          'tank button on');
    check('the chase camera re-parents onto the new chassis',
          cameras.mount === garage.tank.chassisNode, 'mounted on the tank hull');
    const cw = cameras.chase.localToWorld(0, 0, 0);
    const hw = originOf(garage.tank);
    check('and follows it in world space', Math.hypot(cw.x - hw.x, cw.z - hw.z) < 14,
          `${Math.hypot(cw.x - hw.x, cw.z - hw.z).toFixed(2)} m astern of the hull`);
    advanceTime(50);
    check('the tank shows its track panel, not the tyre panel',
          document.getElementById('trackPanel').style.display !== 'none' &&
          document.getElementById('tirePanel').style.display === 'none', 'panels swapped');
}

section('the tank pivots on the spot');
// The two tracks are commanded to equal and opposite rates, so the hull
// rotates about its own centre — same held actions a human uses.
{
    app.selectVehicle('tank');
    resetActive();
    {
        // Ten independently sprung road wheels, all carrying load.
        const t = garage.tank.telemetry();
        const down = t.wheels.filter(w => w.contact).length;
        check('the tank rides on all ten road wheels', down === 10, `${down}/10 in contact`);
        check('and the suspension is evenly loaded across them',
              t.wheels.every(w => w.compression > 0.1 && w.compression < 0.9),
              t.wheels.map(w => w.compression.toFixed(2)).join(' '));
    }
    const pivot = manoeuvre(['steerRight', 'handbrake'], 4000);
    check('neutral turn swings the hull through a large angle', Math.abs(pivot.turned) > 1.2,
          `${(pivot.turned * 180 / Math.PI).toFixed(0)}° of heading change`);
    check('...while the hull barely moves', pivot.travelled < 3.0,
          `${pivot.travelled.toFixed(2)} m of travel (hull is 5.2 m long)`);
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

    // Sampled at 2.5 s: 7.8 tonnes on a 27:1 first gear takes about a second
    // and a half to spin up, and reading earlier measures the drivetrain loading.
    resetActive();
    car.setHeld('steerRight', true); car.setHeld('handbrake', true);
    for (let t = 0; t < 2500; t += 100) advanceTime(100);
    const tp = garage.tank.telemetry();
    advanceTime(50);
    const modeText = document.getElementById('trackMode').textContent;
    car.setHeld('steerRight', false); car.setHeld('handbrake', false);
    check('in a neutral turn the tracks counter-rotate',
          tp.tracks.left * tp.tracks.right < 0 && Math.abs(tp.tracks.split) > 1.0,
          `left ${tp.tracks.left.toFixed(2)}, right ${tp.tracks.right.toFixed(2)} m/s`);
    check('the telemetry reports the neutral turn', tp.neutralTurn === true, 'neutralTurn flag set');
    check('and so does the track panel', document.getElementById('trackMode').classList.contains('hot'),
          `mode "${modeText}"`);

    // The handling contrast: the identical run — throttle only, three seconds,
    // straight off the same line. Deliberately NOT the guided autopilot: for a
    // tank "steer" means slowing a track, so a car-tuned autopilot scrubs its
    // speed to nothing and would measure the harness rather than the tank.
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

section('the lean controller holds the bike up');
// The SAME corner, twice, one boolean changed. Entry speed is low and the
// corner is coasted on purpose: driven hard, the bike runs wide into the armco,
// and a bike knocked over by a barrier proves nothing about a lean spring.
{
    function corner(leanOn) {
        garage.bike.setLean(leanOn);
        resetActive();
        manoeuvre(['throttle'], 600);
        const v = garage.bike;
        let peak = 0;
        for (const k in car.held) car.setHeld(k, false);
        car.setHeld('steerRight', true);
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
    check('lean controller ON: the bike stays upright through the corner', on.peak < 15,
          `peak roll ${on.peak.toFixed(1)}°, ending at ${on.final.toFixed(1)}°`);
    check('lean controller OFF: the same corner puts it down', off.peak > 45,
          `peak roll ${off.peak.toFixed(1)}°, ending at ${off.final.toFixed(1)}°`);
    check('the contrast is decisive, not marginal', off.peak > on.peak * 3,
          `${off.peak.toFixed(1)}° without the spring vs ${on.peak.toFixed(1)}° with it`);
    check('and the telemetry flags the fall', garage.bike.telemetry().fallen === true, 'fallen flag set with lean off');

    // Switching it back on — through the HUD toggle — is a live recovery, not a rebuild.
    document.getElementById('leanToggle').click();
    check('the HUD toggle turns the spring back on', garage.bike.leanEnabled === true &&
          document.getElementById('leanToggle').classList.contains('on'), 'leanToggle.on');
    resetActive();
    advanceTime(600);
    check('re-enabling the controller restores the bike',
          Math.abs(garage.bike.telemetry().leanDeg) < 12 && garage.bike.leanEnabled === true,
          `${garage.bike.telemetry().leanDeg.toFixed(1)}° after re-enabling`);
}

section('per-wheel tire friction changes the car');
// Same corner, same entry, different numbers. `drift` does not reduce grip
// overall — it moves it off the rear axle — so a car that merely got slower
// would NOT reproduce this result.
{
    function corner(preset) {
        app.selectVehicle('car');
        garage.setTirePreset(preset);
        resetActive();
        // The run-up doubles as the traction measurement: mean rear-wheel slip
        // once the car is rolling (the first second of any standing start is
        // wheelspin on every surface), not one instant's reading — a single
        // sample swung 0.62 → 0.86 on tarmac between runs.
        car.setHeld('throttle', true);
        let slipSum = 0, n = 0;
        for (let t = 0; t < 2200; t += 100) {
            advanceTime(100);
            if (t < 1000) continue;
            const w = garage.car.telemetry().wheels;
            slipSum += (Math.abs(w[2].slip) + Math.abs(w[3].slip)) / 2;
            n++;
        }
        car.setHeld('throttle', false);
        const entry = Math.abs(garage.car.telemetry().speed);
        const r = manoeuvre(['throttle', 'steerRight'], 2600);
        return { ...r, entry, rearSlip: slipSum / n, preset };
    }

    const tarmac = corner('tarmac');
    const drift = corner('drift');
    const ice = corner('ice');

    check('the preset actually reaches the wheels',
          garage.car.telemetry().wheels[3].grip.lateral === 0.20 && garage.car.tirePreset === 'ice',
          `ice rear lateralFriction = ${garage.car.telemetry().wheels[3].grip.lateral}`);
    check('all three runs enter the corner at a comparable speed',
          Math.abs(tarmac.entry - drift.entry) < tarmac.entry * 0.25,
          `tarmac ${tarmac.entry.toFixed(1)}, drift ${drift.entry.toFixed(1)} m/s`);
    // Less rear lateral grip = the rear axle lets go = oversteer, measured.
    check('cutting rear lateral grip increases sideslip through the corner',
          drift.maxSideslip > tarmac.maxSideslip * 1.3,
          `tarmac ${tarmac.maxSideslip.toFixed(1)}°, drift ${drift.maxSideslip.toFixed(1)}° of sideslip`);
    check('...and rotates the car further through the same corner',
          Math.abs(drift.turned) > Math.abs(tarmac.turned) * 1.15,
          `tarmac ${(tarmac.turned * 180 / Math.PI).toFixed(0)}°, drift ${(drift.turned * 180 / Math.PI).toFixed(0)}° of yaw`);
    // Ice cuts BOTH directions, so unlike drift it also destroys traction.
    check('ice tyres spin up far more than tarmac does', ice.rearSlip > tarmac.rearSlip * 2,
          `tarmac ${tarmac.rearSlip.toFixed(2)}, ice ${ice.rearSlip.toFixed(2)} mean rear slip under power`);
    check('and ice cannot carry the corner speed tarmac can', ice.entry < tarmac.entry * 0.8,
          `tarmac ${tarmac.entry.toFixed(1)}, ice ${ice.entry.toFixed(1)} m/s at turn-in`);

    // Back to tarmac through the HUD's button; the rebuild must leave a working car.
    document.querySelector('.tire[data-tire="tarmac"]').click();
    check('the tyre buttons follow the preset', garage.car.tirePreset === 'tarmac' &&
          document.querySelector('.tire[data-tire="tarmac"]').classList.contains('on'), garage.car.tirePreset);
    resetActive();
    const back = manoeuvre(['throttle'], 2500);
    check('the car still drives after four tyre rebuilds',
          back.travelled > 12 && garage.car.vehicle.type === 'wheeled',
          `${back.travelled.toFixed(1)} m on rebuilt tarmac tyres`);
    check('the cameras survived the rebuilds', cameras.mount === garage.car.chassisNode,
          're-parented onto the new chassis');
}

// Portraits of the two other vehicles, for the record.
app.selectVehicle('tank');
resetActive();
cameras.select(0);
manoeuvre(['throttle'], 2500);
car.setHeld('steerRight', true); car.setHeld('handbrake', true);
advanceTime(700);
portrait('tank');
car.setHeld('steerRight', false); car.setHeld('handbrake', false);

app.selectVehicle('bike');
garage.bike.setLean(true);
resetActive();
manoeuvre(['throttle'], 1500);
car.setHeld('throttle', true); car.setHeld('steerRight', true);
advanceTime(1200);
portrait('bike');
car.setHeld('throttle', false); car.setHeld('steerRight', false);

finish('torque garage');
