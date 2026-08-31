// audio_sfx.js — Web Audio procedural synthesizer for Clap Runner
//
// Generates all game sound effects and ambient rhythm pulses synthetically
// using the Web Audio API without requiring any external audio files.

let audioCtx = null;
let masterGainNode = null;
let isMuted = false;
let glideOsc = null;
let glideGain = null;

export function initAudio() {
    if (audioCtx) return true;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        audioCtx = new AudioContextClass();
        masterGainNode = audioCtx.createGain();
        masterGainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        masterGainNode.connect(audioCtx.destination);
        return true;
    } catch (e) {
        console.warn('AudioContext initialization failed:', e);
        return false;
    }
}

export function ensureAudio() {
    if (!audioCtx) initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
}

export function setMuted(mute) {
    isMuted = !!mute;
    if (masterGainNode && audioCtx) {
        masterGainNode.gain.setValueAtTime(isMuted ? 0 : 0.5, audioCtx.currentTime);
    }
}

export function toggleMute() {
    setMuted(!isMuted);
    return isMuted;
}

export function playJump() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.16);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(masterGainNode);

        osc.start(t);
        osc.stop(t + 0.2);
    } catch (e) {}
}

export function playSuperJump() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        
        // High sweep
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(300, t);
        osc1.frequency.exponentialRampToValueAtTime(1200, t + 0.28);
        gain1.gain.setValueAtTime(0.5, t);
        gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        osc1.connect(gain1);
        gain1.connect(masterGainNode);
        osc1.start(t);
        osc1.stop(t + 0.32);

        // Sub pulse
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(140, t);
        osc2.frequency.exponentialRampToValueAtTime(40, t + 0.25);
        gain2.gain.setValueAtTime(0.6, t);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc2.connect(gain2);
        gain2.connect(masterGainNode);
        osc2.start(t);
        osc2.stop(t + 0.28);
    } catch (e) {}
}

export function startGlideSound() {
    if (isMuted || !audioCtx || glideOsc) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        glideOsc = audioCtx.createOscillator();
        glideGain = audioCtx.createGain();

        glideOsc.type = 'sawtooth';
        glideOsc.frequency.setValueAtTime(440, t);
        glideOsc.frequency.linearRampToValueAtTime(520, t + 0.3);

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, t);

        glideGain.gain.setValueAtTime(0.01, t);
        glideGain.gain.linearRampToValueAtTime(0.18, t + 0.08);

        glideOsc.connect(filter);
        filter.connect(glideGain);
        glideGain.connect(masterGainNode);

        glideOsc.start(t);
    } catch (e) {}
}

export function stopGlideSound() {
    if (!audioCtx || !glideOsc || !glideGain) return;
    try {
        const t = audioCtx.currentTime;
        glideGain.gain.linearRampToValueAtTime(0.001, t + 0.08);
        glideOsc.stop(t + 0.09);
    } catch (e) {}
    glideOsc = null;
    glideGain = null;
}

export function playSlide() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const bufLen = Math.floor(audioCtx.sampleRate * 0.22);
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, t);
        filter.frequency.exponentialRampToValueAtTime(400, t + 0.2);
        filter.Q.setValueAtTime(3.0, t);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.45, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGainNode);

        noise.start(t);
    } catch (e) {}
}

export function playCoin() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const notes = [987.77, 1318.51]; // B5, E6
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const startT = t + idx * 0.055;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startT);

            gain.gain.setValueAtTime(0.3, startT);
            gain.gain.exponentialRampToValueAtTime(0.001, startT + 0.14);

            osc.connect(gain);
            gain.connect(masterGainNode);

            osc.start(startT);
            osc.stop(startT + 0.15);
        });
    } catch (e) {}
}

export function playMultiplier() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const chord = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, C
        chord.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const startT = t + idx * 0.04;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startT);

            gain.gain.setValueAtTime(0.25, startT);
            gain.gain.exponentialRampToValueAtTime(0.001, startT + 0.22);

            osc.connect(gain);
            gain.connect(masterGainNode);

            osc.start(startT);
            osc.stop(startT + 0.24);
        });
    } catch (e) {}
}

export function playShield() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.linearRampToValueAtTime(900, t + 0.2);

        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

        osc.connect(gain);
        gain.connect(masterGainNode);

        osc.start(t);
        osc.stop(t + 0.25);
    } catch (e) {}
}

export function playCrash() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const bufLen = Math.floor(audioCtx.sampleRate * 0.4);
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.5);
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + 0.35);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGainNode);

        noise.start(t);
    } catch (e) {}
}

export function playGameOver() {
    if (isMuted || !audioCtx) return;
    ensureAudio();
    try {
        const t = audioCtx.currentTime;
        const notes = [440, 415.3, 392, 349.23]; // A, Ab, G, F
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const startT = t + idx * 0.12;

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, startT);

            const filter = audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, startT);

            gain.gain.setValueAtTime(0.3, startT);
            gain.gain.exponentialRampToValueAtTime(0.001, startT + 0.2);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(masterGainNode);

            osc.start(startT);
            osc.stop(startT + 0.22);
        });
    } catch (e) {}
}
