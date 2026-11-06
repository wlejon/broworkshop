// The body's form, measured: the skin placed on the CPU exactly as
// lab/skin.bk places it, then
//   - at rest, each named ring's girth (perimeter), width, depth, top and
//     bottom, and each named part's extent and (closed parts) volume,
//     checked against the creature's `form.reference`;
//   - through a cycle of a steady gait, each named ring's area and girth
//     and each closed part's volume as a share of rest: where the skin
//     loses or gains volume as the joints move.
// Rings and parts are named in the body (lab/sculpt.js `name`).

import { ROWS, restPose } from "./skeleton.js";
import { lastCycle, relativePose } from "./cycle.js";

// The unit quaternion [x, y, z, w] of the rotation rows at P[k].
function quatOf(P, k) {
    const m00 = P[k], m01 = P[k + 1], m02 = P[k + 2], m10 = P[k + 4], m11 = P[k + 5], m12 = P[k + 6];
    const m20 = P[k + 8], m21 = P[k + 9], m22 = P[k + 10];
    const tr = m00 + m11 + m22;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
    if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotate(q, v) {
    const u = cross3(q, v).map((x) => 2 * x);
    const c = cross3(q, u);
    return [v[0] + q[3] * u[0] + c[0], v[1] + q[3] * u[1] + c[1], v[2] + q[3] * u[2] + c[2]];
}

// Skinned positions of pose P (at float offset o), the bones blended as
// dual quaternions exactly as lab/skin.bk blends them.
export function skinPositions(creature, P, o = 0) {
    const { positions, weights } = creature.body;
    const bones = creature.skel.bones;
    const nb = bones.length;
    // Each bone's rotation and translation (x' = R x + t, t = p - R head).
    const Q = [], D = [];
    for (let b = 0; b < nb; b++) {
        const k = o + b * ROWS, q = quatOf(P, k);
        const rh = rotate(q, bones[b].head);
        const t = [P[k + 3] - rh[0], P[k + 7] - rh[1], P[k + 11] - rh[2]];
        const tq = cross3(t, q);
        Q.push(q);
        D.push([t[0] * q[3] + tq[0], t[1] * q[3] + tq[1], t[2] * q[3] + tq[2], -(t[0] * q[0] + t[1] * q[1] + t[2] * q[2])]);
    }
    const n = positions.length / 3, out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
        const r = [0, 0, 0, 0], d = [0, 0, 0, 0];
        const ws = weights[v], q0 = Q[ws[0].index];
        for (const { index, w } of ws) {
            const q = Q[index], dq = D[index];
            const s = q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3] < 0 ? -w : w;
            for (let i = 0; i < 4; i++) { r[i] += s * q[i]; d[i] += s * dq[i]; }
        }
        const l = Math.hypot(r[0], r[1], r[2], r[3]);
        for (let i = 0; i < 4; i++) { r[i] /= l; d[i] /= l; }
        const c = cross3(r, d);
        const p = rotate(r, [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]);
        out[3 * v] = p[0] + r[3] * d[0] - d[3] * r[0] + c[0];
        out[3 * v + 1] = p[1] + r[3] * d[1] - d[3] * r[1] + c[1];
        out[3 * v + 2] = p[2] + r[3] * d[2] - d[3] * r[2] + c[2];
    }
    return out;
}

const at = (X, v) => [X[3 * v], X[3 * v + 1], X[3 * v + 2]];

// A ring's area (its vector area's length, so any tilt reads the same) and
// perimeter, and its extents in x (width), y (depth) and z (length: a leg's
// ring front to back).
export function ringMeasure(X, ring) {
    let ax = 0, ay = 0, az = 0, per = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const c = [0, 0, 0];
    for (let j = 0; j < ring.segs; j++) { const p = at(X, ring.first + j); for (let k = 0; k < 3; k++) c[k] += p[k] / ring.segs; }
    for (let j = 0; j < ring.segs; j++) {
        const a = at(X, ring.first + j), b = at(X, ring.first + (j + 1) % ring.segs);
        const p = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], q = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
        ax += p[1] * q[2] - p[2] * q[1]; ay += p[2] * q[0] - p[0] * q[2]; az += p[0] * q[1] - p[1] * q[0];
        per += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]);
        z0 = Math.min(z0, a[2]); z1 = Math.max(z1, a[2]);
    }
    return { area: 0.5 * Math.hypot(ax, ay, az), girth: per, width: x1 - x0, depth: y1 - y0, length: z1 - z0, top: y1, bottom: y0, z: c[2] };
}

