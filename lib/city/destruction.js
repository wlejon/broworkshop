// lib/city/destruction.js — a city's buildings made breakable: each one a
// shot comes near is turned into its members (structure.js), cut into welded
// pieces and stood in lib/destruct's solver, a rigid-body world stepped on the
// GPU. The pieces are drawn by destruction.bk straight from the solver's
// buffers: nothing of a step comes back to the page but what it asks about.
//
// createCityDestruction(scene, city, buildings, opts) -> {
//   fire({ shape, radius, halfExtents, mass, position, velocity }),
//   update(dt), setNight(n), stats, tick, stepTo(tick), buildingOf(i), down(g), solver, node, dust, grit }
// `buildings` is building_render's (its masses stop drawing as they wake);
// opts.interiors keeps a woken building's rooms as they were until it breaks
// (cutting its pieces' glass as the walls' is cut), then indoors until it is
// down; opts.src the pieces' shader source; opts.heights the ground the
// pieces fall on, as solver.setOrigin takes it (the app's terrain kernel:
// what draws the ground knows its heights); opts.eye() where the picture is
// seen from ([x, y, z]): the crumbs the loose pieces shed (lib/destruct/grit.js)
// are spent near it.
//
// The page keeps the clock: a frame takes the step due (60 Hz), one at most,
// so a collapse too heavy for the frame rate runs slow and the picture does
// not wait. Shots are boxes (a sphere asked for is a cube of its volume).
// The solver's ground is the city's graded ground within a kilometre of the
// first building woken.

import { MASS_FLOATS } from "./buildings.js";
import { facadeSource } from "./building_render.js";
import { buildingStructure, KIND } from "./structure.js";
import { createSolver, REACH_CELL } from "../destruct/solver.js";
import { createDust } from "../destruct/dust.js";
import { createGrit } from "../destruct/grit.js";
import { createBuilder } from "../destruct/builder.js";

const CELL = 64;
// Per material (structure.js's MAT): its density (kg/m^3), and how much more a member of it holds than it
// carries as built.
const MATERIAL = [
    { rho: 2400, sf: 2.0 },   // concrete
    { rho: 1900, sf: 2.5 },   // masonry
    { rho: 450, sf: 2.0 },    // curtain wall
    { rho: 650, sf: 2.0 },    // steel frame + cladding
    { rho: 550, sf: 2.0 },    // timber
];
const SLAB_LOAD = 300;   // kg/m^2 a floor carries besides itself (finishes, partitions, furniture, people)
const ROOF_LOAD = 120;   // kg per m^2 of plan: rafters, battens, tiles
const DOWN = 0.3;        // the share of its pieces off the ground's support that makes a building down
const MAX_SHOTS = 32;
// The surge: dust driven out along the ground where this many pieces of a plan square are moving within this
// height (m) of it, at this speed (m/s; the dust's drag stops it in a few tens of metres).
const SURGE_COUNT = 24, SURGE_HEIGHT = 12, SURGE_SPEED = 16;
const NEAR = 90;        // m from the eye within which a piece is drawn with its faces cut finer (boxMesh(2))

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

// A shot: a box, sized and placed from its body's row (solver.bk's k_show).
const SHOT_SRC = `
module hook;
import mesh;

struct Params {
    blend: f32,   // how far the picture is from the solver's last step but one (0) to its last (1)
}
@binding(4, 0) var params: uniform<Params>;
// Per body, 5 x vec4 (the solver's k_show): where it stood, where it is and was when last shown, its turn
// since it stood, now and then.
@binding(4, 14) var bodies: read_buffer<vec4<f32>>;
// Per shot: (half extents, body).
@binding(4, 15) var shots: read_buffer<vec4<f32>>;

fn qrot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

pub fn vertex(v_in: mesh::Vertex) -> mesh::Vertex {
    var v = v_in;
    let s = shots[v.instance_index];
    let bi = (s.w + 0.5) as i32;
    let qa = bodies[bi * 5 + 3];
    var qb = bodies[bi * 5 + 4];
    if (dot(qa, qb) < 0.0) { qb = -qb; }
    let q = normalize(mix(qb, qa, params.blend));
    v.pos = qrot(q, v.pos * 2.0 * s.xyz) + mix(bodies[bi * 5 + 2].xyz, bodies[bi * 5 + 1].xyz, params.blend);
    v.normal = qrot(q, v.normal);
    return v;
}
`;

