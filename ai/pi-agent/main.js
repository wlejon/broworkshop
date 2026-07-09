// Pi Agent — a chat UI over an autonomous, tool-using agent running a local LLM.
//
// The agent brain is the pre-built `pi.bundle.js` harness (createAgentSession).
// This file only: (1) loads a bro.lm model and hands it to the session as a
// `brolm` object, (2) renders the pi AgentEvent stream into the transcript, and
// (3) wires the prompt/stop controls and the tool-approval gate.
//
// Model loading mirrors demos/lm-playground (the definitive bro.lm reference).

import { installSystemMenu } from "/lib/system-menu.js";
import { createAgentSession } from "/app/pi.bundle.js";
import { renderMarkdown } from "/lib/markdown.js";
import { lineDiff } from "/lib/linediff.js";

const fs = require('fs');
const $ = (s) => document.querySelector(s);

// Targets a Qwen3 dense GGUF; first existing candidate prefills the path input.
// Bigger models follow the tool-call JSON contract far more reliably — an 8B
// routinely drops a quote and dead-ends the turn, so prefer 32B when present.
const MODEL_CANDIDATES = [
    'D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf',
    'D:/projects/brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf',
    'D:/projects/brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-BF16.gguf',
];

// Working dir the agent's file/shell tools operate in.
function agentCwd() {
    try { return require('process').cwd(); } catch (e) { return 'D:/projects/broworkshop'; }
}

let session = null;      // pi agent session (created once the model is ready)
let running = false;     // a turn is in flight

// Tool names the user chose to always allow for this session (Approve all).
const sessionAllow = new Set();

// ── status helper ──────────────────────────────────────────────────────────
function setStatus(text, cls) {
    const el = $('#status');
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
}

function firstExisting(list) {
    for (const p of list) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
    return list[0];
}

// ── transcript helpers ──────────────────────────────────────────────────────
const transcript = () => $('#transcript');

// Auto-scroll only while the user is parked at the bottom; if they scroll up to
// read, don't yank them back down. The scroll listener (wired in boot) keeps
// `stuckToBottom` current; a fresh prompt re-pins it.
let stuckToBottom = true;
function scrollToBottom() {
    if (!stuckToBottom) return;
    const t = transcript();
    t.scrollTop = t.scrollHeight;
}

function clearHint() {
    const hint = transcript().querySelector('.hint');
    if (hint) hint.remove();
}

// A labelled message row ("You" / "Agent").
function addRow(who, cls, text) {
    clearHint();
    const row = document.createElement('div');
    row.className = 'row ' + cls;
    const label = document.createElement('span');
    label.className = 'who';
    label.textContent = who;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text || '';
    row.appendChild(label);
    row.appendChild(body);
    transcript().appendChild(row);
    scrollToBottom();
    return row;
}

// Concatenate the text blocks of an assistant message's content array.
function assistantText(message) {
    const content = message && message.content;
    if (typeof content === 'string') return content;      // defensive: plain string
    if (!Array.isArray(content)) return '';
    let out = '';
    for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') out += block.text;
    }
    return out;
}

// Concatenate the thinking blocks (rendered as a collapsible reasoning fold).
function thinkingText(message) {
    const content = message && message.content;
    if (!Array.isArray(content)) return '';
    let out = '';
    for (const block of content) {
        if (block && block.type === 'thinking' && typeof block.thinking === 'string') out += block.thinking;
    }
    return out;
}

// Pull the text out of a tool result (AgentToolResult: { content:[{type:'text',text}], details }).
function resultText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    const content = result.content;
    if (Array.isArray(content)) {
        let out = '';
        for (const block of content) {
            if (block && block.type === 'text' && typeof block.text === 'string') out += block.text;
        }
        if (out) return out;
    }
    // Fall back to details / JSON so nothing renders as blank.
    try { return JSON.stringify(result.details ?? result, null, 2); } catch (e) { return String(result); }
}

function stringifyArgs(args) {
    if (args == null) return '';
    if (typeof args === 'string') return args;
    try { return JSON.stringify(args, null, 2); } catch (e) { return String(args); }
}

// ── markdown rendering ───────────────────────────────────────────────────────
// Assistant replies are Markdown. Rendering is coalesced to one paint per frame
// so streaming a long reply isn't an O(n²) reparse-on-every-token.
const raf = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);

