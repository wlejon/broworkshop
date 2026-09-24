// Maker Agent — an agent that AUTHORS a small web app (files on disk), LOOKS at
// how it renders in a live <iframe> preview (through a vision model), and
// REFINES it until it matches the request, all inside this running bro app.
//
// The loop is lib/kit/agent.js; the brain is an OpenRouter tool-calling model
// (native tool calls) or a local bro.lm model (lib/kit/agent-backend.js); the
// tools are lib/kit/agent-tools.js plus `look` (look.js); the transcript is
// lib/kit/chat-view.js. The agent writes into project/, which is exactly the
// directory the preview renders.
//
// Tests import this module (not main.js) and drive it through `maker`.

import { boot, $ } from "/lib/kit/index.js";
import { prefStore } from "/lib/kit/prefs.js";
import { createAgent } from "/lib/kit/agent.js";
import { codingTools, lookTool } from "/lib/kit/agent-tools.js";
import { agentBackend } from "/lib/kit/agent-backend.js";
import { chatView, chatSession, contextMeter } from "/lib/kit/chat-view.js";
import { previewLook, renderPreview, capturePreview } from "/app/look.js";

export const LOCAL_MODELS = [
    'brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf',
    'brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
    'brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf',
];

export const SYSTEM_PROMPT = [
    'You are an autonomous MAKER agent running INSIDE the bro engine (an HTML/CSS/JS app runtime).',
    'Your job: BUILD a small web app that fulfills the request, LOOK at how it renders, and REFINE it until it matches.',
    'Your working directory is a project folder. Author the app there with your file tools: write `index.html` (the',
    'entry point) plus any `style.css`, `script.js`, or assets it needs. It starts with a placeholder page you',
    'replace by writing `index.html`; you can `look` at any time to see whatever is currently rendered.',
    'WHAT THE PREVIEW CAN RUN: standard web only: HTML, CSS, plain JavaScript, and the 2D <canvas> context',
    "(canvas.getContext('2d')). That is the whole toolbox; it is plenty for UIs, layouts, games, charts, and",
    '2D-canvas animation (drive motion with requestAnimationFrame). The preview does NOT provide WebGL, the `bro.*`',
    'engine APIs, `bro.scene`/3D, physics, or audio: do not call them; they are undefined and your app will render',
    'blank. Build with the DOM, CSS, and 2D canvas.',
    'Use classic scripts only (<script src="script.js"></script>, NOT ES modules) and no network access.',
    'The project renders LIVE in an on-screen preview beside this chat. After you write or edit files, call the `look`',
    "tool: it reloads the preview from your files and returns a vision model's description of what ACTUALLY rendered.",
    'Use what you see to fix layout, color, sizing, and content: write, look, refine, in small steps.',
    'When the preview matches the request, stop and briefly say what you built. Prefer real files; `eval_js` is only an',
    'escape hatch for poking the host engine, and anything it draws is NOT part of the preview the user sees.',
].join(' ');

/** The agent's working directory: the folder the preview iframe renders. */
export const PROJECT_DIR = String(bro.appDir || '.').replace(/\\/g, '/').replace(/\/+$/, '') + '/project';

const { status } = boot({
    menu: { view: [{ id: 'preview.reload', label: 'Reload preview' }],
            handlers: { 'preview.reload': () => renderPreview(preview) } },
});

// Settings moved from per-key "maker.*" entries to one prefStore object;
// carry the old ones over once.
const prefs = prefStore('maker-agent', {});
if (!prefs.snapshot()) {
    const old = (k) => { try { return window.localStorage.getItem('maker.' + k); } catch (_) { return null; } };
    const migrated = {};
    for (const [from, to] of [['backend', 'backend'], ['orKey', 'orKey'], ['brain', 'brain'], ['vision', 'vision'], ['brolmPath', 'localPath']]) {
        const v = old(from);
        if (v) migrated[to] = v;
    }
    if (Object.keys(migrated).length) prefs.set(migrated);
}

const preview = $('#preview');
const meter = contextMeter('#ctx-meter');
const chat = chatView('#transcript', { status, meter, stackTools: true, autoApprove: () => $('#auto-approve').checked });

const backend = agentBackend('#backend', {
    kinds: ['openrouter', 'brolm'], vision: true, prefs, status, localCandidates: LOCAL_MODELS, title: 'Maker Agent',
    onChange: () => { session.invalidate(); },
});

const look = previewLook({ preview, chat, backend, status });

const session = chatSession({
    chat, status, input: '#prompt', send: '#btn-send', stop: '#btn-stop',
    notReady: 'configure a backend first (key + model, or load a local model)',
    canMake: () => backend.ready,
    makeAgent: () => {
        const stream = backend.stream();
        if (!stream) return null;
        meter.setWindow(backend.contextWindow);
        return createAgent({
            stream, systemPrompt: SYSTEM_PROMPT,
            tools: codingTools(PROJECT_DIR).concat([lookTool(look)]),
            onEvent: chat.onEvent, approve: chat.approve,
        });
    },
});
// The key field edits the backend without a change event until blur; keep Send current.
$('#or-key').addEventListener('input', () => session.refresh());
session.refresh();

/** The app's surface for the console and tests. */
export const maker = {
    chat, session, backend, meter, status, prefs, preview,
    /** { kind, key, brain, vision, path } — see agentBackend.configure. */
    configure: (c) => backend.configure(c),
    /** A turn through the real prompt path (same as typing + Send). */
    prompt: (text) => session.send(text),
    look,
    capturePreview: () => capturePreview(preview),
    renderPreview: () => renderPreview(preview),
    reset() { session.invalidate(); chat.reset(); },
};
