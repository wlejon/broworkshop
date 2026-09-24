// Tumble board — one level's playfield: environment, piece budget and the
// cell grid. Scene + Physics only; no DOM. State lives on the run:
//
//   run.level / run.levelIdx
//   run.budget     { type: { used, limit } }
//   run.placed     Map cellKey -> { type, rot, cell, node, body, extras, extraBodies, furniture }
//   run.meshToCell Map node id -> cellKey   (right-click removal by raycast)
//   run.bodyToCell Map body id -> cellKey   (contact handling)
//   run.spinners   cellKeys of animated spinner pieces
//   run.env        goal nodes (for the clear pulse)

import { PIECES, PIECE_ORDER } from "/app/pieces.js";
import { LEVELS, goalCenter } from "/app/levels.js";

export function cellKey(cx, cy, cz) { return cx + "," + cy + "," + cz; }

/**
 * Wipe the scene and physics world and build level `idx` fresh: lights,
 * floor, spout, cup, budget and furniture. The caller adds the build aids.
 */
export function resetBoard(run, idx) {
    const scene = run.scene;
    const level = LEVELS[idx];
    scene.clear();
    Physics.createWorld({ maxBodies: 4096 });
    Physics.setGravity(0, level.gravity, 0);

    run.level = level;
    run.levelIdx = idx;
    run.placed = new Map();
    run.meshToCell = new Map();
    run.bodyToCell = new Map();
    run.spinners = [];
    run.marbles = [];
    run.marbleBodies = new Set();
    run.env = buildEnvironment(scene, level);

    run.budget = {};
    for (const t of PIECE_ORDER) run.budget[t] = { used: 0, limit: level.budget[t] || 0 };

    // Prefer the pieces that make a path, then aim them spout → cup.
    const pick = ["booster", "ramp", "chute", "bumper", "spinner", "wall", "block"];
    run.build.selected = pick.find((t) => run.budget[t].limit > 0) || "block";
    run.build.rot = defaultRotTowardCup(level, run.build.selected);
    run.build.layer = Math.max(0, level.bounds.y[0]);

    for (const f of level.furniture) {
        placePiece(run, f.type, f.cell[0], f.cell[1], f.cell[2], f.rot || 0, { furniture: true });
    }
}

/** Camera framing for a level: { pivot, dist }. */
export function framing(level) {
    const bx = level.bounds.x, bz = level.bounds.z;
    const diag = Math.hypot(bx[1] - bx[0], bz[1] - bz[0]);
    return {
        pivot: [(bx[0] + bx[1]) * 0.5, (level.bounds.y[0] + level.bounds.y[1]) * 0.35, (bz[0] + bz[1]) * 0.5],
        dist: Math.max(10, diag * 1.4),
    };
}

// ── Environment ─────────────────────────────────────────────────────────

const RIM_GLOW = 2.2;   // cup rim emissive at rest
const FILL_GLOW = 0.6;  // cup floor emissive at rest

function staticBox(half, pos, friction, restitution) {
    return Physics.createBody({
        shape: "box", static: true, halfExtents: half, position: pos, friction, restitution,
    });
}

