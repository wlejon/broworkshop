// lib/kit/chat-view.js — the transcript of an agent conversation, rendered
// from lib/kit/agent.js events. Styles: lib/kit/chat.css.
//
//   import { chatView, contextMeter } from "/lib/kit/chat-view.js";
//   const meter = contextMeter('#ctx-meter');
//   const chat = chatView('#transcript', { status, meter, stackTools: true,
//                                          autoApprove: () => $('#auto-approve').checked });
//   const agent = createAgent({ ..., onEvent: chat.onEvent, approve: chat.approve });
//   chat.addUser(text); await agent.prompt(text);
//
// What it draws: "You" rows (verbatim text), "Agent" rows (Markdown via
// lib/markdown.js, repainted at most once a frame while streaming, code blocks
// get a Copy button), a collapsed reasoning fold above a reply, one card per
// tool call (name, one-line argument summary, state; edit_file shows a
// red/green line diff; a long successful result collapses itself), and the
// inline Approve / Approve all / Deny prompt. The view follows new output
// while the user is parked at the bottom, and stays put when they scroll up.

import { h, clear } from "./dom.js";
import { contentText } from "./agent.js";
import { renderMarkdown } from "../markdown.js";
import { lineDiff } from "../linediff.js";

const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);

/** "12.5k" / "131k" / "900". */
export function fmtTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(Math.round(n));
}

/**
 * The context-window meter (.chat-ctx): a bar that turns amber at 75 % and
 * red at 90 %, plus "used / window ctx". Hidden until something is used.
 * Handle: update(usage) (usage.input + usage.output = the live context),
 * setWindow(n), reset(), used, window.
 */
export function contextMeter(target, opts) {
    const node = el(target);
    node.classList.add('chat-ctx');
    node.title = node.title || 'context window used by this conversation';
    const fill = h('div');
    const nums = h('span.chat-ctx-nums');
    clear(node).appendChild(h('div.chat-ctx-bar', null, fill));
    node.appendChild(nums);
    let used = 0, win = (opts && opts.window) || 8192;
    const paint = () => {
        node.hidden = used <= 0;
        const f = win > 0 ? Math.min(1, used / win) : 0;
        fill.style.width = Math.round(f * 100) + '%';
        nums.textContent = fmtTokens(used) + ' / ' + fmtTokens(win) + ' ctx';
        node.classList.toggle('warn', f >= 0.75 && f < 0.9);
        node.classList.toggle('crit', f >= 0.9);
    };
    paint();
    return {
        update(u) { if (u && typeof u.input === 'number') { used = u.input + (+u.output || 0); paint(); } },
        setWindow(n) { if (n > 0) { win = n; paint(); } },
        reset() { used = 0; paint(); },
        get used() { return used; },
        get window() { return win; },
        el: node,
    };
}

/** One-line summary of a call's defining argument, for the card head. */
export function argsSummary(args) {
    if (!args || typeof args !== 'object') return '';
    const v = ['path', 'command', 'code', 'instruction'].map((k) => args[k]).find((x) => typeof x === 'string') || '';
    const s = v.replace(/\s+/g, ' ').trim();
    return s.length > 80 ? s.slice(0, 79) + '…' : s;
}

function pretty(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    try { return JSON.stringify(x, null, 2); } catch (_) { return String(x); }
}

/** Text of a tool result; falls back to its details as JSON so nothing renders blank. */
export function resultText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    return contentText(result) || pretty(result.details != null ? result.details : result);
}

