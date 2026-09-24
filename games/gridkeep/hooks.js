// window.GRIDKEEP — the headless test surface (tests/test_*.js). Clicks go
// through the real canvas listeners; `projectCell` is where to aim them.

import { internals } from "/app/game.js";
import {
    TILE, TOWER_TYPES, CREEP_TYPES, SPAWNS, BASE,
    FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H,
} from "/app/sim.js";

export function installTestHooks(shell) {
    const run = () => internals.run;
    const sim = () => run().sim;
    window.GRIDKEEP = {
        shell,
        get screen() { return shell.getScreen(); },
        get game() { return run() && sim(); },
        get world() { return run() && sim().world; },
        get stage() { return internals.stage; },
        get scene() { return internals.stage && internals.stage.scene; },
        get placeType() { return run().placeType; },
        get selectedTower() { return run().selectedTower; },

        /** Client pixel of a cell's top centre. */
        projectCell: (x, y) => internals.cellScreen(x, y),
        /** The cell under a client pixel (the same pick the mouse uses). */
        cellAt: (px, py) => internals.cellAt(px, py),
        actOnCell: (x, y) => internals.actOnCell(x, y),
        setPlaceType: (type) => internals.setPlaceType(type),

        TILE, TOWER_TYPES, CREEP_TYPES, SPAWNS, BASE,
        FLAG_BLOCK, FLAG_NOBUILD, FLAG_TOWER, MAP_W, MAP_H,
        debug: {
            addGold(n) { sim().gold += n; },
            setLives(n) { sim().lives = n; },
            setWave(n) { sim().wave = n; },
            spawnCreep(type, x, y, opts) { return sim().spawnCreep(type, x, y, opts); },
            killAll() { for (const c of [...sim().creeps]) sim().damageCreep(c, 1e9); },
            freeze(on) { sim().frozen = !!on; },
        },
    };
    return window.GRIDKEEP;
}
