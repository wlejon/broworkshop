// audio/mic.js — the microphone as a monitored, effect-processed input.
//
// getUserMedia starts engine capture; the mic is heard (ctx.micMuted false)
// at micMonitorGain through the mic signal's own bus (song.enableMicSignal
// sets ctx.micBus). An analyser on the mic ring gives the level meter, the
// scope and a spectral-peak pitch estimate.

import { hzToNote } from "./notes.js";

export function createMic(ctx) {
    let analyser = null, freq = null, time = null;
    let enabled = false, volume = 0.5, opening = null;

    const api = {
        /** Start capture once. Resolves true when the mic is available. */
        open() {
            if (analyser) return Promise.resolve(true);
            if (!ctx || !navigator.mediaDevices) return Promise.resolve(false);
            if (!opening) {
                opening = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
                    analyser = ctx.createAnalyser();
                    analyser.fftSize = 2048;
                    analyser.smoothingTimeConstant = 0.8;
                    ctx.createMediaStreamSource(stream).connect(analyser);
                    analyser.source = 1;
                    freq = new Uint8Array(analyser.frequencyBinCount);
                    time = new Float32Array(analyser.fftSize);
                    ctx.micMuted = true;
                    ctx.micMonitorGain = volume;
                    return true;
                }, () => { opening = null; return false; });
            }
            return opening;
        },

        get available() { return !!analyser; },
        get enabled() { return enabled; },

        /** Hear the mic (through its bus) or mute it. */
        setEnabled(on) {
            enabled = !!on && !!analyser;
            if (ctx) ctx.micMuted = !enabled;
        },

        get volume() { return volume; },
        setVolume(v) {
            volume = v;
            if (ctx && analyser) ctx.micMonitorGain = v;
        },

        /** Average spectrum level, 0..1 (0 while muted). */
        level() {
            if (!enabled || !analyser) return 0;
            analyser.getByteFrequencyData(freq);
            let sum = 0;
            for (let i = 0; i < freq.length; i += 4) sum += freq[i];
            return sum / (freq.length / 4) / 255;
        },

        /** The latest time-domain window, or null. */
        waveform() {
            if (!enabled || !analyser) return null;
            analyser.getFloatTimeDomainData(time);
            return time;
        },

        /**
         * Strongest spectral peak between 60 Hz and 1.5 kHz, refined by
         * parabolic interpolation: { hz, name, cents } or null.
         */
        pitch() {
            if (!enabled || !analyser) return null;
            analyser.getByteFrequencyData(freq);
            const binHz = ctx.sampleRate / analyser.fftSize;
            const lo = Math.max(1, Math.floor(60 / binHz)), hi = Math.min(freq.length - 2, Math.ceil(1500 / binHz));
            let best = lo;
            for (let i = lo; i <= hi; i++) if (freq[i] > freq[best]) best = i;
            if (freq[best] < 20) return null;
            const a = freq[best - 1], b = freq[best], c = freq[best + 1];
            const den = a - 2 * b + c;
            const hz = (best + (den ? 0.5 * (a - c) / den : 0)) * binHz;
            if (!(hz > 50 && hz < 2000)) return null;
            return Object.assign({ hz }, hzToNote(hz));
        },
    };
    return api;
}
