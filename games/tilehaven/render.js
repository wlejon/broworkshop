// render.js — TileHaven's per-frame scene sync: cell tints (warnings, the
// selected building's route, the tool's hover preview) and the instanced
// buildings / carts / cargo.

import { MAP_W, MAP_H, HSTEP, L_GROUND, L_ROADS, TILE, HOUSE_CAP } from "/app/sim.js";

const CARGO_COLOR = {
    food: [0.55, 0.95, 0.35, 1],
    wood: [0.62, 0.42, 0.20, 1],
    ore: [1.0, 0.72, 0.25, 1],
};
const HOUSE_TINTS = [
    [0.95, 0.82, 0.62, 1], [0.85, 0.70, 0.72, 1], [0.72, 0.80, 0.88, 1],
];
const TINT = {
    warnOn: [1.9, 0.42, 0.38], warnOff: [1.45, 0.6, 0.55],
    route: [1.45, 1.3, 0.55], selected: [1.55, 1.35, 0.6],
    ok: [0.6, 1.5, 0.65], bad: [1.8, 0.45, 0.45], bridge: [0.65, 1.1, 1.55],
    doze: [1.7, 0.9, 0.4], dozeEmpty: [1.2, 1.2, 1.2], forest: [1.2, 1.45, 0.8],
};

const blinkOn = (sim) => (sim.time % 1.2) < 0.7;

/**
 * A key for everything the tints depend on; applyTints only runs when it
 * changes (building a tint map every frame is wasted work).
 */
export function tintSignature(run) {
    const sim = run.sim;
    return sim.buildings.filter(b => !b.connected).map(b => b.id).join(",") +
        "|" + blinkOn(sim) + "|" + (run.selected ? run.selected.id : "") + "|" +
        (run.hoverCell ? run.hoverCell.x + "," + run.hoverCell.y + "," + run.tool : "");
}

function desiredTints(run) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
        want.set(x + "," + y, rgb);
    };
    const sim = run.sim, world = sim.world;
    for (const b of sim.buildings)
        if (!b.connected) put(b.x, b.y, blinkOn(sim) ? TINT.warnOn : TINT.warnOff);
    if (run.selected) {
        for (const c of sim.routeFor(run.selected)) put(c.x, c.y, TINT.route);
        put(run.selected.x, run.selected.y, TINT.selected);
    }
    if (run.tool && run.hoverCell) {
        const { x, y } = run.hoverCell;
        if (run.tool === "road") {
            const chk = sim.canPaintRoad(x, y);
            put(x, y, chk.ok ? (chk.bridge ? TINT.bridge : TINT.ok) : TINT.bad);
        } else if (run.tool === "dozer") {
            const has = sim.buildingAt(x, y) || world.getTile(x, y, L_ROADS) !== 0;
            put(x, y, has ? TINT.doze : TINT.dozeEmpty);
        } else {
            put(x, y, sim.canPlace(run.tool, x, y).ok ? TINT.ok : TINT.bad);
            if (run.tool === "lumber")
                for (const c of world.cellsInRange(x, y, 1, "vertex"))
                    if (world.getTile(c.x, c.y, L_GROUND) === TILE.FOREST) put(c.x, c.y, TINT.forest);
        }
    }
    return want;
}

/** Push the wanted tints to the world, touching only cells that changed. */
export function applyTints(run) {
    const world = run.sim.world;
    const want = desiredTints(run);
    let dirty = false;
    for (const k of run.applied.keys()) {
        if (want.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, 1, 1, 1, 1);
        run.applied.delete(k);
        dirty = true;
    }
    for (const [k, rgb] of want) {
        if (run.applied.get(k) === rgb) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.applied.set(k, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

/** Re-place every building, warning marker, cart and cargo crate. */
export function syncObjects(sim) {
    const world = sim.world, K = sim.kinds;
    for (const kind of [K.depot, K.house, K.farm, K.lumber, K.mine, K.market,
        K.houseRoof, K.cart, K.cargo, K.warn]) world.clearObjects(kind);

    for (const b of sim.buildings) {
        const opts = { yaw: b.yaw, scale: b.type === "depot" ? 1.5 : 1.15 };
        if (b.type === "house") {
            opts.color = HOUSE_TINTS[b.id % HOUSE_TINTS.length];
            opts.scale = 1.0 + 0.05 * Math.min(b.pop, HOUSE_CAP);
        }
        world.addObject(K[b.type], b.x, b.y, opts);
        if (b.type === "house")
            world.addObject(K.houseRoof, b.x, b.y, { yaw: opts.yaw, scale: opts.scale });
        if (!b.connected)
            world.addObject(K.warn, b.x, b.y, { yOffset: 0.95 + 0.08 * Math.sin(sim.time * 5 + b.id) });
    }

    for (const c of sim.carts) {
        const pos = sim.cartPos(c);
        const cx = Math.round(pos.x), cy = Math.round(pos.y);
        const a = c.path[c.seg], b = c.path[Math.min(c.seg + 1, c.path.length - 1)];
        const ea = world.getElevation(a.x, a.y) * HSTEP;
        const eb = world.getElevation(b.x, b.y) * HSTEP;
        const lift = ea + (eb - ea) * c.t + 0.02 - world.getElevation(cx, cy) * HSTEP;
        const place = {
            yaw: Math.atan2(b.x - a.x, b.y - a.y),
            offsetX: pos.x - cx, offsetZ: pos.y - cy, yOffset: lift,
        };
        world.addObject(K.cart, cx, cy, place);
        if (c.goods)
            world.addObject(K.cargo, cx, cy, Object.assign({}, place, {
                yOffset: lift + 0.19, color: CARGO_COLOR[c.goods.res],
            }));
    }
    world.rebuildObjects();
}
