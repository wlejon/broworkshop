// Scene Audio — 3D spatial audio driven entirely by the scene graph.
//
// bro can attach a broaudio playback to a scene node (node.attachAudioEmitter)
// and bind the audio listener to the active camera
// (scene.bindAudioListenerToCamera). Between them, a moving sound in a 3D
// world costs zero per-frame audio code: the engine reads the node's world
// transform after tweens and animations, pushes position into the source,
// derives velocity by finite difference for Doppler, and does the same for the
// camera on the listener side.
//
// The older demos/spatial-audio predates all of that. It renders with three.js
// and pushes setVoiceSpatialPosition / setListenerPosition by hand every
// frame from three.js transforms. This app is the same idea rebuilt on the
// engine's own path — and the difference is visible in the diff, not just in
// the docs: search this directory for setPlaybackSpatialPosition and you will
// find no per-frame call anywhere.
//
// Around that core the app exercises the parts of broaudio's file and input
// surface that nothing in the workshop had touched. Before this app the tree
// contained no .ogg file at all, no call to createClipFromFileAsync, none to
// createStreamFromFile or getStreamStats, and none to createMidiInput. Each of
// those is here doing real work rather than being name-checked:
//
//   audio_sources.js  Every synthesized sound, built at load. Plus the async
//                     Ogg Vorbis decode (createClipFromFileAsync) and the
//                     realpath bridge the broaudio file APIs need.
//   scene_setup.js    The stage and the four moving sources, each a mesh node
//                     with an attached emitter and a drawn motion path.
//   doppler.js        The flyby: a jet on a straight line, its ratio printed
//                     and graphed so the pitch shift is visible as well as
//                     audible.
//   mixer.js          Buses with a real solo/mute strip each — the control
//                     tools/synth's mixer never wired up.
//   streaming.js      A 96 s Ogg bed played straight off disk, with the ring
//                     stats live, so "streamed" is a thing you can watch and
//                     not just a claim. Seeking it seeks the codec.
//   midi.js           A hardware controller striking twelve emitter pads
//                     arranged around the listener — MIDI notes as positions
//                     in the scene, not just pitches.
//
// What the whole thing is arguing: once a sound is attached to a node, its
// SOURCE stops mattering. A synthesized buffer, a file decoded in the
// background, a file being streamed off disk a ring at a time, and a note
// struck by a MIDI keyboard are all the same playbackId to the emitter sync,
// and all four are spatialized by the same engine path with no per-frame audio
// code in this app.
//
// app.js owns the camera, the listener-binding toggle, the transport, and the
// frame loop, and exports the handles the smoke test asserts against.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildClips, loadOggClipAsync, OGG_CLIP } from "/app/audio_sources.js";
import {
    buildEnvironment, buildSources, tickSources, setPathsVisible,
} from "/app/scene_setup.js";
import {
    buildMixer, busId, routeSources, bindMixerHud, drawMeters,
    setBusSolo, setBusMuted, clearSolo, anySoloed, mixerState,
} from "/app/mixer.js";
import {
    buildDoppler, bindDopplerHud, tickDoppler, drawDoppler, startFlyby,
    stopFlyby, setDopplerFactor, setDopplerPathVisible, dopplerState,
} from "/app/doppler.js";
import {
    buildStreaming, bindStreamingHud, drawStreamStats, seekStream,
    streamPositionSeconds, setStreamPlaying, streamState,
} from "/app/streaming.js";
import {
    buildMidiPads, buildMidiInput, bindMidiHud, tickMidi, drawMidi,
    triggerNote, openPort, closePort, scanPorts, setRingRadius, midiState,
} from "/app/midi.js";

installSystemMenu();

const canvas = document.getElementById('stage');
const scene = canvas.getContext('scene');
const ctx = new AudioContext();

// The limiter earns its keep here: five spatial sources plus a music bed stack
// up unpredictably as the camera moves through the field, and a clipped mix
// would be blamed on the spatializer.
ctx.masterGain = 0.9;
ctx.setLimiterEnabled(true);
ctx.setLimiterThreshold(-1.0);

// A little room reverb on the master makes distance readable — without any
// early-reflection cue, a quiet source and a distant source sound identical.
ctx.setReverbEnabled(true);
ctx.setReverbRoomSize(0.55);
ctx.setReverbDamping(0.4);
ctx.setReverbMix(0.14);

// Framed from outside and above the pillar ring (radius 26): from in here the
// car's 18-unit orbit, the bee's 2.6-unit one and the bird's overhead figure
// of eight are all in shot at once, which is the only way the relative scale
// of the three paths — and so of the three distances you are hearing — reads.
const cam = Camera.createOrbit({ target: [0, 3, 0], dist: 52, fov: 52, near: 0.1, far: 400 });
Camera.orbitLook(cam, 0, 42);   // pitch down to a three-quarter view

