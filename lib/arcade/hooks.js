// Arcade — the headless test surface a game exposes as window.__<id>.
//
//   // main.js
//   import { boot } from "/lib/arcade/shell.js";
//   import { exposeHooks } from "/lib/arcade/hooks.js";
//   import { game } from "/app/game.js";
//   import * as rules from "/app/rules.js";
//   exposeHooks(game.id, boot(game), { rules });
//
//   // tests/test_main.js
//   const G = window.__snake;
//   G.shell.startRun(); G.run.snake ...; G.screen === "playing"
//
// Every hook object has: shell (boot's handle), api (the shell api), screen,
// run, save. `extra` adds game-specific entries; its getters stay live.

/**
 * Install window["__" + name] and return it.
 * @param {string} name   usually game.id
 * @param {object} shell  the handle boot() / bootScene() returns
 * @param {object} [extra]
 */
export function exposeHooks(name, shell, extra) {
    const hooks = {
        shell,
        api: shell.api,
        get screen() { return shell.getScreen(); },
        get run() { return shell.getRun(); },
        get save() { return shell.api.save; },
    };
    if (extra) Object.defineProperties(hooks, Object.getOwnPropertyDescriptors(extra));
    window["__" + name] = hooks;
    return hooks;
}
