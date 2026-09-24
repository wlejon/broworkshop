// Live end to end through the real UI (ml): load a local model with the Load
// button, send a prompt, let the agent run, and check the loop reached idle
// with a streamed reply. Small models are imperfect tool callers, so a
// missing tool call is logged, not failed. PI_AGENT_MODEL (a path relative to
// the weights root, or absolute) picks another model, e.g. the 32B GGUF for a
// bounded multi-step check.
import { check, test, done, waitFor, frames, text, clickOn, typeInto, shot } from "/lib/kit/test.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";
import { piAgent } from "/app/app.js";

const want = (globalThis.process && process.env.PI_AGENT_MODEL) || '';
const candidates = want ? [want] : ['brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
                                    'brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf'];
const model = findWeights(candidates);
check(model, missingWeights('a small Qwen3 GGUF', candidates));

const saved = piAgent.prefs.snapshot();
piAgent.backend.configure({ path: model });
clickOn('#btn-load');
waitFor(() => /ready|failed/.test(text('#status')), 'model load', 600000);
check(/ready/.test(text('#status')), 'loaded: ' + text('#status'));

typeInto('#prompt', "Use the list_dir tool on '.', then tell me in one sentence what is here. Do not ask for confirmation.");
clickOn('#btn-send');
frames(1);
waitFor(() => !piAgent.session.running, 'the turn to finish', 600000);
frames(2);

test('the loop ran and replied', () => {
    const rows = document.querySelectorAll('#transcript .chat-row');
    check(rows.length >= 2, 'user row + a reply (' + rows.length + ')');
    check(!/error/.test(document.querySelector('#status').className), 'status: ' + text('#status'));
    check(!document.querySelector('#ctx-meter').hidden, 'context meter shows usage');
});

const cards = Array.from(document.querySelectorAll('#transcript .chat-tool-name')).map((n) => n.textContent);
console.log(cards.length ? 'tools called: ' + cards.join(', ') : 'no tool call this run (small-model limitation; informational)');
shot('live');
piAgent.prefs.restore(saved);
done('pi-agent live loop');
