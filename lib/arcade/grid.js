// Arcade — tile-grid plumbing for puzzle games (match-3, sliding, word grids).
//
// Grids are row-major arrays of rows: grid[r][c] = cell object or null.
// Everything here is pure data except the small timeline objects (createWave,
// createFalls), which hold their own clocks and are stepped with dt in ms.
//
//   import { findLineMatches, collapse, createWave, createFalls, fitBoard } from "/lib/arcade/grid.js";
//
//   const groups = findLineMatches(grid, (cell) => cell && cell.color);
//   const wave = createWave(cellsToClear, { stagger: 32, dur: 140 });
//   // each frame: wave.step(dt, (cell) => burstAt(cell)); if (wave.done()) { remove; falls.addMoves(collapse(grid, {spawn})) }
//
// Games used by: gemswap, fluffshuffle, wordspire.

// ── Grid basics ───────────────────────────────────────────────────────────

/** rows x cols grid; fill(r, c) supplies each cell (default null). */
export function makeGrid(rows, cols, fill) {
    const g = new Array(rows);
    for (let r = 0; r < rows; r++) {
        const row = new Array(cols);
        for (let c = 0; c < cols; c++) row[c] = fill ? fill(r, c) : null;
        g[r] = row;
    }
    return g;
}

/** Shallow row copy (cells shared) or deep copy when cloneCell is given. */
export function copyGrid(g, cloneCell) {
    return g.map((row) => row.map((cell) => (cell && cloneCell ? cloneCell(cell) : cell)));
}

export function inGrid(g, r, c) {
    return r >= 0 && r < g.length && c >= 0 && c < g[0].length;
}

export function cellKey(r, c) {
    return r + "," + c;
}

