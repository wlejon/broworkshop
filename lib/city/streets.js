// lib/city/streets.js — streets as streamlines of the city's tensor field.
//
// Two families of streamlines (along the field's major direction and across
// it) traced with a separation distance, after Chen et al. 2008 ("Interactive
// procedural street modeling"): each accepted street seeds the other family
// along it, densest ground first, so a core gets its grid and the outskirts
// bend with the hills and the shore. Two levels: arterials (level 0, a few
// hundred metres apart, crossing water on bridges) and local streets
// (level 1, ~100 m apart, only where the density field says there is town).
//
// traceStreets(field, opts) -> [{ pts: [x0, z0, x1, z1, ...], level, family, bridge: [i, j]?, kind }]

import { smoothstep } from "./field.js";

class Heap {
    constructor() { this.a = []; }
    push(item, key) { const a = this.a; a.push([key, item]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] >= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
        const a = this.a; if (!a.length) return null;
        const top = a[0][1]; const last = a.pop();
        if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] > a[m][0]) m = l; if (r < a.length && a[r][0] > a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
        return top;
    }
    get size() { return this.a.length; }
}

/** Points of a family, hashed in cells, to test a new point's distance to them. */
class PointHash {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
    add(x, z, tag, tx = 0, tz = 0) {
        const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
        let b = this.m.get(k); if (!b) { b = []; this.m.set(k, b); }
        b.push(x, z, tag, tx, tz);
    }
    /** True when a point within r was added (its tag an arc length) more than `gap` along the line from `arc`. */
    nearAlong(x, z, r, arc, gap) {
        const c = this.cell, r2 = r * r;
        const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
        const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const b = this.m.get(this.key(i, j)); if (!b) continue;
            for (let q = 0; q < b.length; q += 5) {
                const ex = b[q] - x, ez = b[q + 1] - z;
                if (ex * ex + ez * ez < r2 && Math.abs(b[q + 2] - arc) > gap) return true;
            }
        }
        return false;
    }
    /** True when a point within r runs along (dx, dz): its tangent within acos(cos). */
    nearParallel(x, z, r, dx, dz, cos) {
        const c = this.cell, r2 = r * r;
        const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
        const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const b = this.m.get(this.key(i, j)); if (!b) continue;
            for (let q = 0; q < b.length; q += 5) {
                const ex = b[q] - x, ez = b[q + 1] - z;
                if (ex * ex + ez * ez < r2 && Math.abs(b[q + 3] * dx + b[q + 4] * dz) > cos) return true;
            }
        }
        return false;
    }
    /** True when some point (other than tag `skip`) lies within r. */
    near(x, z, r, skip = -1) {
        const c = this.cell, r2 = r * r;
        const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
        const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const b = this.m.get(this.key(i, j)); if (!b) continue;
            for (let q = 0; q < b.length; q += 5) {
                if (b[q + 2] === skip) continue;
                const dx = b[q] - x, dz = b[q + 1] - z;
                if (dx * dx + dz * dz < r2) return true;
            }
        }
        return false;
    }
}

export const LEVEL = [
    { // arterials
        step: 12, minLen: 260, maxLen: 9000,
        dsep: (d) => d > 0.02 ? 360 + 520 * (1 - d) : 1500,
        minDensity: 0.015,
    },
    { // local streets: blocks longer than deep, as a town lays them out (the
      // streets along the field's major direction close, the cross streets
      // farther apart: by the water, its long side to the bank)
        step: 6, minLen: 36, maxLen: 1800,
        dsep: (d, family) => (d > 0.55 ? 104 : d > 0.25 ? 96 : 88) * (family === 0 ? 1 : d > 0.55 ? 1.65 : d > 0.25 ? 1.9 : 2.3),
        minDensity: 0.05,
    },
];

