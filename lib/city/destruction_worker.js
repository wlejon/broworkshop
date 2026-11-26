// lib/city/destruction_worker.js — building destruction physics off the page's thread.
// Owns the bro.dynamics world (with multithreaded Box3D), wakes structures on
// demand, steps at 60 Hz, enforces piece budgets, and streams compact deltas
// back to destruction.js for 360 Hz GPU interpolation.

import { MASS_FLOATS } from "./buildings.js";
import { buildingStructure, KIND } from "./structure.js";

const CELL = 64;
const TILE = 64;
const REACH_CELL = 8;
const MAX_SHOTS = 32;

const MATERIAL = [
    { rho: 2400, sigma: 6e6, give: 0.04, crush: 1.2e7 },     // concrete
    { rho: 1900, sigma: 1.5e6, give: 0.01, crush: 6e6 },     // masonry
    { rho: 450, sigma: 2e6, give: 0.005, crush: 2e6 },       // curtain wall
    { rho: 650, sigma: 2e7, give: 0.16, crush: 8e6 },        // steel frame + cladding
    { rho: 550, sigma: 5e6, give: 0.04, crush: 5e6 },        // timber
];
const SLAB_LOAD = 300;
const ROOF_LOAD = 120;

function hash(a, b = 0) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

const key = (i, j) => i * 100003 + j;

let D = null;
let blds = null;
let owner = null;
const grid = new Map();
let world = null;
let chunk = 3;
let maxPieces = 180;
let globalMaxPieces = 450;

const woken = new Map();
const tiles = new Set();
const shots = [];
let tick = 0;
let simTime = 0;
let restoredCount = 0;
let pendingWoken = [];
let pendingRemovedShots = [];
let lastReach = new Map();

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

function buildingsNear(x, y, z, r) {
    const out = new Set();
    for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
        for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
            for (const i of grid.get(key(ci, cj)) ?? []) {
                const g = owner[i];
                if (g >= 0 && !woken.has(g) && massDist(i, x, y ?? D[i * MASS_FLOATS + 1] + 1, z) <= r) out.add(g);
            }
        }
    }
    return [...out].sort((a, b) => a - b);
}

function requestTiles(x, z, r, outSet) {
    for (let ti = Math.floor((x - r) / TILE); ti <= Math.floor((x + r) / TILE); ti++) {
        for (let tj = Math.floor((z - r) / TILE); tj <= Math.floor((z + r) / TILE); tj++) {
            const k = key(ti, tj);
            if (!tiles.has(k)) outSet.set(k, [ti, tj]);
        }
    }
}

function initWorld(m) {
    D = m.massesData;
    const fc = m.bFirstCount;
    const nb = fc.length >> 1;
    blds = new Array(nb);
    const count = D.length / MASS_FLOATS;
    owner = new Int32Array(count).fill(-1);
    for (let bi = 0; bi < nb; bi++) {
        const first = fc[2 * bi], cnt = fc[2 * bi + 1];
        blds[bi] = { first, count: cnt };
        for (let k = 0; k < cnt; k++) owner[first + k] = bi;
    }
    grid.clear();
    for (let i = 0; i < count; i++) {
        const o = i * MASS_FLOATS, r = Math.hypot(D[o + 4], D[o + 6]);
        for (let ci = Math.floor((D[o] - r) / CELL); ci <= Math.floor((D[o] + r) / CELL); ci++) {
            for (let cj = Math.floor((D[o + 2] - r) / CELL); cj <= Math.floor((D[o + 2] + r) / CELL); cj++) {
                const k = key(ci, cj);
                let bucket = grid.get(k);
                if (!bucket) grid.set(k, bucket = []);
                bucket.push(i);
            }
        }
    }
    chunk = m.chunk ?? 3;
    maxPieces = m.maxPieces ?? 180;
    globalMaxPieces = m.globalMaxPieces ?? 450;
    world = bro.dynamics.createWorld({ workers: m.workers ?? 6 });
    self.postMessage({ ready: true });
}

function addTiles(list) {
    for (const t of list) {
        const k = key(t.ti, t.tj);
        if (tiles.has(k)) continue;
        tiles.add(k);
        world.addHeightField({
            heights: t.heights,
            countX: t.countX,
            countZ: t.countZ,
            scale: [t.step, 1, t.step],
            minHeight: t.minH,
            maxHeight: t.maxH,
            position: [t.x0, 0, t.z0],
            friction: 0.8,
        });
    }
}

