// lib/destruct/solver.js — solver.bk's world: boxes on the GPU (bro.kernel),
// structures added as they are needed, shots fired into them, stepped at 60 Hz.
//
// createSolver({ capacity = 1 << 17, src }) -> {
//   setOrigin([x, y, z])        the world point the solver counts from (its ground is the plane y there);
//                               once, before anything is added
//   addStructure({ frame: { x, y, z, yaw }, members: [{ c, h, mass, ground, sf }], joints: [[a, b]],
//                  chunk = 1.2, sigma = 3e6 })
//       -> { first, count, member: Int32Array, c: Float32Array, h: Float32Array } | null (no room)
//       a structure standing: its members (boxes in `frame`, c their centres, h their half extents) cut into
//       pieces no longer than `chunk`, welded face to face (a weld holding `sigma` Pa over the face shared), held
//       where they stand while joined to the ground through their welds. A `ground` member is not a body: the
//       pieces touching it are the ones on the ground. A member carries the members above it (`joints`: which
//       rest on or are tied to which), and gives way loaded past `sf` times what it carries as built.
//       Returned: its bodies' range and, for each, its member, centre and half extents in `frame`.
//   fire({ half: [x, y, z], mass, position, velocity }) -> body | -1     a box flying (world space)
//   step()                      one step of 1/60 s
//   show(out)                   out (a KernelBuffer of 48 bytes a body): each body's k_show row
//   broken(rows, P, stride, at) P's rows (rows: a KernelBuffer of one int a body, -1 none): the faces broken
//   standing()                  per member, how many of its pieces are still joined to the ground (an
//                               Int32Array a few steps old; null until the first comes back)
//   shots()                     [{ body, p: [x, y, z] }] where the shots were a step or two ago (world space)
//   count, members, welds, tick, capacity, origin, buffers: { X, V, B, ... }, destroy() }

const DIM = 64, SIZE = 2, KS = 64, H = 1 / 60;
const ITERS = 10, NCOL = 8, ROUNDS = 6, OMEGA = 0.6, RATE = 8, SLEEP = 45, MAXJ = 12, MAX_SHOTS = 32;

