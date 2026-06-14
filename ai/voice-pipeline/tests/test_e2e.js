// End-to-end headless test of the voice pipeline APP (not just the libraries).
//
// Drives the real UI: picks a voice on the setup screen, clicks Start, waits
// for the models, then holds the talk button and feeds the Whisper test WAV
// through bro.mic.feed — the same tap the live mic drives — and releases.
// Asserts the full turn: capture -> Whisper STT -> Qwen3 LLM -> streamed TTS
// (word spans only appear when synthesis delivered audio).
//
// Pick the speech backend with BRO_VP_BACKEND (qwen | kokoro | voicedesign |
// text); defaults to qwen.
//
// Run from the bro repo root (GPU):
//   ./build/Release/bro-headless.exe ../broworkshop/ai/voice-pipeline \
//       ../broworkshop/ai/voice-pipeline/test_e2e.js

const FS = require('node:fs');
const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || '..';

const BACKEND = (() => {
    try { return (globalThis.process && process.env.BRO_VP_BACKEND) || 'qwen'; }
    catch (_) { return 'qwen'; }
})();

let failures = 0;
function check(cond, msg) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
    if (!cond) failures++;
}

// Async jobs run on real background threads, so wall-clock time must pass for
// them to finish; advanceTime() pumps the engine (timers, async-job drains,
// mic-chunk delivery, headless audio renderBlock).
function pump(predicate, timeoutMs) {
    const t0 = Date.now();
    while (!predicate() && Date.now() - t0 < timeoutMs) {
        const s = Date.now();
        while (Date.now() - s < 20) { /* burn real time for the worker threads */ }
        advanceTime(20);
    }
    return predicate();
}

const status = () => (document.getElementById('status') || {}).textContent || '';

// ─── tiny 16-bit PCM WAV reader (mono Float32 out) ────────────────────────
function readWav16(path) {
    const buf = FS.readFileSync(path);
    const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv  = new DataView(ab);
    const numChannels = dv.getUint16(22, true);
    const sampleRate  = dv.getUint32(24, true);
    let offset = 12;
    while (offset < ab.byteLength) {
        const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1),
                                       dv.getUint8(offset+2), dv.getUint8(offset+3));
        const size = dv.getUint32(offset + 4, true);
        if (id === 'data') {
            const pcm = new Int16Array(ab, offset + 8, size / 2);
            const frames = pcm.length / numChannels;
            const samples = new Float32Array(frames);
            for (let i = 0; i < frames; i++) {
                let s = 0;
                for (let c = 0; c < numChannels; c++) s += pcm[i * numChannels + c];
                samples[i] = (s / numChannels) / 32768;
            }
            return { samples, sampleRate };
        }
        offset += 8 + size;
    }
    throw new Error(path + ': no data chunk');
}

function resampleLinear(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = i * ratio;
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, samples.length - 1);
        out[i] = samples[i0] * (1 - (x - i0)) + samples[i1] * (x - i0);
    }
    return out;
}

// ─── 1. setup screen: pick the backend, start ───────────────────────────────
check(pump(() => !!document.getElementById('startBtn'), 5000), 'setup screen rendered');

let card = null;
document.querySelectorAll('.voice-card').forEach(c => {
    if (c.dataset.backend === BACKEND) card = c;
});
check(!!card && !card.classList.contains('disabled'), 'backend card available: ' + BACKEND);
if (card) card.click();

const startBtn = document.getElementById('startBtn');
check(!startBtn.disabled, 'start button enabled');
startBtn.click();

// ─── 2. model loading (all units, concurrent) ───────────────────────────────
const talk = document.getElementById('talk');
const loaded = pump(() => !talk.disabled ||
                          (document.getElementById('status') || {}).className.indexOf('error') >= 0,
                    600000);
check(loaded && !talk.disabled, 'models loaded (status="' + status() + '")');
if (talk.disabled) { console.log('\nABORT: models failed to load'); throw new Error('load failed'); }

// ─── 3. hold to talk + feed the utterance through the mic tap ───────────────
const wav = readWav16(WROOT + '/brosoundml/weights/whisper/test_audio_en.wav');
console.log('  utterance: ' + (wav.samples.length / wav.sampleRate).toFixed(2) +
            's @ ' + wav.sampleRate + ' Hz');
const micRate = bro.mic.engineRate();
const feedBuf = resampleLinear(wav.samples, wav.sampleRate, micRate);

const r = talk.getBoundingClientRect();
mouseDown(r.x + r.width / 2, r.y + r.height / 2);
advanceTime(20);
check(status().indexOf('listening') >= 0, 'recording opened (status="' + status() + '")');
check(bro.mic.isActive(), 'bro.mic tap registered');

// Feed in ~0.25 s slices, pumping between them so tickMic drains chunks into
// the app's onMicChunk (exactly what the live audio thread would do).
const SLICE = Math.floor(micRate / 4);
for (let off = 0; off < feedBuf.length; off += SLICE) {
    bro.mic.feed(feedBuf.subarray(off, Math.min(off + SLICE, feedBuf.length)), micRate);
    advanceTime(20);
}
const s = bro.mic.stats();
check(s && s.chunkCount > 0, 'mic chunks delivered: ' + (s ? s.chunkCount : 0) +
      ' (dropped ' + (s ? s.dropped : '?') + ')');

mouseUp(r.x + r.width / 2, r.y + r.height / 2);

// ─── 4. the turn: STT -> LLM -> TTS -> back to idle ─────────────────────────
const turnDone = pump(() => {
    const st = status();
    const err = (document.getElementById('status') || {}).className.indexOf('error') >= 0;
    return err || st.indexOf('listening for') >= 0 || st === 'idle' ||
           st.indexOf('idle') === 0 || st.indexOf('no speech') >= 0;
}, 600000);
const errored = (document.getElementById('status') || {}).className.indexOf('error') >= 0;
check(turnDone && !errored, 'turn completed (status="' + status() + '")');

const youRows = document.querySelectorAll('#transcript .turn.you');
const youText = youRows.length ? youRows[youRows.length - 1].textContent : '';
check(youRows.length > 0 && youText.replace(/^you:\s*/, '').trim().length > 0,
      'transcript captured: "' + youText.trim() + '"');

const broRows = document.querySelectorAll('#transcript .turn.bro');
const broText = broRows.length ? broRows[broRows.length - 1].textContent : '';
check(broRows.length > 0 && broText.replace(/^bro:\s*/, '').trim().length > 0,
      'reply produced: "' + broText.trim() + '"');

if (BACKEND !== 'text') {
    // Word spans only exist when synthesis delivered audio (finalizeSentence
    // runs on the synth paths) — this is the "TTS actually spoke" assertion.
    const words = document.querySelectorAll('#transcript .turn.bro .word');
    check(words.length > 0, 'TTS synthesized speech (' + words.length + ' word spans)');
    const lit = document.querySelectorAll('#transcript .word.speaking');
    check(lit.length === 0, 'no stale word highlight after the turn');
}

console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
if (failures > 0) throw new Error(failures + ' e2e check(s) failed');