// A closed part's volume (divergence theorem over its triangles).
export function partVolume(X, idx, part) {
    let v = 0;
    for (let i = part.start; i < part.end; i += 3) {
        const a = at(X, idx[i]), b = at(X, idx[i + 1]), c = at(X, idx[i + 2]);
        v += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return Math.abs(v);
}

export function partExtent(X, part) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = part.base; v < part.base + part.count; v++) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], X[3 * v + k]); hi[k] = Math.max(hi[k], X[3 * v + k]);
    }
    return { width: hi[0] - lo[0], top: hi[1], bottom: lo[1], front: hi[2], back: lo[2], length: hi[2] - lo[2] };
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// How far the part of a loft that should stay hidden inside another (a
// leg's top inside the trunk) shows: for each vertex of `inner` whose rest
// height is above `above`, its distance outside the outer loft's section at
// its z (the section interpolated between the rings about it). The outer
// loft is one whose rings lie across z.
export function protrusion(X, outer, inner, above, restPos) {
    const ringZ = [];
    for (let i = 0; i < outer.rings; i++) {
        let z = 0;
        for (let s = 0; s < outer.segs; s++) z += X[3 * (outer.base + i * outer.segs + s) + 2] / outer.segs;
        ringZ.push(z);
    }
    let worst = { out: 0, at: null };
    for (let v = inner.base; v < inner.base + inner.count; v++) {
        if (restPos[3 * v + 1] < above) continue;
        const p = at(X, v);
        let i = 0;
        while (i + 1 < outer.rings && !((ringZ[i] - p[2]) * (ringZ[i + 1] - p[2]) <= 0)) i++;
        if (i + 1 >= outer.rings) continue;
        const f = (p[2] - ringZ[i]) / ((ringZ[i + 1] - ringZ[i]) || 1);
        const poly = [];
        for (let s = 0; s < outer.segs; s++) {
            const a = at(X, outer.base + i * outer.segs + s), b = at(X, outer.base + (i + 1) * outer.segs + s);
            poly.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        }
        // Inside (crossings), else the distance to the polygon.
        let inside = false, d = Infinity;
        for (let s = 0; s < poly.length; s++) {
            const a = poly[s], b = poly[(s + 1) % poly.length];
            if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
            const ex = b[0] - a[0], ey = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1e-12)));
            d = Math.min(d, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t));
        }
        if (!inside && d > worst.out) worst = { out: d, at: p.map(r4) };
    }
    return { out: r4(worst.out), at: worst.at };
}

// The creature's `form.inside` as pairs of parts.
function insidePairs(creature) {
    const byName = Object.fromEntries(creature.body.parts.map((p) => [p.name, p]));
    const out = [];
    for (const [o, inner] of Object.entries((creature.def.form && creature.def.form.inside) || {})) {
        for (const [n, above] of Object.entries(inner)) {
            if (byName[o] && byName[n]) out.push({ key: `${n} in ${o}`, o, n, outer: byName[o], inner: byName[n], above });
        }
    }
    return out;
}