function buildEnvironment(scene, level) {
    scene.setAmbient([0.05, 0.055, 0.065]);
    scene.setToneMap({ mode: "aces", exposure: 1.1 });
    scene.setFog({ start: 25, end: 60, color: [0.04, 0.05, 0.09] });
    scene.createLight({ type: "directional", direction: [-0.45, -1.0, -0.35], color: [1.0, 0.97, 0.9], intensity: 2.6, name: "sun" });
    scene.createLight({ type: "point", position: [0, 5, 8], color: [1.0, 0.75, 0.55], intensity: 14, range: 18, name: "warm-fill" });
    scene.createLight({ type: "point", position: [-6, 4, -6], color: [0.5, 0.7, 1.0], intensity: 10, range: 14, name: "cool-rim" });

    // Floor. Low friction so failed marbles slide off instead of gluing.
    const bx = level.bounds.x, bz = level.bounds.z;
    const w = bx[1] - bx[0] + 3, d = bz[1] - bz[0] + 3;
    const cx = (bx[0] + bx[1]) * 0.5, cz = (bz[0] + bz[1]) * 0.5;
    scene.createMesh({
        mesh: "plane", halfW: w * 0.5, halfD: d * 0.5, x: cx, y: -0.02, z: cz,
        color: "#1a2236", metallic: 0.0, roughness: 0.92, name: "ground",
    });
    staticBox({ x: w * 0.5, y: 0.02, z: d * 0.5 }, { x: cx, y: -0.02, z: cz }, 0.18, 0.15);

    // Spout: glowing disc on a thin post.
    const sp = level.spawner;
    scene.createMesh({
        mesh: "cylinder", radius: 0.35, halfHeight: 0.08, segments: 24,
        x: sp.x, y: sp.y + 0.18, z: sp.z,
        color: "#ffd466", metallic: 0.1, roughness: 0.3,
        emissive: 1.5, emissiveColor: [1.0, 0.82, 0.4], name: "spawner",
    });
    scene.createMesh({
        mesh: "cylinder", radius: 0.04, halfHeight: 0.6, segments: 12,
        x: sp.x, y: sp.y - 0.5, z: sp.z,
        color: "#ffd466", emissive: 2.0, emissiveColor: [1.0, 0.85, 0.4], metallic: 0.0, roughness: 1.0,
    });

    // Cup: glowing rim, floor pad, and a low physics lip (full-height walls
    // blocked marbles rolling in from a runway).
    const g = level.goal;
    const gc = goalCenter(level);
    const ghw = (g.max[0] - g.min[0]) * 0.5, ghd = (g.max[2] - g.min[2]) * 0.5;
    const rimY = g.max[1] + 0.02;
    const rims = [
        { x: gc.x - ghw, z: gc.z, hw: 0.04, hd: ghd + 0.04 },
        { x: gc.x + ghw, z: gc.z, hw: 0.04, hd: ghd + 0.04 },
        { x: gc.x, z: gc.z - ghd, hw: ghw + 0.04, hd: 0.04 },
        { x: gc.x, z: gc.z + ghd, hw: ghw + 0.04, hd: 0.04 },
    ].map((r) => scene.createMesh({
        mesh: "box", halfW: r.hw, halfH: 0.04, halfD: r.hd, x: r.x, y: rimY, z: r.z,
        color: "#4eff8f", metallic: 0.0, roughness: 0.5, emissive: RIM_GLOW, emissiveColor: [0.3, 1.0, 0.6],
    }));
    const fill = scene.createMesh({
        mesh: "box", halfW: ghw, halfH: 0.02, halfD: ghd, x: gc.x, y: g.min[1] + 0.02, z: gc.z,
        color: "#0a3a1e", emissive: FILL_GLOW, emissiveColor: [0.2, 0.9, 0.5], metallic: 0.0, roughness: 0.8,
    });
    staticBox({ x: ghw, y: 0.02, z: ghd }, { x: gc.x, y: g.min[1] + 0.02, z: gc.z }, 0.8, 0.1);
    const lipH = 0.1, lipY = g.min[1] + lipH * 0.5;
    const lips = [
        { x: g.min[0], z: gc.z, hw: 0.035, hd: ghd + 0.03 },
        { x: g.max[0], z: gc.z, hw: 0.035, hd: ghd + 0.03 },
        { x: gc.x, z: g.min[2], hw: ghw + 0.03, hd: 0.035 },
        { x: gc.x, z: g.max[2], hw: ghw + 0.03, hd: 0.035 },
    ];
    for (const l of lips) {
        staticBox({ x: l.hw, y: lipH * 0.5, z: l.hd }, { x: l.x, y: lipY, z: l.z }, 0.35, 0.15);
        scene.createMesh({
            mesh: "box", halfW: l.hw, halfH: lipH * 0.5, halfD: l.hd, x: l.x, y: lipY, z: l.z,
            color: "#1e4a2e", emissive: 0.35, emissiveColor: [0.2, 0.9, 0.5], metallic: 0.05, roughness: 0.7,
        });
    }
    return { goalRims: rims, goalFill: fill, pulseGen: 0 };
}

/** Flash the cup brightly for a moment (on a clear). */
export function pulseGoal(run) {
    const env = run.env;
    if (!env) return;
    const gen = ++env.pulseGen;
    for (const n of env.goalRims) n.emissive = 4.5;
    env.goalFill.emissive = 4.5;
    setTimeout(() => {
        // A newer pulse, or a rebuilt board, owns the nodes now.
        if (run.env !== env || env.pulseGen !== gen) return;
        for (const n of env.goalRims) n.emissive = RIM_GLOW;
        env.goalFill.emissive = FILL_GLOW;
    }, 450);
}

