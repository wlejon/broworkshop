// Unit test: the brolm parser folds Qwen3 <think>…</think> into a thinking
// block (streamed as thinking_* events) without leaking tags into text, and
// still parses a following <tool_call>. Requires a rebuilt pi.bundle.js.
//   bro-headless ai/pi-agent tests/test_think_parser.js

import { createBrolmParser } from "/app/pi.bundle.js";

const events = [];
const parser = createBrolmParser((e) => events.push(e));

// Growing decoded snapshots: a think block, then reply text, then a tool call.
const chunks = [
    "<think>",
    "<think>Let me consider",
    "<think>Let me consider the request.</think>",
    "<think>Let me consider the request.</think>Sure, I'll do it. ",
    '<think>Let me consider the request.</think>Sure, I\'ll do it. <tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>',
];
for (const c of chunks) parser.push(c);
if (typeof parser.finish === "function") parser.finish();

const types = events.map((e) => e.type);
console.log("event sequence:", JSON.stringify(types));

assert(types.includes("thinking_start") && types.includes("thinking_end"), "thinking bracketed");
assert(types.includes("thinking_delta"), "thinking streamed as deltas");

// No <think> tag ever leaks into a text OR thinking delta.
const leaked = events.some((e) =>
    (e.type === "text_delta" && /<think|<\/think/.test(e.delta || "")) ||
    (e.type === "thinking_delta" && /<think|<\/think/.test(e.delta || "")));
assert(!leaked, "no think tag leaked into deltas");

// Thinking content is captured exactly, and NOT mixed into the reply text.
const thinkText = events.filter((e) => e.type === "thinking_delta").map((e) => e.delta).join("");
assert(thinkText === "Let me consider the request.", "thinking content: " + JSON.stringify(thinkText));

const textText = events.filter((e) => e.type === "text_delta").map((e) => e.delta).join("");
assert(textText.indexOf("Sure, I'll do it.") !== -1, "post-think reply is text: " + JSON.stringify(textText));
assert(textText.indexOf("Let me consider") === -1, "reasoning did not bleed into the reply text");

// The tool call after the reasoning still parses.
const tcEnd = events.find((e) => e.type === "toolcall_end");
assert(tcEnd && tcEnd.toolCall && tcEnd.toolCall.name === "list_dir", "tool call parsed after thinking");

// blocks() carries a thinking block plus the text and toolCall blocks.
const blocks = parser.blocks();
const think = blocks.find((b) => b.type === "thinking");
assert(think && think.thinking === "Let me consider the request.", "thinking block present with content");
assert(blocks.some((b) => b.type === "text"), "text block present");
assert(blocks.some((b) => b.type === "toolCall"), "toolCall block present");

console.log("test_think_parser: all assertions passed");