/** A red/green line diff element (edit_file). */
export function diffView(oldText, newText) {
    return h('div.chat-diff', null, lineDiff(oldText, newText).map((op) =>
        h('div.' + op.type, null, (op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  ') + op.text)));
}

/**
 * The prompt bar driving a lazily created agent.
 * opts:
 *   chat          a chatView (the user row is added there)
 *   input, send, stop   the textarea and buttons (selectors or nodes)
 *   status        a kit statusLine
 *   makeAgent()   -> a lib/kit/agent.js agent, or null when not configured
 *   canMake()     whether makeAgent() would succeed (enables Send); default true
 *   notReady      status text when makeAgent() returns null
 * Enter sends, Shift+Enter is a newline. Handle: send(text?) -> Promise,
 * stop(), invalidate() (next send makes a new agent: new conversation),
 * refresh() (re-enable Send after the backend changes), agent, running.
 */
export function chatSession(opts) {
    const o = opts;
    const input = el(o.input), sendBtn = el(o.send), stopBtn = el(o.stop);
    let agent = null, running = false, stale = false;
    const status = (fn, t) => { if (o.status) o.status[fn](t); };

    const paint = () => {
        sendBtn.disabled = running || !(agent || (o.canMake ? o.canMake() : true));
        stopBtn.disabled = !running;
        input.disabled = running;
    };

    async function send(given) {
        if (running) return;
        const text = (given != null ? String(given) : input.value).trim();
        if (!text) return;
        if (!agent) agent = o.makeAgent();
        if (!agent) { status('error', o.notReady || 'configure a model first'); return; }
        o.chat.addUser(text);
        if (given == null) input.value = '';
        running = true;
        paint();
        let failed = false;
        try { await agent.prompt(text); }
        catch (e) { failed = true; status('error', 'error: ' + ((e && e.message) || e)); }
        finally {
            o.chat.finalize();
            running = false;
            if (stale) { agent = null; stale = false; }
            paint();
            if (!failed && !(o.status && o.status.el.classList.contains('err'))) status('ok', 'ready');
        }
    }

    sendBtn.addEventListener('click', () => send());
    stopBtn.addEventListener('click', () => api.stop());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    const api = {
        send,
        stop() { if (agent && running) { agent.abort(); status('busy', 'stopping…'); } },
        invalidate() { if (running) stale = true; else agent = null; paint(); },
        refresh: paint,
        get agent() { return agent; },
        get running() { return running; },
    };
    paint();
    return api;
}

/**
 * opts:
 *   hint          text of the placeholder shown until the first row (else keeps existing .chat-hint)
 *   status        a kit statusLine: shows working / running tool / model errors
 *   meter         a contextMeter, fed from each assistant message's usage
 *   stackTools    consecutive tool cards fuse into one .chat-stack group
 *   autoApprove() true skips the approval prompt
 *   labels        { user: 'You', agent: 'Agent' }
 * Handle: onEvent(ev), approve(name, args) -> Promise<bool>, addUser(text),
 * addAgent(markdown), addNode(node), finalize(), reset(), el, allowed (Set).
 */
export function chatView(target, opts) {
    const root = el(target);
    const o = Object.assign({ labels: { user: 'You', agent: 'Agent' } }, opts);
    root.classList.add('chat');
    const allowed = new Set();       // tools the user approved for the whole session
    const cards = new Map();         // toolCallId -> card element
    let bubble = null, fold = null;  // the streaming reply row + its reasoning fold
    let stuck = true;
    let pending = null, scheduled = false;

    root.addEventListener('scroll', () => { stuck = root.scrollHeight - root.scrollTop - root.clientHeight < 40; });

    const follow = () => { if (stuck) root.scrollTop = root.scrollHeight; };
    const dropHint = () => { const x = root.querySelector('.chat-hint'); if (x) x.remove(); };
    const status = (fn, text) => { if (o.status) o.status[fn](text); };

    function append(node) { dropHint(); root.appendChild(node); follow(); return node; }

    function row(who, cls, text) {
        const body = h('div.chat-body', null, text || '');
        const r = h('div.chat-row.' + cls, null, h('span.chat-who', null, who), body);
        append(r);
        return r;
    }

    function paintMarkdown(body, text) {
        body.innerHTML = renderMarkdown(text);
        for (const pre of body.querySelectorAll('pre.md-code')) {
            const btn = h('button.chat-copy', { onclick: () => {
                const code = pre.querySelector('code');
                try { navigator.clipboard.writeText(code ? code.textContent : ''); } catch (_) { /* best effort */ }
                btn.textContent = 'Copied';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
            } }, 'Copy');
            pre.appendChild(btn);
        }
    }

    // Streaming repaints coalesce to one per frame: a long reply is not
    // re-parsed on every token.
    function paintSoon(body, text) {
        pending = { body, text };
        if (scheduled) return;
        scheduled = true;
        raf(() => {
            scheduled = false;
            const p = pending;
            pending = null;
            if (p) paintMarkdown(p.body, p.text);
            follow();
        });
    }

    function finalize() {
        if (bubble) bubble.classList.remove('streaming');
        bubble = null;
        fold = null;
    }

    function setThinking(text) {
        if (!text) return;
        if (!fold) {
            const f = h('div.chat-think.collapsed');
            // The toggle binds to this fold, not the mutable `fold` (reset per message).
            f.appendChild(h('div.chat-think-head', { onclick: () => f.classList.toggle('collapsed') }, 'Thinking'));
            f.appendChild(h('div.chat-think-body'));
            if (bubble) root.insertBefore(f, bubble); else append(f);
            fold = f;
        }
        fold.lastChild.textContent = text;
    }

    function setCollapsed(card, on) {
        card.classList.toggle('collapsed', on);
        card.querySelector('.chat-caret').textContent = on ? '▸' : '▾';
    }

    function toolCard(id, name, args) {
        const body = h('div.chat-tool-body');
        const card = h('div.chat-tool', null,
            h('div.chat-tool-head', { onclick: () => setCollapsed(card, !card.classList.contains('collapsed')) },
                h('span.chat-caret', null, '▾'),
                h('span.chat-tool-name', null, name || 'tool'),
                h('span.chat-tool-sum', null, argsSummary(args)),
                h('span.chat-tool-state', null, 'running…')),
            body);
        if (name === 'edit_file' && args && (typeof args.old_text === 'string' || typeof args.new_text === 'string')) {
            if (args.path) body.appendChild(h('div.chat-tool-path', null, args.path));
            body.appendChild(diffView(args.old_text || '', args.new_text || ''));
        } else {
            body.appendChild(h('pre.chat-tool-args', null, pretty(args)));
        }
        finalize();                  // a tool ran: the reply before it is done
        if (o.stackTools) {
            let stack = root.lastElementChild;
            if (!stack || !stack.classList.contains('chat-stack')) stack = append(h('div.chat-stack'));
            stack.appendChild(card);
            follow();
        } else {
            append(card);
        }
        if (id != null) cards.set(id, card);
        return card;
    }

    function resultPre(card) {
        let pre = card.querySelector('.chat-tool-result');
        if (!pre) { pre = h('pre.chat-tool-result'); card.querySelector('.chat-tool-body').appendChild(pre); }
        return pre;
    }

    function finishCard(id, result, isError) {
        const card = cards.get(id);
        if (!card) return;
        card.classList.add(isError ? 'error' : 'done');
        card.querySelector('.chat-tool-state').textContent = isError ? 'error' : 'done';
        const text = resultText(result);
        resultPre(card).textContent = text;
        // Long successful results fold away; errors and diffs stay open.
        const long = text.length > 500 || text.split('\n').length > 8;
        if (!isError && long && !card.querySelector('.chat-diff')) setCollapsed(card, true);
        follow();
    }

    function onEvent(ev) {
        if (!ev || !ev.type) return;
        try {
            switch (ev.type) {
                case 'agent_start': status('busy', 'working…'); break;
                case 'message_update': {
                    const m = ev.message;
                    if (!m || (m.role && m.role !== 'assistant')) break;
                    // Only what is there gets drawn: a tool-call-only or
                    // reasoning-only step makes no empty "Agent" row.
                    setThinking(contentText(m, 'thinking'));
                    const text = contentText(m);
                    if (!text && !bubble) break;
                    if (!bubble) bubble = row(o.labels.agent, 'agent.streaming', '');
                    paintSoon(bubble.lastChild, text);
                    break;
                }
                case 'message_end': {
                    const m = ev.message;
                    if (!m || m.role !== 'assistant') break;
                    setThinking(contentText(m, 'thinking'));
                    if (!bubble && contentText(m)) bubble = row(o.labels.agent, 'agent', '');
                    if (bubble) { pending = null; paintMarkdown(bubble.lastChild, contentText(m)); }
                    finalize();
                    if (o.meter && m.usage) o.meter.update(m.usage);
                    if (m.stopReason === 'error' && m.errorMessage) status('error', 'model error: ' + m.errorMessage);
                    break;
                }
                case 'tool_execution_start':
                    toolCard(ev.toolCallId, ev.toolName, ev.args);
                    status('busy', 'running ' + (ev.toolName || 'tool') + '…');
                    break;
                case 'tool_execution_update': {
                    const card = cards.get(ev.toolCallId);
                    if (card && ev.partialResult != null) { resultPre(card).textContent = resultText(ev.partialResult); follow(); }
                    break;
                }
                case 'tool_execution_end': finishCard(ev.toolCallId, ev.result, !!ev.isError); break;
                case 'turn_end':
                case 'agent_end': finalize(); break;
                default: break;
            }
        } catch (e) {
            console.error('chat-view: render error', e);   // a render glitch never breaks the loop
        }
    }

    function approve(name, args) {
        if ((o.autoApprove && o.autoApprove()) || allowed.has(name)) return Promise.resolve(true);
        return new Promise((resolve) => {
            const code = h('code', null, name || 'tool');
            const ask = h('div.chat-ask', null, 'Run tool ', code, '?');
            const settle = (ok, verb) => {
                card.classList.add('resolved');
                clear(ask).appendChild(document.createTextNode(verb + ' '));
                ask.appendChild(code);
                resolve(ok);
            };
            const card = append(h('div.chat-approve', null, ask,
                h('pre.chat-tool-args', null, pretty(args)),
                h('div.k-row', null,
                    h('button.primary.approve', { onclick: () => settle(true, 'Approved') }, 'Approve'),
                    h('button.approve-all', { onclick: () => { allowed.add(name); settle(true, 'Approving all'); } },
                      'Approve all ' + (name || 'tool')),
                    h('button.danger.deny', { onclick: () => settle(false, 'Denied') }, 'Deny'))));
        });
    }

    return {
        onEvent,
        approve,
        addUser(text) { stuck = true; return row(o.labels.user, 'you', text); },
        addAgent(markdown) { const r = row(o.labels.agent, 'agent', ''); paintMarkdown(r.lastChild, markdown); return r; },
        addNode(node) { return append(node); },
        finalize,
        reset() {
            clear(root);
            cards.clear();
            bubble = fold = pending = null;
            stuck = true;
            if (o.meter) o.meter.reset();
        },
        allowed,
        el: root,
    };
}
