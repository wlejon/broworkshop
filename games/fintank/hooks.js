// window.__fintank — the headless test surface (tests/test_*.js). Screens
// are the shell's; `tank` is the live aquarium with its debug actions.

import { internals } from "/app/game.js";
import * as economy from "/app/economy.js";

export function installTestHooks(shell) {
    const tank = () => internals.tank;
    const H = {
        shell,
        economy,
        get tank() { return tank(); },
        get options() { return internals.options; },
        get screen() { return shell.getScreen(); },
        get state() {
            const t = tank();
            return { slot: t.slot, fish: t.fish, pellets: t.pellets, coins: t.coins,
                intruders: t.intruders, pet: t.pet, dayTimer: t.dayTimer, status: t.status };
        },
        feed: (x) => tank().debug.addPellet(x != null ? x : 600, 100),
        buy: (item) => tank().buy(item),
        addCoins: (n) => tank().debug.addCoins(n),
        spawnIntruder: (type) => tank().debug.spawnIntruder(type || "snatcher"),
        killAllIntruders: () => tank().debug.killAllIntruders(),
        collectAllCoins: () => tank().debug.collectAllCoins(),
        feedFish: (i) => tank().debug.feedFish(i),
        endDay: () => tank().debug.endDay(),
    };
    window.__fintank = H;
    return H;
}
