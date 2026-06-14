// app.js — Main entry point: canvas setup, game loop, event binding
import { Canvas } from "/lib/canvas.js";
import { Storage } from "/app/storage.js";
import { Audio } from "/app/audio.js";
import { Input } from "/app/input.js";
import { Screens } from "/app/screens.js";

var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var getW = function() { return Canvas.w(ctx, 800); };
var getH = function() { return Canvas.h(ctx, 700); };

var lastFrameTime = 0;

// --- Initialize ---
Storage.load();
Audio.init();
Input.init();
Screens.init();

// --- Event binding ---
document.body.addEventListener("keydown", function(e) {
    if (e.repeat) {
        // Only allow repeat for menu screens, not gameplay
        var name = Screens.getName();
        if (name === "playing" || name === "countdown") return;
    }
    Screens.keydown(e.key);
});

document.body.addEventListener("keyup", function(e) {
    Screens.keyup(e.key);
});

// Action events from bro.settings
document.addEventListener("action", function(e) {
    Screens.onAction(e.detail.action, e.detail.phase, e.detail.key);
});

// --- Game loop ---
function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);

    var dt = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    if (dt > 100) dt = 100;
    if (dt < 0) dt = 0;

    var W = getW(), H = getH();

    Screens.update(dt, W, H);
    Audio.updateSequences();

    ctx.clearRect(0, 0, W, H);
    Screens.draw(ctx, W, H);
}

// --- Start ---
Screens.switchTo("title");
lastFrameTime = performance.now();
requestAnimationFrame(gameLoop);

console.log("Tetris loaded!");
