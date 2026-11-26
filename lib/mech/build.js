// lib/mech/build.js — a design as geometry. For every segment: the frame
// under everything (longerons, ring frames, bracing, the joint and its
// actuator), the armour as plates standing off each face (thicker plate
// stands prouder, and plates part around whatever shows through the hull),
// each module's body inside the bay, and what the modules show outside:
// nozzles, barrels, lenses, tubes, radiator fins.
//
// Pure data: every mesh is { positions, normals, colors, indices } in the
// segment's own space, ready for scene.createMesh. A segment is built once,
// for the right side; `mirror` gives the left.

import { add, sub, mul, norm, cross, lerp, clamp } from "./vec.js";
import { CELL, ARMOR, MODULES, LINES, LINE_KINDS } from "./catalog.js";
import { FACES, hullBasis, hullToLocal, localToHull, hullCorners, sectionAt, bay, moduleBox, faceAxis, faceSign,
         faceNormal, skinPoint, hullCenter } from "./skeleton.js";
import { MeshBuilder, hexColor, shade, tint, hash } from "./geom.js";

const STEEL = [0.36, 0.38, 0.41], DARK = [0.07, 0.075, 0.085], CHROME = [0.78, 0.80, 0.83], COPPER = [0.72, 0.42, 0.22];

/** How proud of the hull a plate of thickness t (metres) stands, drawn. */
const plateRise = (t) => clamp(t * 4.5, 0.10, 1.1);
const STANDOFF = 0.14;

/** A plate thickness as a colour: thin is blue, a hand's width green, a wall red. */
export function thicknessColor(t) {
    if (!(t > 0)) return [0.10, 0.11, 0.14];
    const k = clamp(Math.log(t / 0.01) / Math.log(40), 0, 1);       // 10 mm .. 400 mm
    const stops = [[0.15, 0.35, 0.95], [0.10, 0.80, 0.75], [0.35, 0.85, 0.25], [0.98, 0.82, 0.15], [0.95, 0.25, 0.15]];
    const x = k * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return tint(stops[i], stops[i + 1], x - i);
}

// --- a face, as a surface to lay things on -------------------------------------

function faceParam(seg, face) {
    const [ou, ow] = seg.off || [0, 0];
    const L = seg.len + seg.back, ax = faceAxis(face), sg = faceSign(face);
    const P = (s, t) => {
        if (ax === 1) {
            const b = sg > 0 ? seg.len : -seg.back, sec = sectionAt(seg, b);
            return [ou + sec[0] * (2 * s - 1), b, ow + sec[1] * (2 * t - 1)];
        }
        const b = -seg.back + L * t, sec = sectionAt(seg, b);
        return ax === 0 ? [ou + sg * sec[0], b, ow + sec[1] * (2 * s - 1)] : [ou + sec[0] * (2 * s - 1), b, ow + sg * sec[1]];
    };
    const end = sectionAt(seg, sg > 0 ? seg.len : -seg.back);
    const Ls = ax === 1 ? 2 * end[0] : ax === 0 ? seg.hw[0] + seg.hw[1] : seg.hu[0] + seg.hu[1];
    const Lt = ax === 1 ? 2 * end[1] : L;
    /** A box in the bay as the patch of this face it stands behind: [s0, s1, t0, t1]. */
    const toST = (box) => {
        const mid = sectionAt(seg, box.center[1]);
        const su = (a, h) => ((a - ou) / h + 1) / 2, sw = (c, h) => ((c - ow) / h + 1) / 2;
        if (ax === 1) return [su(box.min[0], end[0]), su(box.max[0], end[0]), sw(box.min[2], end[1]), sw(box.max[2], end[1])];
        const t0 = (box.min[1] + seg.back) / L, t1 = (box.max[1] + seg.back) / L;
        return ax === 0 ? [sw(box.min[2], mid[1]), sw(box.max[2], mid[1]), t0, t1] : [su(box.min[0], mid[0]), su(box.max[0], mid[0]), t0, t1];
    };
    return { P, Ls, Lt, toST, n: faceNormal(seg, face) };
}

/** A frame to build on at (s, t) of a face: origin, two unit tangents and the outward normal, right-handed. */
function faceFrame(fp, s, t) {
    const e = 0.01;
    const es = norm(sub(fp.P(s + e, t), fp.P(s - e, t)));
    const n = fp.n, et = cross(n, es);
    return { o: fp.P(s, t), es, et, n };
}

