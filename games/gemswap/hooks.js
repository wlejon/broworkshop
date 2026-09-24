// window.__gemswap — headless test surface (tests/test_*.js).

import * as rules from "/app/rules.js";
import { Puzzles } from "/app/puzzles.js";

export function installTestHooks(shell) {
    window.__gemswap = {
        shell,
        rules,
        Puzzles,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get board() { const r = shell.getRun(); return r && r.board; },
        get save() { return shell.api.save; },
    };
}