// The rest form: per named ring and part, and the reference check.
export function restForm(creature) {
    const X = skinPositions(creature, restPose(creature.skel));
    const { rings, parts, indices } = creature.body;
    const out = { rings: {}, parts: {} };
    for (const r of rings) {
        const m = ringMeasure(X, r);
        out.rings[r.name] = { girth: r4(m.girth), width: r4(m.width), depth: r4(m.depth), length: r4(m.length), top: r4(m.top), bottom: r4(m.bottom), z: r4(m.z) };
    }
    for (const p of parts) {
        const e = partExtent(X, p);
        out.parts[p.name] = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, r4(v)]));
        if (p.closed) out.parts[p.name].volume = r4(partVolume(X, indices, p));
    }
    // The reference: { 'ring.field' or 'part.field': [value, tolerance] }.
    const ref = (creature.def.form && creature.def.form.reference) || {};
    out.reference = {};
    out.flags = [];
    // Parts that should stay inside another above a rest height:
    // { outer: { inner: height, ... } }, flagged past 5 mm.
    out.protrusion = {};
    for (const c of insidePairs(creature)) {
        const pr = protrusion(X, c.outer, c.inner, c.above, creature.body.positions);
        out.protrusion[c.key] = pr;
        if (pr.out > 0.005) out.flags.push(`${c.n} pokes ${(100 * pr.out).toFixed(1)} cm out of ${c.o} at ${pr.at}`);
    }
    for (const [key, [want, tol]] of Object.entries(ref)) {
        const [name, field] = key.split('.');
        const got = (out.rings[name] || out.parts[name] || {})[field];
        const ok = got != null && Math.abs(got - want) <= tol;
        out.reference[key] = { want, tol, got: got ?? null, ok };
        if (!ok) out.flags.push(`${key} is ${got == null ? 'missing' : got.toFixed(3)}, reference ${want} +- ${tol}`);
    }
    return { X, form: out };
}

