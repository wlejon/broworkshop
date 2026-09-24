// atlas.js — Procedural tileset atlas and autotile variant masks for DeepDelve.
import { seededRandom } from '/lib/arcade/grid.js';

// --- blob47 variant table --------------------------------------------------------
// Mirrors bro/src/tile/autotile.cpp: 8-neighbour mask bits E=1,NE=2,N=4,NW=8,
// W=16,SW=32,S=64,SE=128; a corner bit only counts when both adjacent edge
// bits are set; variant index = rank of the normalized mask in increasing
// order. blobVariantMasks()[i] is the canonical neighbour mask of variant i,
// which is exactly what the atlas painter needs to draw each variant's art.

const B = { E: 1, NE: 2, N: 4, NW: 8, W: 16, SW: 32, S: 64, SE: 128 };

function normBlob(m) {
    let out = m & 0x55;
    if ((m & B.NE) && (m & B.E) && (m & B.N)) out |= B.NE;
    if ((m & B.NW) && (m & B.N) && (m & B.W)) out |= B.NW;
    if ((m & B.SW) && (m & B.W) && (m & B.S)) out |= B.SW;
    if ((m & B.SE) && (m & B.S) && (m & B.E)) out |= B.SE;
    return out;
}

export function blobVariantMasks() {
    const out = [];
    for (let m = 0; m < 256; m++) if (normBlob(m) === m) out.push(m);
    return out;   // length 47
}

// --- Procedural tileset atlas ------------------------------------------------------
// 16x4 grid of 16px cells (256x64 RGBA). Cells 1..47 are the blob47 wall-top
// variants (mortar seams trace the wall silhouette); the rest are floors,
// animated water, doors, stairs, the revealed trap and the cliff face.
// Atlas orientation: cell-pixel top edge renders on the grid-north (y-1) side.

export const APX = 16, ACOLS = 16, AROWS = 4;
export const ACELL = {
    FLOOR: 48, MOSS: 49, CRACK: 50, WATER0: 51, WATER1: 52, WATER2: 53,
    DOOR: 54, DOOR_OPEN: 55, STAIRS_DOWN: 56, STAIRS_UP: 57, TRAPR: 58, CLIFF: 59,
};
export const TILE_ATLAS = [
    0, 1,                                   // 0 empty, 1 wall (autotile overrides)
    ACELL.FLOOR, ACELL.MOSS, ACELL.CRACK, ACELL.WATER0,
    ACELL.DOOR, ACELL.DOOR_OPEN, ACELL.STAIRS_DOWN, ACELL.STAIRS_UP, ACELL.TRAPR,
];

