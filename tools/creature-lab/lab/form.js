// The body's form, measured: the skin placed on the CPU exactly as
// lab/skin.bk places it, then
//   - at rest, each section's girth, width, depth, length, top and bottom,
//     each mass's volume and the body's, checked against the creature's
//     `form.reference` ('section.field': [value, tolerance], metres);
//   - through a run of each scenario, each section's area and girth and each
//     mass's volume as a share of rest: where the skin loses or gains volume
//     as the joints move.
// Sections and masses are the body's (lab/flesh.js). A section is a plane
// riding its bone (or a joint's two); the cut is the loop of the mesh about
// its point. A mass's volume is the region enclosed by the skin it owns,
// closed where it meets the next mass: the masses' volumes sum to the
// body's, and a mass bent at a joint inside it or at its border shows
// whether the flesh there collapses or balloons.

import { ROWS, restPose, bonePoint } from "./skeleton.js";
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
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// Section `sec` cut through mesh X in pose P (rest when null): the plane
// through its point, square to its normal, both carried by its bone. The
// cut's segments are joined into loops by the mesh edges they cross; the
// loop that winds about the point (else the nearest within the section's
// radius) is measured: its area, girth, and extents along x, y and z
// (width, depth, length), top and bottom.
export function cutSection(creature, X, sec, P = null) {
    const idx = creature.body.indices;
    let at = sec.at, n = sec.normal;
    if (P) {
        // Carried by its bone, or halfway between two (a joint's bisector).
        at = [0, 0, 0]; n = [0, 0, 0];
        for (const b of sec.bones) {
            const p = bonePoint(P, 0, b, creature.skel.bones[b].head, sec.at), k = b * ROWS, m = sec.normal;
            const r = [P[k] * m[0] + P[k + 1] * m[1] + P[k + 2] * m[2], P[k + 4] * m[0] + P[k + 5] * m[1] + P[k + 6] * m[2], P[k + 8] * m[0] + P[k + 9] * m[1] + P[k + 10] * m[2]];
            for (let i = 0; i < 3; i++) { at[i] += p[i] / sec.bones.length; n[i] += r[i]; }
        }
        const l = Math.hypot(...n) || 1;
        n = n.map((x) => x / l);
    }
    const off = dot3(at, n);
    const nv = X.length / 3;
    const sd = new Float32Array(nv);
    for (let v = 0; v < nv; v++) sd[v] = X[3 * v] * n[0] + X[3 * v + 1] * n[1] + X[3 * v + 2] * n[2] - off;
    // Each crossing point keyed by its edge; each segment joins two.
    const points = new Map(), next = new Map();
    const pointOn = (a, b) => {
        const key = a < b ? a * nv + b : b * nv + a;
        if (!points.has(key)) {
            const s = sd[a] / (sd[a] - sd[b]);
            points.set(key, [0, 1, 2].map((k) => X[3 * a + k] + (X[3 * b + k] - X[3 * a + k]) * s));
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
        // Wound so the loop runs counter-clockwise about the normal seen from outside.
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
    // In-plane axes, to test which loop winds about the point.
    const u0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = cross3(n, u0); const l1 = Math.hypot(...e1); e1 = e1.map((x) => x / l1);
    const e2 = cross3(n, e1);
    const uv = (p) => { const d = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]; return [dot3(d, e1), dot3(d, e2)]; };
    let best = null, bestD = Infinity;
    for (const loop of loops) {
        let wind = 0, dmin = Infinity;
        for (let i = 0; i < loop.length; i++) {
            const a = uv(loop[i]), b = uv(loop[(i + 1) % loop.length]);
            if ((a[1] > 0) !== (b[1] > 0) && a[0] + (b[0] - a[0]) * (-a[1] / (b[1] - a[1])) > 0) wind++;
            dmin = Math.min(dmin, Math.hypot(a[0], a[1]));
        }
        const d = wind % 2 ? -1 : dmin;
        if (d < bestD && d < sec.radius) { bestD = d; best = loop; }
    }
    if (!best) return null;
    let area = 0, girth = 0;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < best.length; i++) {
        const a = best[i], b = best[(i + 1) % best.length];
        area += 0.5 * dot3(cross3([a[0] - at[0], a[1] - at[1], a[2] - at[2]], [b[0] - at[0], b[1] - at[1], b[2] - at[2]]), n);
        girth += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); }
    }
    return { area: Math.abs(area), girth, width: hi[0] - lo[0], depth: hi[1] - lo[1], length: hi[2] - lo[2], top: hi[1], bottom: lo[1] };
}

