// NLLB-200 Lab — headless smoke test. Drives the app's own UI: boot loads the
// model, then Translate runs an English→French beam search and the output lands
// in the DOM. Swap + cancel paths stay wired.
//
//   bro-headless ../broworkshop/demos/nllb-lab \
//                ../broworkshop/demos/nllb-lab/tests/test_main.js

function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }
function pumpUntil(pred, budgetMs) {
    const start = Date.now();
    while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
    return pred();
}
const q = (s) => document.querySelector(s);

// Boot kicks off an async model load (≈2.4 GB — give it room).
assert(pumpUntil(() => /ready|languages/i.test(q('#status').textContent), 300000),
       'model loaded at boot (status: ' + q('#status').textContent + ')');
assert(!q('#btn-translate').disabled, 'translate enabled after load');

// English → French on the default input.
q('#input').value = 'Hello, how are you?';
q('#src-lang').value = 'eng_Latn';
q('#tgt-lang').value = 'fra_Latn';
q('#btn-translate').click();
assert(pumpUntil(() => /done/i.test(q('#status').textContent), 300000),
       'translation finished (status: ' + q('#status').textContent + ')');

const out = q('#output').textContent.trim();
console.log('[nllb-lab] en→fr: "' + out + '"');
assert(out.length > 0, 'produced a non-empty translation');
assert(q('#output').className === '', 'output marked final');
// "comment" / "vous" / "bonjour" — any decent French rendering hits one.
assert(/comment|vous|bonjour|allez|salut/i.test(out),
       'translation looks like French: "' + out + '"');

// Swap carries the output back into the input and flips the language pair.
q('#btn-swap').click();
assert(q('#src-lang').value === 'fra_Latn' && q('#tgt-lang').value === 'eng_Latn',
       'swap flipped the language pair');
assert(q('#input').value.trim() === out, 'swap carried output into input');

// Round-trip fr→en.
q('#btn-translate').click();
assert(pumpUntil(() => /done/i.test(q('#status').textContent), 300000),
       'round-trip translation finished');
assert(q('#output').textContent.trim().length > 0, 'round-trip produced output');

// Cancel path: start a run and cancel it immediately.
q('#input').value = 'This is a longer sentence to translate so we can cancel it.';
q('#btn-translate').click();
q('#btn-cancel').click();
assert(pumpUntil(() => /cancelled|done/i.test(q('#status').textContent), 300000),
       'cancelled run settles (status: ' + q('#status').textContent + ')');

console.log('[nllb-lab] PASS');
