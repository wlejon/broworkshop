// audio.js — the engine, synthesized, and put in the world.
//
// Nothing here loads a file. The engine note, the tyre squeal and the roll
// noise are all built as short Float32Array clips at startup and looped, which
// is the only honest way to do a car: an engine's pitch has to be a continuous
// function of RPM, and no amount of crossfading between recorded samples gives
// you that. A one-cycle waveform looped and resampled does, exactly — set the
// playback rate to rpm/baseRpm and the note IS the tachometer.
//
// The three sources are then handed to the SCENE rather than positioned by
// hand. node.attachAudioEmitter(playbackId) makes a node the source's position
// AND velocity every frame, and scene.bindAudioListenerToCamera(true) does the
// same for whichever camera is live. Between them the app never calls a single
// setPlaybackSpatialPosition: attach once, and driving the car around pans,
// attenuates and Dopplers everything automatically.
//
// That is why the trackside camera is the money shot. Chase and bonnet are
// parented to the chassis, so the listener travels with the source and there is
// almost no relative velocity — correctly, a car does not Doppler itself. Put
// the listener on the marshal's post at the flat corner and the same car
// passing it rises and falls by a measurable ratio, which the smoke test
// asserts on: greater than 1 approaching, less than 1 receding, and exactly
// 1.0 with the Doppler factor turned down to zero.
//
// TIMBRE. Two engine clips are played at once and crossfaded by throttle: a
// soft one that is mostly fundamental and second harmonic (an engine on the
// overrun) and a hard one with the odd harmonics and the bite that makes an
// engine under load sound like it is working. Pitch is shared, so they stay
// phase-plausible and the crossfade reads as load rather than as two engines.
//
// SURFACE. The roll noise is filtered differently per surface — the ice patch
// is a thin high hiss, gravel is a broad loud rattle, tarmac is a low roar. It
// is the same noise clip at three playback rates and gains, which is enough:
// what a listener actually detects is the spectral centroid moving.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ramp = (v, lo, hi) => v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);

/**
 * Per-vehicle rev range and firing frequency.
 *
 * `div` turns RPM into the note's fundamental in Hz: a four-stroke fires
 * cylinders/2 times per revolution, so rpm/30 is a four-cylinder, rpm/22 a big
 * slow multi-bank diesel, rpm/45 the higher-order, thinner note of a bike. That
 * one constant is why the three vehicles sound like different machines rather
 * than the same machine at different speeds.
 */
const RANGES = {
    car:  { idle: 900, redline: 7000, div: 30 },
    tank: { idle: 500, redline: 3200, div: 22 },
    bike: { idle: 1000, redline: 10000, div: 45 },
};

/**
 * Roll-noise character per track surface. `rate` moves the noise clip's
 * spectral centroid (higher = hissier), `gain` its level.
 */
const SURFACE_TONE = {
    tarmac:  { rate: 1.00, gain: 1.00, label: 'tarmac roar' },
    runoffL: { rate: 0.74, gain: 1.55, label: 'gravel rattle' },
    runoffR: { rate: 0.74, gain: 1.55, label: 'gravel rattle' },
    ice:     { rate: 1.95, gain: 0.42, label: 'ice hiss' },
    air:     { rate: 1.30, gain: 0.10, label: 'airborne' },
};

/**
 * One cycle of an engine waveform.
 *
 * `bite` blends from a smooth two-harmonic tone toward a hard, odd-harmonic
 * rasp. Both clips get the same slight amplitude alternation between their two
 * stored cycles, which is what an uneven firing order does and is the single
 * cheapest thing that stops a looped tone sounding like a synth pad.
 */
function engineCycle(sampleRate, hz, bite) {
    const cycles = 2;
    const n = Math.max(64, Math.round((sampleRate / hz) * cycles));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const p = (i / n) * cycles;            // 0..cycles
        const th = 2 * Math.PI * p;
        // Harmonic stack. The high orders are the ones that carry "load", so
        // they are the ones `bite` scales.
        let v = Math.sin(th) * 1.00
              + Math.sin(2 * th) * (0.45 + 0.10 * bite)
              + Math.sin(3 * th) * (0.10 + 0.55 * bite)
              + Math.sin(5 * th) * (0.03 + 0.40 * bite)
              + Math.sin(7 * th) * (0.01 + 0.26 * bite);
        // Soft clip: a real intake/exhaust is not a sum of sines, and tanh-ish
        // saturation adds the intermodulation that makes it read as mechanical.
        const drive = 1 + 2.4 * bite;
        v = Math.tanh(v * drive * 0.55) / Math.tanh(drive * 0.55);
        // Uneven firing: second stored cycle a little quieter than the first.
        out[i] = v * (p < 1 ? 1.0 : 0.86) * 0.5;
    }
    return out;
}