function wakeBuildings(list) {
    for (const item of list) {
        const g = item.g;
        if (woken.has(g)) continue;
        const b = blds[g];
        const mg = item.massGround;
        const groundAt = (x, z) => {
            let best = 1e9, h = 0;
            for (let k = 0; k < b.count; k++) {
                const o = (b.first + k) * MASS_FLOATS;
                const d2 = (D[o] - x) * (D[o] - x) + (D[o + 2] - z) * (D[o + 2] - z);
                if (d2 < best) { best = d2; h = mg[k]; }
            }
            return h;
        };
        const S = buildingStructure(D, b, groundAt);
        const frameOf = new Map(), frames = [], turn = [];
        let bminX = Infinity, bminY = Infinity, bminZ = Infinity;
        let bmaxX = -Infinity, bmaxY = -Infinity, bmaxZ = -Infinity;
        const frame = (i) => {
            let f = frameOf.get(i);
            if (f === undefined) {
                const m = i * MASS_FLOATS, yaw = D[m + 3];
                const x = D[m], y = D[m + 1], z = D[m + 2];
                const c = Math.cos(yaw), s = Math.sin(yaw);
                const hw = D[m + 4], h = D[m + 5], hd = D[m + 6], plinth = D[m + 9], roofH = D[m + 13];
                const ex = Math.abs(c) * hw + Math.abs(s) * hd;
                const ez = Math.abs(s) * hw + Math.abs(c) * hd;
                bminX = Math.min(bminX, x - ex); bmaxX = Math.max(bmaxX, x + ex);
                bminY = Math.min(bminY, y - plinth); bmaxY = Math.max(bmaxY, y + h + roofH);
                bminZ = Math.min(bminZ, z - ez); bmaxZ = Math.max(bmaxZ, z + ez);
                frameOf.set(i, f = frames.length);
                frames.push({ position: [x, y, z], rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
                turn.push({ mass: i, x, y, z, c, s, qy: Math.sin(yaw / 2), qw: Math.cos(yaw / 2) });
            }
            return f;
        };
        const members = S.members.map((m) => {
            const M = MATERIAL[m.mat], area = 4 * m.h[0] * m.h[2], volume = 8 * m.h[0] * m.h[1] * m.h[2];
            return {
                frame: frame(m.frame), center: m.c, half: m.h, anchored: m.kind === KIND.foundation,
                sigma: M.sigma, crush: M.crush, give: M.give,
                mass: m.kind === KIND.roof ? ROOF_LOAD * area : M.rho * volume + (m.kind === KIND.slab ? SLAB_LOAD * area : 0),
            };
        });
        const structure = world.addStructure({ frames, members, ties: S.joints.map((j) => [j.a, j.b]), chunk, maxPieces });
        const cells = structure.cells, n = cells.length / 12;
        const pieceInit = new Float32Array(n * 12);
        const bodyPos = new Float32Array(n * 3);
        const sphereInit = new Float32Array(n * 4);
        const frameOfCell = new Uint16Array(n);
        let live = 0;
        for (let i = 0; i < n; i++) {
            const c = 12 * i, m = S.members[cells[c]], f = frameOf.get(m.frame), F = turn[f];
            const dx = cells[c + 1] - F.x, dz = cells[c + 3] - F.z;
            frameOfCell[i] = f;
            pieceInit.set([F.c * dx - F.s * dz, cells[c + 2] - F.y, F.s * dx + F.c * dz, m.frame,
                           cells[c + 8], cells[c + 9], cells[c + 10], 0,
                           m.kind, m.mat, 0, hash(g * 8191 + cells[c], 77)], c);
            bodyPos[3 * i] = cells[c + 1]; bodyPos[3 * i + 1] = cells[c + 2]; bodyPos[3 * i + 2] = cells[c + 3];
            sphereInit.set([cells[c + 1], cells[c + 2], cells[c + 3], Math.hypot(cells[c + 8], cells[c + 9], cells[c + 10])], 4 * i);
            if (m.kind !== KIND.foundation) live++;
        }
        const W = {
            structure, count: n, live, anchored: n - live, since: simTime, touched: false,
            bounds: [bminX, bminY, bminZ, bmaxX, bmaxY, bmaxZ],
        };
        woken.set(g, W);
        pendingWoken.push({ g, count: n, live, turn, bounds: W.bounds, pieceInit, bodyPos, sphereInit, frameOfCell });
    }
}

function fireShot(f) {
    if (shots.length >= MAX_SHOTS) {
        const old = shots.shift();
        world.removeBody(old.body);
        pendingRemovedShots.push(old.id);
    }
    const spec = f.shape === 'box' ? { shape: 'box', half: f.half } : { shape: 'sphere', radius: f.radius };
    const body = world[spec.shape === 'box' ? 'addBox' : 'addSphere']({
        ...spec, mass: f.mass ?? 1000, position: f.position, velocity: f.velocity, friction: 0.6, bullet: true,
    });
    const r = spec.half ? Math.hypot(...spec.half) : spec.radius;
    shots.push({ id: f.id, body, r });
}

function enforceGlobalBudget(droppedByBuilding) {
    if (globalMaxPieces <= 0) return;
    let total = 0;
    for (const [, W] of woken) total += W.structure.counts.pieces;
    if (total <= globalMaxPieces) return;
    let need = total - globalMaxPieces;
    for (const maxCells of [1, 2, 4, 8]) {
        if (need <= 0) break;
        for (const [g, W] of woken) {
            if (need <= 0) break;
            const ps = W.structure.pieces();
            let extra = droppedByBuilding.get(g);
            for (let i = 0; i < ps.length && need > 0; i += 3) {
                if (ps[i + 1] > maxCells) continue;
                const body = ps[i] | 0;
                const cs = W.structure.pieceCells(body);
                if (!extra) droppedByBuilding.set(g, extra = []);
                for (let k = 0; k < cs.length; k++) extra.push(cs[k]);
                W.structure.drop(body);
                need--;
            }
        }
    }
}

function checkRestore(restored) {
    for (const [g, W] of woken) {
        if (W.touched || simTime - W.since < 5) continue;
        const b = blds[g];
        let nearby = false;
        for (const c of lastReach.values()) {
            for (let k = 0; k < b.count && !nearby; k++) {
                nearby = massDist(b.first + k, c.x / c.count, D[(b.first + k) * MASS_FLOATS + 1] + 1, c.z / c.count) <= REACH_CELL * 1.5;
            }
            if (nearby) break;
        }
        for (const s of shots) {
            if (nearby) break;
            const p = world.pose(s.body), v = world.velocity(s.body);
            if (Math.hypot(v[0], v[1], v[2]) < 0.5) continue;
            for (let k = 0; k < b.count && !nearby; k++) nearby = massDist(b.first + k, p[0], p[1], p[2]) <= 30;
        }
        if (nearby) { W.since = simTime - 4; continue; }
        W.structure.destroy();
        woken.delete(g);
        restored.push(g);
        restoredCount++;
        break;
    }
}

function stepSimulation(count) {
    const reqWake = new Set();
    const reqTiles = new Map();
    const restored = [];
    const droppedByBuilding = new Map();
    const reach = new Map();

    for (let it = 0; it < count; it++) {
        for (const s of shots) {
            const v = world.velocity(s.body);
            const sp = Math.hypot(v[0], v[1], v[2]);
            if (sp > 2) {
                const p = world.pose(s.body), T = 0.25 + 3 / 60;
                const steps = Math.max(1, Math.ceil(sp * T / 4));
                for (let k = 0; k <= steps; k++) {
                    const t = k / steps * T;
                    for (const g of buildingsNear(p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t, s.r + 2)) reqWake.add(g);
                }
                requestTiles(p[0] + v[0] * T * 0.5, p[2] + v[2] * T * 0.5, sp * T * 0.5 + s.r + 4, reqTiles);
            }
        }
        world.step(1 / 60, 2);
        tick++;
        simTime += 1 / 60;
        enforceGlobalBudget(droppedByBuilding);
    }

    const deltas = [];
    const transfers = [];
    let cellsTotal = 0, standingTotal = 0, looseTotal = 0;

    for (const [g, W] of woken) {
        const st = W.structure;
        const sc = st.counts;
        cellsTotal += sc.cells; standingTotal += sc.standing; looseTotal += sc.pieces;
        const mvRaw = st.moved(), bareRaw = st.bared(), goneRaw = st.crushed();
        const extraGone = droppedByBuilding.get(g);
        if (mvRaw.length || bareRaw.length || goneRaw.length || extraGone) W.touched = true;

        for (let m = 0; m < mvRaw.length; m += 8) {
            const x = mvRaw[m + 1], y = mvRaw[m + 2], z = mvRaw[m + 3];
            const rk = key(Math.floor(x / REACH_CELL), Math.floor(z / REACH_CELL));
            let c = reach.get(rk);
            if (!c) reach.set(rk, c = { x: 0, y: 0, z: 0, count: 0 });
            c.x += x; c.y += y; c.z += z; c.count++;
        }

        if (mvRaw.length || bareRaw.length || goneRaw.length || extraGone) {
            const mv = mvRaw.length ? new Float32Array(mvRaw) : new Float32Array(0);
            const bare = bareRaw.length ? new Int32Array(bareRaw) : new Int32Array(0);
            const gl = goneRaw.length + (extraGone ? extraGone.length : 0);
            const gone = new Int32Array(gl);
            if (goneRaw.length) gone.set(goneRaw, 0);
            if (extraGone) gone.set(extraGone, goneRaw.length);
            if (mv.byteLength) transfers.push(mv.buffer);
            if (bare.byteLength) transfers.push(bare.buffer);
            if (gone.byteLength) transfers.push(gone.buffer);
            deltas.push({ g, standing: sc.standing, pieces: sc.pieces, mv, bare, gone });
        }
    }

    lastReach = reach;
    const reachCells = [];
    for (const c of reach.values()) {
        const x = c.x / c.count, y = c.y / c.count, z = c.z / c.count;
        requestTiles(x, z, REACH_CELL, reqTiles);
        if (c.count >= 12) {
            for (const g of buildingsNear(x, null, z, REACH_CELL * 0.75)) reqWake.add(g);
        }
        if (c.count >= 4) reachCells.push(x, y, z, c.count);
    }

    if (tick % 60 === 0) checkRestore(restored);

    const shotPoses = new Float32Array(shots.length * 8);
    for (let i = 0; i < shots.length; i++) {
        const p = world.pose(shots[i].body);
        shotPoses[i * 8] = shots[i].id;
        shotPoses.set(p, i * 8 + 1);
    }
    if (shotPoses.byteLength) transfers.push(shotPoses.buffer);

    const wokenOut = pendingWoken;
    pendingWoken = [];
    for (const w of wokenOut) {
        transfers.push(w.pieceInit.buffer, w.bodyPos.buffer, w.sphereInit.buffer, w.frameOfCell.buffer);
    }

    const removedShots = pendingRemovedShots;
    pendingRemovedShots = [];
    const wc = world.counts;
    const reachArr = new Float32Array(reachCells);
    if (reachArr.byteLength) transfers.push(reachArr.buffer);

    self.postMessage({
        snapshot: {
            tick,
            woken: wokenOut,
            restored,
            removedShots,
            shotPoses,
            deltas,
            reach: reachArr,
            needWake: [...reqWake],
            needTiles: [...reqTiles.values()],
            stats: {
                tick, bodies: wc.bodies, awake: wc.awake, stepMs: wc.stepMs,
                cells: cellsTotal, standing: standingTotal, loose: looseTotal,
                groups: woken.size, restored: restoredCount, shots: shots.length,
            },
        },
    }, transfers);
}

self.onmessage = (ev) => {
    const m = ev.data;
    try {
        if (m.init) initWorld(m.init);
        if (m.tiles && m.tiles.length) addTiles(m.tiles);
        if (m.wake && m.wake.length) wakeBuildings(m.wake);
        if (m.rejectWake) {
            for (const g of m.rejectWake) {
                const W = woken.get(g);
                if (W) { W.structure.destroy(); woken.delete(g); }
            }
        }
        if (m.fire) fireShot(m.fire);
        if (m.step) stepSimulation(m.step.count ?? 1);
    } catch (err) {
        console.error('destruction worker: ' + err + '\n' + err.stack);
    }
};
