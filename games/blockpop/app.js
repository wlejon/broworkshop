// app.js — entry point for blockpop.
'use strict';
import { Canvas } from "/lib/canvas.js";
import { GameLoop } from "/lib/loop.js";
import { Storage } from "/app/storage.js";
import { Audio } from "/app/audio.js";
import { Particles } from "/app/particles.js";
import { Board } from "/app/board.js";
import { Screens } from "/app/screens.js";
const G = { Storage: Storage, Audio: Audio, Particles: Particles, Board: Board, Screens: Screens };
    var canvas = document.getElementById('game');
    var ctx = canvas.getContext('2d');
    function W() { return Canvas.w(ctx, 900); }
    function H() { return Canvas.h(ctx, 800); }

    // Audio (may fail silently in headless/no-audio environments).
    Audio.init();

    Screens.init();

    // Keyboard routing.
    document.body.addEventListener('keydown', function (e) {
        var name = Screens.manager().name();
        if (e.repeat && name === 'playing') return;
        Screens.manager().keydown(e.key);
    });
    document.body.addEventListener('keyup', function (e) {
        Screens.manager().keyup(e.key);
    });

    // Canvas mouse routing — only when playing.
    canvas.addEventListener('click', function (e) {
        if (Screens.manager().name() !== 'playing') return;
        var r = canvas.getBoundingClientRect();
        var x = e.clientX - (r ? r.left : 0);
        var y = e.clientY - (r ? r.top : 0);
        Board.mouseClick(x, y);
    });
    canvas.addEventListener('wheel', function (e) {
        if (Screens.manager().name() !== 'playing') return;
        Board.mouseWheel(e.deltaY || 0);
    }, { passive: true });

    var loop = GameLoop.create({
        tick: function (dt) { Screens.manager().update(dt, W(), H()); },
        draw: function () {
            ctx.clearRect(0, 0, W(), H());
            Screens.manager().draw(ctx, W(), H());
        }
    });

    Screens.switchTo('title');
    loop.start();

    // Test hooks — mirror the spec.
    window.__blockpop = {
        G: G,
        board: Board,
        particles: Particles,
        screens: Screens,
        loop: loop,
        // High-level test helpers exactly as spec'd
        step: function (dt) { Board.tick(dt || 16); Particles.update(dt || 16); },
        pick: function () { return Board.pick(); },
        place: function () { return Board.place(); },
        moveTo: function (col) { return Board.moveTo(col); },
        spawnRow: function () { return Board.spawnRow(Board.getBoard(), Math.random); },
        findChains: function () { return Board.findChains(Board.getBoard()); }
    };

    console.log('Blockpop loaded.');
