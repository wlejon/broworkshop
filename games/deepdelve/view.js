// view.js — DeepDelve's 3D presentation of the sim: the follow camera, the
// flickering torch, fog-of-war tints with combat flashes, smoothed actor
// motion, the instanced actors / items / props and monster HP bars.
// Reads the sim; never changes it.

import { createStage } from "/lib/arcade/scene3d.js";
import { orbitRotation } from "/lib/kit/viewport3d.js";
import { MAP_W, MAP_H, HSTEP, TILE, FLAG, MONSTERS } from "/app/sim.js";

const TINT_UNSEEN = [0.03, 0.03, 0.05];
const TINT_REMEMBERED = [0.16, 0.17, 0.25];
const TINT_VISIBLE = [1, 1, 1];
const DIM_REMEMBERED = 0.32;          // brightness of remembered props / items

const MONSTER_KIND = { rat: "rat", wolf: "wolf", archer: "archer", ogre: "ogre", boss: "ogre" };
const MONSTER_COLOR = {
    rat: [0.62, 0.45, 0.32, 1],
    wolf: [0.58, 0.60, 0.66, 1],
    archer: [0.88, 0.87, 0.78, 1],
    ogre: [0.45, 0.62, 0.34, 1],
    boss: [0.82, 0.20, 0.18, 1],
};
const MONSTER_SCALE = { rat: 0.9, wolf: 1.0, archer: 1.0, ogre: 1.25, boss: 1.8 };
const PLAYER_COLOR = [0.55, 0.72, 1.0, 1];

// Camera: looks down on the player from above and behind (+z), a fixed
// high angle; the pivot trails the player with exponential smoothing.
const CAM_RISE = 9.6, CAM_BACK = 6.8, CAM_LEAD = 0.4;
const CAM_FOLLOW = 0.0022;            // fraction of the gap left after 1 s
const ACTOR_LERP = 11;                // actor catch-up rate, 1/s
const SNAP = 1.6;                     // cells: farther than this snaps (teleport, descend)

const HP_BAR_W = 0.55;

/**
 * Build the scene (lights + camera) on #view. Returns the view API; call
 * frame(core, dtMs) once per update.
 */
