// rules.js — BlastGrid's tuning: arena size, tiles and flags, bomb and
// round timings, power-up caps, the roster. Pure data.

export const TILE = { FLOOR: 1, FLOOR2: 2, WALL: 3, PILLAR: 4, SOFT: 5, SDWALL: 6 };

export const FLAG_SOLID = 1;    // border walls, pillars, sudden-death walls
export const FLAG_SOFT = 2;     // destructible soft block
export const FLAG_BOMB = 4;     // a live bomb occupies this cell
export const FLAG_DANGER = 8;   // in some bomb's pending blast (or live fire)

export const MOVE_MASK = FLAG_SOLID | FLAG_SOFT | FLAG_BOMB;
export const SAFE_MASK = MOVE_MASK | FLAG_DANGER;

export const MAP_W = 15, MAP_H = 13;
export const CELL = 1.0;         // cellSize
export const HSTEP = 0.5;        // heightStep: walls/pillars elev 2 = 1.0 world

export const FUSE = 2.0;         // seconds from placement to blast
export const FIRE_LINGER = 0.45; // seconds the fire cross stays lethal
export const SOFT_PROB = 0.62;   // soft-block density over eligible floor
export const DROP_PROB = 0.35;   // chance a destroyed soft block hides a power-up

export const ROUND_TIME = 120;   // seconds until sudden death
export const SD_INTERVAL = 1.0;  // seconds between closing-wall drops
export const WINS_TARGET = 3;    // first to N round wins takes the match

export const BASE_RANGE = 2, MAX_RANGE = 8;
export const BASE_BOMBS = 1, MAX_BOMBS = 6;
export const BASE_SPEED = 3.0, SPEED_STEP = 0.45, MAX_SPEED = 4.8;

export const SPAWNS = [
    { x: 1, y: 1 }, { x: 13, y: 1 }, { x: 1, y: 11 }, { x: 13, y: 11 },
];

export const ROSTER = [
    { name: "YOU", color: [0.35, 0.65, 1.0, 1], isAI: false },
    { name: "RUBY", color: [1.0, 0.30, 0.32, 1], isAI: true },
    { name: "IRIS", color: [0.75, 0.40, 1.0, 1], isAI: true },
    { name: "AMBER", color: [1.0, 0.68, 0.16, 1], isAI: true },
];

export const POWER_TYPES = ["bombs", "range", "speed"];

/** Speed level shown in the HUD (1 = base). */
export function speedLevel(speed) {
    return 1 + Math.round((speed - BASE_SPEED) / SPEED_STEP);
}
