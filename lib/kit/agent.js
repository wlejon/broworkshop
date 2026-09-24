// lib/kit/agent.js — a small tool-using agent loop for ai apps.
//
//   import { createAgent } from "/lib/kit/agent.js";
//   import { brolmStream } from "/lib/kit/agent-llm.js";
//   import { codingTools } from "/lib/kit/agent-tools.js";
//   const agent = createAgent({
//       stream: brolmStream(brolm), tools: codingTools(cwd),
//       systemPrompt: '...', onEvent: (ev) => chat.onEvent(ev),
//       approve: (name, args) => true,
//   });
//   await agent.prompt('list the files here');
//
// One prompt() runs turns until the model answers without calling a tool:
// ask the model (streaming), run the tool calls it made, feed the results
// back, repeat. Messages and events use the shapes below, so any renderer
// (lib/kit/chat-view.js) and any provider (lib/kit/agent-llm.js) plug in.
//
// Messages
//   { role: 'user', content: string, timestamp }
//   { role: 'assistant', content: Block[], usage, stopReason, errorMessage?, timestamp }
//       Block: { type: 'text', text } | { type: 'thinking', thinking }
//            | { type: 'toolCall', id, name, arguments }
//       stopReason: 'stop' | 'toolUse' | 'length' | 'error' | 'aborted'
//       usage: { input, output } token counts (input = the live context size)
//   { role: 'toolResult', toolCallId, toolName, content, details, isError, timestamp }
//
// Events (onEvent)
//   agent_start · turn_start · message_start / message_update / message_end
//   ({ message }; updates carry the partial assistant message) ·
//   tool_execution_start ({ toolCallId, toolName, args }) ·
//   tool_execution_update ({ toolCallId, partialResult }) ·
//   tool_execution_end ({ toolCallId, toolName, result, isError }) ·
//   turn_end ({ message, toolResults }) · agent_end ({ messages })
//
// A provider is stream(context, opts, emit) -> Promise<assistant message>:
// context = { systemPrompt, messages, tools }, opts = { signal, maxTokens,
// temperature }; emit({ type, partial }) for each streamed change. It must
// resolve (never reject): failures come back as stopReason 'error'/'aborted'.
//
// A tool is { name, label?, description, parameters (JSON schema object),
// execute(toolCallId, args, signal, onUpdate) -> { content: [{ type: 'text',
// text } | { type: 'image', data, mimeType }], details? } }. A tool that
// throws, or returns details.error, is reported as an error result.

const now = () => Date.now();

/** A tool result carrying one text block. */
export function textResult(text, details) {
    return { content: [{ type: 'text', text: String(text) }], details: details || {} };
}

/** An error tool result ("Error: ..."), flagged details.error. */
export function errorResult(message, details) {
    return { content: [{ type: 'text', text: 'Error: ' + message }], details: Object.assign({ error: true }, details) };
}

/** Concatenated text blocks of a message or tool result ('' when none). */
export function contentText(x, type) {
    const content = x && x.content;
    if (typeof content === 'string') return type && type !== 'text' ? '' : content;
    if (!Array.isArray(content)) return '';
    const t = type || 'text';
    let out = '';
    for (const b of content) {
        if (b && b.type === t) out += (t === 'thinking' ? b.thinking : b.text) || '';
    }
    return out;
}

/**
 * Check `args` against a tool's JSON-schema `parameters` (object properties,
 * required keys, primitive types). Returns a list of problems ([] = valid).
 */
