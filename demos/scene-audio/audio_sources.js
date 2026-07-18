// audio_sources.js — every sound in this app is synthesized at load time.
//
// The app ships no audio assets on purpose: the point of the demo is what the
// SCENE does to a sound, not the sound itself, and a procedurally generated
// clip makes the Doppler shift far easier to hear than a busy recording would.
//
// All the looping clips are built so their period divides the clip length
// exactly — every partial frequency is an integer number of cycles per clip —
// which makes the loop point sample-continuous with no crossfade. That matters
// here: a loop click every two seconds reads as a Doppler artifact and would
// discredit the very thing the app is showing.
//
// CHUNK 2: an Ogg Vorbis asset loaded through ctx.createClipFromFileAsync()
// belongs beside these, so the async decode path can be A/B'd against the
// synthesized clips; a long ambience bed belongs on ctx.createStreamFromFile().

/**
 * Render `seconds` of mono audio at the engine rate and hand it to broaudio.
 * @returns {{id:number, seconds:number}} clip handle plus its exact duration
 */
function makeClip(ctx, seconds, fn) {
    const sr = ctx.sampleRate;
    const n = Math.round(seconds * sr);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = fn(i / sr, i / n);
    return { id: ctx.createClip(buf, 1), seconds: n / sr };
}

// Deterministic noise: a plain LCG rather than Math.random, so two runs of the
// smoke test render bit-identical audio and the tests can compare exact levels.
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

const TAU = Math.PI * 2;

/**
 * Build every clip the app plays. Frequencies are chosen per clip so that
 * freq * seconds is a whole number.
 */
export function buildClips(ctx) {
    // --- Car: a 2 s engine loop. A saw-like harmonic stack on a 52 Hz
    // fundamental with a slow load wobble, so it has enough harmonic content
    // above 1 kHz for the head model and the Doppler shift to bite on.
    const car = makeClip(ctx, 2.0, (t) => {
        let v = 0;
        for (let h = 1; h <= 12; h++) v += Math.sin(TAU * 52 * h * t) / h;
        const wobble = 0.85 + 0.15 * Math.sin(TAU * 2 * t);   // 2 Hz = 4 cycles
        return 0.30 * v * wobble;
    });

    // --- Bee: 1 s of buzz. A square-ish 190 Hz tone amplitude-modulated at
    // 14 Hz — tight, bright, and very easy to localize as it circles.
    const bee = makeClip(ctx, 1.0, (t) => {
        let v = 0;
        for (let h = 1; h <= 9; h += 2) v += Math.sin(TAU * 190 * h * t) / h;
        return 0.26 * v * (0.55 + 0.45 * Math.sin(TAU * 14 * t));
    });

    // --- Machine: 1 s of stationary hum. Mains-ish 60 Hz with harmonics plus
    // a faint 1560 Hz whine, the reference point the moving sources are heard
    // against — it never Dopplers, so any pitch wobble you hear is elsewhere.
    const machine = makeClip(ctx, 1.0, (t) => {
        const hum = Math.sin(TAU * 60 * t)
                  + 0.45 * Math.sin(TAU * 120 * t)
                  + 0.22 * Math.sin(TAU * 180 * t);
        const whine = 0.07 * Math.sin(TAU * 1560 * t);
        return 0.30 * hum + whine;
    });

    // --- Bird: 2 s, two swept chirps and silence between them. The silence is
    // deliberate — an intermittent source makes distance attenuation obvious
    // in a way a continuous drone masks.
    const bird = makeClip(ctx, 2.0, (t) => {
        const chirp = (start, dur, f0, f1) => {
            const u = (t - start) / dur;
            if (u < 0 || u > 1) return 0;
            const f = f0 + (f1 - f0) * u;
            const env = Math.sin(Math.PI * u);
            return env * env * Math.sin(TAU * f * (t - start));
        };
        return 0.42 * (chirp(0.05, 0.16, 2200, 3500) + chirp(0.85, 0.13, 3100, 2400));
    });

    // --- Jet: 2 s turbine for the flyby. A dense stack of near-inharmonic
    // partials over a 44 Hz fundamental plus band-limited noise, giving broad
    // spectral content so the pitch shift reads as a whole-sound sweep rather
    // than one sliding tone. The noise is windowed into a whole number of
    // cycles by shaping it with the same 44 Hz period.
    const jetNoise = lcg(0x5EED);
    let nz = 0;
    const jet = makeClip(ctx, 2.0, (t) => {
        let v = 0;
        for (let h = 1; h <= 16; h++) v += Math.sin(TAU * 44 * h * t + h * 1.7) / (h * 0.8 + 1);
        nz = nz * 0.86 + jetNoise() * 0.14;                  // one-pole pinking
        const shape = 0.5 + 0.5 * Math.sin(TAU * 22 * t);    // 44 whole cycles
        return 0.34 * v + 0.30 * nz * shape;
    });

    // --- Music: the transport subject. 24 s is long enough that scrubbing is
    // meaningful, and each 4 s section changes chord and register so a seek
    // lands somewhere audibly different — you can HEAR that seekPlayback moved,
    // not just watch a number change.
    const chords = [
        [55, 65.41, 82.41], [49, 61.74, 73.42], [43.65, 55, 65.41], [36.71, 46.25, 55],
        [55, 65.41, 82.41], [61.74, 73.42, 92.50],
    ];
    const music = makeClip(ctx, 24.0, (t) => {
        const section = Math.min(chords.length - 1, Math.floor(t / 4));
        const chord = chords[section];
        // Pad: the chord an octave up, gently detuned for movement.
        let pad = 0;
        for (let i = 0; i < chord.length; i++) {
            pad += Math.sin(TAU * chord[i] * 4 * t + i)
                 + 0.6 * Math.sin(TAU * chord[i] * 6 * t + i * 2.1);
        }
        // Arpeggio: one plucked note every 250 ms, climbing through the chord
        // and rising a register each section, so position in the track is
        // audible at a glance.
        const step = Math.floor(t / 0.25);
        const phase = (t / 0.25) % 1;
        const note = chord[step % chord.length] * (4 << (section % 2));
        const pluck = Math.exp(-phase * 6) * Math.sin(TAU * note * t);
        return 0.10 * pad + 0.30 * pluck;
    });

    return { car, bee, machine, bird, jet, music };
}
