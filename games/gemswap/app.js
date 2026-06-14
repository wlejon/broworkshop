// app.js — entry point for gemswap.
'use strict';
import { GameLoop } from "/lib/loop.js";
import { Canvas } from "/lib/canvas.js";
import { Particles } from "/app/particles.js";
import { Puzzles } from "/app/puzzles.js";
import { AppAudio } from "/app/audio.js";
import { Controls } from "/app/input.js";
import { Board } from "/app/board.js";
import { Screens } from "/app/screens.js";

    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    function W() { return Canvas.w(ctx, 900); }
    function H() { return Canvas.h(ctx, 800); }

    Controls.init();
    Screens.init();

    var loop = GameLoop.create({
        tick: function (dt) {
            var Sc = Screens.manager();
            Sc.update(dt, W(), H());
        },
        draw: function () {
            ctx.clearRect(0, 0, W(), H());
            var Sc = Screens.manager();
            Sc.draw(ctx, W(), H());
        },
    });

    Screens.switchTo('title');
    loop.start();

    // Expose test hooks.
    window.__gemswap = {
        G: { Board: Board, Puzzles: Puzzles, Particles: Particles, AppAudio: AppAudio, Controls: Controls, Screens: Screens },
        board: Board,
        particles: Particles,
        puzzles: Puzzles,
        screens: Screens,
        loop: loop,
    };

    console.log('Gemswap loaded.');
