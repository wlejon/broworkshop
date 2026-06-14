// app.js — Entry point: canvas setup, input wiring, game loop
import { Canvas } from "/lib/canvas.js";
import { Input } from "/lib/input.js";
import { GameLoop } from "/lib/loop.js";
import { Storage } from "/app/storage.js";
import { Audio } from "/app/audio.js";
import { Screens } from "/app/screens.js";
import { Game } from "/app/game.js";
"use strict";

var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");

function getW() { return Canvas.w(ctx, 900); }
function getH() { return Canvas.h(ctx, 800); }

Storage.load();
Audio.init();

// Use the standard vocabulary so user rebindings carry across games.
// "up" doubles as thrust-in-play and menu-up on title screens.
Input.init([
    { name: "left",    label: "Rotate Left",  defaults: ["a", "ArrowLeft"] },
    { name: "right",   label: "Rotate Right", defaults: ["d", "ArrowRight"] },
    { name: "up",      label: "Thrust",       defaults: ["w", "ArrowUp"] },
    { name: "down",    label: "Menu Down",    defaults: ["s", "ArrowDown"] },
    { name: "primary", label: "Fire",         defaults: [" ", "Mouse0"] },
    { name: "confirm", label: "Confirm",      defaults: ["Enter"] },
    { name: "pause",   label: "Pause",        defaults: ["Escape", "p"] },
]);
Input.attach(window);

Screens.init(getW(), getH());

Input.onAction(function(action, phase) {
    if (phase !== "down" || !action) return;
    // Screen-level navigation: translate actions back to DOM key strings
    // that Screens.keydown already speaks (menu nav was written against them).
    var name = Screens.getName();
    if (name === "playing") {
        if (action === "pause") Screens.keydown("Escape", getW(), getH());
        return;
    }
    if (action === "up")        Screens.keydown("ArrowUp",   getW(), getH());
    else if (action === "down") Screens.keydown("ArrowDown", getW(), getH());
    else if (action === "confirm") Screens.keydown("Enter",  getW(), getH());
    else if (action === "pause")   Screens.keydown("Escape", getW(), getH());
});

function toCanvasCoords(ev) {
    var rect = canvas.getBoundingClientRect();
    var W = getW(), H = getH();
    var sx = W / rect.width, sy = H / rect.height;
    return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}
canvas.addEventListener("mousemove", function(ev) {
    var p = toCanvasCoords(ev);
    Game.setMouse(p.x, p.y);
});
canvas.addEventListener("mousedown", function(ev) {
    if (ev.button !== 2) return;
    var p = toCanvasCoords(ev);
    Game.setMouse(p.x, p.y, true);
});
window.addEventListener("mouseup", function(ev) {
    if (ev.button !== 2) return;
    Game.setMouse(undefined, undefined, false);
});
canvas.addEventListener("contextmenu", function(ev) { ev.preventDefault(); });

Screens.switchTo("title");
GameLoop.create({
    tick: function(dt) { Screens.update(dt, getW(), getH()); },
    draw: function() {
        var W = getW(), H = getH();
        ctx.clearRect(0, 0, W, H);
        Screens.draw(ctx, W, H);
    },
}).start();
