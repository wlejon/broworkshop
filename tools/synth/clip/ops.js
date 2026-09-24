// clip/ops.js — pure sample operations for the clip editor. Every function
// takes a Float32Array and a region [a, b) and returns a NEW array (the
// caller keeps the old one for undo); none touches the engine.

import { concatPcm } from "/lib/kit/audio.js";

const region = (pcm, a, b) => [a == null ? 0 : a, b == null ? pcm.length : b];

/** Keep only [a, b). */
export function trim(pcm, a, b) { return pcm.slice(a, b); }

/** Remove [a, b). */
export function cut(pcm, a, b) { return concatPcm([pcm.subarray(0, a), pcm.subarray(b)]); }

/** Replace [a, b) with `ins` (a === b inserts). */
export function splice(pcm, a, b, ins) { return concatPcm([pcm.subarray(0, a), ins, pcm.subarray(b)]); }

/** Apply fn(sample, i - a, len) over [a, b) of a copy. */
export function mapRegion(pcm, a, b, fn) {
    [a, b] = region(pcm, a, b);
    const out = pcm.slice();
    const len = b - a;
    for (let i = a; i < b; i++) out[i] = fn(pcm[i], i - a, len);
    return out;
}

export const silence = (pcm, a, b) => mapRegion(pcm, a, b, () => 0);
export const gain = (pcm, a, b, dB) => { const k = Math.pow(10, dB / 20); return mapRegion(pcm, a, b, (v) => v * k); };
export const fadeIn = (pcm, a, b) => mapRegion(pcm, a, b, (v, i, n) => v * (i / n));
export const fadeOut = (pcm, a, b) => mapRegion(pcm, a, b, (v, i, n) => v * (1 - i / n));

export function reverse(pcm, a, b) {
    [a, b] = region(pcm, a, b);
    const out = pcm.slice();
    for (let i = a; i < b; i++) out[i] = pcm[b - 1 - (i - a)];
    return out;
}

/** Peak of [a, b). */
export function peak(pcm, a, b) {
    [a, b] = region(pcm, a, b);
    let p = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(pcm[i]); if (v > p) p = v; }
    return p;
}

/** Scale [a, b) so its peak is 1 (0 dBFS). */
export function normalize(pcm, a, b) {
    const p = peak(pcm, a, b);
    return p > 0 ? mapRegion(pcm, a, b, (v) => v / p) : pcm.slice();
}

/** Linear-interpolated resample of `src` to `len` samples. */
export function stretchTo(src, len) {
    const out = new Float32Array(Math.max(0, len));
    const step = src.length / Math.max(1, len);
    for (let i = 0; i < out.length; i++) {
        const t = i * step, j = Math.floor(t), f = t - j;
        const s0 = j < src.length ? src[j] : 0, s1 = j + 1 < src.length ? src[j + 1] : s0;
        out[i] = s0 + f * (s1 - s0);
    }
    return out;
}

/**
 * Resample [a, b) by `factor` in length (> 1 longer and lower, < 1 shorter
 * and higher: tape-speed, pitch and time move together). Returns
 * { pcm, len } with the region's new length.
 */
export function resampleRegion(pcm, a, b, factor) {
    [a, b] = region(pcm, a, b);
    const part = stretchTo(pcm.subarray(a, b), Math.round((b - a) * factor));
    return { pcm: splice(pcm, a, b, part), len: part.length };
}

/** Semitones up (+) or down (-): a resample by 2^(-semi/12). */
export const pitchShift = (pcm, a, b, semi) => resampleRegion(pcm, a, b, Math.pow(2, -semi / 12));

/** A tone, 80% full scale. waveform: sine | square | sawtooth | triangle. */
export function tone(hz, seconds, waveform, rate) {
    const n = Math.round(seconds * rate), out = new Float32Array(n);
    let ph = 0;
    const inc = hz / rate;
    for (let i = 0; i < n; i++) {
        switch (waveform) {
            case 'square':   out[i] = ph < 0.5 ? 0.8 : -0.8; break;
            case 'sawtooth': out[i] = (2 * ph - 1) * 0.8; break;
            case 'triangle': out[i] = (4 * Math.abs(ph - 0.5) - 1) * 0.8; break;
            default:         out[i] = Math.sin(2 * Math.PI * ph) * 0.8;
        }
        ph += inc;
        if (ph >= 1) ph -= 1;
    }
    return out;
}

/** White noise, 80% full scale. */
export function noise(seconds, rate) {
    const out = new Float32Array(Math.round(seconds * rate));
    for (let i = 0; i < out.length; i++) out[i] = (Math.random() * 2 - 1) * 0.8;
    return out;
}