export function createSolver(opts = {}) {
    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/destruct/solver.bk'), 'utf8');
    const mod = bro.kernel.compile(src, { file: 'lib/destruct/solver.bk' });
    const kernels = new Map();
    const K = (name) => { let k = kernels.get(name); if (!k) kernels.set(name, k = mod.kernel(name)); return k; };

    const N = opts.capacity ?? 1 << 17, CAP = N * 12, NJC = N * 3, NMC = Math.max(1024, N >> 2), MEC = NMC * 12;
    const buf = (bytes) => bro.kernel.createBuffer(bytes);
    const bX = buf(32 * N), bR = buf(32 * N), bX0 = buf(32 * N), bY = buf(32 * N), bV = buf(32 * N), bB = buf(32 * N), bCOL = buf(4 * N);
    let bBC = buf(4 * N), bBR = buf(4 * 48 * N), bCI = buf(8 * CAP), bCF = buf(80 * CAP);
    let bOBC = buf(4 * N), bOBR = buf(4 * 48 * N), bOCI = buf(8 * CAP), bOCF = buf(80 * CAP);   // (the last step's)
    const bNC = buf(4), bLG = bro.kernel.createBuffer(new Int32Array(MAX_SHOTS).fill(-1));
    const bMB = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bMF = buf(32 * NMC), bMJ0 = buf(8 * NMC), bMJ = buf(4 * MEC), bMC = buf(4 * NMC);
    const bGR = bro.kernel.createBuffer(new Int32Array(N).fill(-1000)), bWHY = buf(4 * N), bSL = buf(4 * N);
    const bSUP = bro.kernel.createBuffer(new Int32Array(2 * N).fill(1 << 20)), bREL = buf(4 * N);
    const bJI = buf(8 * NJC), bJF = buf(160 * NJC), bJC = buf(4 * N), bJR = buf(4 * MAXJ * N);
    const bCount = buf(4 * DIM ** 3), bSlots = buf(4 * KS * DIM ** 3);
    const all = [bX, bR, bX0, bY, bV, bB, bCOL, bBC, bBR, bCI, bCF, bOBC, bOBR, bOCI, bOCF, bNC, bLG, bMB, bMF, bMJ0, bMJ, bMC, bGR, bWHY, bSL, bSUP, bREL, bJI, bJF, bJC, bJR, bCount, bSlots];
    const ZERO = new Int32Array(1);

    let n = 0, nj = 0, nm = 0, me = 0, tick = 0, origin = null;
    const shots = [], LG = new Int32Array(MAX_SHOTS).fill(-1);
    let standing = null, standingRead = null;
    let shotRead = null, shotAt = [];

    const inertia = (B, o, h, m) => {
        B[o + 4] = m / 3 * (h[1] * h[1] + h[2] * h[2]); B[o + 5] = m / 3 * (h[0] * h[0] + h[2] * h[2]); B[o + 6] = m / 3 * (h[0] * h[0] + h[1] * h[1]);
    };

    function addStructure(s) {
        if (!origin) throw new Error('solver: setOrigin first');
        const chunk = s.chunk ?? 1.2, sigma = s.sigma ?? 3e6, F = s.frame;
        const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), qy = Math.sin(F.yaw / 2), qw = Math.cos(F.yaw / 2);
        // The pieces: each member cut along each side into equal parts no longer than `chunk`.
        const pm = [], pc = [], ph = [], pmass = [], grounds = [];
        s.members.forEach((m, mi) => {
            if (m.ground) { grounds.push(m); return; }
            const k = m.h.map((h) => Math.max(1, Math.ceil(2 * h / chunk - 1e-6))), h = m.h.map((v, a) => v / k[a]);
            const mass = m.mass / (k[0] * k[1] * k[2]);
            for (let a = 0; a < k[0]; a++) for (let b = 0; b < k[1]; b++) for (let d = 0; d < k[2]; d++) {
                pm.push(mi); pmass.push(mass); ph.push(h[0], h[1], h[2]);
                pc.push(m.c[0] - m.h[0] + h[0] * (2 * a + 1), m.c[1] - m.h[1] + h[1] * (2 * b + 1), m.c[2] - m.h[2] + h[2] * (2 * d + 1));
            }
        });
        const nb = pm.length, NMs = s.members.length;
        // Two boxes of the frame touch face to face: how much face they share (0: they do not).
        const shared = (ca, ao, ha, ho, cb, bo, hb, bho) => {
            let deep = 0, area = 1;
            for (let k = 0; k < 3; k++) {
                const gap = Math.abs(cb[bo + k] - ca[ao + k]) - ha[ho + k] - hb[bho + k];
                if (gap > 0.01) return 0;
                if (gap < -0.05) { deep++; area *= Math.min(-gap, 2 * ha[ho + k], 2 * hb[bho + k]); }
            }
            return deep >= 2 ? area : 0;
        };
        // The welds: every two pieces touching face to face (found through 2 m cells).
        const cells = new Map(), key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
        const cell = (i) => [Math.floor(pc[3 * i] / 2), Math.floor(pc[3 * i + 1] / 2), Math.floor(pc[3 * i + 2] / 2)];
        for (let i = 0; i < nb; i++) { const c = cell(i), k = key(c[0], c[1], c[2]); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
        const wa = [], wb = [], warea = [];
        for (let i = 0; i < nb; i++) {
            const c = cell(i);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                const l = cells.get(key(c[0] + dx, c[1] + dy, c[2] + dz));
                if (!l) continue;
                for (const j of l) {
                    if (j <= i) continue;
                    const area = shared(pc, 3 * i, ph, 3 * i, pc, 3 * j, ph, 3 * j);
                    if (area > 0) { wa.push(i); wb.push(j); warea.push(area); }
                }
            }
        }
        const nw = wa.length, edges = s.joints.filter(([a, b]) => a < NMs && b < NMs);
        if (n + nb > N - MAX_SHOTS + shots.length || nj + nw > NJC || nm + NMs > NMC || me + 2 * edges.length > MEC) return null;

        // The bodies: where they stand in the solver's space, held.
        const X = new Float32Array(8 * nb), B = new Float32Array(8 * nb), SUP = new Int32Array(2 * nb), MB = new Int32Array(nb);
        const ox = F.x - origin[0], oy = F.y - origin[1], oz = F.z - origin[2];
        for (let i = 0; i < nb; i++) {
            const o = 8 * i, lx = pc[3 * i], lz = pc[3 * i + 2], h = [ph[3 * i], ph[3 * i + 1], ph[3 * i + 2]];
            X[o] = ox + cy * lx + sy * lz; X[o + 1] = oy + pc[3 * i + 1]; X[o + 2] = oz - sy * lx + cy * lz;
            X[o + 5] = qy; X[o + 7] = qw;
            B.set(h, o); B[o + 7] = pmass[i];
            inertia(B, o, h, pmass[i]);
            MB[i] = nm + pm[i];
        }
        // The welds' records, and each body's list of its own.
        const JI = new Int32Array(2 * nw), JF = new Float32Array(40 * nw), JC = new Int32Array(nb), JR = new Int32Array(MAXJ * nb);
        const nbrs = Array.from({ length: nb }, () => []);
        for (let j = 0; j < nw; j++) {
            const a = wa[j], b = wb[j], o = 40 * j;
            JI[2 * j] = n + a; JI[2 * j + 1] = n + b;
            let L = 0;
            // (The anchor is the midpoint, in each body's frame its offset: the frame's axes are the bodies'.)
            for (let k = 0; k < 3; k++) {
                const d = pc[3 * b + k] - pc[3 * a + k];
                JF[o + k] = d / 2; JF[o + 3 + k] = -d / 2;
                L += d * d;
            }
            JF[o + 9] = 1;
            const ma = pmass[a], mb = pmass[b], ms = ma * mb / (ma + mb);
            JF[o + 31] = ms; JF[o + 32] = ms * L;
            for (let k = 0; k < 3; k++) { JF[o + 16 + k] = 1e4 * ms; JF[o + 19 + k] = 1e4 * ms * L; }
            JF[o + 28] = sigma * warea[j]; JF[o + 29] = sigma * warea[j] * 0.25;
            JF[o + 34] = 0.03; JF[o + 35] = 0.06;
            for (const i of [a, b]) { if (JC[i] < MAXJ) JR[MAXJ * i + JC[i]] = nj + j; JC[i]++; }
            nbrs[a].push(b); nbrs[b].push(a);
        }
        // How many welds each piece stands from the ground (0: touching a ground member). One joined to no
        // ground goes with the first step.
        const hopOf = new Int32Array(nb).fill(1 << 20);
        let front = [];
        for (let i = 0; i < nb; i++) {
            for (const g of grounds) { if (shared(pc, 3 * i, ph, 3 * i, g.c, 0, g.h, 0) > 0) { hopOf[i] = 0; front.push(i); break; } }
        }
        for (let hop = 1; front.length; hop++) {
            const next = [];
            for (const i of front) for (const k of nbrs[i]) { if (hopOf[k] > hop) { hopOf[k] = hop; next.push(k); } }
            front = next;
        }
        for (let i = 0; i < nb; i++) { SUP[2 * i] = tick; SUP[2 * i + 1] = hopOf[i] === 1 << 20 ? 1 : hopOf[i]; }

        // The members: what each weighs, how far from the ground, and what it can carry: `sf` times what it
        // carries as built, each one's load shared equally among the members under it.
        const MF = new Float32Array(8 * NMs), MJ0 = new Int32Array(2 * NMs), MJ = new Int32Array(Math.max(1, 2 * edges.length));
        const nb2 = Array.from({ length: NMs }, () => []);
        for (const [a, b] of edges) { nb2[a].push(b); nb2[b].push(a); }
        let at = 0;
        for (let m = 0; m < NMs; m++) { MJ0[2 * m] = me + at; MJ0[2 * m + 1] = nb2[m].length; for (const k of nb2[m]) MJ[at++] = nm + k; }
        for (let i = 0; i < nb; i++) { MF[8 * pm[i]] += pmass[i] * 10; MF[8 * pm[i] + 5]++; }
        const mhop = new Float64Array(NMs).fill(1e6);
        front = [];
        s.members.forEach((m, k) => { if (m.ground) { mhop[k] = 0; MF[8 * k + 6] = 1; front.push(k); } });
        for (let d = 1; front.length; d++) {
            const next = [];
            for (const m of front) for (const k of nb2[m]) { if (mhop[k] > d) { mhop[k] = d; next.push(k); } }
            front = next;
        }
        const load = new Float64Array(NMs), order = Array.from({ length: NMs }, (_, m) => m).sort((a, b) => mhop[b] - mhop[a]);
        for (const m of order) {
            MF[8 * m + 4] = mhop[m];
            if (mhop[m] === 0) continue;
            if (mhop[m] === 1e6) { MF[8 * m + 1] = 1e30; continue; }
            load[m] += MF[8 * m];
            const under = nb2[m].filter((k) => mhop[k] < mhop[m]);
            for (const k of under) load[k] += load[m] / under.length;
            MF[8 * m + 1] = (s.members[m].sf ?? 2) * load[m];
        }

        bX.write(X, 32 * n); bR.write(X, 32 * n); bB.write(B, 32 * n); bSUP.write(SUP, 8 * n); bMB.write(MB, 4 * n);
        bJC.write(JC, 4 * n); bJR.write(JR, 4 * MAXJ * n);
        if (nw) { bJI.write(JI, 8 * nj); bJF.write(JF, 160 * nj); }
        bMF.write(MF, 32 * nm); bMJ0.write(MJ0, 8 * nm);
        if (edges.length) bMJ.write(MJ, 4 * me);
        const out = { first: n, count: nb, firstMember: nm, member: Int32Array.from(pm), c: Float32Array.from(pc), h: Float32Array.from(ph) };
        n += nb; nj += nw; nm += NMs; me += 2 * edges.length;
        return out;
    }

    function fire(o) {
        if (!origin) throw new Error('solver: setOrigin first');
        if (shots.length >= MAX_SHOTS || n >= N) return -1;
        const i = n++, X = new Float32Array(8), V = new Float32Array(8), B = new Float32Array(8);
        for (let k = 0; k < 3; k++) { X[k] = o.position[k] - origin[k]; V[k] = o.velocity[k]; }
        X[7] = 1;
        B.set(o.half, 0); B[3] = o.mass;
        inertia(B, 0, o.half, o.mass);
        bX.write(X, 32 * i); bR.write(X, 32 * i); bV.write(V, 32 * i); bB.write(B, 32 * i);
        // (Large: every body tries it, it is in no cell: it can be wider than one, or cross one in a step.)
        LG[shots.length] = i; shots.push(i);
        bLG.write(LG);
        return i;
    }

    function step() {
        if (!n) return;
        tick++;
        const nl = shots.length, cap = Math.min(CAP, n * 24);
        const support = () => K('k_support').dispatch(n, bB, bV, bSUP, bREL, bJI, bJF, bJC, bJR, bX0, bY, bMB, bMF, bSL, bGR, bWHY, tick, RATE, H);
        if (nm) {
            K('k_mclear').dispatch(nm, bMC);
            K('k_mcount').dispatch(n, bB, bSUP, bMB, bMC, tick, RATE);
            for (let r = 0; r < RATE; r++) K('k_mload').dispatch(nm, bMF, bMC, bMJ0, bMJ);
        }
        K('k_clear').dispatch(DIM ** 3, bCount);
        bNC.write(ZERO);
        [bBC, bOBC] = [bOBC, bBC]; [bBR, bOBR] = [bOBR, bBR]; [bCI, bOCI] = [bOCI, bCI]; [bCF, bOCF] = [bOCF, bCF];
        K('k_begin').dispatch(n, bX, bX0, bY, bV, bB, bBC, bCount, bSlots, bLG, nl, H, SIZE, DIM);
        for (let r = 0; r < RATE; r++) support();
        K('k_contacts').dispatch(n, bX0, bB, bCount, bSlots, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bV, bLG, bJI, bJF, bJC, bJR, nl, CAP, SIZE, DIM, H);
        if (nj) K('k_jbegin').dispatch(nj, bJI, bJF, bX0);
        K('k_uncolour').dispatch(n, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR);
        for (let r = 0; r < ROUNDS; r++) K('k_colour').dispatch(n, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR, NCOL);
        for (let it = 0; it <= ITERS; it++) {
            const alpha = it < ITERS ? 1 : 0;
            for (let c = 0; c <= NCOL; c++) K('k_primal').dispatch(n, bX, bX0, bY, bB, bCI, bCF, bBC, bBR, bCOL, bJI, bJF, bJC, bJR, H, alpha, c, OMEGA);
            if (it < ITERS) K('k_dual').dispatch(cap, bX, bX0, bCI, bCF, bNC, bREL, bB, bV, bSUP, bGR, alpha, tick);
            // (A held piece struck in this pass goes now: the passes left carry the blow on through it.)
            if (it < ITERS - 1) support();
            // (A weld breaks only on the step's settled forces.)
            if (it < ITERS && nj) K('k_jdual').dispatch(nj, bJI, bJF, bX, alpha, tick, it === ITERS - 1 ? 1 : 0);
            if (it === ITERS - 1) K('k_velocity').dispatch(n, bX, bX0, bV, bB, bSL, H, SLEEP);
        }
        // What the page asks about, copied without waiting: read a step or two on.
        if (nm && (!standingRead || standingRead.ready)) {
            if (standingRead) { standing = standingRead.read(new Int32Array(standingRead.byteLength / 4)); standingRead.release(); }
            standingRead = bMC.readLater(0, 4 * nm);
        }
        if (nl && (!shotRead || shotRead.r.ready)) {
            if (shotRead) {
                const x = shotRead.r.read(new Float32Array(shotRead.r.byteLength / 4));
                shotAt = shotRead.ids.map((body) => { const o = 8 * (body - shotRead.ids[0]); return { body, p: [x[o] + origin[0], x[o + 1] + origin[1], x[o + 2] + origin[2]] }; });
                shotRead.r.release();
            }
            // (The shots lie between the first and the last of them.)
            shotRead = { ids: shots.slice(), r: null };
            const lo = shots[0], hi = shots[nl - 1];
            shotRead.r = bX.readLater(32 * lo, 32 * (hi - lo + 1));
        }
    }

    return {
        setOrigin(p) { if (origin) throw new Error('solver: the origin is set'); origin = p.slice(); },
        addStructure, fire, step,
        show(out) { if (n) K('k_show').dispatch(n, bX, bR, out, origin[0], origin[1], origin[2]); },
        broken(rows, P, stride, at) { if (n) K('k_broken').dispatch(n, bB, bJI, bJF, bJC, bJR, rows, P, stride, at); },
        standing: () => standing,
        shots: () => shotAt,
        get count() { return n; },
        get members() { return nm; },
        get welds() { return nj; },
        get tick() { return tick; },
        get origin() { return origin; },
        capacity: N,
        buffers: { X: bX, R: bR, V: bV, B: bB, SUP: bSUP, SL: bSL, WHY: bWHY, MF: bMF, MC: bMC, JF: bJF, JC: bJC },
        destroy() { for (const b of all) b.destroy(); },
    };
}