// Each mass's skin: the triangles it owns (most of whose vertices it is
// the main mass of) and the loops where that skin meets its neighbours'.
function massSkins(creature) {
    const body = creature.body;
    if (body._skins) return body._skins;
    const { indices: idx, masses, vertexMass } = body;
    const tris = masses.map(() => []);
    for (let i = 0; i < idx.length; i += 3) {
        const a = vertexMass[idx[i]], b = vertexMass[idx[i + 1]], c = vertexMass[idx[i + 2]];
        tris[b === c ? b : a].push(i);
    }
    body._skins = tris.map((ts) => {
        // A directed edge whose reverse the skin lacks is on its border.
        const edges = new Set();
        for (const i of ts) for (let e = 0; e < 3; e++) edges.add(`${idx[i + e]},${idx[i + (e + 1) % 3]}`);
        const out = new Map();
        for (const i of ts) for (let e = 0; e < 3; e++) {
            const a = idx[i + e], b = idx[i + (e + 1) % 3];
            if (edges.has(`${b},${a}`)) continue;
            if (!out.has(a)) out.set(a, []);
            out.get(a).push(b);
        }
        const loops = [];
        for (const a0 of [...out.keys()]) {
            while (out.get(a0)?.length) {
                const loop = [a0];
                let a = out.get(a0).pop();
                while (a !== a0 && out.get(a)?.length) { loop.push(a); a = out.get(a).pop(); }
                loops.push(loop);
            }
        }
        return { tris: ts, loops };
    });
    return body._skins;
}

const tet = (X, a, b, c) => (X[a] * (X[b + 1] * X[c + 2] - X[b + 2] * X[c + 1]) + X[a + 1] * (X[b + 2] * X[c] - X[b] * X[c + 2])
    + X[a + 2] * (X[b] * X[c + 1] - X[b + 1] * X[c])) / 6;

// Each mass's volume in mesh X: the region its skin encloses, closed across
// each loop where it meets another mass by a fan to the loop's centre (so
// the caps follow the skin they close). The masses' volumes sum to the
// body's. Returns { masses: [volume per mass], body }.
export function massVolumes(creature, X) {
    const idx = creature.body.indices;
    let body = 0;
    for (let i = 0; i < idx.length; i += 3) body += tet(X, 3 * idx[i], 3 * idx[i + 1], 3 * idx[i + 2]);
    const C = new Float64Array(3);
    const masses = massSkins(creature).map(({ tris, loops }) => {
        let v = 0;
        for (const i of tris) v += tet(X, 3 * idx[i], 3 * idx[i + 1], 3 * idx[i + 2]);
        for (const loop of loops) {
            C.fill(0);
            for (const a of loop) for (let k = 0; k < 3; k++) C[k] += X[3 * a + k] / loop.length;
            for (let j = 0; j < loop.length; j++) {
                const a = 3 * loop[j], b = 3 * loop[(j + 1) % loop.length];
                // The cap triangle (centre, b, a) closes the border edge a -> b.
                v += (C[0] * (X[b + 1] * X[a + 2] - X[b + 2] * X[a + 1]) + C[1] * (X[b + 2] * X[a] - X[b] * X[a + 2])
                    + C[2] * (X[b] * X[a + 1] - X[b + 1] * X[a])) / 6;
            }
        }
        return v;
    });
    return { masses, body };
}

