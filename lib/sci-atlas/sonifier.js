// Spatialized polyphonic scientific sonification via broaudio AudioContext.
// Gracefully degrades to a silent no-op if audio device is unavailable (e.g. headless).

export class SpatialSonifier {
    constructor(opts = {}) {
        this.enabled = false;
        this.ctx = null;
        this.bus = null;
        this.lastTriggerMs = 0;
        this.cooldownMs = opts.cooldownMs ?? 120;
    }

    ensureContext() {
        if (this.ctx) return true;
        if (typeof AudioContext === 'undefined') return false;
        try {
            const ctx = new AudioContext();
            ctx.masterGain = 0.7;
            const bus = ctx.createBus();
            ctx.setBusReverbEnabled(bus, true);
            ctx.setBusReverbRoomSize(bus, 0.78);
            ctx.setBusReverbDamping(bus, 0.35);
            ctx.setBusReverbMix(bus, 0.42);
            this.ctx = ctx;
            this.bus = bus;
            return true;
        } catch (_) {
            return false;
        }
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (this.enabled) this.ensureContext();
    }

    playChord(notes) {
        if (!this.enabled || !notes || notes.length === 0) return;
        const nowMs = Date.now();
        if (nowMs - this.lastTriggerMs < this.cooldownMs) return;
        this.lastTriggerMs = nowMs;
        if (!this.ensureContext()) return;

        const ctx = this.ctx;
        const baseT = ctx.currentTime || 0;
        const count = Math.min(notes.length, 6);
        for (let i = 0; i < count; i++) {
            const n = notes[i];
            try {
                const v = ctx.createVoice();
                ctx.setVoiceWaveform(v, n.waveform || 'sine');
                ctx.setVoiceFrequency(v, Math.max(40, Math.min(4000, n.freq || 220)));
                ctx.setVoiceGain(v, Math.max(0.01, Math.min(0.28, (n.gain ?? 0.14) / count)));
                ctx.setVoiceAttack(v, n.attack ?? 0.04);
                ctx.setVoiceDecay(v, n.decay ?? 0.18);
                ctx.setVoiceSustain(v, n.sustain ?? 0.25);
                ctx.setVoiceRelease(v, n.release ?? 0.65);
                if (this.bus != null) ctx.setVoiceBus(v, this.bus);
                if (n.pos) {
                    ctx.setVoiceSpatialEnabled(v, true);
                    ctx.setVoiceSpatialPosition(v, n.pos[0], n.pos[1], n.pos[2]);
                    ctx.setVoiceSpatialRefDistance(v, 1.5);
                    ctx.setVoiceSpatialMaxDistance(v, 24.0);
                }
                const tOn = baseT + i * 0.025;
                ctx.startVoice(v, tOn);
                ctx.stopVoice(v, tOn + (n.dur ?? 0.45));
            } catch (_) {}
        }
    }

    dispose() {
        try {
            if (this.ctx && this.ctx.close) this.ctx.close();
        } catch (_) {}
        this.ctx = null;
        this.bus = null;
    }
}
