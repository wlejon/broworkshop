// lib/city/destruction.js — a city's buildings made breakable: each one a
// shot comes near is turned into its members (structure.js) and stood in a
// bro.dynamics world as a structure (docs/dynamics-api.js addStructure): it
// costs the world nothing while it stands, breaks where it is struck, and
// comes down when what is left cannot carry it. Its cells are drawn by
// destruction.bk, one instanced box a cell, as what they were on the building.
//
// createCityDestruction(scene, city, buildings, opts) -> {
//   fire({ shape, radius, halfExtents, mass, position, velocity }),
//   update(dt), setNight(n), stats, tick, stepTo(tick), buildingOf(i), down(g), groups(),
//   world, node, dust, grit }
// `buildings` is building_render's (its masses stop drawing as they wake);
// opts.interiors keeps a woken building's rooms as they were until it breaks
// (cutting its cells' glass as the walls' is cut), then indoors until it is
// down; opts.src the cells' shader source; opts.heights the ground's heights
// for the crumbs to fall on (the app's terrain kernel: heights(buffer,
// { origin, dim, cell })); opts.eye() where the picture is seen from
// ([x, y, z]): the crumbs the loose cells shed (lib/destruct/grit.js) are
// spent near it; opts.capacity the cells there is room for (2^18); opts.chunk
// how far across a cell is at most (3 m).
//
// The page keeps the clock: a frame takes the step due (60 Hz), one at most,
// so a collapse too heavy for the frame rate runs slow and the picture does
// not wait. The world's ground is the city's graded ground, in tiles made
// under whatever wakes or moves.

import { MASS_FLOATS } from "./buildings.js";
import { facadeSource } from "./building_render.js";
import { buildingStructure, KIND } from "./structure.js";
import { createDust } from "../destruct/dust.js";
import { createGrit } from "../destruct/grit.js";
import { addBody, applyMoved } from "../kit/dynamics3d.js";

const CELL = 64;
const CHUNK = 3;
// The dust a crushed cell leaves (dust.add's n, a cell).
const CRUSH_DUST = 2;
// Per material (structure.js's MAT): its density (kg/m^3), what its joints hold (Pa over the face joined),
// how far they stretch before they let go (m), and what a cell of it crushes at (Pa over the side pressed: a
// member is the whole floor or wall it stands for, not solid through).
const MATERIAL = [
    { rho: 2400, sigma: 6e6, give: 0.04, crush: 1.2e7 },     // concrete, reinforced: cracks, hinges, holds on its bars
    { rho: 1900, sigma: 1.5e6, give: 0.01, crush: 6e6 },     // masonry: crumbles
    { rho: 450, sigma: 2e6, give: 0.005, crush: 2e6 },       // curtain wall: shatters out of its frame
    { rho: 650, sigma: 2e7, give: 0.16, crush: 8e6 },        // steel frame + cladding: bends far
    { rho: 550, sigma: 5e6, give: 0.04, crush: 5e6 },        // timber
];
const SLAB_LOAD = 300;   // kg/m^2 a floor carries besides itself (finishes, partitions, furniture, people)
const ROOF_LOAD = 120;   // kg per m^2 of plan: rafters, battens, tiles
const DOWN = 0.3;        // the share of its cells no longer standing that makes a building down
const MAX_SHOTS = 32;
const REACH_CELL = 8;    // m: the squares of the plan the moving cells are counted over
// The surge: dust driven out along the ground where this many cells of a plan square are moving within this
// height (m) of it, at this speed (m/s; the dust's drag stops it in a few tens of metres).
const SURGE_COUNT = 12, SURGE_HEIGHT = 12, SURGE_SPEED = 16;
const NEAR = 90;         // m from the eye within which a cell is drawn with its faces cut finer (boxMesh(2))
const TILE = 64, TILE_STEP = 4;   // the ground's tiles (m), and how far apart their heights are
const GROUND_DIM = 512, GROUND_CELL = 4;   // the crumbs' ground: heights every 4 m, 1 km about the first building woken

function hash(a, b = 0) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

