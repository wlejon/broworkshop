// Scene Audio — 3D spatial audio driven entirely by the scene graph.
//
// bro can attach a broaudio playback to a scene node (node.attachAudioEmitter)
// and bind the audio listener to the active camera
// (scene.bindAudioListenerToCamera). Between them a moving sound in a 3D world
// costs zero per-frame audio code: the engine reads the node's world
// transform after tweens and animations, pushes position into the source,
// derives velocity by finite difference for Doppler, and does the same for the
// camera on the listener side. Search this app for setPlaybackSpatialPosition:
// there is no per-frame call anywhere. (demos/spatial-audio is the other half:
// synth voices positioned by hand.)
//
//   audio_sources.js  every synthesized clip, plus the async Ogg decode
//   scene_setup.js    the stage and four moving sources, each a mesh node with
//                     an attached emitter and a drawn motion path
//   doppler.js        a jet flyby with its ratio printed and graphed
//   mixer.js          buses with a solo/mute strip each
//   streaming.js      a 96 s Ogg bed streamed off disk, ring stats live
//   midi.js           a MIDI controller striking twelve emitter pads around
//                     the listener: notes as positions, not just pitches
//
// Once a sound is attached to a node its SOURCE stops mattering: a synthesized
// buffer, a file decoded in the background, a file streamed off disk and a
// note struck on a keyboard are all the same playbackId to the emitter sync.
//
// This module owns the camera, listener binding, transport, source rows and
// the frame loop, and exports the handles tests/test_smoke.js asserts on.
// main.js only imports it (a test importing the entry module would boot a
// second copy of the app).

import { boot } from "/lib/kit/app.js";
import { h, $ } from "/lib/kit/dom.js";
import { segmented } from "/lib/kit/ui.js";
import { transport } from "/lib/kit/audio-ui.js";
import { sceneViewport, Camera } from "/lib/kit/viewport3d.js";
import { buildClips, loadOggClipAsync, OGG_CLIP } from "/app/audio_sources.js";
import { buildEnvironment, buildSources, tickSources, setPathsVisible } from "/app/scene_setup.js";
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

boot();

// Framed from outside and above the pillar ring (radius 26): the car's
// 18-unit orbit, the bee's 2.6-unit one and the bird's overhead figure of
// eight are all in shot, so the relative scale of the three distances you
// are hearing reads.
const vp = sceneViewport('#stage', {
    orbit: { target: [0, 3, 0], dist: 52, fov: 52, near: 0.1, far: 400 },
    controls: { minDist: 3 },
});
const { scene, cam, canvas } = vp;
Camera.orbitLook(cam, 0, 42);   // pitch down to a three-quarter view

const ctx = new AudioContext();
// Five spatial sources plus a music bed stack up unpredictably as the camera
// moves; a clipped mix would be blamed on the spatializer.
ctx.masterGain = 0.9;
ctx.setLimiterEnabled(true);
ctx.setLimiterThreshold(-1.0);
// A little room reverb makes distance readable: without early reflections a
// quiet source and a distant one sound identical.
ctx.setReverbEnabled(true);
ctx.setReverbRoomSize(0.55);
ctx.setReverbDamping(0.4);
ctx.setReverbMix(0.14);

const clips = buildClips(ctx);
const env = buildEnvironment(scene);
buildMixer(ctx);
const sources = buildSources(scene, ctx, clips);
routeSources(ctx, sources);
buildDoppler(scene, ctx, clips, busId('air'));
buildStreaming(ctx, busId('music'));
buildMidiPads(scene, ctx, clips, busId('machines'));
buildMidiInput(ctx);

export const state = {
    listenerBound: true,
    showPaths: true,
    /** Tests set this false to freeze app-driven motion and move nodes themselves. */
    autoTick: true,
    /** Which source the transport drives: 'ram' or 'stream'. */
    transport: 'ram',
};

// --- Listener binding ---------------------------------------------------------
//
// Bound, the engine pushes camera position, orientation and velocity into the
// listener every frame and this app has no listener code at all. Unbound, the
// listener freezes at the marker: orbiting stops changing the mix while the
// visuals keep moving, which is the feature's contribution made audible.

export const STATIC_LISTENER = { pos: [0, 1.5, 0], fwd: [0, 0, -1], up: [0, 1, 0] };
const listenerNote = $('#listenerNote');

