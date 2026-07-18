// make_assets.mjs — generate the two Ogg Vorbis assets this demo loads from disk.
//
// The rest of the app synthesizes its audio at load time, on purpose. These two
// files exist because two of the APIs on show are FILE APIs: you cannot
// demonstrate ctx.createClipFromFileAsync() or ctx.createStreamFromFile()
// against a Float32Array. And they are Ogg Vorbis specifically because the
// workshop tree contained zero .ogg files before this app — broaudio compiles
// stb_vorbis in (src/codec/stb_vorbis_impl.c) and nothing exercised it.
//
// Run (needs node + ffmpeg with libvorbis on PATH):
//   node tools/make_assets.mjs
//
// Writes assets/pad-chime.ogg (short, for the async decode) and
// assets/ambience-bed.ogg (long, for the disk stream). Both are committed, so
// you only need this script if you want to change the sound.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(APP_DIR, 'assets');
const SR = 48000;
const TAU = Math.PI * 2;

mkdirSync(ASSETS, { recursive: true });

/** Deterministic LCG — regenerating must produce a byte-identical file. */
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

/** Write interleaved stereo Float32 as a 16-bit PCM WAV. */
function writeWav(path, left, right) {
    const n = left.length;
    const bytes = Buffer.alloc(44 + n * 4);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(36 + n * 4, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);          // PCM
    bytes.writeUInt16LE(2, 22);          // stereo
    bytes.writeUInt32LE(SR, 24);
    bytes.writeUInt32LE(SR * 4, 28);     // byte rate
    bytes.writeUInt16LE(4, 32);          // block align
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
        const l = Math.max(-1, Math.min(1, left[i]));
        const r = Math.max(-1, Math.min(1, right[i]));
        bytes.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
        bytes.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
    }
    writeFileSync(path, bytes);
}

/**
 * Render `seconds` of stereo from a per-sample function returning [l, r],
 * encode to Ogg Vorbis, and drop the intermediate WAV.
 *
 * @param {number} quality libvorbis -q, 0..10. Low is fine: these are texture
 *   beds, and a demo asset that bloats the repo is a bad trade.
 */
function render(name, seconds, quality, fn) {
    const n = Math.round(seconds * SR);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const [l, r] = fn(i / SR);
        left[i] = l;
        right[i] = r;
    }
    // Fade the very ends so the encoder has no edge transient to smear.
    const fade = Math.round(0.02 * SR);
    for (let i = 0; i < fade; i++) {
        const g = i / fade;
        left[i] *= g; right[i] *= g;
        left[n - 1 - i] *= g; right[n - 1 - i] *= g;
    }

    const wav = join(ASSETS, `${name}.tmp.wav`);
    const ogg = join(ASSETS, `${name}.ogg`);
    writeWav(wav, left, right);
    execFileSync('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', wav, '-c:a', 'libvorbis', '-q:a', String(quality), ogg,
    ], { stdio: 'inherit' });
    unlinkSync(wav);
    console.log(`${name}.ogg  ${seconds}s  ${(statSync(ogg).size / 1024).toFixed(0)} KB`);
}

// --- 1. pad-chime.ogg: the async-decode subject -------------------------------
//
// Six seconds, wide stereo, with a clear attack at the top. The attack matters:
// the smoke test proves the async decode actually produced audio by measuring
// the bus level after playing it, and a bed that fades in from nothing would
// make that measurement about the fade rather than the decode.

render('pad-chime', 6.0, 3, (t) => {
    // A minor-9th pad, detuned across the stereo field.
    const notes = [110, 130.81, 164.81, 196, 246.94];
    let l = 0, r = 0;
    for (let i = 0; i < notes.length; i++) {
        const f = notes[i];
        const pan = i / (notes.length - 1);                 // 0 = left, 1 = right
        const swell = 0.5 + 0.5 * Math.sin(TAU * (0.11 + i * 0.017) * t - Math.PI / 2);
        const v = (Math.sin(TAU * f * t + i)
                 + 0.4 * Math.sin(TAU * f * 2.002 * t + i * 1.7)) * swell;
        l += v * (1 - pan);
        r += v * pan;
    }
    // Chimes on the octave above, one every 750 ms, alternating sides.
    const step = Math.floor(t / 0.75);
    const phase = (t / 0.75) % 1;
    const cf = notes[step % notes.length] * 4;
    const chime = Math.exp(-phase * 4.5)
        * (Math.sin(TAU * cf * t) + 0.3 * Math.sin(TAU * cf * 2.76 * t));
    const cl = (step % 2) ? 0.35 : 1.0;
    return [0.16 * l + 0.30 * chime * cl, 0.16 * r + 0.30 * chime * (1.35 - cl)];
});

// --- 2. ambience-bed.ogg: the disk-stream subject ------------------------------
//
// 96 seconds in six 16-second movements, each in a different register with a
// different pulse rate. That structure is the whole point: seeking a stream is
// only convincing if landing at 0:48 sounds obviously unlike 0:08, and a
// uniform drone would let a silently-failed seek pass unnoticed by ear.

const nz = lcg(0xA11CE);
let lp = 0, hp = 0;
render('ambience-bed', 96.0, 2, (t) => {
    const movement = Math.min(5, Math.floor(t / 16));
    const roots = [55, 61.74, 49, 73.42, 65.41, 43.65];
    const pulses = [0.5, 0.75, 0.33, 1.0, 0.66, 0.25];      // Hz
    const root = roots[movement];

    // Drone: root plus fifth plus octave, slowly beating.
    const drone = Math.sin(TAU * root * t)
        + 0.55 * Math.sin(TAU * root * 1.5 * t + 0.7)
        + 0.35 * Math.sin(TAU * root * 2.01 * t);

    // Pulse: a soft swell whose rate identifies the movement by ear.
    const pulse = 0.5 + 0.5 * Math.sin(TAU * pulses[movement] * t);

    // Air: two-pole-ish filtered noise, brighter in the higher movements.
    const white = nz();
    lp = lp * 0.985 + white * 0.015;
    hp = white - lp;
    const air = lp * 2.2 + hp * (0.05 + movement * 0.012);

    const wide = 0.35 * Math.sin(TAU * 0.07 * t);           // slow stereo drift
    const m = 0.22 * drone * (0.45 + 0.55 * pulse) + 0.10 * air;
    return [m * (1 - wide), m * (1 + wide)];
});
