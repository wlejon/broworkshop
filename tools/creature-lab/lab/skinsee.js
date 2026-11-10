// The skin, seen: whether each limb has a skin of its own, and where the
// skin is pulled as the bones move.
//
//   bound     at rest, each limb (a chain of bones out to a leaf) is cut
//             across at points along it. A limb that is its own has a loop
//             of its own skin about each: skin that follows the limb's
//             bones. One drawn inside another mass (an arm laid against the
//             trunk it was meshed with) has the other's skin in that loop,
//             or no loop at all: there is no arm there to move, and moving
//             its bones pulls a web out of the body.
//   stretch   through a run, every edge of the mesh against its rest
//             length. Where the skin is pulled past STRETCH or crushed
//             under SQUASH is listed by the bones either side of it, and
//             drawn: the body coloured by how far each triangle's edges
//             are from rest, at rest's shape (blue crushed, red pulled).
//
// Both read only the body's mesh, its bone weights and the skeleton.

import { skinPositions } from "./form.js";
import { lastCycle, sampleRows, relativePose, rootOf } from "./cycle.js";
import { groundHeights } from "./run.js";
import { restExtent } from "./turnaround.js";
import { setPose, capture, orbitView, showGround } from "./lit.js";
import { debugPlanes } from "./shots.js";
import { beginSheet, saveSheet, text, rect, DIM } from "./page.js";

export const SKIN = {
    own: 0.5,        // a vertex is the limb's when this much of its weight is on the limb's bones
    foreign: 0.2,    // share of a cut's loop that may be another's skin
    root: 0.3,       // share of a limb's length that may lie inside the body it grows from
    stretch: 1.6,    // an edge this many times its rest length is pulled
    squash: 0.5,     // one under this share of it is crushed
    area: 0.004,     // share of the skin's edges pulled or crushed before a place is listed
};

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// The skeleton's limbs: from each leaf up while the bones carry nothing else.
export function limbsOf(skel) {
    const kids = skel.bones.map(() => []);
    // (The face's bones carry no skin: a head is a limb's end with or without them.)
    for (const b of skel.bones) if (b.parentIndex >= 0 && !b.face) kids[b.parentIndex].push(b.index);
    const out = [];
    for (const b of skel.bones) {
        if (kids[b.index].length || b.face) continue;
        const chain = [];
        let i = b.index;
        while (i >= 0 && skel.bones[i].parentIndex >= 0) {
            chain.unshift(i);
            const p = skel.bones[i].parentIndex;
            if (kids[p].length > 1) break;
            i = p;
        }
        if (chain.length) out.push({ name: skel.bones[chain[0]].name, chain, parent: skel.bones[chain[0]].parentIndex });
    }
    return out;
}

// The loops mesh X is cut in by the plane through `at` square to n; each
// point { p, a, b, s }: on the edge a-b, s of the way along it.
function slice(X, idx, at, n) {
    const nv = X.length / 3, off = dot3(at, n);
    const sd = new Float32Array(nv);
    for (let v = 0; v < nv; v++) sd[v] = X[3 * v] * n[0] + X[3 * v + 1] * n[1] + X[3 * v + 2] * n[2] - off;
    const points = new Map(), next = new Map();
    const pointOn = (a, b) => {
        const key = a < b ? a * nv + b : b * nv + a;
        if (!points.has(key)) {
            const s = sd[a] / (sd[a] - sd[b]);
            points.set(key, { p: [0, 1, 2].map((k) => X[3 * a + k] + (X[3 * b + k] - X[3 * a + k]) * s), a, b, s });
        }
        return key;
    };
    for (let i = 0; i < idx.length; i += 3) {
        const t = [idx[i], idx[i + 1], idx[i + 2]];
        const ends = [];
        for (let e = 0; e < 3; e++) {
            const a = t[e], b = t[(e + 1) % 3];
            if ((sd[a] > 0) !== (sd[b] > 0)) ends.push({ key: pointOn(a, b), up: sd[a] <= 0 });
        }
        if (ends.length !== 2) continue;
        const [e0, e1] = ends[0].up ? [ends[0], ends[1]] : [ends[1], ends[0]];
        next.set(e0.key, e1.key);
    }
    const loops = [], seen = new Set();
    for (const k0 of next.keys()) {
        if (seen.has(k0)) continue;
        const loop = [];
        let k = k0;
        while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(points.get(k)); k = next.get(k); }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

// The loop of `loops` that winds about `at` (in the plane square to n), or null.
function loopAbout(loops, at, n) {
    const u0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = cross3(n, u0); const l1 = Math.hypot(...e1); e1 = e1.map((x) => x / l1);
    const e2 = cross3(n, e1);
    const uv = (p) => { const d = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]; return [dot3(d, e1), dot3(d, e2)]; };
    let best = null, bestR = Infinity;
    for (const loop of loops) {
        let wind = 0, rmax = 0;
        for (let i = 0; i < loop.length; i++) {
            const a = uv(loop[i].p), b = uv(loop[(i + 1) % loop.length].p);
            if ((a[1] > 0) !== (b[1] > 0) && a[0] + (b[0] - a[0]) * (-a[1] / (b[1] - a[1])) > 0) wind++;
            rmax = Math.max(rmax, Math.hypot(a[0], a[1]));
        }
        // (Of nested loops about it, the innermost.)
        if (wind % 2 && rmax < bestR) { bestR = rmax; best = loop; }
    }
    return best;
}

