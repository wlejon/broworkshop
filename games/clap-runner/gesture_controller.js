// gesture_controller.js — Acoustic gesture recognition & input controller
//
// Bridges bro.gesture, bro.sense, and bro.mic into game action triggers:
//   - Single Clap / Sharp Transient -> Jump
//   - Double Clap (120-420ms window) -> Super Jump
//   - Whistle / High Tone (>750 Hz) -> Hover Glide
//   - Snap / Low Transient -> Slide Dash
// Includes real-time audio telemetry and full keyboard fallback.

export class GestureController {
    constructor(callbacks = {}) {
        this.onAction = callbacks.onAction || (() => {});
        this.onActionEnd = callbacks.onActionEnd || (() => {});
        this.onTelemetry = callbacks.onTelemetry || (() => {});

        this.micActive = false;
        this.mode = 'idle'; // 'bro', 'webaudio', 'keyboard'

        // Detection thresholds
        this.clapThreshold = 0.28;
        this.whistleMinHz = 700;
        this.whistleMaxHz = 3200;
        this.whistleStabilityThreshold = 0.08;

        // Acoustic telemetry snapshot
        this.telemetry = {
            vad: false,
            energy: 0,
            tonal: false,
            pitchHz: 0,
            onsets: 0,
            lastGesture: 'None',
            confidence: 0,
            isGliding: false,
            isSliding: false
        };

        // State tracking
        this.lastOnsetTime = 0;
        this.pendingSingleClapTimer = null;
        this.whistleHoldFrames = 0;
        this.glideActive = false;
        this.slideActive = false;

        // WebAudio Fallback objects
        this.audioStream = null;
        this.audioCtx = null;
        this.analyser = null;
        this.timeDomainBuffer = null;
        this.freqBuffer = null;
        this.animFrameId = null;

        // Keyboard tracking
        this.keysDown = {};
        this.lastKeyTime = {};

        this._setupKeyboardListeners();
    }