/** A second of noise, gently lowpassed so it is a rush rather than a fizz. */
function noiseLoop(sampleRate, poles) {
    const n = Math.round(sampleRate * 0.5);
    const out = new Float32Array(n);
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        a += (w - a) * poles;
        b += (a - b) * poles;
        out[i] = b * 3.2;
    }
    // Crossfade the tail into the head so the loop point is inaudible — a click
    // once every half second is the fastest way to make a good loop sound bad.
    const fade = Math.round(sampleRate * 0.02);
    for (let i = 0; i < fade; i++) {
        const k = i / fade;
        out[i] = out[i] * k + out[n - fade + i] * (1 - k);
    }
    return out;
}

/** A resonant squeal: noise pushed through a narrow ringing filter pair. */
function squealLoop(sampleRate) {
    const n = Math.round(sampleRate * 0.5);
    const out = new Float32Array(n);
    // Two resonators an interval apart, which is what stops a tyre squeal
    // sounding like a whistle: it is a band of noise, not a pitch.
    const res = [1180, 1790].map(f => ({
        f, s1: 0, s2: 0,
        c: 2 * Math.cos(2 * Math.PI * f / sampleRate),
        r: 0.994,
    }));
    for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        let v = 0;
        for (const q of res) {
            const y = q.r * q.c * q.s1 - q.r * q.r * q.s2 + w * 0.05;
            q.s2 = q.s1; q.s1 = y;
            v += y;
        }
        out[i] = Math.tanh(v * 1.6) * 0.55;
    }
    const fade = Math.round(sampleRate * 0.02);
    for (let i = 0; i < fade; i++) {
        const k = i / fade;
        out[i] = out[i] * k + out[n - fade + i] * (1 - k);
    }
    return out;
}

/**
 * Build the whole audio rig.
 *
 * @param {Object} scene
 * @returns {Object} handle — attachTo() on every vehicle change, update() each
 *   frame, plus the live levels the HUD draws.
 */
