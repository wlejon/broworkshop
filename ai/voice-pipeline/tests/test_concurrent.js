// Wake-word inference running alongside LM and TTS decoding (tag: ml).
// In the windowed app bro.wake runs CUDA inference on the audio-inference
// thread while bro.lm.generate / bro.tts decode on their job threads; this
// feeds the wake detector on every pump step while five generations and
// three Qwen3-TTS syntheses run, and checks none of them truncate or error.
import { check, test, done, needWeights } from "/lib/kit/test.js";

const GGUF = needWeights('Qwen3-8B GGUF', ['brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf']);
const QTTS = needWeights('Qwen3-TTS CustomVoice', ['brosoundml/weights/qwen-tts/0.6B-customvoice'], { probe: 'config.json' });
const WAKE = needWeights('wake word', ['brosoundml-data/wake/computer.bw']);

const noise = new Float32Array(1600);        // 100 ms at 16 kHz, never "computer"
for (let i = 0; i < noise.length; i++) noise[i] = 0.05 * Math.sin(i * 0.13) + 0.02 * Math.sin(i * 0.031);
let wakeOn = false;
function pump(pred, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (!pred() && Date.now() < end) {
        if (wakeOn) bro.wake.feed(noise);
        advanceTime(10);
    }
    return pred();
}

let lm = null, tok = null, qwen = null, loadErr = null;
bro.lm.loadQwen(GGUF, { onReady: (r) => { lm = r.model; tok = r.tokenizer; }, onError: (m) => { loadErr = 'lm: ' + m; } });
bro.tts.loadQwen(QTTS, { onReady: (q) => { qwen = q; }, onError: (m) => { loadErr = 'qwen-tts: ' + m; } });
pump(() => (lm && qwen) || loadErr, 300000);
test('models loaded', () => check(lm && qwen && !loadErr, loadErr || 'timeout'));

bro.wake.listen({ weights: WAKE, threshold: 0.99, onFire: () => {} });
wakeOn = true;
pump(() => false, 300);                      // let the detector's window fill

const history = [{ role: 'system', content: 'Reply in one short sentence. /no_think' }];
['Can you hear me?', 'What color is the sky?', 'Count to five.', 'Name a fruit.', 'Say hello.'].forEach((qn, round) => {
    history.push({ role: 'user', content: qn });
    let n = 0, fin = false, err = null, textOut = '';
    bro.lm.generate(lm, tok.encode(tok.applyChatTemplate(history, true)), {
        maxNewTokens: 60, eosId: tok.imEndId,
        sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: 1234 + round },
        onToken: () => { n++; },
        onDone: (ids, info) => { fin = true; err = info && info.error; textOut = tok.decode(ids).replace(/<\|.*?\|>/g, '').trim(); },
    });
    pump(() => fin, 120000);
    history.push({ role: 'assistant', content: textOut });
    test('generation ' + round + ' beside wake inference', () => check(fin && !err && n > 0, (err || n + ' tokens') + ': "' + textOut + '"'));
});

for (let round = 0; round < 3; round++) {
    let fin = false, err = null, samples = 0;
    bro.tts.synthesize(qwen, 'This is sentence number ' + (round + 1) + ' of the concurrent synthesis check.', {
        speaker: 'serena', language: 'english',
        onDone: (res, info) => { fin = true; err = info && info.error; samples = res && res.samples ? res.samples.length : 0; },
    });
    pump(() => fin, 180000);
    test('synthesis ' + round + ' beside wake inference', () => check(fin && !err && samples > 0, (err || samples + ' samples')));
}
done('concurrent inference');