// --- frame ----------------------------------------------------------------------

function buildFrame(mb, seg, paint, children) {
    const [ou, ow] = seg.off || [0, 0];
    const F = paint.frame, hub = tint(F, STEEL, 0.6);
    const g = Math.sqrt(seg.frame.gauge), s = clamp(0.30 * g, 0.18, 0.8), ins = 0.24;
    const ring = (b) => {
        const sec = sectionAt(seg, b), hu = Math.max(0.1, sec[0] - ins), hw = Math.max(0.1, sec[1] - ins);
        return [[ou - hu, b, ow - hw], [ou + hu, b, ow - hw], [ou + hu, b, ow + hw], [ou - hu, b, ow + hw]];
    };
    const b0 = -seg.back + 0.2, b1 = seg.len - 0.2, L = b1 - b0;
    const r0 = ring(b0), r1 = ring(b1);
    for (let k = 0; k < 4; k++) mb.beam(r0[k], r1[k], s, F);
    const nR = Math.max(1, Math.round(L / 3.4));
    let prev = null;
    for (let i = 0; i <= nR; i++) {
        const r = ring(b0 + L * i / nR);
        for (let k = 0; k < 4; k++) mb.beam(r[k], r[(k + 1) % 4], s * 0.8, F);
        if (prev) for (let k = 0; k < 4; k++) {
            const flip = (i + k) & 1;
            mb.beam(prev[flip ? (k + 1) % 4 : k], r[flip ? k : (k + 1) % 4], s * 0.45, shade(F, 1.25));
        }
        prev = r;
    }
    const core = Math.min(seg.hu[0], seg.hu[1], seg.hw[0], seg.hw[1]) * 0.30;
    mb.beam([ou, b0, ow], [ou, b1, ow], core, shade(F, 0.85));

    // A pylon from the spine out to each joint that hangs from this segment, so that what
    // stands clear of the hull is seen to be carried by it.
    const Bs = hullBasis(seg);
    for (const c of children || []) {
        const cs = clamp(0.22 * Math.sqrt(c.frame.gauge) * Math.min(c.hu[0], c.hu[1], c.hw[0], c.hw[1]), 0.3, 1.4);
        for (const at of c.mirror ? [c.attach, [-c.attach[0], c.attach[1], c.attach[2]]] : [c.attach]) {
            const j = localToHull(Bs, at);
            mb.beam([ou, clamp(j[1], b0, b1), ow], j, cs, shade(F, 0.9));
            mb.beam([ou, clamp(j[1] - 2.5, b0, b1), ow], j, cs * 0.55, shade(F, 1.15));
        }
    }
    if (!seg.parent) return;

    // The joint, at the hull's own origin.
    const B = hullBasis(seg), j = seg.joint, sec = sectionAt(seg, 0);
    const R = 0.52 * Math.min(sec[0], sec[1]);
    if (j.type === 'fixed') {
        mb.box([ou - sec[0] * 0.7, -seg.back - 0.25, ow - sec[1] * 0.7], [ou + sec[0] * 0.7, -seg.back + 0.35, ow + sec[1] * 0.7], hub);
        return;
    }
    const axes = j.type === 'hinge' ? [norm(localToHull(B, j.axis))] : [[1, 0, 0], [0, 0, 1]];
    for (const a of axes) {
        const half = Math.abs(a[0]) * sec[0] + Math.abs(a[1]) * R + Math.abs(a[2]) * sec[1] + 0.45;
        mb.cyl(mul(a, -half), mul(a, half), R, R, 14, hub, 3, shade(hub, 1.3));
        mb.cyl(mul(a, -half - 0.18), mul(a, half + 0.18), R * 0.45, R * 0.45, 10, CHROME, 3);
        if (j.act === 'electric') {
            mb.cyl(mul(a, half - 0.9), mul(a, half + 0.05), R * 1.22, R * 1.22, 14, COPPER, 3, shade(COPPER, 0.7));
            mb.cyl(mul(a, -half - 0.05), mul(a, -half + 0.9), R * 1.22, R * 1.22, 14, COPPER, 3, shade(COPPER, 0.7));
        }
    }
    const size = clamp(Math.cbrt(Math.max(1, j.rating) / 60), 0.5, 2.2);
    if (j.act === 'hydraulic') {
        const r = 0.32 * size, w = ow - Math.min(seg.hw[0], seg.hw[1]) * 0.55;
        for (const sx of [-1, 1]) {
            const u = ou + sx * Math.min(seg.hu[0], seg.hu[1]) * 0.55;
            mb.cyl([u, seg.len * 0.10, w], [u, seg.len * 0.46, w], r, r, 10, shade(STEEL, 0.8), 3);
            mb.cyl([u, seg.len * 0.46, w], [u, seg.len * 0.74, w], r * 0.5, r * 0.5, 8, CHROME, 2);
        }
    } else if (j.act === 'myomer') {
        const rr = 0.42 * Math.min(seg.hu[0], seg.hu[1], seg.hw[0], seg.hw[1]);
        for (let k = 0; k < 6; k++) {
            const a = k / 6 * Math.PI * 2;
            mb.cyl([ou + Math.cos(a) * rr, 0.2, ow + Math.sin(a) * rr], [ou + Math.cos(a) * rr * 0.8, seg.len * 0.85, ow + Math.sin(a) * rr * 0.8],
                0.2 * size, 0.16 * size, 6, [0.55, 0.16, 0.14], 0);
        }
    }
}

