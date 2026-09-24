// window.__serpcoil — headless test surface (tests/test_*.js).

import * as coilRules from "/app/coil.js";
import { Chain, COLORS, ORB_DIAM } from "/app/chain.js";
import { PU } from "/app/shooter.js";
import { createPath } from "/app/path.js";
import { LEVELS } from "/app/levels.js";
import { menu } from "/app/game.js";

export function installTestHooks(shell) {
    window.__serpcoil = {
        shell,
        rules: coilRules,
        Chain,
        COLORS,
        ORB_DIAM,
        PU,
        createPath,
        LEVELS,
        menu,
        /** Start level n with a seeded RNG. */
        startLevel(n, seed) {
            menu.levelIdx = n;
            menu.seed = seed != null ? seed : null;
            shell.startRun();
        },
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get coil() { const r = shell.getRun(); return r && r.coil; },
        get save() { return shell.api.save; },
    };
}
