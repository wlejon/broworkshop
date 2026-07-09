// Full multi-step verification on Qwen3-32B: a BOUNDED task so the loop
// terminates in a few steps, with a generous wall-clock pump budget. Logs every
// tool round-trip, each assistant message's stopReason, whether the loop reached
// idle + agent_end, and the final answer text.
//   bro-headless ai/pi-agent tests/verify_32b.js

import { createAgentSession } from "/app/pi.bundle.js";

const fs = require("fs");
const modelPath = "D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf";
assert(fs.existsSync(modelPath), "Qwen3-32B GGUF present");
console.log("loading:", modelPath);

let loaded = null, loadErr = null;
bro.lm.loadQwen(modelPath, { onReady: (r) => { loaded = r; }, onError: (e) => { loadErr = e; } });
for (let i = 0; i < 6000 && !loaded && !loadErr; i++) { advanceTime(20); wallSleep(8); }
assert(loaded, "model loaded (err=" + loadErr + ")");
console.log("model ready:", loaded.model.numLayers, "layers");

const brolm = {
    model: loaded.model,
    tokenizer: loaded.tokenizer,
    family: "qwen3",
    decode: (ids) => loaded.tokenizer.decode(Array.from(ids)),
    eosId: loaded.tokenizer.imEndId,
};

const execs = [];
const stopReasons = [];
let sawAgentEnd = false;
let idle = false;

const session = createAgentSession({
    brolm,
    cwd: "D:/projects/broworkshop/ai/pi-agent",
    onEvent: (e) => {
        if (e.type === "tool_execution_start") {
            execs.push(e.toolName);
            console.log("  → EXEC:", e.toolName, JSON.stringify(e.args || {}));
        }
        if (e.type === "tool_execution_end") {
            console.log("  → DONE:", (e.isError ? "ERROR" : "ok"));
        }
        if (e.type === "message_end" && e.message && e.message.role === "assistant") {
            stopReasons.push(e.message.stopReason);
        }
        if (e.type === "agent_end") { sawAgentEnd = true; console.log("  → agent_end"); }
    },
    approve: () => true,
});

// Bounded task: two concrete tool calls then stop → the loop terminates quickly.
session
    .prompt("Do exactly two things, then stop and summarize: (1) call list_dir on '.', (2) call read_file on 'bro.json'. Then tell me in one sentence what this app is. Do not call any other tools.")
    .then(() => { idle = true; })
    .catch((e) => { console.log("prompt error:", e && e.message ? e.message : e); idle = true; });

// Generous budget: 32B thinking mode is ~40s/step; allow several minutes wall.
for (let i = 0; i < 120000 && !idle; i++) { advanceTime(20); wallSleep(4); }

console.log("\n==== RESULT ====");
console.log("reached idle:", idle);
console.log("agent_end:", sawAgentEnd);
console.log("tool calls:", JSON.stringify(execs));
console.log("assistant stopReasons:", JSON.stringify(stopReasons));

assert(idle, "loop reached idle within budget");
assert(execs.filter((t) => t === "list_dir").length >= 1, "list_dir executed");
assert(execs.filter((t) => t === "read_file").length >= 1, "read_file executed");
console.log("\nVERIFY 32B PASSED: multi-step tool loop completed end-to-end.");
