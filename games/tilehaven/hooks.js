// window.HAVEN — the headless test surface (tests/test_*.js). Clicks go
// through the real canvas listeners; `projectCell` is where to aim them.

import { internals } from "/app/game.js";
import { TILE, FLAG, COSTS, GOAL, MAP_W, MAP_H, CART_LOAD } from "/app/sim.js";

export function installTestHooks(shell) {
    const run = () => internals.run;
    const H = {
        shell,
        get screen() { return shell.getScreen(); },
        get game() { return run() && run().sim; },
        get world() { return run() && run().sim.world; },
        get stage() { return internals.stage; },
        get scene() { return internals.stage && internals.stage.scene; },
        get tool() { return run().tool; },
        get selected() { return run().selected; },
        get zoom() { return internals.stage.iso.zoom; },

        /** Client pixel of a cell's top centre. */
        projectCell: (x, y) => internals.cellScreen(x, y),
        /** The cell under a client pixel (the same pick the mouse uses). */
        cellAt: (px, py) => internals.cellAt(px, py),
        actOnCell: (x, y) => internals.actOnCell(x, y),
        setTool: (t) => internals.setTool(t),

        TILE, FLAG, COSTS, GOAL, MAP_W, MAP_H,
        debug: {
            addCoins(n) { run().sim.coins += n; },
            addRes(res, n) { run().sim[res] += n; },
            setHousePop(b, n) {
                if (b.type !== "house") return;
                run().sim.pop += n - b.pop;
                b.pop = n;
            },
            fillStock(b) { b.stock = CART_LOAD; },
            select(b) { run().selected = b; internals.applyTints(); },
        },
    };
    window.HAVEN = H;
    return H;
}
