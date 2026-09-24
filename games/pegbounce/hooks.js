// window.__pegbounce — headless test surface (tests/test_*.js).

import * as rules from "/app/rules.js";
import { Physics } from "/app/physics.js";
import { Levels } from "/app/levels.js";
import { Guides } from "/app/guides.js";
import { Round, simulateShot } from "/app/round.js";
import { menu } from "/app/game.js";
import { fieldFit } from "/app/render.js";

export function installTestHooks(shell) {
    window.__pegbounce = {
        shell,
        rules,
        Physics,
        Levels,
        Guides,
        Round,
        menu,
        simulateShot,
        fieldFit,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get round() { const r = shell.getRun(); return r && r.round; },
        get save() { return shell.api.save; },
    };
}
