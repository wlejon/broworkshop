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
//   audio_sources.js  Every sound, synthesized at load. No binary assets.
//   scene_setup.js    The stage and the four moving sources, each a mesh node
//                     with an attached emitter and a drawn motion path.
//   doppler.js        The flyby: a jet on a straight line, its ratio printed
//                     and graphed so the pitch shift is visible as well as
//                     audible.
//   mixer.js          Buses with a real solo/mute strip each — the control
//                     tools/synth's mixer never wired up.
//
// app.js owns the camera, the listener-binding toggle, the transport, and the
// frame loop, and exports the handles the smoke test asserts against.

import "/lib/camera.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { buildClips } from "/app/audio_sources.js";
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
// CHUNK 2: this same transport should also drive a disk-streamed file via
// createStreamFromFile, where seekPlayback seeks the CODEC and the brief
// refill gap is counted in getStreamStats().underrunFrames — a genuinely
// different code path from the in-RAM clip seek shown here.

const musicPlayback = ctx.playClip(clips.music.id, 0.55, true);
ctx.setPlaybackBus(musicPlayback, busId('music'));

const musicSeek = document.getElementById('musicSeek');
const musicTime = document.getElementById('musicTime');
const musicToggle = document.getElementById('musicToggle');

export function seekMusic(seconds) {
    const t = Math.max(0, Math.min(clips.music.seconds, seconds));
    ctx.seekPlayback(musicPlayback, t);
    return t;
}

musicSeek.addEventListener('input', () => {
    state.scrubbing = true;
    seekMusic((parseFloat(musicSeek.value) / 1000) * clips.music.seconds);
});
musicSeek.addEventListener('change', () => { state.scrubbing = false; });

musicToggle.addEventListener('click', () => {
    state.musicPlaying = !state.musicPlaying;
    ctx.setPlaybackPlaying(musicPlayback, state.musicPlaying);
    musicToggle.textContent = state.musicPlaying ? 'pause' : 'play';
});

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
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); startFlyby(); }
    if (ev.key === 'l' || ev.key === 'L') {
        ev.preventDefault();
        const box = document.getElementById('bindListener');
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
    }
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

    // HUD readouts refresh at a readable rate; the ratio graph gets every
    // frame because its whole value is the shape of a fast transient.
    drawDoppler();
    if ((hudDivider++ % 5) === 0) {
        drawMeters(ctx);

        const p = state.listenerBound ? view.position : STATIC_LISTENER.pos;
        const t = view.target || [0, 0, 0];
        const f = state.listenerBound
            ? normalize([t[0] - p[0], t[1] - p[1], t[2] - p[2]])
            : STATIC_LISTENER.fwd;
        listenerPosEl.textContent = fmt3(p);
        listenerFwdEl.textContent = fmt3(f);

        const secs = ctx.getPlaybackPositionSeconds(musicPlayback);
        musicTime.textContent = `${secs.toFixed(2)} / ${clips.music.seconds.toFixed(2)} s`;
        if (!state.scrubbing) {
            musicSeek.value = String(Math.round((secs / clips.music.seconds) * 1000));
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

// CHUNK 2: MIDI input (ctx.createMidiInput) belongs on this loop — a hardware
// controller flying an emitter node around the scene, with processEvents()
// pumped here alongside the readouts.

export {
    scene, ctx, cam, canvas, clips, sources, env,
    musicPlayback, mixerState, dopplerState,
    busId, setBusSolo, setBusMuted, clearSolo, anySoloed,
    startFlyby, stopFlyby, setDopplerFactor, tickDoppler,
    tickSources, setPathsVisible, STATIC_LISTENER,
};