// The rest form: per section and mass, and the reference check.
export function restForm(creature) {
    const X = skinPositions(creature, restPose(creature.skel));
    const { sections = [], masses = [] } = creature.body;
    const out = { sections: {}, masses: {}, flags: [] };
    for (const s of sections) {
        const m = cutSection(creature, X, s);
        if (!m) { out.flags.push(`section ${s.name} cuts no loop about its point`); continue; }
        out.sections[s.name] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, r4(v)]));
    }
    const V = massVolumes(creature, X);
    masses.forEach((m, i) => { out.masses[m.name] = { litres: r4(1000 * V.masses[i]) }; });
    out.body = { litres: r4(1000 * V.body), triangles: creature.body.triangles, vertices: creature.body.vertices };
    // The reference: { 'section.field': [value, tolerance] }.
    const ref = (creature.def.form && creature.def.form.reference) || {};
    out.reference = {};
    for (const [key, [want, tol]] of Object.entries(ref)) {
        const [name, field] = key.split('.');
        const got = (out.sections[name] || {})[field];
        const ok = got != null && Math.abs(got - want) <= tol;
        out.reference[key] = { want, tol, got: got ?? null, ok };
        if (!ok) out.flags.push(`${key} is ${got == null ? 'missing' : got.toFixed(3)}, reference ${want} +- ${tol}`);
    }
    return { X, form: out };
}

// The form through a recording: `samples` even phases of its last cycle (or
// of the whole run), each section's area and girth and each mass's volume
// as a share of rest, with the worst phase each way. Masses under
// `minLitres` at rest (an eye, an ear) are followed but not flagged.
export function formInMotion(creature, rec, rest, { samples = 24, tolerance = 0.04, massTolerance = 0.08, minLitres = 0.2 } = {}) {
    const cyc = lastCycle(rec);
    const steps = [];
    for (let i = 0; i < samples; i++) {
        steps.push(cyc ? Math.round(cyc.a + (i / samples) * (cyc.b - cyc.a)) : Math.min(rec.steps - 1, Math.round(((i + 0.5) / samples) * rec.steps)));
    }
    const { sections = [], masses = [] } = creature.body;
    const restCut = sections.map((s) => cutSection(creature, rest, s));
    const restVol = massVolumes(creature, rest);
    const track = (name) => ({ name, min: Infinity, max: -Infinity, minAt: 0, maxAt: 0, series: [] });
    const series = { area: sections.map((s) => track(s.name)), girth: sections.map((s) => track(s.name)), volume: masses.map((m) => track(m.name)) };
    const body = track('body');
    const note = (t, v, ph) => {
        t.series.push(r4(v));
        if (v < t.min) { t.min = v; t.minAt = ph; }
        if (v > t.max) { t.max = v; t.maxAt = ph; }
    };
    const rel = new Float32Array(rec.poseStride);
    steps.forEach((k, i) => {
        const ph = i / samples;
        const P = relativePose(rec, k, 0, rel);
        const X = skinPositions(creature, P, 0);
        sections.forEach((s, j) => {
            if (!restCut[j]) return;
            const m = cutSection(creature, X, s, P);
            note(series.area[j], m ? m.area / restCut[j].area : 0, ph);
            note(series.girth[j], m ? m.girth / restCut[j].girth : 0, ph);
        });
        const V = massVolumes(creature, X, P);
        masses.forEach((m, j) => note(series.volume[j], restVol.masses[j] > 1e-6 ? V.masses[j] / restVol.masses[j] : 1, ph));
        note(body, V.body / restVol.body, ph);
    });
    const flags = [];
    const sum = (ts, what, tol, big = () => true) => Object.fromEntries(ts.filter((t) => t.series.length).map((t, j) => {
        if (big(t)) {
            if (t.min < 1 - tol) flags.push(`${t.name} ${what} falls to ${(100 * t.min).toFixed(1)}% of rest at phase ${t.minAt.toFixed(2)}`);
            if (t.max > 1 + tol) flags.push(`${t.name} ${what} rises to ${(100 * t.max).toFixed(1)}% of rest at phase ${t.maxAt.toFixed(2)}`);
        }
        return [t.name, { min: r4(t.min), max: r4(t.max), minAt: r4(t.minAt), maxAt: r4(t.maxAt), series: t.series }];
    }));
    const litres = Object.fromEntries(masses.map((m, j) => [m.name, 1000 * restVol.masses[j]]));
    return {
        scenario: rec.scenario.name, cycle: cyc ? { period: r4(cyc.period) } : null, samples, tolerance, massTolerance,
        area: sum(series.area, 'area', tolerance), girth: sum(series.girth, 'girth', tolerance),
        volume: sum(series.volume, 'volume', massTolerance, (t) => litres[t.name] >= minLitres),
        body: sum([body], 'volume', tolerance).body, flags,
    };
}
