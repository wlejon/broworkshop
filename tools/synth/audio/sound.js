// audio/sound.js — a "sound": the oscillator, envelope, unison and effect
// chain of one layer (or the mic), and how it reaches broaudio.
//
// A sound is plain data (it is what presets and project files store). Its
// voice half (waveform, pan, envelope, unison) is read by the layer's
// VoiceAllocator setup callback at every note-on, so editing it needs no
// engine call; its bus half (level + effects) is pushed to the layer's bus
// with applyBus / applyBusParam.

import { midiToHz } from "./notes.js";

export const EFFECTS = ['filter', 'delay', 'compressor', 'chorus', 'reverb', 'equalizer', 'distortion'];
export const EFFECT_LABELS = {
    filter: 'Filter', delay: 'Delay', compressor: 'Compressor', chorus: 'Chorus',
    reverb: 'Reverb', equalizer: 'Equalizer', distortion: 'Distortion',
};
export const WAVEFORMS = { sine: 'Sin', square: 'Sqr', sawtooth: 'Saw', triangle: 'Tri', whitenoise: 'Wht', pinknoise: 'Pnk' };
export const EQ_BANDS = ['60Hz', '170Hz', '350Hz', '1kHz', '3.5kHz', '10kHz', '16kHz'];

/** A fresh default sound. */
export function defaultSound() {
    return {
        waveform: 'sine', volume: 1, pan: 0,
        adsr: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.08 },
        unison: { count: 1, detune: 0.15, stereoWidth: 0.7 },
        effectOrder: EFFECTS.slice(),
        filter: { enabled: false, type: 'lowpass', frequency: 2000, Q: 1, gain: 0 },
        delay: { enabled: false, time: 0.3, feedback: 0.3, mix: 0.3 },
        reverb: { enabled: false, roomSize: 0.5, damping: 0.5, mix: 0.2 },
        chorus: { enabled: false, rate: 1, depth: 0.003, mix: 0.3, feedback: 0, baseDelay: 0.007 },
        // threshold in dBFS here; the engine takes linear amplitude (see BUS)
        compressor: { enabled: false, threshold: -12, ratio: 4, attack: 10, release: 100, sidechain: null },
        eq: { enabled: false, masterGain: 0, bands: [0, 0, 0, 0, 0, 0, 0] },
        distortion: { enabled: false, mode: 'softclip', drive: 2.5, mix: 1, outputGain: 0.7, crushBits: 8, crushRate: 0.5 },
    };
}

/**
 * Deep-fill `src` over `def` (default: a default sound): every key of the
 * default is present, unknown keys are dropped, arrays are copied.
 */
export function withDefaults(src, def) {
    def = def || defaultSound();
    if (!src || typeof src !== 'object') return def;
    const out = {};
    for (const k in def) {
        const d = def[k], s = src[k];
        if (Array.isArray(d)) out[k] = Array.isArray(s) && s.length === d.length ? s.slice() : d.slice();
        else if (d && typeof d === 'object') out[k] = withDefaults(s, d);
        else out[k] = s !== undefined && s !== null && typeof s === typeof d ? s : d;
    }
    // sidechain is a layer uid or null: not typed by its default
    if ('sidechain' in def) out.sidechain = src.sidechain != null ? src.sidechain : null;
    if (out.effectOrder) out.effectOrder = normalizeOrder(out.effectOrder);
    return out;
}

/** The effect order with unknown names dropped and missing ones appended. */
export function normalizeOrder(order) {
    const out = (order || []).map((n) => (n === 'eq' ? 'equalizer' : n)).filter((n, i, a) => EFFECTS.includes(n) && a.indexOf(n) === i);
    for (const n of EFFECTS) if (!out.includes(n)) out.push(n);
    return out;
}

export const dbToLinear = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------
// Bus half: one setter per "section.key" path. rt = { bus, slot } (the layer's
// bus id and its filter slot); c = the AudioContext.
// ---------------------------------------------------------------------------

