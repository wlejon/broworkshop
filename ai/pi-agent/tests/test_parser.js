// The local-model tool-call parser (lib/kit/agent-llm.js): deterministic and
// model-free. Text / <think> / <tool_call> segmentation over growing decoded
// text, no tag ever leaking into a delta, malformed JSON falling back to text,
// and the ChatML prompt the provider builds.
import { check, eq, test, done } from "/lib/kit/test.js";
import { createBrolmParser, buildChatML, openaiMessages } from "/lib/kit/agent-llm.js";

function parse(chunks) {
    const events = [];
    const p = createBrolmParser((e) => events.push(e));
    for (const c of chunks) p.push(c);
    p.finish();
    return { events, types: events.map((e) => e.type), p };
}
const leaked = (events, re) => events.some((e) => /_delta$/.test(e.type) && e.type !== 'toolcall_delta' && re.test(e.delta || ''));

test('text, tool call, text', () => {
    const { events, types, p } = parse([
        'Hello',
        'Hello, I will ',
        'Hello, I will <tool_call>{"name":"list_dir",',
        'Hello, I will <tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>',
        'Hello, I will <tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call> done.',
    ]);
    eq(types[0], 'start');
    eq(types.filter((t) => t === 'start').length, 1, 'one start');
    check(types.includes('toolcall_start') && types.includes('toolcall_end'), 'tool call bracketed');
    check(!leaked(events, /<\/?tool_call/), 'no tool tag in a text delta');
    const end = events.find((e) => e.type === 'toolcall_end');
    eq([end.toolCall.type, end.toolCall.name, end.toolCall.arguments], ['toolCall', 'list_dir', { path: '.' }]);
    eq(p.blocks().map((b) => b.type), ['text', 'toolCall', 'text']);
    check(p.sawToolCall(), 'sawToolCall');
});

test('a tag split across tokens is held back', () => {
    const { events } = parse(['Hi <', 'Hi <tool', 'Hi <tool_call>{"name":"x","arguments":{}}</tool_call>']);
    check(!leaked(events, /</), 'no partial tag leaked: ' + JSON.stringify(events.filter((e) => e.type === 'text_delta').map((e) => e.delta)));
});

test('malformed tool JSON stays text', () => {
    const { p } = parse(['start <tool_call>{ not json }</tool_call> end']);
    check(!p.sawToolCall(), 'not counted as a call');
    check(p.blocks().every((b) => b.type === 'text'), 'only text blocks');
    check(/<tool_call>\{ not json \}<\/tool_call>/.test(p.blocks().map((b) => b.text).join('')), 'kept verbatim');
});

test('unterminated tool call is flushed as text', () => {
    const { p } = parse(['ok <tool_call>{"name":"list_dir"']);
    check(!p.sawToolCall() && /<tool_call>/.test(p.blocks().map((b) => b.text).join('')), 'flushed');
});

test('<think> folds into a thinking block', () => {
    const { events, types, p } = parse([
        '<think>',
        '<think>Let me consider',
        '<think>Let me consider the request.</think>',
        "<think>Let me consider the request.</think>Sure, I'll do it. ",
        "<think>Let me consider the request.</think>Sure, I'll do it. <tool_call>{\"name\":\"list_dir\",\"arguments\":{\"path\":\".\"}}</tool_call>",
    ]);
    check(types.includes('thinking_start') && types.includes('thinking_end') && types.includes('thinking_delta'), 'thinking bracketed');
    check(!leaked(events, /<\/?think/), 'no think tag leaked');
    eq(events.filter((e) => e.type === 'thinking_delta').map((e) => e.delta).join(''), 'Let me consider the request.');
    const reply = events.filter((e) => e.type === 'text_delta').map((e) => e.delta).join('');
    check(/Sure, I'll do it\./.test(reply) && !/consider/.test(reply), 'reply text: ' + reply);
    eq(p.blocks().map((b) => b.type), ['thinking', 'text', 'toolCall']);
});

test('ChatML prompt carries tools, history and tool results', () => {
    const s = buildChatML({
        systemPrompt: 'SYS',
        tools: [{ name: 'list_dir', description: 'ls', parameters: { type: 'object', properties: {} } }],
        messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'ok' },
                                           { type: 'toolCall', id: 'c1', name: 'list_dir', arguments: { path: '.' } }] },
            { role: 'toolResult', toolCallId: 'c1', toolName: 'list_dir', content: [{ type: 'text', text: 'a.txt' }] },
        ],
    });
    check(/^<\|im_start\|>system\nSYS\n\n# Tools/.test(s), 'system + tools block');
    check(s.includes('"name":"list_dir"'), 'tool signature');
    check(s.includes('<|im_start|>assistant\nok\n<tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call><|im_end|>'), 'assistant replay');
    check(!s.includes('hmm'), 'thinking not replayed');
    check(s.includes('<|im_start|>tool\na.txt<|im_end|>'), 'tool result turn');
    check(s.endsWith('<|im_start|>assistant\n'), 'ends on the assistant turn');
});

test('OpenAI messages for OpenRouter', () => {
    const m = openaiMessages({
        systemPrompt: 'SYS',
        messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'look', arguments: {} }] },
            { role: 'toolResult', toolCallId: 'c1', toolName: 'look',
              content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] },
            { role: 'assistant', content: [] },
        ],
    }, true);
    eq(m.map((x) => x.role), ['system', 'user', 'assistant', 'tool', 'user'], 'roles (empty assistant dropped, image as a user turn)');
    eq(m[2].tool_calls[0].function, { name: 'look', arguments: '{}' });
    eq(m[3].content, '(see attached image)');
    eq(m[4].content[0].image_url.url, 'data:image/jpeg;base64,AAAA');
});

done('parser');
