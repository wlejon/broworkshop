// Torque — a driving game built on bro's Jolt vehicle support.
//
// Three real Jolt vehicle CONTROLLERS on one circuit, driven with a keyboard or
// an analog gamepad, with haptics and spatialised procedural engine audio. In
// one sentence per system:
//
//   * a wheeled car with sprung suspension per corner, a torque-limited engine,
//     a self-shifting five-speed box, a limited-slip diff, and per-wheel tyre
//     friction you can change between four presets while driving;
//   * a tracked vehicle that steers by running its two tracks at different
//     rates and can spin on its own centre, which no steered vehicle can;
//   * a motorcycle held up by a lean spring you can switch off mid-corner;
//   * a parametric circuit with banking derived from curvature, an elevation
//     change, three friction surfaces including an ice patch, and barriers;
//   * cameras as scene NODES — two parented to the chassis and never touched
//     again, one fixed trackside post aimed by hand;
//   * analog input through the engine's action system, so a trigger at 40%
//     is 40% throttle and the same code path still gives a key a flat 1.0;
//   * rumble whose magnitudes are scaled from measured telemetry — wheel slip,
//     chassis deceleration, revs against redline, track speed;
//   * engine, tyre and road audio synthesized from scratch, attached to the
//     chassis as scene emitters, and heard from whichever camera is live —
//     so a car passing the trackside post Dopplers, measurably.
//
// Everything the app exists to demonstrate is switchable from the HUD, and the
// smoke test asserts against the same telemetry the HUD draws.
//
// bro ships a full Jolt VehicleConstraint: sprung suspension per corner, an
// engine with a torque ceiling, a self-shifting gearbox with a clutch, a
// limited-slip differential, and slip-curve tire friction that can be tuned
// per wheel. This app exists because none of that had ever been driven.
//
// Jolt ships THREE vehicle controllers and bro binds all three. They are not
// variations on a theme — they disagree about what steering even is — so the
// app drives one circuit with all three and lets you swap between them live:
//
//   track.js    One parametric closed centerline, meshed into three separate
//               friction surfaces — tarmac, gravel runoff, and a low-grip ice
//               patch — plus barriers, kerbs, tyre stacks and roadside posts.
//               Banking is derived from curvature and masked off across one
//               corner, so the circuit has a banked corner and a flat one.
//   input.js    One driver: the shared action set, held-key state, and the
//               steering integrator all three vehicles read.
//   car.js      WheeledVehicleController — the constraint, the visual chassis,
//               four wheel meshes driven from the constraint's own per-wheel
//               state, and the live per-wheel tire-friction presets.
//   tank.js     TrackedVehicleController — two skid-steered tracks, animated
//               belts, and a neutral turn no wheeled vehicle can do. Plus a
//               small proving ground of ramps and crates off the start line.
//   bike.js     MotorcycleController — two wheels held up by a lean spring
//               that can be switched off mid-corner, which is the point.
//   garage.js   Owns all three, parks the two you are not driving, and moves
//               the cameras and the start point between them.
//   cameras.js  Camera NODES. Chase and bonnet are parented to whichever
//               chassis is active and never touched again; trackside is a root
//               node aimed by hand.
//   hud.js      Cluster + per-wheel telemetry, adapting to the active vehicle,
//               drawn from the same snapshot the smoke test asserts against.
//   rumble.js   Haptics computed from telemetry rather than from event types,
//               committed to the pad on a fixed cadence.
//   audio.js    Procedural engine/squeal/roll synthesis, attached to the
//               chassis node so the scene does the 3D audio work.
//
// app.js owns the environment, the frame loop, lap timing, and the respawn
// logic, and exports the handles the test drives.

import { installSystemMenu } from "/lib/system-menu.js";
import { buildTrack } from "/app/track.js";
import { createGarage } from "/app/garage.js";
import { createCameras } from "/app/cameras.js";
import { setRespawnHandler, setNavHandlers, strength, inputSnapshot } from "/app/input.js";
import { createRumble } from "/app/rumble.js";
import { createEngineAudio } from "/app/audio.js";
import {
    drawTelemetry, drawLaps, setFps, setCameraButtons, bindHud,
    setVehicle, setTirePreset, setLeanToggle,
    drawInput, drawRumble, drawAudio, setRumbleToggle, setDopplerFactor,
} from "/app/hud.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');

// --- Environment -------------------------------------------------------------
// A single hard sun with cascaded shadows: the circuit is a long ribbon, so
// the elevation changes only read if something casts a shadow down them. Fog
// starts well past the far barrier so the track fades into the horizon rather
// than ending in a hard edge, which also hides the world boundary.

