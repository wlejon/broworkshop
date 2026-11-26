// lib/destruct/solver.js — solver.bk's world: boxes on the GPU (bro.kernel),
// structures added as they are needed, shots fired into them, stepped at 60 Hz.
//
// createSolver({ capacity = 1 << 18, src }) -> {
//   setOrigin([x, y, z], heights)   the world point the solver counts from, once, before anything is added;
//                               its ground is the heights `heights(buffer, { origin, dim, cell })` puts in
//                               `buffer` (a KernelBuffer of dim * dim floats, row by row along x: the world's
//                               heights less y, every `cell` metres (4) to 1 km about the point, the middle
//                               one at it; the edge's beyond), or without one the level plane at y
//   addStructure({ frame: { x, y, z, yaw }, members: [{ c, h, mass, ground, sf, sigma, ductile, crush, bears, level }], joints: [[a, b]],
//                  chunk = 1.2, block = 31, sigma = 3e6, crush = 3e7 })
//       -> { first, count, pieces, firstMember, members, member: Int32Array, c: Float32Array, h: Float32Array, ... } | null (no room)
//       a structure standing: its members (boxes in `frame`, c their centres, h their half extents) cut into
//       pieces no longer than `chunk`, welded face to face, held where they stand while joined to the ground
//       through their welds. A weld holds `sigma` Pa over the face shared (a member's own, else the
//       structure's; the weaker of two members'), yields there, keeping what it gives by, and breaks once it
//       has given, in all, 0.04 rad bent or 2 cm slid, twice that with each step of `ductile` (0, as glass, to
//       7; 3 unsaid; the more brittle of two members'). A `ground` member's pieces are fixed for good, and
//       the pieces touching it are the ones on the ground and welded to it. `joints` say which member rests
//       on or is tied to which (their loads are tallied: MF). The members that bear at a level (`bears`,
//       `level`: a whole number) give way together once what is left of them, joined to the ground, can
//       carry less than they carried as built (each could carry `sf` times that) for half a second: what
//       stood on them falls (`fallen` counts the levels that have). A piece pressed harder than `crush` Pa over
//       the side it turns to the push (a member's own, else the structure's) crushes: what presses passes
//       into it, and passed half through the piece is gone (crushed()).
//       The pieces of a member are grouped `block` by `block` along each side into blocks (31: a member is one
//       block, or a few where it is more than 64 pieces): a block is one body in
//       its pieces' place, welded to the blocks it touches, until it is struck hard enough to break into
//       them (solver.bk, k_split_pieces), so what falls whole is solved as few bodies and what is hit breaks
//       fine.
//       Its bodies as built are its blocks and the pieces in none; a block's pieces are given bodies when it
//       gives way, in the room from `units` on, from a run of it its structure is handed as it wants them
//       (a block waits whole a step or two for one; `pieces`: how far into that room any has been handed).
//       Returned: its bodies' range and, for each body, its member, centre and half extents in `frame`, and
//       how many pieces it is (`pieces`: a block's count, 1, or a fixed one's 0).
//   remove(out)                 a structure (what addStructure returned) out of the world as if never added;
//                               the next one added may take its room (and its body numbers)
//   save(out) -> { ready, take(), takeSome(ms), release() }
//                               a structure's whole state as it is now, read back later (take() once ready),
//                               its numbers counted from its own firsts; restore(state) puts it back in the
//                               world as it was, wherever there is room (what addStructure returns, or null).
//                               takeSome(ms) is take() a little at a time (null until it is through), and
//                               restoreLater(state) -> { some(ms), done() } | null is restore() likewise:
//                               the room taken at once, the rows written by done()
//   where(), place(built)       addStructure in two halves, so the first can run off the thread:
//                               place(buildStructure(s, where())) is addStructure(s) (buildStructure below;
//                               builder.js runs it in a Worker)
//   fire({ half: [x, y, z], mass, position, velocity }) -> body | -1     a box flying (world space)
//   step()                      one step of 1/60 s, now (it waits for the GPU once)
//   stepLater(after, steps = 1) -> job, busy, finish()
//                               steps beside the frames (bro.kernel.background; its job, whose `done` says
//                               they are taken), waiting for nothing: after() is called inside the job (the
//                               dispatches that show them). While `busy` (the last job not done) nothing
//                               else of the solver may be called but stepLater again (jobs are taken in
//                               order) and its readers of what has come back (standing, shots, reach, quiet,
//                               awake); finish() waits the steps out
//   show(out, spheres, pieceSpheres)
//                               each body's k_show row into `out` (80 bytes a body) and its bounding sphere,
//                               world space (x, y, z, r; 16 bytes a body), for a node's
//                               setInstanceCullSpheres: the first `units` bodies' into `spheres`, the rest
//                               (body `units` first) into `pieceSpheres`
//   pieceRows(rows)             a table of the bodies as built, 12 floats a body (solver.bk, k_piece_rows),
//                               brought up to the pieces blocks have given way to
//   runs(out)                   { first: [body], length }: the runs of the pieces' room a structure holds
//   intact(out)                 how many of a structure's bodies are not as built, read back later:
//                               { ready, read() -> count, release() }
//   standing()                  per member, how many of its pieces are still joined to the ground (an
//                               Int32Array a few steps old; null until the first comes back)
//   shots()                     [{ body, p: [x, y, z] }] where the shots were a step or two ago (world space)
//   shotBodies()                the shots still in the world (one come to rest leaves it)
//   reach()                     [{ x, y, z, count }] the 8 m squares of the plan (within 1 km of the origin)
//                               bodies were moving over a step or two ago: its centre, how many, their mean height
//   crushed()                   [{ x, y, z, count }] those squares pieces were crushed over since it was last
//                               heard of (pressed past their strength and passed half through: gone), and how many
//   stirring()                  [{ x, z, count }] those squares any body was awake over, at any speed
//   REACH_CELL                  those squares' side
//   awake, quiet                how many bodies were awake a step or two ago; whether none was, and nothing has
//                               been added since: a step would change nothing
//   room                        { units, pieces, welds, made, members, edges }: [used, of] each, net of what
//                               removed structures gave back (pieces and made welds: the runs held, whole);
//                               waits: the times a structure was found wanting pieces with none to take
//   ground                      { buffer, origin, dim, cell }: the heights it stands things on (null before setOrigin)
//   count, units, pieces, members, welds, tick, capacity, origin, buffers: { X, V, B, ... }, destroy() }

const DIM = 64, SIZE = 2.4, KS = 64, H = 1 / 60;   // (a cell is as wide as a block of two pieces is long)
export const REACH_CELL = 8;
const REACH_DIM = 256;
const GROUND_CELL = 4, GROUND_DIM = 512;
const GROUP = 12, PIECE_RUN = 512, WELD_RUN = 2048;   // (solver.bk's)
const GROUP_EMPTY = new Int32Array(GROUP).fill(0); GROUP_EMPTY[2] = -1;
const ITERS0 = 10, NCOL0 = 4, ROUNDS = 6, OMEGA = 0.6, RATE = 8, SLEEP = 45, MAXJ = 40, MAX_SHOTS = 32;

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
function cutPieces(members, chunk, group) {
    const K = new Int32Array(3 * members.length);
    let nb = 0;
    for (let mi = 0; mi < members.length; mi++) {
        let c = 1;
        for (let a = 0; a < 3; a++) { const k = Math.max(1, Math.ceil(2 * members[mi].h[a] / chunk - 1e-6)); K[3 * mi + a] = k; c *= k; }
        nb += c;
    }
    const pm = new Int32Array(nb), pc = new Float64Array(3 * nb), ph = new Float64Array(3 * nb), pmass = new Float64Array(nb), fixed = new Uint8Array(nb);
    // The blocks: a member's pieces `group` by `group` along each side (a ground member's are in none), fewer
    // along each side of a member where that would be more than 64 pieces to a block. pblock: each piece's, -1
    // for none (a block of one piece is no block).
    const pblock = new Int32Array(nb).fill(-1);
    let blo = [], bhi = [], bmass = [], bcount = [], bmem = [], bfirst = [];
    let i = 0;
    for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi], k0 = K[3 * mi], k1 = K[3 * mi + 1], k2 = K[3 * mi + 2];
        const h0 = m.h[0] / k0, h1 = m.h[1] / k1, h2 = m.h[2] / k2, mass = m.mass / (k0 * k1 * k2), fx = m.ground === true ? 1 : 0;
        let G = Math.max(1, Math.min(31, group));
        while (Math.min(k0, G) * Math.min(k1, G) * Math.min(k2, G) > 64) G = (G + 1) >> 1;
        const q0 = Math.ceil(k0 / G), q1 = Math.ceil(k1 / G), first = bcount.length;
        if (!fx && k0 * k1 * k2 > 1) {
            const nq = q0 * q1 * Math.ceil(k2 / G);
            for (let k = 0; k < nq; k++) { blo.push(Infinity, Infinity, Infinity); bhi.push(-Infinity, -Infinity, -Infinity); bmass.push(0); bcount.push(0); bmem.push(mi); bfirst.push(0); }
        }
        const blocked = !fx && k0 * k1 * k2 > 1;
        const piece = (a, b, d) => {
            pm[i] = mi; pmass[i] = mass; fixed[i] = fx;
            ph[3 * i] = h0; ph[3 * i + 1] = h1; ph[3 * i + 2] = h2;
            pc[3 * i] = m.c[0] - m.h[0] + h0 * (2 * a + 1); pc[3 * i + 1] = m.c[1] - m.h[1] + h1 * (2 * b + 1); pc[3 * i + 2] = m.c[2] - m.h[2] + h2 * (2 * d + 1);
            if (blocked) {
                const q = first + Math.floor(a / G) + q0 * (Math.floor(b / G) + q1 * Math.floor(d / G));
                if (!bcount[q]) bfirst[q] = i;
                pblock[i] = q; bmass[q] += mass; bcount[q]++;
                for (let k = 0; k < 3; k++) { blo[3 * q + k] = Math.min(blo[3 * q + k], pc[3 * i + k] - ph[3 * i + k]); bhi[3 * q + k] = Math.max(bhi[3 * q + k], pc[3 * i + k] + ph[3 * i + k]); }
            }
            i++;
        };
        // (A block's pieces one after another: the block names them by the first and how many.)
        if (blocked) {
            for (let d = 0; d < k2; d += G) for (let b = 0; b < k1; b += G) for (let a = 0; a < k0; a += G) {
                for (let dd = d; dd < Math.min(d + G, k2); dd++) for (let bb = b; bb < Math.min(b + G, k1); bb++) for (let aa = a; aa < Math.min(a + G, k0); aa++) piece(aa, bb, dd);
            }
        } else {
            for (let a = 0; a < k0; a++) for (let b = 0; b < k1; b++) for (let d = 0; d < k2; d++) piece(a, b, d);
        }
    }
    const to = new Int32Array(bcount.length).fill(-1);
    let nk = 0;
    for (let q = 0; q < bcount.length; q++) { if (bcount[q] > 1) to[q] = nk++; }
    const bc = new Float64Array(3 * nk), bh = new Float64Array(3 * nk), bm = new Float64Array(nk), bmember = new Int32Array(nk);
    const bstart = new Int32Array(nk), bpieces = new Int32Array(nk);
    for (let q = 0; q < bcount.length; q++) {
        const t = to[q];
        if (t < 0) continue;
        for (let k = 0; k < 3; k++) { bc[3 * t + k] = (blo[3 * q + k] + bhi[3 * q + k]) / 2; bh[3 * t + k] = (bhi[3 * q + k] - blo[3 * q + k]) / 2; }
        bm[t] = bmass[q]; bmember[t] = bmem[q]; bstart[t] = bfirst[q]; bpieces[t] = bcount[q];
    }
    for (let k = 0; k < nb; k++) { if (pblock[k] >= 0) pblock[k] = to[pblock[k]]; }
    return { nb, pm, pc, ph, pmass, fixed, pblock, nk, bc, bh, bm, bmember, bstart, bpieces };
}

