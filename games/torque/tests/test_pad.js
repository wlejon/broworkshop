// tests/test_pad.js — analog input, haptics, and audio in the world.
//
// The claim is not "a gamepad produces events". It is that an ANALOG input
// produces an analog RESULT: half a trigger has to make the car accelerate
// measurably less than a full one, and half a stick has to leave the front
// wheels at a measurably smaller angle — asserted on the MOTION and the
// constraint's own wheel state, never on the strength number alone.
//
// The audio claim is the same shape: an engine attached to the chassis and
// heard from a fixed trackside post must Doppler UP as the car comes and DOWN
// as it goes, and must go exactly flat when the Doppler factor is zero.

import * as input from '/app/input.js';
import {
    app, car, world, cameras, audio, rumble, check, finish, section, livePos,
    drive, driveGuided, reset, placeCarAt, steerToLine, releaseAll, portrait,
} from './drive.js';

advanceTime(600);
const PAD = gamepadConnect('Torque Test Pad');

/** Release every pad control — the engine holds pad state until told otherwise. */
function padRelease() {
    gamepadButton(PAD, 'righttrigger', false, 0);
    gamepadButton(PAD, 'lefttrigger', false, 0);
    gamepadButton(PAD, 'south', false);
    gamepadAxis(PAD, 'leftx', 0);
    advanceTime(50);
}

section('the pad reaches the same actions the keyboard does');
{
    check('a pad is connected', !!input.activePad(), String(input.activePad() && input.activePad().id));
    advanceTime(50);
    check('the HUD sees it', document.getElementById('padState').textContent !== 'no pad',
          document.getElementById('padState').textContent);
    check('every driving action carries a gamepad binding',
          ['throttle', 'brake', 'steerLeft', 'steerRight', 'handbrake', 'respawn']
              .every(a => input.ACTIONS[a].some(b => String(b).startsWith('gamepad:'))),
          input.ACTIONS.throttle.join(' '));

    // A key is a switch and must still read as a full 1.0.
    car.setHeld('throttle', true);
    const keyStrength = input.strength('throttle');
    car.setHeld('throttle', false);
    check('a keyboard key still yields full throttle', keyStrength === 1, `strength ${keyStrength}`);

    gamepadButton(PAD, 'righttrigger', true, 0.5);
    advanceTime(50);
    const half = input.strength('throttle');
    gamepadButton(PAD, 'righttrigger', true, 1.0);
    advanceTime(50);
    const full = input.strength('throttle');
    padRelease();
    const released = input.strength('throttle');
    check('a trigger at half deflection reports about half strength',
          Math.abs(half - 0.5) < 0.02 && Math.abs(full - 1.0) < 0.02,
          `half ${half.toFixed(3)}, full ${full.toFixed(3)}`);
    check('and releasing it returns to zero', released === 0, `strength ${released}`);
}

section('analog throttle changes how the car ACCELERATES');
// Same stretch of road, same standing start, same interval — only the
// trigger's value differs.
{
    const LAUNCH = Math.round(world.N * 0.17);

    function padLaunch(value, ms) {
        placeCarAt(LAUNCH, 1.2, 0);
        padRelease();
        advanceTime(900);
        const from = { ...livePos() };
        gamepadButton(PAD, 'righttrigger', true, value);
        advanceTime(ms);
        const t = car.telemetry();
        const to = livePos();
        padRelease();
        return { speed: Math.abs(t.speed), rpm: t.rpm, travelled: Math.hypot(to.x - from.x, to.z - from.z) };
    }

    const full = padLaunch(1.0, 2500);
    const half = padLaunch(0.5, 2500);
    const quarter = padLaunch(0.25, 2500);
    check('half throttle accelerates the car measurably less than full',
          half.speed < full.speed * 0.85 && half.speed > 1,
          `full ${full.speed.toFixed(2)} m/s, half ${half.speed.toFixed(2)} m/s in 2.5 s`);
    check('...and covers less ground over the same interval', half.travelled < full.travelled * 0.9,
          `full ${full.travelled.toFixed(1)} m, half ${half.travelled.toFixed(1)} m`);
    check('the response is graded, not a two-position switch',
          quarter.speed < half.speed && half.speed < full.speed,
          `¼ ${quarter.speed.toFixed(2)} < ½ ${half.speed.toFixed(2)} < full ${full.speed.toFixed(2)} m/s`);

    // And the keyboard is unchanged: a held key launches like a full trigger.
    placeCarAt(LAUNCH);
    drive(['throttle'], 2500);
    const keySpeed = Math.abs(car.telemetry().speed);
    check('a held key launches the car like a fully-pressed trigger',
          Math.abs(keySpeed - full.speed) < full.speed * 0.15,
          `key ${keySpeed.toFixed(2)} vs trigger ${full.speed.toFixed(2)} m/s`);
}

