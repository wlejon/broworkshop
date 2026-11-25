// lib/city/destruction.js — a city's buildings made breakable: each one a
// shot comes near is turned into its members (structure.js), cut into welded
// pieces and stood in lib/destruct's solver, a rigid-body world stepped on the
// GPU. The pieces are drawn by destruction.bk straight from the solver's
// buffers: nothing of a step comes back to the page but what it asks about.
//
// createCityDestruction(scene, city, buildings, opts) -> {
//   fire({ shape, radius, halfExtents, mass, position, velocity }),
//   update(dt), setNight(n), stats, tick, stepTo(tick), buildingOf(i), down(g), solver, node, dust }
// `buildings` is building_render's (its masses stop drawing as they wake);
// opts.interiors keeps a woken building's rooms as they were until it breaks
// (cutting its pieces' glass as the walls' is cut), then indoors until it is
// down; opts.src the pieces' shader source.
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

function hash(a, b = 0) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

function boxMesh(N) {
    // A unit box, N x N quads a face, 4 normals per corner so faces stay flat
    // (the vertex stage displaces the broken ones).
    const P = [], Nn = [], I = [];
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
    return new bro.mesh.Mesh({ positions: new Float32Array(P), normals: new Float32Array(Nn), indices: new Uint32Array(I) });
}

// A shot: a box, sized and placed from its body's row (solver.bk's k_show).
const SHOT_SRC = `
module hook;
import mesh;

// Per body, 3 x vec4: (where it stood, 0), (where it is, 0), its turn since.
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
    let q = bodies[bi * 3 + 2];
    v.pos = qrot(q, v.pos * 2.0 * s.xyz) + bodies[bi * 3 + 1].xyz;
    v.normal = qrot(q, v.normal);
    return v;
}
`;