// ── Cells and placement ─────────────────────────────────────────────────

export function inBounds(level, cx, cy, cz) {
    const b = level.bounds;
    return cx >= b.x[0] && cx <= b.x[1] && cy >= b.y[0] && cy <= b.y[1] && cz >= b.z[0] && cz <= b.z[1];
}

/** Cells inside the cup, or right under the spout, never take pieces. */
export function cellReserved(level, cx, cy, cz) {
    const g = level.goal;
    const wx = cx + 0.5, wy = cy + 0.5, wz = cz + 0.5;
    if (wx >= g.min[0] && wx <= g.max[0] && wy >= g.min[1] && wy <= g.max[1] &&
        wz >= g.min[2] && wz <= g.max[2]) return true;
    const s = level.spawner;
    return Math.floor(s.x) === cx && Math.floor(s.z) === cz && Math.abs(wy - s.y) < 1.0;
}

/**
 * Why a `type` piece cannot go in the cell, or null when it can:
 * "bounds" | "reserved" | "occupied" | "budget".
 */
export function placeBlocker(run, type, cx, cy, cz) {
    if (!inBounds(run.level, cx, cy, cz)) return "bounds";
    if (cellReserved(run.level, cx, cy, cz)) return "reserved";
    if (run.placed.has(cellKey(cx, cy, cz))) return "occupied";
    const b = run.budget[type];
    if (!b || b.used >= b.limit) return "budget";
    return null;
}

/** Place a piece; opts.furniture skips the budget and pins it. Returns true on success. */
export function placePiece(run, type, cx, cy, cz, rot, opts) {
    const furniture = !!(opts && opts.furniture);
    const def = PIECES[type];
    if (!def) return false;
    const blocker = placeBlocker(run, type, cx, cy, cz);
    if (blocker && !(furniture && blocker === "budget")) return false;
    const key = cellKey(cx, cy, cz);
    const built = def.build(run.scene, { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 }, rot | 0);
    const rec = {
        type, rot: rot | 0, cell: [cx, cy, cz], furniture,
        node: built.node, body: built.body,
        extras: built.extras || [], extraBodies: built.extraBodies || [],
        anim: built.anim || null,
    };
    run.placed.set(key, rec);
    if (!furniture) run.budget[type].used += 1;
    for (const n of [rec.node].concat(rec.extras)) if (n) run.meshToCell.set(n.id, key);
    for (const b of [rec.body].concat(rec.extraBodies)) if (b != null) run.bodyToCell.set(b, key);
    if (rec.anim) run.spinners.push(key);
    return true;
}

/** Remove a player-placed piece (furniture stays). Returns true on success. */
export function removePiece(run, key) {
    const rec = run.placed.get(key);
    if (!rec || rec.furniture) return false;
    for (const n of [rec.node].concat(rec.extras)) {
        if (!n) continue;
        run.meshToCell.delete(n.id);
        run.scene.destroyNode(n);
    }
    for (const b of [rec.body].concat(rec.extraBodies)) {
        if (b == null) continue;
        run.bodyToCell.delete(b);
        Physics.destroyBody(b);
    }
    const i = run.spinners.indexOf(key);
    if (i >= 0) run.spinners.splice(i, 1);
    run.placed.delete(key);
    run.budget[rec.type].used = Math.max(0, run.budget[rec.type].used - 1);
    return true;
}

/** Piece types this level hands out, in palette order. */
export function availablePieces(run) {
    return PIECE_ORDER.filter((t) => run.budget[t] && run.budget[t].limit > 0);
}

export function budgetTotals(run) {
    let used = 0, limit = 0;
    for (const t of PIECE_ORDER) {
        used += run.budget[t].used;
        limit += run.budget[t].limit;
    }
    return { used, limit };
}

/**
 * Default facing so the piece points spout → cup. Booster rot 0..3 shoves
 * +X, +Z, -X, -Z; ramp rot 0..3 runs downhill -X, -Z, +X, +Z.
 */
export function defaultRotTowardCup(level, type) {
    const gc = goalCenter(level);
    const dx = gc.x - level.spawner.x, dz = gc.z - level.spawner.z;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    if (type === "booster") return alongX ? (dx >= 0 ? 0 : 2) : (dz >= 0 ? 1 : 3);
    if (type === "ramp") return alongX ? (dx >= 0 ? 2 : 0) : (dz >= 0 ? 3 : 1);
    return 0;
}
