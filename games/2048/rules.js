// 2048 rules — the 4x4 grid, sliding and merging, spawning, undo and the
// win / stuck checks. No DOM, audio or drawing.
//
// createBoard(rng) returns a board with two tiles. slide(b, dir) moves it
// and returns what moved (for the animation) or null when nothing could.
// Events on b.events: move · merge · win · lose.

export const SIZE = 4;
export const GOAL = 2048;

export function createBoard(rng = Math.random) {
    const b = {
        rng,
        nextId: 1,
        grid: emptyGrid(),
        score: 0,
        won: false,
        keepPlaying: false,
        over: false,
        prev: null,            // one-step undo snapshot
        events: [],
    };
    spawnTile(b);
    spawnTile(b);
    return b;
}

export function emptyGrid() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
}

function cloneGrid(g) {
    return g.map((row) => row.map((t) => (t ? { value: t.value, id: t.id } : null)));
}

export function emptyCells(g) {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!g[r][c]) out.push({ r, c });
    return out;
}

/** Tiles on the grid as { id, value, r, c }. */
export function tilesOf(g) {
    const out = [];
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g[r][c]) out.push({ id: g[r][c].id, value: g[r][c].value, r, c });
    return out;
}

/** A 2 (90%) or a 4 on a random empty cell; returns { id, value, r, c } or null. */
export function spawnTile(b) {
    const empties = emptyCells(b.grid);
    if (!empties.length) return null;
    const spot = empties[Math.floor(b.rng() * empties.length)];
    const tile = { value: b.rng() < 0.1 ? 4 : 2, id: b.nextId++ };
    b.grid[spot.r][spot.c] = tile;
    return { id: tile.id, value: tile.value, r: spot.r, c: spot.c };
}

export function hasMoves(g) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (!g[r][c]) return true;
            const v = g[r][c].value;
            if (c + 1 < SIZE && g[r][c + 1] && g[r][c + 1].value === v) return true;
            if (r + 1 < SIZE && g[r + 1][c] && g[r + 1][c].value === v) return true;
        }
    }
    return false;
}

export function hasValue(g, target) {
    return tilesOf(g).some((t) => t.value === target);
}

// Cells of line i, in the order tiles pack toward.
function lineCells(dir, i) {
    const out = [];
    for (let k = 0; k < SIZE; k++) {
        if (dir === "left") out.push({ r: i, c: k });
        else if (dir === "right") out.push({ r: i, c: SIZE - 1 - k });
        else if (dir === "up") out.push({ r: k, c: i });
        else out.push({ r: SIZE - 1 - k, c: i });
    }
    return out;
}

/**
 * Pack and merge every line toward `dir` (each tile merges once per move).
 * moved: { id, value, fromR, fromC, toR, toC, kind: "slide" | "idle" | "merge" }.
 */
function packGrid(b, dir) {
    const g = b.grid;
    let gained = 0, changed = false;
    const moved = [];
    for (let i = 0; i < SIZE; i++) {
        const cells = lineCells(dir, i);
        const tiles = cells.filter((rc) => g[rc.r][rc.c]).map((rc) => ({ tile: g[rc.r][rc.c], r: rc.r, c: rc.c }));
        const packed = [];
        for (let k = 0; k < tiles.length; k++) {
            const dest = cells[packed.length], cur = tiles[k], next = tiles[k + 1];
            const slideRec = (t) => ({ id: t.tile.id, value: t.tile.value, fromR: t.r, fromC: t.c, toR: dest.r, toC: dest.c, kind: "slide" });
            if (next && next.tile.value === cur.tile.value) {
                const merged = { value: cur.tile.value * 2, id: b.nextId++ };
                gained += merged.value;
                packed.push(merged);
                moved.push(slideRec(cur), slideRec(next),
                    { id: merged.id, value: merged.value, fromR: dest.r, fromC: dest.c, toR: dest.r, toC: dest.c, kind: "merge" });
                changed = true;
                k++;
            } else {
                packed.push(cur.tile);
                const still = cur.r === dest.r && cur.c === dest.c;
                if (!still) changed = true;
                moved.push(Object.assign(slideRec(cur), { kind: still ? "idle" : "slide" }));
            }
        }
        cells.forEach((rc, k) => { g[rc.r][rc.c] = k < packed.length ? packed[k] : null; });
    }
    return { changed, gained, moved };
}

/**
 * Slide toward "left" | "right" | "up" | "down". Returns { moved, spawn,
 * gained } or null when the move changes nothing.
 */
export function slide(b, dir) {
    if (b.over) return null;
    const snapshot = { grid: cloneGrid(b.grid), score: b.score, won: b.won, keepPlaying: b.keepPlaying, nextId: b.nextId };
    const res = packGrid(b, dir);
    if (!res.changed) {
        b.grid = snapshot.grid;
        b.nextId = snapshot.nextId;
        return null;
    }
    b.prev = snapshot;
    b.score += res.gained;
    const spawn = spawnTile(b);
    b.events.push({ type: res.gained > 0 ? "merge" : "move" });

    if (!b.won && !b.keepPlaying && hasValue(b.grid, GOAL)) {
        b.won = true;
        b.events.push({ type: "win" });
    } else if (!hasMoves(b.grid)) {
        b.over = true;
        b.events.push({ type: "lose" });
    }
    return { moved: res.moved, spawn, gained: res.gained };
}

/** Step back one move. */
export function undo(b) {
    if (!b.prev) return false;
    Object.assign(b, { grid: b.prev.grid, score: b.prev.score, won: b.prev.won, keepPlaying: b.prev.keepPlaying });
    b.prev = null;
    b.over = false;
    return true;
}

/** After the win screen: play on past 2048. */
export function keepPlaying(b) {
    b.won = true;
    b.keepPlaying = true;
}

export function drainEvents(b) {
    const out = b.events;
    b.events = [];
    return out;
}
