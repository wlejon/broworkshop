// lib/city/field.js — the city's continuous fields, sampled once on a grid.
//
// A `site` describes the land the city is built on (all plain functions of
// world x, z in metres):
//   site.half                 the square's half extent (the city spans [-half, half]²)
//   site.height(x, z)         ground height
//   site.water(x, z)          signed distance to water (< 0 in water)
//   site.waterTangent(x, z)   unit [tx, tz] along the nearest shore (rivers: the flow)
//   site.centers              [{ x, z, r, angle, weight, kind }] district cores: a
//                             street grid at `angle` (radians) within ~r, and the
//                             density peak the city grows from
//
// buildField(site) samples, on a CELL-metre grid:
//   - the street tensor field (the major eigenvector's angle: streets run along
//     it and across it), a blend of the cores' grids, the shore (streets near
//     water run with it and square to it), the terrain's contours (hill streets
//     follow them), and a slow noise that bends the outskirts;
//   - density 0..1 (how built up: towers at 1, houses ~0.2, none at 0);
//   - slope (ground gradient magnitude).
// The grids stay on the field (`grids`), so a cache can store them and
// fieldFrom() put the same lookups back over them.
// Lookups are bilinear, so a streamline traced through it is smooth.

export const CELL = 32;

export function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

export function hash2(ix, iz, seed) {
    let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
    h = Math.imul((h ^ (h >>> 15)) >>> 0, 0x2c1b3c6d) >>> 0;
    h = Math.imul((h ^ (h >>> 12)) >>> 0, 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return (h >>> 8) * (1.0 / 16777216.0);
}

export function noise2(x, z, cell, seed) {
    const gx = x / cell, gz = z / cell;
    const fx0 = Math.floor(gx), fz0 = Math.floor(gz);
    const fx = gx - fx0, fz = gz - fz0;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(fx0, fz0, seed), b = hash2(fx0 + 1, fz0, seed);
    const c = hash2(fx0, fz0 + 1, seed), d = hash2(fx0 + 1, fz0 + 1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** A deterministic PRNG (mulberry32). */
export function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function buildField(site) {
    const half = site.half;
    const n = Math.ceil((2 * half) / CELL) + 1;
    const tc = new Float32Array(n * n);   // cos 2θ, weighted
    const ts = new Float32Array(n * n);   // sin 2θ, weighted
    const dens = new Float32Array(n * n);
    const slope = new Float32Array(n * n);
    const hgt = new Float32Array(n * n);
    const wat = new Float32Array(n * n);

    // Heights and water first, so slope is a difference of samples.
    for (let j = 0; j < n; j++) {
        const z = -half + j * CELL;
        for (let i = 0; i < n; i++) {
            const x = -half + i * CELL;
            hgt[j * n + i] = site.height(x, z);
            wat[j * n + i] = site.water(x, z);
        }
    }
    const H = (i, j) => hgt[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];

    for (let j = 0; j < n; j++) {
        const z = -half + j * CELL;
        for (let i = 0; i < n; i++) {
            const x = -half + i * CELL;
            const k = j * n + i;
            const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * CELL);
            const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * CELL);
            const sl = Math.hypot(gx, gz);
            slope[k] = sl;
            const w = wat[k];

            let C = 0, S = 0;
            const add = (angle, weight) => {
                C += Math.cos(2 * angle) * weight;
                S += Math.sin(2 * angle) * weight;
            };

            // District grids: each core's angle, strongest at its middle.
            let core = 0;
            for (const c of site.centers) {
                const d = Math.hypot(x - c.x, z - c.z) / c.r;
                const wgt = Math.exp(-d * d * 1.2) * (c.gridWeight ?? 1);
                add(c.angle, wgt);
                core = Math.max(core, (c.weight ?? 1) * Math.exp(-d * d * 0.9));
            }

            // The shore: streets along the water near it.
            if (w > -50) {
                const [tx, tz] = site.waterTangent(x, z);
                add(Math.atan2(tz, tx), 2.6 * Math.exp(-Math.max(0, w) / 220));
            }

            // Contours on slopes.
            if (sl > 0.015) {
                add(Math.atan2(gx, -gz), Math.min(3, (sl - 0.015) * 40));
            }

            // A weak base so the field is defined everywhere.
            add(0.35, 0.02);

            const mag = Math.hypot(C, S) || 1e-6;
            // Slow noise bends the angle where no core holds it.
            const bend = (noise2(x, z, 900, 71) - 0.5) * 0.9 * (1 - Math.min(1, core * 1.4));
            const ang = 0.5 * Math.atan2(S, C) + bend;
            tc[k] = Math.cos(2 * ang) * mag;
            ts[k] = Math.sin(2 * ang) * mag;

            // Density: the cores, fading with distance, none in water or on steep or high ground.
            const r = Math.hypot(x, z);
            const sprawl = 0.22 * (1 - smoothstep(3800, 5400, r)) * (0.75 + 0.5 * noise2(x, z, 700, 13));
            let dd = Math.max(core, sprawl);
            dd *= smoothstep(10, 60, w);
            dd *= 1 - smoothstep(0.10, 0.20, sl) * smoothstep(60, 110, w); // embanked shores are built on
            dd *= 1 - smoothstep(70, 95, hgt[k]);
            // Parks and greenbelts: holes in the outskirts.
            const park = noise2(x + 1300, z - 700, 520, 29);
            dd *= 1 - smoothstep(0.66, 0.76, park) * (1 - Math.min(1, core * 2.0));
            dens[k] = Math.max(0, Math.min(1, dd));
        }
    }
    return fieldFrom(site, n, { tc, ts, dens, slope, hgt, wat });
}

/** The field's lookups over sampled grids: buildField's, or the same grids read back from a cache (cache.js). */
export function fieldFrom(site, n, grids) {
    const half = site.half;
    const { tc, ts, dens, slope, hgt, wat } = grids;
    const at = (arr, x, z) => {
        const gx = (x + half) / CELL, gz = (z + half) / CELL;
        const i0 = Math.max(0, Math.min(n - 2, Math.floor(gx)));
        const j0 = Math.max(0, Math.min(n - 2, Math.floor(gz)));
        const fx = Math.max(0, Math.min(1, gx - i0)), fz = Math.max(0, Math.min(1, gz - j0));
        const k = j0 * n + i0;
        const a = arr[k], b = arr[k + 1], c = arr[k + n], d = arr[k + n + 1];
        return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };

    return {
        n, half,
        /** Unit major direction [dx, dz] at (x, z); the minor is it turned 90°. */
        major(x, z) {
            const c = at(tc, x, z), s = at(ts, x, z);
            const a = 0.5 * Math.atan2(s, c);
            return [Math.cos(a), Math.sin(a)];
        },
        density: (x, z) => at(dens, x, z),
        slope: (x, z) => at(slope, x, z),
        height: (x, z) => at(hgt, x, z),
        water: (x, z) => at(wat, x, z),
        grids,
        site,
    };
}
