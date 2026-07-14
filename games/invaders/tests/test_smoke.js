// Headless smoke test for Invaders on the arcade foundation.
//   bro-headless games/invaders tests/test_smoke.js

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

function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

// Enter starts a run
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

const wave = document.getElementById("hud-wave");
assert(wave && wave.textContent === "1", "wave starts at 1");

const lives = document.getElementById("hud-lives");
assert(lives && lives.textContent === "3", "lives start at 3");

// Pause
pressKey("Escape");
advanceTime(50);
flush();

const pause = document.getElementById("screen-pause");
assert(pause && pause.style.display !== "none" && !pause.hidden, "pause screen shown");

console.log("invaders smoke ok");
