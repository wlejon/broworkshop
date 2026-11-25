// lib/city/destruction_sim.js — the city's destruction simulation (lib/destruct
// over the city's masses, structure.js turning a building into its members the
// first time something touches it), hosted where it steps: in a Worker
// (destruction_worker.js) or on the page. Its output is snapshots, packed as
// destruction.js draws them, the same either way.
//
// createCitySim(city, { maxBodies }) -> {
//   sim, buildingOf(i),
//   advance(toTick, fires, watch, { maxSteps = 8, hash }) -> snapshot   (fires: fire()
//     options, launched first, `tick`-stamped or now; watch: groups whose share out
//     of place to report; hash: the sim's state hash after, as `hash`)
// }
// snapshot: {
//   tick, members (count), activated: [group],
//   pieceIdx: Int32Array, pieces: Float32Array (12 a member, destruction.bk's row),
//   bodyIdx: Int32Array, bodies: Float32Array (BODY_FLOATS a cluster: pivot,
//     the pose a step before, the pose now; moving: whether it moved),
//   projectiles: Float32Array (PROJ_FLOATS each), events, down: [share], stats }
// A cluster lying still is sent once in its rest pose, then not again until it moves.

import { MASS_FLOATS } from "./buildings.js";
import { buildingStructure } from "./structure.js";
import { createDestruction } from "../destruct/destruct.js";

const CELL = 64;
export const CAP_PIECES = 1 << 17;
export const CAP_BODIES = 1 << 16;
// pivot 3, prev pos 3, pos 3, prev quat 4, quat 4, moving 1
export const BODY_FLOATS = 18;
// box 1, flying 1, size 3 (half extents, or the radius thrice), prev pos 3, pos 3, prev quat 4, quat 4
export const PROJ_FLOATS = 19;
// What counts as out of place: a member gone, or in a piece moved this far from where it stood.
const DISPLACED = 0.5;

