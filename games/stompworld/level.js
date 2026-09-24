// Stompworld Stage 1: the tile layout and its entity spawns.
//
// Tile chars (solid):
//   #  ground          B  brick           Q  question
//   [  pipe top-left   ]  pipe top-right
//   <  pipe body-left  >  pipe body-right
// Tile chars (decorative, non-solid):
//   C  cloud           .  empty
// Entity chars (empty tiles that spawn something):
//   P  player spawn    G  stomper         F  flag
//   I  beam pickup     V  flyer (patrol)  X  flyer (patrol + bob)
//
// Grid: 120 cols × 18 rows of 32 px tiles → 3840 × 576 px world.
//
// Layout sections (left → right):
//   0–12   intro: solo Q-block, easy ground
//   13–15  3-tile gap
//   16–28  ground + first stomper + brick row
//   29–36  twin pipes (height 2 + height 3)
//   37–44  brick run with floating brick + stomper
//   45–49  5-tile gap with mid-air bounce brick
//   50–65  ground + 5-tile floating platform (QBBBQ) with stomper above
//   66–72  high 3-block bonus row + ground stomper
//   73–77  5-tile gap
//   78–95  long ground with mid-height brick cluster
//   96–104 5-step staircase ascent
//   105–119 ground approach + beam pickup (col 115) + flag (col 118)
//
// Safe to import from workers: the tile art only touches a canvas when the
// tilemap is drawn.

import { Tilemap } from "/app/tilemap.js";
import { Art } from "/app/art.js";
import { TILE } from "/app/rules.js";

export const COLS = 120;
export const ROWS_N = 18;

const TILE_CHARS = {
    ".": 0, "#": 1, "B": 2, "Q": 3,
    "[": 4, "]": 5, "<": 6, ">": 7,
    "C": 8,
};
const SOLID_IDS = [1, 2, 3, 4, 5, 6, 7];
/** Ground (id 1) is the floor and cannot be blasted. */
export const GROUND_ID = 1;
const ENTITY_CHARS = {
    "P": "player", "G": "stomper", "F": "flag", "I": "pickup",
    "V": "flyer", "X": "flyer_bob",
};

function buildRows() {
    const rows = [];
    for (let r = 0; r < ROWS_N; r++) rows.push(new Array(COLS).fill("."));
    const set = (r, c, ch) => { rows[r][c] = ch; };
    const setRange = (r, c0, str) => { for (let i = 0; i < str.length; i++) rows[r][c0 + i] = str[i]; };
    const fillCol = (c, r0, r1, ch) => { for (let r = r0; r <= r1; r++) rows[r][c] = ch; };

    // ── Sky decoration: two staggered cloud bands ───────────────────────
    [7, 25, 50, 78, 105].forEach((c) => set(1, c, "C"));
    [15, 38, 65, 90, 112].forEach((c) => set(3, c, "C"));

    // ── Ground (rows 16–17); gaps at 13–15, 45–49, 73–77 ────────────────
    for (const [a, b] of [[0, 12], [16, 44], [50, 72], [78, 119]]) {
        for (let c = a; c <= b; c++) { set(16, c, "#"); set(17, c, "#"); }
    }

    // ── Pipes ───────────────────────────────────────────────────────────
    setRange(14, 30, "[]"); setRange(15, 30, "<>");                            // height 2
    setRange(13, 35, "[]"); setRange(14, 35, "<>"); setRange(15, 35, "<>");    // height 3

    // ── Question / brick clusters ───────────────────────────────────────
    set(12, 8, "Q");              // tutorial bonus
    setRange(12, 22, "BQB");      // mid-cluster
    set(12, 40, "B");             // floating brick (reachable from ground)
    set(12, 47, "B");             // mid-air bounce brick over the first 5-tile gap
    setRange(12, 56, "QBBBQ");    // 5-tile floating platform
    setRange(9, 70, "BQB");       // high bonus row (reach via QBBBQ → jump)
    set(12, 75, "B");             // stepping brick over the second 5-tile gap
    setRange(8, 84, "BBQBB");     // upper cluster (skyline)

    // ── Final staircase (cols 100–104). Bricks rather than ground so it
    //    stays destructible.
    for (let i = 0; i < 5; i++) fillCol(100 + i, 15 - i, 15, "B");

    // ── Flyers at three heights, so the agent has to learn when to jump:
    //   row 11: lethal at the jump apex (do not jump near one)
    //   row 12: timing zone (bobbing 'X'; pass it at the apex, not in transit)
    //   row 15: body height (must jump over)
    set(11, 6, "V");     // intro: punish panic-jumps
    set(15, 20, "V");    // post-gap-1: forced jump-over
    set(11, 33, "V");    // pipes area: no jump-spam between pipes
    set(12, 41, "X");    // post-pipes: bobbing timing
    set(11, 54, "V");    // post-gap-2: lethal apex
    set(15, 60, "V");    // mid-section: forced jump-over
    set(11, 68, "V");    // pre-gap-3: lethal apex
    set(12, 76, "X");    // gap-3 area: bobbing
    set(15, 86, "V");    // long flat: forced jump-over
    set(11, 95, "V");    // pre-staircase: must NOT jump
    set(12, 108, "X");   // post-staircase: bobbing late hazard

    // ── Spawns ──────────────────────────────────────────────────────────
    set(15, 2, "P");
    for (const [r, c] of [[15, 17], [15, 28], [15, 42], [15, 53], [11, 58], [15, 62], [15, 80], [15, 90]]) {
        set(r, c, "G");
    }
    set(15, 115, "I");
    set(15, 118, "F");

    return rows.map((arr) => arr.join(""));
}