// Whether each limb is bound in a skin of its own. Per limb: its cuts (bone,
// where along it, the share of the loop about it that is another's skin and
// whose, or `none` when no skin closes about the bone there), and `joined`:
// the cuts past its root joint that are not its own.
export function boundLimbs(creature) {
    const { skel, body } = creature;
    const X = body.positions, idx = body.indices, W = body.weights;
    const main = body._main || (body._main = W.map((ws) => ws.reduce((a, x) => (x.w > a.w ? x : a), ws[0]).index));
    const hasVerts = new Set(main);
    let bonePiece = null;
    if (body.piece) {
        const counts = skel.bones.map(() => new Map());
        for (let v = 0; v < main.length; v++) {
            const b = main[v], p = body.piece[v] | 0;
            counts[b].set(p, (counts[b].get(p) || 0) + 1);
        }
        bonePiece = counts.map((m) => {
            let bestP = 0, bestN = 0;
            for (const [p, n] of m) if (n > bestN) { bestN = n; bestP = p; }
            return bestP;
        });
    }
    return limbsOf(skel).map((L) => {
        const mine = new Set(L.chain);
        // Bones whose main vertices inhabit the same dedicated non-body piece (p > 0,
        // e.g. a separate wing/fin vane) co-own that piece; single-mesh wings (p === 0) do not.
        if (bonePiece) {
            const pieces = new Set();
            for (const bi of L.chain) if (hasVerts.has(bi)) pieces.add(bonePiece[bi]);
            if (pieces.size === 1) {
                const [lp] = pieces;
                if (lp > 0) for (let bi = 0; bi < bonePiece.length; bi++) if (bonePiece[bi] === lp) mine.add(bi);
            }
        }
        const own = (v) => W[v].reduce((s, x) => s + (mine.has(x.index) ? x.w : 0), 0);
        const cuts = [];
        const total = L.chain.reduce((s, bi) => s + skel.bones[bi].length, 0);
        let before = 0;
        L.chain.forEach((bi, ci) => {
            const b = skel.bones[bi];
            const start = before;
            before += b.length;
            if (b.length < 0.02) return;
            const n = [0, 1, 2].map((k) => (b.tail[k] - b.head[k]) / b.length);
            // (The limb's first bone meets the body at its head: cut it from its middle on.)
            for (const t of ci === 0 ? [0.5, 0.8] : [0.2, 0.5, 0.8]) {
                const at = [0, 1, 2].map((k) => b.head[k] + (b.tail[k] - b.head[k]) * t);
                const loop = loopAbout(slice(X, idx, at, n), at, n);
                const along = (start + t * b.length) / total;
                if (!loop) { cuts.push({ bone: b.name, t, along, none: true, foreign: 1, whose: null }); continue; }
                // Whose skin: the other's nearest the bone.
                let girth = 0, other = 0, whose = -1, near = Infinity;
                for (let i = 0; i < loop.length; i++) {
                    const p = loop[i], q = loop[(i + 1) % loop.length];
                    const len = Math.hypot(q.p[0] - p.p[0], q.p[1] - p.p[1], q.p[2] - p.p[2]);
                    girth += len;
                    if (own(p.a) * (1 - p.s) + own(p.b) * p.s < SKIN.own) {
                        other += len;
                        const m = main[p.s < 0.5 ? p.a : p.b], d = Math.hypot(p.p[0] - at[0], p.p[1] - at[1], p.p[2] - at[2]);
                        if (!mine.has(m) && d < near) { near = d; whose = m; }
                    }
                }
                cuts.push({ bone: b.name, t, along, none: false, foreign: other / Math.max(girth, 1e-9), girth, whose: whose >= 0 ? skel.bones[whose].name : null });
            }
        });
        // Carved ear hollows open a crescent cross-section around the ear axis so
        // loopAbout sees even winding (`none`) even though the ear owns skin vertices.
        const earCarved = /^ear/i.test(L.name) && L.chain.some((bi) => hasVerts.has(bi));
        const joined = cuts.filter((c) => (c.none ? !earCarved : c.foreign > SKIN.foreign));
        // Where it comes out of the body: the furthest cut along it that is not its own.
        const emerges = joined.reduce((m, c) => Math.max(m, c.along), 0);
        return { name: L.name, bones: L.chain.map((i) => skel.bones[i].name), cuts, joined, emerges };
    });
}

