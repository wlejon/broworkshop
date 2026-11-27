// demos/foundry/partmesh.js — what each part looks like.
//
// meshPart(el, paint) -> { body: Geo, movers: [...], shaftR: { port: r } }
//   body    the still geometry, in the part's frame
//   movers  geometry that turns or slides, each in its own frame:
//             { geo, pivot, axis ('x'|'y'|'z'), port, sign, slide }
//           a turning mover spins about `axis` through `pivot` at the flow
//           of `port` (times sign); a sliding one (slide: stroke) runs out
//           and back along `axis` with that port's speed.
//   shaftR  the radius of the shaft at each mechanical port, so the view can
//           draw the coupling where two ports meet.
// Every dimension comes from el.shape (parts.js), so what is drawn is the
// box the compiler placed.

import { Geo, M, lin, mix, gearOutline, sprocketOutline, slab } from "./geom.js";

const STEEL = lin([0.66, 0.68, 0.71]);
const DARK = lin([0.30, 0.31, 0.33]);
const BRONZE = lin([0.80, 0.56, 0.28]);
const BRASS = lin([0.86, 0.70, 0.36]);
const COPPER = lin([0.85, 0.45, 0.26]);
const RUBBER = lin([0.05, 0.05, 0.055]);
const ALU = lin([0.74, 0.76, 0.78]);
const GRAPHITE = lin([0.12, 0.125, 0.135]);
const FRICTION = lin([0.30, 0.20, 0.14]);

const TAU = Math.PI * 2;

