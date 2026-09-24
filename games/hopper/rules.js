// Hopper rules — a Frogger-style crossing on a 13 x 14 tile grid. Positions
// are in tiles (the frog's column is fractional while it rides a log).
// No DOM, audio or drawing.
//
// createHopper() builds a crossing; the plugin calls hop(game, dx, dy) on
// input and step(game, dt) every frame. Events on game.events:
//   hop · score {points} · pad · roundclear · death {kind: squish|drown|timeout}
//   newround {level} · gameover

export const COLS = 13;
export const ROWS = 14;

// Rows, top to bottom: 0 goals · 1-5 river · 6 median · 7-11 road · 12 verge · 13 start
export const ROW_GOAL = 0;
export const ROW_RIVER_START = 1;
export const ROW_RIVER_END = 5;
export const ROW_MEDIAN = 6;
export const ROW_ROAD_START = 7;
export const ROW_ROAD_END = 11;
export const ROW_START = 13;
export const START_COL = 6;

export const GOAL_COLS = [1, 4, 6, 8, 11];
export const ROUND_TIME_MS = 60 * 1000;
export const LIVES = 3;
export const DEATH_MS = 1000;
export const HOP_POINTS = 10;
export const PAD_POINTS = 50;
export const ROUND_BONUS = 500;
const RESPAWN_LOCK_MS = 200;
const ROUND_CLEAR_MS = 1500;
const LEVEL_SPEEDUP = 0.15;       // lane speed multiplier per level

// Per-lane: direction, speed (tiles/s), gap between entities, entity width.
const ROAD_LANES = [
    { dir: -1, speed: 2.5, gap: 4, width: 1 },
    { dir: 1, speed: 3.5, gap: 3, width: 2 },
    { dir: -1, speed: 4.5, gap: 5, width: 1 },
    { dir: 1, speed: 2.0, gap: 3, width: 1 },
    { dir: -1, speed: 5.5, gap: 6, width: 1 },
];
const RIVER_LANES = [
    { dir: 1, speed: 1.8, gap: 3, width: 3 },
    { dir: -1, speed: 2.5, gap: 2, width: 2 },
    { dir: 1, speed: 1.5, gap: 4, width: 4 },
    { dir: -1, speed: 3.0, gap: 3, width: 2 },
    { dir: 1, speed: 2.2, gap: 3, width: 3 },
];

export const isRoad = (row) => row >= ROW_ROAD_START && row <= ROW_ROAD_END;
export const isRiver = (row) => row >= ROW_RIVER_START && row <= ROW_RIVER_END;

export function createHopper(rng = Math.random) {
    const game = {
        rng,
        score: 0,
        lives: LIVES,
        level: 1,
        pads: [],
        padsFilled: 0,
        lanes: [],
        timeLeft: ROUND_TIME_MS,
        maxRow: ROW_START,
        frog: { col: START_COL, row: ROW_START, onLog: null },
        deathTimer: 0,
        respawnLock: 0,
        pendingRound: false,
        over: false,
        events: [],
    };
    setupRound(game);
    return game;
}

function setupRound(game) {
    game.padsFilled = 0;
    game.pads = GOAL_COLS.map((col) => ({ col, filled: false }));
    buildLanes(game);
    respawn(game, true);
}

function buildLanes(game) {
    const mult = 1 + (game.level - 1) * LEVEL_SPEEDUP;
    game.lanes = new Array(ROWS).fill(null);
    ROAD_LANES.forEach((cfg, i) => { game.lanes[ROW_ROAD_START + i] = makeLane(game, "car", cfg, mult); });
    RIVER_LANES.forEach((cfg, i) => { game.lanes[ROW_RIVER_START + i] = makeLane(game, "log", cfg, mult); });
}

function makeLane(game, type, cfg, mult) {
    const spacing = cfg.width + cfg.gap;
    const offset = game.rng() * spacing;
    const entities = [];
    for (let x = -cfg.width - 2; x < COLS + cfg.width + 2; x += spacing) {
        entities.push({ x: x + offset, width: cfg.width, type });
    }
    return { type, dir: cfg.dir, speed: cfg.speed * mult, spacing, entities };
}

function respawn(game, newTimer) {
    game.frog = { col: START_COL, row: ROW_START, onLog: null };
    game.maxRow = ROW_START;
    if (newTimer) game.timeLeft = ROUND_TIME_MS;
    game.deathTimer = 0;
    game.respawnLock = RESPAWN_LOCK_MS;
}

// ── Input ────────────────────────────────────────────────────────────────

