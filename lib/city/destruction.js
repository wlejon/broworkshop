// lib/city/destruction.js — a city's buildings made breakable: each one a
// shot comes near is turned into its members (structure.js) and stood in a
// bro.dynamics world inside destruction_worker.js: physics runs off the render
// thread at 60 Hz while destruction.bk draws the cells at 360 Hz via blend
// interpolation, with tight shadow cull bounds over woken buildings only.

import { MASS_FLOATS } from "./buildings.js";
import { facadeSource } from "./building_render.js";
import { createDust } from "../destruct/dust.js";
import { createGrit } from "../destruct/grit.js";

const CELL = 64;
const CHUNK = 3;
const CRUSH_DUST = 2;
const DOWN = 0.3;
const MAX_SHOTS = 32;
const SURGE_COUNT = 12, SURGE_HEIGHT = 12, SURGE_SPEED = 16;
const NEAR = 90;
const TILE = 64, TILE_STEP = 4;
const GROUND_DIM = 512, GROUND_CELL = 4;
const IDLE_CULL = [[0, -10000, 0], [1, -9999, 1]];

function boxMesh(N, welded = false) {
    let P = [], Nn = [], I = [];
    const faces = [
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, a, b] of faces) {
        const base = P.length / 3;
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
            const sa = i / N * 2 - 1, sb = j / N * 2 - 1;
            P.push(0.5 * (n[0] + sa * a[0] + sb * b[0]), 0.5 * (n[1] + sa * a[1] + sb * b[1]), 0.5 * (n[2] + sa * a[2] + sb * b[2]));
            Nn.push(...n);
        }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const k = base + j * (N + 1) + i;
            I.push(k, k + 1, k + N + 2, k, k + N + 2, k + N + 1);
        }
    }
    if (welded) {
        const at = new Map(), P2 = [], N2 = [];
        I = I.map((k) => {
            const key = `${P[3 * k]},${P[3 * k + 1]},${P[3 * k + 2]}`;
            if (!at.has(key)) {
                at.set(key, P2.length / 3);
                P2.push(P[3 * k], P[3 * k + 1], P[3 * k + 2]);
                N2.push(Nn[3 * k], Nn[3 * k + 1], Nn[3 * k + 2]);
            }
            return at.get(key);
        });
        P = P2; Nn = N2;
    }
    return new bro.mesh.Mesh({ positions: new Float32Array(P), normals: new Float32Array(Nn), indices: new Uint32Array(I) });
}

