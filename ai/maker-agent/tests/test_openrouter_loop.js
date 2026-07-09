// Live end-to-end proof: drive pi's real Agent loop through the OpenRouter backend
// (openrouter.js native tool-calling) + the maker tools, entirely in-engine. Runs a
// bounded task that must call list_dir, and asserts a tool round-trips and the loop
// reaches idle. Free models rate-limit intermittently, so it tries a few until one
// completes. Requires OPENROUTER_API_KEY in the environment. Run:
//   OPENROUTER_API_KEY=sk-or-... bro-headless ai/maker-agent tests/test_openrouter_loop.js

import { createAgentSession } from "/app/maker.bundle.js";

const KEY = globalThis.process && globalThis.process.env && globalThis.process.env.OPENROUTER_API_KEY;
assert(KEY, "OPENROUTER_API_KEY must be set in the environment");

const MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
];

function runOne(model) {
    const events = [];
    let idle = false, failed = null;
    const session = createAgentSession({
        backend: { kind: "openrouter", openrouter: { apiKey: KEY, model, maxRetries: 2 } },
        cwd: "D:/projects/broworkshop/ai/maker-agent",
        onEvent: (e) => {
            events.push(e);
            if (e.type === "tool_execution_start") console.log("  -> tool:", e.toolName, JSON.stringify(e.args || {}));
            if (e.type === "message_end" && e.message && e.message.role === "assistant" && e.message.stopReason === "error") {
                failed = e.message.errorMessage || "error";
            }
        },
        approve: () => true,
    });

    session
        .prompt("Call the list_dir tool on '.' and then tell me in one sentence what files are here. Do not call any other tools.")
        .then(() => { idle = true; })
        .catch((e) => { failed = (e && e.message) || String(e); idle = true; });

    // Pump: each OpenRouter round-trip is a real network call (seconds).
    for (let i = 0; i < 60000 && !idle; i++) { advanceTime(20); wallSleep(6); }

    const toolStarts = events.filter((e) => e.type === "tool_execution_start");
    return { idle, failed, toolStarts, events };
}

let passed = false;
for (const model of MODELS) {
    console.log("\n=== trying", model, "===");
    const r = runOne(model);
    if (r.failed && !r.toolStarts.length) { console.log("  (unavailable/failed:", r.failed, "- next model)"); continue; }
    console.log("  idle:", r.idle, "tool calls:", JSON.stringify(r.toolStarts.map((e) => e.toolName)));
    assert(r.idle, "the turn reached idle");
    if (r.toolStarts.some((e) => e.toolName === "list_dir")) {
        console.log("OPENROUTER LOOP PASSED: list_dir round-tripped via native tool-calling on", model);
        passed = true;
        break;
    } else {
        console.log("  loop ran but no list_dir this attempt; trying next model");
    }
}
assert(passed, "at least one free model completed the tool loop");
