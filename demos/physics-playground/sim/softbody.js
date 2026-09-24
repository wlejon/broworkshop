// sim/softbody.js — a pinned cloth and a pressurized ball.
//
// A soft body's state does not fit in a transform: it is a few hundred XPBD
// particles, and the only way to see it is to stream them into a mesh every
// frame (updateSoftBodies). The particles are individually addressable, which
// the gust (setVertexVelocity) and poke (setVertex) buttons show in miniature.
//
//   cloth  a grid in the XZ plane. Pinned vertices have invMass 0: they do not
//          move AT ALL while the sheet between them sags metres.
//   ball   a closed icosphere with gas pressure: a wet rag at 300, a drum at
//          6000. Pressure is baked at creation (no runtime setter), so the
//          slider rebuilds and re-drops the ball, which suits an A/B anyway.

import { ctx } from "./ctx.js";

// A closed mesh with outward winding and even triangle areas, or the gas term
// pushes unevenly; a UV sphere's pole fans would make it wobble.
function icosphere(radius, subdiv) {
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    let faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let s = 0; s < subdiv; s++) {
        const mid = new Map();
        const midpoint = (a, b) => {
            const key = a < b ? a + '_' + b : b + '_' + a;
            if (mid.has(key)) return mid.get(key);
            const va = verts[a], vb = verts[b];
            verts.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
            mid.set(key, verts.length - 1);
            return verts.length - 1;
        };
        const next = [];
        for (const [a, b, c] of faces) {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = next;
    }
    const positions = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => {
        const L = Math.hypot(v[0], v[1], v[2]) || 1;
        positions[i * 3] = (v[0] / L) * radius;
        positions[i * 3 + 1] = (v[1] / L) * radius;
        positions[i * 3 + 2] = (v[2] / L) * radius;
    });
    return { positions, indices: new Uint32Array(faces.flat()) };
}

// Both live downfield of the water tank, above the lanes, clear of the race.
export const CLOTH = { gridX: 16, gridZ: 16, spacing: 0.28, mass: 3.0, position: { x: 19, y: 6.0, z: 0 } };
export const BALL = { radius: 0.6, subdiv: 2, mass: 2.0, position: { x: 15, y: 6.0, z: 0 } };

export const PIN_SETS = {
    corners: 'four corners — a hammock; drop things into it',
    edge: 'one edge — a banner; the sheet drapes and swings',
    none: 'nothing pinned — the whole sheet falls',
};

/** Vertex (x, z) of a cloth grid lives at index z * gridX + x. */
export function pinIndices(set, gridX = CLOTH.gridX, gridZ = CLOTH.gridZ) {
    if (set === 'none') return [];
    if (set === 'edge') return Array.from({ length: gridX }, (_, x) => x);     // the z = 0 row
    return [0, gridX - 1, (gridZ - 1) * gridX, gridX * gridZ - 1];
}

/** key -> { key, sb, node, topo, meta }: at most one cloth and one ball. */
export const softBodies = new Map();

// The node stays at IDENTITY: vertices() streams WORLD positions, so any node
// transform would apply twice. Normals are recomputed because the stream is
// positions only; without them a deforming sheet lights as if flat.
function register(key, sb, meta, look) {
    const topo = sb.topology();
    const node = ctx.scene.createMesh({
        positions: sb.vertices(), indices: topo.indices,
        recomputeNormals: true, twoSided: true, ...look,
    });
    const entry = { key, sb, node, topo, meta };
    softBodies.set(key, entry);
    return entry;
}

/** Create (or recreate) the cloth with a PIN_SETS key. */
export function buildCloth(set = 'corners', opts = {}) {
    destroySoft('cloth');
    const pinned = pinIndices(set);
    const sb = Physics.createSoftBody({
        cloth: { gridX: CLOTH.gridX, gridZ: CLOTH.gridZ, spacing: CLOTH.spacing, mass: CLOTH.mass, pinned },
        position: CLOTH.position,
        layer: 'player',
        // Rigid edges, no bend constraints: keeps its area, folds freely, so a
        // hammock reads as fabric rather than a trampoline skin.
        compliance: opts.compliance ?? 0,
        numIterations: 8,
        friction: 0.5,
        linearDamping: 0.25,          // a corner-pinned sheet swings forever below this
        vertexRadius: 0.012,
        restitution: 0,
        // A pinned sheet is welded to the world, so the body origin must not
        // chase the vertices: with updatePosition on it drifts as the sheet sags
        // and even a pinned vertex reads back perturbed in the low bits.
        updatePosition: false,
    });
    return register('cloth', sb, { pinSet: set, pinned }, { color: '#c94f6d', roughness: 0.95, metallic: 0 });
}

