// render.js — BlastGrid's scene sync: instanced bombers, bombs, fire and
// power-ups on the sim's TileWorld, danger / fire / sudden-death cell tints,
// and the blast flash light.

import { MAP_W, MAP_H, FUSE, FIRE_LINGER, POWER_TYPES } from "/app/rules.js";

const FLASH_DUR = 0.28;

/** Register the object kinds on a fresh world: { name: kindId }. */
export function registerKinds(world) {
    const M = Mesh;
    const add = (mesh, look) => world.addObjectKind(mesh, look);
    const kinds = {
        bomber: add(M.merge([
            M.sphere(0.26, 14, 10).translate(0, 0.30, 0),
            M.sphere(0.16, 12, 8).translate(0, 0.60, 0),
            M.box(0.05, 0.05, 0.05).translate(0, 0.60, 0.16),
            M.box(0.09, 0.06, 0.13).translate(-0.11, 0.05, 0),
            M.box(0.09, 0.06, 0.13).translate(0.11, 0.05, 0),
        ]), { color: [1, 1, 1, 1], roughness: 0.75 }),
        bomb: add(M.merge([
            M.sphere(0.235, 14, 10).translate(0, 0.24, 0),
            M.cylinder(0.045, 0.10, 6).translate(0, 0.50, 0),
        ]), { color: [1, 1, 1, 1], roughness: 0.45, metallic: 0.25 }),
        fire: add(M.merge([
            M.cone(0.32, 0.62, 8, 1, false).translate(0, 0.02, 0),
            M.sphere(0.20, 10, 7).translate(0, 0.14, 0),
        ]), { color: [1.0, 0.52, 0.10, 1], roughness: 0.35, castsShadow: false }),
        bombs: add(M.merge([
            M.sphere(0.16, 12, 8).translate(0, 0.16, 0),
            M.cylinder(0.035, 0.08, 6).translate(0, 0.36, 0),
        ]), { color: [0.30, 0.55, 1.0, 1], roughness: 0.4, metallic: 0.2 }),
        range: add(M.cone(0.17, 0.36, 8, 1, false).translate(0, 0.04, 0),
            { color: [1.0, 0.45, 0.10, 1], roughness: 0.4 }),
        speed: add(M.torus(0.15, 0.055, 14, 8).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.20, 0),
            { color: [0.15, 0.95, 0.85, 1], roughness: 0.35, metallic: 0.3 }),
    };
    world.rebuildObjects();
    return kinds;
}

// ── Tints ────────────────────────────────────────────────────────────────

const DANGER = [1.18, 0.94, 0.88];
const SD_WARN = [1.9, 0.5, 0.5];

function desiredTints(sim) {
    const want = new Map();
    const put = (x, y, rgb) => {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) want.set(x + "," + y, rgb);
    };
    for (const k of sim.dangerSet) put(k % MAP_W, (k / MAP_W) | 0, DANGER);
    for (const [k, until] of sim.fire) {
        const t = Math.round(Math.max(0, Math.min(1, (until - sim.time) / FIRE_LINGER)) * 5) / 5;
        put(k % MAP_W, (k / MAP_W) | 0, [1 + 1.25 * t, 1 + 0.32 * t, 1 - 0.55 * t]);
    }
    if (sim.sd.active) {
        const n = sim.nextSdCell();
        if (n && Math.floor(sim.time * 4) % 2 === 0) put(n.x, n.y, SD_WARN);
    }
    return want;
}

const same = (a, b) => a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Push the wanted tints to the world, touching only cells that changed. */
export function applyTints(run) {
    const world = run.sim.world;
    const want = desiredTints(run.sim);
    let dirty = false;
    for (const k of run.applied.keys()) {
        if (want.has(k)) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, 1, 1, 1, 1);
        run.applied.delete(k);
        dirty = true;
    }
    for (const [k, rgb] of want) {
        if (same(run.applied.get(k), rgb)) continue;
        const [x, y] = k.split(",").map(Number);
        world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
        run.applied.set(k, rgb);
        dirty = true;
    }
    if (dirty) world.rebuild();
}

// ── Objects ──────────────────────────────────────────────────────────────

/** Re-place bombers, bombs, fire and power-ups; fade the flash light. */
export function syncObjects(run, flash, dt) {
    const sim = run.sim, world = sim.world, K = run.kinds, t = sim.time;

    world.clearObjects(K.bomber);
    for (const e of sim.contenders) {
        if (!e.alive) continue;
        const cx = Math.round(e.px), cy = Math.round(e.py);
        world.addObject(K.bomber, cx, cy, {
            yaw: e.facing,
            offsetX: e.px - cx, offsetZ: e.py - cy,
            yOffset: e.moving ? Math.abs(Math.sin(t * 11 + e.i)) * 0.05 : 0,
            color: e.color,
        });
    }

    world.clearObjects(K.bomb);
    for (const b of sim.bombs) {
        const burnt = 1 - Math.max(0, b.fuse) / FUSE;
        const red = Math.max(0, (burnt - 0.55) / 0.45);
        world.addObject(K.bomb, b.x, b.y, {
            scale: 1 + 0.08 * Math.sin(t * (6 + burnt * 14)),
            color: [0.14 + 0.9 * red, 0.14, 0.17, 1],
        });
    }

    world.clearObjects(K.fire);
    for (const [k, until] of sim.fire) {
        const x = k % MAP_W, y = (k / MAP_W) | 0;
        const life = Math.max(0, Math.min(1, (until - t) / FIRE_LINGER));
        const jig = 1 + 0.10 * Math.sin(t * 40 + x * 3.1 + y * 7.3);
        world.addObject(K.fire, x, y, {
            scale: (0.35 + 0.95 * life) * jig,
            yaw: (x * 5 + y * 11) % 6.28,
            color: [1, 0.65 + 0.35 * life, 0.35 * life, 1],
        });
    }

    for (const type of POWER_TYPES) world.clearObjects(K[type]);
    for (const p of sim.powerups) {
        world.addObject(K[p.type], p.x, p.y, {
            yaw: t * 2.6,
            scale: 1.35,
            yOffset: 0.10 + Math.sin(t * 3.0 + p.x + p.y) * 0.05,
        });
    }
    world.rebuildObjects();

    run.flashT = Math.max(0, run.flashT - dt);
    flash.intensity = run.flashT > 0 ? 30 * (run.flashT / FLASH_DUR) : 0;
}

/** Light up the first blast centre. */
export function flashAt(run, flash, cell) {
    const w = run.sim.world.cellCenterWorldXZ(cell.x, cell.y);
    flash.position = [w.x, 1.4, w.z];
    run.flashT = FLASH_DUR;
}
