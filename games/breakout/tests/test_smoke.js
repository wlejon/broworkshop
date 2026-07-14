// Headless smoke test for Breakout on the arcade foundation.
//   bro-headless games/breakout tests/test_smoke.js

assert(!!document.getElementById("view"), "canvas #view present");
assert(!!document.getElementById("overlay"), "overlay present");
assert(!!document.getElementById("screen-title"), "title screen present");
assert(!!document.getElementById("screen-levelclear"), "levelclear screen present");

// Allow module boot + first frames
advanceTime(100);
flush();

const title = document.getElementById("screen-title");
assert(title && title.style.display !== "none", "title visible after boot");

const hud = document.getElementById("hud");
assert(hud, "hud element exists");

function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

// Start a run
pressKey("Enter");
advanceTime(50);
flush();

const overlay = document.getElementById("overlay");
assert(overlay.hidden || overlay.style.display === "none", "overlay hidden while playing");

// HUD slots for breakout
const score = document.getElementById("hud-score");
assert(score, "score hud slot");
assert(score.textContent.length > 0, "score has text");

assert(!!document.getElementById("hud-high"), "high score slot");
assert(!!document.getElementById("hud-level"), "level slot");
assert(!!document.getElementById("hud-lives"), "lives slot");

// Launch ball
pressKey(" ");
advanceTime(200);
flush();

// Pause
pressKey("Escape");
advanceTime(50);
flush();

const pause = document.getElementById("screen-pause");
assert(pause && pause.style.display !== "none" && !pause.hidden, "pause screen shown");

console.log("breakout smoke ok");
