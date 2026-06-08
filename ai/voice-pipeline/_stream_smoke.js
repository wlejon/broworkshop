// Smoke test for the new streaming bindings:
//   - whisper.transcribe(...) sync overload with { onToken, timestampBeginId }
//   - bro.stt.transcribe(...)  async with onToken streaming
//   - bro.tts.synthesizeStream(kokoro, phonemeChunks, voice, { onChunk, onDone })
//
// Run from the bro build dir (GPU):
//   ./build/Release/bro-headless.exe ../broworkshop/ai/voice-pipeline _stream_smoke.js
const FS = require('node:fs');

function readWav16(path) {
    const buf = FS.readFileSync(path);
    const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv  = new DataView(ab);
    const numChannels = dv.getUint16(22, true);
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
            return { samples, sampleRate: dv.getUint32(24, true) };
        }
        offset += 8 + size;
    }
    throw new Error('no data chunk');
}

let failures = 0;
function check(cond, msg) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
    if (!cond) failures++;
}

// Async jobs run on a real background thread, so we must let WALL-CLOCK time
// pass for them to finish — sleep()/advanceTime only moves virtual time and
// returns instantly. Burn ~20 ms of real time per spin, then advanceTime() to
// pump tickAsync (which drives the job's poll/done callbacks).
function pump(predicate, timeoutMs) {
    const t0 = Date.now();
    while (!predicate() && Date.now() - t0 < timeoutMs) {
        const s = Date.now();
        while (Date.now() - s < 20) { /* burn real time for the worker thread */ }
        advanceTime(20);
    }
}

// ─── Whisper streaming (sync + async) ─────────────────────────────────────────
console.log('── Whisper streaming ──');
const wav = readWav16('../brosoundml/weights/whisper/test_audio_en.wav');
const whisper = bro.stt.loadWhisper('../brosoundml/weights/whisper');
const tok = bro.stt.loadTokenizer({
    vocabPath:  '../brosoundml/weights/whisper/vocab.json',
    mergesPath: '../brosoundml/weights/whisper/merges.txt',
});
const prompt = tok.buildPrompt('en', 'transcribe', true);  // timestamps on for long-form

// Sync overload with onToken + timestampBeginId.
let syncTokens = 0;
const syncIds = whisper.transcribe(wav, prompt, {
    maxNewTokens: 128,
    timestampBeginId: tok.firstTimestampId,
    onToken: () => { syncTokens++; },
});
const syncText = tok.decode(syncIds, true).trim();
check(syncTokens > 0, 'sync onToken fired ' + syncTokens + ' times');
check(syncText.length > 0, 'sync long-form transcript: "' + syncText + '"');

// Async streaming — pumped with sleep().
let asyncTokens = 0, asyncDone = false, asyncIds = null;
bro.stt.transcribe(whisper, wav, prompt, {
    maxNewTokens: 128,
    timestampBeginId: tok.firstTimestampId,
    onToken: () => { asyncTokens++; },
    onDone: (ids, info) => { asyncDone = true; asyncIds = ids; if (info.error) console.log('  async err: ' + info.error); },
});
pump(() => asyncDone, 20000);
check(asyncDone, 'async transcribe completed');
check(asyncTokens > 0, 'async onToken fired ' + asyncTokens + ' times');
check(asyncIds && tok.decode(asyncIds, true).trim().length > 0,
      'async transcript: "' + (asyncIds ? tok.decode(asyncIds, true).trim() : '') + '"');

// ─── Kokoro streaming ─────────────────────────────────────────────────────────
console.log('── Kokoro streaming ──');
bro.tts.setAssetRoot('../brosoundml');
const kokoro = bro.tts.loadKokoro('../brosoundml/weights/kokoro');
const voice  = kokoro.loadVoice('../brosoundml/weights/kokoro/voices/af_aoede.bin');
const spaceId = (kokoro.vocab() || {})[' '] || 16;

// Split a multi-clause phoneme stream into chunks at the space token.
const ids = bro.tts.phonemize('Hello there. How are you doing today? I am doing just fine.');
const words = [];
let cur = [];
for (const id of ids) {
    if (id === spaceId) { if (cur.length) { words.push(cur); cur = []; } }
    else cur.push(id);
}
if (cur.length) words.push(cur);
// Group words into 3 roughly-even chunks (re-inserting the space token between words).
const chunks = [[], [], []];
for (let i = 0; i < words.length; i++) {
    const c = chunks[Math.floor(i * 3 / words.length)];
    if (c.length) c.push(spaceId);
    for (const id of words[i]) c.push(id);
}

let chunkCount = 0, chunkSamples = 0, ttsDone = false, fullLen = 0, durOk = true;
bro.tts.synthesizeStream(kokoro, chunks, voice, {
    speed: 1.0,
    onChunk: (samples, durations) => {
        // durations = this chunk's per-phoneme frame counts, BOS/EOS-wrapped.
        const expect = chunks[chunkCount].length + 2;
        if (!durations || durations.length !== expect) durOk = false;
        chunkCount++; chunkSamples += samples.length;
    },
    onDone: (res, info) => { ttsDone = true; fullLen = res.samples.length; if (info.error) console.log('  tts err: ' + info.error); },
});
pump(() => ttsDone, 20000);
check(ttsDone, 'synthesizeStream completed');
check(chunkCount === chunks.length, 'onChunk fired once per chunk (' + chunkCount + '/' + chunks.length + ')');
check(durOk, 'each chunk delivered per-phoneme durations (length = chunk + 2)');
check(fullLen > 0 && fullLen === chunkSamples,
      'full buffer (' + fullLen + ') == concatenated chunks (' + chunkSamples + ')');

console.log(failures === 0 ? '\nALL STREAMING SMOKE TESTS PASSED'
                           : '\n' + failures + ' CHECK(S) FAILED');
