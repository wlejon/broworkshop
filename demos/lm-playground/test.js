// LM Playground — headless smoke test. Drives the UI with the small Qwen3.5
// checkpoint: load via the family selector, stream a greedy factual reply
// into the page, then stop a long generation mid-flight. (Family coverage
// for Qwen3/Mistral lives in bro's tests/_lm_models_smoke.js and
// _async_lm_smoke.js; this verifies the app wiring.)
//
//   bro-headless ../broworkshop/demos/lm-playground ../broworkshop/demos/lm-playground/test.js

function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }
function pumpUntil(pred, budgetMs) {
    const start = Date.now();
    while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
    return pred();
}
const q = (s) => document.querySelector(s);

assert(/Qwen3\.5/.test(q('#model-path').value), 'default qwen35 path resolved');

q('#btn-load').click();
assert(pumpUntil(() => /ready/.test(q('#status').textContent), 600000),
       'model loaded (status: ' + q('#status').textContent + ')');

q('#prompt').value = 'One-word answer only: what is the capital of France?';
q('#temperature').value = '0';
q('#max-tokens').value = '24';
q('#btn-generate').click();
assert(pumpUntil(() => /done/.test(q('#status').textContent), 300000),
       'generation finished (status: ' + q('#status').textContent + ')');
const reply = q('#reply').textContent;
console.log('[lm-playground] reply: "' + reply.trim() + '"');
assert(/paris/i.test(reply), 'reply names Paris');
assert(/tok\/s/.test(q('#rate').textContent), 'rate reported');

// Stop mid-generation.
q('#prompt').value = 'Write a very long story about the sea.';
q('#temperature').value = '0.7';
q('#max-tokens').value = '512';
q('#btn-generate').click();
assert(pumpUntil(() => q('#reply').textContent.length > 0, 120000), 'streaming started');
q('#btn-stop').click();
assert(pumpUntil(() => /stopped/.test(q('#status').textContent), 120000),
       'stop reported (status: ' + q('#status').textContent + ')');

console.log('[lm-playground] PASS');