const BUS = {
    'volume':               (c, rt, v) => c.setBusGain(rt.bus, v),
    'filter.enabled':       (c, rt, v) => c.setBusFilterEnabled(rt.bus, rt.slot, v),
    'filter.type':          (c, rt, v) => c.setBusFilterType(rt.bus, rt.slot, v),
    'filter.frequency':     (c, rt, v) => c.setBusFilterFrequency(rt.bus, rt.slot, v),
    'filter.Q':             (c, rt, v) => c.setBusFilterQ(rt.bus, rt.slot, v),
    'filter.gain':          (c, rt, v) => c.setBusFilterGain(rt.bus, rt.slot, v),
    'delay.enabled':        (c, rt, v) => c.setBusDelayEnabled(rt.bus, v),
    'delay.time':           (c, rt, v) => c.setBusDelayTime(rt.bus, v),
    'delay.feedback':       (c, rt, v) => c.setBusDelayFeedback(rt.bus, v),
    'delay.mix':            (c, rt, v) => c.setBusDelayMix(rt.bus, v),
    'reverb.enabled':       (c, rt, v) => c.setBusReverbEnabled(rt.bus, v),
    'reverb.roomSize':      (c, rt, v) => c.setBusReverbRoomSize(rt.bus, v),
    'reverb.damping':       (c, rt, v) => c.setBusReverbDamping(rt.bus, v),
    'reverb.mix':           (c, rt, v) => c.setBusReverbMix(rt.bus, v),
    'chorus.enabled':       (c, rt, v) => c.setBusChorusEnabled(rt.bus, v),
    'chorus.rate':          (c, rt, v) => c.setBusChorusRate(rt.bus, v),
    'chorus.depth':         (c, rt, v) => c.setBusChorusDepth(rt.bus, v),
    'chorus.mix':           (c, rt, v) => c.setBusChorusMix(rt.bus, v),
    'chorus.feedback':      (c, rt, v) => c.setBusChorusFeedback(rt.bus, v),
    'chorus.baseDelay':     (c, rt, v) => c.setBusChorusBaseDelay(rt.bus, v),
    'compressor.enabled':   (c, rt, v) => c.setBusCompressorEnabled(rt.bus, v),
    'compressor.threshold': (c, rt, v) => c.setBusCompressorThreshold(rt.bus, dbToLinear(v)),
    'compressor.ratio':     (c, rt, v) => c.setBusCompressorRatio(rt.bus, v),
    'compressor.attack':    (c, rt, v) => c.setBusCompressorAttack(rt.bus, v),
    'compressor.release':   (c, rt, v) => c.setBusCompressorRelease(rt.bus, v),
    'compressor.sidechain': (c, rt, v) => c.setBusCompressorSidechain(rt.bus, rt.sidechainBus(v)),
    'eq.enabled':           (c, rt, v) => c.setBusEqEnabled(rt.bus, v),
    'eq.masterGain':        (c, rt, v) => c.setBusEqMasterGain(rt.bus, v),
    'eq.bands':             (c, rt, v) => v.forEach((g, i) => c.setBusEqBandGain(rt.bus, i, g)),
    'distortion.enabled':   (c, rt, v) => c.setBusDistortionEnabled(rt.bus, v),
    'distortion.mode':      (c, rt, v) => c.setBusDistortionMode(rt.bus, v),
    'distortion.drive':     (c, rt, v) => c.setBusDistortionDrive(rt.bus, v),
    'distortion.mix':       (c, rt, v) => c.setBusDistortionMix(rt.bus, v),
    'distortion.outputGain': (c, rt, v) => c.setBusDistortionOutputGain(rt.bus, v),
    'distortion.crushBits': (c, rt, v) => c.setBusDistortionCrushBits(rt.bus, v),
    'distortion.crushRate': (c, rt, v) => c.setBusDistortionCrushRate(rt.bus, v),
    'effectOrder':          (c, rt, v) => c.setBusEffectOrder(rt.bus, v),
};

function read(sound, path) {
    let o = sound;
    for (const p of path.split('.')) o = o == null ? o : o[p];
    return o;
}

/**
 * Push one sound param to the bus. `path` is 'section.key' ('delay.mix'),
 * 'eq.bands.3' (one EQ band), or a voice param (a no-op here: voices read
 * the sound at note-on). Returns whether it touched the bus.
 */
export function applyBusParam(ctx, rt, sound, path) {
    if (!ctx || !rt || rt.bus < 0) return false;
    const band = /^eq\.bands\.(\d)$/.exec(path);
    if (band) { ctx.setBusEqBandGain(rt.bus, +band[1], sound.eq.bands[+band[1]]); return true; }
    const set = BUS[path];
    if (!set) return false;
    set(ctx, rt, read(sound, path));
    return true;
}

/** Push the whole bus half of a sound (after creating a bus or loading). */
export function applyBus(ctx, rt, sound) {
    for (const path in BUS) applyBusParam(ctx, rt, sound, path);
}

/** A bus of its own plus its filter slot. `sidechainBus(ref)` resolves a sidechain reference. */
export function createBusRt(ctx, sidechainBus) {
    const bus = ctx ? ctx.createBus() : -1;
    const slot = ctx && bus >= 0 ? Math.max(0, ctx.allocateBusFilterSlot(bus)) : 0;
    return { bus, slot, sidechainBus: sidechainBus || (() => -1) };
}

export function deleteBusRt(ctx, rt) {
    if (ctx && rt && rt.bus > 0) ctx.deleteBus(rt.bus);
    if (rt) rt.bus = -1;
}

/**
 * A 16-voice allocator whose voices are set up from `getSound()` at each
 * note-on (so edits apply to the next note) and routed to `getBus()`.
 */
export function createAllocator(ctx, getSound, getBus) {
    if (!ctx) return null;
    const alloc = ctx.createVoiceAllocator(16);
    alloc.setStealPolicy('oldest');
    alloc.setVoiceSetup((id, note, velocity) => {
        const s = getSound();
        ctx.setVoiceNote(id, note, velocity);
        ctx.setVoiceWaveform(id, s.waveform);
        ctx.setVoiceFrequency(id, midiToHz(note));
        ctx.setVoicePan(id, s.pan);
        ctx.setVoiceAttack(id, s.adsr.attack);
        ctx.setVoiceDecay(id, s.adsr.decay);
        ctx.setVoiceSustain(id, s.adsr.sustain);
        ctx.setVoiceRelease(id, s.adsr.release);
        ctx.setVoiceBus(id, getBus());
        ctx.setVoiceUnisonCount(id, s.unison.count);
        ctx.setVoiceUnisonDetune(id, s.unison.detune);
        ctx.setVoiceUnisonStereoWidth(id, s.unison.stereoWidth);
    });
    return alloc;
}
