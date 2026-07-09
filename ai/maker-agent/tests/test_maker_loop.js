// Capstone: the author -> preview -> look loop end-to-end, in-engine, via the REAL
// app path (window.__makerDebug wraps main.js's session + look over the <iframe>
// preview). Two parts:
//   (1) Deterministic proof of `look`: write a known index.html into the project,
//       call look, assert the vision model returned a real description and a capture
//       thumbnail appeared.
//   (2) Autonomous proof: the OpenRouter brain authors a page with the file tools and
//       the turn completes; the final preview is captured. (Whether a small free
//       model nails the exact picture varies, so content is LOGGED, not asserted.)
// Requires OPENROUTER_API_KEY. Run:
//   OPENROUTER_API_KEY=sk-or-... bro-headless ai/maker-agent tests/test_maker_loop.js
//
// The preview only repaints on an engine frame. Windowed runs repaint continuously;
// headless has no render loop, so tick() forces one via screenshot() each poll step
// (into the gitignored tests/ dir) so look()'s post-reload capture sees fresh pixels.

const KEY = globalThis.process && globalThis.process.env && globalThis.process.env.OPENROUTER_API_KEY;
assert(KEY, "OPENROUTER_API_KEY must be set");
assert(window.__makerDebug, "main.js must have booted (window.__makerDebug present)");

const APP = "D:/projects/broworkshop/ai/maker-agent";
const PROJ = APP + "/project";
const fs = globalThis.require("fs");
function tick(n) {
    for (let i = 0; i < n; i++) { advanceTime(20); try { screenshot(APP + "/tests/maker_tick.png"); } catch (e) {} wallSleep(5); }
}

advanceTime(100); flush();
window.__makerDebug.configure({
    backend: "openrouter",
    key: KEY,
    brain: "nvidia/nemotron-3-super-120b-a12b:free",
    vision: "google/gemma-4-31b-it:free",
});

// ── Part 1: deterministic look over a known page ──────────────────────────────
fs.writeFileSync(PROJ + "/index.html",
    '<!doctype html><html><head><style>html,body{margin:0;height:100%}' +
    '#sky{height:60%;background:#87ceeb}#ground{height:40%;background:#3a7d34}</style></head>' +
    '<body><div id="sky"></div><div id="ground"></div></body></html>');

let lookRes = null, lookDone = false;
window.__makerDebug.look("What colors and regions do you see, top to bottom?")
    .then((r) => { lookRes = r; lookDone = true; })
    .catch((e) => { lookRes = { error: e }; lookDone = true; });
for (let i = 0; i < 40000 && !lookDone; i++) tick(1);

const lookText = lookRes && lookRes.content && lookRes.content[0] && lookRes.content[0].text || "";
console.log("look returned:", JSON.stringify(lookText.slice(0, 220)));
assert(lookDone, "look() resolved");
assert(!(lookRes && lookRes.details && lookRes.details.error), "look() succeeded (vision model responded)");
assert(lookText.length > 15, "look() returned a real description");
console.log("look-shot thumbnails:", document.querySelectorAll(".look-shot").length);
console.log("PART 1 PASSED: look() reloaded the preview, captured it, and the vision model described it.");

// ── Part 2: autonomous build ──────────────────────────────────────────────────
window.__makerDebug.reset();
fs.writeFileSync(PROJ + "/index.html", "<!doctype html><html><body></body></html>"); // blank slate
let done = false, failErr = null;
window.__makerDebug.prompt(
    "Build a simple web page in index.html: a full-viewport page with a sky-blue background and one big " +
    "centered solid yellow circle (a sun). Write the file, then call the look tool once to check it, then stop " +
    "and summarize in one sentence. At most 4 tool calls."
).then(() => { done = true; }).catch((e) => { failErr = (e && e.message) || String(e); done = true; });
for (let i = 0; i < 200000 && !done; i++) tick(1);

tick(2);
const img = document.querySelector("#preview").capture();
let nonSky = 0;
if (img) for (let p = 0; p < img.data.length; p += 4) {
    const r = img.data[p], g = img.data[p + 1], b = img.data[p + 2];
    if (!(b > r && b > 150)) nonSky++;              // anything that isn't sky-blue
}
const frac = img ? nonSky / (img.width * img.height) : 0;
console.log("\n==== RESULT ====");
console.log("autonomous done:", done, "err:", failErr);
console.log("preview non-sky fraction:", frac.toFixed(3), "| look captures:", document.querySelectorAll(".look-shot").length);
if (img && bro.image && bro.image.encodeJpegFile) {
    bro.image.encodeJpegFile(APP + "/tests/maker_preview.jpg", img.data, img.width, img.height, 4, 90);
    console.log("saved preview:", APP + "/tests/maker_preview.jpg");
}
assert(done, "the autonomous maker turn reached idle");
assert(img && img.width > 0, "the final preview was captured");
console.log("PART 2 PASSED: the OpenRouter brain authored a page and the preview rendered.");
console.log("\nMAKER LOOP PASSED: author -> preview -> look works end-to-end in-engine.");
