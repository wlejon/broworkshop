// window.__fluffshuffle — headless test + make_video.js surface.

import * as rules from "/app/rules.js";
import { Puffs } from "/app/puffs.js";
import { setNextMode } from "/app/game.js";

export function installTestHooks(shell) {
    window.__fluffshuffle = {
        shell,
        rules,
        Puffs,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get board() { const r = shell.getRun(); return r && r.board; },
        get save() { return shell.api.save; },
        /** Start a fresh run in `mode` without the menus. */
        startRun(mode) {
            setNextMode(mode || "classic");
            shell.startRun();
            return shell.getRun().board;
        },
    };
}
