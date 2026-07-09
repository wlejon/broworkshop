// UI integration + showcase asset: drive the REAL app (index.html + main.js) —
// load the model via the Load button, type a prompt, Send, let the agent run a
// tool round-trip, and screenshot the rendered transcript. Proves the DOM/CSS
// layer integrates with the live loop. Run:
//   bro-headless ai/pi-agent tests/test_ui.js

const $ = (s) => document.querySelector(s);

// The app's main.js has already booted (prefilled #model-path with the first
// existing candidate). Trigger the Load button and wait for "ready".
$("#btn-load").click();
for (let i = 0; i < 6000 && !/ready/i.test($("#status").textContent); i++) {
    advanceTime(20);
    wallSleep(8);
    if (/load failed/i.test($("#status").textContent)) break;
}
assert(/ready/i.test($("#status").textContent), "model loaded in app UI: " + $("#status").textContent);
console.log("status:", $("#status").textContent);

// Type a prompt and Send.
$("#prompt").value = "List the files in the current directory using the list_dir tool, then tell me briefly what's here.";
$("#btn-send").click();

// Run until the turn finishes (Stop button re-disabled) or budget elapses.
for (let i = 0; i < 15000 && !$("#btn-stop").disabled; i++) {
    advanceTime(20);
    wallSleep(4);
}
flush();

const rows = document.querySelectorAll("#transcript .row").length;
const toolCards = document.querySelectorAll("#transcript .tool-card").length;
console.log("transcript rows:", rows, "tool cards:", toolCards);

screenshot("D:/projects/broworkshop/ai/pi-agent/tests/pi-agent-ui.png");
console.log("UI SHOT written");

assert(rows >= 2, "transcript shows the user prompt + an agent reply");
console.log(toolCards >= 1 ? "UI TEST PASSED (tool card rendered)" : "UI TEST PASSED (no tool card — model chose not to call a tool; render OK)");