export async function createCityDestruction(scene, city, buildings, opts = {}) {
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
    const node = scene.createInstancedMesh({
        name: 'city_pieces', mesh: boxMesh(2), capacity: N, instances: new Float32Array(0),
        color: [1, 1, 1], castsShadow: true, receivesShadow: true,
    });
    node.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    await node.setShaderAsync({ module: src, file: 'lib/city/destruction.bk', modules: { facade: facadeSource() }, uniforms: { night: 0, room_day: 60, room_night: 5 } });
    // Per body, 3 x vec4 (destruction.bk's `pieces`: a shot's is empty) and solver.bk's k_show row (`bodies`).
    const pieceBuf = bro.kernel.createBuffer(N * 48);
    const bodyBuf = bro.kernel.createBuffer(N * 48);
    node.setShaderBuffer('masses', buildings.masses);
    // (Its glass cut where an open building's is: one held open standing.)
    if (opts.interiors?.addWalls) opts.interiors.addWalls(node);
    else node.setShaderBuffer('open_state', bro.kernel.createBuffer(16));
    node.setShaderBuffer('pieces', pieceBuf);
    node.setShaderBuffer('bodies', bodyBuf);
    // Each view (the camera's, each level of the sun's shadow) draws the pieces in it: their spheres, from
    // the solver.
    const sphereBuf = bro.kernel.createBuffer(N * 16);
    node.setInstanceCullSpheres(sphereBuf);
    node.setInstanceCount(0);

    const shotNode = scene.createInstancedMesh({
        name: 'city_shots', mesh: boxMesh(1), capacity: MAX_SHOTS, instances: new Float32Array(0),
        color: [0.18, 0.18, 0.2], metallic: 0.8, roughness: 0.35, castsShadow: true, receivesShadow: true,
    });
    shotNode.setCullBounds([-20000, -1000, -20000], [20000, 2000, 20000]);
    await shotNode.setShaderAsync({ module: SHOT_SRC, file: 'lib/city/destruction.js (shots)' });
    const shotData = new Float32Array(MAX_SHOTS * 4), shotBuf = bro.kernel.createBuffer(shotData.byteLength);
    shotNode.setShaderBuffer('bodies', bodyBuf);
    shotNode.setShaderBuffer('shots', shotBuf);
    shotNode.setInstanceCount(0);
    const shots = [];   // { body, r, half, p: where it was last heard of }

    // Dust: a lit medium (lib/destruct/dust.js).
    const dust = createDust(scene, { groundAt });

    // ---------------------------------------------------------------------
    // Waking a building: its members into the solver, its masses out of the picture
    // ---------------------------------------------------------------------

    // A standing building's rooms indoors, opened to the daylight as its
    // pieces lose the ground's support, and outdoors for good once it is down.
    const enclosed = new Set();
    const builder = createBuilder(solver);
    let held = 0, sync = false;   // buildings the steps wait for; stepTo's steps build on the thread
    function wake(g, urgent = false) {
        const b = blds[g], f = b.first * MASS_FLOATS;
        const F = { x: D[f], y: D[f + 1], z: D[f + 2], yaw: D[f + 3] };
        if (!solver.origin) solver.setOrigin([F.x, groundAt(F.x, F.z), F.z], groundAt);
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
        for (let i = 0; i < out.count; i++) {
            const m = S.members[out.member[i]], o = offset(m.frame), r = i * 12;
            rows[r] = out.c[3 * i] - o[0]; rows[r + 1] = out.c[3 * i + 1] - o[1]; rows[r + 2] = out.c[3 * i + 2] - o[2]; rows[r + 3] = m.frame;
            rows[r + 4] = out.h[3 * i]; rows[r + 5] = out.h[3 * i + 1]; rows[r + 6] = out.h[3 * i + 2]; rows[r + 7] = out.first + i + 1;
            rows[r + 8] = m.kind; rows[r + 9] = m.mat; rows[r + 11] = hash(out.firstMember + out.member[i], 77);
            if (m.kind !== KIND.foundation) live++;
        }
        W.pieces = live; W.out = out; W.since = now;
        pieceBuf.write(rows, out.first * 48);
        // Its masses stop drawing: its pieces draw it now.
        const ids = [];
        for (let k = 0; k < b.count; k++) ids.push(b.first + k);
        buildings.hide(ids);
        // Its rooms stay indoors while it stands, and, if it is open, as
        // they were (rooms and glass) until it breaks.
        if (opts.interiors?.enclose(g)) { enclosed.add(g); opts.interiors.hold?.(g); }
        else opts.interiors?.forget(g);
    }

    // A building woken and never touched goes back to standing whole, and its room in the solver to the next:
    // five seconds placed, every piece still joined to the ground, none ever let go (the solver's WHY, read
    // back), no rubble moving over it. One a second is looked at.
    let restored = 0, looked = 0, now = 0;  // (seconds of update()'s clock: the steps stop when all is quiet, this does not)
    function restore() {
        if (now - looked < 1) return;
        looked = now;
        const reach = solver.reach();
        for (const [g, W] of woken) {
            if (!W || !W.out || W.touched) continue;
            if (W.check) {
                if (!W.check.ready) return;
                const why = W.check.read(new Int32Array(W.out.count));
                W.check.release(); W.check = null;
                if (why.some((v) => v !== 0) || down(g) > 0) { W.touched = true; continue; }
                const b = blds[g], ids = [];
                for (let k = 0; k < b.count; k++) ids.push(b.first + k);
                solver.remove(W.out);
                pieceBuf.write(new Float32Array(W.out.count * 12), W.out.first * 48);
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
            W.check = solver.buffers.WHY.readLater(4 * W.out.first, 4 * W.out.count);
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

    function fire(o) {
        const half = o.shape === 'box' ? o.halfExtents.slice() : new Array(3).fill((o.radius ?? 1) * Math.cbrt(Math.PI / 6));
        const r = Math.hypot(...half), p = o.position, v = o.velocity, speed = Math.hypot(...v);
        // The buildings in its way over the next quarter second wake now (the ones beyond as it nears them).
        const reach = 0.3 * speed, n = Math.max(1, Math.ceil(reach / 4));
        for (let k = 0; k <= n; k++) {
            const t = k / n * 0.3;
            for (const g of buildingsNear(p[0] + v[0] * t, p[1] + v[1] * t, p[2] + v[2] * t, r + 2)) wake(g, true);
        }
        if (!solver.origin) solver.setOrigin([p[0], groundAt(p[0], p[2]), p[2]], groundAt);
        const body = solver.fire({ half, mass: o.mass ?? 1000, position: p, velocity: v });
        if (body < 0) { console.warn('destruction: no room for the shot'); return null; }
        shotData.set([half[0], half[1], half[2], body], shots.length * 4);
        shots.push({ body, r, half, p: null });
        shotBuf.write(shotData);
        shotNode.setInstanceCount(shots.length);
        show();
        return body;
    }

    function show() {
        solver.show(bodyBuf);
        solver.spheres(sphereBuf);
        solver.broken(pieceBuf, 12, 10);
        // (Only when it has changed: the node goes over its instances' bounds at every call.)
        if (drawn !== solver.count) node.setInstanceCount(drawn = solver.count);
    }
    let drawn = 0;
    const waking = [];
    let dusted = null, heard = null, heardTick = 0;
    function step() {
        // What a shot still flying is about to reach wakes: along its way from where it was last heard of (a
        // step or two ago) to where it will be a quarter second on. One all but stopped wakes nothing more.
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
                    for (const g of buildingsNear(s.p[0] + v[0] * t, s.p[1] + v[1] * t, s.p[2] + v[2] * t, S.r + 2)) wake(g, true);
                }
            }
            heard = at; heardTick = solver.tick;
        }
        // And what the pieces themselves come down on or are thrown at: one building a step (waking one is the
        // work of a frame or more).
        // (A dozen pieces over a square of the plan: one flung brick is not what brings the next building down.)
        const reach = solver.reach();
        if (!waking.length) {
            const seen = new Set();
            for (const c of reach) {
                if (c.count < 12) continue;
                for (const g of buildingsNear(c.x, null, c.z, REACH_CELL * 0.75)) { if (!seen.has(g)) { seen.add(g); waking.push(g); } }
            }
        }
        // Dust where the pieces are on the move, by how many: off a tower all the way down, and thickest where
        // it lands.
        if (reach !== dusted) {
            dusted = reach;
            for (const c of reach) { if (c.count >= 4) dust.add({ p: [c.x, c.y, c.z], r: 3, n: c.count * 0.03, v: [0, 0.5, 0] }); }
        }
        if (waking.length) { const g = waking.shift(); if (!woken.has(g)) wake(g); }
        if (sync) { now += 1 / 60; restore(); }
        solver.step();
        // (A shot come to rest has left the solver: it stops drawing.)
        const live = solver.shotBodies();
        if (live.length !== shots.length) {
            for (let k = shots.length - 1; k >= 0; k--) { if (!live.includes(shots[k].body)) shots.splice(k, 1); }
            shots.forEach((s, k) => shotData.set([s.half[0], s.half[1], s.half[2], s.body], k * 4));
            shotBuf.write(shotData);
            shotNode.setInstanceCount(shots.length);
        }
        show();
    }

    let clock = 0;   // in steps (60 Hz)
    return {
        solver, node, dust,
        /** Fire a shot ({ shape: 'sphere', radius } or { shape: 'box', halfExtents }, mass, position,
         *  velocity): its body in the solver, or null (no room). */
        fire,
        /** Advance the clock dt seconds and take the step due. */
        update(dt) {
            checkEnclosed(dt);
            dust.update(dt);
            builder.update();
            if (!solver.count) return;
            now += dt;
            restore();
            // (A building a shot is about to reach is still being built: the world waits for it.)
            if (held) { clock = solver.tick; return; }
            clock += Math.min(dt, 0.25) * 60;
            // (Nothing awake and nothing new: a step would change nothing.)
            if (solver.quiet) { clock = solver.tick; return; }
            if (clock < solver.tick + 1) return;
            step();
            // (Behind by more than the step taken: that time is dropped.)
            clock = Math.min(clock, solver.tick + 1);
        },
        setNight(n, dayK = 60, nightK = 5) {
            node.setShaderUniform('night', n); node.setShaderUniform('room_day', dayK); node.setShaderUniform('room_night', nightK);
            // The city's lights on its dust: sodium and window light.
            const g = n * 2.4;
            dust.setGlow([g, g * 0.78, g * 0.5]);
        },
        get stats() { return { bodies: solver.count, welds: solver.welds, members: solver.members, groups: woken.size, restored, building: builder.pending }; },
        /** Take every step to `tick` now, however many (tests). */
        stepTo(tick) {
            sync = true;
            builder.flush();
            while (solver.tick < tick && solver.count) step();
            sync = false;
            clock = Math.max(clock, solver.tick);
        },
        /** The step last taken. */
        get tick() { return solver.tick; },
        /** The building (index into city.masses.buildings) mass i belongs to. */
        buildingOf: (i) => owner[i],
        /** The share of building g's pieces off the ground's support (0 while it is whole). */
        down,
    };
}
