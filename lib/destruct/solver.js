// lib/destruct/solver.js — solver.bk's world: boxes on the GPU (bro.kernel),
// structures added as they are needed, shots fired into them, stepped at 60 Hz.
//
// createSolver({ capacity = 1 << 18, src }) -> {
//   setOrigin([x, y, z], groundAt)   the world point the solver counts from, once, before anything is added;
//                               its ground is groundAt(x, z)'s heights (world space) taken every 4 m to 1 km
//                               (the nearest 160 m at once, the rest over the next few seconds of steps)
//                               from there (the edge's beyond), or without one the level plane at y
//   addStructure({ frame: { x, y, z, yaw }, members: [{ c, h, mass, ground, sf }], joints: [[a, b]],
//                  chunk = 1.2, sigma = 3e6 })
//       -> { first, count, pieces, firstMember, members, member: Int32Array, c: Float32Array, h: Float32Array, ... } | null (no room)
//       a structure standing: its members (boxes in `frame`, c their centres, h their half extents) cut into
//       pieces no longer than `chunk`, welded face to face (a weld holding `sigma` Pa over the face shared), held
//       where they stand while joined to the ground through their welds. A `ground` member's pieces are fixed
//       for good, and the pieces touching it are the ones on the ground. A member carries the members above it (`joints`: which
//       rest on or are tied to which), and gives way loaded past `sf` times what it carries as built.
//       The pieces of a member are grouped two by two along each side into blocks: a block is one body in
//       its pieces' place, welded to the blocks it touches, until it is struck hard enough to break into
//       them (solver.bk, k_split_pieces), so what falls whole is solved as few bodies and what is hit breaks
//       fine.
//       Returned: its bodies' range (its `pieces` first, then its blocks) and, for each piece, its member,
//       centre and half extents in `frame`.
//   remove(out)                 a structure (what addStructure returned) out of the world as if never added;
//                               the next one added may take its room (and its body numbers)
//   where(), place(built)       addStructure in two halves, so the first can run off the thread:
//                               place(buildStructure(s, where())) is addStructure(s) (buildStructure below;
//                               builder.js runs it in a Worker)
//   fire({ half: [x, y, z], mass, position, velocity }) -> body | -1     a box flying (world space)
//   step()                      one step of 1/60 s, now (it waits for the GPU once)
//   stepLater(after), busy, finish()
//                               one step beside the frames (bro.kernel.background), waiting for nothing:
//                               after() is called inside the job (the dispatches that show the step). While
//                               `busy` nothing else of the solver may be called but its readers of what has
//                               come back (standing, shots, reach, quiet, awake); finish() waits the step out
//   show(out, spheres)          each body's k_show row into `out` (80 bytes a body) and its bounding sphere,
//                               world space (x, y, z, r), into `spheres` (16 bytes a body), for a node's
//                               setInstanceCullSpheres
//   standing()                  per member, how many of its pieces are still joined to the ground (an
//                               Int32Array a few steps old; null until the first comes back)
//   shots()                     [{ body, p: [x, y, z] }] where the shots were a step or two ago (world space)
//   shotBodies()                the shots still in the world (one come to rest leaves it)
//   reach()                     [{ x, y, z, count }] the 8 m squares of the plan (within 1 km of the origin)
//                               bodies were moving over a step or two ago: its centre, how many, their mean height
//   REACH_CELL                  those squares' side
//   awake, quiet                how many bodies were awake a step or two ago; whether none was, and nothing has
//                               been added since: a step would change nothing
//   count, members, welds, tick, capacity, origin, buffers: { X, V, B, ... }, destroy() }

const DIM = 64, SIZE = 2.4, KS = 64, H = 1 / 60;   // (a cell is as wide as a block of two pieces is long)
export const REACH_CELL = 8;
const REACH_DIM = 256;
const GROUND_CELL = 4, GROUND_DIM = 512;
const ITERS0 = 10, NCOL0 = 4, ROUNDS = 6, OMEGA = 0.6, RATE = 8, SLEEP = 45, MAXJ = 12, MAX_SHOTS = 32;

// Two boxes of one frame touch face to face: how much face they share (0: they do not).
function shared(ca, ao, ha, ho, cb, bo, hb, bho) {
    let deep = 0, area = 1;
    for (let k = 0; k < 3; k++) {
        const gap = Math.abs(cb[bo + k] - ca[ao + k]) - ha[ho + k] - hb[bho + k];
        if (gap > 0.01) return 0;
        if (gap < -0.05) { deep++; area *= Math.min(-gap, 2 * ha[ho + k], 2 * hb[bho + k]); }
    }
    return deep >= 2 ? area : 0;
}

