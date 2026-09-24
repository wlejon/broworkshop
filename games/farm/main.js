import { bootScene } from "/lib/arcade/scene3d.js";
import { game } from "/app/game.js";
import { installTestHooks } from "/app/hooks.js";

installTestHooks(bootScene(game, { width: 1100, height: 760 }));
