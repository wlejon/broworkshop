// app.js — Entry point: canvas, input wiring, game loop.
import { Storage } from "/app/storage.js";
import { Audio } from "/app/audio.js";
import { Screens } from "/app/screens.js";
import { Game } from "/app/game.js";
import { Input } from "/lib/input.js";
import { Canvas } from "/lib/canvas.js";
import { GameLoop } from "/lib/loop.js";

var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");

function getW() { return Canvas.w(ctx, 1024); }
function getH() { return Canvas.h(ctx, 768); }

Storage.load();
Audio.init();

// Standard action vocabulary plus a few starfighter-specific additions.
// Keep names aligned with apps/lib/input.js STANDARD_ACTIONS so the
// System → Input panel groups bindings consistently across arcade apps.
Input.init([
    { name: "up",       label: "Menu Up",              defaults: ["ArrowUp", "w"] },
    { name: "down",     label: "Menu Down",            defaults: ["ArrowDown", "s"] },
    { name: "left",     label: "Menu Left",            defaults: ["ArrowLeft", "a"] },
    { name: "right",    label: "Menu Right",           defaults: ["ArrowRight", "d"] },
    { name: "primary",  label: "Fire",                 defaults: [" ", "Mouse0"] },
    { name: "secondary",label: "Fire (alt)",           defaults: ["Mouse2"] },
    { name: "target",   label: "Targeting Computer",   defaults: ["t"] },
    { name: "confirm",  label: "Confirm",              defaults: ["Enter"] },
    { name: "pause",    label: "Pause",                defaults: ["Escape", "p"] }
]);
Input.attach(window);

Screens.init(getW(), getH());

Input.onAction(function(action, phase, key) {
    if (phase !== "down") return;
    var name = Screens.getName();
    if (name === "playing") {
        if (action === "pause")   Screens.keydown("Escape", getW(), getH());
        if (action === "target")  Screens.keydown("t", getW(), getH());
        return;
    }
    if (action === "up")          Screens.keydown("ArrowUp",   getW(), getH());
    else if (action === "down")   Screens.keydown("ArrowDown", getW(), getH());
    else if (action === "confirm")Screens.keydown("Enter",     getW(), getH());
    else if (action === "pause")  Screens.keydown("Escape",    getW(), getH());
});

// --- Mouse yoke: normalized to -1..1. -------------------------------------
// While pointer-locked (during play), the yoke is integrated from mouse
// movement deltas and clamped. On overlay screens we fall back to absolute
// canvas coordinates so menu hover/click still work naturally.
var pointerLocked = false;
var vYokeX = 0, vYokeY = 0;
// Movement units needed to saturate the yoke from centered. ~240px of
// mouse travel in either direction = full deflection.
var YOKE_SENSITIVITY = 1 / 240;

function toCanvasCoords(ev) {
    var rect = canvas.getBoundingClientRect();
    var W = getW(), H = getH();
    var sx = W / rect.width, sy = H / rect.height;
    return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}

// Dead-zone-centered mouse deflection with saturation. The center third
// of the canvas maps to 0; beyond that, deflection ramps linearly.
function toYoke(px, py, W, H) {
    var nx = (px - W * 0.5) / (W * 0.5);
    var ny = (py - H * 0.5) / (H * 0.5);
    var dead = 0.06;
    function curve(v) {
        var s = v < 0 ? -1 : 1;
        var a = Math.abs(v);
        if (a < dead) return 0;
        a = (a - dead) / (1 - dead);
        return s * Math.min(1, a);
    }
    // Y inverted — pull-up-to-climb feel.
    return { x: curve(nx), y: -curve(ny) };
}

function clamp1(v) { return v < -1 ? -1 : (v > 1 ? 1 : v); }

canvas.addEventListener("mousemove", function(ev) {
    if (pointerLocked) {
        // Accumulate locked deltas. Y inverted — pull-up to climb.
        vYokeX = clamp1(vYokeX + ev.movementX * YOKE_SENSITIVITY);
        vYokeY = clamp1(vYokeY - ev.movementY * YOKE_SENSITIVITY);
        Game.setYoke(vYokeX, vYokeY);
        return;
    }
    var p = toCanvasCoords(ev);
    var y = toYoke(p.x, p.y, getW(), getH());
    Game.setYoke(y.x, y.y);
});

canvas.addEventListener("mousedown", function(ev) {
    if (ev.button === 0 || ev.button === 2) Game.setFire(true);
});
window.addEventListener("mouseup", function(ev) {
    if (ev.button === 0 || ev.button === 2) Game.setFire(false);
});
canvas.addEventListener("contextmenu", function(ev) { ev.preventDefault(); });

// --- Pointer lock --------------------------------------------------------
// While playing the mouse is the yoke — capture it so the cursor can't
// leave the canvas and so large yoke motions keep working past the edge.
document.addEventListener("pointerlockchange", function() {
    pointerLocked = (document.pointerLockElement === canvas);
    if (pointerLocked) { vYokeX = 0; vYokeY = 0; }
});

Screens.setOnPlayingChange(function(isPlaying) {
    if (isPlaying) {
        // Must be called from within a user gesture (click/keydown) — it is:
        // every "enter playing" transition is triggered by a menu click or Enter.
        try { canvas.requestPointerLock(); } catch (e) {}
    } else {
        if (document.pointerLockElement) document.exitPointerLock();
    }
});

// Space also fires (keyboard fallback).
Input.onAction(function(action, phase) {
    if (action !== "primary") return;
    Game.setFire(phase === "down");
});

Screens.switchTo("title");

GameLoop.create({
    tick: function(dt) { Screens.update(dt, getW(), getH()); },
    draw: function()   {
        var W = getW(), H = getH();
        ctx.clearRect(0, 0, W, H);
        Screens.draw(ctx, W, H);
    }
}).start();
