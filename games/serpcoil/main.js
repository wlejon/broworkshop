import { boot } from "/lib/arcade/shell.js";
import { game, installTestHooks } from "/app/game.js";

const shell = boot(game, { width: 1280, height: 800 });
installTestHooks(shell);
