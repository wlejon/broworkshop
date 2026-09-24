// render.js — GridKeep's per-frame scene sync: cell tints (range previews,
// placement hover, refusal / splash flashes), instanced towers, creeps and
// projectiles, and billboard HP bars over wounded creeps.

import { TILE, TOWER_TYPES, MAP_W, MAP_H, HSTEP } from "/app/sim.js";

const TOWER_COLOR = {
    arrow: [0.64, 0.46, 0.26, 1],
    cannon: [0.32, 0.34, 0.40, 1],
    frost: [0.34, 0.58, 0.95, 1],
};
const LEVEL_ACCENT = [null, [1, 1, 1], [1.25, 1.12, 0.9], [1.6, 1.25, 0.7]];
const CREEP_COLOR = {
    normal: [0.78, 0.22, 0.50, 1],
    fast: [1.0, 0.52, 0.10, 1],
    tank: [0.40, 0.28, 0.16, 1],
    boss: [0.70, 0.08, 0.08, 1],
};
export const TINT = {
    range: [0.75, 0.92, 1.45], selected: [1.5, 1.4, 0.7],
    preview: [0.82, 0.95, 1.35], ok: [0.55, 1.55, 0.6], bad: [1.8, 0.45, 0.45],
    refused: [1.9, 0.35, 0.35], splash: [1.7, 1.15, 0.5],
};

// ── Tints ────────────────────────────────────────────────────────────────

function desiredTints(run) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) want.set(x + "," + y, rgb);
    };
    const sim = run.sim, world = sim.world;
    const sel = run.selectedTower;
    if (sel) {
        for (const c of world.cellsInRange(sel.x, sel.y, sim.towerRange(sel), "vertex")) put(c.x, c.y, TINT.range);
        put(sel.x, sel.y, TINT.selected);
    } else if (run.placeType && run.hoverCell) {
        const { x, y } = run.hoverCell;
        const hill = world.getTile(x, y, 0) === TILE.EGRASS;
        const range = TOWER_TYPES[run.placeType].range + (hill ? 1 : 0);
        for (const c of world.cellsInRange(x, y, range, "vertex")) put(c.x, c.y, TINT.preview);
        put(x, y, run.hoverPlaceable ? TINT.ok : TINT.bad);
    }
    for (const e of run.flashes) for (const c of e.cells) put(c.x, c.y, e.color);
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

/** Tint `cells` with `color` for `durSec` of game time. */
export function flashCells(run, cells, color, durSec) {
    run.flashes.push({ cells, color, until: run.sim.time + durSec });
    applyTints(run);
}

/** Drop expired flashes; true when the tint map changed. */
export function expireFlashes(run) {
    const n = run.flashes.length;
    run.flashes = run.flashes.filter((e) => e.until > run.sim.time);
    return run.flashes.length !== n;
}

// ── Objects ──────────────────────────────────────────────────────────────

/** Re-place every tower, creep and projectile; refresh the HP bars. */
export function syncObjects(run, scene) {
    const sim = run.sim, world = sim.world, K = sim.kinds;

    for (const type of Object.keys(TOWER_TYPES)) world.clearObjects(K[type]);
    for (const t of sim.towers) {
        const base = TOWER_COLOR[t.type], acc = LEVEL_ACCENT[t.level];
        world.addObject(K[t.type], t.x, t.y, {
            yaw: t.yaw,
            scale: 1 + 0.13 * (t.level - 1),
            color: [base[0] * acc[0], base[1] * acc[1], base[2] * acc[2], 1],
        });
    }

    for (const kn of ["normal", "fast", "tank"]) world.clearObjects(K[kn]);
    for (const c of sim.creeps) {
        const cx = Math.round(c.px), cy = Math.round(c.py);
        const col = CREEP_COLOR[c.type].slice();
        if (sim.isSlowed(c)) { col[0] *= 0.45; col[1] *= 0.75; col[2] = Math.min(1, col[2] * 1.6 + 0.3); }
        if (c.hitFlash > 0) { col[0] = Math.min(1.6, col[0] + 0.9); col[1] += 0.5; col[2] += 0.5; }
        world.addObject(K[c.type], cx, cy, {
            yaw: c.yaw, scale: c.def.scale,
            offsetX: c.px - cx, offsetZ: c.py - cy,
            color: col,
        });
    }

    const PK = { arrow: K.projArrow, cannon: K.projCannon, frost: K.projFrost };
    for (const k of Object.values(PK)) world.clearObjects(k);
    for (const p of sim.projectiles) {
        const cx = Math.round(p.x), cy = Math.round(p.y);
        if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) continue;
        const cellTop = world.getElevation(cx, cy) * HSTEP;
        world.addObject(PK[p.kind], cx, cy, {
            yaw: p.yaw,
            offsetX: p.x - cx, offsetZ: p.y - cy,
            yOffset: Math.max(0.05, p.h - cellTop),
        });
    }
    world.rebuildObjects();
    syncHpBars(run, scene);
}

// Cell (fractional) -> world XZ, from the cell-centre spacing.
function cellToWorld(world, px, py) {
    const c00 = world.cellCenterWorldXZ(0, 0);
    const c11 = world.cellCenterWorldXZ(1, 1);
    return { x: c00.x + px * (c11.x - c00.x), z: c00.z + py * (c11.z - c00.z) };
}

function syncHpBars(run, scene) {
    const sim = run.sim;
    const seen = new Set();
    for (const c of sim.creeps) {
        if (c.hp >= c.maxHp) continue;
        seen.add(c.id);
        const frac = c.hp / c.maxHp;
        const fill = frac > 0.6 ? "#46d24a" : frac > 0.3 ? "#e6c33c" : "#e04430";
        const w = cellToWorld(sim.world, c.px, c.py);
        const anchor = [w.x, 0.62 * c.def.scale + 0.18, w.z];
        let bar = run.hpBars.get(c.id);
        if (!bar) {
            bar = scene.createShape({
                shape: "rect", width: 0.6, height: 0.075,
                fill, worldAnchor: anchor, billboard: "full",
            });
            run.hpBars.set(c.id, bar);
        }
        bar.worldAnchor = anchor;
        bar.width = Math.max(0.05, 0.6 * frac * c.def.scale);
        bar.fillColor = fill;
    }
    for (const [id, bar] of run.hpBars) {
        if (!seen.has(id)) { bar.destroy(); run.hpBars.delete(id); }
    }
}

/** Remove a finished run's world and bars from the scene. */
export function disposeRun(run) {
    for (const bar of run.hpBars.values()) bar.destroy();
    run.hpBars.clear();
    run.sim.world.destroy();
}