export function setListenerBound(on) {
    state.listenerBound = on;
    scene.bindAudioListenerToCamera(on);
    if (!on) {
        // Park the listener at the marker facing -Z, velocity zeroed so a stale
        // camera velocity cannot keep Dopplering.
        ctx.setListenerPosition(...STATIC_LISTENER.pos);
        ctx.setListenerOrientation(...STATIC_LISTENER.fwd, ...STATIC_LISTENER.up);
        ctx.setListenerVelocity(0, 0, 0);
    }
    listenerNote.textContent = on
        ? 'Orbit with right-drag: the mix follows the camera.'
        : 'Unbound: listener frozen at the marker. Orbiting no longer changes the mix.';
}
setListenerBound(true);

// --- Transport ----------------------------------------------------------------
//
// A 24 s bed on the music bus, non-spatial: the scrubber is about seekPlayback
// and getPlaybackPositionSeconds. The readout is the engine's own seconds
// counter, never a JS timer, so a seek that silently failed would show as a
// readout snapping back. The same scrubber drives EITHER the RAM clip or the
// disk stream: on the stream the identical seek call seeks a codec, and the
// stream panel's underrun counter shows what the refill cost. The inactive
// source keeps playing at its own gain; switching is a control switch, not a
// mute, so you can A/B the two by ear.

export const musicPlayback = ctx.playClip(clips.music.id, 0.55, true);
ctx.setPlaybackBus(musicPlayback, busId('music'));
let ramPlaying = true;

const SOURCES = {
    ram: {
        duration: () => clips.music.seconds,
        position: () => ctx.getPlaybackPositionSeconds(musicPlayback),
        seek: (t) => ctx.seekPlayback(musicPlayback, Math.max(0, Math.min(clips.music.seconds, t))),
        setPlaying: (on) => { ramPlaying = on; ctx.setPlaybackPlaying(musicPlayback, on); },
        playing: () => ramPlaying,
    },
    stream: {
        duration: () => streamState.seconds,
        position: streamPositionSeconds,
        seek: seekStream,
        setPlaying: setStreamPlaying,
        playing: () => streamState.playing,
    },
};
const deck = transport({ toggle: '#musicToggle', seek: '#musicSeek', time: '#musicTime' }, SOURCES.ram);
const srcSwitch = segmented('#transportSrc', { ram: 'RAM clip', stream: 'disk stream' }, {
    value: 'ram', onChange: (v) => setTransportSource(v),
});

/** Live position of the active transport source, in seconds. */
export function transportPosition() { return SOURCES[state.transport].position(); }

/** Point the transport at 'ram' or 'stream' (stream only when it opened). */
export function setTransportSource(which) {
    state.transport = (which === 'stream' && streamState.id >= 0) ? 'stream' : 'ram';
    srcSwitch.value = state.transport;
    deck.setSource(SOURCES[state.transport]);
    return state.transport;
}

/** Seek the ACTIVE transport source, clamped to its length. Returns the target. */
export function seekMusic(seconds) {
    if (state.transport === 'stream') return seekStream(seconds);
    const t = Math.max(0, Math.min(clips.music.seconds, seconds));
    ctx.seekPlayback(musicPlayback, t);
    return t;
}

bindStreamingHud(ctx);

// --- Async file load ----------------------------------------------------------
//
// createClipFromFileAsync runs the Ogg decode and the resample to the engine
// rate on a background thread and resolves a promise; the frame loop never
// stops and the HUD sits in "loading" until it lands. The synchronous
// createClipFromFile would do all of that inline on this thread.

export const oggState = { status: 'loading', clip: null, error: null, playback: -1 };
const oggStateEl = $('#oggState'), oggInfoEl = $('#oggInfo');
$('#oggPath').textContent = OGG_CLIP;

/** Resolves when the async load settles, so the test can await the real thing. */
export const oggReady = loadOggClipAsync(ctx).then((clip) => {
    oggState.status = 'ready';
    oggState.clip = clip;
    oggStateEl.textContent = 'ready';
    oggStateEl.className = 'k-val ok';
    oggInfoEl.textContent = clip.channels + 'ch · ' + clip.seconds.toFixed(2) + ' s · ' +
        clip.ms.toFixed(0) + ' ms off-thread';
    return clip;
}).catch((e) => {
    // Reported, not swallowed: the engine's rejection names the cause.
    oggState.status = 'error';
    oggState.error = e.message;
    oggStateEl.textContent = 'failed';
    oggStateEl.className = 'k-val err';
    oggInfoEl.textContent = e.message;
    return null;
});

