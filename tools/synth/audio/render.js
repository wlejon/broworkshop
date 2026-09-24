// audio/render.js — render one loop of the song offline (Save Loop).
//
// Each audible layer's notes are synthesized here (its oscillator shape
// and ADSR, one voice per step), then run through a copy of that layer's
// live effect chain with ctx.processEffectsOffline, and mixed. Effect tails
// past the loop are kept; trailing silence is trimmed.

import { NUM_STEPS } from "../model/song.js";
import { stepNotes } from "./sequencer.js";
import { midiToHz } from "./notes.js";

const LEVEL = 0.3;

function osc(waveform, phase) {
    const p = phase - Math.floor(phase);
    switch (waveform) {
        case 'square':     return p < 0.5 ? 1 : -1;
        case 'sawtooth':   return 2 * p - 1;
        case 'triangle':   return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
        case 'whitenoise': return Math.random() * 2 - 1;
        case 'pinknoise':  return (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
        default:           return Math.sin(2 * Math.PI * p);
    }
}

/** ADSR gain `t` seconds into a note held for `gate` seconds. */
export function envelope(adsr, t, gate) {
    const { attack: a, decay: d, sustain: s, release: r } = adsr;
    if (t >= gate) {
        const rt = t - gate;
        return rt < r ? s * (1 - rt / r) : 0;
    }
    if (t < a) return a > 0 ? t / a : 1;
    if (t < a + d) return 1 - ((t - a) / (d || 0.001)) * (1 - s);
    return s;
}

/**
 * Render the loop at the engine rate. Returns { pcm, rate } or null when no
 * layer has notes.
 */
export function renderLoop(ctx, song) {
    const rate = ctx.sampleRate || 44100;
    const stepDur = 60 / song.bpm / 4;
    const loopDur = stepDur * NUM_STEPS;
    const layers = song.layers.filter((l) => !l.muted && l.steps.some((n) => n != null));
    if (!layers.length) return null;

    const maxRelease = Math.max(...layers.map((l) => l.sound.adsr.release));
    let mix = new Float32Array(Math.ceil((loopDur + maxRelease) * rate));

    for (const layer of layers) {
        const buf = new Float32Array(mix.length);
        const { waveform, adsr } = layer.sound;
        stepNotes(layer).forEach((midi, step) => {
            if (midi == null) return;
            const hz = midiToHz(midi);
            const start = Math.floor(step * stepDur * rate);
            const len = Math.floor(stepDur * rate) + Math.ceil(adsr.release * rate);
            for (let i = 0; i < len && start + i < buf.length; i++) {
                const t = i / rate;
                buf[start + i] += osc(waveform, t * hz) * envelope(adsr, t, stepDur) * LEVEL * layer.sound.volume;
            }
        });
        const wet = ctx.processEffectsOffline(layer.rt.bus, buf) || buf;
        if (wet.length > mix.length) {
            const grown = new Float32Array(wet.length);
            grown.set(mix);
            mix = grown;
        }
        for (let i = 0; i < wet.length; i++) mix[i] += wet[i];
    }

    let end = mix.length - 1;
    while (end > 0 && Math.abs(mix[end]) < 1e-4) end--;
    end = Math.max(end, Math.ceil(loopDur * rate) - 1);
    const pcm = mix.slice(0, end + 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
    return { pcm, rate };
}
