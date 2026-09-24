// Procedural tileset atlas for the tile world: 16 columns x 4 rows of 16px cells.
//   Row 0 (0..15):  dirt-path edge-autotile variants (E=1,N=2,W=4,S=8).
//   Row 1 (16..31): bridge-plank variants, same mask order.
//   Row 2 (32+):    32 grass, 33 forest floor, 34 rock, 35..37 water frames,
//                   38 cliff, 39 soil, 40 plaza, 41 sprout, 42 young crop,
//                   43..45 ripe crop frames (sway).

import { seededRandom } from "/lib/arcade/grid.js";

const APX = 16;
export const ACOLS = 16, AROWS = 4;
export const ACELL = {
    PATH0: 0, BRIDGE0: 16,
    GRASS: 32, FORESTF: 33, ROCK: 34, WATER0: 35, WATER1: 36, WATER2: 37,
    CLIFF: 38, SOIL: 39, PLAZA: 40, CROPA: 41, CROPB: 42,
    CROPC0: 43, CROPC1: 44, CROPC2: 45,
};
/** Atlas cell per tile id (index = TILE id). */
export const TILE_ATLAS = [
    0, ACELL.GRASS, ACELL.WATER0, ACELL.FORESTF, ACELL.ROCK, ACELL.SOIL,
    ACELL.PLAZA, ACELL.PATH0, ACELL.BRIDGE0, ACELL.CROPA, ACELL.CROPB,
    ACELL.CROPC0,
];

function inPathShape(x, y, m) {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return true;
    if ((m & 1) && x > 10 && y >= 5 && y <= 10) return true;
    if ((m & 2) && y < 5 && x >= 5 && x <= 10) return true;
    if ((m & 4) && x < 5 && y >= 5 && y <= 10) return true;
    if ((m & 8) && y > 10 && x >= 5 && x <= 10) return true;
    return false;
}

const onRim = (x, y, m) => !inPathShape(x - 1, y, m) || !inPathShape(x + 1, y, m) ||
    !inPathShape(x, y - 1, m) || !inPathShape(x, y + 1, m);

/** RGBA pixels of the atlas: { pixels, width, height }. */
export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = seededRandom(0x4EA47);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++)
            for (let px = 0; px < APX; px++) {
                const c = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(c[0]); buf[i + 1] = clamp(c[1]); buf[i + 2] = clamp(c[2]);
                buf[i + 3] = c.length > 3 ? clamp(c[3]) : 255;
            }
    }
    const noise = (amt) => (rng() - 0.5) * 2 * amt;

    // Path variants 0..15: packed dirt, darker rim.
    for (let m = 0; m < 16; m++) {
        paint(m, (x, y) => {
            if (!inPathShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const pebble = rng() < 0.05 ? -20 : 0;
            const mul = onRim(x, y, m) ? 0.66 : 1;
            return [(128 + n + pebble) * mul, (104 + n + pebble) * mul, (74 + n + pebble) * mul, 255];
        });
    }
    // Bridge variants 16..31: planks with dark rails.
    for (let m = 0; m < 16; m++) {
        paint(16 + m, (x, y) => {
            if (!inPathShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const horiz = (m & 5) !== 0 && (m & 10) === 0;
            const seam = (horiz ? (x % 3 === 2) : (y % 3 === 2)) ? -32 : 0;
            if (onRim(x, y, m)) return [70 + n, 48 + n, 26 + n, 255];
            return [152 + n + seam, 112 + n + seam, 62 + n + seam, 255];
        });
    }
    paint(ACELL.GRASS, () => {
        const n = noise(9), tuft = rng() < 0.06 ? -14 : 0;
        return [88 + n + tuft, 140 + n * 1.3 + tuft, 62 + n + tuft];
    });
    paint(ACELL.FORESTF, () => {
        const n = noise(8), leaf = rng() < 0.10 ? 14 : 0;
        return [50 + n, 92 + n + leaf, 44 + n];
    });
    paint(ACELL.ROCK, () => {
        const n = noise(9);
        if (rng() < 0.05) return [148 + n, 148 + n, 152 + n];
        return [106 + n, 104 + n, 108 + n];
    });
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.85);
            const n = noise(5);
            if (wv > 0.86) return [112 + n, 176 + n, 220 + n];
            return [28 + n + wv * 4, 84 + n + wv * 6, 146 + n + wv * 7];
        });
    }
    paint(ACELL.CLIFF, (x, y) => {            // strata
        const strata = (y % 5 === 0) ? -22 : 0;
        const n = noise(7);
        return [100 + n + strata, 86 + n + strata, 62 + n + strata];
    });
    paint(ACELL.SOIL, (x, y) => {             // tilled rows
        const n = noise(6);
        const row = (y % 4 < 2) ? -18 : 0;
        return [96 + n + row, 70 + n + row, 46 + n + row];
    });
    paint(ACELL.PLAZA, (x, y) => {            // flagstones
        const n = noise(6);
        const seam = ((x % 5 === 4) || (y % 5 === 4)) ? -24 : 0;
        return [118 + n + seam, 112 + n + seam, 102 + n + seam];
    });
    paint(ACELL.CROPA, (x, y) => {            // sprout: soil with tiny green tips
        const n = noise(6);
        if ((x % 4 === 1) && (y % 4 === 1)) return [70 + n, 130 + n, 52 + n];
        const row = (y % 4 < 2) ? -16 : 0;
        return [94 + n + row, 68 + n + row, 44 + n + row, 255];
    });
    paint(ACELL.CROPB, (x, y) => {            // young crop: green rows
        const n = noise(7);
        if (y % 4 === 1 || y % 4 === 2) return [64 + n, 128 + n, 48 + n];
        return [90 + n, 66 + n, 42 + n];
    });
    for (let f = 0; f < 3; f++) {             // ripe crop: golden heads swaying
        paint(ACELL.CROPC0 + f, (x, y) => {
            const n = noise(7);
            if (y % 4 === 1 || y % 4 === 2) {
                const tip = ((x + f) % 3 === 0) ? 30 : 0;
                return [150 + n + tip, 124 + n + tip, 46 + n];
            }
            return [88 + n, 64 + n, 42 + n];
        });
    }
    return { pixels: buf, width: w, height: h };
}
