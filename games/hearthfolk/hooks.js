// window.HEARTH: the headless test surface (tests/test_*.js). Actions go
// through the same functions the keyboard, mouse and buttons use.

import { internals } from "/app/game.js";
import * as defs from "/app/defs.js";

export function installTestHooks(shell) {
    const run = () => internals.run;
    const H = {
        shell, defs,
        get game() { return run() && run().sim; },
        get world() { return run() && run().sim.world; },
        get stage() { return internals.stage; },
        get selected() { return run() && run().selected; },
        get voices() { return internals.voices; },
        get screen() { return shell.getScreen(); },

        /** Keep the Qwen minds and Kokoro voices unloaded; call before start(). */
        noModels() { internals.options.models = false; },

        /** Enter the village: the title's first item. Returns the sim. */
        start() { shell.startRun(); return H.game; },

        setSpeed: (sp) => internals.setSpeed(sp),
        /** Client pixel of a villager's head (the speech-bubble anchor). */
        villagerScreen: (v) => internals.villagerScreen(v),

        debug: {
            select: (v) => internals.select(v),
            teleport(v, x, y) {
                v.pos = { x, y };
                v.path = null; v.target = null; v.plannedAct = null; v.commit = null;
            },
            forceGoto(v, x, y) {
                v.override = { until: H.game.time + 120, action: "idle", target: { x, y } };
                v.target = null; v.plannedAct = null; v.commit = null;
            },
            setNeeds(v, n) { Object.assign(v.needs, n); },
            setRes(res) { Object.assign(H.game.res, res); },
        },
    };
    window.HEARTH = H;
    return H;
}
