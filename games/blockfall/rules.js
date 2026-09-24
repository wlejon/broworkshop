// Blockfall rules — the 10x20 well, seven pieces from a shuffled bag, SRS
// rotation with wall kicks, hold, gravity, lock delay, line clears and
// scoring. No DOM, audio or drawing.
//
// createBlockfall({ startLevel, rng }) deals the first piece. The plugin
// calls moveH / softDrop / hardDrop / rotate / hold on input and
// step(s, dt ms, softDropping) every frame. Events on s.events:
// move · rotate · hold · drop {piece, cells, fromY, dist} · lock {piece, cells} ·
// clear {rows, colors, n} · combo {n} · levelup {level} · topout.

export const COLS = 10;
export const ROWS = 20;
export const LOCK_DELAY = 500;
export const MAX_LOCK_MOVES = 15;
export const SOFT_DROP_MS = 30;

/** Shapes: [type 1-7][rotation][cells as [row, col]]. I O T S Z J L. */
export const PIECES = [
    null,
    [[[1, 0], [1, 1], [1, 2], [1, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]],
     [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 1], [1, 1], [2, 1], [3, 1]]],
    [[[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]],
     [[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]]],
    [[[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 1]],
     [[1, 0], [1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]]],
    [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 1], [1, 1], [1, 2], [2, 2]],
     [[1, 1], [1, 2], [2, 0], [2, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
    [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 2], [1, 1], [1, 2], [2, 1]],
     [[1, 0], [1, 1], [2, 1], [2, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
    [[[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [2, 1]],
     [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]]],
    [[[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]],
     [[1, 0], [1, 1], [1, 2], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]]],
];

// Wall kicks per starting rotation, [dx, dy] with +y up (SRS).
const KICKS = {
    normal: [
        [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
        [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
        [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
        [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    ],
    I: [
        [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
        [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
        [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
        [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    ],
};

/** Gravity interval (ms per row) by level. */
export const SPEEDS = [800, 717, 633, 550, 467, 383, 300, 217, 133, 100, 83, 83, 83, 67, 67, 67, 50, 50, 50, 33];
const LINE_POINTS = [0, 100, 300, 500, 800];

export function createBlockfall(opts = {}) {
    const startLevel = opts.startLevel || 1;
    const s = {
        rng: opts.rng || Math.random,
        startLevel,
        board: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
        cur: null,             // { type, x, y, rot }
        next: [],              // upcoming types
        bag: [],
        holdType: 0,
        holdUsed: false,
        score: 0,
        level: startLevel,
        lines: 0,
        combo: -1,
        backToBack: false,
        time: 0,
        pieces: 0,
        stats: { singles: 0, doubles: 0, triples: 0, quads: 0, maxCombo: 0 },
        dropTimer: 0,
        softTimer: 0,
        lockTimer: 0,
        lockMoves: 0,
        over: false,
        events: [],
    };
    fillNext(s);
    spawn(s);
    return s;
}

export const cellsOf = (type, rot) => PIECES[type][rot & 3];

/** Board cells the piece covers at (x, y, rot): [[r, c], ...]. */
export function pieceCells(p, y = p.y) {
    return cellsOf(p.type, p.rot).map(([r, c]) => [y + r, p.x + c]);
}

export function dropInterval(level) {
    return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, level - 1))];
}

function fillNext(s) {
    while (s.next.length < 5) {
        if (!s.bag.length) {                         // 7-bag: every piece once per bag
            s.bag = [1, 2, 3, 4, 5, 6, 7];
            for (let i = 6; i > 0; i--) {
                const j = Math.floor(s.rng() * (i + 1));
                [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]];
            }
        }
        s.next.push(s.bag.pop());
    }
}

export function canPlace(s, type, x, y, rot) {
    for (const [dr, dc] of cellsOf(type, rot)) {
        const r = y + dr, c = x + dc;
        if (c < 0 || c >= COLS || r >= ROWS) return false;
        if (r >= 0 && s.board[r][c] !== 0) return false;
    }
    return true;
}

const fits = (s, dx, dy, rot = s.cur.rot) => canPlace(s, s.cur.type, s.cur.x + dx, s.cur.y + dy, rot);

/** Row the current piece would land on. */
export function ghostY(s) {
    if (!s.cur) return 0;
    let y = s.cur.y;
    while (canPlace(s, s.cur.type, s.cur.x, y + 1, s.cur.rot)) y++;
    return y;
}

function enter(s, type) {
    s.cur = { type, x: 3, y: -1, rot: 0 };
    s.dropTimer = 0;
    s.lockTimer = 0;
    s.lockMoves = 0;
    if (canPlace(s, type, 3, -1, 0)) return true;
    s.cur.y = -2;
    return canPlace(s, type, 3, -2, 0);
}

function spawn(s) {
    const type = s.next.shift();
    fillNext(s);
    s.holdUsed = false;
    if (!enter(s, type)) topOut(s);
}

function topOut(s) {
    s.cur = null;
    s.over = true;
    s.events.push({ type: "topout" });
}

// Moving or turning on the ground buys more lock time, up to 15 times.
function nudgeLock(s) {
    if (s.lockMoves < MAX_LOCK_MOVES) {
        s.lockTimer = 0;
        s.lockMoves++;
    }
}

// ── Player actions ───────────────────────────────────────────────────────

/** Shift one column (dir -1 / +1). */
export function moveH(s, dir) {
    if (!s.cur || !fits(s, dir, 0)) return false;
    s.cur.x += dir;
    nudgeLock(s);
    s.events.push({ type: "move" });
    return true;
}

/** One row down; a soft drop scores 1. */
export function softDrop(s) {
    if (!s.cur || !fits(s, 0, 1)) return false;
    s.cur.y++;
    s.score += 1;
    return true;
}

/** dir +1 clockwise, -1 counter-clockwise, trying the SRS kicks in order. */
export function rotate(s, dir) {
    if (!s.cur) return false;
    const rot = (s.cur.rot + (dir > 0 ? 1 : 3)) & 3;
    for (const [dx, up] of (s.cur.type === 1 ? KICKS.I : KICKS.normal)[s.cur.rot]) {
        if (!fits(s, dx, -up, rot)) continue;
        s.cur.x += dx;
        s.cur.y -= up;
        s.cur.rot = rot;
        nudgeLock(s);
        s.events.push({ type: "rotate" });
        return true;
    }
    return false;
}

/** Drop to the floor (2 points a row) and lock at once. */
export function hardDrop(s) {
    if (!s.cur) return;
    const gy = ghostY(s);
    const dist = gy - s.cur.y;
    s.score += dist * 2;
    s.events.push({ type: "drop", piece: s.cur.type, cells: pieceCells(s.cur, gy), fromY: s.cur.y, dist });
    s.cur.y = gy;
    lock(s);
}

/** Swap with the held piece, once per piece. */
export function hold(s) {
    if (!s.cur || s.holdUsed) return false;
    const held = s.holdType;
    s.holdType = s.cur.type;
    s.events.push({ type: "hold" });
    if (held) {
        if (!enter(s, held)) topOut(s);
    } else {
        spawn(s);
    }
    s.holdUsed = true;
    return true;
}

// ── Time ─────────────────────────────────────────────────────────────────

/** Gravity (or soft drop while softDropping) and lock delay. */
export function step(s, dt, softDropping) {
    if (s.over || !s.cur) return;
    s.time += dt;
    if (softDropping) {
        s.softTimer += dt;
        while (s.softTimer >= SOFT_DROP_MS) {
            s.softTimer -= SOFT_DROP_MS;
            softDrop(s);
        }
    } else {
        s.softTimer = 0;
        s.dropTimer += dt;
        const interval = dropInterval(s.level);
        while (s.dropTimer >= interval) {
            s.dropTimer -= interval;
            if (fits(s, 0, 1)) s.cur.y++;
        }
    }
    if (fits(s, 0, 1)) {
        s.lockTimer = 0;
        return;
    }
    s.lockTimer += dt;
    if (s.lockTimer >= LOCK_DELAY) lock(s);
}

// Write the piece into the well; a piece locked above the top ends the game.
function lock(s) {
    const cells = pieceCells(s.cur);
    const type = s.cur.type;
    let above = false;
    for (const [r, c] of cells) {
        if (r < 0) above = true;
        else s.board[r][c] = type;
    }
    s.pieces++;
    s.events.push({ type: "lock", cells: cells.filter(([r]) => r >= 0), piece: type });
    if (above) { topOut(s); return; }
    clearLines(s);
    spawn(s);
}

// Lines x level (100/300/500/800), quads back to back 1.5x, combos +50 x combo x level.
function clearLines(s) {
    const rows = [];
    for (let r = ROWS - 1; r >= 0; r--) if (s.board[r].every((v) => v !== 0)) rows.push(r);
    if (!rows.length) { s.combo = -1; return; }

    const n = rows.length;
    s.combo++;
    s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
    s.stats[["", "singles", "doubles", "triples", "quads"][n]]++;
    let points = LINE_POINTS[n] * s.level;
    if (n === 4 && s.backToBack) points = Math.floor(points * 1.5);
    s.backToBack = n === 4;
    if (s.combo > 0) {
        points += 50 * s.combo * s.level;
        s.events.push({ type: "combo", n: s.combo });
    }
    s.score += points;
    s.lines += n;

    const colors = rows.map((r) => s.board[r].slice());
    s.board = s.board.filter((_, r) => !rows.includes(r));
    while (s.board.length < ROWS) s.board.unshift(new Array(COLS).fill(0));
    s.events.push({ type: "clear", rows, colors, n });

    const level = Math.floor(s.lines / 10) + s.startLevel;
    if (level !== s.level) {
        s.level = level;
        s.events.push({ type: "levelup", level });
    }
}

export function drainEvents(s) {
    const out = s.events;
    s.events = [];
    return out;
}
