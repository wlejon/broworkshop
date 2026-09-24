// Pi Agent — a chat UI over an autonomous, tool-using agent on a local LLM.
//
// The loop is lib/kit/agent.js; the model is a bro.lm Qwen3 GGUF (or a
// Qwen3.5 checkpoint) talking through lib/kit/agent-llm.js's <tool_call>
// parser; the tools are lib/kit/agent-tools.js (files, bash, eval_js); the
// transcript is lib/kit/chat-view.js. This file wires them to the page and
// adds the scripted demo sessions (demo.js) for working on the UI without a
// model loaded.
//
// Tests import this module (not main.js) and drive it through `piAgent`.

import { boot, $ } from "/lib/kit/index.js";
import { prefStore } from "/lib/kit/prefs.js";
import { createAgent } from "/lib/kit/agent.js";
import { codingTools } from "/lib/kit/agent-tools.js";
import { agentBackend } from "/lib/kit/agent-backend.js";
import { chatView, chatSession, contextMeter } from "/lib/kit/chat-view.js";
import { runDemoSession, fillTranscript } from "/app/demo.js";

// Bigger models follow the tool-call JSON contract far more reliably (an 8B
// routinely drops a quote and dead-ends the turn), so the largest on disk wins.
export const LOCAL_MODELS = [
    'brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf',
    'brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
    'brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
    'brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf',
    'brolm/weights/Qwen3.5-0.8B',
];

export const SYSTEM_PROMPT = [
    'You are an autonomous agent running INSIDE the bro engine (an HTML/CSS/JS app runtime).',
    'You control the running app and the machine through your tools. Work in small steps:',
    'call a tool, read its result, then decide the next step. When the task is done, stop and',
    'summarize what you did. Prefer the file and bash tools for the filesystem, and use eval_js',
    'to inspect or drive the live engine (the DOM, the global `bro` API, the scene, settings).',
].join(' ');

/** The directory the file and shell tools work in: the process CWD, else the app dir. */
export function agentCwd() {
    try { return require('process').cwd().replace(/\\/g, '/'); }
    catch (_) { return String(bro.appDir || '.').replace(/\\/g, '/'); }
}

const menu = {
    view: [
        { id: 'demo.run', label: 'Simulate demo session' },
        { id: 'demo.fill', label: 'Fill transcript (scroll test)' },
        { separator: true },
        { id: 'demo.reset', label: 'Clear transcript' },
    ],
    handlers: {
        'demo.run': () => piAgent.runDemo(),
        'demo.fill': () => piAgent.fill(),
        'demo.reset': () => piAgent.reset(),
    },
};

const { status } = boot({ menu });
const prefs = prefStore('pi-agent', {});
const cwd = agentCwd();
$('#cwd').textContent = 'cwd ' + cwd;

const meter = contextMeter('#ctx-meter');
const chat = chatView('#transcript', { status, meter, autoApprove: () => $('#auto-approve').checked });

const backend = agentBackend('#backend', {
    kinds: ['brolm'], prefs, status, localCandidates: LOCAL_MODELS,
    onChange: () => { if (session) session.invalidate(); },
});

const session = chatSession({
    chat, status, input: '#prompt', send: '#btn-send', stop: '#btn-stop',
    notReady: 'load a model first',
    canMake: () => backend.ready,
    makeAgent: () => {
        const stream = backend.stream();
        if (!stream) return null;
        meter.setWindow(backend.contextWindow);
        return createAgent({ stream, tools: codingTools(cwd), systemPrompt: SYSTEM_PROMPT,
                             onEvent: chat.onEvent, approve: chat.approve });
    },
});
session.refresh();

// The handler bundle demo.js drives: the real renderer with scripted events.
const demoApi = {
    onEvent: chat.onEvent,
    approve: (name, args) => chat.approve(name, args),
    addUserRow: (text) => chat.addUser(text),
    setUsage: (u) => meter.update(u),
    setStatus: (text, kind) => status.set(text, kind),
    reset: () => chat.reset(),
};

/** The app's surface for the View menu, the console and tests. */
export const piAgent = {
    chat, session, backend, meter, status, prefs, cwd,
    runDemo: (opts) => runDemoSession(demoApi, opts || { live: true }),
    fill: (opts) => fillTranscript(demoApi, opts || { turns: 6 }),
    reset: () => chat.reset(),
};
