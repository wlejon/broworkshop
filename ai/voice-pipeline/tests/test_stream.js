// The streaming bindings the pipeline is built on (tag: ml):
//   whisper.transcribe sync overload with { onToken, timestampBeginId }
//   bro.stt.transcribe async with onToken streaming
//   bro.tts.synthesizeStream(kokoro, phonemeChunks, voice, { onChunk, onDone })
import { check, eq, test, done, pumpUntil, needWeights } from "/lib/kit/test.js";
import { readWav } from "/lib/kit/audio.js";
import { useKokoroAssets, kokoroVoicePath } from "/lib/kit/kokoro.js";

const WHISPER = needWeights('Whisper', ['brosoundml/weights/whisper'], { probe: 'test_audio_en.wav' });
const KOKORO = needWeights('Kokoro', ['brosoundml/weights/kokoro'], { probe: 'config.json' });

const wav = readWav(WHISPER + '/test_audio_en.wav');
const audio = { samples: wav.pcm, sampleRate: wav.rate };
const whisper = bro.stt.loadWhisper(WHISPER);
const tok = bro.stt.loadTokenizer({ vocabPath: WHISPER + '/vocab.json', mergesPath: WHISPER + '/merges.txt' });
const prompt = tok.buildPrompt('en', 'transcribe', true);     // timestamps on (long-form)

test('Whisper sync transcribe streams tokens', () => {
    let n = 0;
    const ids = whisper.transcribe(audio, prompt, { maxNewTokens: 128, timestampBeginId: tok.firstTimestampId, onToken: () => { n++; } });
    const text = tok.decode(ids, true).trim();
    console.log('sync: "' + text + '"');
    check(n > 0 && text.length > 0, n + ' tokens');
});

let asyncN = 0, asyncIds = null, asyncErr = null;
bro.stt.transcribe(whisper, audio, prompt, {
    maxNewTokens: 128, timestampBeginId: tok.firstTimestampId,
    onToken: () => { asyncN++; },
    onDone: (ids, info) => { asyncIds = ids; asyncErr = info && info.error; },
});
pumpUntil(() => asyncIds, 20000);
test('Whisper async transcribe streams tokens', () => {
    check(asyncIds && !asyncErr, 'finished: ' + asyncErr);
    check(asyncN > 0 && tok.decode(asyncIds, true).trim().length > 0, asyncN + ' tokens');
});

useKokoroAssets(KOKORO);
const kokoro = bro.tts.loadKokoro(KOKORO);
const pack = kokoro.loadVoice(kokoroVoicePath(KOKORO, 'af_aoede'));
const spaceId = (kokoro.vocab() || {})[' '] || 16;

// Three roughly even word chunks, re-joined with the space token.
const ids = bro.tts.phonemize('Hello there. How are you doing today? I am doing just fine.');
const wordsP = [];
let cur = [];
for (const id of ids) { if (id === spaceId) { if (cur.length) { wordsP.push(cur); cur = []; } } else cur.push(id); }
if (cur.length) wordsP.push(cur);
const chunks = [[], [], []];
wordsP.forEach((w, i) => { const c = chunks[Math.floor(i * 3 / wordsP.length)]; if (c.length) c.push(spaceId); c.push(...w); });

let chunkCount = 0, chunkSamples = 0, durOk = true, full = null, ttsErr = null;
bro.tts.synthesizeStream(kokoro, chunks, pack, {
    speed: 1.0,
    onChunk: (samples, durations) => {
        // durations: this chunk's per-phoneme frames, BOS/EOS-wrapped.
        if (!durations || durations.length !== chunks[chunkCount].length + 2) durOk = false;
        chunkCount++; chunkSamples += samples.length;
    },
    onDone: (res, info) => { full = res; ttsErr = info && info.error; },
});
pumpUntil(() => full, 20000);
test('Kokoro synthesizeStream', () => {
    check(full && !ttsErr, 'finished: ' + ttsErr);
    eq(chunkCount, chunks.length, 'one onChunk per chunk');
    check(durOk, 'per-phoneme durations per chunk');
    eq(full.samples.length, chunkSamples, 'full buffer = concatenated chunks');
});
done('streaming bindings');