let mdPending = null;   // { body, text } — latest deferred render
let mdScheduled = false;

function renderInto(body, text) {
    mdPending = { body, text };
    if (mdScheduled) return;
    mdScheduled = true;
    raf(() => {
        mdScheduled = false;
        const p = mdPending;
        mdPending = null;
        if (p && p.body) {
            p.body.innerHTML = renderMarkdown(p.text);
            enhanceCodeBlocks(p.body);
        }
        scrollToBottom();
    });
}

// Final, synchronous commit (message_end) — never left deferred.
function renderNow(body, text) {
    if (!body) return;
    body.innerHTML = renderMarkdown(text);
    enhanceCodeBlocks(body);
}

// Give each rendered code block a Copy button (idempotent within a render pass).
function enhanceCodeBlocks(container) {
    let blocks;
    try { blocks = container.querySelectorAll('pre.md-code'); } catch (e) { return; }
    for (let i = 0; i < blocks.length; i++) {
        const pre = blocks[i];
        if (pre.querySelector('.code-copy')) continue;
        const btn = document.createElement('button');
        btn.className = 'code-copy';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
            const code = pre.querySelector('code');
            copyText(code ? code.textContent : '');
            btn.textContent = 'Copied';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        });
        pre.appendChild(btn);
    }
}

function copyText(text) {
    try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        }
    } catch (e) { /* best-effort */ }
}

// ── event rendering ─────────────────────────────────────────────────────────
// The "current" streaming assistant bubble; reset at each message boundary so a
// new assistant step (after interleaved tool cards) starts a fresh bubble.
let curBubble = null;
let curThinking = null;
// Tool cards keyed by toolCallId, so tool_execution_end can find its card.
const toolCards = new Map();

function ensureBubble() {
    if (!curBubble) {
        curBubble = addRow('Agent', 'agent streaming', '');
    }
    return curBubble;
}

function finalizeBubble() {
    if (curBubble) curBubble.classList.remove('streaming');
    curBubble = null;
    curThinking = null;
}

// Reasoning fold — a collapsible "💭 Thinking" disclosure placed above the
// current agent bubble. Collapsed by default; click the header to expand.
function setThinking(row, text) {
    if (!text) return;
    if (!curThinking) {
        curThinking = document.createElement('div');
        curThinking.className = 'thinking collapsed';
        const head = document.createElement('div');
        head.className = 'thinking-head';
        head.textContent = '💭 Thinking';
        head.addEventListener('click', () => curThinking.classList.toggle('collapsed'));
        const bodyEl = document.createElement('div');
        bodyEl.className = 'thinking-body';
        curThinking.appendChild(head);
        curThinking.appendChild(bodyEl);
        // Place the fold just before the current agent bubble.
        transcript().insertBefore(curThinking, row);
    }
    const bodyEl = curThinking.querySelector('.thinking-body');
    if (bodyEl) bodyEl.textContent = text;
}

function setCardCollapsed(card, collapsed) {
    card.classList.toggle('collapsed', collapsed);
    const caret = card.querySelector('.tool-caret');
    if (caret) caret.textContent = collapsed ? '▸' : '▾';
}

// Build a red/green line-diff element from edit_file's old_text/new_text.
function buildDiffEl(oldText, newText) {
    const wrap = document.createElement('div');
    wrap.className = 'diff';
    const ops = lineDiff(oldText, newText);
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const ln = document.createElement('div');
        ln.className = 'diff-line ' + op.type;
        const sign = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
        ln.textContent = sign + ' ' + op.text;
        wrap.appendChild(ln);
    }
    return wrap;
}

