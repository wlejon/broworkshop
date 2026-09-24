// window.DELVE — the headless test surface (test.js). Keys go through the
// engine; `debug` stages situations directly on the sim and resyncs the view.

import { internals } from "/app/game.js";
import { TILE, FLAG, MONSTERS, MAP_W, MAP_H, FOV_R, PLAYER_BASE, blobVariantMasks } from "/app/sim.js";

export function installTestHooks(shell) {
    const core = () => internals.ensureCore();
    const tintsChanged = () => internals.refresh(false);

    const D = {
        shell,
        get screen() { return shell.getScreen(); },
        /** Build the scene + sim without starting a run. */
        ensure() { internals.ensureCore(); return D; },
        get game() { return internals.core; },
        get world() { return internals.core && internals.core.world; },
        get scene() { return internals.view && internals.view.scene; },
        get stage() { return internals.view && internals.view.stage; },
        get appliedTints() { return internals.view.applied; },
        TILE, FLAG, MONSTERS, MAP_W, MAP_H, FOV_R, PLAYER_BASE,
        get blobVariants() { return blobVariantMasks(); },
        debug: {
            newRun(seed) {
                if (shell.getScreen() !== "playing") shell.startRun();
                core().newRun(seed);
                internals.refresh(true);
            },
            teleport(x, y) {
                const c = core();
                c.player.x = x; c.player.y = y;
                c.computeFOV();
                tintsChanged();
            },
            spawnMonster(type, x, y, opts = {}) {
                const m = core().spawnMonster(type, x, y);
                if (opts.awake) m.awake = true;
                return m;
            },
            clearMonsters() { core().monsters.length = 0; },
            killMonster(m) {
                m.hp = 0;
                core().monsters.splice(core().monsters.indexOf(m), 1);
            },
            setHP(n) { core().player.hp = n; },
            addPotion(n) { core().player.potions += (n || 1); },
            placeItem(kind, x, y, extra = {}) { core().items.push({ kind, x, y, ...extra }); },
            placeTrap(x, y) { core().world.setFlag(x, y, FLAG.TRAP, true); },
            placeDoor(x, y, orient = 0) {
                const c = core();
                c.world.setTile(x, y, TILE.DOOR, 0);
                c.world.setFlag(x, y, FLAG.DOOR, true);
                c.doors.push({ x, y, open: false, orient });
                c.computeFOV();
                tintsChanged();
            },
            setWall(x, y, on = true) {
                const w = core().world;
                w.setTile(x, y, on ? TILE.WALL : TILE.FLOOR, 0);
                w.setFlag(x, y, FLAG.WALL, on);
                w.setFlag(x, y, FLAG.OPEN, !on);
                w.setElevation(x, y, on ? 4 : 0);
                core().computeFOV();
                tintsChanged();
            },
            carve(x0, y0, x1, y1) {
                const w = core().world;
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        w.setTile(x, y, TILE.FLOOR, 0);
                        w.setElevation(x, y, 0);
                        w.setFlag(x, y, 0xFF, false);
                        w.setFlag(x, y, FLAG.OPEN, true);
                    }
                }
                core().computeFOV();
                tintsChanged();
            },
            descend() {
                core().descend();
                internals.refresh(true);
            },
            refresh: tintsChanged,
        },
    };
    window.DELVE = D;
    return D;
}
