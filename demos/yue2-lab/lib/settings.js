// Every generation knob, as plain state objects bound to the Sampling panel,
// and the bro.music options they become.

import { params } from "/lib/kit/params.js";

// protocol.py's GenerationConfig defaults.
export const ABC_DEFAULTS = { temperature: 0.7, topP: 0.9, topK: 30, repetitionPenalty: 1.005,
                              penaltyWindow: 100, minTokens: 32, maxTokens: 4096 };
export const SEM_DEFAULTS = { temperature: 1.0, topP: 0.95, topK: 100, repetitionPenalty: 1.2,
                              penaltyWindow: 50, minTokens: 200, maxTokens: 9000 };
export const SYNTH_DEFAULTS = { odeSteps: 32, narChunkFrames: 0, reusePrefixKv: true, decodeCoreFrames: 50,
                                decodeFirstFrames: 8 };
export const PLAY_DEFAULTS = { prebufferSec: 1.0, live: true, autoplay: true };

export const abc = Object.assign({}, ABC_DEFAULTS);
export const sem = Object.assign({}, SEM_DEFAULTS);
export const synth = Object.assign({}, SYNTH_DEFAULTS);
export const play = Object.assign({}, PLAY_DEFAULTS);

const samplingSpec = (maxTok) => ({
    temperature:       { min: 0, max: 2, step: 0.01, hint: '0 = greedy' },
    topP:              { min: 0.01, max: 1, step: 0.01, label: 'top-p' },
    topK:              { min: 1, max: 500, step: 1, label: 'top-k' },
    repetitionPenalty: { min: 0.8, max: 2, step: 0.001, label: 'rep. penalty', hint: 'windowed; logit<0 multiplied, >0 divided' },
    penaltyWindow:     { min: 1, max: 100, step: 1, label: 'penalty window' },
    minTokens:         { min: 0, max: maxTok, step: 1, label: 'min tokens', hint: 'end token masked before this' },
    maxTokens:         { min: 1, max: maxTok, step: 1, label: 'max tokens', hint: 'semantic: 25 per second of song' },
});

let panels = [];

export function buildSettings(onChange) {
    panels = [
        [params('#abc-sampling', abc, samplingSpec(8192), { onChange }), abc, ABC_DEFAULTS],
        [params('#sem-sampling', sem, samplingSpec(24000), { onChange }), sem, SEM_DEFAULTS],
        [params('#synth-params', synth, {
            odeSteps:         { min: 1, max: 64, step: 1, label: 'ODE steps', hint: 'midpoint steps per chunk (2 velocity evals each)' },
            narChunkFrames:   { min: 0, max: 1500, step: 25, label: 'NAR window', hint: '0 = whole song (protocol); >0 = streaming windows of this many frames',
                                fmt: (v) => v ? v + ' fr (' + (v / 25).toFixed(0) + ' s)' : 'whole song' },
            reusePrefixKv:    { label: 'reuse semantic KV' },
            decodeCoreFrames: { min: 4, max: 400, step: 1, label: 'VAE tile', hint: 'the largest decoded tile; smaller = more halo recompute',
                                fmt: (v) => v + ' fr (' + (v / 25).toFixed(2) + ' s)' },
            decodeFirstFrames: { min: 1, max: 400, step: 1, label: 'first tile', hint: 'tiles grow from this, doubling up to the VAE tile; smaller = sooner audio',
                                 fmt: (v) => v + ' fr (' + (v / 25).toFixed(2) + ' s)' },
        }, { onChange }), synth, SYNTH_DEFAULTS],
        [params('#play-params', play, {
            prebufferSec: { min: 0, max: 10, step: 0.1, label: 'prebuffer', fmt: (v) => v.toFixed(1) + ' s' },
            live:         { label: 'play while decoding' },
            autoplay:     { label: 'play finished takes' },
        }, { onChange }), play, PLAY_DEFAULTS],
    ];
}

export function resetSettings() {
    for (const [p, state, def] of panels) {
        Object.assign(state, def);
        p.refresh();
    }
}

/** A snapshot for a take (restore with applySettings). */
export function snapshotSettings() {
    return { abc: Object.assign({}, abc), sem: Object.assign({}, sem), synth: Object.assign({}, synth) };
}

export function applySettings(s) {
    if (!s) return;
    if (s.abc) Object.assign(abc, s.abc);
    if (s.sem) Object.assign(sem, s.sem);
    if (s.synth) Object.assign(synth, s.synth);
    for (const [p] of panels) p.refresh();
}

/** The sampling / synthesis part of a bro.music options object. */
export function samplingOptions() {
    return {
        abcSampling: Object.assign({}, abc),
        semanticSampling: Object.assign({}, sem),
        odeSteps: synth.odeSteps,
        narChunkFrames: synth.narChunkFrames,
        reusePrefixKv: synth.reusePrefixKv,
        decodeCoreFrames: synth.decodeCoreFrames,
        decodeFirstFrames: synth.decodeFirstFrames,
    };
}