// The pieces: each member cut along each side into equal parts no longer than `chunk`.
function cutPieces(members, chunk) {
    const K = new Int32Array(3 * members.length);
    let nb = 0;
    for (let mi = 0; mi < members.length; mi++) {
        let c = 1;
        for (let a = 0; a < 3; a++) { const k = Math.max(1, Math.ceil(2 * members[mi].h[a] / chunk - 1e-6)); K[3 * mi + a] = k; c *= k; }
        nb += c;
    }
    const pm = new Int32Array(nb), pc = new Float64Array(3 * nb), ph = new Float64Array(3 * nb), pmass = new Float64Array(nb), fixed = new Uint8Array(nb);
    // The blocks: a member's pieces two by two along each side (a ground member's are in none). pblock: each
    // piece's, -1 for none (a block of one piece is no block).
    const pblock = new Int32Array(nb).fill(-1);
    let blo = [], bhi = [], bmass = [], bcount = [], bmem = [];
    let i = 0;
    for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi], k0 = K[3 * mi], k1 = K[3 * mi + 1], k2 = K[3 * mi + 2];
        const h0 = m.h[0] / k0, h1 = m.h[1] / k1, h2 = m.h[2] / k2, mass = m.mass / (k0 * k1 * k2), fx = m.ground === true ? 1 : 0;
        const q0 = (k0 + 1) >> 1, q1 = (k1 + 1) >> 1, first = bcount.length;
        if (!fx && k0 * k1 * k2 > 1) {
            const nq = q0 * q1 * ((k2 + 1) >> 1);
            for (let k = 0; k < nq; k++) { blo.push(Infinity, Infinity, Infinity); bhi.push(-Infinity, -Infinity, -Infinity); bmass.push(0); bcount.push(0); bmem.push(mi); }
        }
        for (let a = 0; a < k0; a++) for (let b = 0; b < k1; b++) for (let d = 0; d < k2; d++) {
            pm[i] = mi; pmass[i] = mass; fixed[i] = fx;
            ph[3 * i] = h0; ph[3 * i + 1] = h1; ph[3 * i + 2] = h2;
            pc[3 * i] = m.c[0] - m.h[0] + h0 * (2 * a + 1); pc[3 * i + 1] = m.c[1] - m.h[1] + h1 * (2 * b + 1); pc[3 * i + 2] = m.c[2] - m.h[2] + h2 * (2 * d + 1);
            if (!fx && k0 * k1 * k2 > 1) {
                const q = first + (a >> 1) + q0 * ((b >> 1) + q1 * (d >> 1));
                pblock[i] = q; bmass[q] += mass; bcount[q]++;
                for (let k = 0; k < 3; k++) { blo[3 * q + k] = Math.min(blo[3 * q + k], pc[3 * i + k] - ph[3 * i + k]); bhi[3 * q + k] = Math.max(bhi[3 * q + k], pc[3 * i + k] + ph[3 * i + k]); }
            }
            i++;
        }
    }
    const to = new Int32Array(bcount.length).fill(-1);
    let nk = 0;
    for (let q = 0; q < bcount.length; q++) { if (bcount[q] > 1) to[q] = nk++; }
    const bc = new Float64Array(3 * nk), bh = new Float64Array(3 * nk), bm = new Float64Array(nk), bmember = new Int32Array(nk);
    for (let q = 0; q < bcount.length; q++) {
        const t = to[q];
        if (t < 0) continue;
        for (let k = 0; k < 3; k++) { bc[3 * t + k] = (blo[3 * q + k] + bhi[3 * q + k]) / 2; bh[3 * t + k] = (bhi[3 * q + k] - blo[3 * q + k]) / 2; }
        bm[t] = bmass[q]; bmember[t] = bmem[q];
    }
    for (let k = 0; k < nb; k++) { if (pblock[k] >= 0) pblock[k] = to[pblock[k]]; }
    return { nb, pm, pc, ph, pmass, fixed, pblock, nk, bc, bh, bm, bmember };
}