export function makeAtlas() {
    const w = ACOLS * APX, h = AROWS * APX;
    const buf = new Uint8Array(w * h * 4);
    const rng = seededRandom(0xD0E5A11);
    const clamp = (v) => Math.max(0, Math.min(255, v | 0));
    function paint(cell, fn) {
        const cx = (cell % ACOLS) * APX, cy = Math.floor(cell / ACOLS) * APX;
        for (let py = 0; py < APX; py++) {
            for (let px = 0; px < APX; px++) {
                const [r, g, b] = fn(px, py);
                const i = ((cy + py) * w + cx + px) * 4;
                buf[i] = clamp(r); buf[i + 1] = clamp(g); buf[i + 2] = clamp(b);
                buf[i + 3] = 255;
            }
        }
    }
    const noise = (amt) => (rng() - 0.5) * 2 * amt;

    // Wall-top blob variants at cells 1..47.
    blobVariantMasks().forEach((m, i) => {
        paint(1 + i, (x, y) => {
            const n = noise(8);
            const blk = (((x >> 2) * 7 + (y >> 2) * 13) % 5) * 3 - 6;
            let r = 86 + n + blk, g = 88 + n + blk, b = 103 + n + blk;
            const oE = !(m & B.E), oN = !(m & B.N), oW = !(m & B.W), oS = !(m & B.S);
            let mul = 1;
            if ((oE && x >= 14) || (oW && x <= 1) || (oN && y <= 1) || (oS && y >= 14)) mul = 0.40;
            else if ((oE && x === 13) || (oW && x === 2) || (oN && y === 2)) mul = 1.24;
            else if (oS && y === 13) mul = 0.78;
            // inner-corner pips: both edges joined but the diagonal is not
            if (!oE && !oN && !(m & B.NE) && x >= 13 && y <= 2) mul = 0.40;
            if (!oN && !oW && !(m & B.NW) && x <= 2 && y <= 2) mul = 0.40;
            if (!oW && !oS && !(m & B.SW) && x <= 2 && y >= 13) mul = 0.40;
            if (!oS && !oE && !(m & B.SE) && x >= 13 && y >= 13) mul = 0.40;
            return [r * mul, g * mul, b * mul];
        });
    });

    // Floor flagstones (48), mossy (49), cracked (50).
    const flag = (x, y, r0, g0, b0) => {
        const n = noise(6);
        const seam = (x % 8 === 7 || y % 8 === 7) ? 0.72 : 1;
        const spark = rng() < 0.02 ? 18 : 0;
        return [(r0 + n + spark) * seam, (g0 + n + spark) * seam, (b0 + n + spark) * seam];
    };
    paint(ACELL.FLOOR, (x, y) => flag(x, y, 60, 58, 68));
    paint(ACELL.MOSS, (x, y) => {
        const c = flag(x, y, 56, 60, 62);
        const blob = Math.hypot(x - 5, y - 9) < 4 || Math.hypot(x - 12, y - 4) < 3;
        return blob ? [c[0] * 0.7, c[1] * 1.35, c[2] * 0.7] : c;
    });
    paint(ACELL.CRACK, (x, y) => {
        const c = flag(x, y, 60, 58, 68);
        const on = Math.abs((y - 2) - (x * 0.8)) < 0.9 || (x > 9 && Math.abs(y - x + 4) < 0.9);
        return on ? [c[0] * 0.45, c[1] * 0.45, c[2] * 0.45] : c;
    });

    // Water, 3 animated frames (51..53).
    for (let f = 0; f < 3; f++) {
        paint(ACELL.WATER0 + f, (x, y) => {
            const wv = Math.sin((x + f * 5) * 0.55 + y * 0.8) + Math.sin(y * 0.5 - f * 1.9);
            const n = noise(4);
            if (wv > 1.3) return [64 + n, 116 + n, 148 + n];
            return [16 + n + wv * 3, 40 + n + wv * 4, 58 + n + wv * 5];
        });
    }

    // Door, closed (54): wood planks + frame + iron bands.
    paint(ACELL.DOOR, (x, y) => {
        if (x === 0 || y === 0 || x === 15 || y === 15) return [34, 26, 20];
        const n = noise(7);
        if (y === 5 || y === 10) return [72 + n, 72 + n, 80 + n];       // iron bands
        const plank = (x % 4 === 3) ? 0.6 : 1;
        return [(104 + n) * plank, (70 + n) * plank, (38 + n) * plank];
    });
    // Door, open (55): floor with wooden jambs.
    paint(ACELL.DOOR_OPEN, (x, y) => {
        if (x <= 1 || x >= 14) return [88 + noise(6), 60 + noise(5), 34];
        return flag(x, y, 52, 50, 60);
    });

    // Stairs down (56): bands darkening; stairs up (57): bands lightening.
    paint(ACELL.STAIRS_DOWN, (x, y) => {
        const band = y >> 2;
        const m = 1 - band * 0.21;
        const seam = (y % 4 === 0) ? 0.6 : 1;
        const n = noise(5);
        return [(78 + n) * m * seam, (76 + n) * m * seam, (88 + n) * m * seam];
    });
    paint(ACELL.STAIRS_UP, (x, y) => {
        const band = y >> 2;
        const m = 0.55 + band * 0.17;
        const seam = (y % 4 === 0) ? 0.6 : 1;
        const n = noise(5);
        return [(92 + n) * m * seam, (88 + n) * m * seam, (86 + n) * m * seam];
    });

    // Revealed trap (58): floor + crimson rune diamond.
    paint(ACELL.TRAPR, (x, y) => {
        const c = flag(x, y, 56, 52, 60);
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        if (d > 4.4 && d < 6.4) return [168 + noise(10), 34, 44];
        if (d <= 1.6) return [150, 40, 48];
        return c;
    });

    // Cliff strata (59) — stretched vertically on tall drops, reads as rock beds.
    paint(ACELL.CLIFF, (x, y) => {
        const n = noise(6);
        const strata = (y % 5 === 0) ? 0.68 : 1;
        const depth = 1 - y * 0.016;
        return [(74 + n) * strata * depth, (70 + n) * strata * depth, (82 + n) * strata * depth];
    });

    return { pixels: buf, width: w, height: h };
}
