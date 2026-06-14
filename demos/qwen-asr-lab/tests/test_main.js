// Qwen3-ASR Lab — headless smoke test. Drives the app's own UI: boot loads
// the model, Open decodes a known clip (auto-transcribing), the language
// badge and the streamed transcript land in the DOM, and context biasing +
// cancel stay wired. (The binding's own coverage lives in bro's
// tests/_qwen_asr_smoke.js.)
//
//   bro-headless ../broworkshop/demos/qwen-asr-lab ../broworkshop/demos/qwen-asr-lab/test.js

function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }
function pumpUntil(pred, budgetMs) {
    const start = Date.now();
    while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
    return pred();
}
const q = (s) => document.querySelector(s);

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const CLIP = WROOT + '/brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav';

// Boot kicks off an async model load.
assert(pumpUntil(() => /ready|record/i.test(q('#status').textContent), 300000),
       'model loaded at boot (status: ' + q('#status').textContent + ')');
assert(!q('#btn-record').disabled, 'record enabled after load');

// Open a clip — setSource auto-runs the transcription.
q('#src-file').value = CLIP;
q('#btn-loadfile').click();
assert(pumpUntil(() => /done/i.test(q('#status').textContent), 300000),
       'transcription finished (status: ' + q('#status').textContent + ')');

const lang = q('#lang').textContent;
const text = q('#transcript').textContent;
console.log('[qwen-asr-lab] language="' + lang + '" transcript="' + text + '"');
assert(/english/i.test(lang), 'language badge says English');
assert(/hello/i.test(text) && /test/i.test(text), 'transcript has the spoken words');
assert(q('#transcript').className === '', 'transcript marked final');

// Context biasing path: re-run with a context phrase; still transcribes.
q('#context').value = 'pipeline test';
q('#btn-transcribe').click();
assert(pumpUntil(() => /done/i.test(q('#status').textContent), 300000),
       'context-biased transcription finished');
assert(/hello/i.test(q('#transcript').textContent), 'biased transcript still has the words');

// Cancel path: start a run and cancel it immediately.
q('#btn-transcribe').click();
q('#btn-cancel').click();
assert(pumpUntil(() => /cancelled|done/i.test(q('#status').textContent), 300000),
       'cancelled run settles (status: ' + q('#status').textContent + ')');

console.log('[qwen-asr-lab] PASS');