const clips = buildClips(ctx);
const env = buildEnvironment(scene);
buildMixer(ctx);
const sources = buildSources(scene, ctx, clips);
routeSources(ctx, sources);
buildDoppler(scene, ctx, clips, busId('air'));
buildStreaming(ctx, busId('music'));
buildMidiPads(scene, ctx, clips, busId('machines'));
buildMidiInput(ctx);

// --- Listener binding ---------------------------------------------------------
//
// Bound is the interesting state: the engine pushes camera position,
// orientation and velocity into the listener every frame and this app contains
// no listener code at all. The toggle exists so you can hear what that is
// worth — unbound, the listener freezes at the orbit centre and orbiting the
// camera stops changing the mix entirely, while the visuals keep moving. That
// mismatch is the feature's contribution, made audible.

export const state = {
    listenerBound: true,
    showPaths: true,
    musicPlaying: true,
    /** Tests set this false to freeze app-driven motion and move nodes themselves. */
    autoTick: true,
    scrubbing: false,
    /** Which source the transport drives: 'ram' or 'stream'. */
    transport: 'ram',
};

const STATIC_LISTENER = { pos: [0, 1.5, 0], fwd: [0, 0, -1], up: [0, 1, 0] };

export function setListenerBound(on) {
    state.listenerBound = on;
    scene.bindAudioListenerToCamera(on);
    if (!on) {
        // Park the listener where the marker is, facing -Z, and zero its
        // velocity so a stale camera velocity can't keep Dopplering.
        ctx.setListenerPosition(...STATIC_LISTENER.pos);
        ctx.setListenerOrientation(...STATIC_LISTENER.fwd, ...STATIC_LISTENER.up);
        ctx.setListenerVelocity(0, 0, 0);
    }
    const note = document.getElementById('listenerNote');
    if (note) {
        note.textContent = on
            ? 'Orbit with right-drag: the mix follows the camera.'
            : 'Unbound — listener frozen at the marker. Orbiting no longer changes the mix.';
    }
}
setListenerBound(true);

// --- Transport ----------------------------------------------------------------
//
// A 24-second bed on the music bus, non-spatial: the scrubber is about
// seekPlayback and getPlaybackPositionSeconds, and spatializing it would only
// add a variable that has nothing to do with seeking. The readout is the
// engine's own seconds counter, never a JS timer, so a seek that silently
// failed would show up immediately as a readout that snaps back.
//
// The same scrubber drives EITHER source, which is the whole reason it is worth
// having twice. Switch it to the disk stream and the identical seekPlayback
// call now seeks a codec instead of a buffer: the position readout still lands
// where you asked, but the stream panel's underrun counter jumps by the cost of
// the refill. One API, two very different things happening underneath, and the
// HUD shows both at once.

const musicPlayback = ctx.playClip(clips.music.id, 0.55, true);
ctx.setPlaybackBus(musicPlayback, busId('music'));

const musicSeek = document.getElementById('musicSeek');
const musicTime = document.getElementById('musicTime');
const musicToggle = document.getElementById('musicToggle');
const srcRamBtn = document.getElementById('srcRam');
const srcStreamBtn = document.getElementById('srcStream');

/** Which handle the transport controls: 'ram' (synth clip) or 'stream' (ogg). */
export function transportSource() { return state.transport; }

/** Duration of whichever source the transport is on. */
function transportSeconds() {
    return state.transport === 'stream' ? streamState.seconds : clips.music.seconds;
}

/** Live position of the active source, in seconds. */
export function transportPosition() {
    return state.transport === 'stream'
        ? streamPositionSeconds()
        : ctx.getPlaybackPositionSeconds(musicPlayback);
}

/**
 * Point the transport at one source or the other. The inactive one keeps
 * playing at its own gain — this is a control switch, not a mute — so you can
 * A/B the two by ear while the panel follows only the selected handle.
 */
export function setTransportSource(which) {
    state.transport = (which === 'stream' && streamState.id >= 0) ? 'stream' : 'ram';
    srcRamBtn.classList.toggle('on', state.transport === 'ram');
    srcStreamBtn.classList.toggle('on', state.transport === 'stream');
    return state.transport;
}

/** Seek the ACTIVE transport source. Clamped to that source's length. */
export function seekMusic(seconds) {
    if (state.transport === 'stream') return seekStream(seconds);
    const t = Math.max(0, Math.min(clips.music.seconds, seconds));
    ctx.seekPlayback(musicPlayback, t);
    return t;
}