/** Mean position of [[r, c], ...] or [{r, c}, ...]. */
export function centroid(cells) {
    let r = 0, c = 0;
    for (const cell of cells) {
        r += cell.r != null ? cell.r : cell[0];
        c += cell.c != null ? cell.c : cell[1];
    }
    const n = cells.length || 1;
    return { r: r / n, c: c / n };
}

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function seededRandom(seed) {
    let s = (seed >>> 0) || 1;
    return function rand() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * "m:ss" for a millisecond count (clamped at 0). countdown rounds up, so a
 * 3-minute timer reads 3:00 at the start and 0:00 only when it has run out.
 */
export function formatClock(ms, countdown = false) {
    const total = Math.max(0, (countdown ? Math.ceil : Math.floor)(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
}

// ── Line matches ──────────────────────────────────────────────────────────

/**
 * Find runs of `minRun`+ equal keys along rows and columns, merged into
 * groups when same-key runs share a cell (so L / T / + shapes are one group).
 * keyOf(cell) returns a truthy match key, or a falsy value for "never matches".
 *
 * Returns [{ cells: [[r, c], ...], key, size, lenH, lenV, maxLine, hasH, hasV }].
 * Games classify the shape themselves (cross = hasH && hasV, else maxLine).
 */
export function findLineMatches(g, keyOf, minRun = 3) {
    const rows = g.length, cols = rows ? g[0].length : 0;
    const runs = [];
    const key = (r, c) => { const k = keyOf(g[r][c]); return k || 0; };

    for (let r = 0; r < rows; r++) {
        let c = 0;
        while (c < cols) {
            const k = key(r, c);
            const start = c;
            while (c < cols && key(r, c) === k) c++;
            if (k && c - start >= minRun) runs.push({ r, c: start, len: c - start, horiz: true, key: k });
        }
    }
    for (let c = 0; c < cols; c++) {
        let r = 0;
        while (r < rows) {
            const k = key(r, c);
            const start = r;
            while (r < rows && key(r, c) === k) r++;
            if (k && r - start >= minRun) runs.push({ r: start, c, len: r - start, horiz: false, key: k });
        }
    }
    if (!runs.length) return [];

    // Union runs that share a cell (same key is implied: a cell has one key).
    const parent = runs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const owner = new Map();
    runs.forEach((run, i) => {
        for (let k = 0; k < run.len; k++) {
            const id = run.horiz ? cellKey(run.r, run.c + k) : cellKey(run.r + k, run.c);
            if (owner.has(id)) {
                const a = find(owner.get(id)), b = find(i);
                if (a !== b) parent[a] = b;
            } else {
                owner.set(id, i);
            }
        }
    });

    const buckets = new Map();
    runs.forEach((run, i) => {
        const root = find(i);
        let b = buckets.get(root);
        if (!b) buckets.set(root, b = { key: run.key, cells: new Map(), lenH: 0, lenV: 0 });
        if (run.horiz) b.lenH = Math.max(b.lenH, run.len);
        else b.lenV = Math.max(b.lenV, run.len);
        for (let k = 0; k < run.len; k++) {
            const r = run.horiz ? run.r : run.r + k;
            const c = run.horiz ? run.c + k : run.c;
            b.cells.set(cellKey(r, c), [r, c]);
        }
    });

    const groups = [];
    for (const b of buckets.values()) {
        const cells = Array.from(b.cells.values());
        groups.push({
            cells,
            key: b.key,
            size: cells.length,
            lenH: b.lenH,
            lenV: b.lenV,
            maxLine: Math.max(b.lenH, b.lenV),
            hasH: b.lenH > 0,
            hasV: b.lenV > 0,
        });
    }
    return groups;
}

// ── Gravity ───────────────────────────────────────────────────────────────

/**
 * Drop cells down each column into the holes below them and spawn new
 * cells at the top. `isFixed(cell)` marks cells that do not fall and act as
 * floors (ice, blockers): each run of rows between fixed cells settles on
 * its own and refills from its own top, so a hole under a blocker never
 * stays empty. spawn(r, c) makes a new cell (omit to leave holes).
 *
 * Mutates g. Returns the moves for animation: [{ r, c, fromR }] where fromR
 * is the row the cell visually starts from (negative / above the segment
 * for spawned cells).
 */
export function collapse(g, opts = {}) {
    const isFixed = opts.isFixed || (() => false);
    const spawn = opts.spawn || null;
    const rows = g.length, cols = rows ? g[0].length : 0;
    const moves = [];

    for (let c = 0; c < cols; c++) {
        let bottom = rows - 1;
        while (bottom >= 0) {
            // Segment = rows (top..bottom] down to the next fixed cell above.
            let top = bottom;
            while (top >= 0 && !(g[top][c] && isFixed(g[top][c]))) top--;
            // Compact the segment [top+1 .. bottom].
            let write = bottom;
            for (let r = bottom; r > top; r--) {
                const cell = g[r][c];
                if (!cell) continue;
                if (r !== write) {
                    g[write][c] = cell;
                    g[r][c] = null;
                    moves.push({ r: write, c, fromR: r });
                }
                write--;
            }
            if (spawn) {
                const count = write - top;
                for (let r = write; r > top; r--) {
                    g[r][c] = spawn(r, c);
                    moves.push({ r, c, fromR: r - count });
                }
            }
            bottom = top - 1;
        }
    }
    return moves;
}

// ── Timelines ─────────────────────────────────────────────────────────────

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * A staggered clear: cells pop one after another, rippling out from the
 * group centroid. Each cell gets `delay`; cell i is "live" for
 * [delay, delay + lead + dur). step(dt, onFire) calls onFire(cell) once per
 * cell when its local time passes `fireAt` (ms after its delay).
 */
export function createWave(cells, opts = {}) {
    const stagger = opts.stagger != null ? opts.stagger : 32;
    const dur = opts.dur != null ? opts.dur : 140;
    const lead = opts.lead || 0;
    const fireAt = opts.fireAt != null ? opts.fireAt : lead;
    const tail = opts.tail != null ? opts.tail : 30;

    const mid = centroid(cells);
    const list = cells.map((cell) => {
        const r = cell.r != null ? cell.r : cell[0];
        const c = cell.c != null ? cell.c : cell[1];
        const copy = Array.isArray(cell) ? {} : Object.assign({}, cell);
        return Object.assign(copy, { r, c, _d: Math.hypot(r - mid.r, c - mid.c) });
    });
    list.sort((a, b) => a._d - b._d);
    list.forEach((cell, i) => { cell.delay = i * stagger; cell.fired = false; });
    const byKey = new Map(list.map((cell) => [cellKey(cell.r, cell.c), cell]));
    const duration = list.length ? list[list.length - 1].delay + lead + dur + tail : 0;

    const wave = {
        cells: list,
        t: 0,
        duration,
        lead,
        dur,
        step(dt, onFire) {
            wave.t += dt;
            for (const cell of list) {
                if (!cell.fired && wave.t >= cell.delay + fireAt) {
                    cell.fired = true;
                    if (onFire) onFire(cell);
                }
            }
        },
        done() { return wave.t >= duration; },
        /** Local ms since this cell's delay (negative before it starts), or null if not in the wave. */
        local(r, c) {
            const cell = byKey.get(cellKey(r, c));
            return cell ? wave.t - cell.delay : null;
        },
        has(r, c) { return byKey.has(cellKey(r, c)); },
    };
    return wave;
}

/**
 * Fall tweens keyed by destination cell. offset(r, c) is how many rows above
 * its slot the cell should be drawn right now (0 when settled).
 */
export function createFalls(durMs = 140) {
    const tweens = new Map();
    return {
        add(r, c, fromR) {
            if (fromR === r) return;
            tweens.set(cellKey(r, c), { from: fromR - r, t: 0, dur: durMs });
        },
        addMoves(moves) {
            for (const m of moves) this.add(m.r, m.c, m.fromR);
        },
        step(dt) {
            for (const [k, tw] of tweens) {
                tw.t += dt;
                if (tw.t >= tw.dur) tweens.delete(k);
            }
        },
        offset(r, c) {
            const tw = tweens.get(cellKey(r, c));
            if (!tw) return 0;
            return tw.from * (1 - easeOutCubic(Math.min(1, tw.t / tw.dur)));
        },
        busy() { return tweens.size > 0; },
        clear() { tweens.clear(); },
    };
}

// ── Layout ────────────────────────────────────────────────────────────────

/**
 * Fit a rows x cols board into a W x H view.
 * opts: minCell, maxCell, padX / padY (space kept free around the board),
 * biasX (shift from centre, e.g. to clear a side HUD), minX / minY.
 */
export function fitBoard(W, H, rows, cols, opts = {}) {
    const padX = opts.padX != null ? opts.padX : 200;
    const padY = opts.padY != null ? opts.padY : 80;
    let cell = Math.floor(Math.min((W - padX) / cols, (H - padY) / rows));
    if (opts.minCell) cell = Math.max(opts.minCell, cell);
    if (opts.maxCell) cell = Math.min(opts.maxCell, cell);
    const boardW = cell * cols, boardH = cell * rows;
    const ox = Math.max(opts.minX || 0, Math.floor((W - boardW) / 2 + (opts.biasX || 0)));
    const oy = Math.max(opts.minY || 0, Math.floor((H - boardH) / 2));
    return { ox, oy, cell, boardW, boardH, rows, cols };
}

/** Top-left pixel of a cell. */
export function cellXY(layout, r, c) {
    return { x: layout.ox + c * layout.cell, y: layout.oy + r * layout.cell };
}

/** Centre pixel of a cell. */
export function cellCenter(layout, r, c) {
    return { x: layout.ox + (c + 0.5) * layout.cell, y: layout.oy + (r + 0.5) * layout.cell };
}

/** Cell under a pixel, or null outside the board. */
export function cellAt(layout, x, y) {
    const c = Math.floor((x - layout.ox) / layout.cell);
    const r = Math.floor((y - layout.oy) / layout.cell);
    if (x < layout.ox || y < layout.oy || r >= layout.rows || c >= layout.cols) return null;
    return { r, c };
}
