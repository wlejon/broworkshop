import { boot } from "/lib/arcade/shell.js";
import { game } from "/app/game.js";
import { installTestHooks } from "/app/hooks.js";

installTestHooks(boot(game, { width: 1200, height: 800 }));