/** Convex hull of circles [[cx, cy, r], ...] as a CCW outline. */
function hullOfCircles(circles, n = 40) {
    const pts = [];
    for (const [cx, cy, r] of circles) for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

/** A keyed shaft stub along the frame axis from w0 to w1 (w1 the free end). */
function stub(g, r, w0, w1, frame) {
    const s = Math.sign(w1 - w0) || 1;
    const ch = r * 0.15;
    g.lathe([[0, w0], [r, w0], [r, w1 - s * ch], [r - ch, w1], [0, w1]], { ...frame, color: STEEL, mat: M.STEEL, segs: 24 });
}

/** A bearing housing ring standing proud of a face. */
function boss(g, rIn, rOut, w0, w1, frame, color) {
    const s = Math.sign(w1 - w0) || 1, ch = (rOut - rIn) * 0.18;
    g.lathe([[rIn, w0], [rOut, w0], [rOut, w1 - s * ch], [rOut - ch, w1], [rIn + ch * 0.6, w1], [rIn, w1 - s * ch * 0.6], [rIn, w0]],
        { ...frame, color, mat: M.PAINT, segs: 36, chamfer: ch });
}

function gearRotor(z, m, b, bore, hubR, opts) {
    const g = new Geo();
    const o = opts || {};
    const rp = 0.5 * m * z, rf = rp - 1.25 * m;
    const col = o.color || STEEL;
    if (rf > hubR * 2.2 && z > 26) {
        // Rim, thinner web, hub: a real cast-and-cut gear.
        const rimIn = rf - m * 1.2;
        g.ring(gearOutline(z, m, o), -b / 2, b / 2, { color: col, mat: o.mat ?? M.STEEL, chamfer: m * 0.25, bore: rimIn });
        const web = b * 0.32;
        // Single-segment discs face -w when traced outward, +w when traced inward.
        g.lathe([[hubR, -web / 2], [rimIn, -web / 2]], { color: mix(col, DARK, 0.25), mat: M.CAST, segs: 48, edges: false });
        g.lathe([[rimIn, web / 2], [hubR, web / 2]], { color: mix(col, DARK, 0.25), mat: M.CAST, segs: 48, edges: false });
        g.lathe([[bore, -b * 0.62], [hubR - m * 0.3, -b * 0.62], [hubR, -b * 0.55], [hubR, b * 0.55], [hubR - m * 0.3, b * 0.62], [bore, b * 0.62]], { color: col, mat: M.STEEL, segs: 32, chamfer: m * 0.3 });
        // Lightening holes as dark discs on the web.
        const holes = 6, hr = (rimIn - hubR) * 0.28, hc = (rimIn + hubR) / 2;
        for (let k = 0; k < holes; k++) {
            const a = (k / holes) * TAU;
            const w = web / 2 + Math.max(0.0002, web * 0.01);
            for (const axis of ['z', '-z']) {
                g.lathe([[hr, w], [0, w]], { at: [Math.cos(a) * hc, Math.sin(a) * hc, 0], axis, color: lin([0.02, 0.02, 0.025]), mat: M.RUBBER, segs: 20, edges: false });
            }
        }
    } else {
        g.ring(gearOutline(z, m, o), -b / 2, b / 2, { color: col, mat: o.mat ?? M.STEEL, chamfer: m * 0.25, bore });
    }
    return g;
}

const BUILD = {
    spur(s, paint) {
        const { z1, z2, m, b, r1, r2, cd, plate, stub: st, pad, hz } = s;
        const g = new Geo();
        const x1 = -cd / 2, x2 = cd / 2;
        const ra1 = r1 + m, ra2 = r2 + m;
        const rs1 = Math.max(0.0025, Math.min((r1 - 1.25 * m) * 0.55, r1 * 0.45));
        const rs2 = Math.max(rs1, Math.min((r2 - 1.25 * m) * 0.35, r2 * 0.3));
        const outline = hullOfCircles([[x1, 0, ra1 + pad], [x2, 0, ra2 + pad]]);
        const gap = Math.max(0.0008, b * 0.06);
        const zIn = b / 2 + gap, zOut = hz;
        for (const sgn of [1, -1]) {
            slab(g, outline, sgn > 0 ? zIn : -zOut, sgn > 0 ? zOut : -zIn, { color: paint, mat: M.PAINT, chamfer: plate * 0.3 });
            boss(g, rs1 * 1.05, rs1 * 2.3, sgn * zOut, sgn * (zOut + plate * 0.6), { at: [x1, 0, 0] }, paint);
            boss(g, rs2 * 1.05, rs2 * 2.1, sgn * zOut, sgn * (zOut + plate * 0.6), { at: [x2, 0, 0] }, paint);
        }
        // Standoffs between the plates, bolted through.
        const at = (cx, R, deg) => [cx + Math.cos(deg * Math.PI / 180) * R, Math.sin(deg * Math.PI / 180) * R];
        const posts = [at(x1, ra1 + pad * 0.5, 115), at(x1, ra1 + pad * 0.5, 245), at(x2, ra2 + pad * 0.5, 55), at(x2, ra2 + pad * 0.5, -55)];
        const pr = Math.max(0.0015, pad * 0.3);
        for (const [px, py] of posts) {
            g.cyl(pr, -zIn, zIn, { at: [px, py, 0], color: DARK, mat: M.CAST });
            g.bolt([px, py, zOut], 'z', pr * 1.1);
            g.bolt([px, py, -zOut], '-z', pr * 1.1);
        }
        // In mesh: a pinion tooth points at the gear while a gear gap faces the pinion.
        const pin = gearRotor(z1, m, b, rs1 * 0.9, rs1 * 1.8, { phase: -0.375 * TAU / z1 });
        stub(pin, rs1, -zOut - plate * 0.6, -hz - st, {});
        pin.cyl(rs1, -zOut, zOut + plate * 0.4, { color: STEEL, mat: M.STEEL });
        const gear = gearRotor(z2, m, b, rs2 * 0.9, rs2 * 2.2, { phase: Math.PI - 0.875 * TAU / z2, color: lin([0.6, 0.62, 0.66]) });
        stub(gear, rs2, zOut + plate * 0.6, hz + st, {});
        gear.cyl(rs2, -zOut - plate * 0.4, zOut, { color: STEEL, mat: M.STEEL });
        return {
            body: g,
            movers: [
                { geo: pin, pivot: [x1, 0, 0], axis: 'z', port: 'in', sign: 1 },
                { geo: gear, pivot: [x2, 0, 0], axis: 'z', port: 'out', sign: -1 },
            ],
            shaftR: { in: rs1, out: rs2 },
        };
    },

    planetary(s, paint) {
        const { zs, m, b, R, hz, stub: st } = s;
        const g = new Geo();
        const rsIn = Math.max(0.003, 0.5 * m * zs * 0.45), rsOut = rsIn * 1.5;
        const fl = R, body = R * 0.9, ch = R * 0.04;
        g.lathe([[rsIn * 2.2, -hz], [body * 0.7, -hz], [fl - ch, -hz], [fl, -hz + ch], [fl, -hz + hz * 0.22], [body, -hz + hz * 0.3],
            [body, hz - hz * 0.3], [fl, hz - hz * 0.22], [fl, hz - ch], [fl - ch, hz], [rsOut * 2.6, hz]], { color: paint, mat: M.PAINT, segs: 56, chamfer: ch });
        // Ribs around the ring.
        for (let k = 0; k < 12; k++) {
            const a = (k / 12) * TAU;
            const g2 = new Geo();
            g2.cbox([-R * 0.035, body - R * 0.02, -hz * 0.7], [R * 0.035, fl * 0.985, hz * 0.7], { color: paint, mat: M.PAINT, bevel: R * 0.012 });
            rotateAppend(g, g2, a);
        }
        g.boltCircle(fl * 0.9, 10, hz, R * 0.05, { axis: 'z' });
        g.boltCircle(fl * 0.9, 10, hz, R * 0.05, { axis: '-z' });
        boss(g, rsIn * 1.1, rsIn * 2.2, -hz, -hz - st * 0.25, {}, paint);
        const inR = new Geo();
        stub(inR, rsIn, -hz - st * 0.25, -hz - st, {});
        const outR = new Geo();
        outR.lathe([[0, hz], [rsOut * 2.6, hz], [rsOut * 2.6, hz + st * 0.25], [rsOut * 1.4, hz + st * 0.32]], { color: STEEL, mat: M.STEEL, segs: 40 });
        stub(outR, rsOut, hz + st * 0.3, hz + st, {});
        outR.boltCircle(rsOut * 2.0, 6, hz + st * 0.25, rsOut * 0.28, { axis: 'z' });
        return {
            body: g,
            movers: [
                { geo: inR, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 },
                { geo: outR, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1 },
            ],
            shaftR: { in: rsIn, out: rsOut },
        };
    },

    slewRing(s, paint) {
        const { zr, zp, n, m, b, R, rp, rc, Ro, hz, deck, stub: st, hub, hubR, side, foot, footTop, angs } = s;
        const g = new Geo();
        // On a foot: a pedestal under the rim, up between the decks to just below the ring's teeth, bolted down.
        if (side) {
            const fx = Ro * 0.3, y0 = -Ro - foot, y1 = -footTop, fz = hz + deck;
            g.cbox([-fx, y0, -fz], [fx, y1, fz], { color: mix(paint, DARK, 0.3), mat: M.PAINT, bevel: foot * 0.15 });
            for (const x of [-fx * 0.75, fx * 0.75]) for (const z of [-fz * 0.6, fz * 0.6]) g.bolt([x, y0, z], '-y', foot * 0.18);
        }
        // Two decks, the ring gear between them, tied by bolted posts around the rim.
        g.cyl(Ro, -hz - deck, -hz, { color: paint, mat: M.PAINT });
        g.cyl(Ro, hz, hz + deck, { color: paint, mat: M.PAINT });
        g.boltCircle(Ro * 0.94, Math.min(36, Math.max(8, n * 3)), hz + deck, Ro * 0.012, { axis: 'z' });
        g.boltCircle(Ro * 0.94, Math.min(36, Math.max(8, n * 3)), -hz - deck, Ro * 0.012, { axis: '-z' });
        const posts = Math.max(6, n * 2), pr = Math.max(0.003, (Ro - rc - rp) * 0.3);
        for (let k = 0; k < posts; k++) {
            const a = (k / posts) * TAU;
            g.cyl(pr, -hz, hz, { at: [Math.cos(a) * (Ro - pr * 1.6), Math.sin(a) * (Ro - pr * 1.6), 0], color: DARK, mat: M.CAST });
        }
        // The ring turns with the hub that stands up through the top deck.
        const ring = gearRotor(zr, m, b, R * 0.2, hubR, { color: lin([0.6, 0.62, 0.66]) });
        ring.cyl(hubR, hz - 0.0001, hz + deck + hub * 0.8, { color: STEEL, mat: M.STEEL });
        ring.cyl(hubR * 1.5, hz + deck + hub * 0.8, hz + deck + hub, { color: mix(paint, DARK, 0.2), mat: M.PAINT });
        ring.boltCircle(hubR * 1.22, 8, hz + deck + hub, hubR * 0.06, { axis: 'z' });
        const movers = [{ geo: ring, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1 }];
        const shaftR = { out: hubR };
        const rs = Math.max(0.002, rp * 0.4);
        // The pinions are alike: one geometry, shared by every mover (baked once).
        const pin = gearRotor(zp, m, b, rs * 0.9, rs * 1.8, { phase: Math.PI / zp });
        pin.cyl(rs, -hz - deck, hz, { color: STEEL, mat: M.STEEL });
        stub(pin, rs, -hz - deck, -hz - deck - st, {});
        for (let i = 0; i < n; i++) {
            const a = angs[i];
            boss(g, rs * 1.05, rs * 2.2, -hz - deck, -hz - deck - st * 0.2, { at: [Math.cos(a) * rc, Math.sin(a) * rc, 0] }, paint);
            movers.push({ geo: pin, pivot: [Math.cos(a) * rc, Math.sin(a) * rc, 0], axis: 'z', port: `in${i + 1}`, sign: -1 });
            shaftR[`in${i + 1}`] = rs;
        }
        return { body: g, movers, shaftR };
    },

    worm(s, paint) {
        const { m, b, rw, rq, cd, half, hz, stub: st, top, pad, zw } = s;
        const g = new Geo();
        const yMin = -rw - m - pad;
        const wall = Math.max(0.003, m * 1.2);
        g.cbox([-half, yMin, -hz], [half, top, hz], { color: paint, mat: M.PAINT, bevel: Math.min(half, hz) * 0.12 });
        // Cooling ribs on the faces, sized to the housing.
        const ribs = 5, H = top - yMin;
        const rt = H * 0.022, rp = Math.min(half, hz) * 0.07;
        for (let k = 0; k < ribs; k++) {
            const y = yMin + (k + 1) * H / (ribs + 1);
            g.cbox([-half * 0.82, y - rt, hz - 0.0001], [half * 0.82, y + rt, hz + rp], { color: paint, mat: M.PAINT, bevel: rt * 0.45 });
            g.cbox([-half * 0.82, y - rt, -hz - rp], [half * 0.82, y + rt, -hz + 0.0001], { color: paint, mat: M.PAINT, bevel: rt * 0.45 });
        }
        // Wheel covers: round bosses over the worm wheel on both faces, bolted.
        for (const sz of [1, -1]) {
            const R = Math.min(rw * 0.92, half * 0.9), t = rp * (sz > 0 ? 0.7 : 1.3);
            g.lathe([[0, hz], [R, hz], [R, hz + t * 0.7], [R * 0.94, hz + t], [0, hz + t]],
                { axis: sz > 0 ? 'z' : '-z', color: mix(paint, DARK, 0.08), mat: M.PAINT, segs: 64, chamfer: t * 0.3 });
            g.boltCircle(R * 0.86, 8, hz + t, rt * 0.9, { axis: sz > 0 ? 'z' : '-z', phase: Math.PI / 8 });
        }
        // Inspection cover.
        g.cbox([-half * 0.5, top - 0.0001, -hz * 0.6], [half * 0.5, top + wall * 0.9, hz * 0.6], { color: mix(paint, DARK, 0.15), mat: M.PAINT, bevel: wall * 0.35 });
        for (const x of [-half * 0.4, half * 0.4]) for (const z of [-hz * 0.48, hz * 0.48]) g.bolt([x, top + wall * 0.9, z], 'y', wall * 0.55);
        // Worm bearing caps on ±X and the output cap on +Z.
        const rIn = Math.max(0.003, Math.min(rq * 0.5, m * 4)), rOut = Math.max(rIn * 1.6, rw * 0.22);
        for (const sx of [1, -1]) {
            // The input shaft leaves through the -X cap; the +X cap is closed.
            const inner = sx > 0 ? 0 : rIn * 1.15;
            g.lathe([[0, half], [rq * 1.6, half], [rq * 1.6, half + wall * 1.4], [rq * 1.3, half + wall * 1.9], [inner, half + wall * 1.9]], { at: [0, cd, 0], axis: sx > 0 ? 'x' : '-x', color: paint, mat: M.PAINT, segs: 32 });
            g.boltCircle(rq * 1.35, 4, half + wall * 1.4, wall * 0.45, { at: [0, cd, 0], axis: sx > 0 ? 'x' : '-x' });
        }
        g.lathe([[0, hz], [rOut * 2.3, hz], [rOut * 2.3, hz + wall * 1.6], [rOut * 1.9, hz + wall * 2.2], [rOut * 1.1, hz + wall * 2.2]], { color: paint, mat: M.PAINT, segs: 48 });
        g.boltCircle(rOut * 2.0, 6, hz + wall * 1.6, wall * 0.5, { axis: 'z' });
        // A base flange on the end, when it bolts down there: below the worm's bearing cap.
        if (s.onEnd) {
            const fh = Math.max(m * 3, Math.min(rw * 0.75, cd - rq * 1.75 - m)), fz = hz * 0.92, x0 = half - 0.0001, x1 = half + s.flange;
            g.cbox([x0, -fh, -fz], [x1, fh, fz], { color: mix(paint, DARK, 0.25), mat: M.PAINT, bevel: s.flange * 0.3 });
            for (const y of [-fh * 0.72, fh * 0.72]) for (const z of [-fz * 0.68, fz * 0.68]) g.bolt([x1, y, z], 'x', Math.min(fh, fz) * 0.16);
        }
        // A slewing base behind the wheel: a square plate the housing's width, bolted round the wheel's axis.
        if (s.onBack) {
            const z1 = -hz + 0.0001, z0 = -hz - s.flange, sx = Math.min(half, rw + m * 2), sy0 = yMin * 0.98, sy1 = Math.min(cd, rw + m * 2);
            g.cbox([-sx, sy0, z0], [sx, sy1, z1], { color: mix(paint, DARK, 0.25), mat: M.PAINT, bevel: s.flange * 0.3 });
            for (const x of [-sx * 0.8, sx * 0.8]) for (const y of [sy0 * 0.8, sy1 * 0.8]) g.bolt([x, y, z0], 'z', Math.min(sx, sy1) * 0.08);
        }
        // Oil sight glass and breather.
        g.lathe([[0, half], [rq * 0.5, half], [rq * 0.5, half + wall * 0.4], [0, half + wall * 0.4]], { at: [0, yMin + (cd - yMin) * 0.25, 0], axis: 'x', color: lin([1.0, 0.55, 0.12]), mat: M.GLOW, segs: 20 });
        const inR = new Geo();
        stub(inR, rIn, -half - wall * 1.9, -half - st, { axis: 'x' });
        const outR = new Geo();
        stub(outR, rOut, hz + wall * 2.2, hz + st, {});
        return {
            body: g,
            movers: [
                { geo: inR, pivot: [0, cd, 0], axis: 'x', port: 'in', sign: 1 },
                { geo: outR, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1 },
            ],
            shaftR: { in: rIn, out: rOut },
        };
    },

    bevel(s, paint) {
        const { r1, r2, pad, stub: st, hx, hz, m, b } = s;
        const g = new Geo();
        const x0 = -r1 - pad, y0 = -r2 - pad, y1 = r2 + pad, z1 = r1 + pad;
        g.cbox([x0, y0, -hz], [hx, y1, z1], { color: paint, mat: M.PAINT, bevel: pad * 0.8 });
        const rIn = Math.max(0.003, r1 * 0.4), rOut = Math.max(rIn, r2 * 0.32);
        // Bearing caps on the two shaft faces, bolted.
        g.lathe([[0, hz], [rIn * 2.4, hz], [rIn * 2.4, hz + pad * 0.5], [rIn * 1.2, hz + pad * 0.7]], { axis: '-z', color: paint, mat: M.PAINT, segs: 32 });
        g.lathe([[0, hx], [rOut * 2.4, hx], [rOut * 2.4, hx + pad * 0.5], [rOut * 1.2, hx + pad * 0.7]], { axis: 'x', color: paint, mat: M.PAINT, segs: 32 });
        g.boltCircle(rIn * 2.05, 4, hz + pad * 0.5, rIn * 0.25, { axis: '-z', phase: Math.PI / 4 });
        g.boltCircle(rOut * 2.05, 4, hx + pad * 0.5, rOut * 0.25, { axis: 'x', phase: Math.PI / 4 });
        // Stiffening ribs on the sides and a split line with bolts around the top.
        const H = y1 - y0, rt = H * 0.03, rp = pad * 0.5;
        for (const f of [0.3, 0.7]) {
            const y = y0 + H * f;
            g.cbox([x0 + pad, y - rt, z1 - 0.0001], [hx - pad, y + rt, z1 + rp], { color: paint, mat: M.PAINT, bevel: rt * 0.45 });
        }
        g.cbox([x0 - 0.0001, y1 - H * 0.12, -hz - 0.0001], [hx + 0.0001, y1 - H * 0.1, z1 + 0.0001], { color: mix(paint, DARK, 0.35), mat: M.PAINT, bevel: 0 });
        for (const x of [x0 + pad, hx - pad]) for (const z of [-hz + pad, z1 - pad]) g.bolt([x, y1, z], 'y', pad * 0.35);
        // Fill plug.
        g.lathe([[0, y1], [pad * 0.5, y1], [pad * 0.5, y1 + pad * 0.3], [0, y1 + pad * 0.3]], { at: [(x0 + hx) / 2, 0, (z1 - hz) / 2], axis: 'y', color: BRASS, mat: M.BRASS, segs: 6 });
        const inR = new Geo(); stub(inR, rIn, -hz - pad * 0.7, -hz - st, {});
        const outR = new Geo(); stub(outR, rOut, hx + pad * 0.7, hx + st, { axis: 'x' });
        return {
            body: g,
            movers: [
                { geo: inR, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 },
                { geo: outR, pivot: [0, 0, 0], axis: 'x', port: 'out', sign: 1 },
            ],
            shaftR: { in: rIn, out: rOut },
        };
    },

    chain(s, paint) {
        const { z1, z2, pc, span, r1, r2, w, plate, stub: st } = s;
        const g = new Geo();
        // Guard plate behind the run.
        const back = -w / 2 - plate;
        slab(g, hullOfCircles([[0, 0, r1 + pc * 1.1], [0, span, r2 + pc * 1.1]]), back, -w / 2 - plate * 0.2, { color: paint, mat: M.PAINT, chamfer: plate * 0.3 });
        // The chain: links on the belt path.
        const pts = beltPath(r1 + pc * 0.05, r2 + pc * 0.05, span, pc);
        for (let k = 0; k < pts.length; k++) {
            const [x, y, ang] = pts[k];
            const lg = new Geo();
            lg.cbox([-pc * 0.5, -pc * 0.16, -w * 0.42], [pc * 0.5, pc * 0.16, w * 0.42], { color: k % 2 ? DARK : STEEL, mat: M.STEEL, bevel: pc * 0.06 });
            rotateAppend(g, lg, ang, [x, y, 0]);
        }
        const rs1 = Math.max(0.003, r1 * 0.3), rs2 = Math.max(rs1, r2 * 0.22);
        const sp1 = new Geo();
        sp1.ring(sprocketOutline(z1, pc), -w * 0.3, w * 0.3, { color: STEEL, mat: M.STEEL, chamfer: pc * 0.08, bore: rs1 });
        stub(sp1, rs1, -w / 2, -w / 2 - plate - st, {});
        const sp2 = new Geo();
        sp2.ring(sprocketOutline(z2, pc), -w * 0.3, w * 0.3, { color: STEEL, mat: M.STEEL, chamfer: pc * 0.08, bore: rs2 });
        sp2.lathe([[rs2, w * 0.3], [rs2 * 2, w * 0.3], [rs2 * 2, w / 2]], { color: STEEL, mat: M.STEEL, segs: 24 });
        stub(sp2, rs2, w / 2, w / 2 + plate + st, {});
        return {
            body: g,
            movers: [
                { geo: sp1, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 },
                { geo: sp2, pivot: [0, span, 0], axis: 'z', port: 'out', sign: 1 },
            ],
            shaftR: { in: rs1, out: rs2 },
        };
    },

    clutch(s) {
        const { r, len, stub: st } = s;
        const rot = new Geo();
        const rs = Math.max(0.003, r * 0.22);
        const hub = len * 0.28;
        rot.lathe([[rs, -len / 2], [r * 0.98, -len / 2], [r, -len / 2 + hub * 0.2], [r, -len / 2 + hub], [rs, -len / 2 + hub]], { color: STEEL, mat: M.STEEL, segs: 48 });
        rot.lathe([[rs, len / 2 - hub], [r, len / 2 - hub], [r, len / 2 - hub * 0.2], [r * 0.98, len / 2], [rs, len / 2]], { color: STEEL, mat: M.STEEL, segs: 48 });
        const stack = len - 2 * hub, n = 5;
        for (let k = 0; k < n; k++) {
            const w0 = -len / 2 + hub + (k / n) * stack, w1 = w0 + stack / n;
            rot.lathe([[rs * 1.4, w0], [r * (k % 2 ? 0.9 : 0.94), w0], [r * (k % 2 ? 0.9 : 0.94), w1], [rs * 1.4, w1]],
                { color: k % 2 ? FRICTION : DARK, mat: k % 2 ? M.RUBBER : M.CAST, segs: 48, edges: false });
        }
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU, x = Math.cos(a) * r * 0.72, y = Math.sin(a) * r * 0.72;
            rot.fine(() => rot.cyl(r * 0.07, -len / 2 - hub * 0.15, len / 2 + hub * 0.15, { at: [x, y, 0], color: lin([0.85, 0.75, 0.2]), mat: M.BRASS }));
        }
        stub(rot, rs, -len / 2, -len / 2 - st, {});
        stub(rot, rs, len / 2, len / 2 + st, {});
        return { body: new Geo(), movers: [{ geo: rot, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 }], shaftR: { in: rs, out: rs } };
    },

    shearPin(s) {
        const { d, hub, len } = s;
        const rot = new Geo();
        const rs = hub * 0.42, gap = Math.max(0.0006, len * 0.03), ch = hub * 0.06;
        // Two flanged hubs face to face with a gap: the pin is all that joins them.
        for (const sg of [-1, 1]) {
            const w0 = sg * gap / 2, w1 = sg * len / 2, wf = sg * (gap / 2 + len * 0.16);
            const prof = [[rs * 0.9, w0], [hub - ch, w0], [hub, w0 + sg * ch], [hub, wf], [hub * 0.62, wf + sg * len * 0.04], [hub * 0.62, w1 - sg * ch], [hub * 0.62 - ch, w1], [rs * 0.9, w1]];
            rot.lathe(prof, { color: sg > 0 ? STEEL : lin([0.56, 0.58, 0.61]), mat: M.STEEL, segs: 40, chamfer: ch });
            rot.boltCircle(hub * 0.8, 4, Math.abs(wf), hub * 0.09, { axis: sg > 0 ? 'z' : '-z', phase: Math.PI / 4 });
        }
        // The shaft ends it joins, keyed into each hub.
        rot.cyl(rs * 0.9, -len / 2, -gap, { color: lin([0.56, 0.58, 0.61]), mat: M.STEEL });
        rot.cyl(rs * 0.9, gap, len / 2, { color: STEEL, mat: M.STEEL });
        // The fuse: a red band across the gap and the brass pin through both flanges.
        rot.lathe([[hub * 1.003, -gap * 2.2], [hub * 1.003, gap * 2.2]], { color: lin([0.8, 0.08, 0.05]), mat: M.PAINT, segs: 40, edges: false });
        const pr = Math.max(0.0008, d / 2);
        rot.cyl(pr, -len * 0.2, len * 0.2, { at: [hub * 0.8, 0, 0], color: BRASS, mat: M.BRASS });
        rot.cyl(pr, -len * 0.2, len * 0.2, { at: [-hub * 0.8, 0, 0], color: BRASS, mat: M.BRASS });
        return { body: new Geo(), movers: [{ geo: rot, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 }], shaftR: { in: rs, out: rs } };
    },

    shaft(s) {
        const { d, L, hub } = s;
        const rot = new Geo();
        const r = d / 2, fl = L / 2 - hub * 0.35, ch = hub * 0.08;
        rot.cyl(r, -fl, fl, { color: STEEL, mat: M.STEEL });
        // Keyway along the shaft.
        rot.cbox([-r * 0.18, r * 0.82, -fl * 0.9], [r * 0.18, r * 1.0, fl * 0.9], { color: DARK, mat: M.CAST, bevel: r * 0.04 });
        // Flange couplings at both ends, bolted.
        for (const sg of [-1, 1]) {
            const prof = [[r, sg * (fl - hub * 0.4)], [r * 1.6, sg * (fl - hub * 0.25)], [r * 1.6, sg * fl], [hub - ch, sg * fl], [hub, sg * (fl + ch)], [hub, sg * L / 2 - sg * ch], [hub - ch, sg * L / 2], [0, sg * L / 2]];
            rot.lathe(prof, { color: lin([0.58, 0.6, 0.63]), mat: M.STEEL, segs: 40, chamfer: ch });
            rot.boltCircle(hub * 0.72, 6, L / 2, hub * 0.12, { axis: sg > 0 ? 'z' : '-z', phase: Math.PI / 6 });
        }
        return { body: new Geo(), movers: [{ geo: rot, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 }], shaftR: { in: r, out: r } };
    },

    motor(s, paint) {
        const { r, len, stub: st } = s;
        const g = new Geo();
        const fins = 28;
        const body = len * 0.74;
        const outline = [];
        for (let k = 0; k < fins; k++) {
            const a = (k / fins) * TAU, da = TAU / fins;
            for (const [f, rr] of [[0, r * 0.86], [0.2, r * 0.86], [0.26, r], [0.5, r], [0.56, r * 0.86]]) outline.push([Math.cos(a + f * da) * rr, Math.sin(a + f * da) * rr]);
        }
        g.ring(outline, -body / 2, body / 2, { color: GRAPHITE, mat: M.PAINT, chamfer: r * 0.03 });
        // End bells.
        const eb = (len - body) / 2;
        g.lathe([[r * 0.25, body / 2], [r * 0.9, body / 2], [r * 0.9, body / 2 + eb * 0.6], [r * 0.7, len / 2], [r * 0.25, len / 2]], { color: ALU, mat: M.ALU, segs: 48 });
        g.lathe([[r * 0.25, -body / 2], [r * 0.9, -body / 2], [r * 0.9, -body / 2 - eb * 0.6], [r * 0.8, -len / 2], [0, -len / 2]], { axis: 'z', color: ALU, mat: M.ALU, segs: 48 });
        g.boltCircle(r * 0.78, 4, len / 2 - eb * 0.2, r * 0.06, { axis: 'z', phase: Math.PI / 4 });
        // Terminal box on top, with a cable gland.
        g.cbox([-r * 0.42, r * 0.84, -len * 0.38], [r * 0.42, r * 1.22, len * 0.02], { color: GRAPHITE, mat: M.PAINT, bevel: r * 0.05 });
        g.lathe([[0, 0], [r * 0.13, 0], [r * 0.13, r * 0.06], [r * 0.09, r * 0.09], [0, r * 0.09]], { at: [0, r * 1.22, -len * 0.18], axis: 'y', color: RUBBER, mat: M.RUBBER, segs: 6 });
        // Nameplate and a status light.
        g.cbox([r * 0.84, -r * 0.2, -body * 0.25], [r * 1.005, r * 0.2, body * 0.25], { color: ALU, mat: M.ALU, bevel: r * 0.01 });
        g.lathe([[0, 0], [r * 0.05, 0], [r * 0.05, r * 0.025]], { at: [r * 0.3, r * 1.22, -len * 0.3], axis: 'y', color: lin([0.25, 1.0, 0.55]), mat: M.GLOW, segs: 12 });
        const rs = Math.max(0.003, r * 0.22);
        const shaft = new Geo();
        stub(shaft, rs, len / 2, len / 2 + st, {});
        shaft.lathe([[rs, len / 2 + st * 0.05], [rs * 1.5, len / 2 + st * 0.05], [rs * 1.5, len / 2 + st * 0.18], [rs, len / 2 + st * 0.22]], { color: DARK, mat: M.CAST, segs: 24 });
        return { body: g, movers: [{ geo: shaft, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1 }], shaftR: { out: rs } };
    },

    engine(s, paint) {
        const { hw, hh, len, stub: st, cyl, crankY } = s;
        const g = new Geo();
        const block = hh * 1.05;
        g.cbox([-hw * 0.82, -hh, -len / 2], [hw * 0.82, -hh + block, len / 2], { color: DARK, mat: M.CAST, bevel: hw * 0.08 });
        g.cbox([-hw * 0.7, -hh - hh * 0.0, -len * 0.42], [hw * 0.7, -hh + hh * 0.18, len * 0.42], { color: lin([0.2, 0.2, 0.22]), mat: M.CAST, bevel: hw * 0.05 });
        const pitch = (len * 0.86) / cyl, cr = Math.min(pitch * 0.42, hw * 0.6);
        for (let k = 0; k < cyl; k++) {
            const z = -len * 0.43 + pitch * (k + 0.5);
            const prof = [];
            const y0 = -hh + block, y1 = hh * 0.62, fins = 7;
            prof.push([0, y0]);
            for (let f = 0; f < fins; f++) {
                const a = y0 + (f / fins) * (y1 - y0), b = y0 + ((f + 0.5) / fins) * (y1 - y0);
                prof.push([cr, a], [cr * 1.32, a + (b - a) * 0.2], [cr * 1.32, b], [cr, b + (b - a) * 0.1]);
            }
            prof.push([cr, y1], [0, y1]);
            g.lathe(prof, { at: [0, 0, z], axis: 'y', color: ALU, mat: M.ALU, segs: 28 });
        }
        g.cbox([-hw * 0.72, hh * 0.62, -len * 0.45], [hw * 0.72, hh, len * 0.45], { color: paint, mat: M.PAINT, bevel: hw * 0.12 });
        for (let k = 0; k <= cyl; k++) g.bolt([hw * 0.55, hh, -len * 0.42 + (k / cyl) * len * 0.84], 'y', hw * 0.06);
        // Exhaust runners.
        for (let k = 0; k < cyl; k++) {
            const z = -len * 0.43 + pitch * (k + 0.5);
            g.tube([[hw * 0.75, hh * 0.25, z], [hw * 1.0, hh * 0.18, z], [hw * 1.05, -hh * 0.2, z + pitch * 0.2], [hw * 1.0, -hh * 0.6, len * 0.3]], hw * 0.09, { color: lin([0.42, 0.33, 0.28]), mat: M.CAST });
        }
        const fly = new Geo();
        const fr = Math.min(hw, hh) * 0.95;
        fly.ring(gearOutline(Math.max(40, Math.round(fr / 0.003)), (fr * 2) / Math.max(40, Math.round(fr / 0.003)), { addendum: 0.8 }), len / 2 - st * 0.1, len / 2 + st * 0.25, { color: STEEL, mat: M.STEEL, bore: fr * 0.3, chamfer: fr * 0.01 });
        fly.lathe([[fr * 0.3, len / 2 + st * 0.25], [0, len / 2 + st * 0.25]], { color: STEEL, mat: M.STEEL, segs: 32 });
        const rs = Math.max(0.004, fr * 0.14);
        stub(fly, rs, len / 2 + st * 0.25, len / 2 + st, {});
        return { body: g, movers: [{ geo: fly, pivot: [0, crankY, 0], axis: 'z', port: 'out', sign: 1 }], shaftR: { out: rs } };
    },

    battery(s, paint) {
        const { hx, hy, hz } = s;
        const g = new Geo();
        const case_ = lin([0.10, 0.11, 0.12]);
        g.cbox([-hx, -hy, -hz], [hx, hy * 0.78, hz], { color: case_, mat: M.PAINT, bevel: Math.min(hx, hy, hz) * 0.1 });
        g.cbox([-hx * 0.97, hy * 0.74, -hz * 0.97], [hx * 0.97, hy, hz * 0.97], { color: paint, mat: M.PAINT, bevel: Math.min(hx, hy) * 0.08 });
        for (let k = 0; k < 6; k++) {
            const z = -hz * 0.8 + (k / 5) * hz * 1.6;
            g.cbox([hx - 0.0002, -hy * 0.7, z - hz * 0.04], [hx + hx * 0.03, hy * 0.6, z + hz * 0.04], { color: case_, mat: M.PAINT, bevel: hx * 0.01 });
            g.cbox([-hx - hx * 0.03, -hy * 0.7, z - hz * 0.04], [-hx + 0.0002, hy * 0.6, z + hz * 0.04], { color: case_, mat: M.PAINT, bevel: hx * 0.01 });
        }
        const tr = Math.min(hx, hz) * 0.09;
        g.lathe([[0, hy], [tr, hy], [tr, hy + tr], [tr * 0.6, hy + tr * 1.5], [0, hy + tr * 1.5]], { at: [hx * 0.55, 0, -hz * 0.5], axis: 'y', color: lin([0.75, 0.12, 0.1]), mat: M.RUBBER, segs: 20 });
        g.lathe([[0, hy], [tr, hy], [tr, hy + tr], [tr * 0.6, hy + tr * 1.5], [0, hy + tr * 1.5]], { at: [-hx * 0.55, 0, -hz * 0.5], axis: 'y', color: RUBBER, mat: M.RUBBER, segs: 20 });
        g.cbox([-hx * 0.5, hy - 0.0002, hz * 0.3], [hx * 0.5, hy + hy * 0.025, hz * 0.4], { color: lin([0.15, 0.9, 0.45]), mat: M.GLOW, bevel: 0 });
        g.tube([[-hx * 0.4, hy, hz * 0.6], [-hx * 0.35, hy * 1.3, hz * 0.6], [hx * 0.35, hy * 1.3, hz * 0.6], [hx * 0.4, hy, hz * 0.6]], Math.min(hx, hy) * 0.05, { color: RUBBER, mat: M.RUBBER });
        return { body: g, movers: [], shaftR: {} };
    },

    leadScrew(s, paint) {
        const { d, stroke, nut, block, L, ball } = s;
        const g = new Geo();
        const z0 = -L / 2, z1 = L / 2;
        // Bearing blocks at each end.
        for (const [a, b] of [[z0, z0 + block], [z1 - block, z1]]) {
            g.cbox([-nut, -nut, a], [nut, nut * 0.7, b], { color: paint, mat: M.PAINT, bevel: nut * 0.12 });
            for (const x of [-nut * 0.65, nut * 0.65]) g.bolt([x, nut * 0.7, (a + b) / 2], 'y', nut * 0.12);
        }
        // Guide rods.
        for (const x of [-nut * 0.72, nut * 0.72]) g.cyl(nut * 0.09, z0 + block, z1 - block, { at: [x, -nut * 0.55, 0], color: lin([0.85, 0.86, 0.88]), mat: M.CHROME });
        // The screw: threads as a sawtooth profile.
        const scr = new Geo();
        const r = d / 2, pitch = Math.max(d * 0.18, Math.min(d * 0.5, 0.004));
        const prof = [[0, z0 - block * 0.0], [r * 0.6, z0]];
        for (let z = z0 + block; z < z1 - block; z += pitch) prof.push([r * 0.82, z], [r, z + pitch * 0.5]);
        prof.push([r * 0.82, z1 - block], [r * 0.6, z1 - block], [r * 0.6, z1 - block * 0.2], [0, z1 - block * 0.2]);
        scr.lathe(prof, { color: ball ? STEEL : BRONZE, mat: M.STEEL, segs: 24, edges: false });
        stub(scr, r * 0.6, z0 + block * 0.5, z0, {});
        // The nut carriage and push rod (slides).
        const car = new Geo();
        const cz = z0 + block + nut * 0.7;
        car.cbox([-nut * 0.95, -nut * 0.8, cz - nut * 0.7], [nut * 0.95, nut * 0.85, cz + nut * 0.7], { color: mix(paint, DARK, 0.3), mat: M.PAINT, bevel: nut * 0.12 });
        car.lathe([[r * 1.1, cz - nut * 0.7 - nut * 0.25], [r * 1.6, cz - nut * 0.7 - nut * 0.25], [r * 1.6, cz - nut * 0.7]], { color: BRONZE, mat: M.BRASS, segs: 32 });
        const rodR = r * 0.75;
        car.cyl(rodR, cz + nut * 0.7, z1 + d * 0.6, { color: lin([0.85, 0.86, 0.88]), mat: M.CHROME });
        return {
            body: g,
            movers: [
                { geo: scr, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 },
                { geo: car, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1, slide: stroke },
            ],
            shaftR: { in: r * 0.6, out: rodR },
        };
    },

    pump(s, paint) {
        const { s: sz, len, stub: st } = s;
        const g = new Geo();
        const hs = sz / 2, cover = len * 0.14, castC = lin([0.24, 0.25, 0.27]);
        // Gear-pump body: a painted centre section between two cast end covers, tie-bolted.
        g.cbox([-hs * 0.94, -hs * 0.94, -len / 2 + cover], [hs * 0.94, hs * 0.94, len / 2 - cover], { color: paint, mat: M.PAINT, bevel: sz * 0.08 });
        for (const sg of [-1, 1]) {
            const a = sg > 0 ? len / 2 - cover : -len / 2, b = sg > 0 ? len / 2 : -len / 2 + cover;
            g.cbox([-hs, -hs, a], [hs, hs, b], { color: castC, mat: M.CAST, bevel: sz * 0.07 });
            for (const x of [-1, 1]) for (const y of [-1, 1]) g.bolt([x * hs * 0.72, y * hs * 0.72, sg * len / 2], sg > 0 ? 'z' : '-z', sz * 0.055);
        }
        // Shaft-seal flange on the input side.
        g.lathe([[sz * 0.15, -len / 2], [sz * 0.36, -len / 2], [sz * 0.36, -len / 2 - st * 0.25], [sz * 0.2, -len / 2 - st * 0.4]], { color: castC, mat: M.CAST, segs: 36 });
        // Pressure port on top and a suction port on the side.
        g.lathe([[0, hs], [sz * 0.16, hs], [sz * 0.16, hs + sz * 0.1], [sz * 0.12, hs + sz * 0.18], [0, hs + sz * 0.18]], { at: [0, 0, len * 0.15], axis: 'y', color: BRASS, mat: M.BRASS, segs: 6 });
        g.lathe([[0, hs * 0.94], [sz * 0.2, hs * 0.94], [sz * 0.2, hs + sz * 0.08], [sz * 0.15, hs + sz * 0.14], [0, hs + sz * 0.14]], { at: [0, 0, -len * 0.05], axis: 'x', color: BRASS, mat: M.BRASS, segs: 6 });
        const sh = new Geo();
        const rs = Math.max(0.003, sz * 0.1);
        stub(sh, rs, -len / 2 - st * 0.4, -len / 2 - st, {});
        return { body: g, movers: [{ geo: sh, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 }], shaftR: { in: rs } };
    },

    ram(s, paint) {
        const { bore, rod, stroke, R, wall, body, eye } = s;
        const g = new Geo();
        const capL = bore * 0.35;
        g.lathe([[0, -body / 2 - eye], [eye * 0.6, -body / 2 - eye], [eye * 0.6, -body / 2]], { color: STEEL, mat: M.STEEL, segs: 24 });
        g.lathe([[0, -body / 2], [R * 1.12, -body / 2], [R * 1.12, -body / 2 + capL], [R, -body / 2 + capL], [R, body / 2 - capL], [R * 1.12, body / 2 - capL], [R * 1.12, body / 2], [rod * 0.55, body / 2]], { color: paint, mat: M.PAINT, segs: 48, chamfer: R * 0.05 });
        for (let k = 0; k < 4; k++) {
            const a = (k / 4 + 0.125) * TAU;
            g.cyl(R * 0.07, -body / 2 - 0.0005, body / 2 + 0.0005, { at: [Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, 0], color: STEEL, mat: M.STEEL });
            for (const sg of [-1, 1]) g.bolt([Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, sg * body / 2], sg > 0 ? 'z' : '-z', R * 0.08);
        }
        g.lathe([[0, R], [wall * 1.2, R], [wall * 1.2, R + wall * 1.5], [0, R + wall * 1.5]], { at: [0, 0, -body / 2 + bore * 0.4], axis: 'y', color: BRASS, mat: M.BRASS, segs: 6 });
        const rodG = new Geo();
        rodG.cyl(rod / 2, body / 2 - stroke * 0.98, body / 2 + eye * 0.6, { color: lin([0.88, 0.89, 0.9]), mat: M.CHROME });
        rodG.lathe([[0, body / 2 + eye * 0.6], [eye * 0.7, body / 2 + eye * 0.6], [eye * 0.7, body / 2 + eye * 1.6], [0, body / 2 + eye * 1.6]], { color: STEEL, mat: M.STEEL, segs: 24 });
        return { body: g, movers: [{ geo: rodG, pivot: [0, 0, 0], axis: 'z', port: 'out', sign: 1, slide: stroke }], shaftR: { out: rod / 2 } };
    },
};