export function createDelveView() {
    const stage = createStage({
        orbit: {
            dist: Math.hypot(CAM_RISE, CAM_BACK), fov: 46, near: 0.1, far: 120,
            rot: orbitRotation(0, -Math.atan2(CAM_RISE, CAM_BACK)),
        },
        controls: false,
    });
    const scene = stage.scene;
    scene.setToneMap({ mode: "aces", exposure: 1.06, gamma: 2.2 });
    scene.setAmbient([0.14, 0.15, 0.20]);
    scene.createLight({
        type: "directional",
        direction: [-0.35, -1.0, -0.22],
        color: [0.62, 0.68, 0.85],
        intensity: 0.85,
    });
    const torch = scene.createLight({
        type: "point", position: [0, 2, 0],
        color: [1.0, 0.72, 0.42], intensity: 2.6, range: 9.5,
    });

    let clock = 0;                          // ms of play, drives flashes + flicker
    let effects = [];                       // { cells, color, until }
    let effectsDirty = true;
    const applied = new Map();              // cell index -> tint on the world
    const cam = { x: 0, z: 0, init: false };
    const vis = { player: { x: 0, y: 0, yaw: Math.PI }, monsters: new Map() };
    const hpBars = new Map();

    // Cell -> world helpers (the world's cell grid is regular).
    let grid = null;
    function cellGrid(world) {
        if (grid && grid.world === world) return grid;
        const c00 = world.cellCenterWorldXZ(0, 0);
        const c10 = world.cellCenterWorldXZ(1, 0);
        const c01 = world.cellCenterWorldXZ(0, 1);
        grid = {
            world,
            x: (px) => c00.x + px * (c10.x - c00.x),
            z: (py) => c00.z + py * (c01.z - c00.z),
            top: (x, y) => world.getElevation(Math.round(x), Math.round(y)) * HSTEP,
        };
        return grid;
    }

    // ── Fog tints ────────────────────────────────────────────────────────

    /** Recolour cells whose fog / flash state changed (all cells with force). */
    function applyTints(core, force) {
        if (!force && !core.fogDirty && !effectsDirty) return;
        const world = core.world;
        const flash = new Map();
        for (const e of effects) for (const c of e.cells) flash.set(c.y * MAP_W + c.x, e.color);
        let dirty = false;
        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                const i = y * MAP_W + x;
                let rgb = flash.get(i);
                if (!rgb) {
                    const f = core.fog[i];
                    rgb = f === 2 ? TINT_VISIBLE : f === 1 ? TINT_REMEMBERED : TINT_UNSEEN;
                }
                if (applied.get(i) === rgb) continue;
                world.setTint(x, y, rgb[0], rgb[1], rgb[2], 1);
                applied.set(i, rgb);
                dirty = true;
            }
        }
        core.fogDirty = false;
        effectsDirty = false;
        if (dirty) world.rebuild();
    }

    /** Tint `cells` with `color` for `durMs` (arrow trails). */
    function flash(cells, color, durMs) {
        effects.push({ cells, color, until: clock + durMs });
        effectsDirty = true;
    }

    /** Forget all per-run visuals: bars, lerps, camera, flashes, tints. */
    function reset(core) {
        for (const bar of hpBars.values()) bar.destroy();
        hpBars.clear();
        vis.monsters.clear();
        vis.player.x = core.player.x;
        vis.player.y = core.player.y;
        vis.player.yaw = Math.PI;
        cam.init = false;
        applied.clear();
        effects = [];
        effectsDirty = true;
        applyTints(core, true);
    }

    /** Face the direction of a step. */
    function face(dx, dy) {
        vis.player.yaw = dx > 0 ? Math.PI / 2 : dx < 0 ? -Math.PI / 2 : dy > 0 ? Math.PI : 0;
    }

    // ── Per frame ────────────────────────────────────────────────────────

    function lerpActors(core, dtSec) {
        const rate = Math.min(1, dtSec * ACTOR_LERP);
        const p = core.player, vp = vis.player;
        vp.x += (p.x - vp.x) * rate;
        vp.y += (p.y - vp.y) * rate;
        if (Math.abs(p.x - vp.x) > SNAP || Math.abs(p.y - vp.y) > SNAP) { vp.x = p.x; vp.y = p.y; }
        const seen = new Set();
        for (const m of core.monsters) {
            seen.add(m.id);
            let v = vis.monsters.get(m.id);
            if (!v) { v = { x: m.x, y: m.y, yaw: 0 }; vis.monsters.set(m.id, v); }
            const dx = m.x - v.x, dy = m.y - v.y;
            if (Math.abs(dx) > SNAP || Math.abs(dy) > SNAP) { v.x = m.x; v.y = m.y; }
            else { v.x += dx * rate; v.y += dy * rate; }
            if (dx * dx + dy * dy > 0.0001) v.yaw = Math.atan2(dx, dy);
        }
        for (const id of vis.monsters.keys()) if (!seen.has(id)) vis.monsters.delete(id);
    }

    function follow(core, g, dtSec) {
        const px = g.x(vis.player.x), pz = g.z(vis.player.y);
        if (!cam.init) { cam.x = px; cam.z = pz; cam.init = true; }
        const k = 1 - Math.pow(CAM_FOLLOW, dtSec);
        cam.x += (px - cam.x) * k;
        cam.z += (pz - cam.z) * k;
        stage.reframe([cam.x, g.top(core.player.x, core.player.y), cam.z - CAM_LEAD]);
        stage.applyCamera();
    }

    function placeObjects(core) {
        const world = core.world, K = core.kinds;
        const fogAt = (x, y) => core.fog[y * MAP_W + x];
        const dimOf = (f) => (f === 2 ? 1 : DIM_REMEMBERED);
        const grey = (d) => [d, d, d, 1];
        for (const kn of Object.keys(K)) world.clearObjects(K[kn]);

        const vp = vis.player;
        const pcx = Math.round(vp.x), pcy = Math.round(vp.y);
        world.addObject(K.player, pcx, pcy, {
            yaw: vp.yaw, offsetX: vp.x - pcx, offsetZ: vp.y - pcy, color: PLAYER_COLOR,
        });

        for (const m of core.monsters) {
            const v = vis.monsters.get(m.id);
            if (!v) continue;
            const cx = Math.round(v.x), cy = Math.round(v.y);
            if (fogAt(cx, cy) !== 2) continue;
            world.addObject(K[MONSTER_KIND[m.type]], cx, cy, {
                yaw: v.yaw, scale: MONSTER_SCALE[m.type],
                offsetX: v.x - cx, offsetZ: v.y - cy, color: MONSTER_COLOR[m.type],
            });
        }

        for (const it of core.items) {
            const f = fogAt(it.x, it.y);
            if (f === 0) continue;
            const bob = it.kind === "amulet" ? Math.sin(clock * 0.003) * 0.06 + 0.06 : 0;
            world.addObject(K[it.kind], it.x, it.y, {
                yaw: (it.x * 7 + it.y * 13) % 6.28, yOffset: bob, color: grey(dimOf(f)),
            });
        }

        for (const d of core.doors) {
            const f = fogAt(d.x, d.y);
            if (d.open || f === 0) continue;
            world.addObject(K.door, d.x, d.y, { yaw: d.orient === 0 ? 0 : Math.PI / 2, color: grey(dimOf(f)) });
        }

        for (let y = 0; y < MAP_H; y++) {
            for (let x = 0; x < MAP_W; x++) {
                if (world.getTile(x, y, 0) !== TILE.TRAPR) continue;
                const f = fogAt(x, y);
                if (f === 0) continue;
                const armed = world.hasFlag(x, y, FLAG.TRAP), d = dimOf(f);
                world.addObject(K.spikes, x, y, {
                    yaw: (x * 5 + y * 3) % 6.28, scale: armed ? 0.7 : 1.0,
                    color: armed ? [d, d * 0.6, d * 0.6, 1] : grey(d),
                });
            }
        }

        for (const d of core.decor) {
            const f = fogAt(d.x, d.y);
            if (f === 0) continue;
            const glow = d.kind === "mushroom" && f === 2 ? 1.5 : 1;
            world.addObject(K[d.kind], d.x, d.y, {
                yaw: d.yaw, scale: d.scale, offsetX: d.ox, offsetZ: d.oz,
                color: grey(dimOf(f) * glow),
            });
        }
        world.rebuildObjects();
    }

    // Billboard HP bars over wounded, visible monsters.
    function updateHpBars(core, g) {
        const seen = new Set();
        for (const m of core.monsters) {
            const def = MONSTERS[m.type];
            const v = vis.monsters.get(m.id);
            if (!v || m.hp >= def.hp) continue;
            if (core.fog[Math.round(v.y) * MAP_W + Math.round(v.x)] !== 2) continue;
            seen.add(m.id);
            const frac = Math.max(0, m.hp / def.hp);
            const fill = frac > 0.6 ? "#46d24a" : frac > 0.3 ? "#e6c33c" : "#e04430";
            const anchor = [g.x(v.x), g.top(v.x, v.y) + 0.75 * MONSTER_SCALE[m.type], g.z(v.y)];
            let bar = hpBars.get(m.id);
            if (!bar) {
                bar = scene.createShape({
                    shape: "rect", width: HP_BAR_W, height: 0.07,
                    fill, worldAnchor: anchor, billboard: "full",
                });
                hpBars.set(m.id, bar);
            }
            bar.worldAnchor = anchor;
            bar.width = Math.max(0.05, HP_BAR_W * frac);
            bar.fillColor = fill;
        }
        for (const [id, bar] of hpBars)
            if (!seen.has(id)) { bar.destroy(); hpBars.delete(id); }
    }

    /** Advance presentation by dtMs and push everything to the scene. */
    function frame(core, dtMs) {
        clock += dtMs;
        const dtSec = dtMs / 1000;
        const g = cellGrid(core.world);
        if (effects.length) {
            const n = effects.length;
            effects = effects.filter((e) => e.until > clock);
            if (effects.length !== n) effectsDirty = true;
        }
        core.world.advance(dtMs);
        applyTints(core, false);
        lerpActors(core, dtSec);
        follow(core, g, dtSec);
        torch.position = [g.x(vis.player.x), g.top(core.player.x, core.player.y) + 1.5, g.z(vis.player.y)];
        torch.intensity = 2.6 + Math.sin(clock * 0.013) * 0.18 + Math.sin(clock * 0.037) * 0.12;
        placeObjects(core);
        updateHpBars(core, g);
    }

    return { stage, scene, applied, reset, applyTints, flash, face, frame, get clock() { return clock; } };
}
