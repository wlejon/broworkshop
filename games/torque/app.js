// Torque — a driving showcase for bro's Jolt vehicle support.
//
// bro ships a full Jolt VehicleConstraint: sprung suspension per corner, an
// engine with a torque ceiling, a self-shifting gearbox with a clutch, a
// limited-slip differential, and slip-curve tire friction that can be tuned
// per wheel. This app exists because none of that had ever been driven.
//
//   track.js    One parametric closed centerline, meshed into three separate
//               friction surfaces — tarmac, gravel runoff, and a low-grip ice
//               patch — plus barriers, kerbs, tyre stacks and roadside posts.
//               Banking is derived from curvature and masked off across one
//               corner, so the circuit has a banked corner and a flat one.
//   car.js      The vehicle constraint, the visual chassis, and four wheel
//               meshes driven from the constraint's own per-wheel state.
//               Input goes through the action-binding system.
//   cameras.js  Camera NODES. Chase and bonnet are parented to the chassis and
//               never touched again; trackside is a root node aimed by hand.
//   hud.js      Cluster + per-wheel telemetry, drawn from the same snapshot
//               the smoke test asserts against.
//
// app.js owns the environment, the frame loop, lap timing, and the respawn
// logic, and exports the handles the test drives.

import { installSystemMenu } from "/lib/system-menu.js";
import { buildTrack } from "/app/track.js";
import { createCar } from "/app/car.js";
import { createCameras } from "/app/cameras.js";
import { drawTelemetry, drawLaps, setFps, setCameraButtons, bindHud } from "/app/hud.js";

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
const car = createCar(scene, world.spawn);
const cameras = createCameras(scene, car.chassisNode, world);
const cam = cameras.chase;

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
};

let lapClock = 0;
let prevIndex = 0;

function respawnAtNearest() {
    const t = Physics.getTransform(car.vehicle.chassisBody);
    const i = world.nearestIndex(t.position.x, t.position.z);
    const p = world.edge(i, 0);
    car.respawn({ x: p.x, y: p.y + 1.4, z: p.z }, world.quatYaw(world.yawAt(i)));
    state.respawns++;
    // Restarting the lap clock is the honest thing to do — a lap you were
    // teleported through is not a lap time.
    state.currentLap = null;
    state.started = false;
    lapClock = 0;
    prevIndex = i;
}

car.setRespawnHandler(respawnAtNearest);

bindHud({
    onCamera: (i) => { cameras.select(i); setCameraButtons(cameras.activeIndex); },
    onRespawn: respawnAtNearest,
});
setCameraButtons(cameras.activeIndex);

// Number keys switch cameras. These are direct key handlers rather than
// actions on purpose: camera choice is a viewing preference, not a game
// binding, and it should not appear in the rebindable action list.
document.addEventListener('keydown', (e) => {
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) { cameras.select(i); setCameraButtons(cameras.activeIndex); }
});

// --- Frame loop --------------------------------------------------------------
// Order matters: input first (so the physics tick that follows this frame acts
// on it), then read state back for the wheels and the HUD. The chassis itself
// is synced by its PhysicsNode; only the wheels need copying, because they are
// constraint state rather than body state.

let fpsAccum = 0, fpsFrames = 0, last = performance.now();

/** One simulation-facing frame. Split out so the smoke test can step it. */
export function tick(dt) {
    car.applyInput(dt);
    car.syncWheels();

    const t = Physics.getTransform(car.vehicle.chassisBody);
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

    const telem = car.telemetry();
    // The surface reading comes from whatever body the front-left wheel is
    // touching, which is how the ice patch announces itself.
    const fl = telem.wheels[0];
    state.surface = fl && fl.contact ? world.surfaceName(fl.contactBody) : 'air';
    state.onIce = telem.wheels.some(w => w.contact && world.isIce(w.contactBody));
    return telem;
}

function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const telem = tick(dt);
    drawTelemetry(telem, state.surface);
    drawLaps(state);

    fpsAccum += dt;
    if (++fpsFrames >= 20) {
        setFps(fpsFrames / fpsAccum);
        fpsAccum = 0; fpsFrames = 0;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// CHUNK 2: a vehicle picker — the same track, driven by a tracked tank
// (Physics.createVehicle({ type:'tracked' }), skid steering via leftRatio /
// rightRatio) and a self-balancing motorcycle ({ type:'motorcycle' } + lean
// spring) — plus live per-wheel longitudinalFriction / lateralFriction tuning
// against the ice patch this track already carries.
//
// CHUNK 3: gamepad bindings on the torque_* actions, analog throttle/steer
// strength, rumble from wheel slip, and engine audio via a scene emitter on
// the chassis with Doppler from bindAudioListenerToCamera.

export { scene, canvas, cam, car, world, cameras };
