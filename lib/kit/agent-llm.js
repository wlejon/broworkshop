// lib/kit/agent-llm.js — model providers for lib/kit/agent.js.
//
//   brolmStream(brolm)            a local bro.lm model; tool calls are parsed out of
//                                 the text (Hermes/Qwen <tool_call>{...}</tool_call>,
//                                 <think>...</think> reasoning)
//   openrouterStream(cfg)         OpenRouter /chat/completions with native
//                                 structured tool calls (lib/openrouter.js)
//   createBrolmParser(emit)       the pure text -> blocks state machine (tests)
//
// brolm: { model, tokenizer?, family: 'qwen3' | 'qwen35' | 'mistral3',
//          decode(ids) -> string, eosId? }  (see localModel in agent-backend.js)

import { chatCompletion } from "../openrouter.js";

const TOOL_OPEN = '<tool_call>', TOOL_CLOSE = '</tool_call>';
const THINK_OPEN = '<think>', THINK_CLOSE = '</think>';

// Deterministic (no Date/random) so parser tests are reproducible.
let toolCallCounter = 0;

const usage = (input, output) => ({ input: input || 0, output: output || 0 });

function assistant(content, stopReason, u, errorMessage) {
    const m = { role: 'assistant', content, usage: u || usage(), stopReason, timestamp: Date.now() };
    if (errorMessage) m.errorMessage = errorMessage;
    return m;
}

const snapshot = (blocks) => assistant(blocks.map((b) => Object.assign({}, b)), 'stop');

// --- the brolm text parser -----------------------------------------------------

/**
 * A model-free state machine that segments growing decoded text into text /
 * thinking / toolCall blocks. push(fullText) takes the whole decoded text so
 * far (it processes only the new suffix); finish() closes dangling blocks (an
 * unterminated tool call falls back to text). emit gets
 * { type, contentIndex?, delta?, toolCall?, partial }: start, text_start /
 * text_delta / text_end, thinking_*, toolcall_start / toolcall_delta /
 * toolcall_end. blocks(), sawToolCall().
 */
export function createBrolmParser(emit) {
    const blocks = [];
    let started = false, full = '', pos = 0, mode = 'text', toolStart = 0, sawTool = false;
    let open = null;   // { kind: 'text' | 'thinking', idx, block }

    const ev = (type, extra) => emit(Object.assign({ type, partial: snapshot(blocks) }, extra));

    function delta(kind, s) {
        if (!s) return;
        if (open && open.kind !== kind) close();
        if (!open) {
            const block = kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' };
            open = { kind, idx: blocks.length, block };
            blocks.push(block);
            ev(kind + '_start', { contentIndex: open.idx });
        }
        if (kind === 'text') open.block.text += s; else open.block.thinking += s;
        ev(kind + '_delta', { contentIndex: open.idx, delta: s });
    }
    function close() {
        if (!open) return;
        const o = open;
        open = null;
        ev(o.kind + '_end', { contentIndex: o.idx, content: o.kind === 'text' ? o.block.text : o.block.thinking });
    }
    // Chars at the end of full (from `from`) that could start `tag`: held back
    // so a half-arrived tag never leaks into a delta.
    function holdback(tag, from) {
        for (let k = Math.min(tag.length - 1, full.length - from); k > 0; k--) {
            if (full.endsWith(tag.slice(0, k))) return k;
        }
        return 0;
    }
    function toolClosed(inner) {
        let parsed = null;
        try { parsed = JSON.parse(inner.trim()); } catch (_) { parsed = null; }
        if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
            delta('text', TOOL_OPEN + inner + TOOL_CLOSE);    // malformed: keep it visible as text
            return;
        }
        close();
        const call = { type: 'toolCall', id: 'call_' + toolCallCounter++, name: parsed.name,
                       arguments: parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {} };
        const idx = blocks.length;
        blocks.push(call);
        sawTool = true;
        ev('toolcall_start', { contentIndex: idx });
        ev('toolcall_delta', { contentIndex: idx, delta: inner });
        ev('toolcall_end', { contentIndex: idx, toolCall: Object.assign({}, call) });
    }
    function run() {
        for (;;) {
            if (mode === 'tool') {
                const j = full.indexOf(TOOL_CLOSE, toolStart);
                if (j === -1) return;
                mode = 'text';
                pos = j + TOOL_CLOSE.length;
                toolClosed(full.slice(toolStart, j));
                continue;
            }
            if (mode === 'think') {
                const j = full.indexOf(THINK_CLOSE, pos);
                if (j === -1) {
                    const end = Math.max(pos, full.length - holdback(THINK_CLOSE, pos));
                    if (end > pos) { delta('thinking', full.slice(pos, end)); pos = end; }
                    return;
                }
                delta('thinking', full.slice(pos, j));
                close();
                mode = 'text';
                pos = j + THINK_CLOSE.length;
                continue;
            }
            const iTool = full.indexOf(TOOL_OPEN, pos), iThink = full.indexOf(THINK_OPEN, pos);
            const tool = iTool !== -1 && (iThink === -1 || iTool <= iThink);
            const next = tool ? iTool : iThink;
            if (next === -1) {
                const end = Math.max(pos, full.length - Math.max(holdback(TOOL_OPEN, pos), holdback(THINK_OPEN, pos)));
                if (end > pos) { delta('text', full.slice(pos, end)); pos = end; }
                return;
            }
            delta('text', full.slice(pos, next));
            close();
            if (tool) { mode = 'tool'; toolStart = pos = next + TOOL_OPEN.length; }
            else { mode = 'think'; pos = next + THINK_OPEN.length; }
        }
    }

    return {
        push(text) {
            full = text;
            if (!started) { started = true; ev('start'); }
            run();
        },
        finish() {
            if (mode === 'tool') { delta('text', TOOL_OPEN + full.slice(toolStart)); mode = 'text'; }
            else if (mode === 'think') { delta('thinking', full.slice(pos)); mode = 'text'; }
            close();
        },
        blocks: () => blocks,
        sawToolCall: () => sawTool,
    };
}

