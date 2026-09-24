// lib/kit/audio.js — PCM plumbing for audio demos and labs (no DOM).
//
//   import { audioContext, clipPlayer, micRecorder, saveWav, signal } from "/lib/kit/audio.js";
//   const player = clipPlayer();
//   player.play(pcm, 16000);                 // replaces whatever it played before
//   const rec = micRecorder({ rate: 16000 });
//   rec.start();  ...  const clip = rec.stop();
//
// bro's AudioContext is clip-based (broaudio): createClip publishes a Float32
// buffer to the audio thread, playClip re-triggers it. Everything here shares
// one lazily created context. Widgets that draw audio live in audio-ui.js.

let sharedCtx = null;

/** The app's shared AudioContext, created on first use. */
export function audioContext() {
    if (!sharedCtx) sharedCtx = new AudioContext();
    return sharedCtx;
}

/** Linear-resample a mono buffer (monitoring quality). Returns the input when rates match. */
export function resample(samples, inRate, outRate) {
    if (!samples || Math.abs(inRate - outRate) < 1) return samples;
    const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        const a = samples[j], b = samples[j + 1] !== undefined ? samples[j + 1] : a;
        out[i] = a * (1 - f) + b * f;
    }
    return out;
}

/** Concatenate Float32Array parts into one buffer. */
export function concatPcm(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/** A copy of pcm[a, b) scaled by `gain` (defaults: the whole buffer). */
export function gained(pcm, gain, a, b) {
    a = a == null ? 0 : a;
    b = b == null ? pcm.length : b;
    const out = new Float32Array(Math.max(0, b - a));
    for (let i = a; i < b; i++) out[i - a] = pcm[i] * gain;
    return out;
}

/** Absolute peak of pcm[a, b) after `gain` (0 for an empty range). */
export function peakOf(pcm, gain, a, b) {
    gain = gain == null ? 1 : gain;
    a = a == null ? 0 : a;
    b = b == null ? pcm.length : b;
    let pk = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(pcm[i] * gain); if (v > pk) pk = v; }
    return pk;
}

/** Average interleaved channels to mono (returns the input when channels <= 1). */
export function downmix(samples, channels, frames) {
    const ch = channels || 1;
    const n = frames != null ? frames : Math.floor(samples.length / ch);
    if (ch <= 1) return samples.length === n ? samples : samples.subarray(0, n);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += samples[i * ch + c];
        out[i] = s / ch;
    }
    return out;
}

/**
 * Decode an audio file (wav / flac / mp3 / ogg / opus, through broaudio) to
 * mono Float32 at `rate` (default: the file's own rate). Returns
 * { pcm, rate, seconds, srcRate, channels } or null when it cannot decode.
 */
export function decodeAudioFile(path, rate) {
    const dec = audioContext().decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.numFrames) return null;
    const mono = downmix(dec.samples, dec.channels || 1, dec.numFrames);
    const out = rate ? resample(mono, dec.sampleRate, rate) : mono;
    const r = rate || dec.sampleRate;
    return { pcm: out, rate: r, seconds: out.length / r, srcRate: dec.sampleRate, channels: dec.channels || 1 };
}

/**
 * Read a 16-bit PCM .wav straight off disk (no broaudio decode, so no trip
 * through the context rate), downmixed to mono and linear-resampled to
 * `rate` when given. Returns { pcm, rate, seconds, srcRate, channels }.
 */
export function readWav(path, rate) {
    const buf = require('fs').readFileSync(path);
    const u8 = new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength != null ? buf.byteLength : buf.length);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 12, ch = 1, srcRate = 16000, bits = 16, dataOff = 44, dataLen = u8.length - 44;
    while (off + 8 <= u8.length) {
        const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
        const sz = dv.getUint32(off + 4, true);
        if (id === 'fmt ') { ch = dv.getUint16(off + 10, true); srcRate = dv.getUint32(off + 12, true); bits = dv.getUint16(off + 22, true); }
        else if (id === 'data') { dataOff = off + 8; dataLen = Math.min(sz, u8.length - dataOff); break; }
        off += 8 + sz + (sz & 1);
    }
    if (bits !== 16) throw new Error('readWav: only 16-bit PCM is supported (' + path + ' is ' + bits + '-bit)');
    const n = Math.floor(dataLen / 2 / ch);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += dv.getInt16(dataOff + (i * ch + c) * 2, true);
        mono[i] = s / ch / 32768;
    }
    const pcm = rate ? resample(mono, srcRate, rate) : mono;
    const r = rate || srcRate;
    return { pcm, rate: r, seconds: pcm.length / r, srcRate, channels: ch };
}

/** Linear amplitude -> dBFS (-Infinity for silence). */
export function toDb(amp) {
    return amp > 0 ? 20 * Math.log10(amp) : -Infinity;
}

/**
 * One-shot clip playback that owns a single clip slot: each play() replaces
 * (deletes) the previous clip, so auditioning never leaks clip memory.
 * Returns { play(pcm, rate, { gain, channels }) -> seconds, stop(), clipId, playbackId }.
 */