/** One tile; +10 for each new furthest row reached. False if not allowed. */
export function hop(game, dx, dy) {
    if (game.over || game.deathTimer > 0 || game.respawnLock > 0) return false;
    const row = game.frog.row + dy;
    if (row < 0 || row > ROW_START) return false;
    const col = Math.max(0, Math.min(COLS - 1, Math.round(game.frog.col) + dx));
    game.frog = { col, row, onLog: null };
    game.events.push({ type: "hop" });
    if (dy < 0 && row < game.maxRow) {
        game.maxRow = row;
        addScore(game, HOP_POINTS);
    }
    return true;
}

// ── Step ─────────────────────────────────────────────────────────────────

export function step(game, dt) {
    if (game.over) return;

    if (game.respawnLock > 0) {
        game.respawnLock -= dt;
        if (game.respawnLock <= 0 && game.pendingRound) {
            game.pendingRound = false;
            game.level++;
            setupRound(game);
            game.events.push({ type: "newround", level: game.level });
        }
    }

    if (game.deathTimer > 0) {
        game.deathTimer -= dt;
        moveLanes(game, dt);
        if (game.deathTimer <= 0) {
            if (game.lives <= 0) {
                game.over = true;
                game.events.push({ type: "gameover" });
            } else {
                respawn(game, false);
            }
        }
        return;
    }

    game.timeLeft -= dt;
    if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        die(game, "timeout");
        return;
    }

    moveLanes(game, dt);
    rideLog(game, dt);

    const row = game.frog.row;
    if (isRoad(row)) {
        if (carAt(game, row)) die(game, "squish");
    } else if (isRiver(row)) {
        if (!landOnLog(game, row)) die(game, "drown");
    } else {
        game.frog.onLog = null;
        if (row === ROW_GOAL) reachGoal(game);
    }
}

// Entities wrap: one leaving a side re-enters behind the last in line.
function moveLanes(game, dt) {
    for (const lane of game.lanes) {
        if (!lane) continue;
        const dx = lane.dir * lane.speed * dt / 1000;
        for (const e of lane.entities) e.x += dx;
        for (const e of lane.entities) {
            if (lane.dir > 0 && e.x > COLS + 2) {
                e.x = Math.min(...lane.entities.map((o) => o.x)) - lane.spacing;
            } else if (lane.dir < 0 && e.x + e.width < -2) {
                e.x = Math.max(...lane.entities.map((o) => o.x)) + lane.spacing;
            }
        }
    }
}

function rideLog(game, dt) {
    const lane = game.frog.onLog && game.lanes[game.frog.row];
    if (lane) game.frog.col += lane.dir * lane.speed * dt / 1000;
}

/** A car overlapping the frog's centre (with a little forgiveness). */
export function carAt(game, row) {
    const mid = game.frog.col + 0.5;
    return game.lanes[row].entities.some((e) => mid > e.x + 0.05 && mid < e.x + e.width - 0.05);
}

/** Stand on a log under the frog's centre; false = in the water or swept off. */
function landOnLog(game, row) {
    const mid = game.frog.col + 0.5;
    const log = game.lanes[row].entities.find((e) => mid >= e.x && mid <= e.x + e.width) || null;
    game.frog.onLog = log;
    return !!log && game.frog.col >= -0.5 && game.frog.col <= COLS - 0.5;
}

// The nearest empty pad within 0.7 tiles takes the frog; anything else kills.
function reachGoal(game) {
    const mid = game.frog.col + 0.5;
    let best = null, bestDist = Infinity;
    for (const pad of game.pads) {
        const d = Math.abs(pad.col + 0.5 - mid);
        if (d < bestDist) { bestDist = d; best = pad; }
    }
    if (!best || bestDist >= 0.7 || best.filled) {
        die(game, "squish");
        return;
    }
    best.filled = true;
    game.padsFilled++;
    addScore(game, PAD_POINTS + Math.floor(game.timeLeft / 100));
    game.events.push({ type: "pad" });
    if (game.padsFilled >= game.pads.length) {
        addScore(game, ROUND_BONUS);
        game.events.push({ type: "roundclear" });
        respawn(game, false);
        game.respawnLock = ROUND_CLEAR_MS;
        game.pendingRound = true;
    } else {
        respawn(game, true);
    }
}

function die(game, kind) {
    if (game.deathTimer > 0) return;
    game.lives--;
    game.deathTimer = DEATH_MS;
    game.events.push({ type: "death", kind });
}

function addScore(game, points) {
    game.score += points;
    game.events.push({ type: "score", points });
}

export function drainEvents(game) {
    const out = game.events;
    game.events = [];
    return out;
}
