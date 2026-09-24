// Live (tag: net): the kit agent loop (lib/kit/agent.js) through the
// OpenRouter provider (lib/kit/agent-llm.js, native tool calling) with the
// coding tools, entirely in-engine. A bounded task must call list_dir; the
// tool must round-trip and the loop reach idle. Free models rate-limit, so
// it tries a few until one completes. Needs OPENROUTER_API_KEY; skips without it.
//   OPENROUTER_API_KEY=sk-or-... bro-headless ai/maker-agent ai/maker-agent/tests/test_openrouter_loop.js
import { check, test, done, pumpUntil, skip } from "/lib/kit/test.js";
import { createAgent } from "/lib/kit/agent.js";
import { codingTools } from "/lib/kit/agent-tools.js";
import { openrouterStream } from "/lib/kit/agent-llm.js";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) skip('OPENROUTER_API_KEY is not set');

const MODELS = [
    'nvidia/nemotron-3-super-120b-a12b:free',
    'google/gemma-4-31b-it:free',
    'openai/gpt-oss-120b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
];

function runOne(model) {
    const events = [];
    let idle = false, failed = null;
    const agent = createAgent({
        stream: openrouterStream({ apiKey: KEY, model, maxRetries: 2 }),
        systemPrompt: 'You are a coding agent. Use tools when asked.',
        tools: codingTools(bro.appDir),
        onEvent: (e) => {
            events.push(e);
            if (e.type === 'tool_execution_start') console.log('  -> tool: ' + e.toolName + ' ' + JSON.stringify(e.args || {}));
            if (e.type === 'message_end' && e.message.role === 'assistant' && e.message.stopReason === 'error') {
                failed = e.message.errorMessage || 'error';
            }
        },
    });
    agent.prompt("Call the list_dir tool on '.' and then tell me in one sentence what files are here. Do not call any other tools.")
        .then(() => { idle = true; }, (e) => { failed = (e && e.message) || String(e); idle = true; });
    pumpUntil(() => idle, 240000);
    return { idle, failed, tools: events.filter((e) => e.type === 'tool_execution_start').map((e) => e.toolName),
             results: events.filter((e) => e.type === 'tool_execution_end') };
}

let winner = null;
for (const model of MODELS) {
    console.log('=== trying ' + model);
    const r = runOne(model);
    if (r.failed && !r.tools.length) { console.log('  unavailable: ' + r.failed); continue; }
    console.log('  idle: ' + r.idle + ' tools: ' + JSON.stringify(r.tools));
    if (r.idle && r.tools.includes('list_dir')) { winner = r; winner.model = model; break; }
}

test('a free model round-trips list_dir through the loop', () => {
    check(winner, 'at least one free model completed the tool loop');
    const res = winner.results.find((e) => e.toolName === 'list_dir');
    check(res && !res.isError, 'list_dir succeeded on ' + winner.model);
    check(/index\.html/.test(JSON.stringify(res.result)), 'listing shows index.html');
});
done('openrouter loop');
