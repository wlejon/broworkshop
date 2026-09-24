// window.BLAST — the headless test surface (tests/test_*.js).

import { internals } from "/app/game.js";
import {
    TILE, SPAWNS, ROSTER, FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
    MAP_W, MAP_H, FUSE, FIRE_LINGER, BASE_RANGE, BASE_BOMBS, BASE_SPEED,
} from "/app/rules.js";

export function installTestHooks(shell) {
    const sim = () => internals.run && internals.run.sim;
    window.BLAST = {
        shell,
        get screen() { return shell.getScreen(); },
        get game() { return sim(); },
        get world() { return sim() && sim().world; },
        get scene() { return internals.stage && internals.stage.scene; },
        get debug() { return sim() && sim().debug; },
        TILE, SPAWNS, ROSTER,
        FLAG_SOLID, FLAG_SOFT, FLAG_BOMB, FLAG_DANGER,
        MAP_W, MAP_H, FUSE, FIRE_LINGER,
        BASE_RANGE, BASE_BOMBS, BASE_SPEED,
    };
    return window.BLAST;
}