// The welds: every two pieces (not both fixed: what stands on a footing is welded to it) touching face to
// face, found through a grid of cells no smaller than a piece is long.
function findWelds(nb, pc, ph, fixed, chunk) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < nb; i++) {
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
                        if (j <= i || (fixed[i] && fixed[j])) continue;
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
    const crushOf = (m) => s.members[m].crush ?? s.crush ?? 3e7;
    const sigmaOf = (m) => s.members[m].sigma ?? sigma,ductileOf = (m) => Math.max(0, Math.min(7, s.members[m].ductile ?? 3));
    const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), qy = Math.sin(F.yaw / 2), qw = Math.cos(F.yaw / 2);
    const { nb, pm, pc, ph, pmass, fixed, pblock, nk, bc, bh, bm, bmember, bstart, bpieces } = cutPieces(s.members, chunk, s.block ?? 31);
    // The bodies are the pieces in no block (a ground member's among them), then the blocks: a block's pieces
    // are bodies only once it gives way (solver.bk, k_split_alloc). `at`: each piece's body, a block's piece
    // its block.
    const unitOf = new Int32Array(nb);
    let nl = 0;
    for (let i = 0; i < nb; i++) { if (pblock[i] < 0) unitOf[i] = nl++; }
    for (let i = 0; i < nb; i++) { if (pblock[i] >= 0) unitOf[i] = nl + pblock[i]; }
    const nbT = nl + nk;
    const NMs = s.members.length, grounds = s.members.filter((m) => m.ground);
    const { nw, wa, wb, warea } = findWelds(nb, pc, ph, fixed, chunk);
    const edges = s.joints.filter(([a, b]) => a < NMs && b < NMs);

    // The bodies: where they stand in the solver's space, held.
    // A block (PAR -2) stands in its pieces' place. D: a piece's half sides and mass; a block's, its first piece
    // (once it has given way), how many they are, what a weld between them holds, and how many along each side
    // (x + 32 y + 1024 z, and 32768 times how ductile): equal parts of it, counted along x, then y, then z.
    const X = new Float32Array(8 * nbT), B = new Float32Array(8 * nbT), SUP = new Int32Array(2 * nbT), MB = new Int32Array(nbT);
    // (ST: what a body crushes at, and for a block what its pieces will.)
    const ST = new Float32Array(2 * nbT);
    const PAR = new Int32Array(nbT).fill(-1), D = new Float32Array(4 * nbT);
    // (For each body: its member, centre and half sides as built, and how many pieces it is.)
    const um = new Int32Array(nbT), uc = new Float32Array(3 * nbT), uh = new Float32Array(3 * nbT), np = new Int32Array(nbT);
    const ox = F.x - origin[0], oy = F.y - origin[1], oz = F.z - origin[2];
    const stand = (i, c, k) => {
        const o = 8 * i, lx = c[3 * k], lz = c[3 * k + 2];
        X[o] = ox + cy * lx + sy * lz; X[o + 1] = oy + c[3 * k + 1]; X[o + 2] = oz - sy * lx + cy * lz;
        X[o + 5] = qy; X[o + 7] = qw;
    };
    for (let p = 0; p < nb; p++) {
        if (pblock[p] >= 0) continue;
        const i = unitOf[p], o = 8 * i, h = [ph[3 * p], ph[3 * p + 1], ph[3 * p + 2]];
        stand(i, pc, p);
        um[i] = pm[p]; uh.set(h, 3 * i); uc.set([pc[3 * p], pc[3 * p + 1], pc[3 * p + 2]], 3 * i);
        // (A ground member's pieces are fixed: no mass, held or their own.)
        if (fixed[p]) { B.set(h, o); MB[i] = -1; continue; }
        inertia(B, o, h, pmass[p]);
        MB[i] = at.nm + pm[p];
        D.set(h, 4 * i); D[4 * i + 3] = pmass[p];
        ST[2 * i] = crushOf(pm[p]);
        B.set(h, o);
        B[o + 7] = pmass[p];
        np[i] = 1;
    }
    for (let q = 0; q < nk; q++) {
        const i = nl + q, o = 8 * i, h = [bh[3 * q], bh[3 * q + 1], bh[3 * q + 2]];
        stand(i, bc, q);
        um[i] = bmember[q]; uh.set(h, 3 * i); uc.set([bc[3 * q], bc[3 * q + 1], bc[3 * q + 2]], 3 * i);
        B.set(h, o);
        B[o + 7] = bm[q];
        inertia(B, o, h, bm[q]);
        MB[i] = at.nm + bmember[q];
        ST[2 * i] = crushOf(bmember[q]); ST[2 * i + 1] = ST[2 * i];
        PAR[i] = -2;
        np[i] = bpieces[q];
        const f = bstart[q], along = (k) => Math.round(bh[3 * q + k] / ph[3 * f + k]);
        D[4 * i + 1] = bpieces[q]; D[4 * i + 2] = sigmaOf(bmember[q]); D[4 * i + 3] = along(0) + 32 * along(1) + 1024 * along(2) + 32768 * ductileOf(bmember[q]);
    }
    // The welds' records, and each body's list of its own. Between two pieces that are their own bodies from
    // the start: in force. Between a block and what it touches (a block or a lone piece): one weld for all of
    // the face they share, at the middle of it, which goes to a piece on a side whose block gives way (JA:
    // the anchor in that piece's frame, and the piece: a body, or -2 less which of its block's it is; -1 where
    // no block is), and is done with once both sides are pieces. The welds between the pieces of blocks have
    // no record here: they are made as the blocks give way (solver.bk, k_split_welds, k_split_inner), from
    // how the pieces stood.
    const unit = (i) => unitOf[i];
    // (How far the face two pieces share reaches along each axis: a box's lo and hi, widened to hold it.)
    const reach = (a, b, lo, hi) => {
        for (let k = 0; k < 3; k++) {
            const l = Math.max(pc[3 * a + k] - ph[3 * a + k], pc[3 * b + k] - ph[3 * b + k]), h = Math.min(pc[3 * a + k] + ph[3 * a + k], pc[3 * b + k] + ph[3 * b + k]);
            if (h <= l) continue;
            lo[k] = Math.min(lo[k], l); hi[k] = Math.max(hi[k], h);
        }
    };
    const across = new Map();   // unit a * nbT + unit b -> { j (its weld), a, b (pieces), area, c: [x, y, z] area-weighted }
    const lone = [];            // the welds between two lone pieces
    for (let j = 0; j < nw; j++) {
        const ua = unit(wa[j]), ub = unit(wb[j]);
        if (ua === ub) continue;
        if (ua < nl && ub < nl) { lone.push(j); continue; }
        const key = ua * nbT + ub;
        let e = across.get(key);
        if (!e) across.set(key, e = { j: across.size, ua, ub, a: wa[j], b: wb[j], best: 0, area: 0, c: [0, 0, 0], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
        reach(wa[j], wb[j], e.lo, e.hi);
        if (warea[j] > e.best) { e.best = warea[j]; e.a = wa[j]; e.b = wb[j]; }
        e.area += warea[j];
        for (let k = 0; k < 3; k++) e.c[k] += warea[j] * (pc[3 * wa[j] + k] + pc[3 * wb[j] + k]) / 2;
    }
    const nwT = across.size + lone.length;
    const JI = new Int32Array(2 * nwT), JF = new Float32Array(40 * nwT), JA = new Float32Array(8 * nwT), JC = new Int32Array(nbT), JR = new Int32Array(MAXJ * nbT);
    const list = (i, j) => { if (JC[i] < MAXJ) JR[MAXJ * i + JC[i]] = at.nj + j; JC[i]++; };
    const centre = (u, k) => uc[3 * u + k];
    const massOf = (u) => B[8 * u + 7];
    // (The piece a weld goes to on a side: the body it is, or which of its block's.)
    const goesTo = (p) => (pblock[p] < 0 ? at.n + unitOf[p] : -2 - (p - bstart[pblock[p]]));
    const weld = (j, a, b, ma, mb, area, lo, hi) => {
        const o = 40 * j;
        JI[2 * j] = at.n + a; JI[2 * j + 1] = at.n + b;
        let L = 0;
        for (let k = 0; k < 3; k++) { const d = centre(b, k) - centre(a, k); L += d * d; }
        JF[o + 9] = 1;
        // (A footing has no mass: the weld is as stiff as what stands on it is heavy.)
        const ms = ma > 0 && mb > 0 ? ma * mb / (ma + mb) : Math.max(ma, mb);
        JF[o + 31] = ms; JF[o + 32] = ms * L;
        for (let k = 0; k < 3; k++) { JF[o + 16 + k] = 1e4 * ms; JF[o + 19 + k] = 1e4 * ms * L; }
        // (As strong and as ductile as the weaker and the more brittle of the two members; its bending
        // strength, by the shape of the face it joins across, and how far it gives as solver.bk's turn_caps and
        // give_bent have them.)
        const sg = Math.min(sigmaOf(um[a]), sigmaOf(um[b])), bent = 0.04 * (1 << Math.min(ductileOf(um[a]), ductileOf(um[b])));
        const e = [0, 1, 2].map((k) => Math.max(0, hi[k] - lo[k]));
        JF[o + 28] = sg * area;
        JF[o + 29] = 0.4 * sg * area * Math.max(e[1], e[2]); JF[o + 38] = 0.4 * sg * area * Math.max(e[0], e[2]); JF[o + 39] = 0.4 * sg * area * Math.max(e[0], e[1]);
        JF[o + 34] = 0.5 * bent; JF[o + 35] = bent;
    };
    // (The blocks' welds first: a piece's list is short, and the one it may stand for a block in is not the
    // one to drop.)
    for (const e of across.values()) {
        const j = e.j, o = 40 * j;
        weld(j, e.ua, e.ub, massOf(e.ua), massOf(e.ub), e.area, e.lo, e.hi);
        for (let k = 0; k < 3; k++) {
            const c = e.c[k] / e.area;
            JF[o + k] = c - centre(e.ua, k); JF[o + 3 + k] = c - centre(e.ub, k);
            JA[8 * j + k] = c - pc[3 * e.a + k]; JA[8 * j + 4 + k] = c - pc[3 * e.b + k];
        }
        JA[8 * j + 3] = goesTo(e.a); JA[8 * j + 7] = goesTo(e.b);
        list(e.ua, j); list(e.ub, j);
    }
    lone.forEach((f, t) => {
        const j = across.size + t, a = unitOf[wa[f]], b = unitOf[wb[f]], o = 40 * j;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        reach(wa[f], wb[f], lo, hi);
        weld(j, a, b, massOf(a), massOf(b), warea[f], lo, hi);
        // (The anchor is the midpoint, in each body's frame its offset: the frame's axes are the bodies'.)
        for (let k = 0; k < 3; k++) { const d = centre(b, k) - centre(a, k); JF[o + k] = d / 2; JF[o + 3 + k] = -d / 2; }
        // (JA: no piece to go to.)
        JA[8 * j + 3] = -1; JA[8 * j + 7] = -1;
        list(a, j); list(b, j);
    });
    // (A piece joined to no ground goes with the first step, and a block is as near the ground as its nearest
    // piece. Each one's first int, the tick the ground was last heard from, is place's to set.)
    const hopOf = weldHops(nb, pc, ph, fixed, grounds, nw, wa, wb);
    for (let i = 0; i < nbT; i++) SUP[2 * i + 1] = 1 << 20;
    for (let p = 0; p < nb; p++) {
        const hop = fixed[p] ? 1 << 20 : hopOf[p] === 1 << 20 ? 1 : hopOf[p], q = 2 * unitOf[p] + 1;
        SUP[q] = Math.min(SUP[q], hop);
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
    // Its levels: the members that bear at each (a member's `level` and `bears`), by what each was built to
    // carry, what they carry in all, and what of that the level has to have left to stand.
    const levels = [];
    for (let m = 0; m < NMs; m++) {
        const M = s.members[m];
        if (!M.bears || !(M.level >= 0) || mhop[m] === 0 || MF[8 * m + 1] > 1e29 || !MF[8 * m + 5]) continue;
        const L = (levels[M.level] ??= { m: [], w: [], n: [], need: 0 });
        L.m.push(m); L.w.push(MF[8 * m + 1]); L.n.push(MF[8 * m + 5]); L.need += load[m];
    }
    return { levels: levels.filter(Boolean), at, nb: nbT, nw: nwT, nmem: NMs, ne: 2 * edges.length, X, B, ST, SUP, MB, PAR, D, JI, JF, JA, JC, JR, MF, MJ0, MJ, member: um, c: uc, h: uh, pieces: np };
}

export function createSolver(opts = {}) {
    const ITERS =opts.iters ?? ITERS0, NCOL = opts.ncol ?? NCOL0;
    const src = opts.src ?? require('fs').readFileSync(bro.resolvePath('/lib/destruct/solver.bk'), 'utf8');
    const mod = bro.kernel.compile(src, { file: 'lib/destruct/solver.bk' });
    const kernels = new Map();
    const K = (name) => { let k = kernels.get(name); if (!k) kernels.set(name, k = mod.kernel(name)); return k; };

    // (Contacts are between things in motion: their room does not grow with what stands.)
    const N = opts.capacity ?? 1 << 18, CAP = 3 << 19, NJC = N * 2, NMC = Math.max(1024, N >> 2), MEC = NMC * 12;
    const buf = (bytes) => bro.kernel.createBuffer(bytes);
    const bST = buf(8 * N);   // crushing (solver.bk, crush_cap)
    const bX = buf(32 * N), bR = buf(32 * N), bX0 = buf(32 * N), bY = buf(32 * N), bV = buf(32 * N), bB = buf(32 * N), bCOL = buf(4 * N);
    let bBC = buf(4 * N), bBR = buf(4 * 48 * N), bCI = buf(8 * CAP), bCF = buf(80 * CAP);
    let bOBC = buf(4 * N), bOBR = buf(4 * 48 * N), bOCI = buf(8 * CAP), bOCF = buf(80 * CAP);   // (the last step's)
    const bNC = buf(8), bLG = bro.kernel.createBuffer(new Int32Array(MAX_SHOTS).fill(-1));
    const bMB = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bMF = buf(32 * NMC), bMJ0 = buf(8 * NMC), bMJ = buf(4 * MEC), bMC = buf(4 * NMC);
    const bGR = bro.kernel.createBuffer(new Int32Array(N).fill(-1000)), bWHY = buf(4 * N), bSL = buf(4 * N);
    const bSUP = bro.kernel.createBuffer(new Int32Array(2 * N).fill(1 << 20)), bREL = buf(4 * N);
    const bJI = buf(8 * NJC), bJF = buf(160 * NJC), bJC = buf(4 * N), bJR = buf(4 * MAXJ * N);
    // Blocks (solver.bk, k_split_pieces): each body's block (-1 none, -2 a block), the size and mass a piece
    // takes up when its block gives way, whether a block is to give way, a weld's other ends.
    const bPAR = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bD = buf(16 * N), bSPL = buf(4 * N), bJA = buf(32 * N);
    const bDRV = buf(8 * N);   // per block, what pressed it to what a piece of it stands (body + 1) and the tick it did (solver.bk, k_dual)
    // Each piece's block as built (PAR as placed, kept: -1 a piece on its own). And the welds made as blocks
    // give way: how many (bWA), taken from the end of the welds' room back, which the structures' own welds,
    // from its start on, are kept out of (the first NJS).
    const bORG = bro.kernel.createBuffer(new Int32Array(N).fill(-1)), bWA = buf(4), NJS = N;
    // The bodies' room: the structures' bodies as built and the shots in the first NS of it, and after them the
    // pieces of the blocks that have given way, taken as they do (bPA: how many). A pass over the bodies goes
    // over both (bodies(), over()).
    const NS = opts.units ?? N >> 1, bPA = buf(4);
    const bCount = buf(4 * DIM ** 3), bSlots = buf(4 * KS * DIM ** 3), bP = buf(16 * N);
    const bCV = buf(24 * N);   // the cells each body is in: the first and the last along each axis
    // The pairs near enough to try for contacts this step (solver.bk, k_pairs): how many, which, and each
    // one's mass and margin.
    const bXP = buf(32 * N);   // each body's pose when last shown (solver.bk, k_shown)
    const bM = buf(32 * N);   // each body's motion over the step so far (solver.bk, k_begin)
    // The thread groups of the passes over the awake, their welds, the contacts, the pairs, all the welds, and
    // the bodies (in a step, and out of one: a step may be under way on the other queue), the awake's parts,
    // the awake's searches of the cells about them (NEAR each: solver.bk, k_near).
    const bG = buf(108), NEAR = 9;
    // The parts of the solve pass (solver.bk, k_primal_part): a body's contacts and welds summed a part to a
    // thread, a row of 28 floats a part, the rows handed out as the awake are listed (SB a body's first, RB a
    // row's body and part). Room: a row to eight contacts' two ends, and two to a body.
    const ROWS = (CAP >> 2) + 2 * N, bS = buf(4 * 28 * ROWS), bSB = buf(4 * N), bRB = buf(8 * ROWS);
    const LS = K('k_list').localSize;
    for (const k of ['k_rouse', 'k_split_pieces', 'k_support', 'k_mcount', 'k_begin', 'k_contacts', 'k_velocity', 'k_reach', 'k_show', 'k_shown']) {
        if (K(k).localSize !== LS) throw new Error(`solver: ${k}'s threads are grouped by ${K(k).localSize}, not ${LS}`);
    }
    const bodies = (slot) => K('k_bgroups').dispatch(1, bPA, bG, slot, n, NS, LS, N - NS);
    const over = (slot, name, ...args) => K(name).dispatchCounted(bG, 12 * slot, N, ...args);
    const PCAP = 2 * N, bNP = buf(4), bPL = buf(8 * PCAP), bPF = buf(8 * PCAP);
    const bAL = buf(4 * (N + 1)), bWL = buf(4 * (NJC + 1));   // the awake bodies, and their welds: a count, then indices
    const all = [bST, bX, bR, bX0, bY, bV, bB, bCOL, bBC, bBR, bCI, bCF, bOBC, bOBR, bOCI, bOCF, bNC, bLG, bMB, bMF, bMJ0, bMJ, bMC, bGR, bWHY, bSL, bSUP, bREL, bJI, bJF, bJC, bJR, bCount, bSlots, bCV];
    const ZERO = new Int32Array(1);

    let n = 0, nj = 0, nm = 0, me = 0, tick = 0, origin = null;
    const shots = [], LG = new Int32Array(MAX_SHOTS).fill(-1);
    let standing = null, standingRead = null;
    // The pieces' room and the made welds' are handed to the structures in runs (solver.bk, GROUP): each
    // structure a place in bGA (bGI: a body's structure's; 0 no one's), its runs kept here, a run it wants
    // handed over at the head of the next step (bGA read back a step or two late says what it wants), and all
    // of them had back when it is removed.
    const NG = 4096, bGI = buf(4 * N), bGA = bro.kernel.createBuffer(new Int32Array(GROUP * NG).map((v, k) => (k % GROUP === 2 ? -1 : 0)));
    const groups = new Map(), groupFree = [];   // place -> { pieces: [first], welds: [first], at: the tick of its last grant }
    let groupTop = 1, gaRead = null;
    const runs = { p: { free: [], top: 0, len: PIECE_RUN, cap: N - NS }, w: { free: [], top: 0, len: WELD_RUN, cap: NJC - NJS } };
    const grants = [];   // [place, kind (0 pieces, 1 welds), first]
    let pieceHigh = 0, roomWarned = false, waits = 0;
    const grantRun = (place, kind) => {
        const G = groups.get(place), r = kind ? runs.w : runs.p;
        let first = r.free.pop();
        if (first === undefined) {
            if (r.top + r.len > r.cap) { if (!roomWarned) { roomWarned = true; console.warn(`solver: no room for more ${kind ? 'welds' : 'pieces'}: blocks wait whole`); } return; }
            first = r.top; r.top += r.len;
        }
        (kind ? G.welds : G.pieces).push(first);
        if (kind) weldHigh = Math.max(weldHigh, first + r.len); else pieceHigh = Math.max(pieceHigh, first + r.len);
        grants.push([place, kind, first]);
        G.at = tick + 1;
    };
    // What each structure wants, from bGA as it was at the end of a step: pieces when it asked and had none,
    // or, once it has had any, has none waiting; welds while it has asked or holds any and has not two runs.
    const wants = (ga, asOf) => {
        for (const [place, G] of groups) {
            if (asOf < G.at) continue;
            const w = GROUP * place;
            if (w + GROUP > ga.length) continue;
            G.awake = Math.max(G.awake, ga[w + 10]);
            if (ga[w + 7] && G.pieces.length) waits++;
            if (ga[w + 7] || (G.pieces.length && ga[w + 2] < 0)) grantRun(place, 0);
            if (ga[w + 8] || G.welds.length || G.pieces.length) {
                if (ga[w + 3] >= ga[w + 4]) grantRun(place, 1);
                if (ga[w + 5] >= ga[w + 6]) grantRun(place, 1);
            }
        }
    };
    let shotRead = null, shotAt = [];
    const bReach = buf(12 * REACH_DIM * REACH_DIM + 4), REACH_ZERO = new Int32Array(3 * REACH_DIM * REACH_DIM + 1);
    let reachRead = null, reach = [], stirring = [], reachTick = 0;
    let awake = 0, awakeTick = -1, stirred = 0;   // the bodies awake at awakeTick; the tick something was last added
    const bHG = buf(4 * GROUND_DIM * GROUND_DIM);
    // (The lists' counts as they are made, three each time one is (bodies, welds, the bodies' rows), zeroed
    // once a step.)
    const LN0 = new Int32Array(3 * (ITERS + 1)), bLN = buf(LN0.byteLength);
    // (Where pieces were crushed since it was last read: solver.bk, k_velocity.)
    const bCrush = buf(8 * REACH_DIM * REACH_DIM), CRUSH_ZERO = new Int32Array(2 * REACH_DIM * REACH_DIM);
    let crushRead = null, crushed = [];
    all.push(bCrush, bGI, bGA, bS, bSB, bRB,bORG, bWA, bPA, bLN, bReach, bHG, bAL, bWL, bPAR, bD, bSPL, bJA, bP, bNP, bPL, bPF, bG, bM, bXP);

    // A structure built somewhere else (buildStructure, perhaps in a Worker) put into the world: null if there
    // is no room. Built for another place in the buffers than they have come to since (a shot fired, say), its
    // references are moved.
    function place(S) {
        if (!origin) throw new Error('solver: setOrigin first');
        const { nb, nw, nmem, ne } = S;
        // Each of its four ranges goes in a gap a removed structure left, if one is long enough, else at the end.
        const hb = gap(free.n, nb), hw = gap(free.nj, nw), hm = gap(free.nm, nmem), he = gap(free.me, ne);
        if ((hb < 0 && n + nb > NS - MAX_SHOTS + shots.length) || (hw < 0 && nj + nw > NJS) || (hm < 0 && nm + nmem > NMC) || (he < 0 && me + ne > MEC)) return noRoom('place a structure', S);
        const b0 = take(free.n, hb, nb, n), w0 = take(free.nj, hw, nw, nj), m0 = take(free.nm, hm, nmem, nm), e0 = take(free.me, he, ne, me);
        const dn = b0 - S.at.n, dj = w0 - S.at.nj, dm = m0 - S.at.nm, de = e0 - S.at.me;
        if (dn) {
            for (let k = 0; k < 2 * nw; k++) S.JI[k] += dn;
            for (let j = 0; j < nw; j++) { if (S.JA[8 * j + 3] >= 0) S.JA[8 * j + 3] += dn; if (S.JA[8 * j + 7] >= 0) S.JA[8 * j + 7] += dn; }
        }
        if (dj) for (let i = 0; i < nb; i++) { const c = Math.min(S.JC[i], MAXJ); for (let e = 0; e < c; e++) S.JR[MAXJ * i + e] += dj; }
        if (dm) { for (let i = 0; i < nb; i++) { if (S.MB[i] >= 0) S.MB[i] += dm; } for (let k = 0; k < ne; k++) S.MJ[k] += dm; }
        if (de) for (let m = 0; m < nmem; m++) S.MJ0[2 * m] += de;
        for (let i = 0; i < nb; i++) S.SUP[2 * i] = tick;
        bX.write(S.X, 32 * b0); bXP.write(S.X, 32 * b0); bR.write(S.X, 32 * b0); bB.write(S.B, 32 * b0); bST.write(S.ST, 8 * b0); bSUP.write(S.SUP, 8 * b0); bMB.write(S.MB, 4 * b0);
        bJC.write(S.JC, 4 * b0); bJR.write(S.JR, 4 * MAXJ * b0);
        bPAR.write(S.PAR, 4 * b0); bORG.write(S.PAR, 4 * b0); bD.write(S.D, 16 * b0); bSPL.write(new Int32Array(nb), 4 * b0); bDRV.write(new Int32Array(2 * nb), 8 * b0);
        if (nw) { bJI.write(S.JI, 8 * w0); bJF.write(S.JF, 160 * w0); bJA.write(S.JA, 32 * w0); }
        bMF.write(S.MF, 32 * m0); bMJ0.write(S.MJ0, 8 * m0);
        if (ne) bMJ.write(S.MJ, 4 * e0);
        const group = groupFree.pop() ?? groupTop++;
        if (group >= NG) throw new Error('solver: more structures than it has places for');
        // (What is read back of bGA from before now is not of this structure.)
        groups.set(group, { pieces: [], welds: [], at: tick + 1, awake: tick });
        bGA.write(GROUP_EMPTY, 4 * GROUP * group);
        bGI.write(new Int32Array(nb).fill(group), 4 * b0);
        const out = { group, first: b0, count: nb, pieces: S.pieces, firstMember: m0, members: nmem, firstWeld: w0, welds: nw, firstEdge: e0, edges: ne, member: S.member, c: S.c, h: S.h };
        n = Math.max(n, b0 + nb); nj = Math.max(nj, w0 + nw); nm = Math.max(nm, m0 + nmem); me = Math.max(me, e0 + ne);
        stirred = tick;
        if (S.levels?.length) { out.levels = S.levels.map((L) => ({ ...L, since: -1, fell: false })); leveled.add(out); }
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
    // A range given back: one gap with those it lies against, and no gap at all once it reaches the end of
    // what is in use (`end`, returned as it is then).
    const give = (list, start, len, end) => {
        if (!len) return end;
        list.push([start, len]);
        list.sort((a, b) => a[0] - b[0]);
        for (let k = list.length - 1; k > 0; k--) if (list[k - 1][0] + list[k - 1][1] === list[k][0]) { list[k - 1][1] += list[k][1]; list.splice(k, 1); }
        const top = list[list.length - 1];
        if (top[0] + top[1] !== end) return end;
        list.pop();
        return top[0];
    };
    // (No room: what was wanted of each, the longest gap for it, and what is left at the end.)
    const noRoom = (what, need) => {
        const row = (name, list, want, left) => `${name} ${want} (gap ${list.reduce((a, g) => Math.max(a, g[1]), 0)}, end ${left})`;
        console.warn(`solver: no room to ${what}: ${row('bodies', free.n, need.nb, NS - MAX_SHOTS + shots.length - n)}, ${row('welds', free.nj, need.nw, NJS - nj)}, ` +
                     `${row('members', free.nm, need.nmem, NMC - nm)}, ${row('joints', free.me, need.ne, MEC - me)}`);
        return null;
    };
    // A level gives way: what its bearing members can carry, by the pieces of each still joined to the ground
    // (`standing`: let go but joined counts, crushed or cut off does not), has been under what they carried
    // as built for LEVEL_TICKS; they are all given way (MF's last float: k_support lets their pieces go and
    // cuts them from the other members), and what stood on them is cut off and falls.
    const leveled = new Set(), LEVEL_TICKS = 30, GIVEN = new Float32Array([1]);
    function levelsStand() {
        for (const out of leveled) {
            const m0 = out.firstMember;
            if (m0 + out.members > standing.length) continue;
            for (const L of out.levels) {
                if (L.fell) continue;
                let can = 0;
                for (let k = 0; k < L.m.length; k++) can += L.w[k] * Math.min(1, standing[m0 + L.m[k]] / L.n[k]);
                // (A level with nothing of it joined to the ground is cut off, on one given way or on nothing:
                // it is falling, and gives way to nothing.)
                if (can >= L.need || can <= 0) { L.since = -1; continue; }
                if (L.since < 0) L.since = tick;
                if (tick - L.since < LEVEL_TICKS) continue;
                L.fell = true; fallen++;
                for (const m of L.m) bMF.write(GIVEN, 4 * (8 * (m0 + m) + 7));
                stirred = tick;
                break;
            }
        }
    }
    let fallen = 0;
    // A structure (what addStructure or place returned) out of the world, as if it had never been added: its
    // bodies without size or mass far under the ground, its welds broken, its room free for the next.
    function remove(out) {
        leveled.delete(out);
        const nb = out.count, X = new Float32Array(8 * nb), Z = new Float32Array(8 * nb), SUP = new Int32Array(2 * nb), ZI = new Int32Array(Math.max(nb * MAXJ, 2 * out.welds, 2 * out.members, out.edges));
        for (let i = 0; i < nb; i++) { X[8 * i + 1] = -1e5; X[8 * i + 7] = 1; SUP[2 * i + 1] = 1 << 20; }
        const at = 32 * out.first, zi = (k) => ZI.subarray(0, k);
        bX.write(X, at); bXP.write(X, at); bR.write(X, at); bX0.write(X, at); bY.write(X, at); bB.write(Z, at); bV.write(Z, at); bST.write(Z.subarray(0, 2 * nb), 8 * out.first); bSUP.write(SUP, 8 * out.first);
        bMB.write(new Int32Array(nb).fill(-1), 4 * out.first); bGR.write(new Int32Array(nb).fill(-1000), 4 * out.first);
        for (const b of [bJC, bWHY, bSL, bREL, bCOL, bBC, bOBC, bSPL]) b.write(zi(nb), 4 * out.first);
        bPAR.write(new Int32Array(nb).fill(-1), 4 * out.first); bORG.write(new Int32Array(nb).fill(-1), 4 * out.first); bD.write(new Float32Array(4 * nb), 16 * out.first);
        // (And the welds made between its pieces since: broken, joining nothing.)
        K('k_unweld').dispatch(NJC - NJS, bJI, bJF, bWA, bORG, out.first, nb, NJC, NJC - NJS);
        // (And the pieces its blocks gave way to.)
        K('k_unpiece').dispatch(N - NS, bORG, bPAR, bX, bX0, bB, bV, bMB, bSUP, bJC, bPA, out.first, nb, NS, N - NS);
        bJR.write(zi(nb * MAXJ), 4 * MAXJ * out.first);
        if (out.welds) {
            const JF = new Float32Array(40 * out.welds);
            for (let j = 0; j < out.welds; j++) JF[40 * j + 30] = 1;
            bJI.write(zi(2 * out.welds), 8 * out.firstWeld); bJF.write(JF, 160 * out.firstWeld);
        }
        bMF.write(new Float32Array(8 * out.members), 32 * out.firstMember); bMJ0.write(zi(2 * out.members), 8 * out.firstMember);
        if (out.edges) bMJ.write(zi(out.edges), 4 * out.firstEdge);
        // (Its runs of pieces and welds: the next structure's to want them.)
        const G = groups.get(out.group);
        runs.p.free.push(...G.pieces); runs.w.free.push(...G.welds);
        groups.delete(out.group); groupFree.push(out.group);
        bGA.write(GROUP_EMPTY, 4 * GROUP * out.group);
        bGI.write(zi(nb), 4 * out.first);
        for (let k = grants.length - 1; k >= 0; k--) if (grants[k][0] === out.group) grants.splice(k, 1);
        n = give(free.n, out.first, nb, n); nm = give(free.nm, out.firstMember, out.members, nm);
        nj = give(free.nj, out.firstWeld, out.welds, nj); me = give(free.me, out.firstEdge, out.edges, me);
        stirred = tick;
    }
    // A structure's state, to take it out of the world and put it back as it was (save, then remove; restore):
    // every row of its bodies as built, of each run of pieces and of made welds it holds, of its own welds,
    // members and members' joints, read back as they are when asked for. What numbers a row holds (a body, a
    // weld, a member, a joint, a run) are kept as counted from the structure's own first of each, its runs one
    // after another behind what it was built with: wherever it stood in the buffers, the same state saved is
    // the same bytes, and it goes back wherever there is room.
    const SAVED = {
        body: { X: [bX, 32, 1], B: [bB, 32, 1], ST: [bST, 8, 1],R: [bR, 32, 1], D: [bD, 16, 1], PAR: [bPAR, 4], ORG: [bORG, 4], SPL: [bSPL, 4], MB: [bMB, 4], SUP: [bSUP, 8], GR: [bGR, 4],
                WHY: [bWHY, 4], SL: [bSL, 4], REL: [bREL, 4], JC: [bJC, 4], JR: [bJR, 4 * MAXJ] },
        weld: { JI: [bJI, 8], JF: [bJF, 160, 1] },
        built: { JA: [bJA, 32, 1] },
        member: { MF: [bMF, 32, 1], MJ0: [bMJ0, 8], MC: [bMC, 4] },
        edge: { MJ: [bMJ, 4] },
    };
    let weldHigh = 0;
    // (The index passes over a state stop every SLICE rows, so that they can be had a little a frame.)
    const SLICE = 64;
    const some = (it, ms) => {
        for (const t = Date.now(); ;) {
            const r = it.next();
            if (r.done) return r.value;
            if (Date.now() - t >= ms) return null;
        }
    };
    function save(out) {
        const G = groups.get(out.group);
        // (A run on its way to it and not handed over yet is not its.)
        for (let k = grants.length - 1; k >= 0; k--) {
            if (grants[k][0] !== out.group) continue;
            const [, kind, first] = grants.splice(k, 1)[0], list = kind ? G.welds : G.pieces;
            list.splice(list.indexOf(first), 1); (kind ? runs.w : runs.p).free.push(first);
        }
        const ranges = {
            body: [[out.first, out.count], ...G.pieces.map((f) => [NS + f, PIECE_RUN])],
            weld: [[out.firstWeld, out.welds], ...G.welds.map((f) => [NJC - f - WELD_RUN, WELD_RUN])],
            built: [[out.firstWeld, out.welds]], member: [[out.firstMember, out.members]], edge: [[out.firstEdge, out.edges]],
            group: [[out.group, 1]],
        };
        const reads = [];
        const ask = (name, buffer, bytes, float, kind) => {
            let rows = 0;
            const parts = ranges[kind].filter((r) => r[1] > 0).map(([first, count]) => { rows += count; return buffer.readLater(first * bytes, count * bytes); });
            reads.push({ name, parts, bytes: rows * bytes, float });
        };
        for (const kind in SAVED) for (const name in SAVED[kind]) ask(name, SAVED[kind][name][0], SAVED[kind][name][1], !!SAVED[kind][name][2], kind);
        ask('GA', bGA, 4 * GROUP, false, 'group');
        const shape = { tick, nb: out.count, nw: out.welds, nmem: out.members, ne: out.edges, pieceRuns: G.pieces.length, weldRuns: G.welds.length,
                        pieces: out.pieces, member: out.member, c: out.c, h: out.h, levels: out.levels };
        const pOrd = new Map(G.pieces.map((f, k) => [f, k])), wOrd = new Map(G.welds.map((f, k) => [f, k]));
        const first = out.first, firstWeld = out.firstWeld, firstMember = out.firstMember, firstEdge = out.firstEdge;
        return {
            get ready() { return !!this.taking || reads.every((r) => r.parts.every((p) => p.ready)); },
            release() { for (const r of reads) for (const p of r.parts) p.release(); },
            /** The state, once `ready`: { tick, nb, nw, ..., X, B, ..., GA, foreign (the numbers found that
             *  are not the structure's own: none, of one whole), bytes }. */
            take() { let r; const it = this.taking ??= this.steps(); while (!(r = it.next()).done); return r.value; },
            /** take(), `ms` of it at a time: the state once it is all done, null until then. */
            takeSome(ms) { return some(this.taking ??= this.steps(), ms); },
            *steps() {
                const S = { ...shape, foreign: 0, bytes: 0 };
                for (const r of reads) {
                    const a = r.float ? new Float32Array(r.bytes / 4) : new Int32Array(r.bytes / 4);
                    let at = 0;
                    for (const p of r.parts) { p.read(a.subarray(at, at + p.byteLength / 4)); at += p.byteLength / 4; p.release(); }
                    S[r.name] = a; S.bytes += r.bytes;
                }
                const L = S.nb + S.pieceRuns * PIECE_RUN, W = S.nw + S.weldRuns * WELD_RUN;
                const body = (b) => {
                    if (b >= first && b < first + S.nb) return b - first;
                    const s = b - NS, k = pOrd.get(s - s % PIECE_RUN);
                    if (s < 0 || k === undefined) { S.foreign++; return -1; }
                    return S.nb + k * PIECE_RUN + s % PIECE_RUN;
                };
                const weld = (j) => {
                    if (j >= firstWeld && j < firstWeld + S.nw) return j - firstWeld;
                    const s = NJC - 1 - j, k = wOrd.get(s - s % WELD_RUN);
                    if (j < NJS || k === undefined) { S.foreign++; return -1; }
                    return S.nw + k * WELD_RUN + (WELD_RUN - 1 - s % WELD_RUN);
                };
                // (A weld broken and joining nothing is of bodies 0 and 0.)
                for (let j = 0; j < W; j++) {
                    if (j % SLICE === SLICE - 1) yield;
                    if (S.JI[2 * j] === 0 && S.JI[2 * j + 1] === 0 && S.JF[40 * j + 30] !== 0) continue;
                    for (let e = 0; e < 2; e++) if (S.JI[2 * j + e] >= 0) S.JI[2 * j + e] = body(S.JI[2 * j + e]);
                }
                for (let j = 0; j < S.nw; j++) for (const e of [3, 7]) if (S.JA[8 * j + e] > -0.5) S.JA[8 * j + e] = body(Math.round(S.JA[8 * j + e]));
                for (let i = 0; i < L; i++) {
                    if (i % SLICE === SLICE - 1) yield;
                    const c = Math.min(S.JC[i], MAXJ);
                    for (let e = 0; e < c; e++) S.JR[MAXJ * i + e] = weld(S.JR[MAXJ * i + e]);
                    if (S.PAR[i] >= 0) S.PAR[i] = body(S.PAR[i]);
                    if (S.ORG[i] >= 0) S.ORG[i] = body(S.ORG[i]);
                    // (A block given way: where its pieces start.)
                    if (S.PAR[i] === -2 && (S.SPL[i] === 1 || S.SPL[i] === 2)) S.D[4 * i] = body(Math.round(S.D[4 * i]));
                    if (S.MB[i] >= 0) S.MB[i] -= firstMember;
                }
                for (let m = 0; m < S.nmem; m++) S.MJ0[2 * m] -= firstEdge;
                for (let e = 0; e < S.ne; e++) S.MJ[e] -= firstMember;
                // (Its runs: each the one it ends at the end of.)
                const run = (at, ord, len) => {
                    const k = ord.get(S.GA[at + 1] - len);
                    if (S.GA[at + 1] <= 0 || k === undefined) { S.GA[at] = 0; S.GA[at + 1] = 0; return; }
                    S.GA[at] += k * len - (S.GA[at + 1] - len); S.GA[at + 1] = (k + 1) * len;
                };
                run(0, pOrd, PIECE_RUN); run(3, wOrd, WELD_RUN); run(5, wOrd, WELD_RUN);
                if (S.GA[2] >= 0) S.GA[2] = pOrd.get(S.GA[2]) ?? -1;
                for (let k = 7; k < GROUP; k++) S.GA[k] = 0;
                return S;
            },
        };
    }
    // A structure saved back in the world as it was (what place returns; null: no room for it now). `S` is
    // spent.
    function restore(S) {
        const job = restoreLater(S);
        if (!job) return job;
        while (!job.some(1000));
        return job.done();
    }
    // The same in parts: its room taken now (null: there is none), -> { some(ms) (the passes over its numbers,
    // `ms` of them at a time; true once they are through), done() (then: its rows written, what place
    // returns) }. Nothing of it is in the buffers until done().
    function restoreLater(S) {
        const { nb, nw, nmem, ne } = S;
        const hb = gap(free.n, nb), hw = gap(free.nj, nw), hm = gap(free.nm, nmem), he = gap(free.me, ne);
        if ((hb < 0 && n + nb > NS - MAX_SHOTS + shots.length) || (hw < 0 && nj + nw > NJS) || (hm < 0 && nm + nmem > NMC) || (he < 0 && me + ne > MEC)) return noRoom('place a structure', S);
        const room = (r) => r.free.length + Math.floor((r.cap - r.top) / r.len);
        if (room(runs.p) < S.pieceRuns || room(runs.w) < S.weldRuns || (!groupFree.length && groupTop >= NG)) return null;
        const b0 = take(free.n, hb, nb, n), w0 = take(free.nj, hw, nw, nj), m0 = take(free.nm, hm, nmem, nm), e0 = take(free.me, he, ne, me);
        const group = groupFree.pop() ?? groupTop++;
        const runOf = (r) => { let f = r.free.pop(); if (f === undefined) { f = r.top; r.top += r.len; } return f; };
        const pr = [], wr = [];
        for (let k = 0; k < S.pieceRuns; k++) pr.push(runOf(runs.p));
        for (let k = 0; k < S.weldRuns; k++) wr.push(runOf(runs.w));
        const L = nb + S.pieceRuns * PIECE_RUN, W = nw + S.weldRuns * WELD_RUN;
        const body = (l) => (l < nb ? b0 + l : NS + pr[Math.floor((l - nb) / PIECE_RUN)] + (l - nb) % PIECE_RUN);
        const weld = (l) => (l < nw ? w0 + l : NJC - wr[Math.floor((l - nw) / WELD_RUN)] - WELD_RUN + (l - nw) % WELD_RUN);
        // (Its room is its from now: the passes over the rooms go that far, over rows nothing is in yet.)
        n = Math.max(n, b0 + nb); nj = Math.max(nj, w0 + nw); nm = Math.max(nm, m0 + nmem); me = Math.max(me, e0 + ne);
        const steps = (function* () {
            for (let j = 0; j < W; j++) {
                if (j % SLICE === SLICE - 1) yield;
                if (S.JI[2 * j] === 0 && S.JI[2 * j + 1] === 0 && S.JF[40 * j + 30] !== 0) continue;
                for (let e = 0; e < 2; e++) if (S.JI[2 * j + e] >= 0) S.JI[2 * j + e] = body(S.JI[2 * j + e]);
            }
            for (let j = 0; j < nw; j++) for (const e of [3, 7]) if (S.JA[8 * j + e] > -0.5) S.JA[8 * j + e] = body(Math.round(S.JA[8 * j + e]));
            for (let i = 0; i < L; i++) {
                if (i % SLICE === SLICE - 1) yield;
                const c = Math.min(S.JC[i], MAXJ);
                for (let e = 0; e < c; e++) if (S.JR[MAXJ * i + e] >= 0) S.JR[MAXJ * i + e] = weld(S.JR[MAXJ * i + e]);
                if (S.PAR[i] === -2 && (S.SPL[i] === 1 || S.SPL[i] === 2) && S.D[4 * i] >= 0) S.D[4 * i] = body(Math.round(S.D[4 * i]));
                if (S.PAR[i] >= 0) S.PAR[i] = body(S.PAR[i]);
                if (S.ORG[i] >= 0) S.ORG[i] = body(S.ORG[i]);
                if (S.MB[i] >= 0) S.MB[i] += m0;
            }
            for (let m = 0; m < nmem; m++) S.MJ0[2 * m] += e0;
            for (let e = 0; e < ne; e++) S.MJ[e] += m0;
            return true;
        })();
        let through = false;
        return { some: (ms) => (through ||= some(steps, ms) === true), done };
        function done() {
        // (When the ground was last heard from, and last rested on: as long ago as they were.)
        const dt = tick - S.tick;
        for (let i = 0; i < L; i++) { S.SUP[2 * i] += dt; if (S.GR[i] >= 0) S.GR[i] += dt; }
        const run = (at, list, len) => {
            if (S.GA[at + 1] <= 0) return;
            const k = S.GA[at + 1] / len - 1;
            S.GA[at] += list[k] - k * len; S.GA[at + 1] = list[k] + len;
        };
        run(0, pr, PIECE_RUN); run(3, wr, WELD_RUN); run(5, wr, WELD_RUN);
        if (S.GA[2] >= 0) S.GA[2] = pr[S.GA[2]];
        // Each row back: the bodies as built and the structure's own welds in one piece, each run in its own.
        const bodyAt = [[b0, nb], ...pr.map((f) => [NS + f, PIECE_RUN])], weldAt = [[w0, nw], ...wr.map((f) => [NJC - f - WELD_RUN, WELD_RUN])];
        const put = (buffer, bytes, a, at) => {
            let row = 0;
            for (const [first, count] of at) {
                if (count) buffer.write(a.subarray(row * bytes / 4, (row + count) * bytes / 4), first * bytes);
                row += count;
            }
        };
        for (const name in SAVED.body) put(SAVED.body[name][0], SAVED.body[name][1], S[name], bodyAt);
        for (const b of [bX0, bXP, bY]) put(b, 32, S.X, bodyAt);
        put(bV, 32, new Float32Array(8 * L), bodyAt);
        put(bGI, 4, new Int32Array(L).fill(group), bodyAt);
        for (const name in SAVED.weld) put(SAVED.weld[name][0], SAVED.weld[name][1], S[name], weldAt);
        if (nw) bJA.write(S.JA, 32 * w0);
        bMF.write(S.MF, 32 * m0); bMJ0.write(S.MJ0, 8 * m0); bMC.write(S.MC, 4 * m0);
        if (ne) bMJ.write(S.MJ, 4 * e0);
        bGA.write(S.GA, 4 * GROUP * group);
        // (How far into the rooms anything has been handed out: the passes over them go that far.)
        for (const f of pr) pieceHigh = Math.max(pieceHigh, f + PIECE_RUN);
        for (const f of wr) weldHigh = Math.max(weldHigh, f + WELD_RUN);
        bPA.write(new Int32Array([pieceHigh])); bWA.write(new Int32Array([weldHigh]));
        groups.set(group, { pieces: pr, welds: wr, at: tick + 1, awake: tick });
        stirred = tick;
        const out = { group, first: b0, count: nb, pieces: S.pieces, firstMember: m0, members: nmem, firstWeld: w0, welds: nw, firstEdge: e0, edges: ne, member: S.member, c: S.c, h: S.h };
        // (Its levels are watched again, the ones given way still given way.)
        if (S.levels?.length) { out.levels = S.levels.map((L) => ({ ...L, since: -1 })); leveled.add(out); }
        return out;
        }
    }
    // Where the next structure goes in the buffers (buildStructure's `at`).
    const where = () => ({ origin: origin.slice(), n, nj, nm, me });
    const addStructure = (s) => {
        if (!origin) throw new Error('solver: setOrigin first');
        return place(buildStructure(s, where()));
    };

    function fire(o) {
        if (!origin) throw new Error('solver: setOrigin first');
        if (shots.length >= MAX_SHOTS || n >= NS) return -1;
        const i = n++, X = new Float32Array(8), V = new Float32Array(8), B = new Float32Array(8);
        for (let k = 0; k < 3; k++) { X[k] = o.position[k] - origin[k]; V[k] = o.velocity[k]; }
        X[7] = 1;
        B.set(o.half, 0); B[3] = o.mass;
        inertia(B, 0, o.half, o.mass);
        bX.write(X, 32 * i); bXP.write(X, 32 * i); bR.write(X, 32 * i); bV.write(V, 32 * i); bB.write(B, 32 * i);
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
        over(5, 'k_rouse', bX, bB, bSUP, bREL, p[0], p[1], p[2], r + 1.5);
        stirred = tick;
        shots.splice(shots.indexOf(body), 1);
        LG.fill(-1); LG.set(shots);
        bLG.write(LG);
        const X = new Float32Array(8);
        X[1] = -1e5; X[7] = 1;
        bX.write(X, 32 * body); bXP.write(X, 32 * body); bR.write(X, 32 * body); bB.write(new Float32Array(8), 32 * body); bV.write(new Float32Array(8), 32 * body);
        bSUP.write(new Int32Array([0, 1 << 20]), 8 * body);
    }

    let job = null;
    function step() {
        if (!n) return;
        tick++;
        // The blocks marked in the last step give way to their pieces.
        for (const [place, kind, first] of grants.splice(0)) {
            if (kind) K('k_weld_run').dispatch(WELD_RUN, bJI, bJF, first, NJC);
            else K('k_piece_run').dispatch(PIECE_RUN, bORG, bPAR, bX, bX0, bXP, bB, bV, bMB, bSUP, bJC, first, NS);
            K('k_grant').dispatch(1, bGA, bPA, bWA, place, kind, first);
        }
        K('k_runs').dispatch(groupTop, bGA);
        K('k_split_alloc').dispatch(n, bPAR, bSPL, bD, bR, bB, bMB, bSUP, bORG, bGI, bGA, NS, N - NS);
        bodies(5);
        over(5, 'k_split_pieces', bX, bX0, bR, bV, bB, bD, bPAR, bSPL, bSUP, bREL, bSL, bXP, bST, bDRV, tick);
        if (nj) K('k_split_welds').dispatch(nj, bJI, bJF, bJA, bORG, bSPL, bR, bD, bJC, bJR, bGI, bGA, NJC, NJC - NJS);
        K('k_split_inner').dispatch(n, bPAR, bSPL, bR, bD, bJI, bJF, bJC, bJR, bGI, bGA, NJC, NJC - NJS);
        K('k_split_blocks').dispatch(n, bX, bV, bB, bPAR, bSPL, bSUP, bSL, bWHY);
        const nl = shots.length;
        const support = () => over(5, 'k_support',bB, bV, bSUP, bREL, bJI, bJF, bJC, bJR, bX0, bY, bMB, bMF, bSL, bGR, bWHY, bCOL, tick, RATE, H);
        if (nm) {
            K('k_mclear').dispatch(nm, bMC);
            over(5, 'k_mcount', bB, bSUP, bMB, bMC, bPAR, bSPL, bD, tick, RATE);
            for (let r = 0; r < RATE; r++) K('k_mload').dispatch(nm, bMF, bMC, bMJ0, bMJ);
        }
        K('k_clear').dispatch(DIM ** 3, bCount);
        bNC.write(ZERO); bNP.write(ZERO);
        [bBC, bOBC] = [bOBC, bBC]; [bBR, bOBR] = [bOBR, bBR]; [bCI, bOCI] = [bOCI, bCI]; [bCF, bOCF] = [bOCF, bCF];
        over(5, 'k_begin', bX, bX0, bY, bV, bB, bBC, bCount, bSlots, bLG, bP, bM, nl, H, SIZE, DIM, bCV, bNC);
        for (let r = 0; r < RATE; r++) support();
        over(5, 'k_contacts', bX0, bB, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bV, bLG, bHG, nl, CAP, H, GROUND_CELL, GROUND_DIM, bREL);
        // (What may touch what, over the awake as they are listed now: the list's last place in LN is this
        // one's.)
        bLN.write(LN0);
        over(5, 'k_list', bB, bAL, bLN, 3 * ITERS, bBC, bJC, bSB, bRB, 3 * ITERS + 2, ROWS);
        K('k_listed').dispatch(1, bLN, 3 * ITERS, bAL, bG, 0, K('k_primal').localSize, N);
        K('k_counted').dispatch(1, bLN, 3 * ITERS, bG, 8, K('k_near').localSize, N, NEAR);
        K('k_near').dispatchCounted(bG, 96, NEAR * N, bX0, bB, bCount, bSlots, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bV, bLG, bJI, bJF, bJC, bJR, bP, bNP, bPL, bPF, bAL, PCAP, nl, CAP, SIZE, DIM, H, bCV);
        // The passes go over what is awake, by list (k_list, k_wlist), and over the pairs and contacts there
        // are, so a step costs what is moving and not what exists. How long each is the GPU reads for itself
        // as a pass runs (dispatchCounted; k_groups writes the counts into bG): the step waits for nothing.
        const groups = (count, at, cap, kernel) => K('k_groups').dispatch(1, count, bG, at, K(kernel).localSize, cap);
        groups(bNP, 3, PCAP, 'k_pairs');
        K('k_pairs').dispatchCounted(bG, 36, PCAP, bX0, bB, bCI, bCF, bNC, bBC, bBR, bOCI, bOCF, bOBC, bOBR, bNP, bPL, bPF, CAP);
        groups(bNC, 2, CAP, 'k_dual');
        // (The welds there are: the structures', and those made since.)
        // (Welds there may be with a structure in the world: built, or made as a block gave way.)
        const welds = nm > 0;
        if (welds) K('k_wgroups').dispatch(1, bWA, bG, 4, nj, K('k_wlist').localSize, NJC - NJS);
        let made = 0, rows = 0;
        const lists = () => {
            over(5, 'k_list', bB, bAL, bLN, 3 * made, bBC, bJC, bSB, bRB, 3 * made + 2, ROWS);
            K('k_listed').dispatch(1, bLN, 3 * made, bAL, bG, 0, K('k_primal').localSize, N);
            K('k_counted').dispatch(1, bLN, 3 * made + 2, bG, 7, K('k_primal_part').localSize, ROWS, 1);
            if (welds) {
                K('k_wlist').dispatchCounted(bG, 48, NJC, bB, bJI, bJF, bWL, bLN, 3 * made + 1, bWA, nj, NJC, NJC - NJS);
                K('k_listed').dispatch(1, bLN, 3 * made + 1, bWL, bG, 1, K('k_jdual').localSize, NJC);
            }
            rows = 3 * made + 2;
            made++;
        };
        lists();
        if (welds) K('k_jbegin').dispatchCounted(bG, 12, NJC, bJI, bJF, bX0, bWL);
        K('k_uncolour').dispatchCounted(bG, 0, N, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR, bAL);
        for (let r = 0; r < ROUNDS; r++) K('k_colour').dispatchCounted(bG, 0, N, bCOL, bB, bCI, bBC, bBR, bJI, bJC, bJR, bAL, NCOL);
        for (let it = 0; it <= ITERS; it++) {
            const alpha = it < ITERS ? 1 : 0;
            for (let c = 0; c <= NCOL; c++) {
                K('k_primal_part').dispatchCounted(bG, 84, ROWS, bX, bX0, bB, bCI, bCF, bBC, bBR, bCOL, bJI, bJF, bJC, bJR, bRB, bM, bS, alpha, c, bLN, rows, ROWS, bST, bD);
                K('k_primal').dispatchCounted(bG, 0, N, bX, bX0, bY, bB, bBC, bCOL, bJC, bAL, bM, bS, bSB, H, c, OMEGA);
            }
            if (it < ITERS) K('k_dual').dispatchCounted(bG, 24, CAP, bX, bX0, bCI, bCF, bNC, bREL, bB, bV, bSUP, bGR, bPAR, bSPL, alpha, tick, bST, bD, bDRV);
            // (A held piece struck in this pass goes now: the passes left carry the blow on through it.)
            if (it < ITERS - 1) { support(); lists(); }
            // (A weld breaks only on the step's settled forces.)
            if (it < ITERS && welds) K('k_jdual').dispatchCounted(bG, 12, NJC, bJI, bJF, bX, bWL, alpha, tick, it === ITERS - 1 ? 1 : 0, bB, bREL);
            if (it === ITERS - 1) over(5, 'k_velocity', bX, bX0, bV, bB, bSL, bSUP, H, SLEEP, GROUND_CELL * GROUND_DIM / 2 - 2 * GROUND_CELL, bST, bJC, bJR, bJF, tick, bCrush, REACH_CELL, REACH_DIM);
        }
        // What the page asks about, copied without waiting: read a step or two on.
        if (!gaRead || gaRead.r.ready) {
            if (gaRead) {
                const ga = gaRead.r.read(new Int32Array(gaRead.r.byteLength / 4));
                gaRead.r.release();
                wants(ga, gaRead.tick);
            }
            gaRead = { r: bGA.readLater(0, 4 * GROUP * groupTop), tick };
        }
        if (nm && (!standingRead || standingRead.ready)) {
            if (standingRead) { standing = standingRead.read(new Int32Array(standingRead.byteLength / 4)); standingRead.release(); levelsStand(); }
            standingRead = bMC.readLater(0, 4 * nm);
        }
        if (!reachRead || reachRead.ready) {
            if (reachRead) {
                const c = reachRead.read(new Int32Array(3 * REACH_DIM * REACH_DIM + 1)), A = 2 * REACH_DIM * REACH_DIM + 1;
                reachRead.release();
                awake = c[A - 1]; awakeTick = reachTick;
                reach = []; stirring = [];
                for (let k = 0; k < REACH_DIM * REACH_DIM; k++) {
                    if (c[A + k]) stirring.push({ x: origin[0] + (k % REACH_DIM - REACH_DIM / 2 + 0.5) * REACH_CELL, z: origin[2] + (Math.floor(k / REACH_DIM) - REACH_DIM / 2 + 0.5) * REACH_CELL, count: c[A + k] });
                    if (!c[2 * k]) continue;
                    reach.push({ x: origin[0] + (k % REACH_DIM - REACH_DIM / 2 + 0.5) * REACH_CELL, y: origin[1] + c[2 * k + 1] / c[2 * k],
                                 z: origin[2] + (Math.floor(k / REACH_DIM) - REACH_DIM / 2 + 0.5) * REACH_CELL, count: c[2 * k] });
                }
            }
            if (crushRead) {
                const c = crushRead.read(new Int32Array(2 * REACH_DIM * REACH_DIM));
                crushRead.release();
                crushed = [];
                for (let k = 0; k < REACH_DIM * REACH_DIM; k++) {
                    if (!c[2 * k]) continue;
                    crushed.push({ x: origin[0] + (k % REACH_DIM - REACH_DIM / 2 + 0.5) * REACH_CELL, y: origin[1] + c[2 * k + 1] / c[2 * k],
                                   z: origin[2] + (Math.floor(k / REACH_DIM) - REACH_DIM / 2 + 0.5) * REACH_CELL, count: c[2 * k] });
                }
            }
            crushRead = bCrush.readLater();
            bCrush.write(CRUSH_ZERO);
            bReach.write(REACH_ZERO);
            over(5, 'k_reach', bX, bV, bB, bReach, REACH_CELL, REACH_DIM, bGI, bGA, tick);
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
        setOrigin(p, heights) {
            if (origin) throw new Error('solver: the origin is set');
            origin = p.slice();
            if (heights) heights(bHG, { origin, dim: GROUND_DIM, cell: GROUND_CELL });
        },
        addStructure, where, place, remove, save, restore, restoreLater, fire, step,
        show(out, spheres, pieceSpheres) {
            if (!n) return;
            bodies(6);
            over(6, 'k_show', bX, bXP, bR, bB, bJI, bJF, bJC, bJR, bPAR, bD, out, spheres, pieceSpheres, NS, origin[0], origin[1], origin[2]);
            over(6, 'k_shown', bX, bXP);
        },
        // A table the page keeps of the bodies as built, 12 floats a row (solver.bk, k_piece_rows), brought up
        // to the pieces blocks have given way to: their rows made from their blocks'.
        pieceRows(rows) {
            if (n) K('k_piece_rows').dispatch(N - NS, bORG, bR, bD, rows, bPA, NS, N - NS);
        },
        stepLater(after, steps = 1) {
            job = bro.kernel.background(() => { for (let k = 0; k < steps; k++) step(); after?.(); });
            return job;
        },
        get busy() { if (job && job.done) job = null; return job !== null; },
        finish() {
            if (!job) return;
            bro.kernel.background(() => { bNC.read(new Int32Array(1)); });
            job = null;
        },
        standing: () => standing,
        /** How many of a structure's bodies are not as built (a block given way, a body off where it stood, a
         *  weld of it broken), read back later: { ready, read() -> count, release() }. With the solver still. */
        intact(out) {
            const b = buf(4);
            K('k_intact').dispatch(out.count, bX, bR, bB, bSPL, bJF, bJC, bJR, b, out.first);
            const r = b.readLater();
            return { get ready() { return r.ready; }, read: () => r.read(new Int32Array(1))[0], release() { r.release(); b.destroy(); } };
        },
        shots: () => shotAt,
        shotBodies: () => shots,
        reach: () => reach,
        crushed: () => crushed,
        get fallen() { return fallen; },
        stirring: () => stirring,
        get quiet() { return awakeTick > stirred + 8 && awake === 0; },
        get awake() { return awake; },
        get count() { return n; },
        // (The bodies in the buffers: the structures' own and the shots are the first `count` of them, and the
        // pieces of the blocks that have given way come from `units` on: as far as `pieces` of that room.)
        units: NS,
        get pieces() { return pieceHigh; },
        // The runs of the pieces' room structure `out` holds: the body each starts at, and how long each is.
        // The tick a body of structure `out` was last found awake, as heard a step or two late (the tick it
        // was placed, until then).
        lastAwake(out) { return groups.get(out.group).awake; },
        runs(out) { return { first: groups.get(out.group).pieces.map((f) => NS + f), length: PIECE_RUN }; },
        get members() { return nm; },
        get welds() { return nj; },
        /** What of its room is used, [used, of] each (read back from the GPU as of the steps so far: for a
         *  test or a look, not each frame): the bodies as built, the pieces blocks gave way to, the welds as
         *  built and those made between pieces, the members and their edges. */
        get room() {
            // (Less the gaps removed structures have left, which the next ones take. The pieces and the welds
            // made: the runs the structures hold, whole.)
            const held = (list) => list.reduce((a, g) => a + g[1], 0);
            let rp = 0, rw = 0;
            for (const G of groups.values()) { rp += G.pieces.length; rw += G.welds.length; }
            return { units: [n - held(free.n), NS], pieces: [rp * PIECE_RUN, N - NS], welds: [nj - held(free.nj), NJS], made: [rw * WELD_RUN, NJC - NJS],
                     members: [nm - held(free.nm), NMC], edges: [me - held(free.me), MEC], waits };
        },
        get tick() { return tick; },
        get origin() { return origin; },
        capacity: N,
        // (The ground as the solver has it, for what else falls on it: heights less the origin's, `dim` a side,
        // `cell` metres apart, the middle one the origin's. Written once, at setOrigin.)
        get ground() { return origin ? { buffer: bHG, origin, dim: GROUND_DIM, cell: GROUND_CELL } : null; },
        // (As they are now: the contacts' swap with the last step's each step.)
        get buffers() {
            return { GI: bGI, GA: bGA, ST: bST, X: bX, R: bR, V: bV, B: bB, SUP: bSUP, SL: bSL, WHY: bWHY, MF: bMF, MC: bMC, JF: bJF, JC: bJC, cells: bCount, NC: bNC, PAR: bPAR, ORG: bORG, WA: bWA, SPL: bSPL, PA: bPA, D: bD, S: bS, SB: bSB, RB: bRB, LN: bLN,
                     X0: bX0, Y: bY, CI: bCI, CF: bCF, BC: bBC, BR: bBR, COL: bCOL, JI: bJI, JR: bJR, AL: bAL, groups: bG, M: bM, NP: bNP,
                     JA: bJA, MB: bMB, MJ0: bMJ0, MJ: bMJ, GR: bGR, REL: bREL, XP: bXP, OBC: bOBC, OBR: bOBR };
        },
        contactRoom: CAP,
        destroy() { for (const b of all) b.destroy(); },
    };
}