export function clipPlayer() {
    let clip = -1, pb = -1;
    const api = {
        play(pcm, rate, opts) {
            const o = opts || {};
            if (!pcm || !pcm.length) return 0;
            const ctx = audioContext();
            api.stop();
            if (clip >= 0) { try { ctx.deleteClip(clip); } catch (e) { /* already gone */ } }
            const ch = o.channels || 1;
            clip = ctx.createClip(pcm, ch, rate || ctx.sampleRate);
            pb = ctx.playClip(clip, o.gain == null ? 1 : o.gain, false);
            return pcm.length / ch / (rate || ctx.sampleRate);
        },
        stop() {
            if (pb >= 0) { try { audioContext().stopPlayback(pb); } catch (e) { /* finished */ } }
            pb = -1;
        },
        get clipId() { return clip; },
        get playbackId() { return pb; },
    };
    return api;
}

/**
 * Write mono (or interleaved) PCM to a .wav. With `path` it writes there;
 * otherwise it asks with the native save dialog (never call that path in a
 * headless test: the dialog blocks). Appends .wav when missing.
 * opts: { path, defaultName = 'clip.wav', channels = 1 }. Returns the path, or null.
 */
export function saveWav(pcm, rate, opts) {
    const o = opts || {};
    if (!pcm || !pcm.length) return null;
    let path = o.path;
    if (!path) {
        if (typeof showSaveFileDialog !== 'function') return null;
        path = showSaveFileDialog('WAV audio|wav', o.defaultName || 'clip.wav');
    }
    if (!path) return null;
    if (!/\.wav$/i.test(path)) path += '.wav';
    const ok = audioContext().saveWav(path, pcm, o.channels || 1, rate);
    return ok ? path : null;
}

/**
 * Accumulate raw mic PCM through bro.mic (broaudio resamples to `rate`).
 * opts: { rate = 16000, chunkFrames = 160, agc = false, onChunk(chunk) }.
 * start({ live = true }) opens the device (live: false opens none; feed it
 * with bro.mic.feed at bro.mic.engineRate()). stop() returns the recording
 * as one Float32Array (null when nothing was captured).
 * Handle: start, stop, recording, seconds.
 */
export function micRecorder(opts) {
    const o = Object.assign({ rate: 16000, chunkFrames: 160, agc: false, onChunk: null }, opts);
    let chunks = [], recording = false, n = 0;
    return {
        start(startOpts) {
            if (recording) return;
            chunks = []; n = 0;
            bro.mic.start({
                chunkFrames: o.chunkFrames, targetRate: o.rate, agc: o.agc, samples: true,
                live: !(startOpts && startOpts.live === false),
                onChunk: (c) => {
                    if (c.samples) { chunks.push(c.samples.slice()); n += c.samples.length; }
                    if (o.onChunk) o.onChunk(c);
                },
            });
            recording = true;
        },
        stop() {
            if (!recording) return null;
            try { bro.mic.stop(); } catch (e) { /* already stopped */ }
            recording = false;
            const out = n ? concatPcm(chunks) : null;
            chunks = [];
            return out;
        },
        get recording() { return recording; },
        get seconds() { return n / o.rate; },
    };
}

// --- test / demo signals ------------------------------------------------------

/** Deterministic signals for tests and demos, all mono Float32 at `rate`. */
export const signal = {
    silence(sec, rate) { return new Float32Array(Math.floor(sec * rate)); },

    /** A sine with a 10 ms fade-out. */
    tone(sec, hz, amp, rate) {
        const n = Math.floor(sec * rate), fade = Math.floor(0.01 * rate);
        const s = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const g = i >= n - fade ? (n - i) / fade : 1;
            s[i] = g * amp * Math.sin(2 * Math.PI * hz * i / rate);
        }
        return s;
    },

    /** A linear frequency sweep hz0 -> hz1 with a 10 ms fade-out. */
    sweep(sec, hz0, hz1, amp, rate) {
        const n = Math.floor(sec * rate), fade = Math.floor(0.01 * rate);
        const s = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
            ph += 2 * Math.PI * (hz0 + (hz1 - hz0) * (i / Math.max(1, n - 1))) / rate;
            const g = i >= n - fade ? (n - i) / fade : 1;
            s[i] = amp * g * Math.sin(ph);
        }
        return s;
    },

    /** `n` 5 ms noise bursts, each followed by `gapSec` of silence (seeded, repeatable). */
    clicks(n, gapSec, amp, rate) {
        const parts = [];
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
        for (let k = 0; k < n; k++) {
            const burst = new Float32Array(Math.floor(0.005 * rate));
            for (let i = 0; i < burst.length; i++) burst[i] = amp * rnd() * (1 - i / burst.length);
            parts.push(burst, signal.silence(gapSec, rate));
        }
        return concatPcm(parts);
    },

    concat: (...parts) => concatPcm(parts),
};
