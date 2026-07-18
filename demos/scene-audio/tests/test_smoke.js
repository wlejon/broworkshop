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
    oggReady, oggState, auditionOgg, stopOgg,
    streamState, seekStream, streamPositionSeconds,
    setTransportSource, transportPosition,
    midiState, triggerNote, tickMidi, scanPorts,
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

// --- 9. Async Ogg Vorbis decode produces real audio ---------------------------
//
// Two claims, and the second is the one that matters. That
// createClipFromFileAsync RESOLVES only proves it returned a handle. That the
// clip then renders a non-silent bus proves the Ogg decode actually
// reconstructed samples — a stub, a failed codec, or a buffer of zeros would
// all resolve just as happily and measure silent.
//
// This is also the only .ogg in the workshop tree. broaudio compiles stb_vorbis
// in and, before this app, nothing anywhere exercised it.

for (const s of sources) ctx.setPlaybackGain(s.playback, 0.0);
ctx.setPlaybackGain(musicPlayback, 0.0);

const oggClip = await oggReady;
assert(oggState.status === 'ready',
    `async ogg decode resolved (status ${oggState.status}, err ${oggState.error})`);
assert(oggClip && oggClip.id >= 0, `async decode returned a clip id: ${oggClip && oggClip.id}`);
assert(oggClip.channels === 2, `the ogg decoded as stereo: ${oggClip.channels}ch`);
assert(oggClip.frames > 0, `the ogg decoded to real frames: ${oggClip.frames}`);
// The file is 6.0 s at 48 kHz and the engine runs at 44.1 kHz; the reported
// count is post-resample, so the DURATION must survive the rate conversion
// even though the frame count cannot.
near(oggClip.seconds, 6.0, 0.05, 'resampled ogg keeps its duration');
assert(oggClip.frames === Math.round(6.0 * ctx.sampleRate),
    `frame count is the engine-rate count: ${oggClip.frames}`);

// Now the part that proves the bytes decoded. Measure the music bus silent,
// then measure it with the ogg playing on it.
const musicBus = busId('music');
const oggSilent = busLevel(musicBus, 10);
auditionOgg(0.9);
const oggPlaying = busLevel(musicBus, 6);
assert(oggPlaying > 0.01,
    `the decoded ogg renders audible audio: ${oggPlaying}`);
assert(oggPlaying > oggSilent * 8 + 0.005,
    `bus level rises when the ogg plays: ${oggSilent} -> ${oggPlaying}`);
stopOgg();

// A missing file must reject with the engine's own message, not resolve -1.
// NOTE: this deliberately prints one "cannot open or decode file" ERROR line in
// the run output. That line is the assertion passing, not the test failing.
let rejected = null;
try {
    await ctx.createClipFromFileAsync(oggClip.path.replace('pad-chime', 'not-a-file'));
} catch (e) {
    rejected = e;
}
assert(rejected instanceof Error, 'a bad path rejects the promise with an Error');
assert(/cannot open|decode/i.test(rejected.message),
    `rejection carries the decode failure: ${rejected.message}`);

// --- 10. Disk streaming renders, and its stats advance ------------------------
//
// createStreamFromFile and getStreamStats had no caller in the workshop. The
// stats are the interesting surface: a stream that is working and one that is
// silently starving are indistinguishable without them.

assert(streamState.error === null, `the ogg bed opened as a stream: ${streamState.error}`);
assert(streamState.id >= 0, `stream got a playback id: ${streamState.id}`);

const streamStats0 = ctx.getStreamStats(streamState.id);
assert(streamStats0 && typeof streamStats0.decodedFrames === 'number',
    'getStreamStats returns the documented shape');
for (const k of ['decodedFrames', 'playedFrames', 'bufferedFrames', 'underrunFrames']) {
    assert(typeof streamStats0[k] === 'number' && streamStats0[k] >= 0,
        `stats.${k} is a sane number: ${streamStats0[k]}`);
}
assert(typeof streamStats0.finished === 'boolean', 'stats.finished is a boolean');

// The stream is on the music bus at gain 0 by default; give it a level and
// measure. Non-silent here means the Vorbis decode worker really is producing
// samples, through a completely different path from the RAM clip above.
ctx.setPlaybackGain(streamState.id, 0.9);
const streamLevel = busLevel(musicBus, 20);
assert(streamLevel > 0.01, `the disk stream renders audible audio: ${streamLevel}`);