export function checkArgs(schema, args) {
    if (!schema || schema.type !== 'object') return [];
    if (!args || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
    const bad = [];
    for (const key of schema.required || []) {
        if (args[key] === undefined) bad.push('missing required "' + key + '"');
    }
    const props = schema.properties || {};
    for (const key in args) {
        const p = props[key];
        if (!p || !p.type || args[key] === undefined) continue;
        const v = args[key];
        const ok = p.type === 'string' ? typeof v === 'string'
                 : p.type === 'number' || p.type === 'integer' ? typeof v === 'number' && isFinite(v)
                 : p.type === 'boolean' ? typeof v === 'boolean'
                 : p.type === 'array' ? Array.isArray(v)
                 : p.type === 'object' ? v !== null && typeof v === 'object'
                 : true;
        if (!ok) bad.push('"' + key + '" must be ' + p.type);
    }
    return bad;
}

/**
 * opts:
 *   stream        the provider (see the header)
 *   tools         tool objects (default none)
 *   systemPrompt  string
 *   onEvent(ev)   every event; renderer errors are caught and logged
 *   approve(name, args) -> bool | Promise<bool>  gate each call (omit = allow)
 *   maxTokens, temperature   passed to the provider
 *   maxTurns      model round-trips per prompt (default 40)
 * Returns { prompt(text), abort(), waitForIdle(), reset(), messages, running,
 *           tools, systemPrompt }.
 */
export function createAgent(opts) {
    const o = opts || {};
    const tools = (o.tools || []).slice();
    const maxTurns = o.maxTurns || 40;
    let messages = [];
    let running = false;
    let controller = null;
    let idleWaiters = [];

    const emit = (ev) => {
        if (!o.onEvent) return;
        try { o.onEvent(ev); } catch (e) { console.error('agent: onEvent threw', e); }
    };

    async function askModel(signal) {
        const context = { systemPrompt: o.systemPrompt || '', messages: messages.slice(), tools };
        let started = false;
        const onStream = (ev) => {
            if (!ev || !ev.partial) return;
            if (!started) { started = true; emit({ type: 'message_start', message: ev.partial }); }
            emit({ type: 'message_update', message: ev.partial, event: ev });
        };
        let msg = null, thrown = null;
        try {
            msg = await o.stream(context, { signal, maxTokens: o.maxTokens, temperature: o.temperature }, onStream);
        } catch (e) {
            thrown = e;
        }
        if (!msg || msg.role !== 'assistant') {
            msg = {
                role: 'assistant', content: [], usage: { input: 0, output: 0 },
                stopReason: signal.aborted ? 'aborted' : 'error',
                errorMessage: thrown ? String((thrown && thrown.message) || thrown) : 'provider returned no message',
                timestamp: now(),
            };
        }
        if (!started) emit({ type: 'message_start', message: msg });
        emit({ type: 'message_end', message: msg });
        return msg;
    }

    async function runTool(call, signal) {
        const tool = tools.find((t) => t.name === call.name);
        const args = call.arguments || {};
        emit({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args });
        let result, isError = false;
        try {
            if (!tool) {
                result = errorResult('Tool ' + call.name + ' not found. Available: ' + tools.map((t) => t.name).join(', '));
            } else {
                const bad = checkArgs(tool.parameters, args);
                if (bad.length) {
                    result = errorResult('invalid arguments for ' + call.name + ': ' + bad.join('; '));
                } else if (o.approve && !(await o.approve(call.name, args))) {
                    result = errorResult('Denied by the user.', { denied: true });
                } else if (signal.aborted) {
                    result = errorResult('aborted', { aborted: true });
                } else {
                    const onUpdate = (partial) => emit({ type: 'tool_execution_update', toolCallId: call.id,
                                                         toolName: call.name, partialResult: partial });
                    result = await tool.execute(call.id, args, signal, onUpdate);
                }
            }
        } catch (e) {
            result = errorResult((e && e.message) || String(e));
        }
        if (!result || !Array.isArray(result.content)) result = textResult(result == null ? '' : String(result));
        isError = !!(result.details && result.details.error);
        emit({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result, isError });
        const msg = {
            role: 'toolResult', toolCallId: call.id, toolName: call.name,
            content: result.content, details: result.details || {}, isError, timestamp: now(),
        };
        messages.push(msg);
        emit({ type: 'message_start', message: msg });
        emit({ type: 'message_end', message: msg });
        return msg;
    }

    async function prompt(text) {
        if (running) throw new Error('agent: a prompt is already running (abort it or waitForIdle)');
        running = true;
        controller = new AbortController();
        const signal = controller.signal;
        const user = { role: 'user', content: String(text), timestamp: now() };
        messages.push(user);
        emit({ type: 'agent_start' });
        try {
            emit({ type: 'turn_start' });
            emit({ type: 'message_start', message: user });
            emit({ type: 'message_end', message: user });
            for (let turn = 0; turn < maxTurns; turn++) {
                if (turn > 0) emit({ type: 'turn_start' });
                const msg = await askModel(signal);
                messages.push(msg);
                const calls = msg.stopReason === 'error' || msg.stopReason === 'aborted' ? []
                            : msg.content.filter((b) => b && b.type === 'toolCall');
                const toolResults = [];
                for (const call of calls) {
                    if (signal.aborted) break;
                    toolResults.push(await runTool(call, signal));
                }
                emit({ type: 'turn_end', message: msg, toolResults });
                if (!calls.length || signal.aborted) break;
            }
        } finally {
            running = false;
            controller = null;
            emit({ type: 'agent_end', messages: messages.slice() });
            const w = idleWaiters;
            idleWaiters = [];
            for (const r of w) r();
        }
    }

    return {
        prompt,
        abort() { if (controller) controller.abort(); },
        waitForIdle() { return running ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve(); },
        /** Forget the conversation (not while running). */
        reset() { if (!running) messages = []; },
        get messages() { return messages; },
        get running() { return running; },
        tools,
        get systemPrompt() { return o.systemPrompt || ''; },
        set systemPrompt(s) { o.systemPrompt = s; },
    };
}
