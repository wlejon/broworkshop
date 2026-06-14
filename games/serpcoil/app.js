// app.js — entry point
import { Game } from "/app/screens.js";

Game.init();
    window.__serpcoil = {
        fire:          function (a) { return Game.hooks().fire(a); },
        chain:         function () { return Game.hooks().chain(); },
        shooter:       function () { return Game.hooks().shooter(); },
        path:          function () { return Game.hooks().path(); },
        insertAt:      function (d, c) { return Game.hooks().insertAt(d, c); },
        detectMatches: function (i) { return Game.hooks().detectMatches(i); },
        seedLevel:     function (n, seed) { return Game.hooks().seedLevel(n, seed); },
        score:         function () { return Game.hooks().score(); },
        setScore:      function (v) { return Game.hooks().setScore(v); },
        combo:         function () { return Game.hooks().combo(); },
        danger:        function () { return Game.hooks().danger(); },
        state:         function () { return Game.state(); },
        tick:          function (dt) { return Game.tick(dt); },
        currentScreen: function () { return Game.Screens.currentName(); },
        forceEmpty:    function () { return Game.hooks().forceEmpty(); },
        advanceChainToGoal: function () { return Game.hooks().advanceChainToGoal(); },
        setChainSpeed: function (s) { return Game.hooks().setChainSpeed(s); },
        switchTo:      function (n) { return Game.Screens.switchTo(n); },
        awardPowerup:  function (pu) { return Game.hooks().awardPowerup(pu); }
    };

    var last = performance.now();
    function frame(t) {
        requestAnimationFrame(frame);
        var dt = t - last;
        last = t;
        if (dt < 0) dt = 0;
        if (dt > 100) dt = 100;

        Game.updateCanvasSize();
        Game.Screens.update(dt);
        Game.draw();
    }
    requestAnimationFrame(frame);

    console.log("Serpcoil loaded.");