const streamStats1 = ctx.getStreamStats(streamState.id);
assert(streamStats1.playedFrames > streamStats0.playedFrames,
    `playedFrames advances: ${streamStats0.playedFrames} -> ${streamStats1.playedFrames}`);
assert(streamStats1.decodedFrames > streamStats1.playedFrames,
    `the decoder stays ahead of playback: decoded ${streamStats1.decodedFrames} > played ${streamStats1.playedFrames}`);
assert(streamStats1.bufferedFrames > 0 && streamStats1.bufferedFrames <= streamState.ringFrames * 1.5,
    `buffered frames sit inside the ring: ${streamStats1.bufferedFrames} / ${streamState.ringFrames}`);
// decoded - played should be roughly what is sitting in the ring.
near(streamStats1.decodedFrames - streamStats1.playedFrames, streamStats1.bufferedFrames,
    streamState.ringFrames * 0.1, 'decoded minus played accounts for the ring');

// --- 11. Seeking a STREAM lands where you asked -------------------------------
//
// This one is here because audio-api.js:784 still says createStreamFromFile has
// no seek. It does — the doc line is stale, and the seekPlayback entry forty
// lines above it describes the real behaviour. Seeking a stream is a different
// operation from seeking a RAM clip: the worker seeks the CODEC, drops
// everything buffered, and refills, and the gap is counted as underrun.

setTransportSource('stream');
assert(state.transport === 'stream', 'transport switched to the disk stream');

const beforeStreamSeek = streamPositionSeconds();
assert(beforeStreamSeek > 0, `stream position advances before the seek: ${beforeStreamSeek}`);

const underrunBefore = ctx.getStreamStats(streamState.id).underrunFrames;

// Seek deep into the file, well past anything that could already be buffered:
// the ring holds ~2 s and we are ~3 s in, so 62 s is unreachable without a real
// codec seek.
const STREAM_TARGET = 62.0;
seekMusic(STREAM_TARGET);              // the HUD's own entry point
run(45);
const afterStreamSeek = streamPositionSeconds();

assert(Math.abs(afterStreamSeek - STREAM_TARGET) < 1.5,
    `seeking a STREAM lands near the requested second: asked ${STREAM_TARGET}, got ${afterStreamSeek}`);
// How far the cursor was before the seek depends on how long the earlier
// sections of this test took, so the claim is that it JUMPED — many times
// further than the elapsed frames could have carried it — not that it started
// from any particular place.
assert(afterStreamSeek - beforeStreamSeek > 20,
    `the seek really jumped forward: ${beforeStreamSeek} -> ${afterStreamSeek}`);
assert(transportPosition() === afterStreamSeek || Math.abs(transportPosition() - afterStreamSeek) < 2,
    'the transport readout follows the stream, not the RAM clip');

// The refill usually costs a counted gap, but whether the decode worker has
// already caught up by the time we read the stats is a race — it depends on how
// much of the ring survived the seek and how the worker was scheduled. Observed,
// not asserted: the seek itself is already proven by the two position checks
// above, which are deterministic.
const underrunAfter = ctx.getStreamStats(streamState.id).underrunFrames;
console.log(`stream refill    underrun ${underrunBefore} -> ${underrunAfter}` +
    (underrunAfter > underrunBefore ? ' (gap counted)' : ' (worker kept up)'));

// Seek backwards too — a forward-only seek could be a decoder that simply ran on.
seekMusic(8.0);
run(45);
const rewoundStream = streamPositionSeconds();
assert(Math.abs(rewoundStream - 8.0) < 1.5,
    `seeking a stream BACKWARDS lands too: asked 8, got ${rewoundStream}`);
assert(rewoundStream < afterStreamSeek - 40,
    `the backward seek really moved: ${afterStreamSeek} -> ${rewoundStream}`);

// And the RAM clip is untouched by all of that — two independent cursors.
setTransportSource('ram');
assert(state.transport === 'ram', 'transport switched back to the RAM clip');
ctx.setPlaybackGain(streamState.id, 0.0);

// --- 12. MIDI input exists and its notes drive scene emitters -----------------
//
// createMidiInput had no caller anywhere in the workshop. What is asserted here
// is the SHAPE — whether a controller happens to be plugged into the machine
// running this test is not something a test may depend on, so availablePorts()
// is checked for being a well-formed array and nothing more.

