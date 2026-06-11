// Repro: concurrent wake-word CUDA inference vs. graph-captured LLM/TTS decode.
//
// In the windowed app, bro.wake runs continuous CUDA inference on the engine's
// audio-inference thread while bro.lm.generate / bro.tts.synthesize decode on
// their own job threads. Headless e2e missed this (wake had no mic frames), so
// drive it explicitly: feed wake audio in the pump loop while the LLM streams
// tokens, then while Qwen-TTS synthesizes. Truncated/errored generations here
// reproduce the windowed failure.
//
// Run from the bro repo root:
//   ./build/Release/bro-headless.exe ../broworkshop/ai/voice-pipeline \
//       ../broworkshop/ai/voice-pipeline/_repro_concurrent.js

let failures = 0;
function check(cond, msg) {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
    if (!cond) failures++;
}

// Pump that feeds the wake detector every iteration (synchronous CUDA inference
// on this thread) while background job threads work — real cross-thread GPU
// concurrency, like the windowed app with a live mic.
const wakeNoise = new Float32Array(1600);             // 100 ms @ 16 kHz
for (let i = 0; i < wakeNoise.length; i++)
    wakeNoise[i] = 0.05 * Math.sin(i * 0.13) + 0.02 * Math.sin(i * 0.031);
let wakeOn = false;
function pump(predicate, timeoutMs) {
    const t0 = Date.now();
    while (!predicate() && Date.now() - t0 < timeoutMs) {
        if (wakeOn) { try { bro.wake.feed(wakeNoise); } catch (e) { console.log('  wake.feed threw: ' + e.message); } }
        const s = Date.now();
        while (Date.now() - s < 10) { /* real time for worker threads */ }
        advanceTime(10);
    }
    return predicate();
}

// ─── load: LLM + wake + Qwen-TTS (the windowed app's working set) ───────────
console.log('── load ──');
let lm = null, lmTok = null, qwen = null, lerr = null;
bro.lm.loadQwen('../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf', {
    onReady: (r) => { lm = r.model; lmTok = r.tokenizer; },
    onError: (m) => { lerr = 'lm: ' + m; },
});
bro.tts.loadQwen('../brosoundml/weights/qwen-tts/0.6B-customvoice', {
    onReady: (q) => { qwen = q; },
    onError: (m) => { lerr = 'qwen-tts: ' + m; },
});
pump(() => (lm && qwen) || lerr, 300000);
check(!lerr && lm && qwen, 'models loaded' + (lerr ? ' (' + lerr + ')' : ''));

bro.wake.listen({ weights: '../brosoundml-data/wake/computer.bw', threshold: 0.99,
                  onFire: () => {} });
wakeOn = true;
// Prime the detector so its window is rolling before the LLM starts.
pump(() => false, 300);
console.log('  wake active, lastScore=' + bro.wake.lastScore().toFixed(3));

// ─── LLM generations under concurrent wake inference ────────────────────────
console.log('── LLM × wake ──');
const history = [
    { role: 'system', content: 'Reply in one short sentence. /no_think' },
];
const QUESTIONS = ['Can you hear me?', 'What color is the sky?', 'Count to five.',
                   'Name a fruit.', 'Say hello.'];
for (let round = 0; round < QUESTIONS.length; round++) {
    history.push({ role: 'user', content: QUESTIONS[round] });
    const promptIds = lmTok.encode(lmTok.applyChatTemplate(history, true));
    let tokens = 0, done = false, err = null;
    bro.lm.generate(lm, promptIds, {
        maxNewTokens: 60,
        eosId: lmTok.imEndId,
        sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: 1234 + round },
        onToken: () => { tokens++; },
        onDone: (ids, info) => {
            done = true;
            err = info && info.error;
            const text = lmTok.decode(ids).replace(/<\|.*?\|>/g, '').trim();
            console.log('  [' + round + '] ' + tokens + ' tokens, err=' + (err || 'none') +
                        ' :: "' + text + '"');
            history.push({ role: 'assistant', content: text });
        },
    });
    const ok = pump(() => done, 120000);
    check(ok && !err, 'generation ' + round + ' completed without error');
}

// ─── Qwen-TTS synthesis under concurrent wake inference ─────────────────────
console.log('── TTS × wake ──');
for (let round = 0; round < 3; round++) {
    let done = false, err = null, n = 0;
    bro.tts.synthesize(qwen, 'This is sentence number ' + (round + 1) +
                       ' of the concurrent synthesis check.', {
        speaker: 'serena', language: 'english',
        onDone: (res, info) => {
            done = true;
            err = info && info.error;
            n = res && res.samples ? res.samples.length : 0;
        },
    });
    const ok = pump(() => done, 180000);
    check(ok && !err && n > 0, 'synthesis ' + round + ': ' + n + ' samples, err=' + (err || 'none'));
}

console.log(failures === 0 ? '\nALL CONCURRENCY CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