// An HDR sky does double duty: it is the visible horizon a circuit needs to
// read as outdoors, and it is the PBR ambient term, so the car's paint and the
// armco pick up sky colour instead of a flat grey fill. setEnvironment reports
// whether the load succeeded — fall back to the flat ambient if it did not,
// rather than rendering a black void.
const HDRI = '../../demos/lighting-demo/hdri/kloofendal_43d_clear_puresky_2k.hdr';
// Intensity well under 1: a clear-sky HDR is very bright, and at 1.0 the
// ambient term alone lifted #33373d asphalt to the same value as the white
// kerbs. Half the sky plus a hard sun is what makes tarmac read as tarmac.
const haveSky = scene.setEnvironment({ hdr: HDRI, intensity: 0.5 });
if (!haveSky) scene.setAmbient([0.10, 0.12, 0.15]);

scene.setToneMap({ mode: 'aces', exposure: 0.85 });
scene.setFog({ start: 420, end: 1100, color: [0.60, 0.68, 0.78] });

const sun = scene.createLight({
    name: 'sun',
    type: 'directional',
    direction: [-0.42, -0.82, -0.38],
    color: [1.0, 0.96, 0.88],
    intensity: 1.7,
});
sun.castsShadow = true;
sun.cascadeCount = 4;
sun.cascadeSplitLambda = 0.85;      // outdoor: log splits, most detail up close

// A dim cool fill from the opposite side. Kept low because the IBL already
// carries most of the shadow-side light; at 0.75 it washed the tarmac out to
// the same value as the kerbs.
scene.createLight({
    name: 'fill', type: 'directional',
    direction: [0.55, -0.35, 0.6],
    color: [0.55, 0.66, 0.85], intensity: 0.30,
});

// --- World -------------------------------------------------------------------

const world = buildTrack(scene);

// The garage builds all three vehicles and tells us whenever the cameras need
// to move — on a vehicle switch, and also after a tyre change, which rebuilds
// the car's constraint and with it the chassis node the cameras hang off.
// The cameras and the audio emitters hang off the same thing — the active
// vehicle's chassis node — and both have to let go before a tyre rebuild
// destroys it, so they move together on the garage's two hooks.
const garage = createGarage(scene, world, {
    onAttach: (v) => { cameras.attachTo(v); audio.attachTo(v); },
    onDetach: () => { cameras.detach(); audio.detach(); },
    onChange: (v) => {
        setVehicle(v);
        if (v.kind === 'bike') setLeanToggle(v.leanEnabled);
        if (v.kind === 'car') setTirePreset(v.tirePreset, garage.TIRE_PRESETS);
    },
});

const cameras = createCameras(scene, garage.active, world);
const cam = cameras.chase;

// Audio and haptics. Both are built after the garage because both need a
// chassis node to hang off, and both are re-pointed by the hooks above on every
// vehicle change. bindAudioListenerToCamera happens inside createEngineAudio,
// so the listener is already following whichever camera is live.
const audio = createEngineAudio(scene);
audio.attachTo(garage.active);
const rumble = createRumble({ enabled: true });

// Chunk 1's handle name, kept because the whole app and the smoke test refer to
// "the car". It is now one of three, and `garage.active` is what is being driven.
const car = garage.car;

// --- State -------------------------------------------------------------------
// Lap timing is derived from progress along the centerline rather than a
// trigger volume: `nearestIndex` already exists for respawn, and a wrap from
// the last quarter of the loop into the first quarter is an unambiguous
// crossing that cannot be faked by reversing over a line.

export const state = {
    laps: 0,
    currentLap: null,
    bestLap: null,
    lastLap: null,
    started: false,
    progress: 0,
    surface: 'tarmac',
    respawns: 0,
    onIce: false,
    vehicle: 'car',
};

let lapClock = 0;
let prevIndex = 0;

function respawnAtNearest() {
    const active = garage.active;
    const t = Physics.getTransform(active.vehicle.chassisBody);
    const i = world.nearestIndex(t.position.x, t.position.z);
    const p = world.edge(i, 0);
    active.respawn({ x: p.x, y: p.y + 1.4, z: p.z }, world.quatYaw(world.yawAt(i)));
    state.respawns++;
    // Restarting the lap clock is the honest thing to do — a lap you were
    // teleported through is not a lap time.
    state.currentLap = null;
    state.started = false;
    lapClock = 0;
    prevIndex = i;
}

// One respawn handler for the app's lifetime; it always acts on whatever is
// currently being driven, so switching vehicles does not have to rebind it.
setRespawnHandler(respawnAtNearest);

/** Switch vehicles and reset the lap in progress — a lap is per vehicle. */
export function selectVehicle(kind) {
    const v = garage.select(kind);
    state.vehicle = garage.activeKind;
    state.currentLap = null;
    state.started = false;
    lapClock = 0;
    prevIndex = world.nearestIndex(world.spawn.position.x, world.spawn.position.z);
    return v;
}

