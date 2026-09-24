// Entry point: boot the plugin on a hidden 2D shell canvas (#view hosts the
// 3D scene) and expose window.__hexfront for the tests.
import { bootScene } from "/lib/arcade/scene3d.js";
import { exposeHooks } from "/lib/arcade/hooks.js";
import { game, projectCell, actOnCell, endTurn } from "/app/game.js";
import * as rules from "/app/rules.js";

const shell = bootScene(game, { width: 1280, height: 800 });
exposeHooks(game.id, shell, {
    rules,
    projectCell,
    actOnCell: (x, y) => actOnCell(shell.getRun(), x, y),
    endTurn: () => endTurn(shell.getRun()),
    get battle() { return shell.getRun().battle; },
    get board() { return shell.getRun().board; },
});
