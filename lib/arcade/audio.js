// Arcade kernel — short SFX tones over bro AudioContext buses.
// Degrades silently when AudioContext is unavailable.

/**
 * @param {object} [opts]
 * @param {number} [opts.sfxVol]
 * @param {number} [opts.musicVol]
 */
export function createAudio(opts = {}) {
    const state = {
        ctx: null,
        sfxBus: -1,
        musicBus: -1,
        sfxVol: opts.sfxVol != null ? opts.sfxVol : 1,
        musicVol: opts.musicVol != null ? opts.musicVol : 1,
        ready: false,
    };

    function init() {
        if (state.ready) return !!state.ctx;
        state.ready = true;
        try { state.ctx = new AudioContext(); }
        catch (e) {
            state.ctx = null;
            return false;
        }
        try {
            state.sfxBus = state.ctx.createBus();
            state.musicBus = state.ctx.createBus();
            state.ctx.setBusGain(state.sfxBus, state.sfxVol);
            state.ctx.setBusGain(state.musicBus, state.musicVol);
            state.ctx.setCompressorEnabled(true);
            state.ctx.setCompressorThreshold(-12);
            state.ctx.setCompressorRatio(3);
        } catch (e) {
            state.sfxBus = -1;
            state.musicBus = -1;
        }
        return true;
    }

    /**
     * @param {number} freq
     * @param {number} duration
     * @param {string} [type]
     * @param {number} [vol]
     */
    function tone(freq, duration, type, vol) {
        const ctx = state.ctx;
        if (!ctx) return;
        const v = vol != null ? vol : 1;
        if (v <= 0) return;
        try {
            const id = ctx.createVoice();
            ctx.setVoiceWaveform(id, type || "square");
            if (freq > 0) ctx.setVoiceFrequency(id, freq);
            ctx.setVoiceGain(id, v * 15);
            ctx.setVoiceAttack(id, 0.003);
            ctx.setVoiceDecay(id, Math.max(0.01, duration * 0.8));
            ctx.setVoiceSustain(id, 0);
            ctx.setVoiceRelease(id, 0.02);
            if (state.sfxBus !== -1) ctx.setVoiceBus(id, state.sfxBus);
            const t = ctx.currentTime;
            ctx.startVoice(id, t);
            ctx.stopVoice(id, t + duration);
        } catch (e) { /* ignore */ }
    }

    /**
     * @param {Array<[number, number, string?, number?]>} notes
     */
    function sequence(notes) {
        let acc = 0;
        for (const n of notes) {
            const [f, d, t, v] = n;
            setTimeout(() => tone(f, d, t, v), acc * 1000);
            acc += d;
        }
    }

    function setSfxVol(v) {
        state.sfxVol = Math.max(0, Math.min(1, v));
        if (state.ctx && state.sfxBus !== -1) {
            try { state.ctx.setBusGain(state.sfxBus, state.sfxVol); }
            catch (e) { /* ignore */ }
        }
    }

    return {
        init,
        tone,
        sequence,
        setSfxVol,
        ctx: () => state.ctx,
    };
}