/** Links (pitch pc) along the run of a two-sprocket chain: [x, y, angle] each. */
function beltPath(r1, r2, span, pc) {
    const pts = [];
    const a = Math.asin(Math.max(-1, Math.min(1, (r2 - r1) / span)));
    const segs = [];
    // Arc around sprocket 1 (bottom, centre 0,0), straight up the right, arc around 2, down the left.
    const arc = (cx, cy, r, a0, a1) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / pc)); for (let k = 0; k < n; k++) { const t = a0 + (a1 - a0) * (k / n); segs.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, t + Math.PI / 2]); } };
    const line = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / pc)); const ang = Math.atan2(y1 - y0, x1 - x0); for (let k = 0; k < n; k++) { const t = k / n; segs.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ang]); } };
    arc(0, 0, r1, Math.PI + a, TAU - a);
    line(Math.cos(-a) * r1, Math.sin(-a) * r1, Math.cos(-a) * r2, span + Math.sin(-a) * r2);
    arc(0, span, r2, -a, Math.PI + a);
    line(Math.cos(Math.PI + a) * r2, span + Math.sin(Math.PI + a) * r2, Math.cos(Math.PI + a) * r1, Math.sin(Math.PI + a) * r1);
    for (const sgm of segs) pts.push(sgm);
    return pts;
}