export function traceStreets(field, opts = {}) {
    const site = field.site;
    const half = site.half - 160;
    // Arterials come to the water's edge (to cross it); a local street keeps
    // a lot's depth and more back from it, the bank built on behind it.
    const waterClear = opts.waterClear ?? 24;
    const localClear = opts.localWaterClear ?? 90;
    const maxSlope = opts.maxSlope ?? 0.13;
    const lines = [];
    let tagSeq = 1;

    // One hash per (level, family); a level-1 hash also holds level 0's points
    // of its family, so local streets keep off the parallel arterial.
    const hashes = [[new PointHash(64), new PointHash(64)], [new PointHash(32), new PointHash(32)]];

    const dirAt = (x, z, family) => {
        const [mx, mz] = field.major(x, z);
        return family === 0 ? [mx, mz] : [-mz, mx];
    };
    function addLine(line) {
        lines.push(line);
        const p = line.pts;
        for (let lv = line.level; lv < 2; lv++) {
            for (let i = 0; i < p.length; i += 2) {
                const a = Math.max(0, i - 2), b = Math.min(p.length - 2, i + 2);
                let tx = p[b] - p[a], tz = p[b + 1] - p[a + 1];
                const l = Math.hypot(tx, tz) || 1;
                hashes[lv][line.family].add(p[i], p[i + 1], line.tag, tx / l, tz / l);
            }
        }
    }

    /** One direction from a seed: points until a stop. */
    function march(x, z, family, level, sign, tag, out, self) {
        const L = LEVEL[level];
        const h = L.step;
        let [dx, dz] = dirAt(x, z, family);
        dx *= sign; dz *= sign;
        let len = 0;
        let stop = 'length';
        const hash = hashes[level][family];
        const sx = x, sz = z;
        let bridge = null;
        while (len < L.maxLen) {
            // RK2 with the eigenvector's sign kept along the march.
            let [ax, az] = dirAt(x, z, family);
            if (ax * dx + az * dz < 0) { ax = -ax; az = -az; }
            const mx = x + ax * h * 0.5, mz = z + az * h * 0.5;
            let [bx, bz] = dirAt(mx, mz, family);
            if (bx * dx + bz * dz < 0) { bx = -bx; bz = -bz; }
            // Keep turning gentle: a street does not kink at a field singularity.
            if (bx * dx + bz * dz < 0.94) {
                const t = 0.35;
                bx = dx + (bx - dx) * t; bz = dz + (bz - dz) * t;
                const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l;
            }
            const nx = x + bx * h, nz = z + bz * h;
            if (Math.abs(nx) > half || Math.abs(nz) > half) { stop = 'edge'; break; }
            const d = field.density(nx, nz);
            if (d < L.minDensity) { stop = 'rural'; break; }
            if (field.water(nx, nz) < (level === 0 ? waterClear : localClear)) {
                if (level === 0) bridge = tryBridge(nx, nz, bx, bz);
                stop = 'water';
                break;
            }
            const grade = Math.abs(field.height(nx, nz) - field.height(x, z)) / h;
            if (grade > maxSlope && field.water(nx, nz) > 90) { stop = 'slope'; break; }
            const dtest = L.dsep(d, family) * 0.5;
            if (hash.near(nx, nz, dtest, tag)) { stop = 'near'; break; }
            // Nor near itself: a long line winding back alongside its own
            // course (its points are in the hashes only once it is done).
            if (self.nearAlong(nx, nz, dtest, sign * (len + h), dtest * 4)) { stop = 'near'; break; }
            // Where the field turns, a line of the other family can come to
            // run alongside: two roads side by side, a sliver between.
            if (len > h * 3 && hashes[level][1 - family].nearParallel(nx, nz, level === 0 ? 160 : 40, bx, bz, 0.9)) { stop = 'near'; break; }
            if (len > 200 && Math.hypot(nx - sx, nz - sz) < h * 1.5) { stop = 'loop'; break; }
            x = nx; z = nz; dx = bx; dz = bz;
            out.push(x, z);
            len += h;
            self.add(x, z, sign * len);
        }
        return { stop, bridge, dx, dz };
    }

    // A crossing: continue straight over the water; a bridge when the far bank
    // is near, the crossing is near square to the shore, and no bridge is close.
    const bridges = [];
    function tryBridge(x, z, dx, dz) {
        const [tx, tz] = site.waterTangent(x, z);
        if (Math.abs(dx * tx + dz * tz) > 0.62) return null; // too oblique
        for (const b of bridges) if (Math.hypot(b[0] - x, b[1] - z) < (opts.bridgeSpacing ?? 750)) return null;
        let len = 0;
        let px = x, pz = z;
        let wet = false;   // a span must cross the water, not skim the bank's clearance
        let land = null;   // where the span lands: the far bank's clearance
        while (len < 420) {
            px += dx * 6; pz += dz * 6; len += 6;
            const w = field.water(px, pz);
            if (w < 0) wet = true;
            else if (!wet && len > 60) return null;
            if (wet && !land && w > waterClear) land = [px, pz];
            // (The far bank's road is seeded a little further in, clear of
            // the margin, and traces back to the landing itself.)
            if (wet && w > waterClear + 4) {
                bridges.push([x, z]);
                return [land[0], land[1], dx, dz, px, pz];
            }
        }
        return null;
    }

    function trace(seedX, seedZ, family, level) {
        const tag = tagSeq++;
        const fwd = [], back = [];
        const self = new PointHash(LEVEL[level].step * 8);
        self.add(seedX, seedZ, 0);
        const a = march(seedX, seedZ, family, level, +1, tag, fwd, self);
        const b = march(seedX, seedZ, family, level, -1, tag, back, self);
        const pts = [];
        for (let i = back.length - 2; i >= 0; i -= 2) pts.push(back[i], back[i + 1]);
        pts.push(seedX, seedZ);
        for (let i = 0; i < fwd.length; i += 2) pts.push(fwd[i], fwd[i + 1]);
        let len = 0;
        for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        return { pts, level, family, tag, len, ends: [b, a], kind: level === 0 ? 'arterial' : 'street' };
    }

    for (let level = 0; level < 2; level++) {
        const L = LEVEL[level];
        const heaps = [new Heap(), new Heap()];
        const seed = (x, z, family) => {
            if (Math.abs(x) > half || Math.abs(z) > half) return;
            const d = field.density(x, z);
            if (d < L.minDensity) return;
            heaps[family].push([x, z], d + (level === 0 ? 0 : 0));
        };
        if (level === 0) {
            for (const c of site.centers) { seed(c.x, c.z, 0); seed(c.x, c.z, 1); }
        }
        // Every line so far seeds the next level's streets along it, both families.
        const seedAlong = (line, family, spacing) => {
            const p = line.pts;
            let acc = spacing * 0.5;
            for (let i = 2; i < p.length; i += 2) {
                acc += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
                if (acc >= spacing) { acc = 0; seed(p[i], p[i + 1], family); }
            }
        };
        if (level === 1) {
            for (const ln of lines) {
                const dn = field.density(ln.pts[0], ln.pts[1]);
                seedAlong(ln, 0, LEVEL[1].dsep(dn, 0)); seedAlong(ln, 1, LEVEL[1].dsep(dn, 1));
            }
        } else {
            for (const ln of lines) { seedAlong(ln, 0, 900); seedAlong(ln, 1, 900); }
        }

        let guard = 0;
        while ((heaps[0].size || heaps[1].size) && guard++ < 200000) {
            const fam = heaps[0].size >= heaps[1].size ? 0 : 1;
            const s = heaps[fam].pop();
            const d = field.density(s[0], s[1]);
            if (hashes[level][fam].near(s[0], s[1], L.dsep(d, fam) * 0.9)) continue;
            if (field.water(s[0], s[1]) < (level === 0 ? waterClear : localClear)) continue;
            const line = trace(s[0], s[1], fam, level);
            if (line.len < L.minLen) continue;
            addLine(line);
            const sp = level === 0 ? L.dsep(d) * 0.5 : L.dsep(d, 1 - fam);
            seedAlong(line, 1 - fam, sp);
            // A bridge: its span as a line of its own, and the far bank seeded.
            for (const end of line.ends) {
                if (!end.bridge) continue;
                const [bx, bz, dx, dz, sx, sz] = end.bridge;
                const last = end === line.ends[1] ? line.pts.length - 2 : 0;
                const x0 = line.pts[last], z0 = line.pts[last + 1];
                const span = [x0, z0];
                const n = Math.max(2, Math.ceil(Math.hypot(bx - x0, bz - z0) / 12));
                for (let k = 1; k <= n; k++) span.push(x0 + (bx - x0) * k / n, z0 + (bz - z0) * k / n);
                addLine({ pts: span, level: 0, family: fam, tag: tagSeq++, len: 0, kind: 'bridge' });
                heaps[fam].push([sx + dx * 8, sz + dz * 8], 2);
            }
        }
    }
    return lines;
}
