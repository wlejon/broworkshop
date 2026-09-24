// Gemswap rules — pure functions over an 8x8 gem grid (no timing, no drawing).
// A gem is { color: 1..7, special: SPECIAL.*, frozen: bool }; empty = null.

import { makeGrid, findLineMatches, inGrid } from "/lib/arcade/grid.js";

export const ROWS = 8;
export const COLS = 8;
export const COLORS_N = 7;

export const SPECIAL = {
    NONE: 0,
    FLAME: 1,   // match 4 in a line: 3x3 burst
    STAR: 2,    // L / T / + shape: row + column
    HYPER: 3,   // match 5+ in a line: swap to clear a whole color
};

export function makeGem(color, special, frozen) {
    return { color, special: special || SPECIAL.NONE, frozen: !!frozen };
}

export function randomColor(rand) {
    return 1 + Math.floor(rand() * COLORS_N);
}

export function emptyGrid() {
    return makeGrid(ROWS, COLS);
}

// ── Matching ──────────────────────────────────────────────────────────────

/** Special earned by a match group's shape. */
export function specialFor(group) {
    if (group.hasH && group.hasV) return SPECIAL.STAR;
    if (group.maxLine >= 5) return SPECIAL.HYPER;
    if (group.maxLine === 4) return SPECIAL.FLAME;
    return SPECIAL.NONE;
}

/** Match groups: { cells: [[r, c]], color, special, size, maxLine }. */
export function findMatches(g) {
    return findLineMatches(g, (gem) => gem && gem.color).map((m) => ({
        cells: m.cells,
        color: m.key,
        special: specialFor(m),
        size: m.size,
        maxLine: m.maxLine,
    }));
}

/** Would swapping (r1,c1) <-> (r2,c2) match? Hypergems always do. Leaves g unchanged. */
export function swapMakesMatch(g, r1, c1, r2, c2) {
    if (!inGrid(g, r1, c1) || !inGrid(g, r2, c2)) return false;
    const a = g[r1][c1], b = g[r2][c2];
    if (!a || !b || a.frozen || b.frozen) return false;
    if (a.special === SPECIAL.HYPER || b.special === SPECIAL.HYPER) return true;
    g[r1][c1] = b; g[r2][c2] = a;
    const hit = findMatches(g).length > 0;
    g[r1][c1] = a; g[r2][c2] = b;
    return hit;
}

/** Any valid move as { r, c, dr, dc }, or null when the board is dead. */
export function findAnyMove(g) {
    for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[0].length; c++) {
            if (swapMakesMatch(g, r, c, r, c + 1)) return { r, c, dr: 0, dc: 1 };
            if (swapMakesMatch(g, r, c, r + 1, c)) return { r, c, dr: 1, dc: 0 };
        }
    }
    return null;
}

export function isAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

// ── Scoring ───────────────────────────────────────────────────────────────

export function baseScore(size) {
    if (size >= 5) return 150;
    if (size === 4) return 100;
    return 50;
}

/** Points for one cascade step: group base scores x (depth + 1). */
export function scoreChain(groupSizes, chainDepth) {
    let total = 0;
    for (const n of groupSizes) total += baseScore(n);
    return total * (chainDepth + 1);
}

// ── Detonations ───────────────────────────────────────────────────────────

/**
 * Cells a special destroys when it is cleared at (r, c): flame = 3x3,
 * star = its row + column. Hypergems fire only when swapped.
 */
export function blastCells(g, r, c, special) {
    const out = [];
    if (special === SPECIAL.FLAME) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (inGrid(g, r + dr, c + dc)) out.push([r + dr, c + dc]);
            }
        }
    } else if (special === SPECIAL.STAR) {
        for (let x = 0; x < g[0].length; x++) out.push([r, x]);
        for (let y = 0; y < g.length; y++) out.push([y, c]);
    }
    return out;
}

/**
 * Expand a clear set through specials it hits, chaining: a flame caught in
 * a star's line fires too. `keep` is a cell that survives (the new special).
 * Returns unique [[r, c]].
 */
export function expandClears(g, cells, keep) {
    const seen = new Set();
    const out = [];
    const queue = cells.slice();
    const keepKey = keep ? keep[0] + "," + keep[1] : null;
    while (queue.length) {
        const [r, c] = queue.shift();
        const k = r + "," + c;
        if (seen.has(k) || k === keepKey) continue;
        seen.add(k);
        out.push([r, c]);
        const gem = g[r][c];
        if (gem && (gem.special === SPECIAL.FLAME || gem.special === SPECIAL.STAR)) {
            for (const cell of blastCells(g, r, c, gem.special)) queue.push(cell);
        }
    }
    return out;
}

/** Every gem of `color`, plus the hypergem at (hr, hc). */
export function hyperCells(g, hr, hc, color) {
    const out = [[hr, hc]];
    for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[0].length; c++) {
            const gem = g[r][c];
            if (gem && gem.color === color && !(r === hr && c === hc)) out.push([r, c]);
        }
    }
    return out;
}

// ── Boards ────────────────────────────────────────────────────────────────

/** Random board with no standing matches and at least one move. */
export function seedGrid(rand) {
    let g = null;
    for (let attempt = 0; attempt < 200; attempt++) {
        g = emptyGrid();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                let color = randomColor(rand);
                for (let tries = 0; tries < 40 && makesRun(g, r, c, color); tries++) color = randomColor(rand);
                g[r][c] = makeGem(color);
            }
        }
        if (findMatches(g).length === 0 && findAnyMove(g)) return g;
    }
    return g;
}

function makesRun(g, r, c, color) {
    const same = (y, x) => g[y] && g[y][x] && g[y][x].color === color;
    return (same(r, c - 1) && same(r, c - 2)) || (same(r - 1, c) && same(r - 2, c));
}

/**
 * Shuffle the plain (non-frozen, non-special) gems in place until the board
 * has no standing matches and a move exists. Returns true on success.
 */
export function shuffleGrid(g, rand) {
    const slots = [];
    for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[0].length; c++) {
            const gem = g[r][c];
            if (gem && !gem.frozen && gem.special === SPECIAL.NONE) slots.push([r, c]);
        }
    }
    const gems = slots.map(([r, c]) => g[r][c]);
    for (let tries = 0; tries < 100; tries++) {
        for (let i = gems.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = gems[i]; gems[i] = gems[j]; gems[j] = t;
        }
        slots.forEach(([r, c], i) => { g[r][c] = gems[i]; });
        if (findMatches(g).length === 0 && findAnyMove(g)) return true;
    }
    return false;
}

/**
 * Puzzle layout -> grid. Codes: "3" = color 3, "F3" = frozen color 3,
 * "" = random. Recolors unfrozen gems until nothing matches at rest.
 */
export function gridFromLayout(layout, rand) {
    const g = emptyGrid();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            let code = (layout[r] && layout[r][c]) || "";
            const frozen = code[0] === "F";
            if (frozen) code = code.slice(1);
            g[r][c] = makeGem(parseInt(code, 10) || randomColor(rand), 0, frozen);
        }
    }
    for (let guard = 0; guard < 50 && findMatches(g).length > 0; guard++) {
        for (const row of g) for (const gem of row) if (!gem.frozen) gem.color = randomColor(rand);
    }
    if (!findAnyMove(g)) shuffleGrid(g, rand);
    return g;
}

export function countFrozen(g) {
    let n = 0;
    for (const row of g) for (const gem of row) if (gem && gem.frozen) n++;
    return n;
}