/** Append g2 rotated by `ang` about Z and moved by `at`. */
function rotateAppend(g, g2, ang, at = [0, 0, 0]) {
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let k = 0; k < g2.count; k++) {
        const x = g2.p[k * 3], y = g2.p[k * 3 + 1];
        g2.p[k * 3] = c * x - s * y + at[0]; g2.p[k * 3 + 1] = s * x + c * y + at[1]; g2.p[k * 3 + 2] += at[2];
        const nx = g2.n[k * 3], ny = g2.n[k * 3 + 1];
        g2.n[k * 3] = c * nx - s * ny; g2.n[k * 3 + 1] = s * nx + c * ny;
    }
    g.append(g2);
}

// A fabricated boom: a box-section beam welded between cheek plates round its
// pivot hub, a bolted plate at the tip. The beam stands still in the pose the
// compiler judged it in; its pivot pin turns with the joint.
BUILD.boom = function boom(s, paint) {
    const { L, h, w, t, hub, plate, stub: st } = s;
    const g = new Geo();
    const ct = Math.max(t * 1.5, w * 0.07);       // cheek plate thickness
    const bw = w / 2 - ct;                         // half width of the beam between the cheeks
    const cap = Math.max(t, h * 0.04);
    // Beam: painted box section, steel flange strips top and bottom.
    g.cbox([hub * 0.5, -h / 2 + cap, -bw], [L, h / 2 - cap, bw], { color: paint, mat: M.PAINT, bevel: t * 0.6 });
    g.cbox([hub * 0.5, h / 2 - cap, -bw - ct * 0.4], [L, h / 2, bw + ct * 0.4], { color: mix(paint, DARK, 0.15), mat: M.PAINT, bevel: cap * 0.3 });
    g.cbox([hub * 0.5, -h / 2, -bw - ct * 0.4], [L, -h / 2 + cap, bw + ct * 0.4], { color: mix(paint, DARK, 0.15), mat: M.PAINT, bevel: cap * 0.3 });
    // Cheek plates round the hub, tapering into the beam.
    const cheek = hullOfCircles([[0, 0, hub], [Math.min(L * 0.45, hub * 3), 0, h * 0.5]]);
    g.ring(cheek, bw, w / 2, { color: paint, mat: M.PAINT, chamfer: ct * 0.25 });
    g.ring(cheek, -w / 2, -bw, { color: paint, mat: M.PAINT, chamfer: ct * 0.25 });
    // The hub between the cheeks, and bronze bushings showing on both faces.
    g.lathe([[hub * 0.42, -bw], [hub * 0.92, -bw], [hub * 0.92, bw], [hub * 0.42, bw]], { color: mix(paint, DARK, 0.3), mat: M.CAST, segs: 48 });
    for (const sd of [1, -1]) {
        const z0 = sd * (w / 2 - ct * 0.3), z1 = sd * (w / 2 + ct * 0.02);
        g.lathe([[hub * 0.42, z0], [hub * 0.62, z0], [hub * 0.62, z1], [hub * 0.42, z1]], { color: BRONZE, mat: M.BRASS, segs: 40 });
    }
    g.boltCircle(hub * 0.78, 6, w / 2, Math.max(0.002, hub * 0.07), { axis: 'z' });
    g.boltCircle(hub * 0.78, 6, w / 2, Math.max(0.002, hub * 0.07), { axis: '-z' });
    // Tip plate with its bolts.
    const py = Math.min(h * 0.6, hub * 0.98), pz = w / 2;
    g.cbox([L, -py, -pz], [L + plate, py, pz], { color: STEEL, mat: M.STEEL, bevel: plate * 0.2 });
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.bolt([L + plate, y * py * 0.72, z * pz * 0.7], 'x', Math.max(0.002, Math.min(py, pz) * 0.12));
    // The pivot pin, turning with the joint.
    const rs = Math.max(0.003, hub * 0.4);
    const pin = new Geo();
    stub(pin, rs, w / 2 - ct * 0.6, -w / 2 - st, { axis: 'z' });      // its far end sunk in the far cheek
    g.lathe([[hub * 0.42, w / 2 + ct * 0.02], [0, w / 2 + ct * 0.02]], { color: DARK, mat: M.CAST, segs: 40, edges: false });
    return { body: g, movers: [{ geo: pin, pivot: [0, 0, 0], axis: 'z', port: 'in', sign: 1 }], shaftR: { in: rs } };
};

export function meshPart(el, paint) {
    const f = BUILD[el.shape.kind];
    if (!f) throw new Error('foundry: no mesh for ' + el.shape.kind);
    return f(el.shape, paint || lin([0.5, 0.5, 0.52]));
}
