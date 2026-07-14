// Headless smoke test for Missile Command on the arcade foundation.
//   bro-headless games/missile-command tests/test_smoke.js

assert(!!document.getElementById("view"), "canvas #view present");
assert(!!document.getElementById("overlay"), "overlay present");
assert(!!document.getElementById("screen-title"), "title screen present");
assert(!!document.getElementById("screen-wavecomplete"), "wavecomplete screen present");

advanceTime(100);
flush();

const title = document.getElementById("screen-title");
assert(title && title.style.display !== "none", "title visible after boot");

function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

pressKey("Enter");
advanceTime(50);
flush();

const overlay = document.getElementById("overlay");
assert(overlay.hidden || overlay.style.display === "none", "overlay hidden while playing");

advanceTime(500);
flush();

const score = document.getElementById("hud-score");
assert(score, "score hud slot");
assert(score.textContent.length > 0, "score has text");

const wave = document.getElementById("hud-wave");
assert(wave, "wave hud slot");

// Pause
pressKey("Escape");
advanceTime(50);
flush();

const pause = document.getElementById("screen-pause");
assert(pause && pause.style.display !== "none" && !pause.hidden, "pause screen shown");

console.log("missile-command smoke ok");