export async function createCityDestruction(scene, city, buildings, opts = {}) {
    const { data: D, count, buildings: blds } = city.masses;
    const groundAt = city.graded;
    const N = opts.capacity ?? 1 << 18, chunk = opts.chunk ?? CHUNK;

    // Spatial index over building masses for O(1) shot-trajectory wake checks.
    const owner = new Int32Array(count).fill(-1);
    const bFirstCount = new Int32Array(blds.length * 2);
    blds.forEach((b, bi) => {
        bFirstCount[2 * bi] = b.first;
        bFirstCount[2 * bi + 1] = b.count;
        for (let k = 0; k < b.count; k++) owner[b.first + k] = bi;
    });
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

    const woken = new Map();
    const wakeSent = new Set();
    const refused = new Map();
    let now = 0;
    function buildingsNear(x, y, z, r) {
        const out = new Set();
        for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
            for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
                for (const i of grid.get(key(ci, cj)) ?? []) {
                    const g = owner[i];
                    if (g >= 0 && !woken.has(g) && !wakeSent.has(g) && !(refused.get(g) > now - 10) && massDist(i, x, y ?? D[i * MASS_FLOATS + 1] + 1, z) <= r) out.add(g);
                }
            }
        }
        return [...out].sort((a, b) => a - b);
    }

    // Ground tiles sampled on main thread (uses city.graded) and sent once per tile to worker.
    const tilesSent = new Set();
    function collectTile(ti, tj, out) {
        const k = key(ti, tj);
        if (tilesSent.has(k)) return;
        tilesSent.add(k);
        const n = TILE / TILE_STEP, x0 = ti * TILE, z0 = tj * TILE;
        const heights = new Float32Array((n + 1) * (n + 1));
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            heights[j * (n + 1) + i] = groundAt(x0 + i * TILE_STEP, z0 + j * TILE_STEP);
        }
        out.push({ ti, tj, x0, z0, step: TILE_STEP, countX: n + 1, countZ: n + 1, minH: -100, maxH: 500, heights });
    }
    function collectTilesAbout(x, z, r, out) {
        for (let ti = Math.floor((x - r) / TILE); ti <= Math.floor((x + r) / TILE); ti++) {
            for (let tj = Math.floor((z - r) / TILE); tj <= Math.floor((z + r) / TILE); tj++) collectTile(ti, tj, out);
        }
    }

    // Drawing buffers for destruction.bk.
    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/city/destruction.bk'), 'utf8');
    const SLACK = 1 << 12;
    const cellNode = (name, cut, casts = false) => scene.createInstancedMesh({
        name, mesh: boxMesh(cut, casts), capacity: N, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: casts, shadowOnly: casts, receivesShadow: true,
    });
    const node = cellNode('city_pieces', 2), farNode = cellNode('city_pieces_far', 1), castNode = cellNode('city_pieces_cast', 1, true);
    const nodes = [node, farNode, castNode];
    let near = opts.near ?? NEAR;
    const pieceRows = new Float32Array(N * 12), bodyRows = new Float32Array(N * 20), sphereRows = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { sphereRows[4 * i + 1] = -1e5; bodyRows[20 * i + 15] = 1; bodyRows[20 * i + 19] = 1; }
    const pieceBuf = bro.kernel.createBuffer(pieceRows.byteLength), bodyBuf = bro.kernel.createBuffer(bodyRows.byteLength);
    const sphereBuf = bro.kernel.createBuffer(sphereRows);
    pieceBuf.write(pieceRows); bodyBuf.write(bodyRows);
    const spheres = () => {
        node.setInstanceCullSpheres(sphereBuf, { maxDistance: near }); farNode.setInstanceCullSpheres(sphereBuf, { minDistance: near });
        castNode.setInstanceCullSpheres(sphereBuf);
    };
    const closed = opts.interiors?.addWalls ? null : bro.kernel.createBuffer(16);
    for (const nd of nodes) {
        nd.setCullBounds(IDLE_CULL[0], IDLE_CULL[1]);
        await nd.setShaderAsync({ module: src, file: 'lib/city/destruction.bk', modules: { facade: facadeSource() },
                                  uniforms: { night: 0, room_day: 60, room_night: 5, debug: 0, blend: 1, base: 0 } });
        nd.setShaderBuffer('masses', buildings.masses);
        if (closed) nd.setShaderBuffer('open_state', closed);
        else opts.interiors.addWalls(nd);
        nd.setShaderBuffer('pieces', pieceBuf);
        nd.setShaderBuffer('bodies', bodyBuf);
        nd.hookStill = true;
        nd.setInstanceCount(0);
    }
    spheres();

    let cullMin = [Infinity, Infinity, Infinity], cullMax = [-Infinity, -Infinity, -Infinity], cullDirty = false;
    function expandCull(x0, y0, z0, x1, y1, z1) {
        if (x0 < cullMin[0]) { cullMin[0] = x0; cullDirty = true; }
        if (y0 < cullMin[1]) { cullMin[1] = y0; cullDirty = true; }
        if (z0 < cullMin[2]) { cullMin[2] = z0; cullDirty = true; }
        if (x1 > cullMax[0]) { cullMax[0] = x1; cullDirty = true; }
        if (y1 > cullMax[1]) { cullMax[1] = y1; cullDirty = true; }
        if (z1 > cullMax[2]) { cullMax[2] = z1; cullDirty = true; }
    }
    function recomputeCull() {
        cullMin = [Infinity, Infinity, Infinity]; cullMax = [-Infinity, -Infinity, -Infinity];
        for (const [, W] of woken) {
            const b = W.bounds;
            expandCull(b[0] - 12, b[1] - 12, b[2] - 12, b[3] + 12, b[4] + 12, b[5] + 12);
        }
        cullDirty = true;
    }
    function applyCull() {
        if (!cullDirty) return;
        cullDirty = false;
        if (!woken.size) {
            for (const nd of nodes) nd.setCullBounds(IDLE_CULL[0], IDLE_CULL[1]);
        } else {
            for (const nd of nodes) nd.setCullBounds(cullMin, cullMax);
        }
    }

    let top = 0, drawn = 0;
    const free = [];
    function takeRows(len) {
        const f = free.findIndex((s) => s[1] >= len);
        if (f >= 0) {
            const s = free[f], at = s[0];
            if (s[1] === len) free.splice(f, 1); else { s[0] += len; s[1] -= len; }
            return at;
        }
        if (top + len > N) return -1;
        top += len;
        return top - len;
    }

    const dirtyPiece = [], dirtyBody = [];
    function touch(list, a, b) {
        if (b <= a) return;
        for (let i = 0; i < list.length; i++) {
            const iv = list[i];
            if (a <= iv[1] + 256 && b + 256 >= iv[0]) {
                iv[0] = Math.min(iv[0], a); iv[1] = Math.max(iv[1], b);
                return;
            }
        }
        list.push([a, b]);
    }
    function send() {
        if (!dirtyPiece.length && !dirtyBody.length) { applyCull(); return; }
        for (const [a, b] of dirtyPiece) pieceBuf.write(pieceRows.subarray(12 * a, 12 * b), 48 * a);
        for (const [a, b] of dirtyBody) {
            bodyBuf.write(bodyRows.subarray(20 * a, 20 * b), 80 * a);
            sphereBuf.write(sphereRows.subarray(4 * a, 4 * b), 16 * a);
        }
        dirtyPiece.length = 0; dirtyBody.length = 0;
        applyCull();
        for (const nd of nodes) { nd.setShaderBuffer('pieces', pieceBuf); nd.setShaderBuffer('bodies', bodyBuf); }
        spheres();
        const c = Math.min(N, Math.ceil(top / SLACK) * SLACK);
        if (c !== drawn) { drawn = c; for (const nd of nodes) nd.setInstanceCount(c); }
    }

    const dust = createDust(scene, { groundAt });
    const grit = await createGrit(scene);
    let ground = null;
    function gritGround(x, z) {
        if (ground || typeof opts.heights !== 'function') return;
        const origin = [x, groundAt(x, z), z], buffer = bro.kernel.createBuffer(4 * GROUND_DIM * GROUND_DIM);
        opts.heights(buffer, { origin, dim: GROUND_DIM, cell: GROUND_CELL });
        ground = { buffer, origin, dim: GROUND_DIM, cell: GROUND_CELL };
    }

    // Worker setup.
    const worker = new Worker(new URL('./destruction_worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => console.error('destruction worker: ' + (e.message ?? e));
    const readyPromise = new Promise((resolve) => {
        worker.onmessage = (ev) => {
            if (ev.data.ready) { resolve(); return; }
            if (ev.data.snapshot) onSnapshot(ev.data.snapshot);
        };
    });
    const initMasses = new Float32Array(D);
    worker.postMessage({
        init: {
            massesData: initMasses,
            bFirstCount,
            chunk,
            maxPieces: opts.maxPieces ?? 180,
            globalMaxPieces: opts.globalMaxPieces ?? 450,
            workers: opts.workers ?? 6,
        },
    }, [initMasses.buffer, bFirstCount.buffer]);
    await readyPromise;

    const enclosed = new Set();
    const shots = new Map();
    let nextShotId = 1;
    const shotList = [];
    let tick = 0, clock = 0, workerBusy = false;
    let lastSnapAt = now, snapInterval = 1 / 60, gritAcc = 0;
    let cachedStats = { bodies: 0, awake: 0, stepMs: 0, cells: 0, standing: 0, loose: 0, groups: 0, restored: 0, shots: 0 };
    let waitTarget = 0, waitResolve = null;

    function buildWakePayload(ids, wakeList, tileList) {
        for (const g of ids) {
            if (woken.has(g) || wakeSent.has(g) || refused.get(g) > now - 10) continue;
            wakeSent.add(g);
            const b = blds[g], mg = new Float32Array(b.count);
            for (let k = 0; k < b.count; k++) {
                const m = (b.first + k) * MASS_FLOATS;
                mg[k] = groundAt(D[m], D[m + 2]);
                collectTilesAbout(D[m], D[m + 2], Math.hypot(D[m + 4], D[m + 6]) + TILE / 2, tileList);
            }
            wakeList.push({ g, massGround: mg });
        }
    }

    function postExtras(wakeList, tileList) {
        if (!wakeList.length && !tileList.length) return;
        const transfers = [];
        for (const w of wakeList) transfers.push(w.massGround.buffer);
        for (const t of tileList) transfers.push(t.heights.buffer);
        worker.postMessage({ tiles: tileList, wake: wakeList }, transfers);
    }

    function applyWoken(item, rejectList) {
        const g = item.g;
        wakeSent.delete(g);
        if (woken.has(g)) return;
        const n = item.count, first = takeRows(n);
        if (first < 0) {
            refused.set(g, now);
            rejectList.push(g);
            console.warn(`destruction: no room for building ${g}: it stays whole`);
            return;
        }
        const pInit = item.pieceInit, bPos = item.bodyPos, sInit = item.sphereInit;
        pieceRows.set(pInit, 12 * first);
        sphereRows.set(sInit, 4 * first);
        for (let i = 0; i < n; i++) {
            const k = first + i;
            pieceRows[12 * k + 7] = k + 1;
            const px = bPos[3 * i], py = bPos[3 * i + 1], pz = bPos[3 * i + 2];
            bodyRows.set([px, py, pz, 0, px, py, pz, 0, px, py, pz, 0, 0, 0, 0, 1, 0, 0, 0, 1], 20 * k);
        }
        touch(dirtyPiece, first, first + n);
        touch(dirtyBody, first, first + n);
        const W = {
            first, count: n, live: item.live, standing: item.live + (n - item.live), loose: 0,
            turn: item.turn, frameOfCell: item.frameOfCell, touched: false, bounds: item.bounds,
            prevMoved: new Uint32Array(0),
        };
        woken.set(g, W);
        const b = item.bounds;
        expandCull(b[0] - 12, b[1] - 12, b[2] - 12, b[3] + 12, b[4] + 12, b[5] + 12);
        gritGround(item.turn[0].x, item.turn[0].z);
        const bld = blds[g], ids = [];
        for (let k = 0; k < bld.count; k++) ids.push(bld.first + k);
        buildings.hide(ids);
        if (opts.interiors?.enclose(g)) { enclosed.add(g); opts.interiors.hold?.(g); }
        else opts.interiors?.forget(g);
    }

    function applyRestored(g) {
        const W = woken.get(g);
        if (!W) return;
        pieceRows.fill(0, 12 * W.first, 12 * (W.first + W.count));
        for (let i = W.first; i < W.first + W.count; i++) sphereRows[4 * i + 1] = -1e5;
        touch(dirtyPiece, W.first, W.first + W.count);
        touch(dirtyBody, W.first, W.first + W.count);
        free.push([W.first, W.count]);
        const bld = blds[g], ids = [];
        for (let k = 0; k < bld.count; k++) ids.push(bld.first + k);
        buildings.show(ids);
        if (enclosed.delete(g)) { opts.interiors.unenclose(g); opts.interiors.release?.(g); }
        woken.delete(g);
        recomputeCull();
    }

    function onSnapshot(snap) {
        workerBusy = false;
        const dtSnap = now - lastSnapAt;
        if (dtSnap > 1 / 180 && dtSnap < 0.1) snapInterval = snapInterval * 0.7 + dtSnap * 0.3;
        lastSnapAt = now;
        tick = snap.tick;
        cachedStats = snap.stats;

        const rejectList = [];
        for (const w of snap.woken) applyWoken(w, rejectList);
        if (rejectList.length) worker.postMessage({ rejectWake: rejectList });
        for (const g of snap.restored) applyRestored(g);

        for (const id of snap.removedShots) {
            const s = shots.get(id);
            if (s) { s.node.destroy(); shots.delete(id); }
            const idx = shotList.indexOf(id);
            if (idx >= 0) shotList.splice(idx, 1);
        }
        const sp = snap.shotPoses;
        for (let i = 0; i < sp.length; i += 8) {
            const s = shots.get(sp[i] | 0);
            if (!s) continue;
            s.prevP[0] = s.currP[0]; s.prevP[1] = s.currP[1]; s.prevP[2] = s.currP[2];
            s.prevQ[0] = s.currQ[0]; s.prevQ[1] = s.currQ[1]; s.prevQ[2] = s.currQ[2]; s.prevQ[3] = s.currQ[3];
            s.currP[0] = sp[i + 1]; s.currP[1] = sp[i + 2]; s.currP[2] = sp[i + 3];
            s.currQ[0] = sp[i + 4]; s.currQ[1] = sp[i + 5]; s.currQ[2] = sp[i + 6]; s.currQ[3] = sp[i + 7];
        }

        const touchedBuildings = new Set();
        for (const d of snap.deltas) {
            const W = woken.get(d.g);
            if (!W) continue;
            touchedBuildings.add(d.g);
            W.standing = d.standing;
            W.loose = d.pieces;
            W.touched = true;
            const first = W.first;
            let lo = N, hi = 0;

            // Freeze previous-step moved cells so any cell that went to sleep won't oscillate.
            const prev = W.prevMoved;
            for (let i = 0; i < prev.length; i++) {
                const k = prev[i], r = 20 * k;
                bodyRows[r + 8] = bodyRows[r + 4]; bodyRows[r + 9] = bodyRows[r + 5]; bodyRows[r + 10] = bodyRows[r + 6];
                bodyRows[r + 16] = bodyRows[r + 12]; bodyRows[r + 17] = bodyRows[r + 13]; bodyRows[r + 18] = bodyRows[r + 14]; bodyRows[r + 19] = bodyRows[r + 15];
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }

            const mv = d.mv;
            const nextMoved = new Uint32Array(mv.length / 8);
            for (let m = 0, mi = 0; m < mv.length; m += 8, mi++) {
                const cell = mv[m] | 0, k = first + cell, r = 20 * k, F = W.turn[W.frameOfCell[cell]];
                nextMoved[mi] = k;
                const x = mv[m + 1], y = mv[m + 2], z = mv[m + 3];
                bodyRows[r + 4] = x; bodyRows[r + 5] = y; bodyRows[r + 6] = z;
                const qx = mv[m + 4], qy = mv[m + 5], qz = mv[m + 6], qw = mv[m + 7];
                bodyRows[r + 12] = qx * F.qw + qz * F.qy; bodyRows[r + 13] = qy * F.qw - qw * F.qy;
                bodyRows[r + 14] = qz * F.qw - qx * F.qy; bodyRows[r + 15] = qw * F.qw + qy * F.qy;
                sphereRows[4 * k] = x; sphereRows[4 * k + 1] = y; sphereRows[4 * k + 2] = z;
                const wb = W.bounds;
                if (x >= wb[0] - 80 && x <= wb[3] + 80 && z >= wb[2] - 80 && z <= wb[5] + 80) {
                    expandCull(x - 8, y - 8, z - 8, x + 8, y + 8, z + 8);
                }
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            W.prevMoved = nextMoved;

            const bare = d.bare;
            for (let m = 0; m < bare.length; m += 2) {
                const k = first + bare[m];
                bodyRows[20 * k + 3] = bare[m + 1];
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            const gone = d.gone;
            for (let m = 0; m < gone.length; m++) {
                const k = first + gone[m], r = 20 * k;
                dust.add({ p: [bodyRows[r + 4], bodyRows[r + 5], bodyRows[r + 6]], r: 3, n: CRUSH_DUST, v: [0, 0.8, 0] });
                pieceRows[12 * k + 4] = 0; sphereRows[4 * k + 1] = -1e5;
                touch(dirtyPiece, k, k + 1);
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            if (hi > lo) touch(dirtyBody, lo, hi);
        }

        // Freeze prevMoved for buildings that became completely still on this step.
        for (const [g, W] of woken) {
            if (touchedBuildings.has(g) || !W.prevMoved.length) continue;
            let lo = N, hi = 0;
            for (let i = 0; i < W.prevMoved.length; i++) {
                const k = W.prevMoved[i], r = 20 * k;
                bodyRows[r + 8] = bodyRows[r + 4]; bodyRows[r + 9] = bodyRows[r + 5]; bodyRows[r + 10] = bodyRows[r + 6];
                bodyRows[r + 16] = bodyRows[r + 12]; bodyRows[r + 17] = bodyRows[r + 13]; bodyRows[r + 18] = bodyRows[r + 14]; bodyRows[r + 19] = bodyRows[r + 15];
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            W.prevMoved = new Uint32Array(0);
            if (hi > lo) touch(dirtyBody, lo, hi);
        }

        // Dust from active reach summary.
        const rArr = snap.reach;
        if (tick % 6 === 0 && rArr.length) {
            let sx = 0, sz = 0, sn = 0;
            for (let i = 0; i < rArr.length; i += 4) {
                const x = rArr[i], y = rArr[i + 1], z = rArr[i + 2], cnt = rArr[i + 3];
                dust.add({ p: [x, y, z], r: 3, n: cnt * 0.1, v: [0, 0.5, 0] });
                sx += x * cnt; sz += z * cnt; sn += cnt;
            }
            if (sn) {
                for (let i = 0; i < rArr.length; i += 4) {
                    const cnt = rArr[i + 3];
                    if (cnt < SURGE_COUNT) continue;
                    const x = rArr[i], y = rArr[i + 1], z = rArr[i + 2], gg = groundAt(x, z);
                    if (y - gg > SURGE_HEIGHT) continue;
                    let dx = x - sx / sn, dz = z - sz / sn;
                    const dd = Math.hypot(dx, dz);
                    if (dd < 1) { const a = Math.random() * 6.283; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= dd; dz /= dd; }
                    dust.add({ p: [x + dx * 4, gg + 2.5, z + dz * 4], r: 4, n: cnt * 0.08, v: [dx * SURGE_SPEED, 0, dz * SURGE_SPEED] });
                }
            }
        }

        const wakeList = [], tileList = [];
        if (snap.needWake.length) buildWakePayload(snap.needWake, wakeList, tileList);
        for (const [ti, tj] of snap.needTiles) collectTile(ti, tj, tileList);
        postExtras(wakeList, tileList);

        send();
        if (top && ground && gritAcc > 0) {
            grit.update({ rows: bodyBuf, built: sphereBuf, pieces: sphereBuf, na: drawn, nb: 0, units: N,
                          dt: gritAcc, blend: 1, span: 1 / 60, ground, eye: opts.eye?.() });
            gritAcc = 0;
        }

        if (waitResolve) {
            if (tick < waitTarget && (woken.size || wakeSent.size || shots.size)) {
                workerBusy = true;
                worker.postMessage({ step: { count: 1 } });
            } else {
                const r = waitResolve; waitResolve = null; r();
            }
        }
    }

    function fire(o) {
        const spec = o.shape === 'box'
            ? { shape: 'box', half: o.halfExtents.slice() }
            : { shape: 'sphere', radius: o.radius ?? 1 };
        const r = spec.half ? Math.hypot(...spec.half) : spec.radius;
        const p = o.position, v = o.velocity, T = 0.3;
        const sp = Math.hypot(v[0], v[1], v[2]), steps = Math.max(1, Math.ceil(sp * T / 4));
        const wakeIds = new Set();
        for (let k = 0; k <= steps; k++) {
            const t = k / steps * T;
            for (const g of buildingsNear(p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t, r + 2)) wakeIds.add(g);
        }
        const wakeList = [], tileList = [];
        buildWakePayload([...wakeIds], wakeList, tileList);
        collectTilesAbout(p[0] + v[0] * T * 0.5, p[2] + v[2] * T * 0.5, sp * T * 0.5 + r + TILE_STEP, tileList);
        postExtras(wakeList, tileList);

        if (shotList.length >= MAX_SHOTS) {
            const oldId = shotList.shift();
            const old = shots.get(oldId);
            if (old) { old.node.destroy(); shots.delete(oldId); }
        }
        const id = nextShotId++;
        const meshNode = spec.shape === 'box'
            ? scene.createMesh({ mesh: 'box', halfW: spec.half[0], halfH: spec.half[1], halfD: spec.half[2], color: '#2e2e33', metallic: 0.8, roughness: 0.35 })
            : scene.createMesh({ mesh: 'sphere', radius: spec.radius, segments: 22, rings: 15, color: '#2e2e33', metallic: 0.8, roughness: 0.35 });
        meshNode.x = p[0]; meshNode.y = p[1]; meshNode.z = p[2];
        const q = [0, 0, 0, 1];
        shots.set(id, { id, node: meshNode, prevP: p.slice(), currP: p.slice(), prevQ: q.slice(), currQ: q.slice() });
        shotList.push(id);
        worker.postMessage({ fire: { id, ...spec, mass: o.mass ?? 1000, position: p, velocity: v } });
        return id;
    }

    function down(g) {
        const W = woken.get(g);
        if (!W || !W.live) return 0;
        return Math.max(0, Math.min(1, (W.count - W.standing) / W.live));
    }
    let encloseCheck = 0;
    function checkEnclosed(dt) {
        encloseCheck -= dt;
        if (encloseCheck > 0 || !enclosed.size) return;
        encloseCheck = 0.1;
        for (const g of [...enclosed]) {
            const d = down(g);
            if (d > 0) opts.interiors.release?.(g);
            if (d >= DOWN) { opts.interiors.unenclose(g); enclosed.delete(g); continue; }
            opts.interiors.breach?.(g, d > 0 ? Math.max(0.1, d / DOWN) : 0);
        }
    }

    function interpolateShots(blend) {
        for (const [, s] of shots) {
            s.node.x = s.prevP[0] + (s.currP[0] - s.prevP[0]) * blend;
            s.node.y = s.prevP[1] + (s.currP[1] - s.prevP[1]) * blend;
            s.node.z = s.prevP[2] + (s.currP[2] - s.prevP[2]) * blend;
            let dot = s.prevQ[0] * s.currQ[0] + s.prevQ[1] * s.currQ[1] + s.prevQ[2] * s.currQ[2] + s.prevQ[3] * s.currQ[3];
            const sg = dot < 0 ? -1 : 1;
            const qx = s.prevQ[0] + (sg * s.currQ[0] - s.prevQ[0]) * blend;
            const qy = s.prevQ[1] + (sg * s.currQ[1] - s.prevQ[1]) * blend;
            const qz = s.prevQ[2] + (sg * s.currQ[2] - s.prevQ[2]) * blend;
            const qw = s.prevQ[3] + (sg * s.currQ[3] - s.prevQ[3]) * blend;
            const inv = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
            s.node.quaternion = [qx * inv, qy * inv, qz * inv, qw * inv];
        }
    }

    return {
        node, dust, grit,
        fire,
        update(dt) {
            checkEnclosed(dt);
            dust.update(dt);
            now += dt;
            if (!woken.size && !wakeSent.size && !shots.size) return;
            clock += Math.min(dt, 0.25) * 60;
            if (clock >= tick + 1 && !workerBusy) {
                workerBusy = true;
                gritAcc = Math.min(0.05, gritAcc + 1 / 60);
                clock = Math.min(clock, tick + 1);
                worker.postMessage({ step: { count: 1 } });
            }
            const blend = Math.min(1, Math.max(0, (now - lastSnapAt) / Math.max(1 / 120, Math.min(1 / 15, snapInterval))));
            node.setShaderUniform('blend', blend);
            farNode.setShaderUniform('blend', blend);
            interpolateShots(blend);
        },
        setNight(n, dayK = 60, nightK = 5) {
            for (const nd of nodes) { nd.setShaderUniform('night', n); nd.setShaderUniform('room_day', dayK); nd.setShaderUniform('room_night', nightK); }
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() { return { ...cachedStats }; },
        stepToAsync(to) {
            if (tick >= to || (!woken.size && !wakeSent.size && !shots.size)) return Promise.resolve();
            waitTarget = to;
            return new Promise((resolve) => {
                waitResolve = resolve;
                if (!workerBusy) { workerBusy = true; worker.postMessage({ step: { count: 1 } }); }
            });
        },
        get tick() { return tick; },
        get near() { return near; },
        set near(v) { near = v; spheres(); },
        buildingOf: (i) => owner[i],
        groups() {
            const out = [];
            for (const [g, W] of woken) out.push({ building: g, first: W.first, count: W.count, touched: W.touched, down: down(g) });
            return out;
        },
        down,
        terminate() { worker.terminate(); },
    };
}

