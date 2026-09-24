// LM Playground — headless smoke test. Drives the UI with the small Qwen3.5
// checkpoint: load via the family selector, stream a greedy factual reply
// into the page, then stop a long generation mid-flight. (Family coverage
// for Qwen3/Mistral lives in bro's tests/_lm_models_smoke.js and
// _async_lm_smoke.js; this verifies the app wiring.)
//
//   scripts/validate.sh --ml demos/lm-playground

import { check, waitFor, clickOn, setValue, q, text } from "/lib/kit/test.js";
import { weightsRoot } from "/lib/kit/weights.js";

check(/Qwen3\.5/.test(q('#model-path').value), 'default qwen35 path resolved');
check(q('#model-path').value.startsWith(weightsRoot()), 'default path is under the weights root');

// Switching family updates the default path, and back.
setValue('#family', 'qwen3');
check(/Qwen3-/.test(q('#model-path').value), 'qwen3 path after family change');
setValue('#family', 'qwen35');
check(/Qwen3\.5/.test(q('#model-path').value), 'qwen35 path restored');

clickOn('#btn-load');
waitFor(() => /ready/.test(text('#status')), 'model loaded (status: ' + text('#status') + ')', 600000);

q('#prompt').value = 'One-word answer only: what is the capital of France?';
q('#temperature').value = '0';
q('#max-tokens').value = '24';
clickOn('#btn-generate');
waitFor(() => /done/.test(text('#status')), 'generation finished', 300000);
const reply = text('#reply');
console.log('[lm-playground] reply: "' + reply + '"');
check(/paris/i.test(reply), 'reply names Paris');
check(/tok\/s/.test(text('#rate')), 'rate reported');

// Stop mid-generation.
q('#prompt').value = 'Write a very long story about the sea.';
q('#temperature').value = '0.7';
q('#max-tokens').value = '512';
clickOn('#btn-generate');
waitFor(() => q('#reply').textContent.length > 0, 'streaming started', 120000);
clickOn('#btn-stop');
waitFor(() => /stopped/.test(text('#status')), 'stop reported', 120000);

console.log('[lm-playground] PASS');