export function createEngineAudio(scene) {
    const ctx = new AudioContext();
    const SR = ctx.sampleRate || 48000;

    // Base pitch of the stored cycles. Everything is played back relative to
    // this, so it only has to be low enough that the top of the rev range does
    // not need an absurd resample ratio.
    const BASE_HZ = 70;

    const clips = {
        soft: ctx.createClip(engineCycle(SR, BASE_HZ, 0.0), 1, SR),
        hard: ctx.createClip(engineCycle(SR, BASE_HZ, 1.0), 1, SR),
        roll: ctx.createClip(noiseLoop(SR, 0.10), 1, SR),
        squeal: ctx.createClip(squealLoop(SR), 1, SR),
    };

    // All four start silent and looping, and are never stopped — a spatial
    // source that is started and stopped per event cannot be attached to a node
    // once and left alone, and re-attaching every squeal would be a lifetime
    // problem for no benefit. Gain is the only thing that moves.
    const src = {
        soft: ctx.playClip(clips.soft, 0, true),
        hard: ctx.playClip(clips.hard, 0, true),
        roll: ctx.playClip(clips.roll, 0, true),
        squeal: ctx.playClip(clips.squeal, 0, true),
    };

    // Spatialise every source identically: the distances suit a circuit where
    // the trackside post is ~40 m off the racing line, so a car is clearly
    // audible from the post and clearly quieter at the far side of the loop.
    for (const id of Object.values(src)) {
        ctx.setPlaybackSpatialEnabled(id, true);
        ctx.setPlaybackSpatialDistanceModel(id, 'inverse');
        ctx.setPlaybackSpatialRefDistance(id, 7);
        ctx.setPlaybackSpatialMaxDistance(id, 400);
        ctx.setPlaybackSpatialRolloff(id, 1.1);
    }

    // ONE listener exists engine-wide and it follows the active camera. This is
    // the line that makes the trackside camera hear a passing car.
    scene.bindAudioListenerToCamera(true);

    let mount = null;
    let emitterNodes = [];

    /** Live levels + the Doppler reading, for the HUD and the smoke test. */
    const levels = {
        soft: 0, hard: 0, roll: 0, squeal: 0,
        rate: 1, doppler: 1, surface: 'tarmac', tone: 'tarmac roar',
        lateralSlip: 0, attached: false,
    };

    /**
     * Point the emitters at a vehicle's chassis node.
     *
     * A node carries exactly ONE emitter binding — a second attachAudioEmitter()
     * on the same node silently replaces the first, and the displaced source
     * stops moving without any error to say so. (Measured: attaching two
     * playbacks to one chassis left the first pinned at a Doppler ratio of
     * exactly 1.0000 through a whole trackside pass while the second swept
     * 1.00 → 1.22.) So each source gets its own child node under the chassis,
     * which costs nothing — the children are at the origin and the scene graph
     * carries them — and each keeps its own binding.
     *
     * Called again on every vehicle switch and after a tyre rebuild, because
     * the chassis node does not survive one and its children go with it.
     */
    function attachTo(vehicle) {
        mount = vehicle && vehicle.chassisNode ? vehicle.chassisNode : null;
        emitterNodes = [];
        if (!mount) { levels.attached = false; return; }
        for (const name of Object.keys(src)) {
            const holder = scene.createNode(`emit_${name}`);
            mount.add(holder);
            holder.attachAudioEmitter(src[name]);
            emitterNodes.push(holder);
        }
        levels.attached = true;
    }

    /**
     * Let go before the node is destroyed. The audio keeps playing from wherever
     * it last was, which is why this silences it too — a disembodied engine
     * note hanging in space during a tyre rebuild is worse than a gap.
     */
    function detach() {
        for (const n of emitterNodes) n.detachAudioEmitter();
        emitterNodes = [];
        mount = null;
        levels.attached = false;
        for (const id of Object.values(src)) ctx.setPlaybackGain(id, 0);
    }

    /**
     * Lateral slip: how much of the chassis' velocity is sideways in its own
     * frame. This is what makes a tyre squeal, and unlike the longitudinal slip
     * ratio the constraint does not publish it, so it is measured off the body's
     * own velocity against the chassis' right axis.
     */
    function lateralSlip(vehicle) {
        const node = vehicle.chassisNode;
        const body = vehicle.vehicle.chassisBody;
        const vel = Physics.getVelocity(body);
        if (!vel || !node) return 0;
        const o = node.localToWorld(0, 0, 0);
        const r = node.localToWorld(1, 0, 0);
        const rx = r.x - o.x, rz = r.z - o.z;
        const len = Math.hypot(rx, rz) || 1;
        const lat = Math.abs((vel.linear.x * rx + vel.linear.z * rz) / len);
        const speed = Math.hypot(vel.linear.x, vel.linear.z);
        return speed < 1.5 ? 0 : clamp01(lat / speed);
    }

    /**
     * One frame of mixing. Everything is a gain or a rate; no source is ever
     * started, stopped or repositioned here.
     *
     * @param {Object} vehicle  the active vehicle handle
     * @param {Object} telem    its telemetry() snapshot
     * @param {string} surface  what the front wheel is standing on
     * @param {number} throttle analog throttle demand, 0..1
     */
    function update(vehicle, telem, surface, throttle) {
        if (!telem) return levels;
        if (!levels.attached) {
            for (const id of Object.values(src)) ctx.setPlaybackGain(id, 0);
            return levels;
        }
        const range = RANGES[telem.kind] || RANGES.car;

        // --- Pitch. The whole point: rate is a continuous function of RPM, so
        // the note sweeps through a gearshift instead of stepping.
        const hz = Math.max(range.idle, telem.rpm) / range.div;
        const rate = Math.max(0.25, Math.min(4, hz / BASE_HZ));
        ctx.setPlaybackRate(src.soft, rate);
        ctx.setPlaybackRate(src.hard, rate);
        levels.rate = rate;

        // --- Load. Level rises with revs; timbre crossfades with throttle.
        const load = clamp01(throttle);
        const revFrac = clamp01(telem.rpm / range.redline);
        const body = 0.10 + 0.52 * revFrac;
        const soft = body * (1 - 0.78 * load);
        const hard = body * (0.12 + 0.88 * load);
        ctx.setPlaybackGain(src.soft, soft);
        ctx.setPlaybackGain(src.hard, hard);
        levels.soft = soft;
        levels.hard = hard;

        // --- Tyre squeal, from lateral slip. Deliberately gated fairly high:
        // a car that squeals on every corner is a cartoon, and the interesting
        // moment is the one where the rear axle actually lets go.
        const lat = lateralSlip(vehicle);
        levels.lateralSlip = lat;
        const anyContact = telem.wheels.some(w => w.contact);
        const squeal = anyContact ? ramp(lat, 0.10, 0.55) * 0.55 : 0;
        ctx.setPlaybackGain(src.squeal, squeal);
        // Slide harder and the resonance climbs, which is what a tyre does.
        ctx.setPlaybackRate(src.squeal, 0.88 + 0.55 * ramp(lat, 0.10, 0.7));
        levels.squeal = squeal;

        // --- Roll noise, from speed and whatever is under the wheels.
        const tone = SURFACE_TONE[surface] || SURFACE_TONE.tarmac;
        const roll = anyContact
            ? ramp(Math.abs(telem.speed), 0.6, 34) * 0.34 * tone.gain
            : 0.02;
        ctx.setPlaybackGain(src.roll, roll);
        ctx.setPlaybackRate(src.roll, tone.rate);
        levels.roll = roll;
        levels.surface = surface;
        levels.tone = anyContact ? tone.label : 'airborne';

        // The mixer publishes the ratio it last applied. Read from the soft
        // engine source because it is the one that is always audible.
        levels.doppler = ctx.getPlaybackDopplerRatio(src.soft);
        return levels;
    }

    return {
        ctx, src, clips, levels,
        attachTo, detach, update,
        /** Global Doppler strength: 0 disables, 1 is physical, >1 exaggerates. */
        get dopplerFactor() { return ctx.dopplerFactor; },
        setDopplerFactor(v) { ctx.dopplerFactor = v; return ctx.dopplerFactor; },
        get masterGain() { return ctx.masterGain; },
        setMasterGain(v) { ctx.masterGain = v; return ctx.masterGain; },
    };
}