section('analog steering reaches the wheels');
// Read off the constraint's own per-wheel steer angle, the only place the
// steering demand can be observed after the rack has integrated it.
{
    function padSteer(axisValue, ms) {
        reset();
        padRelease();
        gamepadAxis(PAD, 'leftx', axisValue);
        advanceTime(ms);
        const t = car.telemetry();
        padRelease();
        return { steerDeg: t.wheels[0].steerDeg, rack: t.steer };
    }

    const fullLock = padSteer(1.0, 1500);
    const partial = padSteer(0.5, 1500);
    const centred = padSteer(0.0, 800);
    // steerAngle is NEGATIVE for right lock, and +leftx is right.
    check('a full stick deflection reaches full lock', Math.abs(fullLock.steerDeg) > 25,
          `${fullLock.steerDeg.toFixed(1)}° at the front wheel`);
    check('half a stick deflection gives a proportionally smaller steer angle',
          Math.abs(partial.steerDeg) > 5 && Math.abs(partial.steerDeg) < Math.abs(fullLock.steerDeg) * 0.75,
          `full ${fullLock.steerDeg.toFixed(1)}°, half ${partial.steerDeg.toFixed(1)}°`);
    check('...and the rack holds at the partial demand rather than the stop',
          Math.abs(partial.rack) > 0.2 && Math.abs(partial.rack) < 0.75, `rack at ${partial.rack.toFixed(2)} of lock`);
    check('a centred stick leaves the wheels straight',
          Math.abs(centred.steerDeg) < 0.5 && centred.rack === 0, `${centred.steerDeg.toFixed(2)}°`);
}

section('rumble follows the simulation');
// Requested when the tyres are actually letting go; silent on a parked car.
{
    reset();
    padRelease();
    advanceTime(600);
    const parkedFrom = rumble.state.requests;
    advanceTime(1000);
    const parkedRequests = rumble.state.requests - parkedFrom;
    check('a parked car asks for no rumble at all', parkedRequests === 0 && rumble.state.intensity < 0.02,
          `${parkedRequests} request(s), intensity ${rumble.state.intensity.toFixed(3)}`);

    // Onto the ice patch: the driven wheels light up, which is the reading the
    // strong/weak mix is scaled from.
    placeCarAt(world.iceRange[0] + 6);
    const slipFrom = rumble.state.requests;
    let peakSlip = 0, peakWeak = 0;
    car.setHeld('throttle', true);
    for (let t = 0; t < 1500; t += 100) {
        advanceTime(100);
        peakSlip = Math.max(peakSlip, rumble.state.slip);
        peakWeak = Math.max(peakWeak, rumble.state.weak);
    }
    car.setHeld('throttle', false);
    const slipRequests = rumble.state.requests - slipFrom;
    check('spinning the wheels up on ice requests rumble', slipRequests > 5 && peakSlip > 0.2,
          `${slipRequests} effect(s), peak slip term ${peakSlip.toFixed(2)}`);
    check('and it arrives on the weak motor, where texture belongs', peakWeak > 0.15,
          `peak weak magnitude ${peakWeak.toFixed(2)}`);

    // The master switch — the HUD's button — has to actually stop it.
    document.getElementById('rumbleToggle').click();
    check('the HUD switch turns rumble off', !rumble.enabled &&
          !document.getElementById('rumbleToggle').classList.contains('on'), 'rumbleToggle off');
    const offFrom = rumble.state.requests;
    car.setHeld('throttle', true);
    advanceTime(800);
    car.setHeld('throttle', false);
    check('the master switch silences the pad', rumble.state.requests === offFrom,
          `${rumble.state.requests - offFrom} request(s) with rumble off`);
    document.getElementById('rumbleToggle').click();
    check('and back on', rumble.enabled, String(rumble.enabled));
}