// --- ChatML prompt (bro's applyChatTemplate drops tools) -----------------------

const turn = (role, content) => '<|im_start|>' + role + '\n' + content + '<|im_end|>\n';
const blocksText = (content) => (typeof content === 'string' ? content
    : content.map((b) => (b.type === 'text' ? b.text : b.type === 'image' ? '[image:' + b.mimeType + ']' : '')).join(''));

/** The Hermes tool block appended to the system prompt. */
export function toolsPrompt(tools) {
    if (!tools || !tools.length) return '';
    const sigs = tools.map((t) => JSON.stringify({ type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters } }));
    return '\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n' +
        'You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n' + sigs.join('\n') +
        '\n</tools>\n\nTo call a function, respond with a JSON object wrapped in <tool_call></tool_call> tags:\n' +
        '<tool_call>{"name": <function-name>, "arguments": <arguments-json-object>}</tool_call>';
}

/** The whole conversation as a ChatML prompt ending on the assistant turn. */
export function buildChatML(context) {
    const parts = [];
    const sys = (context.systemPrompt || '') + toolsPrompt(context.tools);
    if (sys) parts.push(turn('system', sys));
    for (const m of context.messages) {
        if (m.role === 'user') parts.push(turn('user', blocksText(m.content)));
        else if (m.role === 'toolResult') parts.push(turn('tool', m.content.map((b) => blocksText([b])).join('\n')));
        else if (m.role === 'assistant') {
            // Thinking is not replayed; tool calls go back in their tag form.
            const s = m.content.map((b) => (b.type === 'text' ? b.text
                : b.type === 'toolCall' ? TOOL_OPEN + JSON.stringify({ name: b.name, arguments: b.arguments }) + TOOL_CLOSE : ''))
                .filter(Boolean).join('\n');
            parts.push(turn('assistant', s));
        }
    }
    parts.push('<|im_start|>assistant\n');
    return parts.join('');
}

/** A provider over bro.lm.generate. Default maxTokens 2048, temperature 0.7. */
export function brolmStream(brolm) {
    return (context, opts, emit) => new Promise((resolve) => {
        const parser = createBrolmParser((e) => emit(e));
        let settled = false;
        const finish = (msg) => { if (!settled) { settled = true; resolve(msg); } };
        try {
            const chatml = buildChatML(context);
            // qwen35 drives its own tokenizer from a string; the GGUF families take ids.
            const prompt = brolm.family === 'qwen35' || !brolm.tokenizer ? chatml
                         : brolm.family === 'mistral3' ? brolm.tokenizer.encode(chatml, false)
                         : brolm.tokenizer.encode(chatml);
            const inputTokens = typeof prompt === 'string' ? 0 : prompt.length;
            const acc = [];
            const decode = (ids) => { try { return brolm.decode(ids); } catch (_) { return ''; } };
            const gen = {
                maxNewTokens: (opts && opts.maxTokens) || 2048,
                sampling: { temperature: opts && opts.temperature != null ? opts.temperature : 0.7 },
                onToken: (id) => { acc.push(id); parser.push(decode(acc)); },
                onDone: (ids, info) => {
                    const all = ids && ids.length ? ids : acc;
                    parser.push(decode(all));
                    parser.finish();
                    const u = usage(inputTokens, all.length);
                    if (info && info.cancelled) return finish(assistant(parser.blocks(), 'aborted', u, 'aborted'));
                    if (info && info.error) return finish(assistant(parser.blocks(), 'error', u, String(info.error)));
                    finish(assistant(parser.blocks(), parser.sawToolCall() ? 'toolUse' : 'stop', u));
                },
            };
            if (brolm.eosId !== undefined) gen.eosId = brolm.eosId;
            const handle = bro.lm.generate(brolm.model, prompt, gen);
            const signal = opts && opts.signal;
            if (signal) {
                const cancel = () => { try { handle && handle.cancel && handle.cancel(); } catch (_) {} };
                if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
            }
        } catch (e) {
            finish(assistant(parser.blocks(), 'error', usage(), (e && e.message) || String(e)));
        }
    });
}