// --- armour ---------------------------------------------------------------------

function buildArmor(mb, seg, paint, cuts, mode) {
    const base0 = paint[seg.paint] || paint.primary;
    for (const face of FACES) {
        const pl = seg.armor[face];
        if (!pl || !(pl.t > 0)) continue;
        const fp = faceParam(seg, face), fi = FACES.indexOf(face);
        const rise = plateRise(pl.t);
        const base = mode === 'thickness' ? thicknessColor(pl.t) : tint(base0, (ARMOR[pl.mat] || ARMOR.steel).color, pl.mat === 'steel' ? 0 : 0.35);
        const holes = (cuts[face] || []).map((box) => fp.toST(box));
        const lines = (Lx, n, edges) => {
            const xs = [];
            for (let i = 0; i <= n; i++) xs.push(i / n);
            for (const e of edges) if (e > 0.02 && e < 0.98) xs.push(e);
            xs.sort((a, b) => a - b);
            const out = [0];
            const tol = 0.7 / Math.max(1, Lx);
            for (const x of xs) {
                if (x - out[out.length - 1] > tol) out.push(x);
                else if (edges.includes(x) && out.length > 1) out[out.length - 1] = x;      // a cut's edge wins over a seam beside it
            }
            if (1 - out[out.length - 1] < tol && out.length > 1) out[out.length - 1] = 1; else out.push(1);
            return out;
        };
        const S = lines(fp.Ls, Math.max(1, Math.round(fp.Ls / 3.0)), holes.flatMap((h) => [h[0], h[1]]));
        const T = lines(fp.Lt, Math.max(1, Math.round(fp.Lt / 3.6)), holes.flatMap((h) => [h[2], h[3]]));
        const edge = 0.26, gap = 0.07;
        for (let i = 0; i + 1 < S.length; i++) for (let k = 0; k + 1 < T.length; k++) {
            const sc = (S[i] + S[i + 1]) / 2, tc = (T[k] + T[k + 1]) / 2;
            if (holes.some((h) => sc > h[0] && sc < h[1] && tc > h[2] && tc < h[3])) continue;
            const s0 = S[i] + (i === 0 ? edge : gap) / fp.Ls, s1 = S[i + 1] - (i + 2 === S.length ? edge : gap) / fp.Ls;
            const t0 = T[k] + (k === 0 ? edge : gap) / fp.Lt, t1 = T[k + 1] - (k + 2 === T.length ? edge : gap) / fp.Lt;
            if (s1 - s0 < 0.2 / fp.Ls || t1 - t0 < 0.2 / fp.Lt) continue;
            const bev = Math.min(0.22, rise * 0.55), bs = bev / fp.Ls, bt = bev / fp.Lt;
            const lo = fp.n.map((v) => v * STANDOFF), hi = fp.n.map((v) => v * (STANDOFF + rise));
            const a = [fp.P(s0, t0), fp.P(s1, t0), fp.P(s1, t1), fp.P(s0, t1)].map((p) => add(p, lo));
            const b = [fp.P(s0 + bs, t0 + bt), fp.P(s1 - bs, t0 + bt), fp.P(s1 - bs, t1 - bt), fp.P(s0 + bs, t1 - bt)].map((p) => add(p, hi));
            const jit = 0.94 + 0.10 * hash(fi, i, k + seg.id.length * 7);
            const top = mode === 'thickness' ? base : shade(base, jit), side = shade(top, 0.62);
            mb.quadFacing(b[0], b[1], b[2], b[3], fp.n, top);
            for (let e = 0; e < 4; e++) {
                const e2 = (e + 1) % 4, mid = lerp(a[e], a[e2], 0.5), ctr = lerp(a[0], a[2], 0.5);
                mb.quadFacing(a[e], a[e2], b[e2], b[e], sub(mid, ctr), side);
            }
        }
    }
}

