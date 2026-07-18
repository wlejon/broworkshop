// doppler.js — the showpiece.
//
// Doppler is the one spatial-audio feature that is genuinely hard to believe
// without a number next to it: a pitch shift on a moving source is easy to
// mistake for imagination. So this module does three things at once — it runs
// a source past the listener fast enough that the shift is unmistakable, it
// prints the exact ratio the mixer applied, and it graphs that ratio over the
// pass so the sign flip through the closest-approach point is visible as a
// shape.
//
// The engine's model (audio-api.js): ratio = (c - v_l·d̂) / (c - v_s·d̂) with
// c = 343 u/s, clamped to [0.5, 2.0], both velocities pre-scaled by
// ctx.dopplerFactor. The jet's velocity is NOT supplied by this file — it is
// derived by the engine from the node's frame-to-frame world position, the
// same as every other source here. All we do is move a node in a straight
// line and read the ratio back.
//
// The offset (the flyby passes to one side, not through the listener) is
// deliberate: a source aimed exactly at the listener has d̂ flip sign in a
// single frame, which makes the graph a step instead of the S-curve the ear
// actually perceives.

const FLYBY_HALF_LENGTH = 150;   // world units either side of the pass point
const FLYBY_OFFSET_Z = -7;       // lateral miss distance
const FLYBY_HEIGHT = 3.2;

const HISTORY = 260;             // one sample per graph pixel column

export const dopplerState = {
    factor: 1.0,
    speed: 90,          // units/sec
    running: false,
    ratio: 1.0,
    /** Ring of recent ratios; nulls mark frames before the buffer filled. */
    history: new Array(HISTORY).fill(null),
    jetNode: null,
    jetPlayback: -1,
    /** Distance travelled along the pass, in units, from the start point. */
    travelled: 0,
};

let ctxRef = null;
let graph = null, g2d = null;
let readouts = null;
let beads = [];

/**
 * Build the flyby subject: a jet on a straight line, parked far out and
 * silent until you run a pass.
 */
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

    // Loop the turbine forever and gate it with gain rather than stopping it:
    // a playback that has finished is a dead handle as far as the emitter sync
    // is concerned, and re-attaching per pass would hide the fact that ONE
    // attach survives the whole session.
    const playback = ctx.playClip(clips.jet.id, 0.0, true);
    node.attachAudioEmitter(playback);
    ctx.setPlaybackSpatialDistanceModel(playback, 'inverse');
    ctx.setPlaybackSpatialRefDistance(playback, 8);
    ctx.setPlaybackSpatialMaxDistance(playback, 400);
    ctx.setPlaybackSpatialRolloff(playback, 0.8);
    ctx.setPlaybackBus(playback, busId);

    dopplerState.jetNode = node;
    dopplerState.jetPlayback = playback;

    // Beads along the flight line, dense near the pass point where the ratio
    // is actually changing and sparse out at the ends where it is flat.
    for (let i = -12; i <= 12; i++) {
        const u = Math.sign(i) * Math.pow(Math.abs(i) / 12, 2);
        beads.push(scene.createMesh({
            mesh: 'sphere', name: `jetBead${i + 12}`, radius: 0.12, segments: 6, rings: 4,
            x: u * FLYBY_HALF_LENGTH, y: FLYBY_HEIGHT, z: FLYBY_OFFSET_Z,
            color: '#ff5d8f', emissive: 1.2, emissiveColor: '#ff5d8f',
        }));
    }

    return { node, playback, beads };
}

/** Wire the HUD controls. Called once from app.js. */
export function bindDopplerHud(ctx) {
    graph = document.getElementById('dopplerGraph');
    g2d = graph ? graph.getContext('2d') : null;
    readouts = {
        ratio: document.getElementById('dopplerRatio'),
        factorVal: document.getElementById('dopplerFactorVal'),
        speedVal: document.getElementById('flybySpeedVal'),
    };

    const factor = document.getElementById('dopplerFactor');
    factor.addEventListener('input', () => setDopplerFactor(ctx, parseFloat(factor.value)));
    setDopplerFactor(ctx, parseFloat(factor.value));

    const speed = document.getElementById('flybySpeed');
    speed.addEventListener('input', () => {
        dopplerState.speed = parseFloat(speed.value);
        readouts.speedVal.textContent = `${dopplerState.speed.toFixed(0)} u/s`;
    });
    readouts.speedVal.textContent = `${dopplerState.speed.toFixed(0)} u/s`;

    document.getElementById('flybyRun').addEventListener('click', () => startFlyby());
}

/** Set the global Doppler strength. 0 pins every ratio to exactly 1.0. */
export function setDopplerFactor(ctx, f) {
    dopplerState.factor = f;
    ctx.dopplerFactor = f;
    if (readouts) readouts.factorVal.textContent = f.toFixed(2);
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
 * Advance the pass and sample the ratio. Note the ordering contract: the
 * engine syncs emitter position/velocity and mixes audio between frames, so
 * the ratio read here is the one applied to the block just rendered for the
 * position set on the PREVIOUS frame. That one-frame lag is why the graph is
 * read as a shape rather than aligned to a specific x.
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

/** Repaint the ratio graph and the numeric readout. */
export function drawDoppler() {
    if (readouts) readouts.ratio.textContent = dopplerState.ratio.toFixed(3);
    if (!g2d) return;

    const w = graph.width, h = graph.height;
    g2d.clearRect(0, 0, w, h);
    g2d.fillStyle = '#0a121b';
    g2d.fillRect(0, 0, w, h);

    // Ratio axis spans the engine's own clamp range, [0.5, 2.0], so the graph
    // never rescales under you and a tall spike is always a big shift.
    const lo = 0.5, hi = 2.0;
    const yFor = (r) => h - ((r - lo) / (hi - lo)) * h;

    g2d.strokeStyle = '#26384c';
    g2d.lineWidth = 1;
    g2d.beginPath();
    g2d.moveTo(0, yFor(1.0) + 0.5);
    g2d.lineTo(w, yFor(1.0) + 0.5);
    g2d.stroke();

    g2d.fillStyle = '#4f6a86';
    g2d.font = '9px system-ui';
    g2d.fillText('1.0', 3, yFor(1.0) - 3);
    g2d.fillText('2.0', 3, 10);
    g2d.fillText('0.5', 3, h - 3);

    g2d.strokeStyle = '#ffd97b';
    g2d.lineWidth = 1.5;
    g2d.beginPath();
    let pen = false;
    for (let i = 0; i < dopplerState.history.length; i++) {
        const r = dopplerState.history[i];
        if (r === null) { pen = false; continue; }
        const x = (i / (HISTORY - 1)) * w;
        const y = yFor(Math.max(lo, Math.min(hi, r)));
        if (!pen) { g2d.moveTo(x, y); pen = true; } else g2d.lineTo(x, y);
    }
    g2d.stroke();
}

/** Show/hide the flight-line beads alongside the source path beads. */
export function setDopplerPathVisible(visible) {
    for (const b of beads) b.visible = visible;
}