function boxMesh(N, welded = false) {
    // A unit box, N x N quads a face, 4 normals per corner so faces stay flat
    // (the vertex stage displaces the broken ones). Welded: a vertex a
    // corner, for what casts a shadow and shows no face: a third of the
    // vertices to place, in every shadow view.
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
    const world = bro.dynamics.createWorld();
    const N = opts.capacity ?? 1 << 18, chunk = opts.chunk ?? CHUNK;

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
    // The buildings still whole within r of a point (y null: of the point of the plan, at any height).
    const woken = new Map();   // building -> { structure, first, count, ... }
    const refused = new Map();
    function buildingsNear(x, y, z, r) {
        const out = new Set();
        for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
            for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
                for (const i of grid.get(key(ci, cj)) ?? []) {
                    if (owner[i] >= 0 && !woken.has(owner[i]) && !(refused.get(owner[i]) > now - 10) && massDist(i, x, y ?? D[i * MASS_FLOATS + 1] + 1, z) <= r) out.add(owner[i]);
                }
            }
        }
        return [...out].sort((a, b) => a - b);
    }

    // ---------------------------------------------------------------------
    // The ground: the city's graded ground, a tile of triangles under whatever wakes or moves
    // ---------------------------------------------------------------------

    const tiles = new Set();
    function groundTile(ti, tj) {
        const k = key(ti, tj);
        if (tiles.has(k)) return;
        tiles.add(k);
        const n = TILE / TILE_STEP, x0 = ti * TILE, z0 = tj * TILE;
        const positions = new Float32Array((n + 1) * (n + 1) * 3), indices = new Uint32Array(n * n * 6);
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
            const v = (j * (n + 1) + i) * 3;
            positions[v] = i * TILE_STEP; positions[v + 1] = groundAt(x0 + i * TILE_STEP, z0 + j * TILE_STEP); positions[v + 2] = j * TILE_STEP;
        }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, t = (j * n + i) * 6;
            indices[t] = a; indices[t + 1] = a + n + 1; indices[t + 2] = a + n + 2;
            indices[t + 3] = a; indices[t + 4] = a + n + 2; indices[t + 5] = a + 1;
        }
        world.addMesh({ positions, indices, position: [x0, 0, z0], friction: 0.8 });
    }
    function groundAbout(x, z, r) {
        for (let ti = Math.floor((x - r) / TILE); ti <= Math.floor((x + r) / TILE); ti++) {
            for (let tj = Math.floor((z - r) / TILE); tj <= Math.floor((z + r) / TILE); tj++) groundTile(ti, tj);
        }
    }

    // ---------------------------------------------------------------------
    // Drawing: a row a cell for destruction.bk, its pose from the world
    // ---------------------------------------------------------------------

    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/city/destruction.bk'), 'utf8');
    // Three nodes over the same rows: the cells near the eye with each face four quads (a broken face's jag has
    // a middle to move), the rest as plain boxes, a quarter of the triangles, and what they cast, drawn in the
    // shadow views alone: a plain box of eight vertices, where the seen ones' faces each have their own four
    // for a flat normal.
    const SLACK = 1 << 12;
    const cellNode = (name, cut, casts = false) => scene.createInstancedMesh({
        name, mesh: boxMesh(cut, casts), capacity: N, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: casts, shadowOnly: casts, receivesShadow: true,
    });
    const node = cellNode('city_pieces', 2), farNode = cellNode('city_pieces_far', 1), castNode = cellNode('city_pieces_cast', 1, true);
    const nodes = [node, farNode, castNode];
    let near = opts.near ?? NEAR;
    // Per cell, 3 x vec4 (destruction.bk's `pieces`), 5 x vec4 (its `bodies`: a cell is its own body there)
    // and its sphere, for each view to draw the cells in it. The page keeps what it last wrote of each.
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
        nd.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
        await nd.setShaderAsync({ module: src, file: 'lib/city/destruction.bk', modules: { facade: facadeSource() },
                                  uniforms: { night: 0, room_day: 60, room_night: 5, debug: 0, blend: 1, base: 0 } });
        nd.setShaderBuffer('masses', buildings.masses);
        // (Its glass cut where an open building's is: one held open standing.)
        if (closed) nd.setShaderBuffer('open_state', closed);
        else opts.interiors.addWalls(nd);
        nd.setShaderBuffer('pieces', pieceBuf);
        nd.setShaderBuffer('bodies', bodyBuf);
        // The hook places every vertex from the two buffers alone: a still caster while neither is bound again.
        nd.hookStill = true;
        nd.setInstanceCount(0);
    }
    spheres();
    // The rows handed out: a building's cells in one run, a run given back taken again by the next it fits.
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
    // What was written of the rows since they were last sent: [from, to) of each kind.
    const stale = { piece: [N, 0], body: [N, 0] };
    const touch = (s, a, b) => { if (a < s[0]) s[0] = a; if (b > s[1]) s[1] = b; };
    function send() {
        const p = stale.piece, b = stale.body;
        if (p[1] > p[0]) pieceBuf.write(pieceRows.subarray(12 * p[0], 12 * p[1]), 48 * p[0]);
        if (b[1] > b[0]) {
            bodyBuf.write(bodyRows.subarray(20 * b[0], 20 * b[1]), 80 * b[0]);
            sphereBuf.write(sphereRows.subarray(4 * b[0], 4 * b[1]), 16 * b[0]);
        }
        if (p[1] <= p[0] && b[1] <= b[0]) return;
        p[0] = b[0] = N; p[1] = b[1] = 0;
        // (Bound again: the still cells' cached shadows are redrawn. While nothing moves, nothing is bound
        // again, and they are kept.)
        for (const nd of nodes) { nd.setShaderBuffer('pieces', pieceBuf); nd.setShaderBuffer('bodies', bodyBuf); }
        spheres();
        // (As far as the rows have been handed out, in strides: a node goes over its instances' bounds
        // whenever it is told their count.)
        const c = Math.min(N, Math.ceil(top / SLACK) * SLACK);
        if (c !== drawn) { drawn = c; for (const nd of nodes) nd.setInstanceCount(c); }
    }

    // Dust: a lit medium (lib/destruct/dust.js).
    const dust = createDust(scene, { groundAt });
    // Grit: the crumbs and shards the loose cells shed on their way (lib/destruct/grit.js), on the ground
    // about the first building woken.
    const grit = await createGrit(scene);
    let ground = null;
    function gritGround(x, z) {
        if (ground || typeof opts.heights !== 'function') return;
        const origin = [x, groundAt(x, z), z], buffer = bro.kernel.createBuffer(4 * GROUND_DIM * GROUND_DIM);
        opts.heights(buffer, { origin, dim: GROUND_DIM, cell: GROUND_CELL });
        ground = { buffer, origin, dim: GROUND_DIM, cell: GROUND_CELL };
    }

    // ---------------------------------------------------------------------
    // Waking a building: its members into the world, its masses out of the picture
    // ---------------------------------------------------------------------

    // A standing building's rooms indoors, opened to the daylight as its
    // cells come loose, and outdoors for good once it is down.
    const enclosed = new Set();
    function wake(g) {
        // (Asked for twice, by two shots at once or one heard of twice: woken once.)
        if (woken.has(g)) return;
        const b = blds[g];
        const S = buildingStructure(D, b, groundAt);
        // A frame a mass: members are boxes in their own mass's frame.
        const frameOf = new Map(), frames = [], turn = [];
        const frame = (i) => {
            let f = frameOf.get(i);
            if (f === undefined) {
                const m = i * MASS_FLOATS, yaw = D[m + 3];
                frameOf.set(i, f = frames.length);
                frames.push({ position: [D[m], D[m + 1], D[m + 2]], rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
                turn.push({ mass: i, x: D[m], y: D[m + 1], z: D[m + 2], c: Math.cos(yaw), s: Math.sin(yaw), qy: Math.sin(yaw / 2), qw: Math.cos(yaw / 2) });
                groundAbout(D[m], D[m + 2], Math.hypot(D[m + 4], D[m + 6]) + TILE / 2);
            }
            return f;
        };
        const members = S.members.map((m) => {
            const M = MATERIAL[m.mat], area = 4 * m.h[0] * m.h[2], volume = 8 * m.h[0] * m.h[1] * m.h[2];
            return {
                frame: frame(m.frame), center: m.c, half: m.h, anchored: m.kind === KIND.foundation, sigma: M.sigma, crush: M.crush, give: M.give,
                mass: m.kind === KIND.roof ? ROOF_LOAD * area : M.rho * volume + (m.kind === KIND.slab ? SLAB_LOAD * area : 0),
            };
        });
        const structure = world.addStructure({ frames, members, ties: S.joints.map((j) => [j.a, j.b]), chunk });
        const cells = structure.cells, n = cells.length / 12, first = takeRows(n);
        // (No room for it: it stays whole, and what reaches it later asks again.)
        if (first < 0) { structure.destroy(); refused.set(g, now); console.warn(`destruction: no room for building ${g}: it stays whole`); return; }
        let live = 0;
        const frameOfCell = new Uint16Array(n);
        for (let i = 0; i < n; i++) {
            const c = 12 * i, m = S.members[cells[c]], f = frameOf.get(m.frame), F = turn[f];
            const dx = cells[c + 1] - F.x, dz = cells[c + 3] - F.z, k = first + i;
            frameOfCell[i] = f;
            pieceRows.set([F.c * dx - F.s * dz, cells[c + 2] - F.y, F.s * dx + F.c * dz, m.frame,
                           cells[c + 8], cells[c + 9], cells[c + 10], k + 1,
                           m.kind, m.mat, 0, hash(g * 8191 + cells[c], 77)], 12 * k);
            const p = [cells[c + 1], cells[c + 2], cells[c + 3]];
            bodyRows.set([...p, 0, ...p, 0, ...p, 0, 0, 0, 0, 1, 0, 0, 0, 1], 20 * k);
            sphereRows.set([...p, Math.hypot(cells[c + 8], cells[c + 9], cells[c + 10])], 4 * k);
            if (m.kind !== KIND.foundation) live++;
        }
        touch(stale.piece, first, first + n); touch(stale.body, first, first + n);
        woken.set(g, { structure, first, count: n, live, anchored: n - live, turn, frameOfCell, since: now, touched: false, loose: 0 });
        gritGround(frames[0].position[0], frames[0].position[2]);
        // Its masses stop drawing: its cells draw it now.
        const ids = [];
        for (let k = 0; k < b.count; k++) ids.push(b.first + k);
        buildings.hide(ids);
        // Its rooms stay indoors while it stands, and, if it is open, as
        // they were (rooms and glass) until it breaks.
        if (opts.interiors?.enclose(g)) { enclosed.add(g); opts.interiors.hold?.(g); }
        else opts.interiors?.forget(g);
    }

    // A building woken and left as it was built goes back to standing whole, and its rows to the next: five
    // seconds woken, nothing of it loose or bare, nothing on the move near it. One a second is looked at.
    let restored = 0, looked = 0, now = 0;  // (seconds of update()'s clock)
    function restore() {
        if (now - looked < 1) return;
        looked = now;
        for (const [g, W] of woken) {
            if (W.touched || now - W.since < 5) continue;
            const b = blds[g];
            let nearby = false;
            for (const c of reach.values()) {
                for (let k = 0; k < b.count && !nearby; k++) nearby = massDist(b.first + k, c.x / c.count, D[(b.first + k) * MASS_FLOATS + 1] + 1, c.z / c.count) <= REACH_CELL * 1.5;
                if (nearby) break;
            }
            for (const s of shots) {
                if (nearby) break;
                const p = world.pose(s.body), v = world.velocity(s.body);
                if (Math.hypot(v[0], v[1], v[2]) < 0.5) continue;
                for (let k = 0; k < b.count && !nearby; k++) nearby = massDist(b.first + k, p[0], p[1], p[2]) <= 30;
            }
            if (nearby) { W.since = now - 4; continue; }
            W.structure.destroy();
            pieceRows.fill(0, 12 * W.first, 12 * (W.first + W.count));
            for (let i = W.first; i < W.first + W.count; i++) sphereRows[4 * i + 1] = -1e5;
            touch(stale.piece, W.first, W.first + W.count); touch(stale.body, W.first, W.first + W.count);
            free.push([W.first, W.count]);
            const ids = [];
            for (let k = 0; k < b.count; k++) ids.push(b.first + k);
            buildings.show(ids);
            if (enclosed.delete(g)) { opts.interiors.unenclose(g); opts.interiors.release?.(g); }
            woken.delete(g);
            restored++;
            return;
        }
    }

    // The share of building g's cells (its foundation aside) no longer standing.
    function down(g) {
        const W = woken.get(g);
        if (!W || !W.live) return 0;
        return Math.max(0, Math.min(1, (W.count - W.structure.counts.standing) / W.live));
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
            // (Any breach at all lets a little of the sky in.)
            opts.interiors.breach?.(g, d > 0 ? Math.max(0.1, d / DOWN) : 0);
        }
    }

    // ---------------------------------------------------------------------
    // Shots and stepping
    // ---------------------------------------------------------------------

    const shots = [];   // { body, node, r }
    const shotNodes = new Map();
    // The buildings in a body's way over the next quarter second wake now (the ones beyond as it nears them).
    function wakeAlong(p, v, r, T) {
        const speed = Math.hypot(v[0], v[1], v[2]), n = Math.max(1, Math.ceil(speed * T / 4));
        for (let k = 0; k <= n; k++) {
            const t = k / n * T;
            for (const g of buildingsNear(p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t, r + 2)) wake(g);
        }
        groundAbout(p[0] + v[0] * T * 0.5, p[2] + v[2] * T * 0.5, speed * T * 0.5 + r + TILE_STEP);
    }
    function fire(o) {
        const spec = o.shape === 'box'
            ? { shape: 'box', half: o.halfExtents.slice() }
            : { shape: 'sphere', radius: o.radius ?? 1 };
        const r = spec.half ? Math.hypot(...spec.half) : spec.radius;
        wakeAlong(o.position, o.velocity, r, 0.3);
        if (shots.length >= MAX_SHOTS) {
            const old = shots.shift();
            world.removeBody(old.body); old.node.destroy(); shotNodes.delete(old.body);
        }
        const made = addBody(world, scene, { ...spec, mass: o.mass ?? 1000, position: o.position, velocity: o.velocity, friction: 0.6, bullet: true },
                             { color: '#2e2e33', metallic: 0.8, roughness: 0.35 });
        shots.push({ body: made.body, node: made.node, r });
        shotNodes.set(made.body, made.node);
        return made.body;
    }

    // Where the loose cells are on the move, by squares of the plan: { x, y, z (sums), count } each.
    let reach = new Map(), tick = 0;
    const waking = [];
    function step() {
        for (const s of shots) {
            const v = world.velocity(s.body);
            if (Math.hypot(v[0], v[1], v[2]) > 2) wakeAlong(world.pose(s.body), v, s.r, 0.25 + 3 / 60);
        }
        // What the cells themselves come down on or are thrown at wakes: one building a step.
        if (waking.length) { const g = waking.shift(); if (!woken.has(g)) wake(g); }
        world.step(1 / 60, 4);
        tick++;
        applyMoved(world, shotNodes);
        reach = new Map();
        for (const [, W] of woken) {
            const st = W.structure, first = W.first;
            const mv = st.moved(), bare = st.bared(), gone = st.crushed();
            if (!mv.length && !bare.length && !gone.length) continue;
            W.touched = true;
            let lo = N, hi = 0;
            for (let m = 0; m < mv.length; m += 8) {
                const cell = mv[m], k = first + cell, r = 20 * k, F = W.turn[W.frameOfCell[cell]];
                const x = mv[m + 1], y = mv[m + 2], z = mv[m + 3];
                // (Where it was a step ago is where it is drawn from; its turn is from how it stood: its
                // frame's taken off what it has now.)
                bodyRows[r + 8] = bodyRows[r + 4]; bodyRows[r + 9] = bodyRows[r + 5]; bodyRows[r + 10] = bodyRows[r + 6];
                bodyRows[r + 16] = bodyRows[r + 12]; bodyRows[r + 17] = bodyRows[r + 13]; bodyRows[r + 18] = bodyRows[r + 14]; bodyRows[r + 19] = bodyRows[r + 15];
                bodyRows[r + 4] = x; bodyRows[r + 5] = y; bodyRows[r + 6] = z;
                const qx = mv[m + 4], qy = mv[m + 5], qz = mv[m + 6], qw = mv[m + 7];
                bodyRows[r + 12] = qx * F.qw + qz * F.qy; bodyRows[r + 13] = qy * F.qw - qw * F.qy;
                bodyRows[r + 14] = qz * F.qw - qx * F.qy; bodyRows[r + 15] = qw * F.qw + qy * F.qy;
                sphereRows[4 * k] = x; sphereRows[4 * k + 1] = y; sphereRows[4 * k + 2] = z;
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
                const rk = key(Math.floor(x / REACH_CELL), Math.floor(z / REACH_CELL));
                let c = reach.get(rk);
                if (!c) reach.set(rk, c = { x: 0, y: 0, z: 0, count: 0 });
                c.x += x; c.y += y; c.z += z; c.count++;
            }
            for (let m = 0; m < bare.length; m += 2) {
                const k = first + bare[m];
                bodyRows[20 * k + 3] = bare[m + 1];
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            // A crushed cell is gone: out of the picture, and dust where it was.
            for (let m = 0; m < gone.length; m++) {
                const k = first + gone[m], r = 20 * k;
                dust.add({ p: [bodyRows[r + 4], bodyRows[r + 5], bodyRows[r + 6]], r: 3, n: CRUSH_DUST, v: [0, 0.8, 0] });
                pieceRows[12 * k + 4] = 0; sphereRows[4 * k + 1] = -1e5;
                touch(stale.piece, k, k + 1);
                if (k < lo) lo = k;
                if (k >= hi) hi = k + 1;
            }
            if (hi > lo) touch(stale.body, lo, hi);
        }
        reached();
    }
    /** Where the cells are on the move: the ground under them, buildings to wake, and dust. */
    function reached() {
        let sx = 0, sz = 0, sn = 0;
        const seen = new Set();
        for (const c of reach.values()) {
            const x = c.x / c.count, y = c.y / c.count, z = c.z / c.count;
            groundAbout(x, z, REACH_CELL);
            // (A dozen cells over a square of the plan: one flung panel is not what brings the next building down.)
            if (c.count >= 12 && !waking.length) {
                for (const g of buildingsNear(x, null, z, REACH_CELL * 0.75)) { if (!seen.has(g)) { seen.add(g); waking.push(g); } }
            }
            // Dust where the cells are on the move, by how many: off a tower all the way down, and thickest
            // where it lands.
            if (tick % 6 === 0 && c.count >= 4) { dust.add({ p: [x, y, z], r: 3, n: c.count * 0.1, v: [0, 0.5, 0] }); sx += c.x; sz += c.z; sn += c.count; }
        }
        if (tick % 6 !== 0 || !sn) return;
        // Where they come down in number the air under them has nowhere to go but out: dust driven along the
        // ground, away from the middle of what is falling, down the streets.
        for (const c of reach.values()) {
            if (c.count < SURGE_COUNT) continue;
            const x = c.x / c.count, z = c.z / c.count, g = groundAt(x, z);
            if (c.y / c.count - g > SURGE_HEIGHT) continue;
            let dx = x - sx / sn, dz = z - sz / sn;
            const d = Math.hypot(dx, dz);
            if (d < 1) { const a = Math.random() * 6.283; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
            dust.add({ p: [x + dx * 4, g + 2.5, z + dz * 4], r: 4, n: c.count * 0.08, v: [dx * SURGE_SPEED, 0, dz * SURGE_SPEED] });
        }
    }

    let clock = 0, lit = [0, 60, 5];   // (the clock in steps, 60 Hz)
    return {
        world, node, dust, grit,
        /** Fire a shot ({ shape: 'sphere', radius } or { shape: 'box', halfExtents }, mass, position,
         *  velocity): its body in the world. */
        fire,
        /** Advance the clock dt seconds and take the step due. */
        update(dt) {
            checkEnclosed(dt);
            dust.update(dt);
            now += dt;
            if (!woken.size && !shots.length) return;
            clock += Math.min(dt, 0.25) * 60;
            let stepped = false;
            if (clock >= tick + 1) { step(); stepped = true; clock = Math.min(clock, tick + 1); }
            restore();
            send();
            if (top && ground) {
                grit.update({ rows: bodyBuf, built: sphereBuf, pieces: sphereBuf, na: drawn, nb: 0, units: N,
                              dt: stepped ? 1 / 60 : 0, blend: 1, span: 1 / 60, ground, eye: opts.eye?.() });
            }
        },
        setNight(n, dayK = 60, nightK = 5) {
            lit = [n, dayK, nightK];
            for (const nd of nodes) { nd.setShaderUniform('night', n); nd.setShaderUniform('room_day', dayK); nd.setShaderUniform('room_night', nightK); }
            // The city's lights on its dust: sodium and window light.
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() {
            const c = world.counts;
            let cells = 0, standing = 0, loose = 0;
            for (const [, W] of woken) { const k = W.structure.counts; cells += k.cells; standing += k.standing; loose += k.pieces; }
            return { bodies: c.bodies, awake: c.awake, stepMs: c.stepMs, cells, standing, loose, groups: woken.size, restored, shots: shots.length };
        },
        /** Take every step to `tick` now, however many (tests). */
        stepTo(to) {
            while (tick < to && (woken.size || shots.length)) step();
            clock = Math.max(clock, tick);
            send();
        },
        /** The step last taken. */
        get tick() { return tick; },
        /** How far from the eye (m) the cells are drawn with their faces cut finer. */
        get near() { return near; },
        set near(v) { near = v; spheres(); },
        /** The building (index into city.masses.buildings) mass i belongs to. */
        buildingOf: (i) => owner[i],
        /** The buildings woken: [{ building, first, count, touched, down }] (its cells' rows, whether anything
         *  of it was ever let go, the share of it no longer standing). */
        groups() {
            const out = [];
            for (const [g, W] of woken) out.push({ building: g, first: W.first, count: W.count, touched: W.touched, down: down(g), structure: W.structure });
            return out;
        },
        /** The share of building g's cells no longer standing (0 while it is whole). */
        down,
    };
}
