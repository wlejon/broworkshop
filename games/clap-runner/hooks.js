// window.CLAP — headless test surface (tests/test_*.js).

import { internals } from "/app/game.js";
import { Runner, GROUND_Y } from "/app/runner.js";
import { createDetector } from "/app/gestures.js";

export function installTestHooks(shell) {
    window.CLAP = {
        shell,
        Runner, GROUND_Y, createDetector,
        detector: internals.detector,
        fx: internals.fx,
        get mic() { return internals.mic; },
        get sfx() { return internals.sfx; },
        get options() { return internals.options; },
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get runner() { const r = shell.getRun(); return r && r.runner; },
        get save() { return shell.api.save; },
    };
}
