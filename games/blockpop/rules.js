// rules.js — Blockpop's pure rules: the board, chain finding, specials,
// popping, row spawning and puzzle layouts. No DOM, no clock, no state.
//
// Board layout: column-major stacks. board[col] holds blocks from the
// BOTTOM (index 0) to the TOP. A block is null or { color, special }.

import { seededRandom } from "/lib/arcade/grid.js";

export const COLS = 8;
export const ROWS = 16;
export const NUM_COLORS = 7;
export const HOLD_MAX = 3;

export const SPECIAL_NONE = 0;
export const SPECIAL_STAR = 1;
export const SPECIAL_BOMB = 2;
export const SPECIAL_RAINBOW = 3;

/** Colour per block colour index (1-based). */
export const COLORS = [null,
    "#ff4d6d", // red
    "#ffb74d", // orange
    "#ffeb3b", // yellow
    "#66e676", // green
    "#4ad6ff", // cyan
    "#6b8cff", // blue
    "#c47bff", // purple
];
export const SHAPES = [null, "circle", "square", "triangle", "diamond", "hex", "plus", "star"];

/** Deterministic PRNG for seeded boards (mulberry32). */
export const makeRng = seededRandom;

export function makeEmptyBoard() {
    const b = [];
    for (let c = 0; c < COLS; c++) b.push([]);
    return b;
}

/** Block at column c, row r counted from the bottom; null off the board. */
export function blockAt(board, c, r) {
    if (c < 0 || c >= COLS) return null;
    if (r < 0 || r >= board[c].length) return null;
    return board[c][r];
}

export function cloneBoard(board) {
    return board.map((col) => col.map((b) => (b ? { color: b.color, special: b.special } : null)));
}

/**
 * Groups of 3+ matching blocks reachable from a column's TOP block. The
 * flood fill steps to the tops of neighbouring columns and up/down within
 * a column; rainbow blocks match any colour.
 */
export function findChains(board) {
    const visited = new Set();
    const groups = [];
    for (let c = 0; c < COLS; c++) {
        const h = board[c].length;
        if (h === 0) continue;
        const top = board[c][h - 1];
        if (!top || visited.has(c + "," + (h - 1))) continue;
        const seedColor = top.color;
        const seedIsRainbow = top.special === SPECIAL_RAINBOW;
        const stack = [[c, h - 1]];
        const cells = [];
        while (stack.length) {
            const [cc, rr] = stack.pop();
            const k = cc + "," + rr;
            if (visited.has(k)) continue;
            const bl = blockAt(board, cc, rr);
            if (!bl) continue;
            if (!seedIsRainbow && bl.color !== seedColor && bl.special !== SPECIAL_RAINBOW) continue;
            visited.add(k);
            cells.push([cc, rr]);
            for (const nc of [cc - 1, cc + 1]) {
                if (nc < 0 || nc >= COLS || board[nc].length === 0) continue;
                stack.push([nc, board[nc].length - 1]);
            }
            if (rr - 1 >= 0) stack.push([cc, rr - 1]);
            if (rr + 1 < board[cc].length) stack.push([cc, rr + 1]);
        }
        if (cells.length >= 3) groups.push({ cells, color: seedColor });
    }
    return groups;
}

/**
 * A group grown by its specials: a star adds every block of the group's
 * colour on the board, a bomb adds the 3x3 around it.
 */
export function expandSpecials(board, group) {
    const set = new Set(group.cells.map(([c, r]) => c + "," + r));
    for (const [c, r] of group.cells) {
        const b = blockAt(board, c, r);
        if (!b) continue;
        if (b.special === SPECIAL_STAR) {
            for (let cc = 0; cc < COLS; cc++) {
                for (let rr = 0; rr < board[cc].length; rr++) {
                    const bb = board[cc][rr];
                    if (bb && bb.color === group.color) set.add(cc + "," + rr);
                }
            }
        } else if (b.special === SPECIAL_BOMB) {
            for (let dc = -1; dc <= 1; dc++) {
                for (let dr = -1; dr <= 1; dr++) {
                    const nc = c + dc, nr = r + dr;
                    if (nc < 0 || nc >= COLS || nr < 0 || nr >= board[nc].length) continue;
                    set.add(nc + "," + nr);
                }
            }
        }
    }
    const cells = [];
    for (const k of set) {
        const parts = k.split(",");
        cells.push([+parts[0], +parts[1]]);
    }
    return { cells, color: group.color };
}

/** Compact null holes out of every column. */
export function settle(board) {
    for (let c = 0; c < COLS; c++) board[c] = board[c].filter(Boolean);
    return board;
}

/** Remove the (special-expanded) groups and settle. */
export function popChains(board, groups) {
    let removed = 0;
    const popped = [];
    for (const g of groups) {
        const ex = expandSpecials(board, g);
        popped.push(ex);
        for (const [c, r] of ex.cells) {
            if (board[c][r]) {
                board[c][r] = null;
                removed++;
            }
        }
    }
    settle(board);
    return { removed, groups: popped };
}

/**
 * Push a new bottom block into every column; now and then a special. A
 * column whose bottom two share the rolled colour gets the next colour.
 */
export function spawnRow(board, rand) {
    for (let c = 0; c < COLS; c++) {
        let color = 1 + Math.floor(rand() * NUM_COLORS);
        let special = SPECIAL_NONE;
        const roll = rand();
        if (roll < 0.008) special = SPECIAL_STAR;
        else if (roll < 0.018) special = SPECIAL_BOMB;
        else if (roll < 0.025) special = SPECIAL_RAINBOW;
        if (board[c].length >= 2) {
            const b0 = board[c][0], b1 = board[c][1];
            if (b0 && b1 && b0.color === color && b1.color === color) color = 1 + (color % NUM_COLORS);
        }
        board[c].unshift({ color, special });
    }
    return board;
}

/** `rows` rows with no chains to start with. */
export function seedBoard(rows, rand) {
    const b = makeEmptyBoard();
    for (let i = 0; i < rows; i++) spawnRow(b, rand);
    for (let guard = 12; guard > 0; guard--) {
        const g = findChains(b);
        if (!g.length) break;
        popChains(b, g);
        let shortest = rows;
        for (let c = 0; c < COLS; c++) shortest = Math.min(shortest, b[c].length);
        while (shortest < rows) { spawnRow(b, rand); shortest++; }
    }
    return b;
}

/** Puzzle idx: a seeded stack with 1-3 specials on top and a move budget. */
export function puzzleBoard(idx) {
    const r = makeRng(1000 + idx * 17);
    const board = makeEmptyBoard();
    const rows = 6 + (idx % 5);
    for (let i = 0; i < rows; i++) spawnRow(board, r);
    const specials = [SPECIAL_STAR, SPECIAL_BOMB, SPECIAL_RAINBOW];
    const cnt = 1 + (idx % 3);
    for (let s = 0; s < cnt; s++) {
        const c = Math.floor(r() * COLS);
        const top = board[c].length - 1;
        if (top >= 0) board[c][top].special = specials[(idx + s) % specials.length];
    }
    return { board, moves: 8 + idx };
}

/** Points for one popped group of n blocks (before the cascade multiplier). */
export function groupScore(n) {
    if (n >= 6) return 600 + (n - 5) * 250;
    if (n === 5) return 600;
    if (n === 4) return 300;
    return 150;
}

/** Any column at ROWS is a top-out. */
export function isToppedOut(board) {
    for (let c = 0; c < COLS; c++) if (board[c].length >= ROWS) return true;
    return false;
}

export function isCleared(board) {
    for (let c = 0; c < COLS; c++) if (board[c].length) return false;
    return true;
}
