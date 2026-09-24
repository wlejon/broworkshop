// doppler.js — the showpiece.
//
// A pitch shift on a moving source is easy to mistake for imagination, so
// this module runs a source past the listener fast enough that the shift is
// unmistakable, prints the exact ratio the mixer applied, and graphs it over
// the pass so the sign flip through closest approach is visible as a shape.
//
// The engine's model (audio-api.js): ratio = (c - v_l·d̂) / (c - v_s·d̂) with
// c = 343 u/s, clamped to [0.5, 2.0], both velocities pre-scaled by
// ctx.dopplerFactor. The jet's velocity is NOT supplied here: the engine
// derives it from the node's frame-to-frame world position, like every other
// source. We move a node in a straight line and read the ratio back.
//
// The pass misses the listener to one side on purpose: a source aimed
// straight through the listener flips d̂ in one frame, a step instead of the
// S-curve the ear hears.

import { bindControl } from "/lib/kit/params.js";
import { historyPlot } from "/lib/kit/audio-ui.js";

const FLYBY_HALF_LENGTH = 150;   // world units either side of the pass point
const FLYBY_OFFSET_Z = -7;       // lateral miss distance
const FLYBY_HEIGHT = 3.2;
const HISTORY = 260;             // one sample per graph column

export const dopplerState = {
    factor: 1.0,
    speed: 90,          // units/sec
    running: false,
    ratio: 1.0,
    /** Recent ratios; null marks frames outside a pass. */
    history: new Array(HISTORY).fill(null),
    jetNode: null,
    jetPlayback: -1,
    /** Distance travelled along the pass, in units, from the start point. */
    travelled: 0,
};

let ctxRef = null;
let plot = null, ratioEl = null;
const beads = [];

/** The flyby subject: a jet on a straight line, parked far out and silent. */
export function buildDoppler(scene, ctx, clips, busId) {
    ctxRef = ctx;
    ctx.dopplerFactor = dopplerState.factor;

    const node = scene.createMesh({
        mesh: 'box', name: 'jet',
        halfW: 2.4, halfH: 0.35, halfD: 0.7,
        x: -FLYBY_HALF_LENGTH, y: FLYBY_HEIGHT, z: FLYBY_OFFSET_Z,
        color: '#ff5d8f', emissive: 0.7, emissiveColor: '#ff5d8f',
        roughness: 0.35, metallic: 0.4,
    });

    // Loop the turbine forever and gate it with gain: a finished playback is
    // a dead handle to the emitter sync, and re-attaching per pass would hide
    // that ONE attach survives the whole session.
    const playback = ctx.playClip(clips.jet.id, 0.0, true);
    node.attachAudioEmitter(playback);
    ctx.setPlaybackSpatialDistanceModel(playback, 'inverse');
    ctx.setPlaybackSpatialRefDistance(playback, 8);
    ctx.setPlaybackSpatialMaxDistance(playback, 400);
    ctx.setPlaybackSpatialRolloff(playback, 0.8);
    ctx.setPlaybackBus(playback, busId);

    dopplerState.jetNode = node;
    dopplerState.jetPlayback = playback;

    // Beads along the flight line, dense near the pass point (where the ratio
    // changes) and sparse out at the flat ends.
    for (let i = -12; i <= 12; i++) {
        const u = Math.sign(i) * Math.pow(Math.abs(i) / 12, 2);
        beads.push(scene.createMesh({
            mesh: 'sphere', name: 'jetBead' + (i + 12), radius: 0.12, segments: 6, rings: 4,
            x: u * FLYBY_HALF_LENGTH, y: FLYBY_HEIGHT, z: FLYBY_OFFSET_Z,
            color: '#ff5d8f', emissive: 1.2, emissiveColor: '#ff5d8f',
        }));
    }
    return { node, playback, beads };
}

/** Wire the Doppler panel. */
export function bindDopplerHud(ctx) {
    ratioEl = document.getElementById('dopplerRatio');
    // The graph spans the engine's own clamp range, [0.5, 2.0], so it never
    // rescales under you and a tall spike is always a big shift.
    plot = historyPlot('#dopplerGraph', {
        size: HISTORY, min: 0.5, max: 2.0, ref: 1.0, values: dopplerState.history,
        fmt: (v) => v.toFixed(1),
    });
    bindControl(document.getElementById('dopplerFactor'), {
        out: '#dopplerFactorVal', fmt: (v) => v.toFixed(2),
        onChange: (v) => setDopplerFactor(ctx, v),
    });
    bindControl(document.getElementById('flybySpeed'), {
        out: '#flybySpeedVal', fmt: (v) => v.toFixed(0) + ' u/s',
        onChange: (v) => { dopplerState.speed = v; },
    });
    dopplerState.speed = parseFloat(document.getElementById('flybySpeed').value);
    setDopplerFactor(ctx, parseFloat(document.getElementById('dopplerFactor').value));
    document.getElementById('flybyRun').addEventListener('click', () => startFlyby());
}

/** Global Doppler strength. 0 pins every ratio to exactly 1.0. */
export function setDopplerFactor(ctx, f) {
    dopplerState.factor = f;
    ctx.dopplerFactor = f;
}

/** Reset the jet to the start of the line and let it go. */
export function startFlyby() {
    dopplerState.travelled = 0;
    dopplerState.running = true;
    dopplerState.history.fill(null);
    dopplerState.jetNode.position = [-FLYBY_HALF_LENGTH, FLYBY_HEIGHT, FLYBY_OFFSET_Z];
    ctxRef.setPlaybackGain(dopplerState.jetPlayback, 0.9);
}

/** Park the jet: silent, back at the start of the line. */
export function stopFlyby() {
    dopplerState.running = false;
    ctxRef.setPlaybackGain(dopplerState.jetPlayback, 0.0);
    dopplerState.jetNode.position = [-FLYBY_HALF_LENGTH, FLYBY_HEIGHT, FLYBY_OFFSET_Z];
}

/**
 * Advance the pass and sample the ratio. The engine syncs emitter position
 * and velocity and mixes between frames, so the ratio read here belongs to
 * the position set on the PREVIOUS frame; the graph reads as a shape, not as
 * values aligned to an exact x.
 */
export function tickDoppler(dt) {
    if (dopplerState.running) {
        dopplerState.travelled += dopplerState.speed * dt;
        const x = -FLYBY_HALF_LENGTH + dopplerState.travelled;
        if (x >= FLYBY_HALF_LENGTH) stopFlyby();
        else dopplerState.jetNode.position = [x, FLYBY_HEIGHT, FLYBY_OFFSET_Z];
    }
    dopplerState.ratio = ctxRef.getPlaybackDopplerRatio(dopplerState.jetPlayback);
    dopplerState.history.push(dopplerState.running ? dopplerState.ratio : null);
    if (dopplerState.history.length > HISTORY) dopplerState.history.shift();
    return dopplerState.ratio;
}

/** Repaint the ratio graph and readout. */
export function drawDoppler() {
    if (ratioEl) ratioEl.textContent = dopplerState.ratio.toFixed(3);
    if (plot) plot.draw();
}

/** Show/hide the flight-line beads alongside the source path beads. */
export function setDopplerPathVisible(visible) {
    for (const b of beads) b.visible = visible;
}
