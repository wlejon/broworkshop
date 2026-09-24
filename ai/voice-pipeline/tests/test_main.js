// The pipeline's three stages through the blocking APIs (tag: ml): Whisper
// on the test utterance -> Qwen3-8B reply -> Kokoro speech, saved to
// tests/out/voice-pipeline-reply.wav for listening.
import { check, test, done, needWeights } from "/lib/kit/test.js";
import { readWav, saveWav } from "/lib/kit/audio.js";
import { useKokoroAssets, kokoroVoicePath } from "/lib/kit/kokoro.js";
import { clean } from "/app/speech.js";
import { SYSTEM_PROMPT } from "/app/pipeline.js";

const WHISPER = needWeights('Whisper', ['brosoundml/weights/whisper'], { probe: 'test_audio_en.wav' });
const GGUF = needWeights('Qwen3-8B GGUF', ['brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf']);
const KOKORO = needWeights('Kokoro', ['brosoundml/weights/kokoro'], { probe: 'config.json' });
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(2) + ' s';

let t = Date.now();
const wav = readWav(WHISPER + '/test_audio_en.wav');
const whisper = bro.stt.loadWhisper(WHISPER);
const sttTok = bro.stt.loadTokenizer({ vocabPath: WHISPER + '/vocab.json', mergesPath: WHISPER + '/merges.txt' });
const userText = sttTok.decode(whisper.transcribe({ samples: wav.pcm, sampleRate: wav.rate },
    sttTok.buildPrompt('en', 'transcribe', false), { maxNewTokens: 128 }), true).trim();
console.log('STT ' + secs(t) + ': "' + userText + '"');
test('Whisper transcribed the utterance', () => check(userText.length > 0, 'text'));

t = Date.now();
const { model: lm, tokenizer: lmTok } = bro.lm.loadQwen(GGUF);
const promptIds = lmTok.encode(lmTok.applyChatTemplate([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userText || 'Say hi to a new friend named Bro.' },
], true));
lm.allocateCache(promptIds.length + 96);
const newIds = lm.generate(promptIds, { maxNewTokens: 80, eosId: lmTok.imEndId,
    sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: 42 } });
const reply = clean(lmTok.decode(newIds)).trim();
console.log('LLM ' + secs(t) + ' (' + newIds.length + ' tokens): "' + reply + '"');
test('Qwen3 replied', () => check(reply.length > 0, 'reply'));

t = Date.now();
useKokoroAssets(KOKORO);
const kokoro = bro.tts.loadKokoro(KOKORO);
const pack = kokoro.loadVoice(kokoroVoicePath(KOKORO, 'af_heart'));
const out = kokoro.synthesize(bro.tts.phonemize(reply), pack, { speed: 1.0 });
console.log('TTS ' + secs(t) + ': ' + (out.samples.length / out.sampleRate).toFixed(2) + ' s of audio');
test('Kokoro spoke the reply', () => check(out.samples.length > out.sampleRate * 0.3, 'samples ' + out.samples.length));

const outDir = String(process.cwd()).replace(/\\/g, '/') + '/tests/out';    // CWD = repo root under validate.sh
require('fs').mkdirSync(outDir, { recursive: true });
const path = saveWav(out.samples, out.sampleRate, { path: outDir + '/voice-pipeline-reply.wav' });
console.log('wrote ' + path);
done('blocking pipeline');