export async function createCityDestruction(scene, city, buildings, opts = {}) {
    if (typeof opts.heights !== 'function') throw new TypeError('createCityDestruction: opts.heights (the ground\'s heights, as solver.setOrigin takes them) is needed');
    const { data: D, count, buildings: blds } = city.masses;
    const groundAt = city.graded;
    // (Rubble stays in the solver, to be struck again: half a million pieces is two dozen towers' worth.)
    const solver = createSolver({ capacity: opts.capacity ?? 1 << 19 });
    const N = solver.capacity;

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
    const woken = new Map();   // building -> { firstMember, members, pieces } | null (no room for it)
    function buildingsNear(x, y, z, r) {
        const out = new Set();
        for (let ci = Math.floor((x - r) / CELL); ci <= Math.floor((x + r) / CELL); ci++) {
            for (let cj = Math.floor((z - r) / CELL); cj <= Math.floor((z + r) / CELL); cj++) {
                for (const i of grid.get(key(ci, cj)) ?? []) {
                    if (owner[i] >= 0 && !woken.has(owner[i]) && massDist(i, x, y ?? D[i * MASS_FLOATS + 1] + 1, z) <= r) out.add(owner[i]);
                }
            }
        }
        return [...out].sort((a, b) => a - b);
    }

    // ---------------------------------------------------------------------
    // Drawing: a row a body for destruction.bk, its pose from the solver
    // ---------------------------------------------------------------------

    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/city/destruction.bk'), 'utf8');
    // Two nodes over the same rows: the pieces near the eye with each face four quads (a broken face's jag has
    // a middle to move), the rest as plain boxes, a quarter of the triangles, in the camera's view and the sun's.
    // The jag is a field of where a point stood, so a corner is where it is in both.
    // And two of each: the solver's bodies as built (the blocks, the pieces in none) are the first of its
    // rows, and the pieces blocks have given way to come from `units` on, so each pair draws its own as far
    // as they go (the hook's `base`: the body a node's first instance is).
    const UNITS = solver.units, SLACK = 1 << 14;
    // And what they cast is a node of its own for each of the two, drawn in the shadow views alone: a plain
    // box of eight vertices, where the seen ones' faces each have their own four for a flat normal.
    const pieceNode = (name, cut, capacity, casts = false) => scene.createInstancedMesh({
        name, mesh: boxMesh(cut, casts), capacity, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: casts, shadowOnly: casts, receivesShadow: true,
    });
    const node = pieceNode('city_pieces', 2, UNITS), farNode = pieceNode('city_pieces_far', 1, UNITS);
    const brokeNode = pieceNode('city_broken', 2, N - UNITS), brokeFar = pieceNode('city_broken_far', 1, N - UNITS);
    const castNode = pieceNode('city_pieces_cast', 1, UNITS, true), brokeCast = pieceNode('city_broken_cast', 1, N - UNITS, true);
    const nodes = [node, farNode, brokeNode, brokeFar, castNode, brokeCast];
    let near = opts.near ?? NEAR;
    const spheres = (k) => {
        node.setInstanceCullSpheres(sphereBufs[k], { maxDistance: near }); farNode.setInstanceCullSpheres(sphereBufs[k], { minDistance: near });
        brokeNode.setInstanceCullSpheres(brokeSpheres[k], { maxDistance: near }); brokeFar.setInstanceCullSpheres(brokeSpheres[k], { minDistance: near });
        castNode.setInstanceCullSpheres(sphereBufs[k]); brokeCast.setInstanceCullSpheres(brokeSpheres[k]);
    };
    for (const nd of nodes) {
        nd.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
        await nd.setShaderAsync({ module: src, file: 'lib/city/destruction.bk', modules: { facade: facadeSource() },
                                  uniforms: { night: 0, room_day: 60, room_night: 5, debug: 0, blend: 1, base: nd === brokeNode || nd === brokeFar || nd === brokeCast ? UNITS : 0 } });
    }
    // Per body, 3 x vec4 (destruction.bk's `pieces`: a shot's is empty) and solver.bk's k_show row (`bodies`).
    // The rows and the spheres are three of each: the ones drawn from, and one for each of the two steps
    // that may be on their way beside the frames, each showing itself into its own, drawn from once it is
    // done.
    const pieceBuf = bro.kernel.createBuffer(N * 48);
    const bodyBufs = [0, 1, 2].map(() => bro.kernel.createBuffer(N * 80));
    // (A body the solver has not shown yet is out of every view.)
    const nowhere = new Float32Array(Math.max(UNITS, N - UNITS) * 4);
    for (let i = 0; 4 * i < nowhere.length; i++) nowhere[4 * i + 1] = -1e5;
    const there = (count) => bro.kernel.createBuffer(nowhere.subarray(0, 4 * count));
    const sphereBufs = [0, 1, 2].map(() => there(UNITS)), brokeSpheres = [0, 1, 2].map(() => there(N - UNITS));
    let front = 0;
    const closed = opts.interiors?.addWalls ? null : bro.kernel.createBuffer(16);
    for (const nd of nodes) {
        nd.setShaderBuffer('masses', buildings.masses);
        // (Its glass cut where an open building's is: one held open standing.)
        if (closed) nd.setShaderBuffer('open_state', closed);
        else opts.interiors.addWalls(nd);
        nd.setShaderBuffer('pieces', pieceBuf);
        nd.setShaderBuffer('bodies', bodyBufs[0]);
        // The hook places every vertex from the two buffers and `blend` alone: a still caster while none of
        // them is bound again.
        nd.hookStill = true;
        nd.setInstanceCount(0);
    }
    // Each view (the camera's, each level of the sun's shadow) draws the pieces in it: their spheres, from
    // the solver.
    spheres(0);

    const shotNode = scene.createInstancedMesh({
        name: 'city_shots', mesh: boxMesh(1), capacity: MAX_SHOTS, instances: new Float32Array(0),
        color: [0.18, 0.18, 0.2], metallic: 0.8, roughness: 0.35, castsShadow: true, receivesShadow: true,
    });
    shotNode.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    await shotNode.setShaderAsync({ module: SHOT_SRC, file: 'lib/city/destruction.js (shots)', uniforms: { blend: 1 } });
    const shotData = new Float32Array(MAX_SHOTS * 4), shotBuf = bro.kernel.createBuffer(shotData.byteLength);
    shotNode.setShaderBuffer('bodies', bodyBufs[0]);
    shotNode.setShaderBuffer('shots', shotBuf);
    shotNode.setInstanceCount(0);
    const shots = [];   // { body, r, half, p: where it was last heard of }

    // Dust: a lit medium (lib/destruct/dust.js).
    const dust = createDust(scene, { groundAt });
    // Grit: the crumbs and shards the broken pieces shed on their way (lib/destruct/grit.js).
    const grit = await createGrit(scene);
    let gritAt = 0;   // the tick the picture was at when the grit was last moved on

    // ---------------------------------------------------------------------
    // Waking a building: its members into the solver, its masses out of the picture
    // ---------------------------------------------------------------------

    // A standing building's rooms indoors, opened to the daylight as its
    // pieces lose the ground's support, and outdoors for good once it is down.
    const enclosed = new Set();
    const builder = createBuilder(solver);
    let held = 0, sync = false;   // buildings the steps wait for; stepTo's steps build on the thread
    function wake(g, urgent = false) {
        // (Asked for twice, by two shots at once or one heard of twice: woken once.)
        if (woken.has(g)) return;
        const b = blds[g], f = b.first * MASS_FLOATS;
        const F = { x: D[f], y: D[f + 1], z: D[f + 2], yaw: D[f + 3] };
        if (!solver.origin) solver.setOrigin([F.x, groundAt(F.x, F.z), F.z], opts.heights);
        const S = buildingStructure(D, b, groundAt);
        // Each member's centre is in its own mass's frame: where that lies in the building's (its first mass's).
        const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), off = new Map();
        const offset = (i) => {
            let o = off.get(i);
            if (!o) {
                const m = i * MASS_FLOATS, dx = D[m] - F.x, dz = D[m + 2] - F.z;
                if (Math.abs(D[m + 3] - F.yaw) > 1e-4) console.warn(`destruction: building ${g}: mass ${i} is turned from its first: its pieces stand as the first is turned`);
                off.set(i, o = [cy * dx - sy * dz, D[m + 1] - F.y, sy * dx + cy * dz]);
            }
            return o;
        };
        const members = S.members.map((m) => {
            const o = offset(m.frame), area = 4 * m.h[0] * m.h[2], volume = 8 * m.h[0] * m.h[1] * m.h[2];
            return {
                c: [m.c[0] + o[0], m.c[1] + o[1], m.c[2] + o[2]], h: m.h, ground: m.kind === KIND.foundation, sf: MATERIAL[m.mat].sf,
                mass: m.kind === KIND.roof ? ROOF_LOAD * area : MATERIAL[m.mat].rho * volume + (m.kind === KIND.slab ? SLAB_LOAD * area : 0),
            };
        });
        // (Built off the thread, standing whole until it is placed. What a shot is about to reach is `urgent`:
        // the steps wait for it, the frames do not.)
        const W = { firstMember: 0, members: members.length, pieces: 0, urgent };
        woken.set(g, W);
        if (urgent) held++;
        const s = { frame: F, members, joints: S.joints.map((j) => [j.a, j.b]) };
        const placed = (out) => {
            if (W.urgent) held--;
            W.urgent = false;
            if (!out) { woken.set(g, null); console.warn(`destruction: no room for building ${g}: it stays whole`); return; }
            W.firstMember = out.firstMember;
            stand(g, b, S, offset, out, W);
        };
        if (sync) placed(solver.addStructure(s)); else builder.add(s, placed);
    }
    // Building g placed in the solver (`out`): its pieces' rows, and its masses out of the picture.
    function stand(g, b, S, offset, out, W) {
        const rows = new Float32Array(out.count * 12);
        let live = 0;
        // (Its bodies as built: the pieces in no block, and the blocks. A block is drawn, as one box of its
        // member, while it is whole, and its pieces once it has given way: their rows the solver makes from
        // its own (pieceRows). Which is drawn, the solver's spheres say.)
        for (let i = 0; i < out.count; i++) {
            const m = S.members[out.member[i]], o = offset(m.frame), r = i * 12;
            rows[r] = out.c[3 * i] - o[0]; rows[r + 1] = out.c[3 * i + 1] - o[1]; rows[r + 2] = out.c[3 * i + 2] - o[2]; rows[r + 3] = m.frame;
            rows[r + 4] = out.h[3 * i]; rows[r + 5] = out.h[3 * i + 1]; rows[r + 6] = out.h[3 * i + 2]; rows[r + 7] = out.first + i + 1;
            rows[r + 8] = m.kind; rows[r + 9] = m.mat; rows[r + 11] = hash(out.firstMember + out.member[i], 77);
            if (m.kind !== KIND.foundation) live += out.pieces[i];
        }
        W.pieces = live; W.out = out; W.since = now;
        pieceBuf.write(rows, out.first * 48);
        dirty = true;
        // Its masses stop drawing: its pieces draw it now.
        const ids = [];
        for (let k = 0; k < b.count; k++) ids.push(b.first + k);
        buildings.hide(ids);
        // Its rooms stay indoors while it stands, and, if it is open, as
        // they were (rooms and glass) until it breaks.
        if (opts.interiors?.enclose(g)) { enclosed.add(g); opts.interiors.hold?.(g); }
        else opts.interiors?.forget(g);
    }

    // A building woken and left as it was built goes back to standing whole, and its room in the solver to the
    // next: five seconds placed, every piece still joined to the ground and where it stood, no block given way
    // and no weld broken (solver.intact: a body struck that held is as built), no rubble moving over it. One a
    // second is looked at.
    let restored = 0, looked = 0, now = 0;  // (seconds of update()'s clock: the steps stop when all is quiet, this does not)
    function restore() {
        if (now - looked < 1) return;
        looked = now;
        const reach = solver.reach();
        for (const [g, W] of woken) {
            if (!W || !W.out || W.touched) continue;
            if (W.check) {
                if (!W.check.ready) return;
                const changed = W.check.read();
                W.check.release(); W.check = null;
                if (changed > 0 || down(g) > 0) { W.touched = true; continue; }
                const b = blds[g], ids = [];
                for (let k = 0; k < b.count; k++) ids.push(b.first + k);
                solver.remove(W.out);
                pieceBuf.write(new Float32Array(W.out.count * 12), W.out.first * 48);
                dirty = true;
                buildings.show(ids);
                if (enclosed.delete(g)) { opts.interiors.unenclose(g); opts.interiors.release?.(g); }
                woken.delete(g);
                restored++;
                return;
            }
            if (now - W.since < 5) continue;
            if (down(g) > 0) { W.touched = true; continue; }
            const b = blds[g];
            let near = false;
            for (const c of reach) {
                if (c.count < 4) continue;
                for (let k = 0; k < b.count && !near; k++) near = massDist(b.first + k, c.x, D[(b.first + k) * MASS_FLOATS + 1] + 1, c.z) <= REACH_CELL * 1.5;
                if (near) break;
            }
            if (near) { W.since = now - 4; continue; }
            W.check = solver.intact(W.out);
            return;
        }
    }

    // The share of building g's pieces no longer joined to the ground, as the solver last told.
    function down(g) {
        const W = woken.get(g), st = solver.standing();
        if (!W || !st || !W.pieces || st.length < W.firstMember + W.members) return 0;
        let joined = 0;
        for (let m = W.firstMember; m < W.firstMember + W.members; m++) joined += st[m];
        return Math.max(0, 1 - joined / W.pieces);
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

    // (The solver is not touched while a step of it is being taken beside the frames: what would is done once
    // the step is.)
    const later = [];
    function fire(o) {
        if (solver.busy) later.push(() => fireNow(o)); else fireNow(o);
    }
    function fireNow(o) {
        const half = o.shape === 'box' ? o.halfExtents.slice() : new Array(3).fill((o.radius ?? 1) * Math.cbrt(Math.PI / 6));
        const r = Math.hypot(...half), p = o.position, v = o.velocity, speed = Math.hypot(...v);
        // The buildings in its way over the next quarter second wake now (the ones beyond as it nears them).
        const reach = 0.3 * speed, n = Math.max(1, Math.ceil(reach / 4));
        for (let k = 0; k <= n; k++) {
            const t = k / n * 0.3;
            for (const g of buildingsNear(p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t, r + 2)) wake(g, true);
        }
        if (!solver.origin) solver.setOrigin([p[0], groundAt(p[0], p[2]), p[2]], opts.heights);
        const body = solver.fire({ half, mass: o.mass ?? 1000, position: p, velocity: v });
        if (body < 0) { console.warn('destruction: no room for the shot'); return null; }
        shotData.set([half[0], half[1], half[2], body], shots.length * 4);
        shots.push({ body, r, half, p: null });
        shotBuf.write(shotData);
        shotNode.setInstanceCount(shots.length);
        dirty = true;
        return body;
    }

    // The picture: the solver's rows of its last step, drawn from where the step began (blend 0) to where it
    // ended (1) over the time a step takes to come.
    let dirty = false;     // a body put in or taken out since the rows were last written
    // The steps on their way beside the frames, oldest first, two at most: each its job, the rows it shows
    // itself into, the steps it takes and the tick it ends at.
    const flight = [];
    let ahead = 0;         // jobs started behind one still on its way, since the solver was last still
    let blend = 1, since = 0, pace = 1 / 60;   // seconds since the rows drawn from came, and that they are drawn over
    let shownTick = 0, shownSteps = 0;         // the tick the rows drawn from end at, and the steps they span
    let per = 1 / 60;                          // seconds a step takes to come (smoothed)
    function bind() {
        // (Bound again: the still pieces' cached shadows are redrawn. While nothing moves, nothing is bound
        // again, and they are kept.)
        for (const nd of nodes) nd.setShaderBuffer('bodies', bodyBufs[front]);
        spheres(front);
        shotNode.setShaderBuffer('bodies', bodyBufs[front]);
        if (drawn !== solver.count) { drawn = solver.count; node.setInstanceCount(drawn); farNode.setInstanceCount(drawn); castNode.setInstanceCount(drawn); }
        // (The pieces given bodies are known a step or two late: drawn some way past the last heard of, in
        // strides. One not shown yet is out of every view.)
        const b = solver.count ? Math.min(N - UNITS, (Math.floor(solver.pieces / SLACK) + 2) * SLACK) : 0;
        if (b !== broken) { broken = b; brokeNode.setInstanceCount(b); brokeFar.setInstanceCount(b); brokeCast.setInstanceCount(b); }
        if (!full && solver.pieces >= N - UNITS) { full = true; console.warn('destruction: no room for more pieces: the blocks still whole stay whole'); }
    }
    function setBlend(b) {
        if (b === blend) return;
        blend = b;
        for (const nd of nodes) nd.setShaderUniform('blend', b);
        shotNode.setShaderUniform('blend', b);
    }
    /** The jobs found done: the last one's rows are the ones drawn from. */
    function land() {
        let last = null, steps = 0;
        while (flight.length && flight[0].job.done) { last = flight.shift(); steps += last.steps; }
        if (!last) return;
        front = last.rows;
        // (The rows span the steps their job took, and are drawn over the time that many take to come: a job
        // of three after a job of one moves the picture three times as far in three times as long.)
        per = Math.min(0.25, Math.max(1 / 60, 0.5 * per + 0.5 * since / steps));
        pace = Math.min(0.25, per * last.steps);
        shownTick = last.tick; shownSteps = last.steps;
        since = 0;
        bind();
    }
    /** `count` steps started beside the frames, shown into rows neither drawn from nor another job's. */
    function launch(count) {
        const rows = [0, 1, 2].find((k) => k !== front && !flight.some((f) => f.rows === k));
        const job = solver.stepLater(() => { solver.show(bodyBufs[rows], sphereBufs[rows], brokeSpheres[rows]); solver.pieceRows(pieceBuf); }, count);
        flight.push({ job, rows, steps: count, tick: solver.tick });
    }
    /** No step is on its way: what waited for that is done. */
    function free() {
        ahead = 0;
        for (const f of later.splice(0)) f();
    }
    /** The rows written now, into the pair drawn from (no step is being taken). */
    function show() {
        solver.show(bodyBufs[front], sphereBufs[front], brokeSpheres[front]);
        solver.pieceRows(pieceBuf);
        dirty = false;
        bind();
    }
    let full = false;
    let drawn = 0, broken = 0;   // (the node goes over its instances' bounds whenever it is told their count)
    const waking = [];
    let dusted = null, heard = null, heardTick = 0;
    const urgent = [];   // buildings a shot is about to reach, heard of while the solver was not still
    function step(count = 1) {
        for (const g of urgent.splice(0)) wake(g, true);
        for (const g of shotsReach()) wake(g, true);
        reached();
        start(count);
    }
    /** The buildings a shot still flying is about to reach: along its way from where it was last heard of (a
     *  step or two ago) to where it will be a quarter second on. One all but stopped reaches nothing more.
     *  (The solver is not touched.) */
    function shotsReach() {
        const out = [];
        const at = solver.shots();
        if (at !== heard) {
            for (const s of at) {
                const S = shots.find((x) => x.body === s.body);
                if (!S) continue;
                const steps = Math.max(1, solver.tick - heardTick), was = S.p;
                S.p = s.p;
                if (!was) continue;
                const v = [0, 1, 2].map((k) => (s.p[k] - was[k]) * 60 / steps), speed = Math.hypot(...v);
                if (speed < 2) continue;
                const T = 0.25 + 3 / 60, n = Math.max(1, Math.ceil(speed * T / 4));
                for (let k = 0; k <= n; k++) {
                    const t = k / n * T;
                    for (const g of buildingsNear(s.p[0] + v[0] * t, s.p[1] + v[1] * t, s.p[2] + v[2] * t, S.r + 2)) out.push(g);
                }
            }
            heard = at; heardTick = solver.tick;
        }
        return out;
    }
    /** What the solver last heard of where its pieces are (it is not touched): buildings to wake, and dust. */
    function reached() {
        // What the pieces themselves come down on or are thrown at wakes: one building a step (waking one is
        // the work of a frame or more).
        // (A dozen pieces over a square of the plan: one flung brick is not what brings the next building down.)
        const reach = solver.reach();
        if (!waking.length) {
            const seen = new Set();
            for (const c of reach) {
                if (c.count < 12) continue;
                for (const g of buildingsNear(c.x, null, c.z, REACH_CELL * 0.75)) { if (!seen.has(g) && !woken.has(g)) { seen.add(g); waking.push(g); } }
            }
        }
        // Dust where the pieces are on the move, by how many: off a tower all the way down, and thickest where
        // it lands.
        if (reach !== dusted) {
            dusted = reach;
            let sx = 0, sz = 0, sn = 0;
            for (const c of reach) { if (c.count >= 4) { dust.add({ p: [c.x, c.y, c.z], r: 3, n: c.count * 0.03, v: [0, 0.5, 0] }); sx += c.x * c.count; sz += c.z * c.count; sn += c.count; } }
            // Where they come down in number the air under them has nowhere to go but out: dust driven along the
            // ground, away from the middle of what is falling, down the streets.
            for (const c of reach) {
                if (c.count < SURGE_COUNT) continue;
                const g = groundAt(c.x, c.z);
                if (c.y - g > SURGE_HEIGHT) continue;
                let dx = c.x - sx / sn, dz = c.z - sz / sn;
                const d = Math.hypot(dx, dz);
                if (d < 1) { const a = Math.random() * 6.283; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
                dust.add({ p: [c.x + dx * 4, g + 2.5, c.z + dz * 4], r: 4, n: c.count * 0.02, v: [dx * SURGE_SPEED, 0, dz * SURGE_SPEED] });
            }
        }
    }
    function start(count) {
        if (waking.length) { const g = waking.shift(); if (!woken.has(g)) wake(g); }
        if (sync) { now += 1 / 60; restore(); dust.update(1 / 60); }
        // (A frame's step is taken beside the frames, and shows itself into rows not drawn from.)
        if (sync) solver.step();
        else { launch(count); dirty = false; }
        // (A shot come to rest has left the solver: it stops drawing.)
        const live = solver.shotBodies();
        if (live.length !== shots.length) {
            for (let k = shots.length - 1; k >= 0; k--) { if (!live.includes(shots[k].body)) shots.splice(k, 1); }
            shots.forEach((s, k) => shotData.set([s.half[0], s.half[1], s.half[2], s.body], k * 4));
            shotBuf.write(shotData);
            shotNode.setInstanceCount(shots.length);
        }
        if (sync) show();
    }

    let clock = 0;   // in steps (60 Hz)
    return {
        solver, node, dust, grit,
        /** Fire a shot ({ shape: 'sphere', radius } or { shape: 'box', halfExtents }, mass, position,
         *  velocity). It is in the world once the step being taken is done. */
        fire,
        /** Advance the clock dt seconds and take the step due. */
        update(dt) {
            checkEnclosed(dt);
            dust.update(dt);
            // (The grit by the picture's clock, not the frames': it keeps to the pieces that shed it.)
            const pic = shownTick - (1 - blend) * shownSteps;
            if (solver.count) {
                grit.update({ rows: bodyBufs[front], built: sphereBufs[front], pieces: brokeSpheres[front], na: drawn, nb: broken, units: UNITS,
                              dt: Math.max(0, pic - gritAt) / 60, blend, span: Math.max(shownSteps, 1) / 60, ground: solver.ground, eye: opts.eye?.() });
            }
            gritAt = pic;
            now += dt;
            since += dt;
            clock += Math.min(dt, 0.25) * 60;
            land();
            // A step still on its way: the picture goes on toward the last one's end, and the next step due
            // is started behind it (jobs are taken in order), so the steps come as fast as the GPU takes
            // them, however they fall among the frames. Not while anything waits for the solver to be still
            // (a shot to fire, a building to place, rows to write again), and after half a second's
            // worth it is let come still: what looks for work then (restore) gets its turn.
            if (flight.length) {
                // (A building still being built holds nothing up: the next is sent for, and the steps go on
                // until one is back to place.)
                if (!builder.ready) builder.update();
                if (flight.length < 2 && ahead < 30 && !held && !later.length && !dirty && !builder.ready && !urgent.length) {
                    for (const g of shotsReach()) { if (!woken.has(g)) urgent.push(g); }
                    reached();
                    // (A building the pieces have reached is sent to be built now: that touches nothing of
                    // the solver's, and the steps go on until it is back to place.)
                    if (waking.length) wake(waking.shift());
                    if (!urgent.length && clock >= solver.tick + 1) { launch(1); ahead++; clock = Math.min(clock, solver.tick + 1); }
                }
                setBlend(Math.min(1, since / pace));
                return;
            }
            free();
            builder.update();
            if (!solver.count) return;
            restore();
            // A step when one is due: not while a building a shot is about to reach is still being built (the world
            // waits for it), nor with nothing awake and nothing new (it would change nothing). Taken beside the
            // frames a step can outlast one, so what is started is the steps due, three at most, shown as one
            // (the picture runs from the last showing to this one): the world keeps time while the GPU can take
            // a step in a sixtieth of a second, however the steps fall among the frames. Behind by more than
            // that, the time is dropped.
            // (What has just been put in or taken out is in the picture before the step that moves it.)
            if (dirty) show();
            if (held || solver.quiet) clock = solver.tick;
            else if (clock >= solver.tick + 1) { step(Math.min(3, Math.floor(clock - solver.tick))); clock = Math.min(clock, solver.tick + 1); }
            setBlend(Math.min(1, since / pace));
        },
        setNight(n, dayK = 60, nightK = 5) {
            for (const nd of nodes) { nd.setShaderUniform('night', n); nd.setShaderUniform('room_day', dayK); nd.setShaderUniform('room_night', nightK); }
            // The city's lights on its dust: sodium and window light.
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() { return { bodies: solver.count, welds: solver.welds, members: solver.members, groups: woken.size, restored, building: builder.pending }; },
        /** Take every step to `tick` now, however many (tests). */
        stepTo(tick) {
            solver.finish();
            land();
            free();
            sync = true;
            builder.flush();
            while (solver.tick < tick && solver.count) step();
            sync = false;
            since = pace; setBlend(1);
            clock = Math.max(clock, solver.tick);
        },
        /** The step last taken. */
        get tick() { return solver.tick; },
        /** How far from the eye (m) the pieces are drawn with their faces cut finer. */
        get near() { return near; },
        set near(v) { near = v; spheres(front); },
        /** The tick the picture is at: between the last two showings by the blend (a fraction). */
        get pictured() { return shownTick - (1 - blend) * shownSteps; },
        /** The building (index into city.masses.buildings) mass i belongs to. */
        buildingOf: (i) => owner[i],
        /** The buildings in the solver: [{ building, first, count, touched, down }] (its bodies' place there,
         *  whether anything of it was ever let go, the share of it no longer joined to the ground). */
        groups() {
            const out = [];
            for (const [g, W] of woken) if (W && W.out) out.push({ building: g, first: W.out.first, count: W.out.count, touched: !!W.touched, down: down(g) });
            return out;
        },
        /** The share of building g's pieces off the ground's support (0 while it is whole). */
        down,
    };
}