// --- modules ---------------------------------------------------------------------

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function along(box, ax, f0, f1, shrink) {
    // A cylinder's ends and radius, inscribed in a box along axis ax between fractions f0..f1 of its length.
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
    const p0 = box.center.slice(), p1 = box.center.slice();
    p0[ax] = box.min[ax] + box.size[ax] * f0; p1[ax] = box.min[ax] + box.size[ax] * f1;
    return { p0, p1, r: Math.min(box.size[a1], box.size[a2]) / 2 * (shrink || 0.92) };
}
function inset(box, d) {
    return { min: box.min.map((v) => v + d), max: box.max.map((v) => v - d) };
}
const longest = (box) => (box.size[0] >= box.size[1] && box.size[0] >= box.size[2] ? 0 : box.size[1] >= box.size[2] ? 1 : 2);

function buildBody(mb, glow, def) {
    const { m, fam, box } = def;
    const col = fam.color, dark = shade(col, 0.45), b = inset(box, 0.09);
    const ax = m.face ? faceAxis(m.face) : longest(box);
    const group = m.type.split('.')[0];
    if (m.type === 'tank') {
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
        const wide = box.size[a1] >= box.size[a2] ? a1 : a2, thin = wide === a1 ? a2 : a1;
        const n = Math.max(1, Math.round(box.size[wide] / box.size[thin]));
        for (let i = 0; i < n; i++) {
            const c = along(box, ax, 0.06, 0.94, 0.9);
            c.p0[wide] = c.p1[wide] = box.min[wide] + box.size[wide] * (i + 0.5) / n;
            mb.cyl(c.p0, c.p1, c.r, c.r, 12, col, 3, shade(col, 0.8));
            const mid = lerp(c.p0, c.p1, 0.5), h = mul(AXES[ax], 0.18);
            mb.cyl(sub(mid, h), add(mid, h), c.r * 1.05, c.r * 1.05, 12, dark, 3);
        }
    } else if (group === 'reactor') {
        const c = along(box, longest(box), 0.04, 0.96, 0.94), mid = lerp(c.p0, c.p1, 0.5), d = norm(sub(c.p1, c.p0));
        const half = box.size[longest(box)] * 0.46;
        mb.cyl(c.p0, sub(mid, mul(d, half * 0.22)), c.r, c.r, 10, dark, 3, shade(dark, 1.4));
        mb.cyl(add(mid, mul(d, half * 0.22)), c.p1, c.r, c.r, 10, dark, 3, shade(dark, 1.4));
        glow.cyl(sub(mid, mul(d, half * 0.22)), add(mid, mul(d, half * 0.22)), c.r * 0.8, c.r * 0.8, 10, col, 0);
    } else if (m.type === 'sink' || m.type === 'cap') {
        const la = longest(box), n = Math.max(2, Math.round(box.size[la] / 0.6));
        for (let i = 0; i < n; i++) {
            const lo = b.min.slice(), hi = b.max.slice();
            lo[la] = b.min[la] + (b.max[la] - b.min[la]) * (i + 0.18) / n; hi[la] = b.min[la] + (b.max[la] - b.min[la]) * (i + 0.82) / n;
            mb.box(lo, hi, i & 1 ? col : shade(col, 0.75));
        }
        const s = inset(box, 0.35);
        mb.box(s.min, s.max, dark);
    } else if (m.type === 'gyro') {
        const sa = box.size[0] <= box.size[1] && box.size[0] <= box.size[2] ? 0 : box.size[1] <= box.size[2] ? 1 : 2;
        const c = along(box, sa, 0.3, 0.7, 0.95);
        mb.cyl(c.p0, c.p1, c.r, c.r, 16, col, 3, shade(col, 0.7));
        const s = along(box, sa, 0.05, 0.95, 0.2);
        mb.cyl(s.p0, s.p1, s.r, s.r, 8, CHROME, 3);
    } else if (group === 'jet' || m.type === 'gen.turbine') {
        const sg = faceSign(m.face || '+v');
        const c = along(box, ax, 0.03, 0.97, 0.9);
        mb.cyl(c.p0, c.p1, c.r, c.r, 14, shade(STEEL, 0.9), 3, DARK);
        const fan = sg > 0 ? along(box, ax, 0.03, 0.2, 0.98) : along(box, ax, 0.8, 0.97, 0.98);
        mb.cyl(fan.p0, fan.p1, fan.r, fan.r, 14, col, 3, dark);
    } else if (group === 'gun') {
        const sg = faceSign(m.face || '+v');
        const rear = sg > 0 ? [0.02, 0.5] : [0.5, 0.98], fore = sg > 0 ? [0.5, 0.98] : [0.02, 0.5];
        const lo = b.min.slice(), hi = b.max.slice();
        lo[ax] = box.min[ax] + box.size[ax] * rear[0]; hi[ax] = box.min[ax] + box.size[ax] * rear[1];
        mb.box(lo, hi, col);
        const c = along(box, ax, fore[0], fore[1], 0.55);
        mb.cyl(c.p0, c.p1, c.r, c.r, 10, dark, 3);
    } else {
        mb.box(b.min, b.max, col);
        const la = longest(box), s = inset(box, 0.04);
        s.min[la] = box.center[la] - 0.12; s.max[la] = box.center[la] + 0.12;
        if (m.type === 'cockpit' || m.type === 'computer') glow.box(s.min, s.max, m.type === 'cockpit' ? [1.0, 0.85, 0.5] : [0.3, 1.0, 0.5]);
        else mb.box(s.min, s.max, dark);
    }
}