/** Create (or recreate) the pressurized ball and drop it. */
export function buildBall(pressure = 2500, opts = {}) {
    destroySoft('ball');
    const geo = icosphere(BALL.radius, BALL.subdiv);
    const sb = Physics.createSoftBody({
        mesh: { vertices: geo.positions, indices: geo.indices, mass: BALL.mass, pressure },
        position: opts.position || BALL.position,
        layer: 'player',
        compliance: 1e-5,             // a hair of stretch: a rigid skin hides pressure
        numIterations: 8,
        friction: 0.6,
        restitution: 0.25,
        linearDamping: 0.02,
        vertexRadius: 0.01,
    });
    return register('ball', sb, { pressure, pinned: [] }, { color: '#ffd166', roughness: 0.45, metallic: 0 });
}

export const getBall = () => softBodies.get('ball');
export const getCloth = () => softBodies.get('cloth');

/** Toggle one vertex's pin at runtime: the cheap path, no rebuild. */
export function togglePin(entry, index) {
    if (!entry) return false;
    const pinned = entry.meta.pinned;
    const at = pinned.indexOf(index);
    const on = at < 0;
    if (on) pinned.push(index); else pinned.splice(at, 1);
    entry.sb.pin(index, on);
    return on;
}

function centroid(v, n) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i++) { x += v[i * 3]; y += v[i * 3 + 1]; z += v[i * 3 + 2]; }
    return { x: x / n, y: y / n, z: z / n };
}

/**
 * Kick the +X half of a soft body (relative to its own centroid) with
 * setVertexVelocity. Half, not all: the proof per-vertex control works is the
 * untouched half staying put. Returns the kicked indices.
 */
export function gust(entry, strength = 6, opts = {}) {
    if (!entry) return [];
    const v = entry.sb.vertices(), n = entry.sb.vertexCount;
    const c = centroid(v, n);
    const pinned = new Set(entry.meta.pinned);
    const hit = [];
    for (let i = 0; i < n; i++) {
        if (v[i * 3] <= c.x || pinned.has(i)) continue;     // pinned = invMass 0
        entry.sb.setVertexVelocity(i, opts.vx ?? 0, opts.vy ?? strength, opts.vz ?? strength * 0.4);
        hit.push(i);
    }
    return hit;
}

/**
 * Dent the +Y cap inward with setVertex: a hard teleport toward the centroid,
 * i.e. a finger poke. setVertex zeroes the velocity, so the recovery you see is
 * pressure and edge constraints alone. depth 0 selects the cap without moving
 * it (for measuring). Returns the cap's indices.
 */
export function poke(entry, depth = 0.35) {
    if (!entry) return [];
    const v = entry.sb.vertices(), n = entry.sb.vertexCount;
    const c = centroid(v, n);
    const pinned = new Set(entry.meta.pinned);
    const hit = [];
    for (let i = 0; i < n; i++) {
        const dy = v[i * 3 + 1] - c.y;
        if (dy < 0.35 * BALL.radius || pinned.has(i)) continue;
        hit.push(i);
        if (depth === 0) continue;
        const dx = v[i * 3] - c.x, dz = v[i * 3 + 2] - c.z;
        const L = Math.hypot(dx, dy, dz) || 1;
        entry.sb.setVertex(i, v[i * 3] - (dx / L) * depth, v[i * 3 + 1] - (dy / L) * depth, v[i * 3 + 2] - (dz / L) * depth);
    }
    return hit;
}

/**
 * Mean distance of a vertex set from the body's centroid: the rotation-
 * invariant "is this region dented" (a rolling ball moves a fixed set's height).
 */
export function regionRadius(entry, indices) {
    const v = entry.sb.vertices();
    const c = centroid(v, entry.sb.vertexCount);
    let s = 0;
    for (const i of indices) s += Math.hypot(v[i * 3] - c.x, v[i * 3 + 1] - c.y, v[i * 3 + 2] - c.z);
    return s / Math.max(1, indices.length);
}

/** Mean vertex height: a soft body's honest "how high is it". */
export function meanHeight(entry) {
    return centroid(entry.sb.vertices(), entry.sb.vertexCount).y;
}

/** Stream every soft body's particles into its mesh. The whole render path. */
export function updateSoftBodies() {
    for (const e of softBodies.values()) {
        e.node.updateMesh({ positions: e.sb.vertices(), indices: e.topo.indices }, { recomputeNormals: true });
    }
}

export function destroySoft(key) {
    const e = softBodies.get(key);
    if (!e) return false;
    e.node.destroy();
    e.sb.destroy();
    softBodies.delete(key);
    return true;
}

export function clearSoftBodies() {
    for (const k of [...softBodies.keys()]) destroySoft(k);
}