// The welds: every two pieces (not fixed) touching face to face, found through a grid of cells no smaller
// than a piece is long.
function findWelds(nb, pc, ph, fixed, chunk) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nb; i++) {
        if (fixed[i]) continue;
        for (let k = 0; k < 3; k++) { const v = pc[3 * i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    }
    let wa = new Int32Array(4 * nb + 16), wb = new Int32Array(4 * nb + 16), warea = new Float64Array(4 * nb + 16), nw = 0;
    if (lo[0] > hi[0]) return { nw, wa, wb, warea };
    let cs = Math.max(2, chunk + 0.1), dx, dy, dz;
    for (;;) {
        dx = Math.floor((hi[0] - lo[0]) / cs) + 1; dy = Math.floor((hi[1] - lo[1]) / cs) + 1; dz = Math.floor((hi[2] - lo[2]) / cs) + 1;
        if (dx * dy * dz <= 1 << 22) break;
        cs *= 2;
    }
    const nc = dx * dy * dz, cellOf = new Int32Array(nb), start = new Int32Array(nc + 1);
    for (let i = 0; i < nb; i++) {
        if (fixed[i]) { cellOf[i] = -1; continue; }
        const c = Math.floor((pc[3 * i] - lo[0]) / cs) + dx * (Math.floor((pc[3 * i + 1] - lo[1]) / cs) + dy * Math.floor((pc[3 * i + 2] - lo[2]) / cs));
        cellOf[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < nc; c++) start[c + 1] += start[c];
    const items = new Int32Array(start[nc]), fill = start.slice(0, nc);
    for (let i = 0; i < nb; i++) { if (cellOf[i] >= 0) items[fill[cellOf[i]]++] = i; }
    for (let i = 0; i < nb; i++) {
        const c = cellOf[i];
        if (c < 0) continue;
        const cx = c % dx, cyz = (c - cx) / dx, cy = cyz % dy, cz = (cyz - cy) / dy;
        for (let ax = cx - 1; ax <= cx + 1; ax++) {
            if (ax < 0 || ax >= dx) continue;
            for (let ay = cy - 1; ay <= cy + 1; ay++) {
                if (ay < 0 || ay >= dy) continue;
                for (let az = cz - 1; az <= cz + 1; az++) {
                    if (az < 0 || az >= dz) continue;
                    const q = ax + dx * (ay + dy * az);
                    for (let t = start[q]; t < start[q + 1]; t++) {
                        const j = items[t];
                        if (j <= i) continue;
                        const area = shared(pc, 3 * i, ph, 3 * i, pc, 3 * j, ph, 3 * j);
                        if (area <= 0) continue;
                        if (nw === wa.length) {
                            const a2 = new Int32Array(2 * nw), b2 = new Int32Array(2 * nw), r2 = new Float64Array(2 * nw);
                            a2.set(wa); b2.set(wb); r2.set(warea);
                            wa = a2; wb = b2; warea = r2;
                        }
                        wa[nw] = i; wb[nw] = j; warea[nw] = area; nw++;
                    }
                }
            }
        }
    }
    return { nw, wa, wb, warea };
}

// How many welds each piece stands from the ground (0: touching a ground member; 1 << 20: joined to none).
function weldHops(nb, pc, ph, fixed, grounds, nw, wa, wb) {
    const n0 = new Int32Array(nb + 1);
    for (let j = 0; j < nw; j++) { n0[wa[j] + 1]++; n0[wb[j] + 1]++; }
    for (let i = 0; i < nb; i++) n0[i + 1] += n0[i];
    const nbr = new Int32Array(2 * nw), fill = n0.slice(0, nb);
    for (let j = 0; j < nw; j++) { nbr[fill[wa[j]]++] = wb[j]; nbr[fill[wb[j]]++] = wa[j]; }
    const hopOf = new Int32Array(nb).fill(1 << 20), queue = new Int32Array(nb);
    let tail = 0;
    const gc = new Float64Array(3 * grounds.length), gh = new Float64Array(3 * grounds.length);
    grounds.forEach((g, k) => { gc.set(g.c, 3 * k); gh.set(g.h, 3 * k); });
    for (let i = 0; i < nb; i++) {
        if (fixed[i]) continue;
        for (let g = 0; g < grounds.length; g++) { if (shared(pc, 3 * i, ph, 3 * i, gc, 3 * g, gh, 3 * g) > 0) { hopOf[i] = 0; queue[tail++] = i; break; } }
    }
    for (let head = 0; head < tail; head++) {
        const i = queue[head], hop = hopOf[i] + 1;
        for (let t = n0[i]; t < n0[i + 1]; t++) { const k = nbr[t]; if (hopOf[k] > hop) { hopOf[k] = hop; queue[tail++] = k; } }
    }
    return hopOf;
}

const inertia = (B, o, h, m) => {
    B[o + 4] = m / 3 * (h[1] * h[1] + h[2] * h[2]); B[o + 5] = m / 3 * (h[0] * h[0] + h[2] * h[2]); B[o + 6] = m / 3 * (h[0] * h[0] + h[1] * h[1]);
};

// A structure (addStructure's `s`) made ready for a solver's buffers at `at` (solver.where()), for
// solver.place: the pieces, their welds, the members' loads. It touches no solver, so it can run in a Worker
// (builder.js); its arrays are the ones to hand across.
export function buildStructure(s, at) {
    const chunk = s.chunk ?? 1.2, sigma = s.sigma ?? 3e6, F = s.frame, origin = at.origin;
    const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), qy = Math.sin(F.yaw / 2), qw = Math.cos(F.yaw / 2);
    const { nb, pm, pc, ph, pmass, fixed, pblock, nk, bc, bh, bm, bmember } = cutPieces(s.members, chunk);
    // (The bodies are the pieces, then the blocks.)
    const nbT = nb + nk;
    const NMs = s.members.length, grounds = s.members.filter((m) => m.ground);
    const { nw, wa, wb, warea } = findWelds(nb, pc, ph, fixed, chunk);
    const edges = s.joints.filter(([a, b]) => a < NMs && b < NMs);

    // The bodies: where they stand in the solver's space, held.
    // A piece of a block is in the world without size until its block gives way to it (PAR: its block; D: the
    // size and mass it takes up then); a block (PAR -2) stands in its pieces' place.
    const X = new Float32Array(8 * nbT), B = new Float32Array(8 * nbT), SUP = new Int32Array(2 * nbT), MB = new Int32Array(nbT);
    const PAR = new Int32Array(nbT).fill(-1), D = new Float32Array(4 * nbT);
    const ox = F.x - origin[0], oy = F.y - origin[1], oz = F.z - origin[2];
    const stand = (i, c, k) => {
        const o = 8 * i, lx = c[3 * k], lz = c[3 * k + 2];
        X[o] = ox + cy * lx + sy * lz; X[o + 1] = oy + c[3 * k + 1]; X[o + 2] = oz - sy * lx + cy * lz;
        X[o + 5] = qy; X[o + 7] = qw;
    };
    for (let i = 0; i < nb; i++) {
        const o = 8 * i, h = [ph[3 * i], ph[3 * i + 1], ph[3 * i + 2]];
        stand(i, pc, i);
        // (A ground member's pieces are fixed: no mass, held or their own.)
        if (fixed[i]) { B.set(h, o); MB[i] = -1; continue; }
        inertia(B, o, h, pmass[i]);
        MB[i] = at.nm + pm[i];
        D.set(h, 4 * i); D[4 * i + 3] = pmass[i];
        if (pblock[i] >= 0) { PAR[i] = at.n + nb + pblock[i]; continue; }
        B.set(h, o);
        B[o + 7] = pmass[i];
    }
    for (let q = 0; q < nk; q++) {
        const i = nb + q, o = 8 * i, h = [bh[3 * q], bh[3 * q + 1], bh[3 * q + 2]];
        stand(i, bc, q);
        B.set(h, o);
        B[o + 7] = bm[q];
        inertia(B, o, h, bm[q]);
        MB[i] = at.nm + bmember[q];
        PAR[i] = -2;
    }
    // The welds' records, and each body's list of its own. Between two pieces: in force from the start if both
    // are their own bodies, else waiting for that (its 30th float 2). Between a block and what it touches (a
    // block or a lone piece): one weld for all of the face they share, at the middle of it, which goes to a
    // piece on a side whose block gives way (JA: that piece and the anchor in its frame), and is done with
    // once both sides are pieces.
    const unit = (i) => (pblock[i] >= 0 ? nb + pblock[i] : i);
    const across = new Map();   // unit a * nbT + unit b -> { j (its weld), a, b (pieces), area, c: [x, y, z] area-weighted }
    const over = new Int32Array(nw).fill(-1);   // a weld between pieces of two units: the units' weld
    for (let j = 0; j < nw; j++) {
        const ua = unit(wa[j]), ub = unit(wb[j]);
        if (ua === ub || (ua < nb && ub < nb)) continue;
        const key = ua * nbT + ub;
        let e = across.get(key);
        if (!e) across.set(key, e = { j: nw + across.size, ua, ub, a: wa[j], b: wb[j], best: 0, area: 0, c: [0, 0, 0] });
        over[j] = e.j;
        if (warea[j] > e.best) { e.best = warea[j]; e.a = wa[j]; e.b = wb[j]; }
        e.area += warea[j];
        for (let k = 0; k < 3; k++) e.c[k] += warea[j] * (pc[3 * wa[j] + k] + pc[3 * wb[j] + k]) / 2;
    }
    const nwT = nw + across.size;
    const JI = new Int32Array(2 * nwT), JF = new Float32Array(40 * nwT), JA = new Float32Array(8 * nwT), JC = new Int32Array(nbT), JR = new Int32Array(MAXJ * nbT);
    const list = (i, j) => { if (JC[i] < MAXJ) JR[MAXJ * i + JC[i]] = at.nj + j; JC[i]++; };
    const centre = (u, k) => (u < nb ? pc[3 * u + k] : bc[3 * (u - nb) + k]);
    const massOf = (u) => (u < nb ? pmass[u] : bm[u - nb]);
    const weld = (j, a, b, ma, mb, area) => {
        const o = 40 * j;
        JI[2 * j] = at.n + a; JI[2 * j + 1] = at.n + b;
        let L = 0;
        for (let k = 0; k < 3; k++) { const d = centre(b, k) - centre(a, k); L += d * d; }
        JF[o + 9] = 1;
        const ms = ma * mb / (ma + mb);
        JF[o + 31] = ms; JF[o + 32] = ms * L;
        for (let k = 0; k < 3; k++) { JF[o + 16 + k] = 1e4 * ms; JF[o + 19 + k] = 1e4 * ms * L; }
        JF[o + 28] = sigma * area; JF[o + 29] = sigma * area * 0.25;
        JF[o + 34] = 0.03; JF[o + 35] = 0.06;
    };
    // (The blocks' welds first: a piece's list is short, and the one it may stand for a block in is not the
    // one to drop.)
    for (const e of across.values()) {
        const j = e.j, o = 40 * j;
        weld(j, e.ua, e.ub, massOf(e.ua), massOf(e.ub), e.area);
        for (let k = 0; k < 3; k++) {
            const c = e.c[k] / e.area;
            JF[o + k] = c - centre(e.ua, k); JF[o + 3 + k] = c - centre(e.ub, k);
            JA[8 * j + k] = c - pc[3 * e.a + k]; JA[8 * j + 4 + k] = c - pc[3 * e.b + k];
        }
        JA[8 * j + 3] = at.n + e.a; JA[8 * j + 7] = at.n + e.b;
        list(e.ua, j); list(e.ub, j);
        if (e.a !== e.ua) list(e.a, j);
        if (e.b !== e.ub) list(e.b, j);
    }
    for (let j = 0; j < nw; j++) {
        const a = wa[j], b = wb[j], o = 40 * j;
        weld(j, a, b, pmass[a], pmass[b], warea[j]);
        // (The anchor is the midpoint, in each body's frame its offset: the frame's axes are the bodies'.)
        for (let k = 0; k < 3; k++) { const d = pc[3 * b + k] - pc[3 * a + k]; JF[o + k] = d / 2; JF[o + 3 + k] = -d / 2; }
        // (JA: no piece to go to; and the weld of the units it crosses between, which it is broken with.)
        JA[8 * j + 3] = -1; JA[8 * j + 4] = over[j] < 0 ? -1 : at.nj + over[j];
        if (pblock[a] >= 0 || pblock[b] >= 0) JF[o + 30] = 2;
        list(a, j); list(b, j);
    }
    // (A piece joined to no ground goes with the first step, and a block is as near the ground as its nearest
    // piece. Each one's first int, the tick the ground was last heard from, is place's to set.)
    const hopOf = weldHops(nb, pc, ph, fixed, grounds, nw, wa, wb);
    for (let q = 0; q < nk; q++) SUP[2 * (nb + q) + 1] = 1 << 20;
    for (let i = 0; i < nb; i++) {
        const hop = fixed[i] ? 1 << 20 : hopOf[i] === 1 << 20 ? 1 : hopOf[i];
        SUP[2 * i + 1] = hop;
        if (pblock[i] >= 0) { const q = 2 * (nb + pblock[i]) + 1; SUP[q] = Math.min(SUP[q], hop); }
    }

    // The members: what each weighs, how far from the ground, and what it can carry: `sf` times what it
    // carries as built, each one's load shared equally among the members under it.
    const MF = new Float32Array(8 * NMs), MJ0 = new Int32Array(2 * NMs), MJ = new Int32Array(Math.max(1, 2 * edges.length));
    const nb2 = Array.from({ length: NMs }, () => []);
    for (const [a, b] of edges) { nb2[a].push(b); nb2[b].push(a); }
    let to = 0;
    for (let m = 0; m < NMs; m++) { MJ0[2 * m] = at.me + to; MJ0[2 * m + 1] = nb2[m].length; for (const k of nb2[m]) MJ[to++] = at.nm + k; }
    for (let i = 0; i < nb; i++) { if (!fixed[i]) { MF[8 * pm[i]] += pmass[i] * 10; MF[8 * pm[i] + 5]++; } }
    const mhop = new Float64Array(NMs).fill(1e6);
    let front = [];
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
    return { at, nb: nbT, pieces: nb, nw: nwT, nmem: NMs, ne: 2 * edges.length, X, B, SUP, MB, PAR, D, JI, JF, JA, JC, JR, MF, MJ0, MJ, member: pm, c: Float32Array.from(pc), h: Float32Array.from(ph) };
}

export function createSolver(opts = {}) {
    const ITERS =opts.iters ?? ITERS0, NCOL = opts.ncol ?? NCOL0;
    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/destruct/solver.bk'), 'utf8');
    const mod = bro.kernel.compile(src, { file: 'lib/destruct/solver.bk' });
    const kernels = new Map();
    const K = (name) => { let k = kernels.get(name); if (!k) kernels.set(name, k = mod.kernel(name)); return k; };

    // (Contacts are between things in motion: their room does not grow with what stands.)
    const N = opts.capacity ?? 1 << 18, CAP = 3 << 19, NJC = N * 3, NMC = Math.max(1024, N >> 2), MEC = NMC * 12;
    const buf = (bytes) => bro.kernel.createBuffer(bytes);
    const bX = buf(32 * N), bR = buf(32 * N), bX0 = buf(32 * N), bY = buf(32 * N), bV = buf(32 * N), bB = buf(32 * N), bCOL = buf(4 * N);
    let bBC = buf(4 * N), bBR = buf(4 * 48 * N), bCI = buf(8 * CAP), bCF = buf(80 * CAP);
    let bOBC = buf(4 * N), bOBR = buf(4 * 48 * N), bOCI = buf(8 * CAP), bOCF = buf(80 * CAP);   // (the last step's)
    const bNC = buf(4), bLG = bro.kernel.createBuffer(new Int32Array(MAX_SHOTS).fill(-1));
    const bMB = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bMF = buf(32 * NMC), bMJ0 = buf(8 * NMC), bMJ = buf(4 * MEC), bMC = buf(4 * NMC);
    const bGR = bro.kernel.createBuffer(new Int32Array(N).fill(-1000)), bWHY = buf(4 * N), bSL = buf(4 * N);
    const bSUP = bro.kernel.createBuffer(new Int32Array(2 * N).fill(1 << 20)), bREL = buf(4 * N);
    const bJI = buf(8 * NJC), bJF = buf(160 * NJC), bJC = buf(4 * N), bJR = buf(4 * MAXJ * N);
    // Blocks (solver.bk, k_split_pieces): each body's block (-1 none, -2 a block), the size and mass a piece
    // takes up when its block gives way, whether a block is to give way, a weld's other ends.
    const bPAR = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bD = buf(16 * N), bSPL = buf(4 * N), bJA = buf(32 * NJC);
    const bCount = buf(4 * DIM ** 3), bSlots = buf(4 * KS * DIM ** 3), bP = buf(16 * N);
    // The pairs near enough to try for contacts this step (solver.bk, k_pairs): how many, which, and each
    // one's mass and margin.
    const bM = buf(32 * N);   // each body's motion over the step so far (solver.bk, k_begin)
    const bG = buf(48);   // the thread groups of the passes over the awake, the welds, the contacts, the pairs
    const PCAP = 1 << 18, bNP = buf(4), bPL = buf(8 * PCAP), bPF = buf(8 * PCAP);
    const bAL = buf(4 * (N + 1)), bWL = buf(4 * (NJC + 1));   // the awake bodies, and their welds: a count, then indices
    const all = [bX, bR, bX0, bY, bV, bB, bCOL, bBC, bBR, bCI, bCF, bOBC, bOBR, bOCI, bOCF, bNC, bLG, bMB, bMF, bMJ0, bMJ, bMC, bGR, bWHY, bSL, bSUP, bREL, bJI, bJF, bJC, bJR, bCount, bSlots];
    const ZERO = new Int32Array(1);

    let n = 0, nj = 0, nm = 0, me = 0, tick = 0, origin = null;
    const shots = [], LG = new Int32Array(MAX_SHOTS).fill(-1);
    let standing = null, standingRead = null;
    let shotRead = null, shotAt = [];
    const bReach = buf(8 * REACH_DIM * REACH_DIM + 4), REACH_ZERO = new Int32Array(2 * REACH_DIM * REACH_DIM + 1);
    let reachRead = null, reach = [], reachTick = 0;
    let awake = 0, awakeTick = -1, stirred = 0;   // the bodies awake at awakeTick; the tick something was last added
    const bHG = buf(4 * GROUND_DIM * GROUND_DIM);
    all.push(bReach, bHG, bAL, bWL, bPAR, bD, bSPL, bJA, bP, bNP, bPL, bPF, bG, bM);

    // A structure built somewhere else (buildStructure, perhaps in a Worker) put into the world: null if there
    // is no room. Built for another place in the buffers than they have come to since (a shot fired, say), its
    // references are moved.
    function place(S) {
        if (!origin) throw new Error('solver: setOrigin first');
        const { nb, nw, nmem, ne } = S;
        // Each of its four ranges goes in a gap a removed structure left, if one is long enough, else at the end.
        const hb = gap(free.n, nb), hw = gap(free.nj, nw), hm = gap(free.nm, nmem), he = gap(free.me, ne);
        if ((hb < 0 && n + nb > N - MAX_SHOTS + shots.length) || (hw < 0 && nj + nw > NJC) || (hm < 0 && nm + nmem > NMC) || (he < 0 && me + ne > MEC)) return null;
        const b0 = take(free.n, hb, nb, n), w0 = take(free.nj, hw, nw, nj), m0 = take(free.nm, hm, nmem, nm), e0 = take(free.me, he, ne, me);
        const dn = b0 - S.at.n, dj = w0 - S.at.nj, dm = m0 - S.at.nm, de = e0 - S.at.me;
        if (dn) {
            for (let k = 0; k < 2 * nw; k++) S.JI[k] += dn;
            for (let i = 0; i < nb; i++) { if (S.PAR[i] >= 0) S.PAR[i] += dn; }
            for (let j = 0; j < nw; j++) { if (S.JA[8 * j + 3] >= 0) { S.JA[8 * j + 3] += dn; S.JA[8 * j + 7] += dn; } }
        }
        if (dj) for (let j = 0; j < nw; j++) { if (S.JA[8 * j + 3] < 0 && S.JA[8 * j + 4] >= 0) S.JA[8 * j + 4] += dj; }
        if (dj) for (let i = 0; i < nb; i++) { const c = Math.min(S.JC[i], MAXJ); for (let e = 0; e < c; e++) S.JR[MAXJ * i + e] += dj; }
        if (dm) { for (let i = 0; i < nb; i++) { if (S.MB[i] >= 0) S.MB[i] += dm; } for (let k = 0; k < ne; k++) S.MJ[k] += dm; }
        if (de) for (let m = 0; m < nmem; m++) S.MJ0[2 * m] += de;
        for (let i = 0; i < nb; i++) S.SUP[2 * i] = tick;
        bX.write(S.X, 32 * b0); bR.write(S.X, 32 * b0); bB.write(S.B, 32 * b0); bSUP.write(S.SUP, 8 * b0); bMB.write(S.MB, 4 * b0);
        bJC.write(S.JC, 4 * b0); bJR.write(S.JR, 4 * MAXJ * b0);
        bPAR.write(S.PAR, 4 * b0); bD.write(S.D, 16 * b0); bSPL.write(new Int32Array(nb), 4 * b0);
        if (nw) { bJI.write(S.JI, 8 * w0); bJF.write(S.JF, 160 * w0); bJA.write(S.JA, 32 * w0); }
        bMF.write(S.MF, 32 * m0); bMJ0.write(S.MJ0, 8 * m0);
        if (ne) bMJ.write(S.MJ, 4 * e0);
        const out = { first: b0, count: nb, pieces: S.pieces, firstMember: m0, members: nmem, firstWeld: w0, welds: nw, firstEdge: e0, edges: ne, member: S.member, c: S.c, h: S.h };
        n = Math.max(n, b0 + nb); nj = Math.max(nj, w0 + nw); nm = Math.max(nm, m0 + nmem); me = Math.max(me, e0 + ne);
        stirred = tick;
        return out;
    }
    // The gaps removed structures left in the bodies, welds, members and members' joints: [start, length].
    const free = { n: [], nj: [], nm: [], me: [] };
    const gap = (list, need) => (need ? list.findIndex((g) => g[1] >= need) : -1);
    const take = (list, k, need, end) => {
        if (k < 0) return end;
        const g = list[k], at = g[0];
        g[0] += need; g[1] -= need;
        if (!g[1]) list.splice(k, 1);
        return at;
    };
    // A structure (what addStructure or place returned) out of the world, as if it had never been added: its
    // bodies without size or mass far under the ground, its welds broken, its room free for the next.
    function remove(out) {
        const nb = out.count, X = new Float32Array(8 * nb), Z = new Float32Array(8 * nb), SUP = new Int32Array(2 * nb), ZI = new Int32Array(Math.max(nb * MAXJ, 2 * out.welds, 2 * out.members, out.edges));
        for (let i = 0; i < nb; i++) { X[8 * i + 1] = -1e5; X[8 * i + 7] = 1; SUP[2 * i + 1] = 1 << 20; }
        const at = 32 * out.first, zi = (k) => ZI.subarray(0, k);
        bX.write(X, at); bR.write(X, at); bX0.write(X, at); bY.write(X, at); bB.write(Z, at); bV.write(Z, at); bSUP.write(SUP, 8 * out.first);
        bMB.write(new Int32Array(nb).fill(-1), 4 * out.first); bGR.write(new Int32Array(nb).fill(-1000), 4 * out.first);
        for (const b of [bJC, bWHY, bSL, bREL, bCOL, bBC, bOBC, bSPL]) b.write(zi(nb), 4 * out.first);
        bPAR.write(new Int32Array(nb).fill(-1), 4 * out.first); bD.write(new Float32Array(4 * nb), 16 * out.first);
        bJR.write(zi(nb * MAXJ), 4 * MAXJ * out.first);
        if (out.welds) {
            const JF = new Float32Array(40 * out.welds);
            for (let j = 0; j < out.welds; j++) JF[40 * j + 30] = 1;
            bJI.write(zi(2 * out.welds), 8 * out.firstWeld); bJF.write(JF, 160 * out.firstWeld);
        }
        bMF.write(new Float32Array(8 * out.members), 32 * out.firstMember); bMJ0.write(zi(2 * out.members), 8 * out.firstMember);
        if (out.edges) bMJ.write(zi(out.edges), 4 * out.firstEdge);
        free.n.push([out.first, nb]); free.nm.push([out.firstMember, out.members]);
        if (out.welds) free.nj.push([out.firstWeld, out.welds]);
        if (out.edges) free.me.push([out.firstEdge, out.edges]);
        stirred = tick;
    }
    // Where the next structure goes in the buffers (buildStructure's `at`).
    const where = () => ({ origin: origin.slice(), n, nj, nm, me });
    const addStructure = (s) => {
        if (!origin) throw new Error('solver: setOrigin first');
        return place(buildStructure(s, where()));
    };

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
        stirred = tick;
        return i;
    }

    // A shot (at p, r its reach) out of the world: no size, no mass, far under the ground; the rubble asleep
    // against it wakes.
    const stay = new Map();   // a shot's body -> where it was when it last moved half a metre, and the tick
    function retire(body, p, r) {
        K('k_rouse').dispatch(n, bX, bB, bSUP, bREL, p[0], p[1], p[2], r + 1.5);
        stirred = tick;
        shots.splice(shots.indexOf(body), 1);
        LG.fill(-1); LG.set(shots);
        bLG.write(LG);
        const X = new Float32Array(8);
        X[1] = -1e5; X[7] = 1;
        bX.write(X, 32 * body); bR.write(X, 32 * body); bB.write(new Float32Array(8), 32 * body); bV.write(new Float32Array(8), 32 * body);
        bSUP.write(new Int32Array([0, 1 << 20]), 8 * body);
    }

    // The ground's heights are taken outward from the origin, ring by ring, `most` at a call: 160 m about it
    // with the origin, the rest of the kilometre over the steps that follow (ahead of anything flung), level
    // with the origin until then.
    let ground = null;
    function groundOut(most) {
        const c = GROUND_DIM / 2, G = ground.G;
        const take = (i, j) => { G[i + GROUND_DIM * j] = ground.at(origin[0] + (i - c) * GROUND_CELL, origin[2] + (j - c) * GROUND_CELL) - origin[1]; };
        for (let got = 0; got < most && ground.ring < c;) {
            const r = ++ground.ring, lo = c - r, hi = c + r - 1;
            for (let i = lo; i <= hi; i++) { take(i, lo); take(i, hi); }
            for (let j = lo + 1; j < hi; j++) { take(lo, j); take(hi, j); }
            got += 8 * r - 4;
        }
        bHG.write(G);
        if (ground.ring >= c) ground = null;
    }

    let job = null;
    function step() {
        if (!n) return;
        if (ground) groundOut(800);
        tick++;
        // The blocks marked in the last step give way to their pieces.
        if (nj) {
            K('k_split_pieces').dispatch(n, bX, bX0, bR, bV, bB, bD, bPAR, bSPL, bSUP, bREL, bSL);
            K('k_split_welds').dispatch(nj, bJI, bJF, bJA, bPAR, bSPL);
            K('k_split_blocks').dispatch(n, bX, bV, bB, bPAR, bSPL, bSUP, bSL);
        }
        const nl = shots.length;
        const support = () => K('k_support').dispatch(n, bB, bV, bSUP, bREL, bJI, bJF, bJC, bJR, bX0, bY, bMB, bMF, bSL, bGR, bWHY, tick, RATE, H);
        if (nm) {
            K('k_mclear').dispatch(nm, bMC);
            K('k_mcount').dispatch(n, bB, bSUP, bMB, bMC, bPAR, tick, RATE);
            for (let r = 0; r < RATE; r++) K('k_mload').dispatch(nm, bMF, bMC, bMJ0, bMJ);
        }
        K('k_clear').dispatch(DIM ** 3, bCount);
        bNC.write(ZERO); bNP.write(ZERO);
        [bBC, bOBC] = [bOBC, bBC]; [bBR, bOBR] = [bOBR, bBR]; [bCI, bOCI] = [bOCI, bCI]; [bCF, bOCF] = [bOCF, bCF];
        K('k_begin').dispatch(n, bX, bX0, bY, bV, bB, bBC, bCount, bSlots, bLG, bP, bM, nl, H, SIZE, DIM);
        for (let r = 0; r < RATE; r++) support();
        K('k_contacts').dispatch(n, bX0, bB, bCount, bSlots, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bV, bLG, bJI, bJF, bJC, bJR, bHG, bP, bNP, bPL, bPF, PCAP, nl, CAP, SIZE, DIM, H, GROUND_CELL, GROUND_DIM);
        // The passes go over what is awake, by list (k_list, k_wlist), and over the pairs and contacts there
        // are, so a step costs what is moving and not what exists. How long each is the GPU reads for itself
        // as a pass runs (dispatchCounted; k_groups writes the counts into bG): the step waits for nothing.
        const groups = (count, at, cap, kernel) => K('k_groups').dispatch(1, count, bG, at, K(kernel).localSize, cap);
        groups(bNP, 3, PCAP, 'k_pairs');
        K('k_pairs').dispatchCounted(bG, 36, PCAP, bX0, bB, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bNP, bPL, bPF, CAP);
        groups(bNC, 2, CAP, 'k_dual');
        const lists = () => {
            bAL.write(ZERO); K('k_list').dispatch(n, bB, bAL);
            groups(bAL, 0, n, 'k_primal');
            if (nj) { bWL.write(ZERO); K('k_wlist').dispatch(nj, bB, bJI, bJF, bWL); groups(bWL, 1, nj, 'k_jdual'); }
        };
        lists();
        if (nj) K('k_jbegin').dispatchCounted(bG, 12, nj, bJI, bJF, bX0, bWL);
        K('k_uncolour').dispatch(n, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR);
        for (let r = 0; r < ROUNDS; r++) K('k_colour').dispatch(n, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR, NCOL);
        for (let it = 0; it <= ITERS; it++) {
            const alpha = it < ITERS ? 1 : 0;
            for (let c = 0; c <= NCOL; c++) K('k_primal').dispatchCounted(bG, 0, n, bX, bX0, bY, bB, bCI, bCF, bBC, bBR, bCOL, bJI, bJF, bJC, bJR, bAL, bM, H, alpha, c, OMEGA);
            if (it < ITERS) K('k_dual').dispatchCounted(bG, 24, CAP, bX, bX0, bCI, bCF, bNC, bREL, bB, bV, bSUP, bGR, bPAR, bSPL, alpha, tick);
            // (A held piece struck in this pass goes now: the passes left carry the blow on through it.)
            if (it < ITERS - 1) { support(); lists(); }
            // (A weld breaks only on the step's settled forces.)
            if (it < ITERS && nj) K('k_jdual').dispatchCounted(bG, 12, nj, bJI, bJF, bX, bWL, alpha, tick, it === ITERS - 1 ? 1 : 0);
            if (it === ITERS - 1) K('k_velocity').dispatch(n, bX, bX0, bV, bB, bSL, bSUP, H, SLEEP, GROUND_CELL * GROUND_DIM / 2 - 2 * GROUND_CELL);
        }
        // What the page asks about, copied without waiting: read a step or two on.
        if (nm && (!standingRead || standingRead.ready)) {
            if (standingRead) { standing = standingRead.read(new Int32Array(standingRead.byteLength / 4)); standingRead.release(); }
            standingRead = bMC.readLater(0, 4 * nm);
        }
        if (!reachRead || reachRead.ready) {
            if (reachRead) {
                const c = reachRead.read(new Int32Array(2 * REACH_DIM * REACH_DIM + 1));
                reachRead.release();
                awake = c[2 * REACH_DIM * REACH_DIM]; awakeTick = reachTick;
                reach = [];
                for (let k = 0; k < REACH_DIM * REACH_DIM; k++) {
                    if (!c[2 * k]) continue;
                    reach.push({ x: origin[0] + (k % REACH_DIM - REACH_DIM / 2 + 0.5) * REACH_CELL, y: origin[1] + c[2 * k + 1] / c[2 * k],
                                 z: origin[2] + (Math.floor(k / REACH_DIM) - REACH_DIM / 2 + 0.5) * REACH_CELL, count: c[2 * k] });
                }
            }
            bReach.write(REACH_ZERO);
            K('k_reach').dispatch(n, bX, bV, bB, bReach, REACH_CELL, REACH_DIM);
            reachRead = bReach.readLater();
            reachTick = tick;
        }
        if (nl && (!shotRead || shotRead.r.ready)) {
            if (shotRead) {
                const x = shotRead.r.read(new Float32Array(shotRead.r.byteLength / 4)), b = shotRead.b.read(new Float32Array(shotRead.b.byteLength / 4));
                shotAt = [];
                for (const body of shotRead.ids) {
                    const o = 8 * (body - shotRead.ids[0]);
                    // A shot come to rest (asleep) is done: it leaves the world, and the list every body tries.
                    // (So is one that has gone nowhere for two seconds: a heavy shot on light rubble trembles
                    // and never sleeps.)
                    let s = stay.get(body);
                    if (!s || Math.hypot(x[o] - s.p[0], x[o + 1] - s.p[1], x[o + 2] - s.p[2]) > 0.5) stay.set(body, s = { p: [x[o], x[o + 1], x[o + 2]], tick });
                    if ((b[o + 3] <= 0 || tick - s.tick > 120) && shots.includes(body)) { stay.delete(body); retire(body, [x[o], x[o + 1], x[o + 2]], Math.hypot(b[o], b[o + 1], b[o + 2])); continue; }
                    shotAt.push({ body, p: [x[o] + origin[0], x[o + 1] + origin[1], x[o + 2] + origin[2]] });
                }
                shotRead.r.release(); shotRead.b.release();
                shotRead = null;
            }
            if (shots.length) {
                // (The shots lie between the first and the last of them.)
                const lo = shots[0], hi = shots[shots.length - 1];
                shotRead = { ids: shots.slice(), r: bX.readLater(32 * lo, 32 * (hi - lo + 1)), b: bB.readLater(32 * lo, 32 * (hi - lo + 1)) };
            }
        }
    }

    return {
        setOrigin(p, groundAt) {
            if (origin) throw new Error('solver: the origin is set');
            origin = p.slice();
            if (!groundAt) return;
            ground = { at: groundAt, G: new Float32Array(GROUND_DIM * GROUND_DIM), ring: 0 };
            groundOut(6400);
        },
        addStructure, where, place, remove, fire, step,
        show(out, spheres) { if (n) K('k_show').dispatch(n, bX, bX0, bR, bB, bJI, bJF, bJC, bJR, bPAR, bD, out, spheres, origin[0], origin[1], origin[2]); },
        stepLater(after) {
            if (job) throw new Error('solver: a step is still being taken');
            job = bro.kernel.background(() => { step(); after?.(); });
        },
        get busy() { if (job && job.done) job = null; return job !== null; },
        finish() {
            if (!job) return;
            bro.kernel.background(() => { bNC.read(new Int32Array(1)); });
            job = null;
        },
        standing: () => standing,
        shots: () => shotAt,
        shotBodies: () => shots,
        reach: () => reach,
        // (Not while the ground is still being taken: that goes by the step.)
        get quiet() { return !ground && awakeTick > stirred + 8 && awake === 0; },
        get awake() { return awake; },
        get count() { return n; },
        get members() { return nm; },
        get welds() { return nj; },
        get tick() { return tick; },
        get origin() { return origin; },
        capacity: N,
        // (As they are now: the contacts' swap with the last step's each step.)
        get buffers() {
            return { X: bX, R: bR, V: bV, B: bB, SUP: bSUP, SL: bSL, WHY: bWHY, MF: bMF, MC: bMC, JF: bJF, JC: bJC, cells: bCount, NC: bNC, PAR: bPAR,
                     X0: bX0, Y: bY, CI: bCI, CF: bCF, BC: bBC, BR: bBR, COL: bCOL, JI: bJI, JR: bJR, AL: bAL, groups: bG, M: bM };
        },
        contactRoom: CAP,
        destroy() { for (const b of all) b.destroy(); },
    };
}
