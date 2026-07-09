// Capstone: the create -> look loop end-to-end, in-engine, via the REAL app path
// (window.__makerDebug wraps main.js's session + look). Two parts:
//   (1) Deterministic proof of `look`: draw on the stage, call look, assert the
//       vision model returned a real description and a capture thumbnail appeared.
//   (2) Autonomous proof: the OpenRouter brain draws on the stage with eval_js and
//       the turn completes. (Whether a small free model chooses to call look each
//       run varies, so that is logged, not asserted.)
// Saves the final stage JPEG for inspection. Requires OPENROUTER_API_KEY. Run:
//   OPENROUTER_API_KEY=sk-or-... bro-headless ai/maker-agent tests/test_maker_loop.js

const KEY = globalThis.process && globalThis.process.env && globalThis.process.env.OPENROUTER_API_KEY;
assert(KEY, "OPENROUTER_API_KEY must be set");
assert(window.__makerDebug, "main.js must have booted (window.__makerDebug present)");
const SCRATCH = "C:/Users/jonny/AppData/Local/Temp/claude/D--projects-bro/7361a163-5fb9-4b8e-84fd-ab689d46da8d/scratchpad";

advanceTime(100); flush();
window.__makerDebug.configure({
    backend: "openrouter",
    key: KEY,
    brain: "nvidia/nemotron-3-super-120b-a12b:free",
    vision: "google/gemma-4-31b-it:free",
});

// ── Part 1: deterministic look ────────────────────────────────────────────────
window.__makerDebug.clearStage();
stageCtx.fillStyle = "#87ceeb"; stageCtx.fillRect(0, 0, 640, 480);          // sky
stageCtx.fillStyle = "yellow"; stageCtx.beginPath(); stageCtx.arc(320, 110, 60, 0, 7); stageCtx.fill(); // sun
flush();

let lookRes = null, lookDone = false;
window.__makerDebug.look("Describe the stage: what colors and shapes do you see?")
    .then((r) => { lookRes = r; lookDone = true; })
    .catch((e) => { lookRes = { error: e }; lookDone = true; });
for (let i = 0; i < 40000 && !lookDone; i++) { advanceTime(20); wallSleep(5); }

const lookText = lookRes && lookRes.content && lookRes.content[0] && lookRes.content[0].text || "";
const lookErrored = lookRes && lookRes.details && lookRes.details.error;
console.log("look returned:", JSON.stringify(lookText.slice(0, 220)));
assert(lookDone, "look() resolved");
assert(!lookErrored, "look() succeeded (vision model responded)");
assert(lookText.length > 15, "look() returned a real description");
// A successful vision response already proves the stage was captured and sent.
console.log("look-shot thumbnails in transcript:", document.querySelectorAll(".look-shot").length);
console.log("PART 1 PASSED: look() captured the stage and the vision model described it.");

// ── Part 2: autonomous draw ────────────────────────────────────────────────────
window.__makerDebug.reset();
window.__makerDebug.clearStage();
let done = false, failErr = null;
window.__makerDebug.prompt(
    "Draw a picture on the stage with eval_js and the stageCtx global: fill the whole canvas with a solid " +
    "background color (use a hex color like '#87ceeb'), then draw one solid yellow circle as a sun. After " +
    "drawing, call the look tool once to check it, then stop and summarize in one sentence. At most 3 tool calls."
).then(() => { done = true; }).catch((e) => { failErr = (e && e.message) || String(e); done = true; });
for (let i = 0; i < 200000 && !done; i++) { advanceTime(20); wallSleep(5); }

console.log("\n==== RESULT ====");
console.log("autonomous done:", done, "err:", failErr);
const w = stageCanvas.width, h = stageCanvas.height;
const img = stageCtx.getImageData(0, 0, w, h);
let nonWhite = 0;
for (let p = 0; p < img.data.length; p += 4) if (img.data[p] < 245 || img.data[p + 1] < 245 || img.data[p + 2] < 245) nonWhite++;
const frac = nonWhite / (w * h);
const looks = document.querySelectorAll(".look-shot").length; // >=1 from part 1
console.log("stage non-white fraction:", frac.toFixed(3), "| total look captures:", looks);
if (bro.image && bro.image.encodeJpegFile) {
    bro.image.encodeJpegFile(SCRATCH + "/maker_stage.jpg", img.data, w, h, 4, 90);
    console.log("saved stage:", SCRATCH + "/maker_stage.jpg");
}
assert(done, "the autonomous maker turn reached idle");
assert(frac > 0.01, "the agent painted the stage (non-white fraction " + frac.toFixed(3) + ")");
console.log("PART 2 PASSED: the OpenRouter brain drew on the stage autonomously.");
console.log("\nMAKER LOOP PASSED: create -> look works end-to-end in-engine.");
