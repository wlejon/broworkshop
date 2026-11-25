// lib/destruct/destruct.js — structures that stand by their loads and break by
// force: impacts crush and shatter members, what loses its support falls, and
// what falls lands, breaks up and crushes what it lands on.
//
// createDestruction(source, opts) -> sim
//
// A structure is members (boxes in a frame: an origin and a yaw) joined by
// joints that say what rests on what (V: `b` stands on `a`) and what is tied
// to what beside it (H, with the lever `span` a load hung from it has). The
// source gives them a group (a building) at a time, when something first
// touches the group's intact solids:
//   source.frame(i)              -> { x, y, z, yaw }
//   source.structure(group)      -> { members: [{ frame, c, h, kind, mat, anchor? }], joints: [{ a, b, type, span }] }
//   source.groupsNear(x, y, z, r) -> the intact groups whose solids a sphere touches
//   source.solidsNear(x, z, r)   -> [{ key, group, c, h, yaw }]: intact solids to collide with
//   source.groundAt(x, z)        -> the ground's height
//   source.onActivate(group)     -> the group is members now (stop drawing it whole)
//
// Standing members stay put, each a static body, and carry their loads down
// to the anchors (the foundations): a load goes the cheapest way down (down a
// column or wall cheapest, across a floor dearer, hung from above dearest),
// shared among the near-cheapest supports, and a floor carrying a load
// across takes its moment. Every joint is sized when its group is first
// touched, to what it carries then times its material's safety factor (and
// at least to hold its own member out as a cantilever), so an intact
// building stands, and one that loses a column, a corner or a floor puts
// loads on joints that were never meant for them. An overloaded joint gives
// after a moment that is shorter the more it is overloaded (at 1.6 times its
// capacity, at once); a column or wall that gives under compression is
// crushed. What no longer reaches an anchor falls: each connected piece of it
// one rigid body (a cluster), its joints kept, which hits, cracks, shatters
// and crushes by the energy of its impacts. A cluster at rest bears down on
// what it touches below it (the ground, rubble, standing members), and its
// weight goes on down through the rubble to the ground and the members: a
// load on a standing member like its own, so the upper storeys that fell
// loose onto their stubs, directly or through the rubble between, load those
// stubs as before, and the stubs give when they would have.
//
// Projectiles are spheres or boxes of a mass and velocity, swept through the
// structure each step: a member whose fracture energy the projectile has
// breaks into chunks flying on with it, the projectile keeps what energy is
// left; one it has not stops it (cracked), and it falls as a body.
//
// Everything is stepped at a fixed 60 Hz, in id order, on a physics world of
// its own (stepped only here), contacts taken in an order of their own, so
// two runs given the same impacts at the same steps are the same: peers in
// lockstep send shots, not pieces. A shot stamped `tick` (and `key`) launches
// at the start of that step on every peer; `stepTo(tick)` catches a peer up;
// `hash()` is the state for peers to compare.
//
// Rubble at rest leaves the simulation (drawn where it lies, no longer a
// body), and a chunk that breaks again breaks into fewer, larger pieces, its
// small ones to dust: what a building comes down into stays bounded.

// (A roof is a pitched roof's box, its top the roof's slope where it is
// drawn: a framed shell of tiles, weighed by its plan, ROOF_LOAD a m^2.)
export const KIND = { foundation: 0, slab: 1, column: 2, wall: 3, roof: 4 };
export const MAT = { concrete: 0, masonry: 1, glass: 2, steel: 3, timber: 4 };
export const JOINT = { V: 0, H: 1 };

// rho: kg per m^3 of the member as built; G: J per m^3 to break it apart;
// sf: the safety factor it was designed to.
const MATERIAL = [
    { rho: 2400, G: 1.5e5, sf: 2.0, friction: 0.85, restitution: 0.04, dust: [0.56, 0.54, 0.50] },   // concrete
    { rho: 1900, G: 6.0e4, sf: 2.5, friction: 0.85, restitution: 0.04, dust: [0.58, 0.46, 0.38] },   // masonry
    { rho: 450, G: 1.5e4, sf: 2.0, friction: 0.5, restitution: 0.1, dust: [0.60, 0.62, 0.62] },      // curtain wall
    { rho: 650, G: 4.0e5, sf: 2.0, friction: 0.6, restitution: 0.15, dust: [0.45, 0.45, 0.44] },     // steel frame + cladding
    { rho: 550, G: 5.0e4, sf: 2.0, friction: 0.8, restitution: 0.05, dust: [0.52, 0.44, 0.34] },     // timber
];
// A member in compression (a V joint: a column or wall bearing what stands on
// it) is designed to a lower strength reduction than one in bending (0.65
// against 0.9), so it holds this much more over what it carries.
const BEARING = 0.9 / 0.65;
const SLAB_LOAD = 300;          // kg/m^2 a floor carries besides itself (finishes, partitions, furniture, people)
const KIND_TOUGH = [8, 1, 3, 1, 0.5];   // a foundation, slab, column (its cage of rebar), wall, roof: G's multiple
const ROOF_LOAD = 120;   // kg per m^2 of plan: rafters, battens, tiles
const STEP = 1 / 60;
const G_ACC = 9.81;
const CHUNK_MIN = 0.35;         // a chunk smaller than this is debris particles, not a body
const QUIET_E = 2e3;            // J: impacts below this break nothing
const REST_SPEED = 0.12;        // m/s: slower than this is lying still
const STRUCT_TICKS = 3;     // a building's loads follow a loss this often at most (20 Hz)
const LOAD_TICKS = 6;           // and what lies on it this often (10 Hz)
const WAKE_SPEED = 0.5;     // m/s: faster than this, a piece wakes the settled pieces it reaches
const REST_S = 2;               // s still before a small piece leaves the simulation
const FREEZE_SIZE = 1.2;        // m: a piece this long or less is small
const FREEZE_MASS = 3000;       // kg: or this light
const PRESSURE = 0.8;           // of maxBodies: past it, settled pieces up to PRESSURE_SIZE go too
const PRESSURE_SIZE = 0.8;      // (grit: too small to hold anything up)

// Integer hash of up to two integers to [0, 1).
function hash(a, b = 0) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

// Quaternions [x, y, z, w].
const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function qrot(q, v) {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [v[0] + q[3] * tx + (q[1] * tz - q[2] * ty), v[1] + q[3] * ty + (q[2] * tx - q[0] * tz), v[2] + q[3] * tz + (q[0] * ty - q[1] * tx)];
}
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const yawQ = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