export function boundFlags(creature) {
    const skel = creature.skel;
    const plantigrade = skel.feet.length > 0 && skel.feet.every((f) => !!f.heel);
    const legTops = new Set(skel.parts.legs.map((l) => skel.bones[l.top].name));
    const flags = [];
    for (const L of boundLimbs(creature)) {
        // Internal scapular/pelvic girdles on non-plantigrade animals and short tail
        // roots naturally sit deeper inside trunk musculature than humanoid shoulders/hips.
        const deepGirdle = /^scap/i.test(L.name)
            || (!plantigrade && legTops.has(L.name) && (L.bones.length >= 4 || skel.feet.length > 2))
            || /^tail/i.test(L.name);
        if (L.emerges <= (deepGirdle ? 0.55 : SKIN.root)) continue;
        const by = new Map();
        for (const c of L.joined) {
            const k = c.bone;
            const e = by.get(k) || { n: 0, worst: 0, whose: null, none: 0 };
            e.n++; e.none += c.none ? 1 : 0;
            if (c.foreign >= e.worst) { e.worst = c.foreign; e.whose = c.whose || e.whose; }
            by.set(k, e);
        }
        const parts = [...by].map(([bone, e]) => (e.none === e.n ? `${bone} has no skin about it` : `${bone} is in ${e.whose || 'another'}'s skin (${Math.round(100 * e.worst)}% of the loop about it)`));
        flags.push(`bound: ${L.name} is not its own at rest: ${parts.join('; ')} (in the body for ${Math.round(100 * L.emerges)}% of its length)`);
    }
    return flags;
}

// The mesh's edges and their rest lengths.
function edgesOf(body) {
    if (body._edges) return body._edges;
    const idx = body.indices, X = body.positions, nv = X.length / 3;
    const seen = new Set(), a = [], b = [];
    for (let i = 0; i < idx.length; i += 3) for (let e = 0; e < 3; e++) {
        const p = idx[i + e], q = idx[i + (e + 1) % 3], key = p < q ? p * nv + q : q * nv + p;
        if (seen.has(key)) continue;
        seen.add(key); a.push(Math.min(p, q)); b.push(Math.max(p, q));
    }
    const len = (Y, i) => Math.hypot(Y[3 * a[i]] - Y[3 * b[i]], Y[3 * a[i] + 1] - Y[3 * b[i] + 1], Y[3 * a[i] + 2] - Y[3 * b[i] + 2]);
    const rest = Float32Array.from(a, (_, i) => len(X, i));
    let total = 0;
    for (const l of rest) total += l;
    return (body._edges = { a, b, rest, total, len });
}