/** What a module shows outside the hull. `fr`: the frame on the skin, hs/ht: its half sizes there. */
function buildShown(mb, glow, def, fr, hs, ht) {
    const { m, fam, g } = def;
    const { o, es, et, n } = fr;
    const at = (x, y, z) => add(o, add(mul(es, x), add(mul(et, y), mul(n, z))));
    const lo = Math.min(hs, ht), longS = hs >= ht;
    const kind = fam.surface;
    const row = (count, fn) => {
        for (let i = 0; i < count; i++) {
            const off = (i + 0.5) / count * 2 - 1;
            fn(longS ? at(off * hs, 0, 0) : at(0, off * ht, 0));
        }
    };
    if (kind === 'nozzle') {
        const count = Math.max(1, Math.round(Math.max(hs, ht) / lo)), r = lo * 0.9;
        row(count, (c) => {
            const up = (z) => add(c, mul(n, z));
            if (m.type === 'jet.turbofan') {
                mb.cyl(up(-0.1), up(0.7 * r), r, r * 0.93, 18, STEEL, 0);
                mb.cyl(up(0.7 * r), up(0.05), r * 0.84, r * 0.5, 18, shade(STEEL, 0.5), 0, null, true);
                for (let k = 0; k < 18; k++) {          // the lip
                    const a0 = (k + 0.5) / 18 * Math.PI * 2, a1 = (k + 1.5) / 18 * Math.PI * 2;
                    const pt = (a, rr) => add(up(0.7 * r), add(mul(es, Math.cos(a) * rr), mul(et, Math.sin(a) * rr)));
                    mb.quadFacing(pt(a0, r * 0.93), pt(a1, r * 0.93), pt(a1, r * 0.84), pt(a0, r * 0.84), n, shade(STEEL, 1.3));
                }
                glow.disc(up(0.07), n, r * 0.52, 14, [1.0, 0.55, 0.2]);
                mb.cyl(up(0.07), up(0.55 * r), r * 0.2, r * 0.03, 8, DARK, 0);
            } else if (m.type === 'jet.rocket') {
                mb.cyl(up(-0.1), up(0.35 * r), r * 0.5, r * 0.42, 12, shade(STEEL, 0.8), 0);
                mb.cyl(up(0.35 * r), up(1.5 * r), r * 0.42, r * 0.98, 16, [0.22, 0.2, 0.2], 0);
                mb.cyl(up(1.5 * r), up(0.4 * r), r * 0.94, r * 0.38, 16, [0.1, 0.09, 0.09], 0, null, true);
                glow.disc(up(0.42 * r), n, r * 0.38, 12, [1.0, 0.75, 0.3]);
            } else {
                for (let k = 0; k < 3; k++) {
                    const z0 = 0.05 + k * 0.42 * r, rr = r * (0.95 - k * 0.12);
                    mb.cyl(up(z0), up(z0 + 0.22 * r), rr, rr, 16, shade(fam.color, 0.4), 3, shade(STEEL, 0.9));
                }
                glow.cyl(up(0), up(1.25 * r), r * 0.5, r * 0.36, 12, [0.6, 0.45, 1.0], 2);
            }
        });
    } else if (kind === 'muzzle') {
        if (m.type === 'gun.autocannon') {
            const d = 0.22 * Math.sqrt(g.A), len = clamp(0.75 * g.L, 2, 16);
            mb.obox(at(0, 0, 0.3), es, et, n, [hs * 0.9, ht * 0.9, 0.3], shade(STEEL, 0.9));
            mb.cyl(at(0, 0, 0.3), at(0, 0, len), d * 1.15, d * 0.95, 14, shade(STEEL, 0.7), 0);
            mb.cyl(at(0, 0, len * 0.45), at(0, 0, len * 0.55), d * 1.5, d * 1.5, 14, STEEL, 3);
            mb.cyl(at(0, 0, len), at(0, 0, len + d * 2.4), d * 1.55, d * 1.55, 14, shade(STEEL, 0.55), 3, DARK);
        } else {
            const len = clamp(0.8 * g.L, 2, 18), w = lo * 0.3, sep = lo * 0.55;
            mb.obox(at(0, 0, 0.3), es, et, n, [hs * 0.9, ht * 0.9, 0.3], shade(STEEL, 0.9));
            for (const sx of [-1, 1]) {
                mb.obox(longS ? at(0, sx * sep, len / 2) : at(sx * sep, 0, len / 2), es, et, n, longS ? [hs * 0.7, w, len / 2] : [w, ht * 0.7, len / 2], shade(fam.color, 0.35));
            }
            glow.obox(at(0, 0, len / 2), es, et, n, longS ? [hs * 0.45, sep * 0.25, len / 2 - 0.3] : [sep * 0.25, ht * 0.45, len / 2 - 0.3], [0.4, 0.75, 1.0]);
        }
    } else if (kind === 'lens') {
        const r = lo * 0.82;
        mb.cyl(at(0, 0, -0.05), at(0, 0, 0.6), r, r * 0.9, 14, shade(STEEL, 0.7), 0);
        mb.cyl(at(0, 0, 0.6), at(0, 0, 0.25), r * 0.8, r * 0.7, 14, DARK, 0, null, true);
        glow.disc(at(0, 0, 0.27), n, r * 0.7, 14, [1.0, 0.25, 0.3]);
    } else if (kind === 'tubes') {
        mb.obox(at(0, 0, 0.2), es, et, n, [hs * 0.95, ht * 0.95, 0.2], shade(fam.color, 0.5));
        const tubes = Math.max(1, Math.floor(g.A / 1.2));
        const nx = Math.max(1, Math.round(Math.sqrt(tubes * hs / ht))), ny = Math.max(1, Math.ceil(tubes / nx));
        const r = Math.min(hs / nx, ht / ny) * 0.74;
        let left = tubes;
        for (let j = 0; j < ny && left > 0; j++) for (let i = 0; i < nx && left > 0; i++, left--) {
            const c = at(((i + 0.5) / nx * 2 - 1) * hs * 0.92, ((j + 0.5) / ny * 2 - 1) * ht * 0.92, 0.4);
            mb.cyl(c, add(c, mul(n, 0.12)), r, r, 8, STEEL, 2, hash(i, j, 3) > 0.3 ? [0.75, 0.16, 0.12] : DARK);
        }
    } else if (kind === 'panel' || kind === 'exhaust') {
        const colF = kind === 'panel' ? [0.16, 0.20, 0.27] : [0.12, 0.11, 0.10];
        mb.obox(at(0, 0, 0.06), es, et, n, [hs * 0.97, ht * 0.97, 0.06], shade(colF, 0.6));
        const pitch = kind === 'panel' ? 0.42 : 0.8, run = longS ? ht : hs, count = Math.max(2, Math.floor(2 * run / pitch));
        const tilt = 0.6, c = Math.cos(tilt), s = Math.sin(tilt);
        for (let i = 0; i < count; i++) {
            const off = ((i + 0.5) / count * 2 - 1) * run * 0.94;
            // A slat leaning over, its long side along the panel's long side.
            if (longS) mb.obox(at(0, off, 0.24), es, add(mul(et, c), mul(n, s)), add(mul(n, c), mul(et, -s)), [hs * 0.93, pitch * 0.42, 0.035], i & 1 ? colF : shade(colF, 1.3));
            else mb.obox(at(off, 0, 0.24), add(mul(es, c), mul(n, s)), et, add(mul(n, c), mul(es, -s)), [pitch * 0.42, ht * 0.93, 0.035], i & 1 ? colF : shade(colF, 1.3));
        }
        if (kind === 'exhaust') glow.obox(at(0, 0, 0.13), es, et, n, [hs * 0.8, ht * 0.8, 0.01], [0.9, 0.35, 0.1]);
    } else if (kind === 'sensor') {
        mb.obox(at(0, 0, 0.14), es, et, n, [hs * 0.95, ht * 0.8, 0.14], DARK);
        glow.obox(at(0, 0, 0.29), es, et, n, [hs * 0.85, Math.min(0.22, ht * 0.3), 0.02], [0.3, 0.95, 1.0]);
    }
}

