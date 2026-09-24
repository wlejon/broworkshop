// Scene side of the village: lighting through the day, object placement on
// the tile world (static props, trees, resource piles, villagers, the fire),
// and the cell tints marking a selected villager and their home.

const lerp = (a, b, t) => a + (b - a) * t;

/** Sun + hearth light. Returns { placeFire(sim), update(sim) }. */
export function setupLighting(scene) {
    scene.setToneMap({ mode: "aces", exposure: 0.95, gamma: 2.2 });
    scene.setAmbient([0.20, 0.21, 0.26]);
    const sun = scene.createLight({
        type: "directional", direction: [-0.5, -1.0, -0.35],
        color: [1.0, 0.95, 0.86], intensity: 2.1,
    });
    const fire = scene.createLight({
        type: "point", position: [0, 1.2, 0],
        color: [1.0, 0.55, 0.22], intensity: 0, range: 7,
    });
    return {
        placeFire(sim) {
            const hc = sim.world.cellCenterWorldXZ(sim.hearth.x, sim.hearth.y);
            fire.position = [hc.x, 1.1, hc.z];
        },
        update(sim) {
            const tod = sim.tod();
            const dayF = tod < 0.06 ? tod / 0.06 : tod < 0.55 ? 1 : tod < 0.72 ? 1 - (tod - 0.55) / 0.17 : 0;
            sun.intensity = lerp(0.22, 2.1, dayF);
            sun.color = [lerp(0.55, 1.0, dayF), lerp(0.58, 0.95, dayF), lerp(0.85, 0.86, dayF)];
            scene.setAmbient([lerp(0.05, 0.20, dayF), lerp(0.06, 0.21, dayF), lerp(0.11, 0.26, dayF)]);
            const flicker = 0.9 + 0.1 * Math.sin(sim.time * 9.3) * Math.sin(sim.time * 5.1);
            fire.intensity = sim.fire * lerp(14, 3, dayF) * flicker;
        },
    };
}

/** Re-place whatever the sim marked dirty, then the movers. Once per frame. */
export function syncWorld(sim) {
    if (sim.dirty.static) syncStatic(sim);
    if (sim.dirty.trees) syncTrees(sim);
    if (sim.dirty.piles) syncPiles(sim);
    syncDynamic(sim);
}

function clearKinds(world, ...kinds) {
    for (const k of kinds) world.clearObjects(k);
}

function syncStatic(sim) {
    const world = sim.world, K = sim.kinds;
    clearKinds(world, K.hut, K.hutRoof, K.hearth, K.bench, K.kitchen, K.boulder);
    for (const h of sim.homes) {
        const yaw = Math.atan2(23 - h.x, 17 - h.y);   // doors face the plaza
        world.addObject(K.hut, h.x, h.y, { yaw, scale: 1.25 });
        world.addObject(K.hutRoof, h.x, h.y, { yaw, scale: 1.25 });
    }
    world.addObject(K.hearth, sim.hearth.x, sim.hearth.y, { scale: 1.3 });
    world.addObject(K.bench, sim.bench.x, sim.bench.y, { yaw: Math.PI / 3 });
    world.addObject(K.kitchen, sim.kitchen.x, sim.kitchen.y, { yaw: -Math.PI / 2 });
    let i = 0;
    for (const c of sim.rockCells) {
        if ((i++ % 5) !== 0) continue;
        world.addObject(K.boulder, c.x, c.y, {
            yaw: i * 1.7, scale: 0.7 + (i % 3) * 0.25,
            offsetX: ((i * 7) % 10) / 20 - 0.25, offsetZ: ((i * 13) % 10) / 20 - 0.25,
        });
    }
    sim.dirty.static = false;
}

function syncTrees(sim) {
    const world = sim.world, K = sim.kinds;
    clearKinds(world, K.tree, K.stump);
    for (const t of sim.trees) {
        if (t.alive) world.addObject(K.tree, t.x, t.y, { yaw: t.yaw, scale: t.scale, offsetX: t.ox, offsetZ: t.oz });
        else world.addObject(K.stump, t.x, t.y, { yaw: t.yaw, offsetX: t.ox, offsetZ: t.oz });
    }
    sim.dirty.trees = false;
}