section('the engine is audible, and it moves');
{
    reset();
    advanceTime(400);
    check('the emitters are attached to the chassis', audio.levels.attached === true,
          'engine, squeal and roll ride the chassis node');
    check('the engine note has a level at idle', audio.levels.soft > 0,
          `overrun ${audio.levels.soft.toFixed(3)}, load ${audio.levels.hard.toFixed(3)}`);

    const idleRate = audio.levels.rate;
    driveGuided(['throttle'], 2500);
    const revvingRate = audio.levels.rate;
    check('the note rises with the revs', revvingRate > idleRate * 1.3,
          `${idleRate.toFixed(2)}× at idle → ${revvingRate.toFixed(2)}× under power`);
    check('throttle moves the timbre from overrun to load', audio.levels.hard > audio.levels.soft,
          `overrun ${audio.levels.soft.toFixed(3)} vs load ${audio.levels.hard.toFixed(3)}`);

    // Surface-dependent roll noise: the ice patch has to sound different.
    placeCarAt(world.iceRange[0] + 6);
    car.setHeld('throttle', true);
    advanceTime(900);
    const iceTone = audio.levels.tone;
    car.setHeld('throttle', false);
    check('the ice patch sounds different from tarmac', iceTone === 'ice hiss', `roll noise reported "${iceTone}"`);
}

section('Doppler on a trackside pass');
// The listener follows the live camera, so with the trackside camera up it is
// on the marshal's post. Drive the car at it and past it — on the racing line,
// with the autopilot, so it really does drive away again rather than running
// wide into the gravel and stalling a few metres past the post.
{
    function pass(ms = 6000) {
        padRelease();
        placeCarAt(Math.round(world.N * 0.30));
        car.setHeld('throttle', true);
        const samples = [];
        for (let t = 0; t < ms; t += 100) {
            steerToLine(car);
            advanceTime(100);
            const o = livePos();
            const c = cameras.trackside.localToWorld(0, 0, 0);
            samples.push({ d: Math.hypot(o.x - c.x, o.z - c.z), r: audio.levels.doppler });
        }
        releaseAll();
        return samples;
    }

    document.getElementById('camTrack').click();
    check('the trackside camera is live, so the listener is at the post',
          cameras.sceneActiveName() === 'trackside', String(cameras.sceneActiveName()));

    const s = pass();
    // Closest approach splits the trace into the two halves.
    let nearest = 0;
    for (let i = 1; i < s.length; i++) if (s[i].d < s[nearest].d) nearest = i;
    const approaching = s.slice(0, nearest);
    const receding = s.slice(nearest + 1);
    const maxApproach = Math.max(...approaching.map(x => x.r));
    const minRecede = Math.min(...receding.map(x => x.r));
    check('the car actually passes the post',
          approaching.length > 5 && receding.length > 5 && s[0].d - s[nearest].d > 10,
          `${s[0].d.toFixed(0)} m → ${s[nearest].d.toFixed(0)} m → ${s[s.length - 1].d.toFixed(0)} m`);
    check('approaching, the engine Dopplers UP', maxApproach > 1.02, `peak ratio ${maxApproach.toFixed(4)}`);
    check('receding, it Dopplers DOWN', minRecede < 0.98, `trough ratio ${minRecede.toFixed(4)}`);
    check('the shift is a real pitch change, not noise', maxApproach - minRecede > 0.05,
          `${((maxApproach - 1) * 100).toFixed(1)}% up, ${((1 - minRecede) * 100).toFixed(1)}% down`);

    // The control: with the factor at zero — set through the HUD's slider — the same pass goes flat.
    const range = document.getElementById('dopplerRange');
    range.value = '0';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    check('the slider reaches the mixer', audio.dopplerFactor === 0 &&
          document.getElementById('dopplerVal').textContent === '0.0', `dopplerFactor ${audio.dopplerFactor}`);
    const off = pass(3000).map(x => x.r);
    check('with dopplerFactor = 0 the pass is exactly flat', off.every(r => r === 1.0),
          `${off.length} samples, all ${off[0].toFixed(4)}`);
    range.value = '1';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    check('and restoring the factor restores the effect', audio.dopplerFactor === 1, `dopplerFactor ${audio.dopplerFactor}`);
}

// A frame from the marshal's post mid-pass: runs until the post stops getting
// closer, the moment the car is best in shot.
app.selectVehicle('car');
cameras.select(2);
placeCarAt(Math.round(world.N * 0.30));
car.setHeld('throttle', true);
{
    let best = Infinity;
    for (let t = 0; t < 6000; t += 100) {
        steerToLine(car);
        advanceTime(100);
        const c = cameras.trackside.localToWorld(0, 0, 0);
        const p = livePos();
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d > best + 4) break;
        best = Math.min(best, d);
    }
}
releaseAll();
car.setHeld('throttle', true);
portrait('trackside');
car.setHeld('throttle', false);
cameras.select(0);
gamepadDisconnect(PAD);

finish('torque pad + audio');