// --- the whole machine --------------------------------------------------------------

/**
 * Meshes for every segment of a design.
 * @param {Object} design
 * @param {Object} report   evaluate(design): its module records are reused
 * @param {{armor?: 'paint'|'thickness'}} [opts]
 * @returns {Object<string, {frame, armor, inner, outer, glow, hull}>}  by segment id; each a
 *   function (mirror: boolean) => mesh data or null
 */
export function buildMech(design, report, opts) {
    opts = opts || {};
    const paint = Object.fromEntries(Object.entries(design.paint).map(([k, v]) => [k, hexColor(v)]));
    const out = {};
    for (const seg of design.segments) {
        const B = hullBasis(seg), S = report.segs[seg.id];
        const xf = (p) => hullToLocal(B, p);
        const mk = () => { const mb = new MeshBuilder(); mb.xf = xf; return mb; };
        const frame = mk(), armor = mk(), inner = mk(), outer = mk(), glow = mk(), hull = mk();
        buildFrame(frame, seg, paint, design.segments.filter((c) => c.parent === seg.id));
        const cuts = {};
        for (const def of S.mods) {
            if (def.fault) { inner.box(def.box.min, def.box.max, [0.9, 0.1, 0.1]); continue; }
            buildBody(inner, glow, def);
            if (def.fam.surface && def.m.face) {
                (cuts[def.m.face] ||= []).push(def.box);
                const fp = faceParam(seg, def.m.face), st = fp.toST(def.box);
                const fr = faceFrame(fp, (st[0] + st[1]) / 2, (st[2] + st[3]) / 2);
                const ax = faceAxis(def.m.face), d = def.box.size;
                // Half sizes along the frame's two tangents: es runs across (a or c), et the other way.
                const hs = (ax === 0 ? d[2] : d[0]) / 2, ht = (ax === 1 ? d[2] : d[1]) / 2;
                buildShown(outer, glow, def, fr, hs, ht);
            }
        }
        buildArmor(armor, seg, paint, cuts, opts.armor || 'paint');
        hull.hexa(hullCorners(seg), [1, 1, 1]);
        const cache = {};
        const get = (name, mb) => (mirror) => (cache[name + (mirror ? 'L' : 'R')] ||= mb.data(mirror));
        out[seg.id] = { frame: get('frame', frame), armor: get('armor', armor), inner: get('inner', inner), outer: get('outer', outer),
                        glow: get('glow', glow), hull: get('hull', hull) };
    }
    return out;
}

