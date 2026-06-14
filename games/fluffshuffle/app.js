// app.js — entry point for Fluffshuffle.
'use strict';
import { GameLoop } from "/lib/loop.js";
import { Canvas } from "/lib/canvas.js";
import { Puffs } from "/app/puffs.js";
import { Particles } from "/app/particles.js";
import { AppAudio } from "/app/audio.js";
import { Board } from "/app/board.js";
import { Screens } from "/app/screens.js";

    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');

    function W() { return Canvas.w(ctx, 900); }
    function H() { return Canvas.h(ctx, 800); }

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
    window.__fluffshuffle = {
        G: { Puffs: Puffs, Particles: Particles, AppAudio: AppAudio, Board: Board, Screens: Screens },
        board: Board,
        puffs: Puffs,
        particles: Particles,
        screens: Screens,
        loop: loop,
    };

    console.log('Fluffshuffle loaded.');
