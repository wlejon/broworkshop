// Headless end-to-end test for the voice pipeline (no mic).
//
// Runs:  Whisper STT (on test_audio_en.wav)  ->  Qwen3 LLM  ->  Kokoro TTS,
// writes the synthesised reply to test_out.wav next to this script.
//
// Run from the bro repo build dir:
//   ./bro-headless.exe ../broworkshop/ai/voice-pipeline test.js

const FS = require('node:fs');

// ─── tiny 16-bit PCM WAV reader (mono Float32 out) ────────────────────────
function readWav16(path) {
    const buf = FS.readFileSync(path);
    const ab  = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv  = new DataView(ab);
    if (dv.getUint32(0, false) !== 0x52494646) throw new Error(path + ': not RIFF');
    const sampleRate   = dv.getUint32(24, true);
    const numChannels  = dv.getUint16(22, true);
    const bitsPerSample = dv.getUint16(34, true);
    if (bitsPerSample !== 16) throw new Error(path + ': not 16-bit');
    let offset = 12;
    while (offset < ab.byteLength) {
        const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1),
                                       dv.getUint8(offset+2), dv.getUint8(offset+3));
        const size = dv.getUint32(offset + 4, true);
        if (id === 'data') {
            const pcm = new Int16Array(ab, offset + 8, size / 2);
            const frameCount = pcm.length / numChannels;
            const samples = new Float32Array(frameCount);
            for (let i = 0; i < frameCount; i++) {
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

function writeWav16(path, samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x52494646, false);
    dv.setUint32(4, 36 + n * 2, true);
    dv.setUint32(8, 0x57415645, false);
    dv.setUint32(12, 0x666d7420, false);
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    dv.setUint32(36, 0x64617461, false);
    dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
        let s = samples[i];
        if (s >  1) s =  1;
        if (s < -1) s = -1;
        dv.setInt16(44 + i * 2, Math.round(s * 32767), true);
    }
    FS.writeFileSync(path, new Uint8Array(buf));
}

function ms(t0) { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }

const startAll = Date.now();

// ─── STT ──────────────────────────────────────────────────────────────────
console.log('── STT ──');
const wav = readWav16('../brosoundml/weights/whisper/test_audio_en.wav');
console.log('audio: ' + wav.samples.length + ' samples @ ' + wav.sampleRate + ' Hz');
let t = Date.now();
const whisper = bro.stt.loadWhisper('../brosoundml/weights/whisper');
console.log('loadWhisper: ' + ms(t));
const sttTok = bro.stt.loadTokenizer({
    vocabPath:  '../brosoundml/weights/whisper/vocab.json',
    mergesPath: '../brosoundml/weights/whisper/merges.txt',
});
const sttPrompt = sttTok.buildPrompt('en', 'transcribe', false);
t = Date.now();
const sttIds = whisper.transcribe(wav, sttPrompt, { maxNewTokens: 128 });
const userText = sttTok.decode(sttIds, true).trim();
console.log('transcribe: ' + ms(t));
console.log('YOU: "' + userText + '"');

// ─── LLM ──────────────────────────────────────────────────────────────────
console.log('── LLM ──');
t = Date.now();
const { model: lm, tokenizer: lmTok } =
    bro.lm.loadQwen('../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf');
console.log('loadQwen: ' + ms(t));

const history = [
    { role: 'system', content:
        'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
        'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
        'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
        'friend, not a chatbot. /no_think' },
    { role: 'user', content: userText || 'Say hi to a new friend named Bro.' },
];
const prompt = lmTok.applyChatTemplate(history, true);
const promptIds = lmTok.encode(prompt);
lm.allocateCache(promptIds.length + 96);
t = Date.now();
const newIds = lm.generate(promptIds, {
    maxNewTokens: 80,
    eosId: lmTok.imEndId,
    sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: 42 },
});
let reply = lmTok.decode(newIds);
// Strip <think>…</think> blocks (Qwen3 thinking mode) and any stray special tokens.
reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '')
             .replace(/<think>[\s\S]*$/g, '')           // unterminated think (cut off)
             .replace(/<\|.*?\|>/g, '')
             .trim();
console.log('generate: ' + ms(t) + '  (' + newIds.length + ' tokens)');
console.log('BRO: "' + reply + '"');

// ─── TTS ──────────────────────────────────────────────────────────────────
console.log('── TTS ──');
t = Date.now();
bro.tts.setAssetRoot('../brosoundml');
const kokoro = bro.tts.loadKokoro('../brosoundml/weights/kokoro');
const voice  = kokoro.loadVoice('../brosoundml/weights/kokoro/voices/af_heart.bin');
console.log('loadKokoro: ' + ms(t));
const phonemeIds = bro.tts.phonemize(reply);
console.log('phonemize: ' + phonemeIds.length + ' ids');
t = Date.now();
const out = kokoro.synthesize(phonemeIds, voice, { speed: 1.0 });
console.log('synthesize: ' + ms(t) + '  ' + out.samples.length + ' samples @ ' + out.sampleRate + ' Hz');

writeWav16('test_out.wav', out.samples, out.sampleRate);
console.log('wrote test_out.wav (' + (out.samples.length / out.sampleRate).toFixed(2) + 's)');

console.log('─ total wall clock: ' + ms(startAll) + ' ─');