/** The edges of a bay's cells, as a line mesh in the segment's own space: { positions, indices }. */
export function bayLines(seg, mirror) {
    const B = hullBasis(seg), grid = bay(seg);
    const pos = [], idx = [], seen = new Map();
    const vert = (i, j, k) => {
        const key = i + ',' + j + ',' + k;
        let v = seen.get(key);
        if (v === undefined) {
            const p = hullToLocal(B, [grid.o[0] + i * CELL, grid.o[1] + j * CELL, grid.o[2] + k * CELL]);
            v = pos.length / 3; pos.push(mirror ? -p[0] : p[0], p[1], p[2]); seen.set(key, v);
        }
        return v;
    };
    const edges = new Set();
    const edge = (a, b) => { const key = a < b ? a + ':' + b : b + ':' + a; if (!edges.has(key)) { edges.add(key); idx.push(a, b); } };
    for (let i = 0; i < grid.n[0]; i++) for (let j = 0; j < grid.n[1]; j++) for (let k = 0; k < grid.n[2]; k++) {
        if (!grid.valid(i, j, k)) continue;
        const c = (a, b, d) => vert(i + a, j + b, k + d);
        for (const [a, b] of [[[0, 0, 0], [1, 0, 0]], [[0, 1, 0], [1, 1, 0]], [[0, 0, 1], [1, 0, 1]], [[0, 1, 1], [1, 1, 1]],
                              [[0, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0]], [[0, 0, 1], [0, 1, 1]], [[1, 0, 1], [1, 1, 1]],
                              [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]]]) edge(c(...a), c(...b));
    }
    return idx.length ? { positions: new Float32Array(pos), indices: new Uint32Array(idx) } : null;
}

