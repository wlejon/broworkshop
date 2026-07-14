// Headless smoke for the arcade skeleton.
//   bro-headless games/arcade-template path/to/tests/test_smoke.js

assert(!!document.getElementById("view"), "canvas #view");
assert(!!document.getElementById("screen-title"), "title screen");

advanceTime(100);
flush();

function pressKey(key) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true }));
}

pressKey("Enter");
advanceTime(100);
flush();

const overlay = document.getElementById("overlay");
assert(overlay.hidden || overlay.style.display === "none", "playing hides overlay");

advanceTime(200);
flush();

assert(!!document.getElementById("hud-score"), "score slot");

console.log("arcade-template smoke ok");