// Split the layout once into tile rows and entity records.
const ENTITIES = [];
const TILE_ROWS = buildRows().map((row, r) => {
    let out = "";
    for (let c = 0; c < row.length; c++) {
        const kind = ENTITY_CHARS[row[c]];
        if (kind) {
            ENTITIES.push({ kind, col: c, row: r, x: c * TILE, y: r * TILE });
            out += ".";
        } else {
            out += row[c];
        }
    }
    return out;
});

function makeStomper(e) {
    return {
        x: e.x + 2, y: (e.row + 1) * TILE - 24,
        w: 28, h: 24, vx: -50, vy: 0,
        onGround: false, alive: true, squashTimer: 0, animT: 0,
    };
}

function makeFlyer(e) {
    const bob = e.kind === "flyer_bob";
    const W = 24, H = 16;
    const x = e.col * TILE + TILE / 2 - W / 2;
    const y = e.row * TILE + TILE / 2 - H / 2;
    return {
        x, y, w: W, h: H, vx: -80, vy: 0,
        spawnX: x, spawnY: y, patrolRange: 96,
        bobAmp: bob ? 32 : 0, bobFreq: bob ? Math.PI : 0,
        bobT: 0, animT: 0, alive: true,
    };
}

function makeFlag(e) {
    const h = 96;
    return { x: e.x, y: (e.row + 1) * TILE - h, w: 32, h };
}

function makePickup(e) {
    // 24×24 collectible centred in its tile.
    const cx = e.col * TILE + TILE / 2, cy = e.row * TILE + TILE / 2;
    return { x: cx - 12, y: cy - 12, w: 24, h: 24 };
}

/** Fresh enemies at their spawn points: { stompers, flyers }. */
export function spawnMobs() {
    const stompers = [], flyers = [];
    for (const e of ENTITIES) {
        if (e.kind === "stomper") stompers.push(makeStomper(e));
        else if (e.kind === "flyer" || e.kind === "flyer_bob") flyers.push(makeFlyer(e));
    }
    return { stompers, flyers };
}

/**
 * A fresh level: { tilemap, spawn, stompers, flyers, flag, pickup }.
 * opts.destructible lets beams carve the terrain; opts.trackDamagedTiles
 * (default true) keeps the per-tile damage list the renderer uses.
 */
export function buildLevel(opts = {}) {
    const tilemap = Tilemap.create({
        tileSize: TILE, cols: COLS, rows: ROWS_N,
        drawTile: Art.drawTile,
        solidIds: SOLID_IDS,
        indestructibleIds: [GROUND_ID],
        destructible: !!opts.destructible,
        trackDamagedTiles: opts.trackDamagedTiles !== false,
    });
    tilemap.setRows(TILE_ROWS, TILE_CHARS);
    const level = { tilemap, spawn: { x: 0, y: 0 }, flag: null, pickup: null, ...spawnMobs() };
    for (const e of ENTITIES) {
        if (e.kind === "player") level.spawn = { x: e.x, y: e.y };
        else if (e.kind === "flag") level.flag = makeFlag(e);
        else if (e.kind === "pickup") level.pickup = makePickup(e);
    }
    return level;
}
