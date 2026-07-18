// test_smoke.js — headless integration test for Scene Audio.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/scene-audio \
//       ../broworkshop/demos/scene-audio/tests/test_smoke.js
//
// Headless audio is deterministic: advanceTime() syncs scene emitters and the
// camera-bound listener, then renders exactly that many frames through
// renderBlock. So every assertion below is on a MEASURED number — a bus RMS, a
// Doppler ratio, a playback position — not on "it didn't throw".
//
// The one thing that cannot be asserted directly: broaudio exposes no getter
// for a source's spatial position or for the listener position, so there is no
// way to read back "the emitter is at exactly the node's world position". The
// auto-sync proof here is therefore indirect but tight — distance attenuation
// and Doppler sign are both pure functions of the synced position and
// velocity, so moving ONLY the node and observing both change is proof the
// engine pushed them.

import {
    scene, ctx, cam, canvas, clips, sources, state,
    musicPlayback, mixerState, dopplerState,
    busId, setBusSolo, clearSolo, setListenerBound,
    startFlyby, stopFlyby, setDopplerFactor, tickDoppler, seekMusic,
} from "/app/app.js";

advanceTime(64);
flush();

// --- Helpers ------------------------------------------------------------------

/** Run n frames of virtual time at a fixed step. */
function run(frames, stepMs = 16) {
    for (let i = 0; i < frames; i++) advanceTime(stepMs);
}

/**
 * Settle, then read a bus level averaged over a full modulation period.
 *
 * A single RMS sample is not a usable measurement here: the source clips are
 * deliberately modulated (the car engine wobbles at 2 Hz, the bee at 14 Hz),
 * so an instantaneous meter reading swings ±25% for reasons that have nothing
 * to do with position. 32 frames of virtual time is 512 ms — just over one
 * car-wobble period — so averaging across it cancels the modulation and leaves
 * the spatial level.
 */
function busLevel(id, settleFrames = 12) {
    run(settleFrames);
    let sum = 0;
    const window = 32;
    for (let i = 0; i < window; i++) {
        advanceTime(16);
        sum += Math.max(ctx.getBusRmsL(id), ctx.getBusRmsR(id));
    }
    return sum / window;
}

function near(a, b, tol, what) {
    assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
}

// Freeze the app's own motion so the test owns every node position. The frame
// loop still runs (camera + readouts), which is what we want — it proves the
// real app path, minus the animation that would fight the test.
state.autoTick = false;

// --- The stage built ----------------------------------------------------------

assert(scene, 'scene context exists');
assert(cam && Array.isArray(cam.pos), 'orbit camera created');
assert(sources.length === 4, `four moving sources, got ${sources.length}`);
assert(clips.music.seconds > 20, `music clip is long enough to scrub: ${clips.music.seconds}s`);
assert(mixerState.order.length === 5, 'five mixer buses');
for (const s of sources) {
    assert(s.playback >= 0, `${s.key} has a live playback handle`);
}

// Park the camera at the origin looking down -Z for the whole test, so the
// listener is at a known place whenever it is camera-bound.
function parkCamera(pos = [0, 1.5, 0]) {
    cam.pos = pos.slice();
    cam.pivot = [pos[0], pos[1], pos[2] - 1];
    run(2);
}
parkCamera();

// --- 1. Emitter auto-sync: node motion alone changes the mix ------------------
//
// Only `node.position` is written here. If the engine were not pushing the
// node's world position into the source, the bus level could not move.

const car = sources.find(s => s.key === 'car');
const carBus = busId(car.busKey);

// Silence everything else so the car's bus level is unambiguous.
for (const s of sources) ctx.setPlaybackGain(s.playback, s.key === 'car' ? 1.0 : 0.0);
ctx.setPlaybackGain(musicPlayback, 0.0);

car.node.position = [0, 1.5, -4];
const nearLevel = busLevel(carBus, 20);

car.node.position = [0, 1.5, -120];
const farLevel = busLevel(carBus, 20);

assert(nearLevel > 0.01, `near source is audible: rms ${nearLevel}`);
assert(farLevel < nearLevel * 0.25,
    `moving the NODE alone attenuates the source: near ${nearLevel} -> far ${farLevel}`);

car.node.position = [0, 1.5, -4];
const backLevel = busLevel(carBus, 20);
assert(backLevel > farLevel * 4,
    `returning the node restores the level: ${farLevel} -> ${backLevel}`);

// --- 2. Camera-bound listener: moving the CAMERA changes the mix --------------
//
// The node does not move at all in this block, and the app contains no
// ctx.setListener* call on this path — bindAudioListenerToCamera(true) is the
// only thing connecting the camera to the mix.

setListenerBound(true);
car.node.position = [0, 1.5, -4];
parkCamera([0, 1.5, 0]);
const listenerNear = busLevel(carBus, 20);

parkCamera([0, 1.5, 140]);            // camera far away; node untouched
const listenerFar = busLevel(carBus, 20);