/** A box of cells as a mesh in the segment's own space (a module's outline, a place about to be taken). */
export function cellBoxMesh(seg, cell, size, color, mirror, grow) {
    const B = hullBasis(seg), grid = bay(seg), mb = new MeshBuilder();
    mb.xf = (p) => hullToLocal(B, p);
    const box = moduleBox(grid, { cell, size }), d = grow || 0;
    mb.box(box.min.map((v) => v - d), box.max.map((v) => v + d), color);
    return mb.data(mirror);
}

/**
 * The lines through the frame at rest, in the world: a tube for each run of
 * each kind from the middle of a segment, through its joint, to the middle of
 * its parent. Thickness is capacity; red is a line asked for more than it carries.
 * @param {?string} kind  one of LINE_KINDS, or null for all of them side by side
 */
export function linesMesh(design, report, kind) {
    const mb = new MeshBuilder();
    const kinds = kind ? [kind] : LINE_KINDS;
    const top = {};
    for (const k of kinds) { top[k] = 1e-9; for (const it of report.insts) top[k] = Math.max(top[k], it.seg.lines[k]?.cap || 0, report.trunks[it.id][k].req); }
    const center = (it) => {
        const S = report.segs[it.seg.id], c = hullToLocal(S.B, hullCenter(it.seg));
        return add(report.rest.pos[it.id], it.side < 0 ? [-c[0], c[1], c[2]] : c);
    };
    const byId = Object.fromEntries(report.insts.map((it) => [it.id, it]));
    for (const it of report.insts) {
        if (!it.parent) continue;
        const a = center(byId[it.parent]), j = report.rest.pos[it.id], b = center(it);
        kinds.forEach((k, ki) => {
            const tr = report.trunks[it.id][k], ln = it.seg.lines[k] || { cap: 0, n: 1 };
            const amount = Math.max(ln.cap, tr.req);
            if (!(amount > 0)) return;
            const r = 0.14 + 0.5 * Math.sqrt(ln.cap / top[k]);
            const over = tr.req > ln.cap * 1.005;
            const col = over ? [1, 0.12, 0.1] : LINES[k].color;
            for (let run = 0; run < Math.max(1, ln.n); run++) {
                const off = kinds.length > 1 ? (ki - (kinds.length - 1) / 2) * 0.9 : (run - (ln.n - 1) / 2) * (2.4 * r);
                const sh = [off, 0, kinds.length > 1 ? (run - (ln.n - 1) / 2) * 0.5 : 0];
                mb.tube([add(a, sh), add(j, sh), add(b, sh)], ln.cap > 0 ? r : 0.08, 8, col);
            }
        });
    }
    return mb.data(false);
}