srcRamBtn.addEventListener('click', () => setTransportSource('ram'));
srcStreamBtn.addEventListener('click', () => setTransportSource('stream'));
setTransportSource('ram');

musicSeek.addEventListener('input', () => {
    state.scrubbing = true;
    seekMusic((parseFloat(musicSeek.value) / 1000) * transportSeconds());
});
musicSeek.addEventListener('change', () => { state.scrubbing = false; });

musicToggle.addEventListener('click', () => {
    state.musicPlaying = !state.musicPlaying;
    if (state.transport === 'stream') setStreamPlaying(state.musicPlaying);
    else ctx.setPlaybackPlaying(musicPlayback, state.musicPlaying);
    musicToggle.textContent = state.musicPlaying ? 'pause' : 'play';
});

bindStreamingHud(ctx);

// --- Async file load ----------------------------------------------------------
//
// The one genuinely asynchronous thing in the app. createClipFromFileAsync runs
// the Ogg decode and the resample to the engine rate on a background thread and
// resolves a promise; the frame loop below never stops, the four spatial
// sources never miss a block, and the HUD sits in a "loading" state until it
// lands. The synchronous sibling — createClipFromFile, which is what every
// other app in the workshop uses — would have done all of that inline on this
// thread, and for a file of any size that is a visible hitch.

export const oggState = { status: 'loading', clip: null, error: null, playback: -1 };

const oggStateEl = document.getElementById('oggState');
const oggInfoEl = document.getElementById('oggInfo');
const oggPathEl = document.getElementById('oggPath');
const oggPlayBtn = document.getElementById('oggPlay');
oggPathEl.textContent = OGG_CLIP;

/** Resolves when the async load settles, so the test can await the real thing. */
export const oggReady = loadOggClipAsync(ctx).then((clip) => {
    oggState.status = 'ready';
    oggState.clip = clip;
    oggStateEl.textContent = 'ready';
    oggInfoEl.textContent =
        `${clip.channels}ch · ${clip.seconds.toFixed(2)} s · ${clip.ms.toFixed(0)} ms off-thread`;
    return clip;
}).catch((e) => {
    // A failed decode is reported, not swallowed. The message the engine
    // rejects with names the actual cause.
    oggState.status = 'error';
    oggState.error = e.message;
    oggStateEl.textContent = 'failed';
    oggStateEl.className = 'v err';
    oggInfoEl.textContent = e.message;
    return null;
});

/**
 * Play the decoded Ogg once through the music bus. Exported because the smoke
 * test measures the bus level while it runs — which is the only honest proof
 * the decode produced audio rather than a valid-looking handle full of zeros.
 */
export function auditionOgg(gain = 0.8) {
    if (oggState.status !== 'ready') return -1;
    if (oggState.playback >= 0) ctx.stopPlayback(oggState.playback);
    oggState.playback = ctx.playClip(oggState.clip.id, gain, false);
    ctx.setPlaybackBus(oggState.playback, busId('music'));
    return oggState.playback;
}

export function stopOgg() {
    if (oggState.playback >= 0) {
        ctx.stopPlayback(oggState.playback);
        oggState.playback = -1;
    }
}

oggPlayBtn.addEventListener('click', () => auditionOgg());

// --- MIDI ---------------------------------------------------------------------

bindMidiHud(ctx);

// --- Source rows --------------------------------------------------------------
// One row per moving source: a colour key matching its mesh, a motion toggle,
// and its own gain. Motion and gain are kept apart on purpose — freezing a
// source still lets you hear it, which is the honest way to check that a sound
// you localized really was where you thought it was.

const sourceList = document.getElementById('sourceList');
for (const s of sources) {
    const row = document.createElement('div');
    row.className = 'src';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = s.color;
    row.appendChild(dot);

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.label;
    row.appendChild(nm);

    const move = document.createElement('button');
    move.className = 'btn on';
    move.textContent = '▶';
    move.addEventListener('click', () => {
        s.moving = !s.moving;
        move.classList.toggle('on', s.moving);
        move.textContent = s.moving ? '▶' : '‖';
    });
    row.appendChild(move);

    const gain = document.createElement('input');
    gain.type = 'range';
    gain.min = '0'; gain.max = '1.5'; gain.step = '0.05';
    gain.value = String(s.gain);
    gain.addEventListener('input', () => {
        s.gain = parseFloat(gain.value);
        ctx.setPlaybackGain(s.playback, s.gain);
    });
    row.appendChild(gain);

    sourceList.appendChild(row);
}

