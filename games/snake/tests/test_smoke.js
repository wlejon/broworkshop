// Headless smoke test for Snake on the arcade foundation.
//   bro-headless games/snake tests/test_smoke.js

assert(!!document.getElementById("view"), "canvas #view present");
assert(!!document.getElementById("overlay"), "overlay present");
assert(!!document.getElementById("screen-title"), "title screen present");

// Allow module boot + first frames
advanceTime(100);
flush();

const title = document.getElementById("screen-title");
assert(title && title.style.display !== "none", "title visible after boot");

const hud = document.getElementById("hud");
assert(hud, "hud element exists");

// Enter should start a run (confirm action default)
// Simulate via dispatching key events that input listens for
function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

pressKey("Enter");
advanceTime(50);
flush();

const overlay = document.getElementById("overlay");
assert(overlay.hidden || overlay.style.display === "none", "overlay hidden while playing");

// Advance gameplay a bit
advanceTime(500);
flush();

const score = document.getElementById("hud-score");
assert(score, "score hud slot");
assert(score.textContent.length > 0, "score has text");

// Pause
pressKey("Escape");
advanceTime(50);
flush();

const pause = document.getElementById("screen-pause");
assert(pause && pause.style.display !== "none" && !pause.hidden, "pause screen shown");

console.log("snake smoke ok");