// --- OpenRouter ----------------------------------------------------------------

const imageUrl = (b) => ({ type: 'image_url', image_url: { url: 'data:' + b.mimeType + ';base64,' + b.data } });

/** OpenAI-style `messages` for a context. Tool-result images follow as a user turn (vision models only). */
export function openaiMessages(context, vision) {
    const out = [];
    if (context.systemPrompt) out.push({ role: 'system', content: context.systemPrompt });
    for (const m of context.messages) {
        if (m.role === 'user') {
            out.push({ role: 'user', content: typeof m.content === 'string' ? m.content
                : m.content.map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : imageUrl(b))) });
        } else if (m.role === 'assistant') {
            const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
            const calls = m.content.filter((b) => b.type === 'toolCall').map((b) => ({
                id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.arguments || {}) } }));
            if (!text && !calls.length) continue;        // some providers reject empty assistant turns
            const msg = { role: 'assistant', content: text };
            if (calls.length) msg.tool_calls = calls;
            out.push(msg);
        } else if (m.role === 'toolResult') {
            const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
            const images = m.content.filter((b) => b.type === 'image');
            out.push({ role: 'tool', tool_call_id: m.toolCallId,
                       content: text || (images.length ? '(see attached image)' : '(no tool output)') });
            if (images.length && vision) out.push({ role: 'user', content: images.map(imageUrl) });
        }
    }
    return out;
}

let fallbackToolId = 0;

/**
 * A provider over OpenRouter chat completions (non-streaming: one request per
 * turn, replayed as events). cfg: lib/openrouter.js chatCompletion cfg plus
 * { model, vision }. Default maxTokens 16384: whole-file write_file calls
 * plus a reasoning model's hidden tokens must fit in one completion.
 */
export function openrouterStream(cfg) {
    return async (context, opts, emit) => {
        const signal = opts && opts.signal;
        try {
            const payload = {
                model: cfg.model,
                messages: openaiMessages(context, !!cfg.vision),
                max_tokens: (opts && opts.maxTokens) || 16384,
                temperature: opts && opts.temperature != null ? opts.temperature : 0.7,
                stream: false,
            };
            if (context.tools && context.tools.length) {
                payload.tools = context.tools.map((t) => ({ type: 'function',
                    function: { name: t.name, description: t.description, parameters: t.parameters } }));
                payload.tool_choice = 'auto';
            }
            const body = await chatCompletion(cfg, payload, signal);
            const choice = (body.choices && body.choices[0]) || {};
            const msg = choice.message || {};
            const finish = choice.finish_reason;
            const blocks = [];
            emit({ type: 'start', partial: snapshot(blocks) });
            const reasoning = typeof msg.reasoning === 'string' ? msg.reasoning : '';
            if (reasoning) {
                blocks.push({ type: 'thinking', thinking: reasoning });
                emit({ type: 'thinking_delta', contentIndex: 0, delta: reasoning, partial: snapshot(blocks) });
            }
            if (typeof msg.content === 'string' && msg.content) {
                blocks.push({ type: 'text', text: msg.content });
                emit({ type: 'text_delta', contentIndex: blocks.length - 1, delta: msg.content, partial: snapshot(blocks) });
            }
            for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
                const fn = tc.function || {};
                let args;
                // Strict: truncated tool JSON (finish_reason "length") must fail the
                // turn visibly, not become a call with empty args that loops forever.
                try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; }
                catch (_) {
                    throw new Error("tool call '" + (fn.name || 'unknown') + "' arguments are not valid JSON (finish_reason=" +
                                    (finish || 'unknown') + (finish === 'length' ? ', completion truncated by max_tokens' : '') + ')');
                }
                const call = { type: 'toolCall', id: tc.id || 'call_or' + fallbackToolId++, name: fn.name || 'unknown', arguments: args };
                blocks.push(call);
                emit({ type: 'toolcall_end', contentIndex: blocks.length - 1, toolCall: Object.assign({}, call), partial: snapshot(blocks) });
            }
            const u = body.usage || {};
            const sawTool = blocks.some((b) => b.type === 'toolCall');
            return assistant(blocks, sawTool ? 'toolUse' : finish === 'length' ? 'length' : 'stop',
                             usage(u.prompt_tokens, u.completion_tokens));
        } catch (e) {
            const m = (e && e.message) || String(e);
            const aborted = (signal && signal.aborted) || /abort/i.test(m);
            return assistant([], aborted ? 'aborted' : 'error', usage(), m);
        }
    };
}
