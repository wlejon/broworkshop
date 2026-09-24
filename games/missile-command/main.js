// Entry point: boot the plugin and expose window["__missile-command"] for the tests.
import { boot } from "/lib/arcade/shell.js";
import { exposeHooks } from "/lib/arcade/hooks.js";
import { game } from "/app/game.js";
import * as rules from "/app/rules.js";

exposeHooks(game.id, boot(game, { width: 900, height: 700 }), { rules });