function addToolCard(toolCallId, toolName, args) {
    clearHint();
    const card = document.createElement('div');
    card.className = 'tool-card';

    const head = document.createElement('div');
    head.className = 'tool-head';
    const caret = document.createElement('span');
    caret.className = 'tool-caret';
    caret.textContent = '▾';
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = toolName || 'tool';
    const state = document.createElement('span');
    state.className = 'tool-state';
    state.textContent = 'running…';
    head.appendChild(caret);
    head.appendChild(name);
    head.appendChild(state);
    head.addEventListener('click', () => setCardCollapsed(card, !card.classList.contains('collapsed')));

    const body = document.createElement('div');
    body.className = 'tool-body';

    // edit_file renders a red/green diff of its change instead of raw JSON args.
    if (toolName === 'edit_file' && args && typeof args === 'object' &&
        (typeof args.old_text === 'string' || typeof args.new_text === 'string')) {
        if (args.path) {
            const pathLine = document.createElement('div');
            pathLine.className = 'tool-path';
            pathLine.textContent = args.path;
            body.appendChild(pathLine);
        }
        body.appendChild(buildDiffEl(args.old_text || '', args.new_text || ''));
    } else {
        const argsPre = document.createElement('pre');
        argsPre.className = 'tool-args';
        argsPre.textContent = stringifyArgs(args);
        body.appendChild(argsPre);
    }

    card.appendChild(head);
    card.appendChild(body);
    transcript().appendChild(card);
    if (toolCallId != null) toolCards.set(toolCallId, card);

    // A tool ran → the previous assistant bubble is done.
    finalizeBubble();
    scrollToBottom();
    return card;
}

// Ensure a card has a .tool-result <pre> under its body, returning it.
function ensureResultPre(card) {
    let resPre = card.querySelector('.tool-result');
    if (!resPre) {
        resPre = document.createElement('pre');
        resPre.className = 'tool-result';
        (card.querySelector('.tool-body') || card).appendChild(resPre);
    }
    return resPre;
}

function finishToolCard(toolCallId, result, isError) {
    const card = toolCallId != null ? toolCards.get(toolCallId) : null;
    if (!card) return;
    card.classList.add(isError ? 'error' : 'done');
    const state = card.querySelector('.tool-state');
    if (state) state.textContent = isError ? 'error' : 'done';
    const text = resultText(result);
    ensureResultPre(card).textContent = text;

    // Auto-collapse a long, successful result to keep the transcript scannable;
    // errors stay open, and edit_file stays open (its diff is the whole point).
    const isEdit = card.querySelector('.diff') != null;
    const longResult = text.length > 500 || text.split('\n').length > 8;
    if (!isError && !isEdit && longResult) setCardCollapsed(card, true);
    scrollToBottom();
}

// The single onEvent handler. Every field access is guarded — pi payloads vary.
function onEvent(event) {
    if (!event || !event.type) return;
    try {
        switch (event.type) {
            case 'agent_start':
                setStatus('working…', 'running');
                break;

            case 'message_start':
                // Only assistant messages get a live bubble; user/toolResult
                // messages are rendered by their own paths (send / tool cards).
                break;

            case 'message_update': {
                // Live streaming update of the in-progress assistant message.
                const msg = event.message;
                if (!msg || (msg.role && msg.role !== 'assistant')) break;
                const row = ensureBubble();
                const body = row.querySelector('.body');
                if (body) renderInto(body, assistantText(msg));
                setThinking(row, thinkingText(msg));
                break;
            }

            case 'message_end': {
                const msg = event.message;
                if (msg && (!msg.role || msg.role === 'assistant') && Array.isArray(msg.content)) {
                    // Commit the final assistant text, then close the bubble.
                    if (curBubble) {
                        const body = curBubble.querySelector('.body');
                        if (body) renderNow(body, assistantText(msg));
                    }
                    finalizeBubble();
                }
                break;
            }

            case 'tool_execution_start':
                addToolCard(event.toolCallId, event.toolName, event.args);
                setStatus('running ' + (event.toolName || 'tool') + '…', 'running');
                break;

            case 'tool_execution_update':
                // Streaming partials — refresh the card's result preview if present.
                if (event.partialResult != null) {
                    const card = toolCards.get(event.toolCallId);
                    if (card) {
                        ensureResultPre(card).textContent = resultText(event.partialResult);
                        scrollToBottom();
                    }
                }
                break;

            case 'tool_execution_end':
                finishToolCard(event.toolCallId, event.result, !!event.isError);
                break;

            case 'turn_end':
                finalizeBubble();
                break;

            case 'agent_end':
                finalizeBubble();
                break;

            default:
                break;
        }
    } catch (e) {
        // A render glitch must never break the agent loop.
        console.error('pi-agent render error', e);
    }
}