// Mesh X against rest: per vertex the furthest any of its edges is from its
// rest length (as a ratio: over 1 pulled, under 1 crushed), and the places
// it is pulled or crushed, by the bones either side: { key, kind, worst,
// share (of the skin's edge length) }.
export function stretchOf(creature, X) {
    const body = creature.body, E = edgesOf(body);
    const W = body.weights;
    const main = body._main || (body._main = W.map((ws) => ws.reduce((a, x) => (x.w > a.w ? x : a), ws[0]).index));
    const nv = X.length / 3;
    const ratio = new Float32Array(nv).fill(1);
    const places = new Map();
    for (let i = 0; i < E.a.length; i++) {
        if (E.rest[i] < 5e-4) continue;
        const r = E.len(X, i) / E.rest[i];
        for (const v of [E.a[i], E.b[i]]) if (Math.abs(Math.log(r)) > Math.abs(Math.log(ratio[v]))) ratio[v] = r;
        const kind = r > SKIN.stretch ? 'pulled' : r < SKIN.squash ? 'crushed' : null;
        if (!kind) continue;
        const m = [main[E.a[i]], main[E.b[i]]].sort((p, q) => p - q);
        const key = `${kind} ${m[0]} ${m[1]}`;
        const e = places.get(key) || { kind, bones: m, worst: r, share: 0 };
        e.worst = kind === 'pulled' ? Math.max(e.worst, r) : Math.min(e.worst, r);
        e.share += E.rest[i] / E.total;
        places.set(key, e);
    }
    return { ratio, places: [...places.values()] };
}

const nameOf = (skel, m) => (m[0] === m[1] ? `${skel.bones[m[0]].name}'s skin` : `the skin between ${skel.bones[m[0]].name} and ${skel.bones[m[1]].name}`);

// A run's skin: sampled through its last cycle (or the run), each place at
// its worst. Returns { places: [{ kind, where, worst, share, at }], samples }.
export function skinInMotion(rec, { samples = 12 } = {}) {
    const creature = rec.creature, skel = creature.skel;
    const cyc = lastCycle(rec);
    const rows = sampleRows(rec, samples, cyc);
    const best = new Map();
    for (const smp of rows) {
        const X = skinPositions(creature, rec.pose, smp.step * rec.poseStride);
        for (const p of stretchOf(creature, X).places) {
            const key = `${p.kind} ${p.bones.join(' ')}`;
            const e = best.get(key);
            if (!e || p.share > e.share) best.set(key, { kind: p.kind, bones: p.bones, where: nameOf(skel, p.bones), worst: p.worst, share: p.share, at: smp.label });
        }
    }
    const places = [...best.values()].filter((p) => p.share > SKIN.area).sort((a, b) => b.share - a.share);
    return { places, samples: rows };
}

export function skinFlags(motion) {
    return motion.places.map((p) => `skin: ${p.where} is ${p.kind} to ${p.worst.toFixed(1)}x its rest length over ${(100 * p.share).toFixed(1)}% of the skin (${p.at})`);
}

// --- the sheet -----------------------------------------------------------------

function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
}

// Blue (crushed to a third) through grey (rest) to red (pulled to three times).
function heat(r) {
    const t = Math.max(-1, Math.min(1, Math.log(r) / Math.log(3)));
    const a = Math.abs(t), g = 0.78;
    return t >= 0 ? [g + (0.9 - g) * a, g * (1 - a), g * (1 - a) * 0.9] : [g * (1 - a), g * (1 - 0.6 * a), g + (0.95 - g) * a];
}