assert(listenerFar < listenerNear * 0.25,
    `camera-bound listener follows the camera: ${listenerNear} -> ${listenerFar}`);

// Unbound, the listener is pinned at the marker, so the same camera move must
// NOT change the level.
setListenerBound(false);
parkCamera([0, 1.5, 0]);
const unboundA = busLevel(carBus, 20);
parkCamera([0, 1.5, 140]);
const unboundB = busLevel(carBus, 20);
near(unboundB, unboundA, unboundA * 0.10 + 1e-4,
    'unbound listener ignores camera motion');

setListenerBound(true);
parkCamera([0, 1.5, 0]);

// --- 3. Doppler: the sign flip through closest approach -----------------------
//
// The jet's velocity is never supplied by the app — the engine derives it from
// the node's frame-to-frame world position. So a ratio above 1 while the node
// approaches and below 1 while it recedes proves the velocity sync too.

setDopplerFactor(ctx, 1.0);
const jet = dopplerState.jetNode;
const jetPb = dopplerState.jetPlayback;
ctx.setPlaybackGain(jetPb, 0.9);

/** Fly the jet along +X past the listener, sampling the ratio each frame. */
function flySample(speed = 120, stepMs = 16, from = -100, to = 100) {
    const samples = [];
    const dt = stepMs / 1000;
    let x = from;
    jet.position = [x, 3.2, -7];
    run(2);
    while (x < to) {
        x += speed * dt;
        jet.position = [x, 3.2, -7];
        advanceTime(stepMs);
        samples.push({ x, ratio: ctx.getPlaybackDopplerRatio(jetPb) });
    }
    return samples;
}

const pass = flySample();
const approaching = pass.filter(s => s.x < -30);
const receding = pass.filter(s => s.x > 30);

const maxApproach = Math.max(...approaching.map(s => s.ratio));
const minRecede = Math.min(...receding.map(s => s.ratio));

assert(approaching.every(s => s.ratio > 1.0),
    `every approaching sample shifts up (min ${Math.min(...approaching.map(s => s.ratio))})`);
assert(receding.every(s => s.ratio < 1.0),
    `every receding sample shifts down (max ${Math.max(...receding.map(s => s.ratio))})`);
assert(maxApproach > 1.2, `approach shift is substantial: ${maxApproach}`);
assert(minRecede < 0.85, `recede shift is substantial: ${minRecede}`);
assert(maxApproach >= 0.5 && maxApproach <= 2.0, 'ratio stays inside the engine clamp');

// The model is symmetric about 1 in the reciprocal sense for a stationary
// listener: approaching c/(c-v), receding c/(c+v). Check the far-field pair
// against the documented c = 343 u/s directly.
const c = 343, v = 120;
near(maxApproach, c / (c - v), 0.06, 'approach ratio matches c/(c-v)');
near(minRecede, c / (c + v), 0.06, 'recede ratio matches c/(c+v)');

// --- 4. dopplerFactor = 0 pins the ratio to exactly 1 -------------------------

setDopplerFactor(ctx, 0);
const off = flySample();
assert(off.every(s => s.ratio === 1.0),
    `factor 0 gives exactly 1.0 everywhere (saw ${[...new Set(off.map(s => s.ratio))].join(', ')})`);
setDopplerFactor(ctx, 1.0);

stopFlyby();
ctx.setPlaybackGain(jetPb, 0.0);

// startFlyby() through the same entry point the HUD button uses.
startFlyby();
assert(dopplerState.running, 'startFlyby arms the pass');
// autoTick is off, so drive the module's own tick — the same call the frame
// loop makes — rather than relying on the app loop we deliberately froze.
for (let i = 0; i < 30; i++) { tickDoppler(0.016); advanceTime(16); }
const expectedTravel = 30 * 0.016 * dopplerState.speed;
near(dopplerState.travelled, expectedTravel, 1e-6,
    'flyby advances at exactly the chosen speed');
assert(dopplerState.history.some(r => r !== null), 'the ratio graph recorded the pass');
stopFlyby();
assert(!dopplerState.running, 'stopFlyby parks the jet');
ctx.setPlaybackGain(jetPb, 0.0);

// --- 5. Bus solo measurably changes the rendered mix --------------------------
//
// Solo is measured on the MASTER bus (0): a bus's own meter reports its level
// before the solo gate, so master is where the silencing actually shows up.

clearSolo();
const bee = sources.find(s => s.key === 'bee');
const machine = sources.find(s => s.key === 'machine');
bee.node.position = [1.5, 1.5, -2];
machine.node.position = [-1.5, 1.5, -2];
ctx.setPlaybackGain(bee.playback, 1.0);
ctx.setPlaybackGain(machine.playback, 1.0);
ctx.setPlaybackGain(car.playback, 0.0);

const fullMix = busLevel(0, 25);
assert(fullMix > 0.01, `full mix is audible: ${fullMix}`);