document.getElementById('showPaths').addEventListener('change', (e) => {
    state.showPaths = e.target.checked;
    setPathsVisible(sources, state.showPaths);
    setDopplerPathVisible(state.showPaths);
});

document.getElementById('bindListener').addEventListener('change', (e) => {
    setListenerBound(e.target.checked);
});

bindMixerHud(ctx);
bindDopplerHud(ctx);

// --- Camera input (right = orbit, middle = pan, wheel = zoom) ------------------

let rightDown = false, middleDown = false;
function updatePointerLock() {
    const want = rightDown || middleDown;
    const locked = document.pointerLockElement === canvas;
    if (want && !locked) canvas.requestPointerLock();
    else if (!want && locked) document.exitPointerLock();
}
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2)      { rightDown  = true; e.preventDefault(); updatePointerLock(); }
    else if (e.button === 1) { middleDown = true; e.preventDefault(); updatePointerLock(); }
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightDown  = false;
    if (e.button === 1) middleDown = false;
    updatePointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (rightDown)  Camera.orbitLook(cam, e.movementX, e.movementY);
    if (middleDown) Camera.orbitPan (cam, e.movementX, e.movementY);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('wheel', (e) => {
    cam.dist = Math.max(3.0, cam.dist * Math.exp(e.deltaY * 0.001));
    e.preventDefault();
});

// F runs a flyby without reaching for the button — the pass is short and you
// want to be looking at the jet, not the panel, when it goes past.
//
// The bottom keyboard row is a twelve-key octave onto the MIDI pads. It exists
// because the interesting claim — that a note is a POSITION — needs to be
// checkable on a machine with no controller attached, and it goes through
// triggerNote, the same function the hardware path calls.
const KEY_ROW = 'zsxdcvgbhnjm';

document.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); startFlyby(); }
    if (ev.key === 'l' || ev.key === 'L') {
        ev.preventDefault();
        const box = document.getElementById('bindListener');
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
    }
    const k = KEY_ROW.indexOf(ev.key.toLowerCase());
    if (k >= 0) { ev.preventDefault(); triggerNote(60 + k, 0.9); }
});

// --- Frame loop ---------------------------------------------------------------
//
// Everything spatial in here is node motion. The only audio calls per frame are
// READS — the Doppler ratio and the bus meters — plus the transport readout.
// No position, no velocity, no listener: the engine owns all three.

const listenerPosEl = document.getElementById('listenerPos');
const listenerFwdEl = document.getElementById('listenerFwd');

let last = performance.now();
let hudDivider = 0;

function frame() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    const view = Camera.orbitViewOpts(cam, canvas);
    scene.setCamera(view);

    if (state.autoTick) {
        tickSources(sources, dt);
        tickDoppler(dt);
    }

    // MIDI is pumped unconditionally: processEvents() is a poll, so a frame
    // that skips it is a frame where a note simply never arrives, and the pad
    // envelopes need to keep decaying even when the test has frozen the scene.
    tickMidi(dt);

    // HUD readouts refresh at a readable rate; the ratio graph gets every
    // frame because its whole value is the shape of a fast transient.
    drawDoppler();
    if ((hudDivider++ % 5) === 0) {
        drawMeters(ctx);
        drawStreamStats();
        drawMidi();

        const p = state.listenerBound ? view.position : STATIC_LISTENER.pos;
        const t = view.target || [0, 0, 0];
        const f = state.listenerBound
            ? normalize([t[0] - p[0], t[1] - p[1], t[2] - p[2]])
            : STATIC_LISTENER.fwd;
        listenerPosEl.textContent = fmt3(p);
        listenerFwdEl.textContent = fmt3(f);

        const secs = transportPosition();
        const total = transportSeconds();
        musicTime.textContent = `${secs.toFixed(2)} / ${total.toFixed(2)} s`;
        if (!state.scrubbing) {
            musicSeek.value = String(Math.round((secs / total) * 1000));
        }
    }

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}
function fmt3(v) {
    return `${v[0].toFixed(1)}, ${v[1].toFixed(1)}, ${v[2].toFixed(1)}`;
}

export {
    scene, ctx, cam, canvas, clips, sources, env,
    musicPlayback, mixerState, dopplerState,
    busId, setBusSolo, setBusMuted, clearSolo, anySoloed,
    startFlyby, stopFlyby, setDopplerFactor, tickDoppler,
    tickSources, setPathsVisible, STATIC_LISTENER,
    // Chunk 2: files off disk and notes off a controller.
    streamState, seekStream, streamPositionSeconds, setStreamPlaying,
    midiState, triggerNote, openPort, closePort, scanPorts, setRingRadius,
    tickMidi,
};