bindHud({
    onCamera: (i) => { cameras.select(i); setCameraButtons(cameras.activeIndex); },
    onRespawn: respawnAtNearest,
    onVehicle: selectVehicle,
    onTire: (name) => {
        if (garage.setTirePreset(name)) setTirePreset(name, garage.TIRE_PRESETS);
    },
    onLean: () => setLeanToggle(garage.bike.setLean(!garage.bike.leanEnabled)),
    onRumble: () => rumble.setEnabled(!rumble.enabled),
    onDoppler: (v) => audio.setDopplerFactor(v),
});

/** Cycle to the next vehicle in the garage's order. Tab and the pad's LB. */
export function nextVehicle() {
    const order = garage.KINDS;
    return selectVehicle(order[(order.indexOf(garage.activeKind) + 1) % order.length]);
}

// The pad's shoulder buttons reach the same two entry points the number keys
// and Tab do, rather than duplicating any of the logic.
setNavHandlers({
    onCamera: () => { cameras.cycle(); setCameraButtons(cameras.activeIndex); },
    onSwap: nextVehicle,
});

setCameraButtons(cameras.activeIndex);
setVehicle(garage.active);
setTirePreset(garage.car.tirePreset, garage.TIRE_PRESETS);
setLeanToggle(garage.bike.leanEnabled);
setRumbleToggle(rumble.enabled);
setDopplerFactor(audio.dopplerFactor);

// Number keys switch cameras, Tab cycles vehicles. These are direct key
// handlers rather than actions on purpose: camera and vehicle choice are
// viewing/staging preferences, not game bindings, and they should not appear
// in the rebindable action list.
document.addEventListener('keydown', (e) => {
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) { cameras.select(i); setCameraButtons(cameras.activeIndex); }
    if (e.key === 'Tab') { e.preventDefault(); nextVehicle(); }
});

// --- Frame loop --------------------------------------------------------------
// Order matters: input first (so the physics tick that follows this frame acts
// on it), then read state back for the wheels and the HUD. The chassis itself
// is synced by its PhysicsNode; only the wheels need copying, because they are
// constraint state rather than body state.

let fpsAccum = 0, fpsFrames = 0, last = performance.now();

/** One simulation-facing frame. Split out so the smoke test can step it. */
export function tick(dt) {
    // The garage drives the active vehicle and holds the brakes on the others.
    const active = garage.update(dt);

    const t = Physics.getTransform(active.vehicle.chassisBody);
    cameras.update(t.position);

    // Fell off the world — put it back rather than letting it drift forever.
    if (t.position.y < world.floorY + 8) respawnAtNearest();

    const idx = world.nearestIndex(t.position.x, t.position.z);
    state.progress = idx;

    const q = world.N / 4;
    if (prevIndex >= world.N - q && idx < q) {
        if (state.started) {
            state.lastLap = lapClock;
            state.laps++;
            if (state.bestLap == null || lapClock < state.bestLap) state.bestLap = lapClock;
        }
        state.started = true;
        lapClock = 0;
    } else if (prevIndex < q && idx >= world.N - q) {
        // Crossed backwards: void the lap in progress instead of banking a
        // time that was never driven forwards.
        state.started = false;
        lapClock = 0;
    }
    prevIndex = idx;

    if (state.started) lapClock += dt;
    state.currentLap = state.started ? lapClock : null;

    const telem = active.telemetry();
    // The surface reading comes from whatever body the first wheel is touching,
    // which is how the ice patch announces itself.
    const fl = telem.wheels[0];
    state.surface = fl && fl.contact ? world.surfaceName(fl.contactBody) : 'air';
    state.onIce = telem.wheels.some(w => w.contact && world.isIce(w.contactBody));
    state.vehicle = garage.activeKind;

    // Haptics and audio are simulation consumers, not HUD decoration, so they
    // run inside tick() — which means the smoke test's stepped frames drive
    // them exactly as a real one does.
    const settling = active.isSettling ? active.isSettling() : false;
    rumble.update(dt, telem, settling);
    audio.update(active, telem, state.surface, strength('throttle'));
    return telem;
}

function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const telem = tick(dt);
    drawTelemetry(telem, state.surface);
    drawLaps(state);
    drawInput(inputSnapshot(), telem.steer);
    drawRumble(rumble.state);
    drawAudio(audio.levels);

    fpsAccum += dt;
    if (++fpsFrames >= 20) {
        setFps(fpsFrames / fpsAccum);
        fpsAccum = 0; fpsFrames = 0;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { scene, canvas, cam, car, world, cameras, garage, audio, rumble };