export function createDestruction(source, opts = {}) {
    const maxBodies = opts.maxBodies ?? 60000;
    const world = Physics.createWorldHandle({ maxBodies, contactBufferSize: 65536 });
    const within = (fn) => { world.enter(); try { return fn(); } finally { world.exit(); } };
    within(() => Physics.setGravity(0, -G_ACC, 0));

    const members = [];      // every member and chunk there has been (dead ones stay, alive false)
    const joints = [];
    const clusters = [];     // every body of members there has been
    const owner = new Map(); // body tag -> { t: 'm' (standing member) | 'c' (cluster) | 'g' (ground) | 's' (intact solid) | 'p' (projectile), i }
    const groups = new Map();
    const solids = new Map();    // intact solid key -> { tag, group }
    const tiles = new Map();     // ground tile key -> tag
    const projectiles = [];
    const events = [];           // { type: 'dust' | 'glass' | 'spall' | 'crack', p, r, n, v, color }
    const changed = new Set();   // members whose drawn record changed
    const frames = new Map();
    let time = 0, acc = 0, ticks = 0;
    const stats = { activations: 0, failures: 0, shatters: 0, clusters: 0, bodies: 0, frozen: 0, thawed: 0, thawBy: {}, dropped: 0, contactOverflows: 0, contactEvents: 0, lateShots: 0, resolves: 0, solveMs: 0, physMs: 0 };

    const frameOf = (i) => { let f = frames.get(i); if (!f) { f = source.frame(i); f.q = yawQ(f.yaw); frames.set(i, f); } return f; };
    // A point of member m's frame, at rest, in the world.
    function restWorld(m, p = m.c) {
        const F = frameOf(m.frame), c = Math.cos(F.yaw), s = Math.sin(F.yaw);
        return [F.x + c * p[0] + s * p[2], F.y + p[1], F.z - s * p[0] + c * p[2]];
    }
    const volume = (m) => 8 * m.h[0] * m.h[1] * m.h[2];
    const fracture = (m) => MATERIAL[m.mat].G * volume(m) * KIND_TOUGH[m.kind] * Math.max(0.05, 1 - m.damage);

    function addMember(spec, group) {
        const m = {
            id: members.length, frame: spec.frame, c: spec.c.slice(), h: spec.h.slice(), kind: spec.kind, mat: spec.mat,
            group, anchor: !!spec.anchor, alive: true, cluster: -1, body: -1, joints: [], rough: spec.rough ?? 0,
            damage: 0, seed: hash(members.length, 77), moved: false, mass: 0,
        };
        const area = 4 * m.h[0] * m.h[2];
        m.mass = m.kind === KIND.roof ? ROOF_LOAD * area : MATERIAL[m.mat].rho * volume(m) + (m.kind === KIND.slab ? SLAB_LOAD * area : 0);
        members.push(m);
        changed.add(m.id);
        return m;
    }

    // ---------------------------------------------------------------------
    // Bodies
    // ---------------------------------------------------------------------

    function staticBody(m) {
        const p = restWorld(m), q = frameOf(m.frame).q, M = MATERIAL[m.mat];
        const tag = Physics.createBody({
            shape: 'box', static: true, halfExtents: { x: m.h[0], y: m.h[1], z: m.h[2] },
            position: { x: p[0], y: p[1], z: p[2] }, rotation: { x: q[0], y: q[1], z: q[2], w: q[3] },
            friction: M.friction, restitution: M.restitution,
        });
        owner.set(tag, { t: 'm', i: m.id });
        m.body = tag;
    }
    function dropBody(tag) {
        if (tag < 0) return;
        untouch(tag);
        Physics.destroyBody(tag);
        owner.delete(tag);
    }

    // Ground under the members: heightfield tiles 254 m on a side.
    const TILE_N = 128, TILE_D = 2, TILE = (TILE_N - 1) * TILE_D;
    function ensureGround(x, z, r) {
        for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) {
            for (let tz = Math.floor((z - r) / TILE); tz <= Math.floor((z + r) / TILE); tz++) {
                const key = tx + ',' + tz;
                if (tiles.has(key)) continue;
                const heights = new Float32Array(TILE_N * TILE_N);
                for (let j = 0; j < TILE_N; j++) for (let i = 0; i < TILE_N; i++) {
                    heights[j * TILE_N + i] = source.groundAt(tx * TILE + i * TILE_D, tz * TILE + j * TILE_D);
                }
                const tag = within(() => Physics.createBody({
                    shape: 'heightfield', heights, sampleCount: TILE_N, scale: { x: TILE_D, y: 1, z: TILE_D },
                    position: { x: tx * TILE, y: 0, z: tz * TILE }, friction: 0.9, restitution: 0.02,
                }));
                tiles.set(key, tag);
                owner.set(tag, { t: 'g', i: 0 });
            }
        }
    }
    // The intact solids about a point, to collide with.
    function ensureSolids(x, z, r) {
        for (const s of source.solidsNear(x, z, r)) {
            if (solids.has(s.key) || groups.has(s.group)) continue;
            const q = yawQ(s.yaw);
            const tag = within(() => Physics.createBody({
                shape: 'box', static: true, halfExtents: { x: s.h[0], y: s.h[1], z: s.h[2] },
                position: { x: s.c[0], y: s.c[1], z: s.c[2] }, rotation: { x: q[0], y: q[1], z: q[2], w: q[3] }, friction: 0.8,
            }));
            solids.set(s.key, { tag, group: s.group });
            owner.set(tag, { t: 's', i: s.group });
        }
    }

    // ---------------------------------------------------------------------
    // Groups: a structure woken up
    // ---------------------------------------------------------------------

    function activate(g) {
        let G = groups.get(g);
        if (G) return G;
        const S = source.structure(g);
        G = { id: g, members: [], joints: [], dirty: true, loadDirty: false, solvedAt: -Infinity };
        groups.set(g, G);
        stats.activations++;
        const base = members.length;
        for (const sm of S.members) G.members.push(addMember(sm, g).id);
        for (const sj of S.joints) {
            const j = { id: joints.length, a: base + sj.a, b: base + sj.b, type: sj.type, span: sj.span ?? 0,
                        capW: Infinity, capM: Infinity, W: 0, M: 0, broken: false, failAt: Infinity, ratio: 0,
                        axis: -1, area: 1, sign: 1, p: null };
            jointGeometry(j);
            joints.push(j);
            G.joints.push(j.id);
            members[j.a].joints.push(j.id);
            members[j.b].joints.push(j.id);
        }
        // Its solids give way to its members.
        for (const [key, s] of solids) if (s.group === g) { within(() => dropBody(s.tag)); solids.delete(key); }
        source.onActivate(g);
        within(() => { for (const i of G.members) staticBody(members[i]); });
        // Sized to what it carries now.
        const t0 = performance.now();
        flow(G);
        for (const ji of G.joints) {
            const j = joints[ji], a = members[j.a], b = members[j.b];
            const M = MATERIAL[Math.min(a.mat, b.mat) === MAT.glass ? MAT.glass : b.mat];
            const jit = 0.85 + 0.3 * hash(j.id, 3);
            const own = Math.min(a.mass, b.mass) * G_ACC;
            if (j.type === JOINT.V) {
                j.capW = Math.max(j.W, b.mass * G_ACC) * M.sf * BEARING * jit;
            } else {
                j.capW = Math.max(j.W * M.sf, 2 * own) * jit;
                j.capM = Math.max(j.M * M.sf, 0.65 * own * Math.max(j.span, 0.5)) * jit;
            }
        }
        stats.solveMs += performance.now() - t0;
        // (Resolved on the next step: anything that reaches no anchor falls.)
        G.dirty = true;
        const c = restWorld(members[G.members[0]]);
        ensureGround(c[0], c[2], 200);
        ensureSolids(c[0], c[2], 160);
        return G;
    }

    // Where a joint is (its members' common face, at rest) and how big that face is.
    function jointGeometry(j) {
        const a = members[j.a], b = members[j.b];
        j.axis = -1; j.area = 1;
        const pa = restWorld(a), pb = restWorld(b);
        j.p = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        if (a.frame !== b.frame) return;
        // The axis the boxes touch along: where the gap between centres is the sum of the extents.
        let best = Infinity;
        for (let k = 0; k < 3; k++) {
            const gap = Math.abs(Math.abs(b.c[k] - a.c[k]) - (a.h[k] + b.h[k]));
            if (gap < best) { best = gap; j.axis = k; }
        }
        const k1 = (j.axis + 1) % 3, k2 = (j.axis + 2) % 3;
        j.area = 4 * Math.min(a.h[k1], b.h[k1]) * Math.min(a.h[k2], b.h[k2]);
        j.sign = Math.sign(b.c[j.axis] - a.c[j.axis]) || 1;
    }
    // A joint broken: the faces it held become broken faces (rough on the GPU).
    function roughen(j) {
        if (j.axis < 0) return;
        const a = members[j.a], b = members[j.b];
        // A face breaks where the joint was most of it: a wall torn from the
        // next, a column's end; a slab lifting off a column keeps its soffit,
        // the break a patch the face's draw does not show.
        const face = (m) => { const u = (j.axis + 1) % 3, v = (j.axis + 2) % 3; return 4 * m.h[u] * m.h[v]; };
        // bits: 2 * axis + (1 for the + face)
        if (j.area >= 0.4 * face(a)) a.rough |= 1 << (2 * j.axis + (j.sign > 0 ? 1 : 0));
        if (j.area >= 0.4 * face(b)) b.rough |= 1 << (2 * j.axis + (j.sign > 0 ? 0 : 1));
        changed.add(a.id); changed.add(b.id);
    }

    const standing = (m) => m.alive && m.cluster < 0;
    const intact = (j) => !j.broken && standing(members[j.a]) && standing(members[j.b]);
    // The cost of member `from` handing its load to `to` across joint j.
    function cost(j, from) {
        if (j.type === JOINT.H) return 3 + 0.2 * j.span;
        return j.b === from ? 1 : 25;        // down onto what it stands on, or hung from what stands on it
    }

    // What rests on the standing members: a cluster at rest bears down on
    // what it touches lower than itself (its centre BEAR_DY below the
    // cluster's, or the ground), its weight shared among them, and passes on
    // its share of what bears down on it the same way: through rubble lying
    // on rubble, down to the ground and the standing members. (By height, so
    // every newton ends at the ground or a member, never in a cycle.) A storey
    // that fell loose and lies on its stubs, directly or through the rubble
    // between, loads them as it did when they held it by their joints, and
    // they give when they would have.
    const RESTING_S = 0.25;
    const BEAR_DY = 0.25;   // m
    const resting = (C) => C.alive && (C.frozen || (C.rest ?? 0) >= RESTING_S);
    // How high body `tag` bears up to: a cluster BEAR_DY above its centre, a
    // standing member its top (rubble leant against a wall, its centre below
    // the wall's top, is not the wall's load), the ground lowest; an intact
    // building or a projectile bears nothing.
    function topOf(tag) {
        const o = owner.get(tag);
        if (!o) return Infinity;
        if (o.t === 'g') return -Infinity;
        if (o.t === 'c') return clusters[o.i].pos[1] + BEAR_DY;
        if (o.t === 'm') { const m = members[o.i]; return m.top ??= restWorld(m)[1] + m.h[1]; }
        return Infinity;
    }
    // What C lies on: the bodies it touches whose tops are below its centre.
    function bearersOf(C) {
        const t = touches.get(C.body), out = [];
        if (!t) return out;
        for (const other of t.keys()) if (topOf(other) < C.pos[1]) out.push(other);
        return out;
    }
    // The resting clusters lying on body `tag`.
    function lyingOn(tag) {
        const t = touches.get(tag), out = [];
        if (!t) return out;
        const y = topOf(tag);
        for (const other of t.keys()) {
            const U = clusterOf(other);
            if (U && resting(U) && U.pos[1] > y) out.push(U);
        }
        return out;
    }
    // The weight a resting cluster passes down: its own and its share of
    // what lies on it. (Memoised per flow.)
    let loadMemo = new Map();
    function load(C) {
        let W = loadMemo.get(C.id);
        if (W !== undefined) return W;
        W = C.mass * G_ACC;
        for (const U of lyingOn(C.body)) W += load(U) / Math.max(1, bearersOf(U).length);
        loadMemo.set(C.id, W);
        return W;
    }
    function restingOn(m) {
        if (m.body < 0) return 0;
        let W = 0;
        for (const U of lyingOn(m.body)) W += load(U) / Math.max(1, bearersOf(U).length);
        return W;
    }
    // C's weight on what it lies on changed: the standing members under it,
    // directly or through the rubble it lies on, carry it anew. (Each cluster
    // walked once a tick.)
    let bearWalked = new Set();
    const woke = [];   // settled pieces a mover left this step
    function supportsChanged(C) {
        if (!C.alive || C.body < 0 || bearWalked.has(C.id)) return;
        bearWalked.add(C.id);
        for (const other of bearersOf(C)) {
            const o = owner.get(other);
            if (o.t === 'm') { const s = members[o.i]; if (standing(s)) groups.get(s.group).loadDirty = true; }
            else if (o.t === 'c') supportsChanged(clusters[o.i]);
        }
    }

    // A joint's load over what it holds (its members' damage weakening it).
    function ratioOf(j) {
        const weak = 1 - 0.7 * Math.max(members[j.a].damage, members[j.b].damage);
        let r = j.W / (j.capW * weak);
        if (j.type === JOINT.H) r = Math.max(r, j.M / (j.capM * weak));
        return r;
    }

    // Loads down to the anchors: each joint's load W and moment M. Returns
    // the standing members that reach no anchor.
    // flow's scratch, by member id: the cost down (phi), the load and moment
    // handed on to it, and the flow that set them (a stamp, so nothing is cleared).
    let fPhi = new Float64Array(0), fW = new Float64Array(0), fM = new Float64Array(0), fStamp = new Int32Array(0);
    let fEpoch = 0;
    let hD = new Float64Array(256), hI = new Int32Array(256);   // the heap: [phi, id], least first
    const fin = [];                                              // members in the order reached
    const oJ = [], oN = [], oK = [];                             // one member's ways down
    function flow(G) {
        loadMemo = new Map();
        if (fPhi.length < members.length) {
            const n = Math.max(members.length, fPhi.length * 2);
            fPhi = new Float64Array(n); fW = new Float64Array(n); fM = new Float64Array(n); fStamp = new Int32Array(n);
        }
        const ep = ++fEpoch;
        const reach = (i, d) => { fStamp[i] = ep; fPhi[i] = d; fW[i] = 0; fM[i] = 0; };
        // Dijkstra from the anchors.
        let hn = 0;
        const push = (d, i) => {
            if (hn === hD.length) {
                const D2 = new Float64Array(hn * 2), I2 = new Int32Array(hn * 2);
                D2.set(hD); I2.set(hI); hD = D2; hI = I2;
            }
            let k = hn++;
            while (k > 0) {
                const p = (k - 1) >> 1, pd = hD[p];
                if (pd < d || (pd === d && hI[p] < i)) break;
                hD[k] = pd; hI[k] = hI[p]; k = p;
            }
            hD[k] = d; hI[k] = i;
        };
        const ids = G.members;
        for (const i of ids) if (members[i].anchor && standing(members[i])) { reach(i, 0); push(0, i); }
        fin.length = 0;
        while (hn > 0) {
            const d = hD[0], i = hI[0];
            hn--;
            if (hn > 0) {
                const ld = hD[hn], li = hI[hn];
                let k = 0;
                for (;;) {
                    const l = 2 * k + 1, r = l + 1;
                    let s = -1, sd = ld, si = li;
                    if (l < hn && (hD[l] < sd || (hD[l] === sd && hI[l] < si))) { s = l; sd = hD[l]; si = hI[l]; }
                    if (r < hn && (hD[r] < sd || (hD[r] === sd && hI[r] < si))) { s = r; sd = hD[r]; si = hI[r]; }
                    if (s < 0) break;
                    hD[k] = sd; hI[k] = si; k = s;
                }
                hD[k] = ld; hI[k] = li;
            }
            if (d > fPhi[i]) continue;
            fin.push(i);
            for (const ji of members[i].joints) {
                const j = joints[ji];
                if (!intact(j)) continue;
                const n = j.a === i ? j.b : j.a;
                const nd = d + cost(j, n);
                if (fStamp[n] !== ep) { reach(n, nd); push(nd, n); }
                else if (nd < fPhi[n]) { fPhi[n] = nd; push(nd, n); }
            }
        }
        for (const ji of G.joints) { joints[ji].W = 0; joints[ji].M = 0; }
        // Down from the dearest (the reverse of the order reached: phi, then
        // id, descending), each member's load handed on before it is read.
        for (let x = fin.length - 1; x >= 0; x--) {
            const i = fin[x], m = members[i];
            if (m.anchor) continue;
            // Its own weight and what lies on it: the pieces come to rest on
            // it, each shared over the standing members it rests on.
            const w = m.mass * G_ACC + restingOn(m);
            const W = fW[i] + w, Mi = fM[i];
            const f = fPhi[i];
            // The near-cheapest ways down, shared by how cheap.
            let no = 0, sum = 0;
            for (const ji of m.joints) {
                const j = joints[ji];
                if (!intact(j)) continue;
                const n = j.a === i ? j.b : j.a;
                if (fStamp[n] !== ep) continue;
                const pn = fPhi[n];
                if (pn >= f) continue;
                const via = pn + cost(j, i);
                if (via > f + 2) continue;
                const k = 1 / (1 + via - f + 0.5);
                oJ[no] = j; oN[no] = n; oK[no] = k; no++; sum += k;
            }
            for (let o = 0; o < no; o++) {
                const j = oJ[o], n = oN[o], share = oK[o] / sum;
                j.W += W * share;
                fW[n] += W * share;
                if (j.type === JOINT.H) {
                    const M = share * (Mi + (W - w / 2) * Math.max(j.span, 0.5));
                    j.M += M;
                    fM[n] += M;
                }
            }
        }
        return ids.filter((i) => standing(members[i]) && fStamp[i] !== ep);
    }

    // Loads again after a change: what fell off falls, what is overloaded will give.
    function resolve(G) {
        const t0 = performance.now();
        const loose = flow(G);
        if (loose.length) {
            for (const comp of components(loose, intact)) makeCluster(comp, null);
        }
        for (const ji of G.joints) {
            const j = joints[ji];
            if (!intact(j)) continue;
            const r = ratioOf(j);
            j.ratio = r;
            if (r > 1) {
                // (The sooner of the time it had and the time this load gives
                // it: a load growing on a joint brings its failure forward.)
                const delay = r >= 1.6 ? 0 : (0.08 + 1.4 * (1.6 - r) / 0.6) * (0.7 + 0.6 * hash(j.id, 9));
                j.failAt = Math.min(j.failAt, time + delay);
            } else j.failAt = Infinity;
        }
        stats.solveMs += performance.now() - t0;
    }

    // Connected pieces of `ids` over joints `ok` takes.
    function components(ids, ok) {
        const set = new Set(ids), seen = new Set(), out = [];
        for (const s of ids) {
            if (seen.has(s)) continue;
            const comp = [], stack = [s];
            seen.add(s);
            while (stack.length) {
                const i = stack.pop();
                comp.push(i);
                for (const ji of members[i].joints) {
                    const j = joints[ji];
                    if (!ok(j)) continue;
                    const n = j.a === i ? j.b : j.a;
                    if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
                }
            }
            comp.sort((p, q) => p - q);
            out.push(comp);
        }
        return out;
    }

    function failJoint(j) {
        j.broken = true;
        j.failAt = Infinity;
        stats.failures++;
        roughen(j);
        const a = members[j.a], b = members[j.b];
        groups.get(a.group).dirty = true;
        // Crushed: a column or wall that gave under what stands on it.
        if (j.type === JOINT.V && j.W > j.capW && (a.kind === KIND.column || a.kind === KIND.wall) && a.alive && a.cluster < 0) {
            shatter(a, fracture(a) * 1.5, [0, -2, 0]);
        }
        // A joint giving way spills a little dust from the crack; the clouds
        // come from what the falling parts strike.
        events.push({ type: 'dust', p: j.p.slice(), r: 0.8 + 0.5 * Math.sqrt(j.area), n: 3, v: [0, -0.5, 0], color: MATERIAL[b.mat].dust });
    }

    // ---------------------------------------------------------------------
    // Clusters: what falls, one rigid body a connected piece
    // ---------------------------------------------------------------------

    // Make a body of members `ids` (standing, or out of cluster `parent`), moving
    // as parent did, or at `vel` (with `spin`).
    function makeCluster(ids, parent, vel = [0, 0, 0], spin = [0, 0, 0]) {
        let mass = 0;
        const piv = [0, 0, 0];
        for (const i of ids) {
            const m = members[i], p = restWorld(m);
            mass += m.mass;
            for (let k = 0; k < 3; k++) piv[k] += p[k] * m.mass;
        }
        for (let k = 0; k < 3; k++) piv[k] /= mass;
        let pos = piv, quat = [0, 0, 0, 1], v = vel, w = spin;
        if (parent) {
            quat = parent.quat.slice();
            const r = qrot(quat, [piv[0] - parent.pivot[0], piv[1] - parent.pivot[1], piv[2] - parent.pivot[2]]);
            pos = [parent.pos[0] + r[0], parent.pos[1] + r[1], parent.pos[2] + r[2]];
            const pw = parent.spin;
            v = [parent.vel[0] + pw[1] * r[2] - pw[2] * r[1] + vel[0], parent.vel[1] + pw[2] * r[0] - pw[0] * r[2] + vel[1], parent.vel[2] + pw[0] * r[1] - pw[1] * r[0] + vel[2]];
            w = [pw[0] + spin[0], pw[1] + spin[1], pw[2] + spin[2]];
        }
        const C = {
            id: clusters.length, members: ids.slice(), pivot: piv, pos, quat, prevPos: pos.slice(), prevQuat: quat.slice(),
            vel: v.slice(), spin: w.slice(), mass, alive: true, body: -1, born: time, size: 0,
            joints: null, frozen: false, moving: false, rest: 0, seen: -1,
        };
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const parts = [];
        let fr = 0, re = 0;
        for (const i of ids) {
            const m = members[i];
            if (m.body >= 0 && m.cluster < 0) {
                // A standing member coming loose: what lay on it wakes.
                within(() => dropBody(m.body));
                thawNear(restWorld(m), Math.hypot(m.h[0], m.h[1], m.h[2]) + 0.6, 'loosed');
            }
            m.body = -1;
            m.cluster = C.id;
            m.moved = true;
            changed.add(i);
            const p = restWorld(m), q = frameOf(m.frame).q;
            const lp = [p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]];
            for (let k = 0; k < 3; k++) { const e = Math.max(m.h[0], m.h[1], m.h[2]); lo[k] = Math.min(lo[k], lp[k] - e); hi[k] = Math.max(hi[k], lp[k] + e); }
            parts.push({ shape: 'box', halfExtents: { x: Math.max(m.h[0], 0.03), y: Math.max(m.h[1], 0.03), z: Math.max(m.h[2], 0.03) },
                         localPosition: { x: lp[0], y: lp[1], z: lp[2] }, localRotation: { x: q[0], y: q[1], z: q[2], w: q[3] },
                         density: m.mass / volume(m) });
            fr += MATERIAL[m.mat].friction * m.mass; re += MATERIAL[m.mat].restitution * m.mass;
        }
        C.size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
        C.joints = [];
        const inC = new Set(ids);
        for (const i of ids) for (const ji of members[i].joints) {
            const j = joints[ji];
            if (!j.broken && j.a === i && inC.has(j.b)) C.joints.push(ji);
            else if (!j.broken && j.b === i && inC.has(j.a)) C.joints.push(ji);
        }
        C.joints = [...new Set(C.joints)].sort((p, q) => p - q);
        within(() => {
            C.body = Physics.createBody({
                shape: 'compound', parts, position: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: quat[0], y: quat[1], z: quat[2], w: quat[3] },
                friction: fr / mass, restitution: re / mass, linearDamping: 0.02, angularDamping: 0.15, ccd: C.size < 3,
            });
            Physics.setLinearVelocity(C.body, v[0], v[1], v[2]);
            Physics.setAngularVelocity(C.body, w[0], w[1], w[2]);
        });
        owner.set(C.body, { t: 'c', i: C.id });
        clusters.push(C);
        stats.clusters++;
        return C;
    }

    function freeCluster(C) {
        if (!C.alive) return;
        // What it lay on no longer bears it.
        if (resting(C)) supportsChanged(C);
        C.alive = false;
        if (C.frozen && C.body >= 0) frozenNow--;
        within(() => dropBody(C.body));
        C.body = -1;
    }

    // Split C into its connected pieces (after a joint in it broke or a member went).
    function splitCluster(C) {
        const ids = C.members.filter((i) => members[i].alive && members[i].cluster === C.id);
        const inC = new Set(ids);
        const comps = components(ids, (j) => !j.broken && inC.has(j.a) && inC.has(j.b));
        if (comps.length === 1 && ids.length === C.members.length) return;
        readVelocity(C);
        freeCluster(C);
        for (const comp of comps) {
            // A little apart, as what broke them pushed.
            const kick = 0.4 * (hash(comp[0], ticks) - 0.5);
            makeCluster(comp, C, [kick, 0, -kick]);
        }
    }

    function readVelocity(C) {
        if (C.body < 0) return;
        const v = within(() => Physics.getVelocity(C.body));
        if (v) { C.vel = [v.linear.x, v.linear.y, v.linear.z]; C.spin = [v.angular.x, v.angular.y, v.angular.z]; }
    }

    // A world point in C's rest frame.
    function toRest(C, p) {
        const r = qrot(qinv(C.quat), [p[0] - C.pos[0], p[1] - C.pos[1], p[2] - C.pos[2]]);
        return [r[0] + C.pivot[0], r[1] + C.pivot[1], r[2] + C.pivot[2]];
    }
    function toWorld(C, p) {
        const r = qrot(C.quat, [p[0] - C.pivot[0], p[1] - C.pivot[1], p[2] - C.pivot[2]]);
        return [r[0] + C.pos[0], r[1] + C.pos[1], r[2] + C.pos[2]];
    }
    const pointOf = (m) => (m.cluster >= 0 ? toWorld(clusters[m.cluster], restWorld(m)) : restWorld(m));

    // Energy E delivered to cluster C at world point p: its joints near p
    // break if it is more than they take, its members there shatter if it
    // is far more.
    function crack(C, p, E) {
        if (!C.alive || E < QUIET_E) return;
        const rp = toRest(C, p);
        const r0 = 2 + Math.cbrt(E / 1e5);
        let broke = false;
        for (const ji of C.joints) {
            const j = joints[ji];
            if (j.broken) continue;
            const d = Math.hypot(j.p[0] - rp[0], j.p[1] - rp[1], j.p[2] - rp[2]);
            const Ej = E * Math.exp(-d / r0);
            const a = members[j.a], b = members[j.b];
            const Gj = Math.min(MATERIAL[a.mat].G, MATERIAL[b.mat].G) * j.area * 0.35 * (1 - 0.6 * Math.max(a.damage, b.damage));
            if (Ej > Gj) { j.broken = true; roughen(j); broke = true; }
        }
        // The members it struck, shattered by what they could not take.
        const hit = [];
        for (const i of C.members) {
            const m = members[i];
            if (!m.alive || m.cluster !== C.id) continue;
            const c = restWorld(m);
            const d = Math.max(0, Math.hypot(c[0] - rp[0], c[1] - rp[1], c[2] - rp[2]) - Math.max(m.h[0], m.h[1], m.h[2]));
            const Em = E * Math.exp(-d / r0) * 0.5;
            if (Em > 3 * fracture(m) && Math.max(m.h[0], m.h[1], m.h[2]) > CHUNK_MIN * 1.5) hit.push([i, Em]);
        }
        if (hit.length) {
            readVelocity(C);
            for (const [i, Em] of hit.slice(0, 6)) shatter(members[i], Em, [0, 0, 0]);
            broke = true;
        }
        if (broke) splitCluster(C);
    }

    // ---------------------------------------------------------------------
    // Shattering: a member into chunks
    // ---------------------------------------------------------------------

    // Member m broken by energy E: chunks fly on at its velocity plus `push`.
    function shatter(m, E, push) {
        if (!m.alive) return;
        stats.shatters++;
        const C = m.cluster >= 0 ? clusters[m.cluster] : null;
        const base = C ? velocityAt(C, pointOf(m)) : [0, 0, 0];
        const wasBody = m.body;
        m.alive = false;
        changed.add(m.id);
        // Its joints go with it.
        for (const ji of m.joints) {
            const j = joints[ji];
            if (j.broken) continue;
            j.broken = true; j.failAt = Infinity;
            roughen(j);
        }
        if (!C && wasBody >= 0) {
            within(() => dropBody(wasBody));
            thawNear(pointOf(m), Math.hypot(m.h[0], m.h[1], m.h[2]) + 0.6, 'shattered');
        }
        m.body = -1;
        const G = groups.get(m.group);
        if (G) G.dirty = true;
        // How finely: the harder it was hit, the smaller; a chunk breaking
        // again into fewer and larger, and a small chunk of a chunk to dust
        // and grit (rubble grinds down; it does not multiply without end). A
        // curtain wall's glass goes to shards (the 'glass' event), not chunks.
        const gen = m.gen ?? 0;
        const crumble = m.mat === MAT.glass || (gen >= 2 && Math.max(m.h[0], m.h[1], m.h[2]) * 2 < 1.5);
        const over = Math.max(1, E / Math.max(fracture(m), 1));
        const size = Math.max(gen === 0 ? 0.6 : 0.8, Math.min(2.2, 2.2 / Math.cbrt(over)));
        const most = gen === 0 ? 16 : 6;
        const boxes = [];
        const split = (c, h, rough, depth) => {
            let k = 0;
            for (let a = 1; a < 3; a++) if (h[a] > h[k]) k = a;
            if (crumble) return;
            if (2 * h[k] <= size || depth > 5 || boxes.length + 1 >= most) { boxes.push([c, h, rough]); return; }
            const f = 0.3 + 0.4 * hash(m.id * 31 + boxes.length, depth * 7 + k);
            const a0 = c[k] - h[k], cut = a0 + 2 * h[k] * f;
            const c1 = c.slice(), h1 = h.slice(), c2 = c.slice(), h2 = h.slice();
            h1[k] = (cut - a0) / 2; c1[k] = a0 + h1[k];
            h2[k] = (c[k] + h[k] - cut) / 2; c2[k] = cut + h2[k];
            split(c1, h1, rough | (1 << (2 * k + 1)), depth + 1);
            split(c2, h2, rough | (1 << (2 * k)), depth + 1);
        };
        split(m.c, m.h, m.rough, 0);
        const pc = pointOf(m);
        const speed = Math.sqrt(2 * Math.max(0, E - fracture(m)) / m.mass) * 0.3;
        let fine = crumble ? volume(m) : 0;
        for (const [c, h, rough] of boxes) {
            if (Math.max(h[0], h[1], h[2]) * 2 < CHUNK_MIN) { fine += 8 * h[0] * h[1] * h[2]; continue; }
            const ch = addMember({ frame: m.frame, c, h, kind: m.kind, mat: m.mat, rough }, m.group);
            ch.damage = 0.5;
            ch.gen = gen + 1;
            const p = C ? toWorld(C, restWorld(ch)) : restWorld(ch);
            const out = [p[0] - pc[0], p[1] - pc[1], p[2] - pc[2]];
            const ol = Math.hypot(out[0], out[1], out[2]) || 1;
            const s = speed * (0.5 + hash(ch.id, 5));
            const v = [base[0] + push[0] + out[0] / ol * s, base[1] + push[1] + out[1] / ol * s, base[2] + push[2] + out[2] / ol * s];
            const spin = [(hash(ch.id, 1) - 0.5) * 3, (hash(ch.id, 2) - 0.5) * 3, (hash(ch.id, 3) - 0.5) * 3];
            if (C) {
                // Out of a moving body: in its frame, moving as it did.
                const nc = makeCluster([ch.id], null, v, spin);
                placeLike(nc, C);
            } else makeCluster([ch.id], null, v, spin);
        }
        const M = MATERIAL[m.mat];
        events.push({ type: m.mat === MAT.glass ? 'glass' : 'dust', p: pc, r: Math.cbrt(volume(m)) * 1.2 + 1, n: 10 + Math.round(fine * 20 + volume(m) * 3), v: [push[0] * 0.3, push[1] * 0.3 + 0.5, push[2] * 0.3], color: M.dust });
        events.push({ type: 'spall', p: pc, r: Math.cbrt(volume(m)), n: Math.min(60, 8 + Math.round(volume(m) * 6)), v: [base[0] + push[0], base[1] + push[1], base[2] + push[2]], speed: speed + 2, color: M.dust });
        if (C) splitCluster(C);
    }

    // A single-member cluster made at rest pose, moved to where its member is in C.
    function placeLike(nc, C) {
        nc.pos = toWorld(C, nc.pivot);
        nc.quat = C.quat.slice();
        nc.prevPos = nc.pos.slice(); nc.prevQuat = nc.quat.slice();
        within(() => {
            Physics.setPosition(nc.body, nc.pos[0], nc.pos[1], nc.pos[2]);
            Physics.setRotation(nc.body, nc.quat[0], nc.quat[1], nc.quat[2], nc.quat[3]);
        });
    }
    function velocityAt(C, p) {
        const r = [p[0] - C.pos[0], p[1] - C.pos[1], p[2] - C.pos[2]], w = C.spin;
        return [C.vel[0] + w[1] * r[2] - w[2] * r[1], C.vel[1] + w[2] * r[0] - w[0] * r[2], C.vel[2] + w[0] * r[1] - w[1] * r[0]];
    }

    // ---------------------------------------------------------------------
    // Projectiles
    // ---------------------------------------------------------------------

    // Shots stamped with a later tick wait for it (lockstep: every peer
    // launches a shot at the same step, in the same order: by tick, then
    // its `key`).
    const pending = [];
    function fire(o) {
        if (o.tick != null && o.tick > ticks) {
            pending.push(o);
            pending.sort((a, b) => a.tick - b.tick || String(a.key ?? '').localeCompare(String(b.key ?? '')));
            return null;
        }
        if (o.tick != null && o.tick < ticks) stats.lateShots++;
        return launch(o);
    }
    function launchDue() {
        while (pending.length && pending[0].tick <= ticks) launch(pending.shift());
    }
    function launch(o) {
        const p = {
            id: projectiles.length, shape: o.shape ?? 'sphere', r: o.radius ?? 0.5,
            he: o.halfExtents ?? [o.radius ?? 0.5, o.radius ?? 0.5, o.radius ?? 0.5],
            mass: o.mass ?? 1000, p: o.position.slice(), v: o.velocity.slice(), q: [0, 0, 0, 1], prevP: o.position.slice(), prevQ: [0, 0, 0, 1],
            flying: true, body: -1, hits: 0, seen: -1,
        };
        if (p.shape === 'box') p.r = Math.hypot(p.he[0], p.he[1], p.he[2]) * 0.75;
        projectiles.push(p);
        ensureGround(p.p[0], p.p[2], 300);
        return p;
    }

    function sweep(P) {
        P.v[1] -= G_ACC * STEP;
        const speed = Math.hypot(P.v[0], P.v[1], P.v[2]);
        const n = Math.min(64, Math.max(1, Math.ceil(speed * STEP / (P.r * 0.5))));
        const dt = STEP / n;
        ensureGround(P.p[0], P.p[2], 300);
        ensureSolids(P.p[0], P.p[2], 120 + speed * STEP);
        for (let s = 0; s < n && P.flying; s++) {
            for (let k = 0; k < 3; k++) P.p[k] += P.v[k] * dt;
            for (const g of source.groupsNear(P.p[0], P.p[1], P.p[2], P.r)) activate(g);
            const tags = within(() => Physics.overlapSphere({ x: P.p[0], y: P.p[1], z: P.p[2] }, P.r)).sort((a, b) => a - b);
            for (const tag of tags) {
                const o = owner.get(tag);
                if (!o || !P.flying) continue;
                if (o.t === 'm') hitMember(P, members[o.i]);
                else if (o.t === 'c') hitCluster(P, clusters[o.i]);
                else if (o.t === 'g') { stop(P, 0.15); events.push({ type: 'dust', p: P.p.slice(), r: P.r * 3 + Math.cbrt(P.mass) * 0.1, n: 30, v: [0, 2, 0], color: [0.45, 0.42, 0.38] }); }
                else if (o.t === 's') { activate(o.i); }
            }
        }
        if (P.flying && P.p[1] < source.groundAt(P.p[0], P.p[2]) - 5) stop(P, 0);
    }

    function energy(P) { return 0.5 * P.mass * (P.v[0] ** 2 + P.v[1] ** 2 + P.v[2] ** 2); }

    function hitMember(P, m) {
        if (!m.alive || m.cluster >= 0) return;
        P.hits++;
        const E = energy(P), Ef = fracture(m);
        const G = groups.get(m.group);
        if (m.kind === KIND.foundation) { stop(P, 0.2); return; }
        if (E >= Ef) {
            // Through it: the member breaks, its chunks pushed on ahead.
            const k = Math.min(1, 1.2 * P.mass / (P.mass + m.mass));
            const push = [P.v[0] * k, P.v[1] * k, P.v[2] * k];
            const Ek = 0.5 * m.mass * (push[0] ** 2 + push[1] ** 2 + push[2] ** 2);
            shatter(m, E, push);
            const left = Math.max(0, E - Ef - Ek);
            const f = Math.sqrt(left / E);
            for (let k2 = 0; k2 < 3; k2++) P.v[k2] *= f;
            // What it went through cracks what it was joined to: the energy
            // shared over its joints by their area, a neighbour cracked by
            // what goes through the joint they share.
            let area = 0;
            for (const ji of m.joints) area += joints[ji].area;
            for (const ji of m.joints) {
                const j = joints[ji], n = members[j.a === m.id ? j.b : j.a];
                if (n.alive && n.cluster < 0) n.damage = Math.min(1, n.damage + 0.4 * Ef * (j.area / Math.max(area, 1e-6)) / Math.max(fracture(n), 1));
            }
            if (Math.hypot(P.v[0], P.v[1], P.v[2]) < 3) stop(P, 0);
        } else {
            m.damage = Math.min(1, m.damage + E / Ef);
            changed.add(m.id);
            events.push({ type: 'spall', p: P.p.slice(), r: P.r, n: 12, v: [-P.v[0] * 0.05, 1, -P.v[2] * 0.05], speed: 3, color: MATERIAL[m.mat].dust });
            events.push({ type: 'dust', p: P.p.slice(), r: P.r * 2 + 1, n: 8, v: [0, 0.5, 0], color: MATERIAL[m.mat].dust });
            stop(P, 0.1);
        }
        if (G) G.dirty = true;
    }

    function hitCluster(P, C) {
        if (!C.alive) return;
        thaw(C, 'shot');
        const E = energy(P);
        readVelocity(C);
        const M = C.mass, mp = P.mass;
        // Momentum shared as in an inelastic knock, the cluster thrown on.
        const k = mp / (mp + M);
        const dv = [(P.v[0] - C.vel[0]) * k * 1.3, (P.v[1] - C.vel[1]) * k * 1.3, (P.v[2] - C.vel[2]) * k * 1.3];
        within(() => Physics.addImpulse(C.body, dv[0] * M, dv[1] * M, dv[2] * M));
        const keep = Math.max(0, (mp - 0.6 * M) / (mp + M));
        for (let i = 0; i < 3; i++) P.v[i] *= keep;
        crack(C, P.p, E * (1 - keep * keep));
        if (Math.hypot(P.v[0], P.v[1], P.v[2]) < 3) stop(P, 0);
    }

    // The projectile stops flying: a body from here (bounced back by `back` of its speed).
    function stop(P, back) {
        P.flying = false;
        const v = P.v.map((x) => -x * back);
        within(() => {
            P.body = Physics.createBody(P.shape === 'box'
                ? { shape: 'box', halfExtents: { x: P.he[0], y: P.he[1], z: P.he[2] }, position: { x: P.p[0], y: P.p[1], z: P.p[2] }, mass: P.mass, friction: 0.6, ccd: true }
                : { shape: 'sphere', radius: P.r, position: { x: P.p[0], y: P.p[1], z: P.p[2] }, mass: P.mass, friction: 0.6, ccd: true });
            Physics.setLinearVelocity(P.body, v[0], v[1] * 0.5, v[2]);
        });
        owner.set(P.body, { t: 'p', i: P.id });
    }

    // ---------------------------------------------------------------------
    // Contacts: what struck what, how hard
    // ---------------------------------------------------------------------

    // Touches: each pair of bodies in contact, as one record: how many of
    // their sub-shape pairs touch (Jolt reports contacts per sub-shape pair,
    // and a cluster is a compound), and where each cluster of them was when
    // they touched, or when it settled.
    //  - What a resting cluster lies on, and so what loads the standing
    //    members, comes from its touches (restingOn).
    //  - A settled piece wakes when a piece on the move touches it, or when a
    //    touch parts after the other piece moved (not a touch flickering
    //    between pieces lying still), or when what it touched is gone.
    //  - Two static bodies' contacts end when the second turns static: such a
    //    touch is parked (kept, as it lies), not ended.
    const touches = new Map();   // tag -> Map(other tag -> record)
    const pose = (C) => [C.pos[0], C.pos[1], C.pos[2], C.quat[0], C.quat[1], C.quat[2], C.quat[3]];
    // Whether C has moved from pose p (5 cm, or ~1.5 degrees).
    function moved(C, p) {
        const dq = Math.abs(C.quat[0] * p[3] + C.quat[1] * p[4] + C.quat[2] * p[5] + C.quat[3] * p[6]);
        return Math.hypot(C.pos[0] - p[0], C.pos[1] - p[1], C.pos[2] - p[2]) > 0.05 || dq < 0.9999;
    }
    const clusterOf = (tag) => { const o = owner.get(tag); return o && o.t === 'c' ? clusters[o.i] : null; };
    const isStatic = (tag) => { const o = owner.get(tag); return !!o && (o.t !== 'c' || clusters[o.i].frozen) && o.t !== 'p'; };
    function link(a, b, r) {
        for (const [x, y] of [[a, b], [b, a]]) { let m = touches.get(x); if (!m) touches.set(x, m = new Map()); m.set(y, r); }
    }
    function unlink(r) {
        for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) { const m = touches.get(x); if (m) { m.delete(y); if (!m.size) touches.delete(x); } }
    }
    // Touch r begun or ended: if a resting cluster is in it, the loads under
    // both its bodies change.
    function bear(r) {
        const CA = clusterOf(r.a), CB = clusterOf(r.b);
        if (!(CA && resting(CA)) && !(CB && resting(CB))) return;
        for (const tag of [r.a, r.b]) {
            const o = owner.get(tag);
            if (!o) continue;
            if (o.t === 'm') { const s = members[o.i]; if (standing(s)) groups.get(s.group).loadDirty = true; }
            else if (o.t === 'c') supportsChanged(clusters[o.i]);
        }
    }
    function touchBegins(e) {
        const a = Math.min(e.body1, e.body2), b = Math.max(e.body1, e.body2);
        let r = touches.get(a)?.get(b);
        if (r) { if (r.n++ === 0) r.parked = false; return; }
        const A = owner.get(a), B = owner.get(b);
        if (!A || !B) return;
        r = { a, b, n: 1, parked: false, pa: A.t === 'c' ? pose(clusters[A.i]) : null, pb: B.t === 'c' ? pose(clusters[B.i]) : null };
        link(a, b, r);
        bear(r);
        // A piece on the move reaching a settled one wakes it.
        const CA = clusterOf(a), CB = clusterOf(b);
        if (CA?.frozen && CB && !CB.frozen && CB.moving) thaw(CA, 'reached');
        else if (CB?.frozen && CA && !CA.frozen && CA.moving) thaw(CB, 'reached');
    }
    function touchEnds(e) {
        const a = Math.min(e.body1, e.body2), b = Math.max(e.body1, e.body2);
        const r = touches.get(a)?.get(b);
        if (!r || r.n === 0 || --r.n > 0) return;
        if (isStatic(a) && isStatic(b)) {
            // Parked as they lie.
            r.parked = true;
            const CA = clusterOf(a), CB = clusterOf(b);
            if (CA) r.pa = pose(CA);
            if (CB) r.pb = pose(CB);
            return;
        }
        unlink(r);
        bear(r);
        // A touch parting after the other piece moved: what lay or leant on it wakes.
        const CA = clusterOf(a), CB = clusterOf(b);
        if (CA?.frozen && CB && !CB.frozen && (!r.pb || moved(CB, r.pb))) thaw(CA, 'left');
        else if (CB?.frozen && CA && !CA.frozen && (!r.pa || moved(CA, r.pa))) thaw(CB, 'left');
    }
    // Body `tag` going: its touches end, and the settled pieces that touched it wake.
    function untouch(tag) {
        const m = touches.get(tag);
        if (!m) return;
        for (const [other, r] of [...m.entries()].sort((x, y) => x[0] - y[0])) {
            unlink(r);
            bear(r);
            const O = clusterOf(other);
            if (O?.frozen) thaw(O, 'gone');
        }
    }
    // C settled: what it touches, as it lies now.
    function settledOn(C) {
        const m = touches.get(C.body);
        if (!m) return;
        for (const [other, r] of m) {
            const O = clusterOf(other);
            if (O) { if (other === r.a) r.pa = pose(O); else r.pb = pose(O); }
        }
    }

    function contacts(pre) {
        const raw = within(() => Physics.getContacts());
        // (Past the buffer, which contacts were kept is down to thread timing.)
        if (raw.overflow) stats.contactOverflows++;
        stats.contactEvents += raw.length;
        // In an order of their own, not the order Jolt's threads found them
        // in: every peer breaks the same things the same way.
        const pt0 = (e) => e.points?.[0] ?? { x: 0, y: 0, z: 0 };
        // (Within a pair, its new touches before its parted ones: a pair that
        // trades one sub-shape touch for another in a step stays touching.)
        const order = (a, b) => Math.min(a.body1, a.body2) - Math.min(b.body1, b.body2) || Math.max(a.body1, a.body2) - Math.max(b.body1, b.body2)
            || (a.type === 'added' ? 0 : 1) - (b.type === 'added' ? 0 : 1)
            || pt0(a).x - pt0(b).x || pt0(a).y - pt0(b).y || pt0(a).z - pt0(b).z;
        for (const e of raw.filter((x) => x.type === 'added' || x.type === 'removed').sort(order)) {
            if (e.type === 'added') touchBegins(e); else touchEnds(e);
        }
        const evs = raw.filter((e) => e.type === 'added' && e.impulse > 0);
        evs.sort((a, b) => Math.min(a.body1, a.body2) - Math.min(b.body1, b.body2) || Math.max(a.body1, a.body2) - Math.max(b.body1, b.body2)
            || a.impulse - b.impulse || pt0(a).x - pt0(b).x || pt0(a).y - pt0(b).y || pt0(a).z - pt0(b).z);
        const crushedBy = new Map();
        for (const e of evs) {
            let A = owner.get(e.body1), B = owner.get(e.body2);
            if (!A || !B) continue;
            const pt = e.points?.length ? [e.points[0].x, e.points[0].y, e.points[0].z] : null;
            if (!pt) continue;
            if (A.t !== 'c' && B.t === 'c') [A, B] = [B, A];
            if (A.t === 'p' && B.t === 'm') [A, B] = [B, A];
            const J = e.impulse;
            if (A.t === 'c') {
                const C = clusters[A.i];
                if (!C.alive) continue;
                const E = J * J / (2 * C.mass);
                if (E < QUIET_E) continue;
                // A blow wakes a static piece (either one).
                thaw(C, 'blow');
                if (B.t === 'c') thaw(clusters[B.i], 'blow');
                if (B.t === 'm') {
                    const m = members[B.i];
                    if (!m.alive || m.cluster >= 0) continue;
                    if (m.kind !== KIND.foundation && E > fracture(m)) {
                        shatter(m, E, [0, -1, 0]);
                        crushedBy.set(C.id, (crushedBy.get(C.id) ?? 0) + m.mass);
                    } else {
                        m.damage = Math.min(1, m.damage + 0.5 * E / Math.max(fracture(m), 1));
                        groups.get(m.group).loadDirty = true;
                    }
                    crack(C, pt, E * 0.5);
                } else if (B.t === 'c') {
                    const D = clusters[B.i];
                    if (!D.alive) continue;
                    const mu = C.mass * D.mass / (C.mass + D.mass);
                    const E2 = J * J / (2 * mu);
                    crack(C, pt, E2 * 0.5);
                    crack(D, pt, E2 * 0.5);
                } else {
                    // The ground, an intact building (woken by a hard enough blow), a projectile.
                    if (B.t === 's' && E > 2e5) activate(B.i);
                    crack(C, pt, E);
                    if (E > 2e4) events.push({ type: 'dust', p: pt, r: 1 + Math.cbrt(E / 2e4), n: Math.min(40, 4 + Math.round(Math.cbrt(E / 1e4) * 3)), v: [0, 0.8, 0], color: MATERIAL[members[C.members[0]].mat].dust });
                }
            } else if (A.t === 'm' && B.t === 'p') {
                const m = members[A.i], P = projectiles[B.i];
                const E = J * J / (2 * P.mass);
                if (m.alive && m.cluster < 0 && m.kind !== KIND.foundation && E > fracture(m)) shatter(m, E, [0, 0, 0]);
            }
        }
        // A body that crushed what it fell on goes on falling with the momentum it kept.
        for (const [ci, crushed] of crushedBy) {
            const C = clusters[ci];
            const v = pre.get(ci);
            if (!C.alive || !v) continue;
            const k = C.mass / (C.mass + crushed);
            within(() => Physics.setLinearVelocity(C.body, v[0] * k, v[1] * k, v[2] * k));
        }
    }

    // ---------------------------------------------------------------------
    // The step
    // ---------------------------------------------------------------------

    function tick() {
        ticks++;
        bearWalked = new Set();
        launchDue();
        for (const P of projectiles) if (P.flying) { P.prevP = P.p.slice(); sweep(P); }
        for (const G of groups.values()) {
            for (const ji of G.joints) {
                const j = joints[ji];
                if (!j.broken && j.failAt <= time && intact(j)) failJoint(j);
            }
        }
        // Loads again where the structure changed (at most every
        // STRUCT_TICKS: what a loss leaves loose falls that much later at
        // most); where only what lies on it (or a crack) did, every LOAD_TICKS.
        for (const G of groups.values()) {
            const since = ticks - G.solvedAt;
            if (!(G.dirty && since >= STRUCT_TICKS) && !(G.loadDirty && since >= LOAD_TICKS)) continue;
            G.dirty = G.loadDirty = false;
            G.solvedAt = ticks;
            stats.resolves++;
            resolve(G);
        }
        // The heavy movers' velocities, to carry them on through what they crush.
        const pre = new Map();
        for (const C of clusters) {
            if (!C.alive || C.frozen || C.mass < 2e4) continue;
            readVelocity(C);
            pre.set(C.id, C.vel.slice());
        }
        const t0 = performance.now();
        world.step(STEP);
        stats.physMs = performance.now() - t0;
        // Where everything is now: the bodies awake read; one asleep (or
        // static) lies where it was.
        const T = within(() => Physics.getActiveTransforms());
        const still = (C) => {
            C.prevPos = C.pos; C.prevQuat = C.quat;
            const was = resting(C);
            C.rest += STEP;
            C.moving = false;
            if (was !== resting(C)) supportsChanged(C);
        };
        for (let k = 0; k + 7 < T.length; k += 8) {
            const o = owner.get(T[k]);
            if (!o) continue;
            if (o.t === 'c') {
                const C = clusters[o.i];
                C.seen = ticks;
                C.prevPos = C.pos; C.prevQuat = C.quat;
                C.pos = [T[k + 1], T[k + 2], T[k + 3]];
                C.quat = [T[k + 4], T[k + 5], T[k + 6], T[k + 7]];
                // How long it has lain still.
                const dp = Math.hypot(C.pos[0] - C.prevPos[0], C.pos[1] - C.prevPos[1], C.pos[2] - C.prevPos[2]);
                const dq = Math.abs(C.quat[0] * C.prevQuat[0] + C.quat[1] * C.prevQuat[1] + C.quat[2] * C.prevQuat[2] + C.quat[3] * C.prevQuat[3]);
                const was = resting(C);
                C.rest = dp < REST_SPEED * STEP && dq > 1 - 1e-6 ? (C.rest ?? 0) + STEP : 0;
                // Come to rest on standing members, or off them again: their loads change.
                if (was !== resting(C)) supportsChanged(C);
                // On the move (not settling): it wakes the settled pieces it
                // reaches (contacts), and those it touched once it has moved
                // from where it was when they touched or they settled (what
                // lay on it: a settled heap whose bottom wakes and goes).
                C.moving = dp > WAKE_SPEED * STEP;
                if (C.moving && frozenNow > 0) {
                    const t = touches.get(C.body);
                    if (t) for (const [other, r] of t) {
                        const F = clusterOf(other);
                        if (F?.frozen && moved(C, other === r.a ? r.pb : r.pa)) woke.push(F);
                    }
                }
            } else if (o.t === 'p') {
                const P = projectiles[o.i];
                P.seen = ticks;
                P.prevP = P.p; P.prevQ = P.q;
                P.p = [T[k + 1], T[k + 2], T[k + 3]];
                P.q = [T[k + 4], T[k + 5], T[k + 6], T[k + 7]];
            }
        }
        for (const C of clusters) if (C.alive && C.body >= 0 && !C.frozen && C.seen !== ticks) still(C);
        for (const P of projectiles) if (P.body >= 0 && P.seen !== ticks) { P.prevP = P.p; P.prevQ = P.q; }
        if (woke.length) {
            for (const F of woke.sort((a, b) => a.id - b.id)) thaw(F, 'left');
            woke.length = 0;
        }
        contacts(pre);
        retire();
        time += STEP;
        stats.bodies = owner.size;
    }

    // Rubble come to rest settles out of the simulation: a small piece that
    // has lain still for REST_S turns static (no solver work; still there to
    // land on and be struck), a larger one stays dynamic for Jolt to sleep.
    // A static piece wakes (thaw) when a shot or a hard blow reaches it, a
    // piece on the move touches it, or what it touched goes (its contact
    // parts after that piece moved, its body is gone, or the standing member
    // it lay on came loose): from the contacts, so only the pieces actually
    // touched wake, and a settled heap stays settled. Past PRESSURE of the bodies, settled pieces under
    // PRESSURE_SIZE lose their bodies outright (drawn where they lie; past
    // waking). Once a second.
    let frozenNow = 0;
    function retire() {
        if (ticks % 60 !== 0) return;
        const pressed = owner.size > PRESSURE * maxBodies;
        for (const C of clusters) {
            if (!C.alive || C.body < 0 || !(C.rest > 0)) continue;
            if (pressed && C.size < PRESSURE_SIZE && C.rest >= 0.5) {
                within(() => dropBody(C.body));
                C.body = -1;
                if (C.frozen) frozenNow--;
                C.frozen = true;
                C.prevPos = C.pos; C.prevQuat = C.quat;
                stats.dropped++;
                continue;
            }
            if (C.frozen) continue;
            if ((C.size < FREEZE_SIZE || C.mass < FREEZE_MASS) && C.rest >= REST_S) {
                within(() => Physics.setMotionType(C.body, 'static'));
                C.frozen = true;
                C.vel = [0, 0, 0]; C.spin = [0, 0, 0];
                C.prevPos = C.pos; C.prevQuat = C.quat;
                frozenNow++;
                stats.frozen++;
                settledOn(C);
            }
        }
    }
    // A static piece moving again, and what it holds up with it.
    // (`why`: what woke it, counted in stats.thawBy.)
    function thaw(C, why = 'other') {
        if (!C.frozen || C.body < 0 || !C.alive) return;
        C.frozen = false;
        C.rest = 0;
        frozenNow--;
        stats.thawed++;
        stats.thawBy[why] = (stats.thawBy[why] ?? 0) + 1;
        // (Moving again until it lies still: off its supports' loads meanwhile.)
        supportsChanged(C);
        within(() => Physics.setMotionType(C.body, 'dynamic'));
    }
    // Wake the static pieces within r of p (what lay on something that went).
    function thawNear(p, r, why) {
        if (frozenNow <= 0) return;
        const tags = within(() => Physics.overlapSphere({ x: p[0], y: p[1], z: p[2] }, r)).sort((a, b) => a - b);
        for (const tag of tags) {
            const o = owner.get(tag);
            if (o && o.t === 'c') thaw(clusters[o.i], why);
        }
    }

    return {
        members, clusters, projectiles, groups, joints, stats, changed,
        get time() { return time; },
        /** Steps taken (60 Hz): the clock shots are stamped with. */
        get tick() { return ticks; },
        /** The fraction of a step since the last one: for drawing between the last two poses. */
        get alpha() { return acc / STEP; },
        /** Fire a projectile: { shape, radius, halfExtents, mass, position, velocity }, now, or
         *  with `tick` (and a `key` ordering shots of one tick) at the start of that step. */
        fire,
        /** Break member `i` where it stands (a charge set on it): its chunks fall, and what it held is held by what is left. */
        demolish(i) {
            const m = members[i];
            if (!m?.alive || m.cluster >= 0 || m.kind === KIND.foundation) return false;
            shatter(m, fracture(m), [0, 0, 0]);
            groups.get(m.group).dirty = true;
            return true;
        },
        /** Wake every settled (static) piece: a shake of everything. */
        wakeAll() { for (const C of clusters) thaw(C); },
        /** Step until `tick` steps have been taken, however many that is (a peer catching up). */
        stepTo(t) { let n = 0; while (ticks < t) { tick(); n++; } return n; },
        /** A hash of the simulation's state (FNV-1a over every piece's pose bits,
         *  every member's life and every projectile): peers in step agree on it. */
        hash() {
            const f = new Float32Array(1), u = new Uint32Array(f.buffer);
            let h = 0x811c9dc5;
            const mix = (x) => { h = Math.imul(h ^ (x >>> 0), 0x01000193); };
            const num = (x) => { f[0] = x; mix(u[0]); };
            mix(ticks); mix(members.length); mix(clusters.length);
            for (const m of members) mix(m.alive ? (m.cluster + 2) : 0);
            for (const C of clusters) { if (!C.alive) continue; for (const x of C.pos) num(x); for (const x of C.quat) num(x); }
            for (const P of projectiles) { for (const x of P.p) num(x); mix(P.hits); }
            return (h >>> 0).toString(16).padStart(8, '0');
        },
        /** Wake group g's structure now (as a blow would). */
        activate,
        /** Advance by dt seconds: whole 60 Hz steps. */
        step(dt) {
            acc += Math.min(dt, 0.25);
            let n = 0;
            while (acc >= STEP && n < 8) { tick(); acc -= STEP; n++; }
            if (n === 8) acc = 0;
            return n;
        },
        /** Events since the last call: dust, glass, spall. */
        drain() { const e = events.splice(0); return e; },
        restWorld, toWorld, frameOf,
        /** Touch records parked (n 0) whose cluster has since moved, for tests: should be none. */
        staleTouches() {
            let n = 0, parked = 0;
            for (const [tag, t] of touches) for (const [other, r] of t) {
                if (tag > other || r.n > 0) continue;
                parked++;
                for (const [x, p] of [[r.a, r.pa], [r.b, r.pb]]) {
                    const C = clusterOf(x);
                    if (C && p && moved(C, p)) { n++; break; }
                }
            }
            return { stale: n, parked };
        },
        /** Cluster ci's touches, for tests: [{ t (owner type, or '?' gone), n, parked, top, below }]. */
        touchesOf(ci) {
            const C = clusters[ci], t = touches.get(C.body);
            if (!t) return [];
            return [...t].map(([o, r]) => ({ t: owner.get(o)?.t ?? '?', n: r.n, parked: r.parked, top: topOf(o), below: topOf(o) < C.pos[1] }));
        },
        /** The weight (N) of the rubble at rest on standing member i, for tests. */
        restingLoad(i) { loadMemo = new Map(); return restingOn(members[i]); },
        /** Structural state of group g, for tests: { members, standing, joints, overloaded, maxRatio,
         *  overloads: [{ id, type, ratio, wait }] } (wait: seconds until it gives, Infinity if never). */
        report(g) {
            const G = groups.get(g);
            if (!G) return null;
            const st = G.members.filter((i) => standing(members[i])).length;
            const live = G.joints.filter((ji) => intact(joints[ji]));
            const over = live.filter((ji) => joints[ji].ratio > 1);
            return { members: G.members.length, standing: st, joints: live.length, overloaded: over.length,
                     maxRatio: live.reduce((a, ji) => Math.max(a, joints[ji].ratio), 0),
                     overloads: over.map((ji) => { const j = joints[ji]; return { id: j.id, type: j.type, ratio: j.ratio, wait: j.failAt - time }; }) };
        },
        destroy() { world.destroy(); },
    };
}