    async startMic() {
        if (this.micActive) return true;

        // 1. Try native bro runtime API
        if (typeof bro !== 'undefined' && bro.sense && bro.gesture && bro.mic) {
            try {
                this._initBroAcousticEngine();
                this.micActive = true;
                this.mode = 'bro';
                return true;
            } catch (e) {
                console.warn('Native bro acoustic engine failed, falling back to WebAudio:', e);
            }
        }

        // 2. Fallback: WebAudio Analyser
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });
                this.audioStream = stream;
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                this.audioCtx = new AudioCtxClass();
                const source = this.audioCtx.createMediaStreamSource(stream);
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 1024;
                this.analyser.smoothingTimeConstant = 0.2;
                source.connect(this.analyser);

                this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
                this.freqBuffer = new Float32Array(this.analyser.frequencyBinCount);

                this.micActive = true;
                this.mode = 'webaudio';
                this._startWebAudioLoop();
                return true;
            }
        } catch (err) {
            console.warn('Microphone access denied or unavailable:', err);
        }

        this.mode = 'keyboard';
        return false;
    }

    stopMic() {
        if (!this.micActive) return;

        if (this.mode === 'bro' && typeof bro !== 'undefined') {
            try { if (bro.mic && bro.mic.stop) bro.mic.stop(); } catch (e) {}
            try { if (bro.gesture && bro.gesture.stop) bro.gesture.stop(); } catch (e) {}
        } else if (this.mode === 'webaudio') {
            if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
                this.audioStream = null;
            }
            if (this.audioCtx) {
                this.audioCtx.close().catch(() => {});
                this.audioCtx = null;
            }
        }

        this.micActive = false;
        this.mode = 'keyboard';
        this._resetActionStates();
    }

    _initBroAcousticEngine() {
        // Start bro.mic capture
        bro.mic.start({
            chunkFrames: 160,
            targetRate: 16000,
            agc: false,
            samples: true,
            onChunk: (chunk) => {
                this._processBroChunk(chunk);
            }
        });

        // Listen for gesture templates if available
        if (bro.gesture && bro.gesture.listen) {
            try {
                bro.gesture.listen({
                    onGesture: (name, conf, kind) => {
                        this._handleGestureMatch(name, conf, kind);
                    }
                });
            } catch (e) {}
        }
    }

    _processBroChunk(chunk) {
        if (!chunk) return;
        const peak = chunk.peak || 0;
        const now = performance.now();

        let tonal = false;
        let pitchHz = 0;
        let vad = false;

        if (bro.sense && bro.sense.snapshot) {
            try {
                const snap = bro.sense.snapshot();
                vad = snap.vadActive || (peak > 0.08);
                tonal = snap.tonalEvents > 0 || snap.isTonal;
                pitchHz = snap.dominantHz || 0;
            } catch (e) {}
        } else {
            vad = peak > 0.08;
        }

        this.telemetry.energy = peak;
        this.telemetry.vad = vad;
        this.telemetry.tonal = tonal;
        this.telemetry.pitchHz = pitchHz;

        // Transient energy detection for claps/taps
        if (peak > this.clapThreshold) {
            this._registerOnset(now, peak);
        }

        // Tonal detection for whistle/glide
        if (tonal && pitchHz >= this.whistleMinHz && pitchHz <= this.whistleMaxHz) {
            this.whistleHoldFrames++;
            if (this.whistleHoldFrames >= 3 && !this.glideActive) {
                this.glideActive = true;
                this.telemetry.lastGesture = 'WHISTLE (GLIDE)';
                this.telemetry.confidence = 0.92;
                this.onAction('glide', { pitchHz });
            }
        } else {
            if (this.whistleHoldFrames > 0) this.whistleHoldFrames--;
            if (this.whistleHoldFrames === 0 && this.glideActive) {
                this.glideActive = false;
                this.onActionEnd('glide');
            }
        }

        this.onTelemetry(this.telemetry);
    }

    _startWebAudioLoop() {
        const loop = () => {
            if (!this.micActive || this.mode !== 'webaudio') return;

            this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
            this.analyser.getFloatFrequencyData(this.freqBuffer);

            // 1. Calculate RMS Energy & Peak
            let sumSq = 0;
            let peak = 0;
            for (let i = 0; i < this.timeDomainBuffer.length; i++) {
                const val = Math.abs(this.timeDomainBuffer[i]);
                if (val > peak) peak = val;
                sumSq += val * val;
            }
            const rms = Math.sqrt(sumSq / this.timeDomainBuffer.length);
            const energy = Math.min(1.0, peak * 1.8);

            // 2. Frequency Peak Analysis (Pitch & Tonality)
            const sampleRate = this.audioCtx.sampleRate;
            const binSize = sampleRate / this.analyser.fftSize;
            let maxDb = -Infinity;
            let peakBin = 0;
            const minBin = Math.floor(this.whistleMinHz / binSize);
            const maxBin = Math.min(this.freqBuffer.length - 1, Math.floor(this.whistleMaxHz / binSize));

            for (let b = minBin; b <= maxBin; b++) {
                if (this.freqBuffer[b] > maxDb) {
                    maxDb = this.freqBuffer[b];
                    peakBin = b;
                }
            }

            const pitchHz = peakBin * binSize;
            const isTonal = maxDb > -48 && (maxDb - this._calculateSpectralFloor()) > 15;
            const vad = energy > 0.05;
            const now = performance.now();

            this.telemetry.energy = energy;
            this.telemetry.vad = vad;
            this.telemetry.tonal = isTonal;
            this.telemetry.pitchHz = isTonal ? Math.round(pitchHz) : 0;

            // Transient detection (Clap / Tap)
            if (peak > this.clapThreshold) {
                this._registerOnset(now, peak);
            }

            // Whistle detection (Glide)
            if (isTonal && pitchHz >= this.whistleMinHz && pitchHz <= this.whistleMaxHz) {
                this.whistleHoldFrames++;
                if (this.whistleHoldFrames >= 4 && !this.glideActive) {
                    this.glideActive = true;
                    this.telemetry.lastGesture = 'WHISTLE (GLIDE)';
                    this.telemetry.confidence = Math.min(0.98, Math.max(0.6, (maxDb + 50) / 30));
                    this.onAction('glide', { pitchHz: Math.round(pitchHz) });
                }
            } else {
                if (this.whistleHoldFrames > 0) this.whistleHoldFrames -= 2;
                if (this.whistleHoldFrames <= 0) {
                    this.whistleHoldFrames = 0;
                    if (this.glideActive) {
                        this.glideActive = false;
                        this.onActionEnd('glide');
                    }
                }
            }

            this.onTelemetry(this.telemetry);
            this.animFrameId = requestAnimationFrame(loop);
        };

        this.animFrameId = requestAnimationFrame(loop);
    }

    _calculateSpectralFloor() {
        let sum = 0;
        const count = this.freqBuffer.length;
        for (let i = 0; i < count; i++) {
            sum += this.freqBuffer[i];
        }
        return sum / count;
    }

    _registerOnset(now, strength) {
        // Debounce onsets within 90ms
        if (now - this.lastOnsetTime < 90) return;

        const timeSinceLast = now - this.lastOnsetTime;
        this.lastOnsetTime = now;
        this.telemetry.onsets++;

        // Check if this is a Double Clap (second clap between 110ms and 400ms)
        if (timeSinceLast >= 110 && timeSinceLast <= 400 && this.pendingSingleClapTimer) {
            clearTimeout(this.pendingSingleClapTimer);
            this.pendingSingleClapTimer = null;
            this.telemetry.lastGesture = 'DOUBLE CLAP (SUPER JUMP)';
            this.telemetry.confidence = 0.95;
            this.onAction('superJump', { interval: Math.round(timeSinceLast), strength });
            return;
        }

        // Otherwise buffer as a single clap with a short window for double-clap inspection
        if (this.pendingSingleClapTimer) {
            clearTimeout(this.pendingSingleClapTimer);
        }

        this.pendingSingleClapTimer = setTimeout(() => {
            this.pendingSingleClapTimer = null;
            this.telemetry.lastGesture = 'SINGLE CLAP (JUMP)';
            this.telemetry.confidence = 0.90;
            this.onAction('jump', { strength });
        }, 130);
    }

    _handleGestureMatch(name, conf, kind) {
        const lower = (name || '').toLowerCase();
        if (lower.includes('double') || lower.includes('super')) {
            this.telemetry.lastGesture = `MATCH: ${name}`;
            this.telemetry.confidence = conf;
            this.onAction('superJump', { conf });
        } else if (lower.includes('whistle') || lower.includes('tone')) {
            this.telemetry.lastGesture = `MATCH: ${name}`;
            this.telemetry.confidence = conf;
            this.onAction('glide', { conf });
        } else if (lower.includes('slide') || lower.includes('snap') || lower.includes('tap')) {
            this.telemetry.lastGesture = `MATCH: ${name}`;
            this.telemetry.confidence = conf;
            this.onAction('slide', { conf });
        } else {
            this.telemetry.lastGesture = `MATCH: ${name}`;
            this.telemetry.confidence = conf;
            this.onAction('jump', { conf });
        }
    }

    _setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const code = e.code;
            const now = performance.now();
            this.keysDown[code] = true;

            if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
                const lastT = this.lastKeyTime[code] || 0;
                this.lastKeyTime[code] = now;

                if (now - lastT > 80 && now - lastT < 350) {
                    this.telemetry.lastGesture = 'KEY: SUPER JUMP (Double Tap)';
                    this.telemetry.confidence = 1.0;
                    this.onAction('superJump', { source: 'keyboard' });
                } else {
                    this.telemetry.lastGesture = 'KEY: JUMP';
                    this.telemetry.confidence = 1.0;
                    this.onAction('jump', { source: 'keyboard' });
                }
                e.preventDefault();
            } else if (code === 'KeyE') {
                this.glideActive = true;
                this.telemetry.lastGesture = 'KEY: GLIDE (Hold E)';
                this.telemetry.confidence = 1.0;
                this.onAction('glide', { source: 'keyboard' });
                e.preventDefault();
            } else if (code === 'ArrowDown' || code === 'KeyS') {
                this.slideActive = true;
                this.telemetry.lastGesture = 'KEY: SLIDE DASH';
                this.telemetry.confidence = 1.0;
                this.onAction('slide', { source: 'keyboard' });
                e.preventDefault();
            }
        });

        window.addEventListener('keyup', (e) => {
            const code = e.code;
            this.keysDown[code] = false;

            if (code === 'KeyE' || code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
                if (this.glideActive && !this.keysDown['KeyE']) {
                    this.glideActive = false;
                    this.onActionEnd('glide');
                }
            }
            if (code === 'ArrowDown' || code === 'KeyS') {
                if (this.slideActive) {
                    this.slideActive = false;
                    this.onActionEnd('slide');
                }
            }
        });
    }

    _resetActionStates() {
        if (this.glideActive) {
            this.glideActive = false;
            this.onActionEnd('glide');
        }
        if (this.slideActive) {
            this.slideActive = false;
            this.onActionEnd('slide');
        }
    }
}