export function createCitySim(city, { maxBodies = 60000 } = {}) {
    const { data: D, count, buildings: blds } = city.masses;
    const groundAt = city.graded;

    // Each mass's building, and the masses by 64 m cells of their footprints.
    const owner = new Int32Array(count).fill(-1);
    blds.forEach((b, bi) => { for (let k = 0; k < b.count; k++) owner[b.first + k] = bi; });
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    for (let i = 0; i < count; i++) {
        const o = i * MASS_FLOATS, r = Math.hypot(D[o + 4], D[o + 6]);
        for (let ci = Math.floor((D[o] - r) / CELL); ci <= Math.floor((D[o] + r) / CELL); ci++) {
            for (let cj = Math.floor((D[o + 2] - r) / CELL); cj <= Math.floor((D[o + 2] + r) / CELL); cj++) {
                const k = key(ci, cj);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(i);
            }
        }
    }
    // (Flag 4: taken down, its pieces now. This host's own copy of the masses
    // carries it, set as each building wakes: the page's is set when the
    // snapshot reporting it is drawn.)
    const gone = (i) => (Math.round(D[i * MASS_FLOATS + 14]) & 4) !== 0;
    function massesNear(x, z, r) {
        const out = new Set();
        for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
            for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
                for (const i of grid.get(key(ci, cj)) ?? []) out.add(i);
            }
        }
        return [...out].sort((a, b) => a - b);
    }
    // Distance from a point to mass i's solid (walls, foundation and roof).
    function massDist(i, x, y, z) {
        const o = i * MASS_FLOATS;
        const yaw = D[o + 3], c = Math.cos(yaw), s = Math.sin(yaw);
        const dx = x - D[o], dz = z - D[o + 2];
        const lx = c * dx - s * dz, lz = s * dx + c * dz, ly = y - D[o + 1];
        const top = D[o + 5] + (D[o + 12] > 0.5 ? D[o + 13] : 0);
        const ex = Math.max(0, Math.abs(lx) - D[o + 4]), ez = Math.max(0, Math.abs(lz) - D[o + 6]);
        const ey = Math.max(0, -D[o + 9] - ly, ly - top);
        return Math.hypot(ex, ey, ez);
    }

    const activated = [];
    const source = {
        frame: (i) => { const o = i * MASS_FLOATS; return { x: D[o], y: D[o + 1], z: D[o + 2], yaw: D[o + 3] }; },
        structure: (g) => buildingStructure(D, blds[g], groundAt),
        groupsNear(x, y, z, r) {
            const out = new Set();
            for (const i of massesNear(x, z, r)) if (owner[i] >= 0 && !gone(i) && massDist(i, x, y, z) <= r) out.add(owner[i]);
            return [...out].sort((a, b) => a - b);
        },
        solidsNear(x, z, r) {
            const out = [];
            for (const i of massesNear(x, z, r)) {
                if (owner[i] < 0 || gone(i)) continue;
                const o = i * MASS_FLOATS;
                if (Math.hypot(D[o] - x, D[o + 2] - z) > r + Math.hypot(D[o + 4], D[o + 6])) continue;
                const h = D[o + 5], pl = D[o + 9];
                out.push({ key: i, group: owner[i], c: [D[o], D[o + 1] + (h - pl) / 2, D[o + 2]], h: [D[o + 4], (h + pl) / 2, D[o + 6]], yaw: D[o + 3] });
            }
            return out;
        },
        groundAt,
        onActivate(g) {
            const b = blds[g];
            for (let k = 0; k < b.count; k++) {
                const o = (b.first + k) * MASS_FLOATS;
                D[o + 14] = Math.round(D[o + 14]) | 4;
            }
            activated.push(g);
        },
    };
    const sim = createDestruction(source, { maxBodies });

    // The share of group g's members out of place.
    function outOfPlace(g) {
        const G = sim.groups.get(g);
        if (!G || !G.members.length) return 0;
        let n = 0;
        for (const i of G.members) {
            const m = sim.members[i];
            if (!m.alive) { n++; continue; }
            if (m.cluster < 0) continue;
            const C = sim.clusters[m.cluster];
            if (Math.hypot(C.pos[0] - C.pivot[0], C.pos[1] - C.pivot[1], C.pos[2] - C.pivot[2]) > DISPLACED) n++;
        }
        return n / G.members.length;
    }

    // The clusters sent lying still (not sent again until they move).
    const sentStill = new Uint8Array(CAP_BODIES);

    function snapshot(watch) {
        // The members changed: destruction.bk's rows.
        const ch = sim.changed;
        let np = 0;
        for (const i of ch) if (i < CAP_PIECES) np++;
        const pieceIdx = new Int32Array(np), pieces = new Float32Array(np * 12);
        let k = 0;
        for (const i of ch) {
            if (i >= CAP_PIECES) continue;
            const m = sim.members[i], o = k * 12;
            pieceIdx[k++] = i;
            pieces[o] = m.c[0]; pieces[o + 1] = m.c[1]; pieces[o + 2] = m.c[2]; pieces[o + 3] = m.frame;
            const alive = m.alive ? 1 : 0;
            pieces[o + 4] = m.h[0] * alive; pieces[o + 5] = m.h[1] * alive; pieces[o + 6] = m.h[2] * alive;
            pieces[o + 7] = m.cluster + 1;
            pieces[o + 8] = m.kind; pieces[o + 9] = m.mat; pieces[o + 10] = m.rough; pieces[o + 11] = m.seed;
        }
        ch.clear();

        // The clusters moving, and those come to rest since last sent.
        const n = Math.min(sim.clusters.length, CAP_BODIES);
        const ids = [];
        for (let i = 0; i < n; i++) {
            const C = sim.clusters[i];
            if (!C.alive) continue;
            const still = C.prevPos === C.pos && C.prevQuat === C.quat;
            if (still && sentStill[i]) continue;
            sentStill[i] = still ? 1 : 0;
            ids.push(i);
        }
        const bodyIdx = new Int32Array(ids), bodies = new Float32Array(ids.length * BODY_FLOATS);
        for (let j = 0; j < ids.length; j++) {
            const C = sim.clusters[ids[j]], o = j * BODY_FLOATS;
            bodies.set(C.pivot, o); bodies.set(C.prevPos, o + 3); bodies.set(C.pos, o + 6);
            bodies.set(C.prevQuat, o + 9); bodies.set(C.quat, o + 13);
            bodies[o + 17] = sentStill[ids[j]] ? 0 : 1;
        }

        const P = sim.projectiles, projectiles = new Float32Array(P.length * PROJ_FLOATS);
        for (let j = 0; j < P.length; j++) {
            const p = P[j], o = j * PROJ_FLOATS;
            projectiles[o] = p.shape === 'box' ? 1 : 0;
            projectiles[o + 1] = p.flying ? 1 : 0;
            if (p.shape === 'box') projectiles.set(p.he, o + 2);
            else projectiles.set([p.r, p.r, p.r], o + 2);
            projectiles.set(p.prevP, o + 5); projectiles.set(p.p, o + 8);
            projectiles.set(p.prevQ, o + 11); projectiles.set(p.q, o + 15);
        }

        return {
            tick: sim.tick, members: sim.members.length, activated: activated.splice(0),
            pieceIdx, pieces, bodyIdx, bodies, projectiles,
            events: sim.drain(), down: (watch ?? []).map(outOfPlace),
            stats: { ...sim.stats, members: sim.members.length, groups: sim.groups.size },
        };
    }

    return {
        sim,
        buildingOf: (i) => owner[i],
        /** Launch `fires`, step to `toTick` (at most `maxSteps` steps: the rest dropped,
         *  a host fallen behind catching up no further), and the snapshot after. */
        advance(toTick, fires = [], watch = [], { maxSteps = 8, hash = false } = {}) {
            for (const f of fires) sim.fire(f);
            sim.stepTo(Math.min(toTick, sim.tick + maxSteps));
            const s = snapshot(watch);
            if (hash) s.hash = sim.hash();
            return s;
        },
    };
}