// The form through a recording: `samples` even phases of its last cycle
// (or of the whole run), each ring's area and girth and each closed part's
// volume as a share of rest, with the worst phase each way.
export function formInMotion(creature, rec, rest, { samples = 24, tolerance = 0.04 } = {}) {
    const cyc = lastCycle(rec);
    const steps = [];
    for (let i = 0; i < samples; i++) {
        steps.push(cyc ? Math.round(cyc.a + (i / samples) * (cyc.b - cyc.a)) : Math.min(rec.steps - 1, Math.round(((i + 0.5) / samples) * rec.steps)));
    }
    const { rings, parts, indices } = creature.body;
    const closed = parts.filter((p) => p.closed);
    const restRing = rings.map((r) => ringMeasure(rest, r));
    const restVol = closed.map((p) => partVolume(rest, indices, p));
    const track = (name) => ({ name, min: Infinity, max: -Infinity, minAt: 0, maxAt: 0, series: [] });
    const series = {
        area: rings.map((r) => track(r.name)), girth: rings.map((r) => track(r.name)), volume: closed.map((p) => track(p.name)),
    };
    const note = (t, v, ph) => {
        t.series.push(r4(v));
        if (v < t.min) { t.min = v; t.minAt = ph; }
        if (v > t.max) { t.max = v; t.maxAt = ph; }
    };
    // Folds: each part's skin along its length, each edge between rings as
    // its run along the posed tube's axis, as 1 + its change from rest over
    // the rest gap between the rings. Near 1 the skin keeps its form; toward
    // 0 it bunches into a crease, below 0 it folds through itself; well over
    // 1 it is stretched thin.
    const tubes = parts.map((p) => ({ p, restRun: tubeRuns(rest, p) }));
    const folds = tubes.map((t) => ({ name: t.p.name, min: Infinity, max: -Infinity, minAt: 0, maxAt: 0, minWhere: null, maxWhere: null }));
    // Protrusion of the parts that belong inside another, in the creature's
    // own frame (facing +Z) so the outer loft's rings lie across z.
    const inside = insidePairs(creature).map((c) => ({ ...c, out: 0, at: null, ph: 0 }));
    const rel = new Float32Array(rec.poseStride);
    steps.forEach((k, i) => {
        const ph = i / samples;
        const X = skinPositions(creature, relativePose(rec, k, 0, rel), 0);
        for (const c of inside) {
            const pr = protrusion(X, c.outer, c.inner, c.above, creature.body.positions);
            if (pr.out > c.out) { c.out = pr.out; c.at = pr.at; c.ph = ph; }
        }
        tubes.forEach((t, j) => {
            const run = tubeRuns(X, t.p), f = folds[j];
            for (let e = 0; e < run.length; e++) {
                const gap = t.restRun.gaps[Math.floor(e / t.p.segs)];
                if (gap < 1e-3) continue;
                const r = 1 + (run[e] - t.restRun[e]) / gap;
                const where = Math.floor(e / t.p.segs);
                if (r < f.min) { f.min = r; f.minAt = ph; f.minWhere = where; }
                if (r > f.max) { f.max = r; f.maxAt = ph; f.maxWhere = where; }
            }
        });
        rings.forEach((r, j) => {
            const m = ringMeasure(X, r);
            note(series.area[j], m.area / restRing[j].area, ph);
            note(series.girth[j], m.girth / restRing[j].girth, ph);
        });
        closed.forEach((p, j) => note(series.volume[j], partVolume(X, indices, p) / restVol[j], ph));
    });
    const flags = [];
    const sum = (ts, what) => Object.fromEntries(ts.map((t) => {
        if (t.min < 1 - tolerance) flags.push(`${t.name} ${what} falls to ${(100 * t.min).toFixed(1)}% of rest at phase ${t.minAt.toFixed(2)}`);
        if (t.max > 1 + tolerance) flags.push(`${t.name} ${what} rises to ${(100 * t.max).toFixed(1)}% of rest at phase ${t.maxAt.toFixed(2)}`);
        return [t.name, { min: r4(t.min), max: r4(t.max), minAt: r4(t.minAt), maxAt: r4(t.maxAt), series: t.series }];
    }));
    const fold = {};
    folds.forEach((f, j) => {
        const p = tubes[j].p, ringAt = (i) => {
            const c = [0, 0, 0];
            for (let s = 0; s < p.segs; s++) for (let q = 0; q < 3; q++) c[q] += rest[3 * (p.base + i * p.segs + s) + q] / p.segs;
            return c.map(r4);
        };
        fold[f.name] = { min: r4(f.min), max: r4(f.max), minAt: r4(f.minAt), maxAt: r4(f.maxAt), minRest: ringAt(f.minWhere), maxRest: ringAt(f.maxWhere) };
        if (f.min < 0.3) flags.push(`${f.name} skin ${f.min < 0 ? 'folds through itself' : 'creases'} (${f.min.toFixed(2)}) near rest ${fold[f.name].minRest} at phase ${f.minAt.toFixed(2)}`);
        if (f.max > 2.0) flags.push(`${f.name} skin stretches ${f.max.toFixed(2)}x near rest ${fold[f.name].maxRest} at phase ${f.maxAt.toFixed(2)}`);
    });
    const protrude = {};
    for (const c of inside) {
        protrude[c.key] = { out: r4(c.out), at: c.at, phase: r4(c.ph) };
        if (c.out > 0.01) flags.push(`${c.key.replace(' in ', ' pokes ')} by ${(100 * c.out).toFixed(1)} cm at phase ${c.ph.toFixed(2)} (${c.at})`);
    }
    return {
        scenario: rec.scenario.name, cycle: cyc ? { period: r4(cyc.period) } : null, samples, tolerance,
        area: sum(series.area, 'area'), girth: sum(series.girth, 'girth'), volume: sum(series.volume, 'volume'), fold, protrude, flags,
    };
}

// A loft's edges between consecutive rings, each as its run along the axis
// from one ring's centre to the next's (segs per ring gap, ring by ring).
function tubeRuns(X, p) {
    const out = [], gaps = [];
    const centre = (i) => {
        const c = [0, 0, 0];
        for (let s = 0; s < p.segs; s++) for (let q = 0; q < 3; q++) c[q] += X[3 * (p.base + i * p.segs + s) + q] / p.segs;
        return c;
    };
    let c0 = centre(0);
    for (let i = 0; i + 1 < p.rings; i++) {
        const c1 = centre(i + 1);
        const t = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
        const l = Math.hypot(t[0], t[1], t[2]) || 1;
        for (let s = 0; s < p.segs; s++) {
            const a = at(X, p.base + i * p.segs + s), b = at(X, p.base + (i + 1) * p.segs + s);
            out.push(((b[0] - a[0]) * t[0] + (b[1] - a[1]) * t[1] + (b[2] - a[2]) * t[2]) / l);
        }
        gaps.push(l);
        c0 = c1;
    }
    out.gaps = gaps;
    return out;
}
