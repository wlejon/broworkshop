// window.__starfighter — headless test surface (tests/test_*.js).

import * as flightRules from "/app/flight.js";
import * as waves from "/app/waves.js";
import * as enemies from "/app/enemies.js";
import { createCamera } from "/app/camera.js";
import { menu, toYoke } from "/app/game.js";

export function installTestHooks(shell) {
    window.__starfighter = {
        shell,
        rules: flightRules,
        waves,
        enemies,
        createCamera,
        toYoke,
        menu,
        /** Start a run with a seeded RNG. */
        start(seed) {
            menu.seed = seed != null ? seed : null;
            shell.startRun();
        },
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get flight() { const r = shell.getRun(); return r && r.flight; },
        get save() { return shell.api.save; },
    };
}
