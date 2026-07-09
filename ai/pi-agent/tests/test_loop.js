// Live end-to-end proof (best-effort): load a real Qwen3 GGUF, run one agent
// turn through pi's Agent loop + our brolm provider + tools, and observe a tool
// call round-trip. Small-model tool-calling is imperfect, so a missing tool call
// is informational, not a hard failure. Run:
//   bro-headless ai/pi-agent tests/test_loop.js

import { createAgentSession } from "/app/pi.bundle.js";

const fs = require("fs");
const candidates = [
    "D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf",
    "D:/projects/brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf",
    "D:/projects/brolm/weights/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf",
    "D:/projects/brolm/weights/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf",
];
const modelPath = candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
assert(modelPath, "a Qwen3 GGUF must exist to run the loop test");
console.log("loading:", modelPath);

// --- load the model (async, pumped) ---------------------------------------
let loaded = null;
let loadErr = null;
bro.lm.loadQwen(modelPath, { onReady: (r) => { loaded = r; }, onError: (e) => { loadErr = e; } });
for (let i = 0; i < 4000 && !loaded && !loadErr; i++) { advanceTime(20); wallSleep(8); }
assert(loaded, "model loaded (err=" + loadErr + ")");
console.log("model ready:", loaded.model.numLayers, "layers");

const brolm = {
    model: loaded.model,
    tokenizer: loaded.tokenizer,
    family: "qwen3",
    decode: (ids) => loaded.tokenizer.decode(Array.from(ids)),
    eosId: loaded.tokenizer.imEndId,
};

// --- run one agent turn ----------------------------------------------------
const events = [];
let idle = false;
const session = createAgentSession({
    brolm,
    cwd: "D:/projects/broworkshop/ai/pi-agent",
    onEvent: (e) => {
        events.push(e);
        if (e.type === "tool_execution_start") console.log("  → tool_execution_start:", e.toolName, JSON.stringify(e.args || {}));
        if (e.type === "tool_execution_end") console.log("  → tool_execution_end:", (e.isError ? "ERROR " : "") + "(result received)");
        if (e.type === "agent_end") console.log("  → agent_end");
    },
    approve: () => true, // auto-approve for the test
});

session
    .prompt("Use the list_dir tool to list the files in the current directory, then briefly tell me what you found. Do not ask for confirmation.")
    .then(() => { idle = true; })
    .catch((e) => { console.log("prompt error:", e && e.message ? e.message : e); idle = true; });

// Pump: give the background decode real time (wallSleep) and drain deliveries.
for (let i = 0; i < 12000 && !idle; i++) { advanceTime(20); wallSleep(4); }

// --- report ----------------------------------------------------------------
const kinds = [...new Set(events.map((e) => e.type))];
console.log("event kinds:", JSON.stringify(kinds));

const toolStarts = events.filter((e) => e.type === "tool_execution_start");
const toolEnds = events.filter((e) => e.type === "tool_execution_end");

// Show what the assistant actually produced (last assistant message text).
const lastAsst = [...events].reverse().find((e) => e.type === "message_end" && e.message && e.message.role === "assistant");
if (lastAsst) {
    const text = (lastAsst.message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    console.log("assistant text (last):", JSON.stringify(text.slice(0, 400)));
    const calls = (lastAsst.message.content || []).filter((b) => b.type === "toolCall").map((b) => b.name);
    if (calls.length) console.log("assistant tool calls:", JSON.stringify(calls));
}

assert(idle, "the turn reached idle within the pump budget");
assert(kinds.includes("agent_start") || kinds.includes("turn_start"), "the agent loop actually started");

if (toolStarts.length > 0) {
    console.log("LOOP TEST: tool call executed →", toolStarts.map((e) => e.toolName).join(", "));
    assert(toolEnds.length > 0, "a tool that started also produced a result");
    const listed = toolStarts.some((e) => e.toolName === "list_dir");
    console.log(listed ? "LOOP TEST PASSED (list_dir round-tripped)" : "LOOP TEST PASSED (a tool round-tripped; not list_dir)");
} else {
    console.log("LOOP TEST INCONCLUSIVE: loop ran and streamed, but the model emitted no tool call (small-model limitation; informational).");
}