function syncPiles(sim) {
    const world = sim.world, K = sim.kinds;
    clearKinds(world, K.stone, K.meal, K.logPile);
    const q = sim.quarry;
    for (let i = 0; i < Math.min(sim.res.stone, 10); i++)
        world.addObject(K.stone, q.x, q.y, {
            yaw: i * 2.3,
            offsetX: ((i % 3) - 1) * 0.28, offsetZ: (Math.floor(i / 3) - 1) * 0.24,
            yOffset: 0.02,
        });
    const kc = sim.kitchen;
    for (let i = 0; i < Math.min(sim.res.meals, 8); i++)
        world.addObject(K.meal, kc.x, kc.y, {
            offsetX: -0.30 + (i % 4) * 0.17, offsetZ: 0.30 + Math.floor(i / 4) * 0.16,
        });
    for (let i = 0; i < Math.min(Math.ceil(sim.res.wood / 3), 4); i++)
        world.addObject(K.logPile, sim.hearth.x - 1, sim.hearth.y + 1, {
            yaw: 0.3, offsetX: -0.2 + i * 0.16, offsetZ: 0.1,
        });
    sim.dirty.piles = false;
}

function syncDynamic(sim) {
    const world = sim.world, K = sim.kinds;
    sim.villagers.forEach((v, i) => {
        const kind = K.villagers[i];
        world.clearObjects(kind);
        const ri = sim.renderInfo(v);
        if (v.path && v.seg < v.path.length - 1) {     // face along the walk
            const a = v.path[v.seg], b = v.path[v.seg + 1];
            v.faceYaw = Math.atan2(b.x - a.x, b.y - a.y);
        }
        const asleep = v.activity === "sleeping";
        world.addObject(kind, ri.anchor.x, ri.anchor.y, {
            yaw: v.faceYaw || 0,
            offsetX: ri.offsetX, offsetZ: ri.offsetZ,
            yOffset: ri.yOffset + (asleep ? -0.06 : 0),
            scale: asleep ? 1.1 : 1.35,
        });
    });
    world.clearObjects(K.flame);
    if (sim.fire > 0.03) {
        const s = 0.5 + sim.fire * 0.9 + 0.06 * Math.sin(sim.time * 7);
        world.addObject(K.flame, sim.hearth.x, sim.hearth.y, { scale: s, yOffset: 0.06 });
    }
    world.rebuildObjects();
}

/**
 * Cell tints for the selected villager: gold under them, blue on their home.
 * Returns { apply(selected), follow(selected), clear() }: follow() re-applies
 * only when the villager has stepped onto a new cell.
 */
export function createTints(sim) {
    const world = sim.world;
    const tinted = new Set();
    let lastCell = "";
    const parse = (k) => k.split(",").map(Number);

    function apply(selected) {
        const want = new Map();
        if (selected) {
            const c = sim.cellOf(selected);
            lastCell = c.x + "," + c.y;
            // Tints multiply in 0..1 (no overbright): gold = less blue, blue = less red.
            want.set(lastCell, [1, 1, 0.6]);
            want.set(selected.home.x + "," + selected.home.y, [0.7, 1, 1]);
        }
        let dirty = false;
        for (const k of [...tinted]) {
            if (want.has(k)) continue;
            const [x, y] = parse(k);
            world.setTint(x, y, 1, 1, 1, 1);
            tinted.delete(k);
            dirty = true;
        }
        for (const [k, rgb] of want) {
            const [x, y] = parse(k);
            const cur = world.getTint(x, y);
            tinted.add(k);
            if (Math.abs(cur.r - rgb[0]) < 0.02 && Math.abs(cur.g - rgb[1]) < 0.02 &&
                Math.abs(cur.b - rgb[2]) < 0.02) continue;
            world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
            dirty = true;
        }
        if (dirty) world.rebuild();
    }

    return {
        apply,
        follow(selected) {
            if (!selected) return;
            const c = sim.cellOf(selected);
            if (c.x + "," + c.y !== lastCell) apply(selected);
        },
        /** Forget every tint without a rebuild (the caller rebuilds). */
        clear() {
            for (const k of tinted) {
                const [x, y] = parse(k);
                world.setTint(x, y, 1, 1, 1, 1);
            }
            tinted.clear();
            lastCell = "";
        },
    };
}