/** Play the decoded Ogg once through the music bus (the test measures that bus). */
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
$('#oggPlay').addEventListener('click', () => auditionOgg());

bindMidiHud(ctx);

// --- Source rows --------------------------------------------------------------
// A colour key matching the mesh, a motion toggle and a gain per source.
// Freezing a source still lets you hear it: the honest way to check that a
// sound you localized really was where you thought.

const sourceList = $('#sourceList');
for (const s of sources) {
    const move = h('button.small.active', {
        title: 'pause / resume its motion',
        onclick: () => {
            s.moving = !s.moving;
            move.classList.toggle('active', s.moving);
            move.textContent = s.moving ? '▶' : '‖';
        },
    }, '▶');
    const gain = h('input', {
        type: 'range', min: '0', max: '1.5', step: '0.05', value: String(s.gain),
        oninput: () => { s.gain = parseFloat(gain.value); ctx.setPlaybackGain(s.playback, s.gain); },
    });
    sourceList.appendChild(h('div.src', null,
        h('span.dot', { style: { background: s.color } }), h('span.nm', null, s.label), move, gain));
}

$('#showPaths').addEventListener('change', (e) => {
    state.showPaths = e.target.checked;
    setPathsVisible(sources, state.showPaths);
    setDopplerPathVisible(state.showPaths);
});
const bindBox = $('#bindListener');
bindBox.addEventListener('change', () => setListenerBound(bindBox.checked));

bindMixerHud(ctx);
bindDopplerHud(ctx);

// F runs a flyby (you want to watch the jet, not the panel); L toggles the
// listener binding. The bottom key row is a twelve-key octave onto the MIDI
// pads, through triggerNote, the same function the hardware path calls.
const KEY_ROW = 'zsxdcvgbhnjm';
document.addEventListener('keydown', (ev) => {
    if (ev.repeat || (ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName))) return;
    const key = ev.key.toLowerCase();
    if (key === 'f') { ev.preventDefault(); startFlyby(); return; }
    if (key === 'l') {
        ev.preventDefault();
        bindBox.checked = !bindBox.checked;
        setListenerBound(bindBox.checked);
        return;
    }
    const k = KEY_ROW.indexOf(key);
    if (k >= 0) { ev.preventDefault(); triggerNote(60 + k, 0.9); }
});

// --- Frame loop ---------------------------------------------------------------
//
// Everything spatial is node motion. The only per-frame audio calls are READS
// (the Doppler ratio, bus meters, transport position). No position, no
// velocity, no listener: the engine owns all three.

const listenerPosEl = $('#listenerPos'), listenerFwdEl = $('#listenerFwd');
let hudDivider = 0;

vp.onFrame((dt) => {
    if (state.autoTick) {
        tickSources(sources, dt);
        tickDoppler(dt);
    }
    // processEvents() is a poll: a frame that skips it is a frame where a note
    // never arrives, and the pad envelopes must keep decaying even while the
    // test has frozen the scene.
    tickMidi(dt);

    // The ratio graph gets every frame (its value is the shape of a fast
    // transient); the readouts refresh at a readable rate.
    drawDoppler();
    if ((hudDivider++ % 5) !== 0) return;
    drawMeters();
    drawStreamStats();
    drawMidi();
    deck.update();

    const view = Camera.orbitViewOpts(cam, canvas);
    const p = state.listenerBound ? view.position : STATIC_LISTENER.pos;
    const t = view.target || [0, 0, 0];
    const f = state.listenerBound ? normalize([t[0] - p[0], t[1] - p[1], t[2] - p[2]]) : STATIC_LISTENER.fwd;
    listenerPosEl.textContent = fmt3(p);
    listenerFwdEl.textContent = fmt3(f);
});

function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}
function fmt3(v) {
    return v[0].toFixed(1) + ', ' + v[1].toFixed(1) + ', ' + v[2].toFixed(1);
}

export {
    scene, ctx, cam, canvas, clips, sources, env,
    mixerState, dopplerState,
    busId, setBusSolo, setBusMuted, clearSolo, anySoloed,
    startFlyby, stopFlyby, setDopplerFactor, tickDoppler,
    tickSources, setPathsVisible,
    streamState, seekStream, streamPositionSeconds, setStreamPlaying,
    midiState, triggerNote, openPort, closePort, scanPorts, setRingRadius, tickMidi,
};