// One shot of the posed body coloured by `ratio` (per vertex), shaded by the
// lit picture. The ratio rides the skin hook's piece view as a level.
function heatShot(creature, ratio, view, cw, ch) {
    const lit = capture(view, cw, ch);
    const lv = Float32Array.from(ratio, (r) => Math.round(127 + 126 * Math.max(-1, Math.min(1, Math.log(r) / Math.log(3)))));
    creature.pieceBuf.write(lv);
    let id;
    try { id = debugPlanes(view, cw, ch).piece; } finally { creature.pieceBuf.write(creature.body.piece); }
    const out = new ImageData(cw, ch);
    for (let i = 0; i < cw * ch; i++) {
        const o = 4 * i;
        const lum = (0.3 * lit.data[o] + 0.59 * lit.data[o + 1] + 0.11 * lit.data[o + 2]) / 255;
        if (id[i] < 0) { const g = 205 + 40 * lum; out.data[o] = out.data[o + 1] = out.data[o + 2] = g; out.data[o + 3] = 255; continue; }
        const c = heat(Math.pow(3, (id[i] - 127) / 126)), k = 0.55 + 0.6 * lum;
        for (let q = 0; q < 3; q++) out.data[o + q] = Math.min(255, 255 * c[q] * k);
        out.data[o + 3] = 255;
    }
    return out;
}

const VIEWS = [{ name: 'front-left', yaw: 40, pitch: 12 }, { name: 'left', yaw: 90, pitch: 6 }, { name: 'front', yaw: 0, pitch: 8 }, { name: 'back-left', yaw: 140, pitch: 14 }];

// The skin sheet: the limbs' binding at rest, then `rows` phases of the run
// from four sides, coloured by how far the skin is from its rest lengths,
// and the places it is pulled or crushed.
export function skinSheet(rec, { path, rows = 4, cell = 300, dist = 2.2 } = {}) {
    const t0 = Date.now();
    const creature = rec.creature, skel = creature.skel;
    const bound = boundFlags(creature);
    const motion = skinInMotion(rec);
    const flags = [...bound, ...skinFlags(motion)];
    const cyc = lastCycle(rec);
    const samples = sampleRows(rec, rows, cyc);
    const ext = restExtent(skel);
    const d = Math.max(ext.len, ext.top) * dist;
    const target = [0, ext.top * 0.5, ext.mid];
    const cw = cell, ch = Math.round(cell * 1.05);
    const shots = samples.map((smp) => {
        const r = rootOf(rec, smp.step);
        const g0 = groundHeights(rec.env, new Float32Array([r.x, r.z]))[0];
        const P = relativePose(rec, smp.step, g0, new Float32Array(rec.poseStride));
        setPose(creature, P);
        showGround(false);
        const ratio = stretchOf(creature, skinPositions(creature, rec.pose, smp.step * rec.poseStride)).ratio;
        return VIEWS.map((v) => heatShot(creature, ratio, orbitView(target, v.yaw, v.pitch, d, 30), cw, ch));
    });
    showGround(true);
    const LM = 112, TM = 86, FH = 20 * Math.max(1, flags.length) + 30;
    const W = LM + VIEWS.length * (cw + 6) + 6, H = TM + FH + rows * (ch + 6) + 10;
    const S = beginSheet(W, H);
    const g = S.g;
    rect(g, 0, 0, W, H, '#ecebe6');
    text(g, `${creature.label} · ${rec.scenario.name} · skin`, 12, 30, { size: 22, weight: 700 });
    text(g, 'each triangle by how far its edges are from their rest lengths: blue crushed to a third, grey at rest, red pulled to three times', 12, 52, { size: 14, color: DIM });
    if (!flags.length) text(g, 'every limb is bound in its own skin; nothing pulled or crushed past its limits', 12, TM, { size: 14, color: DIM });
    flags.forEach((f, i) => text(g, f, 12, TM + 20 * i, { size: 13, color: '#b03a2e' }));
    const y0 = TM + FH;
    VIEWS.forEach((v, c) => text(g, v.name, LM + c * (cw + 6) + cw / 2, y0 - 6, { size: 14, weight: 650, align: 'center' }));
    samples.forEach((smp, r) => {
        const y = y0 + r * (ch + 6);
        text(g, smp.label, 10, y + 22, { size: 15, weight: 700 });
        shots[r].forEach((img, c) => g.drawImage(toCanvas(img), LM + c * (cw + 6), y));
    });
    const out = saveSheet(path);
    return { path, width: out.width, height: out.height, ms: Date.now() - t0, flags, bound: boundLimbs(creature), motion };
}
