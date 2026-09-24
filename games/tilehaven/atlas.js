// atlas.js — TileHaven's procedural tileset atlas.
//
// 16x4 grid of 16px cells (256x64 RGBA):
//   Row 0 (cells  0..15): road edge-autotile variants, mask bit0=E bit1=N
//                         bit2=W bit3=S (atlas cell top edge renders on the
//                         grid-north / y-1 side). Transparent off-road.
//   Row 1 (cells 16..31): bridge variants, same mask order (wood planks).
//   Row 2 (cells 32..47): terrain: 32 grass, 33 forest floor, 34 ore rock,
//                         35..37 water frames, 38 cliff, 40..42 crop frames.

import { seededRandom } from "/lib/arcade/grid.js";

export const APX = 16, ACOLS = 16, AROWS = 4;

export const ACELL = {
    ROAD0: 0, BRIDGE0: 16,
    GRASS: 32, FOREST: 33, ORE: 34, WATER0: 35, WATER1: 36, WATER2: 37,
    CLIFF: 38, CROP0: 40, CROP1: 41, CROP2: 42,
};

// tile id -> atlas cell (autotile rules override roads/bridges per neighbour);
// indexed by the TILE ids in sim.js (0 empty, 1 grass .. 7 crop).
export const TILE_ATLAS = [
    0, ACELL.GRASS, ACELL.WATER0, ACELL.FOREST, ACELL.ORE,
    ACELL.ROAD0, ACELL.BRIDGE0, ACELL.CROP0,
];

// Which pixels of a 16px cell belong to the road shape for edge mask m.
function inRoadShape(x, y, m) {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return true;             // core
    if ((m & 1) && x > 10 && y >= 5 && y <= 10) return true;             // E arm
    if ((m & 2) && y < 5 && x >= 5 && x <= 10) return true;              // N arm
    if ((m & 4) && x < 5 && y >= 5 && y <= 10) return true;              // W arm
    if ((m & 8) && y > 10 && x >= 5 && x <= 10) return true;             // S arm
    return false;
}

function onRim(x, y, m) {
    return !inRoadShape(x - 1, y, m) || !inRoadShape(x + 1, y, m) ||
           !inRoadShape(x, y - 1, m) || !inRoadShape(x, y + 1, m);
}

/** The atlas as { pixels, width, height } (deterministic). */
export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = seededRandom(0x7A11E);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    const noise = (amt) => (rng() - 0.5) * 2 * amt;
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const c = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(c[0]); buf[i + 1] = clamp(c[1]); buf[i + 2] = clamp(c[2]);
                buf[i + 3] = c.length > 3 ? clamp(c[3]) : 255;
            }
        }
    }

    // Road variants 0..15: grey cobbles, darker rim where the shape ends.
    for (let m = 0; m < 16; m++) {
        paint(ACELL.ROAD0 + m, (x, y) => {
            if (!inRoadShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(7);
            const cob = ((x % 4 === 3) || (y % 4 === 3)) ? -16 : 0;
            const mul = onRim(x, y, m) ? 0.62 : 1;
            return [(122 + n + cob) * mul, (117 + n + cob) * mul, (108 + n + cob) * mul, 255];
        });
    }
    // Bridge variants 16..31: wooden planks with dark rails.
    for (let m = 0; m < 16; m++) {
        paint(ACELL.BRIDGE0 + m, (x, y) => {
            if (!inRoadShape(x, y, m)) return [0, 0, 0, 0];
            const n = noise(8);
            const horiz = (m & 5) !== 0 && (m & 10) === 0;   // pure E/W run
            const seam = (horiz ? (x % 3 === 2) : (y % 3 === 2)) ? -34 : 0;
            if (onRim(x, y, m)) return [72 + n, 50 + n, 26 + n, 255];
            return [158 + n + seam, 116 + n + seam, 66 + n + seam, 255];
        });
    }
    paint(ACELL.GRASS, () => {
        const n = noise(9), tuft = rng() < 0.06 ? -16 : 0;
        return [92 + n + tuft, 148 + n * 1.3 + tuft, 66 + n + tuft];
    });
    // Forest floor: darker, mulchy.
    paint(ACELL.FOREST, () => {
        const n = noise(8), leaf = rng() < 0.10 ? 14 : 0;
        return [52 + n, 96 + n + leaf, 46 + n];
    });
    // Ore rock: grey with copper flecks.
    paint(ACELL.ORE, () => {
        const n = noise(8);
        if (rng() < 0.07) return [196 + n, 138 + n, 58 + n];
        return [112 + n, 110 + n, 112 + n];
    });
    // Water frames: a drifting shimmer band.
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.85);
            const n = noise(5);
            if (wv > 1.0 - f * 0.04 && wv > 0.86) return [116 + n, 182 + n, 226 + n];
            return [30 + n + wv * 4, 88 + n + wv * 6, 150 + n + wv * 7];
        });
    }
    // Cliff strata.
    paint(ACELL.CLIFF, (x, y) => {
        const strata = (y % 5 === 0) ? -24 : 0;
        const n = noise(7);
        return [104 + n + strata, 88 + n + strata, 62 + n + strata];
    });
    // Crop frames: soil rows, sprout tips shimmer across frames.
    for (let f = 0; f < 3; f++) {
        paint(ACELL.CROP0 + f, (x, y) => {
            const n = noise(6);
            if (y % 4 === 1 || y % 4 === 2) {
                const tip = ((x + f) % 4 === 0) ? 34 : 0;
                return [64 + n + tip * 0.4, 138 + n + tip, 50 + n];
            }
            return [92 + n, 70 + n, 44 + n];
        });
    }
    return { pixels: buf, width: w, height: h };
}
