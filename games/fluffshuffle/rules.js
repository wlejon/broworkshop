// Fluffshuffle rules — pure functions over a 6x6 puff grid.
// A move slides a whole row or column with wrap-around; the settled board
// then matches 3+ in a line (matching itself does not wrap).
// A puff is { color: 1..6, special, locked, arrowDir, phase, blink }; empty = null.

import { makeGrid, copyGrid, findLineMatches, inGrid } from "/lib/arcade/grid.js";

export const ROWS = 6;
export const COLS = 6;
export const COLORS_N = 6;

export const SPECIAL = {
    NONE: 0,
    JUMBO: 1,   // match 4 in a line: clears 3x3
    ARROW: 2,   // match 5 in a line: clears its row or column
    PRISM: 3,   // L / T shape: clears every puff of its color
};

/** Cosmetic fields (breathing phase, blink timing) use Math.random, not the game RNG. */
export function makePuff(color, special, locked, arrowDir) {
    return {
        color,
        special: special || SPECIAL.NONE,
        locked: !!locked,
        arrowDir: arrowDir || null,
        phase: Math.random() * Math.PI * 2,
        blink: Math.floor(Math.random() * 3200),
    };
}

export function randomColor(rand) {
    return 1 + Math.floor(rand() * COLORS_N);
}

export function emptyGrid() {
    return makeGrid(ROWS, COLS);
}

export function clonePuff(p) {
    return Object.assign({}, p);
}

// ── Slides ────────────────────────────────────────────────────────────────

/** New grid with row r rotated by k cells (positive = right). */
export function slideRow(g, r, k) {
    const out = copyGrid(g, clonePuff);
    const w = out[r].length;
    const s = ((k % w) + w) % w;
    if (s) out[r] = out[r].map((_, c) => out[r][(c - s + w) % w]);
    return out;
}

/** New grid with column c rotated by k cells (positive = down). */
export function slideCol(g, c, k) {
    const out = copyGrid(g, clonePuff);
    const h = out.length;
    const s = ((k % h) + h) % h;
    if (s) {
        const col = out.map((row) => row[c]);
        for (let r = 0; r < h; r++) out[r][c] = col[(r - s + h) % h];
    }
    return out;
}

export function slide(g, axis, index, k) {
    return axis === "h" ? slideRow(g, index, k) : slideCol(g, index, k);
}

export function rowLocked(g, r) {
    return g[r].some((p) => p && p.locked);
}

export function colLocked(g, c) {
    return g.some((row) => row[c] && row[c].locked);
}

export function lineLocked(g, axis, index) {
    return axis === "h" ? rowLocked(g, index) : colLocked(g, index);
}

// ── Matching ──────────────────────────────────────────────────────────────

/** Match groups: { cells, color, special, arrowDir, size, maxLine, hasH, hasV }. */
export function findMatches(g) {
    return findLineMatches(g, (p) => p && p.color).map((m) => {
        let special = SPECIAL.NONE, arrowDir = null;
        if (m.hasH && m.hasV) special = SPECIAL.PRISM;
        else if (m.maxLine >= 5) { special = SPECIAL.ARROW; arrowDir = m.hasH ? "h" : "v"; }
        else if (m.maxLine === 4) special = SPECIAL.JUMBO;
        return {
            cells: m.cells, color: m.key, special, arrowDir,
            size: m.size, maxLine: m.maxLine, hasH: m.hasH, hasV: m.hasV,
        };
    });
}

/**
 * Lines that can shift into a match: one { axis, index, k } per unlocked
 * row / column (the smallest k that matches).
 */
export function legalShifts(g) {
    const out = [];
    for (let r = 0; r < g.length; r++) {
        if (rowLocked(g, r)) continue;
        for (let k = 1; k < g[0].length; k++) {
            if (findMatches(slideRow(g, r, k)).length) { out.push({ axis: "h", index: r, k }); break; }
        }
    }
    for (let c = 0; c < g[0].length; c++) {
        if (colLocked(g, c)) continue;
        for (let k = 1; k < g.length; k++) {
            if (findMatches(slideCol(g, c, k)).length) { out.push({ axis: "v", index: c, k }); break; }
        }
    }
    return out;
}

export function hasAnyMatchingShift(g) {
    return legalShifts(g).length > 0;
}

/** Points for a cascade step: 50 per puff x (depth + 1). */
export function scoreChain(count, chainDepth) {
    return count * 50 * (chainDepth + 1);
}

// ── Detonations ───────────────────────────────────────────────────────────

export function blastCells(g, r, c, puff) {
    const out = [];
    if (puff.special === SPECIAL.JUMBO) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) if (inGrid(g, r + dr, c + dc)) out.push([r + dr, c + dc]);
        }
    } else if (puff.special === SPECIAL.ARROW) {
        if (puff.arrowDir === "h") for (let x = 0; x < g[0].length; x++) out.push([r, x]);
        else for (let y = 0; y < g.length; y++) out.push([y, c]);
    } else if (puff.special === SPECIAL.PRISM) {
        for (let y = 0; y < g.length; y++) {
            for (let x = 0; x < g[0].length; x++) if (g[y][x] && g[y][x].color === puff.color) out.push([y, x]);
        }
    }
    return out;
}

/**
 * Expand a clear set through the specials it hits (chaining), skipping the
 * cells in `keep` (where new specials are born). Returns unique [[r, c]].
 */
export function expandClears(g, cells, keep) {
    const keepSet = new Set((keep || []).map(([r, c]) => r + "," + c));
    const seen = new Set();
    const out = [];
    const queue = cells.slice();
    while (queue.length) {
        const [r, c] = queue.shift();
        const k = r + "," + c;
        if (seen.has(k)) continue;
        seen.add(k);
        const puff = g[r][c];
        if (puff && puff.special !== SPECIAL.NONE) queue.push(...blastCells(g, r, c, puff));
        if (!keepSet.has(k)) out.push([r, c]);
    }
    return out;
}

// ── Boards ────────────────────────────────────────────────────────────────

/** Random board: no standing matches, at least one matching shift. */
export function seedGrid(rand) {
    let g = null;
    for (let attempt = 0; attempt < 200; attempt++) {
        g = emptyGrid();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                let color = randomColor(rand);
                for (let t = 0; t < 40 && makesRun(g, r, c, color); t++) color = randomColor(rand);
                g[r][c] = makePuff(color);
            }
        }
        if (!findMatches(g).length && hasAnyMatchingShift(g)) return g;
    }
    return g;
}

function makesRun(g, r, c, color) {
    const same = (y, x) => g[y] && g[y][x] && g[y][x].color === color;
    return (same(r, c - 1) && same(r, c - 2)) || (same(r - 1, c) && same(r - 2, c));
}

/** Puzzle i: a seeded board with locks sprinkled in, a pop target and a move budget. */
export function puzzleSpec(i) {
    return {
        seed: 0x5afe00 + i * 7919,
        locks: Math.min(5, 1 + Math.floor(i / 3)),
        target: 16 + i * 2,
        moves: 10 + Math.floor(i / 2),
    };
}

export const PUZZLE_COUNT = 20;
