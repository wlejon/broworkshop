// window.__farm — the headless test surface (tests/test_*.js). Actions go
// through the same functions the keyboard and mouse use.

import { internals } from "/app/game.js";
import { computeSpatial, SPEECH_SPATIAL } from "/app/voice.js";
import * as defs from "/app/defs.js";

export function installTestHooks(shell) {
    const F = {
        shell, defs, computeSpatial, SPEECH_SPATIAL,
        get farm() { return internals.farm; },
        get world() { return internals.farm && internals.farm.world; },
        get stage() { return internals.stage; },
        get inspector() { return internals.inspector; },
        get run() { return internals.run; },
        get screen() { return shell.getScreen(); },

        /** Keep the farm silent (no Kokoro load); call before the first start(). */
        noVoices() { internals.options.voices = false; },

        /** Start (or continue) the farm: the title's Play. */
        start() { shell.startRun(); return internals.farm; },

        /** Pause / resume the Foreman's decisions (tests drive workers by hand). */
        setAuto(on) { internals.farm.auto = !!on; },

        interact: () => internals.interact(),
        buyFeed: () => internals.buyFeed(),
        debug: (name) => { internals.debug[name](internals.farm.world); internals.refreshPanels(); },
        refreshPanels: () => internals.refreshPanels(),

        /** Client pixel where a person is drawn (mid-body), for click tests. */
        personScreen(id) {
            const w = F.world;
            const p = id === "Foreman" ? w.foreman : w.npcs.find((n) => n.id === id);
            return p ? internals.stage.toScreen(p.x, 0.8, p.y) : null;
        },

        /** Teleport the player avatar to a tile. */
        movePlayerTo(x, y) { F.world.player.x = x; F.world.player.y = y; },
    };
    window.__farm = F;
    return F;
}
