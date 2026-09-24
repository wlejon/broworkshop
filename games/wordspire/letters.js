// Wordspire rules — pure functions over the 8-row x 7-column letter grid.
// grid[r][c] = tile or null, row 0 at the top. A tile is
// { letter, mult: 1..5, burning, id }. Paths are [[r, c], ...].

import { makeGrid, inGrid } from "/lib/arcade/grid.js";

export const ROWS = 8;
export const COLS = 7;
export const MIN_WORD = 3;

/** Tile multipliers by tier; longer words drop better tiles. */
export const MULT = { NORMAL: 1, GILDED: 2, JEWELED: 3, SAPPHIRE: 4, RUBY: 5 };

// Rough Scrabble letter distribution.
const LETTER_FREQ = {
    a: 9, b: 2, c: 3, d: 4, e: 13, f: 2, g: 3, h: 4, i: 9, j: 1, k: 1, l: 4, m: 3,
    n: 7, o: 8, p: 2, q: 1, r: 7, s: 6, t: 8, u: 4, v: 2, w: 2, x: 1, y: 3, z: 1,
};
const LETTER_POOL = [];
for (const ch in LETTER_FREQ) for (let i = 0; i < LETTER_FREQ[ch]; i++) LETTER_POOL.push(ch);

let nextId = 1;

export function newTile(letter, rand, mult, burning) {
    return {
        letter: letter || LETTER_POOL[Math.floor((rand || Math.random)() * LETTER_POOL.length)],
        mult: mult || MULT.NORMAL,
        burning: !!burning,
        id: nextId++,
    };
}

export function emptyGrid() {
    return makeGrid(ROWS, COLS);
}

export function fillGrid(g, rand) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (!g[r][c]) g[r][c] = newTile(null, rand);
    }
    return g;
}

/** Grid from ROWS strings of COLS letters (row 0 on top); spaces fill randomly. */
export function gridFromRows(rows, rand) {
    const g = emptyGrid();
    for (let r = 0; r < ROWS && r < rows.length; r++) {
        for (let c = 0; c < COLS && c < rows[r].length; c++) {
            const ch = rows[r].charAt(c);
            if (ch !== " ") g[r][c] = newTile(ch.toLowerCase());
        }
    }
    return fillGrid(g, rand);
}

// ── Paths ─────────────────────────────────────────────────────────────────

export function adjacent(a, b) {
    const dr = Math.abs(a[0] - b[0]), dc = Math.abs(a[1] - b[1]);
    return dr <= 1 && dc <= 1 && dr + dc > 0;
}

/** Every step 8-adjacent, no cell twice, every cell occupied. */
export function isValidPath(path, g) {
    if (!path || !path.length) return false;
    const seen = new Set();
    for (let i = 0; i < path.length; i++) {
        const [r, c] = path[i];
        if (!inGrid(g, r, c) || !g[r][c]) return false;
        const k = r + "," + c;
        if (seen.has(k)) return false;
        seen.add(k);
        if (i > 0 && !adjacent(path[i - 1], path[i])) return false;
    }
    return true;
}

export function pathTiles(path, g) {
    return path.map(([r, c]) => g[r][c]);
}

export function pathWord(path, g) {
    let s = "";
    for (const [r, c] of path) {
        if (!g[r][c]) return "";
        s += g[r][c].letter;
    }
    return s;
}

/**
 * Up to `max` distinct dictionary words findable on the board, as
 * { word, path } (depth-first, pruned by the dictionary's prefix set).
 */
export function findWords(g, dict, max = 20, maxLen = 9) {
    const found = [];
    const seen = new Set();
    const used = makeGrid(ROWS, COLS, () => false);
    function dfs(path, word) {
        if (found.length >= max) return;
        if (word.length >= MIN_WORD && !seen.has(word) && dict.isWord(word)) {
            seen.add(word);
            found.push({ word, path: path.slice() });
        }
        if (word.length >= maxLen || (word.length >= 2 && !dict.isPrefix(word))) return;
        const [r, c] = path[path.length - 1];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr, nc = c + dc;
                if ((!dr && !dc) || !inGrid(g, nr, nc) || used[nr][nc] || !g[nr][nc]) continue;
                used[nr][nc] = true;
                path.push([nr, nc]);
                dfs(path, word + g[nr][nc].letter);
                path.pop();
                used[nr][nc] = false;
                if (found.length >= max) return;
            }
        }
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!g[r][c]) continue;
            used[r][c] = true;
            dfs([[r, c]], g[r][c].letter);
            used[r][c] = false;
            if (found.length >= max) return found;
        }
    }
    return found;
}

// ── Burning tiles ─────────────────────────────────────────────────────────

/**
 * Each burning tile sinks one row, trading places with the tile below.
 * Returns { collapsed, moves }: collapsed when a burning tile was already on
 * the bottom row; moves as [{ r, c, fromR }] for the fall animation.
 */
export function descendBurning(g) {
    let collapsed = false;
    const moves = [];
    for (let c = 0; c < COLS; c++) {
        for (let r = ROWS - 1; r >= 0; r--) {
            const t = g[r][c];
            if (!t || !t.burning) continue;
            if (r === ROWS - 1) { collapsed = true; continue; }
            // Bottom-up, so a tile that just sank is never visited again.
            const below = g[r + 1][c];
            if (below && !below.burning) {
                g[r + 1][c] = t;
                g[r][c] = below;
                moves.push({ r: r + 1, c, fromR: r }, { r, c, fromR: r + 1 });
            }
        }
    }
    return { collapsed, moves };
}

/** Set `count` random top-row tiles alight. Returns how many caught. */
export function sprinkleBurning(g, count, rand) {
    let placed = 0;
    for (let i = 0; i < count; i++) {
        const t = g[0][Math.floor(rand() * COLS)];
        if (t && !t.burning) { t.burning = true; placed++; }
    }
    return placed;
}

/** Any burning tile in the bottom two rows. */
export function burningDanger(g) {
    for (let r = ROWS - 2; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) if (g[r][c] && g[r][c].burning) return true;
    }
    return false;
}

/** Multiplier a word of `length` letters earns for one new top-row tile. */
export function rewardFor(length) {
    if (length >= 8) return MULT.RUBY;
    if (length >= 7) return MULT.SAPPHIRE;
    if (length >= 6) return MULT.JEWELED;
    if (length >= 5) return MULT.GILDED;
    return 0;
}
