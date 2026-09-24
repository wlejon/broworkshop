// window.__wordspire — headless test surface (tests/test_*.js).

import * as letters from "/app/letters.js";
import * as scoring from "/app/scoring.js";
import { Dictionary } from "/app/dictionary.js";

export function installTestHooks(shell) {
    window.__wordspire = {
        shell,
        letters,
        scoring,
        dictionary: Dictionary,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get board() { const r = shell.getRun(); return r && r.board; },
        get save() { return shell.api.save; },
    };
}
