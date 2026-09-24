// The agent loop (lib/kit/agent.js) with a scripted provider: tool round
// trips, the event order, the approval gate, unknown tools, bad arguments,
// abort, and the transcript the app draws from those events.
import { check, eq, test, done, frames } from "/lib/kit/test.js";
import { createAgent, textResult } from "/lib/kit/agent.js";
import { piAgent } from "/app/app.js";

// A provider that replays one scripted assistant turn per call.
function scripted(turns) {
    let i = 0;
    const seen = [];
    const stream = async (context, opts, emit) => {
        seen.push(context);
        const blocks = turns[Math.min(i++, turns.length - 1)];
        const partial = { role: 'assistant', content: [], stopReason: 'stop' };
        for (const b of blocks) {
            partial.content = partial.content.concat([b]);
            emit({ type: b.type === 'toolCall' ? 'toolcall_end' : 'text_delta', partial: { role: 'assistant', content: partial.content.slice() } });
        }
        const tool = blocks.some((b) => b.type === 'toolCall');
        return { role: 'assistant', content: blocks, usage: { input: 100 * i, output: 10 }, stopReason: tool ? 'toolUse' : 'stop' };
    };
    return { stream, seen };
}
const call = (name, args, id) => ({ type: 'toolCall', id: id || 'c_' + name, name, arguments: args || {} });
const echo = { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { s: { type: 'string' } }, required: ['s'] },
               execute: async (id, a) => textResult('echo:' + a.s) };

async function run(turns, opts) {
    const p = scripted(turns);
    const events = [];
    const agent = createAgent(Object.assign({ stream: p.stream, tools: [echo], systemPrompt: 'S', onEvent: (e) => events.push(e) }, opts));
    await agent.prompt('go');
    return { agent, events, types: events.map((e) => e.type), seen: p.seen };
}

await test('a tool round trip', async () => {
    const r = await run([[{ type: 'text', text: 'calling' }, call('echo', { s: 'hi' })], [{ type: 'text', text: 'done' }]]);
    eq(r.types.filter((t) => /^(agent|turn|tool_execution)_/.test(t)),
       ['agent_start', 'turn_start', 'tool_execution_start', 'tool_execution_end', 'turn_end', 'turn_start', 'turn_end', 'agent_end']);
    eq(r.agent.messages.map((m) => m.role), ['user', 'assistant', 'toolResult', 'assistant']);
    eq(r.agent.messages[2].content[0].text, 'echo:hi');
    eq(r.seen.length, 2, 'model asked twice');
    eq(r.seen[1].messages.length, 3, 'second call saw the tool result');
    eq(r.seen[0].systemPrompt, 'S');
    check(r.types.includes('message_update'), 'streamed updates');
});

await test('unknown tool, bad arguments, a throwing tool', async () => {
    const boom = { name: 'boom', description: '', parameters: { type: 'object', properties: {} },
                   execute: async () => { throw new Error('kaboom'); } };
    const r = await run([[call('nope', {}, 'a'), call('echo', { s: 5 }, 'b'), call('boom', {}, 'c')], [{ type: 'text', text: 'ok' }]],
                        { tools: [echo, boom] });
    const ends = r.events.filter((e) => e.type === 'tool_execution_end');
    eq(ends.map((e) => e.isError), [true, true, true]);
    check(/not found/.test(ends[0].result.content[0].text), 'unknown tool named');
    check(/"s" must be string/.test(ends[1].result.content[0].text), 'bad type reported: ' + ends[1].result.content[0].text);
    check(/kaboom/.test(ends[2].result.content[0].text), 'thrown error reported');
});

await test('approval gate denies', async () => {
    const r = await run([[call('echo', { s: 'x' })], [{ type: 'text', text: 'ok' }]], { approve: () => false });
    const end = r.events.find((e) => e.type === 'tool_execution_end');
    check(end.isError && /Denied by the user/.test(end.result.content[0].text), 'denied');
});

await test('abort stops the loop', async () => {
    let agent;
    const slow = { name: 'slow', description: '', parameters: { type: 'object', properties: {} },
                   execute: async () => { agent.abort(); return textResult('late'); } };
    const p = scripted([[call('slow'), call('echo', { s: 'never' })], [{ type: 'text', text: 'never' }]]);
    agent = createAgent({ stream: p.stream, tools: [slow, echo] });
    await agent.prompt('go');
    eq(p.seen.length, 1, 'no second model call');
    eq(agent.messages.filter((m) => m.role === 'toolResult').length, 1, 'second tool skipped');
    check(!agent.running, 'idle');
});

await test('a provider error ends the prompt', async () => {
    const agent = createAgent({ stream: async () => ({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'nope' }) });
    await agent.prompt('go');
    eq(agent.messages[1].stopReason, 'error');
});

await test('events render in the app transcript', async () => {
    piAgent.reset();
    const p = scripted([[{ type: 'text', text: '**bold** plan' }, call('echo', { s: 'hi' })], [{ type: 'text', text: 'all done' }]]);
    const agent = createAgent({ stream: p.stream, tools: [echo], onEvent: piAgent.chat.onEvent, approve: piAgent.chat.approve });
    piAgent.chat.addUser('go');
    await agent.prompt('go');
    frames(2);
    const rows = document.querySelectorAll('#transcript .chat-row');
    eq(rows.length, 3, 'you + two agent rows');
    check(rows[1].querySelector('strong'), 'markdown in the reply');
    const card = document.querySelector('#transcript .chat-tool.done');
    check(card && /echo:hi/.test(card.textContent), 'tool card with its result');
    eq(document.querySelector('#ctx-meter .chat-ctx-nums').textContent, '210 / 8.2k ctx', 'meter fed from usage');
});

done('agent loop');