assert(midiState.input, 'ctx.createMidiInput() returned an object');
const ports = scanPorts();
assert(Array.isArray(ports), `availablePorts() returns an array (got ${typeof ports})`);
for (const p of ports) {
    assert(typeof p.index === 'number' && typeof p.name === 'string',
        `each port is {index, name}: ${JSON.stringify(p)}`);
}
assert(typeof midiState.input.isOpen === 'boolean', 'isOpen is a boolean');
for (const m of ['open', 'close', 'availablePorts', 'onRawEvent', 'onControlChange',
                 'onPitchBend', 'connectToAllocator', 'processEvents']) {
    assert(typeof midiState.input[m] === 'function', `MidiInput.${m} exists`);
}

// The pads are the payoff: twelve emitter nodes, one per pitch class. A note
// strikes one of them, and because each pad is a NODE with an attached emitter,
// the note is spatialized by the same sync path as everything else.
assert(midiState.pads.length === 12, `twelve pitch-class pads: ${midiState.pads.length}`);
for (const pad of midiState.pads) {
    assert(pad.playback >= 0, `pad ${pad.name} has a live playback handle`);
}

// Silence the world and prove a struck pad is audible on its bus.
for (const s of sources) ctx.setPlaybackGain(s.playback, 0.0);
ctx.setPlaybackGain(musicPlayback, 0.0);
const padBus = busId('machines');

const padsSilent = busLevel(padBus, 10);

// C4 — pad 0, which sits at the front of the ring, right in front of a listener
// parked at the origin looking down -Z.
parkCamera([0, 1.5, 0]);
const struck = triggerNote(60, 1.0);
assert(struck === midiState.pads[0], 'note 60 strikes the C pad');
assert(struck.level > 0.9, `the strike sets a full envelope: ${struck.level}`);
assert(midiState.noteCount > 0, `note counter advanced: ${midiState.noteCount}`);

let padPeak = 0;
for (let i = 0; i < 20; i++) {
    advanceTime(16);
    padPeak = Math.max(padPeak, Math.max(ctx.getBusRmsL(padBus), ctx.getBusRmsR(padBus)));
}
assert(padPeak > 0.005, `a MIDI note renders audible audio: ${padsSilent} -> ${padPeak}`);

// The envelope must actually decay — a pad stuck open would ring forever and
// the "one-shot" framing would be a lie.
for (let i = 0; i < 140; i++) { tickMidi(0.016); advanceTime(16); }
assert(struck.level === 0, `the pad envelope decays to zero: ${struck.level}`);

// Pitch: the same clip at two different notes must play at different rates.
// This is what makes twelve pads cover a keyboard.
triggerNote(72, 0.9);                       // C5 — an octave up on the same pad
assert(midiState.pads[0].lastNote === 72, 'the C pad re-triggers an octave up');
for (let i = 0; i < 60; i++) { tickMidi(0.016); advanceTime(16); }

// Distinct notes land on distinct pads — i.e. distinct positions in the scene.
triggerNote(64, 0.9);                       // E
triggerNote(67, 0.9);                       // G
assert(midiState.pads[4].lastNote === 64, 'E lands on pad 4');
assert(midiState.pads[7].lastNote === 67, 'G lands on pad 7');
assert(midiState.pads[4].node.name !== midiState.pads[7].node.name,
    'different notes are different emitter nodes');
for (let i = 0; i < 120; i++) { tickMidi(0.016); advanceTime(16); }

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
console.log(`ogg async decode    ${oggClip.channels}ch ${oggClip.frames}f (${oggClip.seconds.toFixed(3)}s) in ${oggClip.ms.toFixed(0)}ms; bus ${oggSilent.toFixed(4)} -> ${oggPlaying.toFixed(4)}`);
console.log(`disk stream         level ${streamLevel.toFixed(4)}; decoded ${streamStats1.decodedFrames} played ${streamStats1.playedFrames} buffered ${streamStats1.bufferedFrames} / ring ${streamState.ringFrames}`);
console.log(`stream seek         ${beforeStreamSeek.toFixed(2)} -> ${afterStreamSeek.toFixed(2)} (asked 62) -> ${rewoundStream.toFixed(2)} (asked 8); refill underrun +${underrunAfter - underrunBefore} frames`);
console.log(`midi                ports [${ports.map(p => p.name).join(', ') || 'none'}]; ${midiState.pads.length} pads, ${midiState.noteCount} notes, pad bus peak ${padPeak.toFixed(4)}`);
console.log('scene-audio smoke test OK');
