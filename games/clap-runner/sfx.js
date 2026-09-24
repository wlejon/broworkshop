// sfx.js — Clap Runner's synthesized sounds on the shell's AudioContext.
//
// bro's AudioContext plays oscillators and buffer sources straight to the
// master bus; GainNodes on a source's path stay live, so one master GainNode
// is the volume / mute knob. BiquadFilterNodes are master-bus effects in bro
// (they would filter every sound), so the noise bursts are filtered here in
// JS before they become buffers, and the tonal cues use mellow waveforms.

const BASE_GAIN = 0.5;

export function createSfx(getCtx) {
    let ctx = null;
    let master = null;
    let volume = 0.8;
    let muted = false;
    let glide = null;           // { osc, gain }

    function ready() {
        if (master) return true;
        ctx = getCtx();
        if (!ctx) return false;
        try {
            master = ctx.createGain();
            master.connect(ctx.destination);
            applyGain();
            return true;
        } catch (e) {
            master = null;
            return false;
        }
    }

    function applyGain() {
        if (master) master.gain.value = muted ? 0 : BASE_GAIN * volume;
    }

    /** Oscillator with a pitch sweep and an exponential decay. */
    function blip(type, f0, f1, vol, dur, at, linear) {
        const t = ctx.currentTime + (at || 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t);
        if (f1 && f1 !== f0) {
            if (linear) osc.frequency.linearRampToValueAtTime(f1, t + dur * 0.8);
            else osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
        }
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.02);
    }

    /** Decaying noise through a swept RBJ biquad (lowpass or bandpass), as a buffer. */
    function noise(dur, vol, shape, filter) {
        const rate = ctx.sampleRate;
        const n = Math.floor(rate * dur);
        const buf = ctx.createBuffer(1, n, rate);
        const data = buf.getChannelData(0);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
        for (let i = 0; i < n; i++) {
            if ((i & 31) === 0) {
                const f = filter.f0 * Math.pow(filter.f1 / filter.f0, Math.min(1, i / (rate * filter.sweep)));
                const w = 2 * Math.PI * f / rate;
                const alpha = Math.sin(w) / (2 * filter.q);
                const a0 = 1 + alpha;
                if (filter.type === "bandpass") {
                    b0 = alpha / a0; b1 = 0; b2 = -alpha / a0;
                } else {
                    b0 = (1 - Math.cos(w)) / 2 / a0; b1 = (1 - Math.cos(w)) / a0; b2 = b0;
                }
                a1 = -2 * Math.cos(w) / a0;
                a2 = (1 - alpha) / a0;
            }
            const x = (Math.random() * 2 - 1) * Math.pow(1 - i / n, shape);
            const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = x; y2 = y1; y1 = y;
            data[i] = y;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = vol;
        src.connect(g);
        g.connect(master);
        src.start();
    }

    const SOUNDS = {
        jump() { blip("sine", 220, 660, 0.4, 0.2); },
        superJump() {
            blip("triangle", 300, 1200, 0.5, 0.32);
            blip("sine", 140, 40, 0.6, 0.28);
        },
        slide() { noise(0.22, 0.9, 1, { type: "bandpass", f0: 1400, f1: 400, sweep: 0.2, q: 3 }); },
        coin() {
            blip("sine", 987.77, 0, 0.3, 0.14);
            blip("sine", 1318.51, 0, 0.3, 0.14, 0.055);
        },
        multiplier() {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip("triangle", f, 0, 0.25, 0.22, i * 0.04));
        },
        shield() { blip("sine", 300, 900, 0.35, 0.25, 0, true); },
        crash() { noise(0.4, 0.8, 1.5, { type: "lowpass", f0: 1000, f1: 100, sweep: 0.35, q: 0.707 }); },
        gameOver() {
            [440, 415.3, 392, 349.23].forEach((f, i) => blip("triangle", f, 0, 0.35, 0.2, i * 0.12));
        },
        glideStart() {
            if (glide) return;
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(440, t);
            osc.frequency.linearRampToValueAtTime(520, t + 0.3);
            gain.gain.setValueAtTime(0.01, t);
            gain.gain.linearRampToValueAtTime(0.22, t + 0.08);
            osc.connect(gain);
            gain.connect(master);
            osc.start(t);
            glide = { osc, gain };
        },
        glideStop() {
            if (!glide) return;
            const t = ctx.currentTime;
            try {
                glide.gain.gain.linearRampToValueAtTime(0.001, t + 0.08);
                glide.osc.stop(t + 0.09);
            } catch (e) { /* already stopped */ }
            glide = null;
        },
    };

    return {
        /** Play a named cue; unknown names are ignored. */
        play(name) {
            const fn = SOUNDS[name];
            if (!fn || (muted && name !== "glideStop") || !ready()) return false;
            try { fn(); } catch (e) { return false; }
            return true;
        },
        setVolume(v) { volume = Math.max(0, Math.min(1, v)); applyGain(); },
        setMuted(m) {
            muted = !!m;
            if (muted) SOUNDS.glideStop();
            applyGain();
        },
        get muted() { return muted; },
        get gliding() { return !!glide; },
    };
}