/**
 * A collapse thrown away, to compile what one runs: a worker's code starts cold
 * (the page's ground heights are hot from drawing the terrain; a worker's run
 * interpreted), and the first shot would wait a second or two on it. A shot
 * into the tallest building, `steps` steps, on a copy of the masses (the
 * city's own are not touched) in a world of its own, then destroyed.
 */
export function warmUp(city, steps = 240) {
    const D = city.masses.data.slice();
    let best = 0, bh = -1;
    for (let i = 0; i < city.masses.count; i++) {
        const o = i * MASS_FLOATS;
        if (D[o + 5] > bh && D[o + 9] < 3) { bh = D[o + 5]; best = i; }
    }
    const host = createCitySim({ ...city, masses: { ...city.masses, data: D } }, { maxBodies: 8000 });
    const o = best * MASS_FLOATS, fx = Math.sin(D[o + 3]), fz = Math.cos(D[o + 3]);
    const p = [D[o] + fx * (D[o + 6] + 6), 0, D[o + 2] + fz * (D[o + 6] + 6)];
    p[1] = Math.max(D[o + 1] + D[o + 5] * 0.2, city.graded(p[0], p[2]) + 3.2);
    host.advance(1, [{ shape: 'sphere', radius: 2.5, mass: 400000, position: p, velocity: [-fx * 90, -2, -fz * 90] }]);
    for (let t = 2; t <= steps; t++) host.advance(t);
    host.sim.destroy();
}

/** A snapshot's typed arrays, for postMessage's transfer list. */
export function snapshotTransfer(s) {
    return [s.pieceIdx.buffer, s.pieces.buffer, s.bodyIdx.buffer, s.bodies.buffer, s.projectiles.buffer];
}