// ── tool-approval gate ──────────────────────────────────────────────────────
// Auto-approve checked (or the tool is on the session allow-list) → resolve true
// immediately. Otherwise render inline Approve / Approve-all / Deny buttons and
// resolve the promise when one is clicked.
function approve(toolName, args) {
    if ($('#auto-approve').checked || sessionAllow.has(toolName)) return Promise.resolve(true);

    return new Promise((resolve) => {
        clearHint();
        const card = document.createElement('div');
        card.className = 'approve-card';

        const ask = document.createElement('div');
        ask.className = 'ask';
        ask.textContent = 'Run tool ';
        const code = document.createElement('code');
        code.textContent = toolName || 'tool';
        ask.appendChild(code);
        ask.appendChild(document.createTextNode('?'));

        const argsPre = document.createElement('pre');
        argsPre.className = 'tool-args';
        argsPre.style.fontSize = '11px';
        argsPre.style.marginTop = '6px';
        argsPre.textContent = stringifyArgs(args);

        const btns = document.createElement('div');
        btns.className = 'btns';
        const yes = document.createElement('button');
        yes.className = 'approve';
        yes.textContent = 'Approve';
        const all = document.createElement('button');
        all.className = 'approve-all';
        all.textContent = 'Approve all ' + (toolName || 'tool');
        const no = document.createElement('button');
        no.className = 'deny';
        no.textContent = 'Deny';
        btns.appendChild(yes);
        btns.appendChild(all);
        btns.appendChild(no);

        card.appendChild(ask);
        card.appendChild(argsPre);
        card.appendChild(btns);
        transcript().appendChild(card);
        scrollToBottom();

        const settle = (ok, label) => {
            card.classList.add('resolved');
            ask.textContent = label + ' ';
            ask.appendChild(code);
            resolve(ok);
        };
        yes.addEventListener('click', () => settle(true, 'Approved'));
        all.addEventListener('click', () => {
            sessionAllow.add(toolName);
            settle(true, 'Approving all');
        });
        no.addEventListener('click', () => settle(false, 'Denied'));
    });
}

// ── model loading ───────────────────────────────────────────────────────────
function loadModel() {
    const path = $('#model-path').value.trim();
    if (!path) return;
    $('#btn-load').disabled = true;
    $('#btn-send').disabled = true;
    setStatus('loading model…', 'loading');

    const onError = (e) => {
        $('#btn-load').disabled = false;
        setStatus('load failed: ' + (e && e.message ? e.message : e), 'error');
    };

    try {
        bro.lm.loadQwen(path, {
            onReady: ({ model, tokenizer }) => {
                const brolm = {
                    model,
                    tokenizer,
                    family: 'qwen3',
                    decode: (ids) => tokenizer.decode(Array.from(ids)),
                    eosId: tokenizer.imEndId,
                };
                session = createAgentSession({
                    brolm,
                    cwd: agentCwd(),
                    onEvent,
                    approve,
                });
                $('#btn-load').disabled = false;
                $('#btn-send').disabled = false;
                setStatus('ready (' + model.numLayers + ' layers)', 'ready');
            },
            onError,
        });
    } catch (e) {
        onError(e.message || String(e));
    }
}

// ── send / stop ─────────────────────────────────────────────────────────────
function setRunning(on) {
    running = on;
    $('#btn-send').disabled = on || !session;
    $('#btn-stop').disabled = !on;
    $('#prompt').disabled = on;
}

async function send() {
    if (!session || running) return;
    const text = $('#prompt').value.trim();
    if (!text) return;

    stuckToBottom = true; // a fresh prompt re-pins the transcript to the bottom
    addRow('You', 'you', text);
    $('#prompt').value = '';
    setRunning(true);
    setStatus('working…', 'running');

    try {
        await session.prompt(text);
    } catch (e) {
        setStatus('error: ' + (e && e.message ? e.message : e), 'error');
    } finally {
        finalizeBubble();
        setRunning(false);
        if ($('#status').className.indexOf('error') === -1) setStatus('ready', 'ready');
    }
}

function stop() {
    if (session && running) session.abort();
    setStatus('stopping…', 'loading');
}

// ── wiring ──────────────────────────────────────────────────────────────────
$('#btn-load').addEventListener('click', loadModel);
$('#btn-send').addEventListener('click', send);
$('#btn-stop').addEventListener('click', stop);

// Enter sends; Shift+Enter inserts a newline.
$('#prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
    }
});

(function boot() {
    installSystemMenu();
    $('#model-path').value = firstExisting(MODEL_CANDIDATES);
    const t = transcript();
    t.addEventListener('scroll', () => {
        stuckToBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
    });
})();
