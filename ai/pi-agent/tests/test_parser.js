// Hard gate #1: the brolm tool-call stream parser is deterministic and model-free.
// Also the first proof that pi.bundle.js parses + loads under bro's QuickJS.
// Run: bro-headless ai/pi-agent tests/test_parser.js

import { createBrolmParser } from "/app/pi.bundle.js";

const events = [];
const parser = createBrolmParser((e) => events.push(e));

// Monotonically-growing decoded-text snapshots (what brolm.decode(acc) yields
// each token): plain text, then a tool_call, then trailing text.
const chunks = [
    "Hello",
    "Hello, I will ",
    'Hello, I will <tool_call>{"name":"list_dir",',
    'Hello, I will <tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>',
    'Hello, I will <tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call> done.',
];
for (const c of chunks) parser.push(c);
if (typeof parser.finish === "function") parser.finish();

const types = events.map((e) => e.type);
console.log("event sequence:", JSON.stringify(types));

assert(types[0] === "start", "first event must be 'start'");
assert(types.filter((t) => t === "start").length === 1, "exactly one 'start'");
assert(types.includes("text_delta"), "text was streamed as text_delta");
assert(types.includes("toolcall_start") && types.includes("toolcall_end"), "toolcall bracketed");

// No partial "<tool" open tag ever leaked into a text delta.
const leaked = events.some((e) => e.type === "text_delta" && /<tool_call|<\/tool_call/.test(e.delta || ""));
assert(!leaked, "no tool-call tag leaked into text deltas");

const tcEnd = events.find((e) => e.type === "toolcall_end");
assert(tcEnd && tcEnd.toolCall, "toolcall_end carries a toolCall");
assert(tcEnd.toolCall.name === "list_dir", "parsed tool name");
assert(tcEnd.toolCall.arguments && tcEnd.toolCall.arguments.path === ".", "parsed tool arguments");
assert(tcEnd.toolCall.type === "toolCall", "toolCall block type");

const blocks = parser.blocks();
assert(blocks.length === 3, "three content blocks: text, toolCall, text (got " + blocks.length + ")");
assert(blocks[0].type === "text", "block 0 is text");
assert(blocks[1].type === "toolCall", "block 1 is toolCall");
assert(blocks[2].type === "text", "block 2 is text");
assert(parser.sawToolCall() === true, "sawToolCall() is true");

// Malformed JSON must fall back to text, never throw.
const ev2 = [];
const p2 = createBrolmParser((e) => ev2.push(e));
p2.push('start <tool_call>{ not json }</tool_call> end');
if (typeof p2.finish === "function") p2.finish();
assert(p2.sawToolCall() === false, "malformed tool_call is NOT counted as a call");

console.log("PARSER TEST PASSED");