assert(setBusSolo('insects', true) === true, 'getBusSolo reports the solo we set');
const soloMix = busLevel(0, 30);
assert(soloMix < fullMix * 0.9,
    `soloing one bus measurably drops the master mix: ${fullMix} -> ${soloMix}`);
assert(soloMix > 0.001, `the soloed bus is still audible: ${soloMix}`);

assert(ctx.getBusSolo(busId('machines')) === false, 'other buses are not soloed');

clearSolo();
const restored = busLevel(0, 30);
assert(restored > soloMix * 1.1,
    `clearing solo restores the mix: ${soloMix} -> ${restored}`);
assert(mixerState.order.every(k => ctx.getBusSolo(busId(k)) === false),
    'clearSolo left no bus soloed');

// --- 6. seekPlayback lands in the seconds domain ------------------------------

ctx.setPlaybackGain(musicPlayback, 0.4);
run(10);
const beforeSeek = ctx.getPlaybackPositionSeconds(musicPlayback);
assert(beforeSeek > 0, `music position advances: ${beforeSeek}s`);

const target = 12.5;
seekMusic(target);
const stepMs = 16, settleFrames = 4;
run(settleFrames, stepMs);
const afterSeek = ctx.getPlaybackPositionSeconds(musicPlayback);
// The cursor keeps running while we settle, so the expected value is the seek
// target plus the virtual time we let elapse.
near(afterSeek, target + (settleFrames * stepMs) / 1000, 0.05,
    'seekPlayback lands at the requested second');

seekMusic(0.5);
run(settleFrames, stepMs);
const afterRewind = ctx.getPlaybackPositionSeconds(musicPlayback);
assert(afterRewind < afterSeek, `seeking backwards works: ${afterSeek} -> ${afterRewind}`);
near(afterRewind, 0.5 + (settleFrames * stepMs) / 1000, 0.05, 'rewind lands too');

// Clamping: seeking past the end must not run away.
seekMusic(clips.music.seconds + 30);
run(2);
const clamped = ctx.getPlaybackPositionSeconds(musicPlayback);
assert(clamped <= clips.music.seconds + 0.2, `seek past end clamps: ${clamped}`);

// --- 7. outputLatency is readable -------------------------------------------

const latency = ctx.outputLatency;
assert(typeof latency === 'number' && latency >= 0, `outputLatency readable: ${latency}`);
assert(latency === 0, 'headless has no device, so outputLatency is exactly 0');

// --- 8. detachAudioEmitter stops the sync ------------------------------------
//
// After detaching, the audio keeps playing but node motion must stop moving
// it — the level stays put where the last sync left it.

seekMusic(0);
ctx.setPlaybackGain(musicPlayback, 0.0);
for (const s of sources) ctx.setPlaybackGain(s.playback, s.key === 'car' ? 1.0 : 0.0);
car.node.position = [0, 1.5, -4];
const attachedNear = busLevel(carBus, 20);

car.node.detachAudioEmitter();
car.node.position = [0, 1.5, -120];
const detachedFar = busLevel(carBus, 20);
near(detachedFar, attachedNear, attachedNear * 0.1 + 1e-4,
    'detached emitter stops following the node');

// Re-attaching resumes the sync from the node's current position.
car.node.attachAudioEmitter(car.playback);
const reattached = busLevel(carBus, 20);
assert(reattached < attachedNear * 0.25,
    `re-attach snaps the source back onto the node: ${attachedNear} -> ${reattached}`);

// --- Wrap up ------------------------------------------------------------------

state.autoTick = true;
for (const s of sources) ctx.setPlaybackGain(s.playback, s.gain);
ctx.setPlaybackGain(musicPlayback, 0.55);
run(30);

screenshot('scene-audio-smoke.png');

// Print the numbers the assertions were made on: a passing test that shows its
// measurements is far more useful than one that only says "OK", and these are
// the values a future engine change would move.
console.log(`emitter auto-sync   near ${nearLevel.toFixed(4)} -> far ${farLevel.toFixed(4)} -> back ${backLevel.toFixed(4)}`);
console.log(`camera listener     near ${listenerNear.toFixed(4)} -> far ${listenerFar.toFixed(4)}; unbound ${unboundA.toFixed(4)} / ${unboundB.toFixed(4)}`);
console.log(`doppler flyby       approach ${maxApproach.toFixed(4)} (c/(c-v) ${(c / (c - v)).toFixed(4)}), recede ${minRecede.toFixed(4)} (c/(c+v) ${(c / (c + v)).toFixed(4)})`);
console.log(`bus solo            full ${fullMix.toFixed(4)} -> solo ${soloMix.toFixed(4)} -> restored ${restored.toFixed(4)}`);
console.log(`seek seconds        ${beforeSeek.toFixed(3)} -> ${afterSeek.toFixed(3)} (asked 12.5) -> ${afterRewind.toFixed(3)} (asked 0.5)`);
console.log(`detach              attached ${attachedNear.toFixed(4)}, detached+moved ${detachedFar.toFixed(4)}, re-attached ${reattached.toFixed(4)}`);
console.log('scene-audio smoke test OK');
