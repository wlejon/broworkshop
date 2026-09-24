// Entry point: boot the plugin and expose window.__<id> for the tests.
// Identical for every 2D arcade game (3D games use bootScene instead).
import { boot } from "/lib/arcade/shell.js";
import { exposeHooks } from "/lib/arcade/hooks.js";
import { game } from "/app/game.js";
import * as rules from "/app/rules.js";

exposeHooks(game.id, boot(game), { rules });
