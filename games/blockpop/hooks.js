// window.__blockpop — headless test surface (tests/test_*.js).

import * as rules from "/app/rules.js";
import { Board } from "/app/board.js";
import { internals } from "/app/game.js";

export function installTestHooks(shell) {
    window.__blockpop = {
        shell,
        rules,
        Board,
        prefs: internals.prefs,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get board() { const r = shell.getRun(); return r && r.board; },
        get save() { return shell.api.save; },
    };
}
