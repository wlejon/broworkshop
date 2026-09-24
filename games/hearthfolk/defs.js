// Hearthfolk constants: map, tiles, sim tuning, the five villagers.

export const MAP_W = 48, MAP_H = 36;
export const CELL = 1.0;
export const HSTEP = 0.45;
export const L_GROUND = 0, L_OVER = 1;

// Tile ids are GLOBALLY unique across layers (animations are keyed by id
// across all layers, see docs/tile-api.js).
export const TILE = {
    GRASS: 1, WATER: 2, FOREST: 3, ROCK: 4, SOIL: 5, PLAZA: 6,   // ground
    PATH: 7, BRIDGE: 8, CROP_A: 9, CROP_B: 10, CROP_C: 11,       // overlay
};
export const FLAG = { WATER: 1 };
export const CROP_STAGES = [TILE.CROP_A, TILE.CROP_B, TILE.CROP_C];

export const DAY_LEN = 120;            // sim seconds per full day
export const WALK_SPEED = 1.8;         // cells / sim second
export const WORK_TICK = 3.0;          // sim seconds per unit of job work
export const TREE_REGROW = 60;         // sim seconds for a stump to regrow
export const MEMORY_CAP = 20;
export const OVERRIDE_DUR = 30;        // sim seconds an accepted think steers
export const THINK_INTERVAL = 6;       // sim seconds between think dispatches
export const SAY_DUR = 4.5;            // sim seconds a said line stays visible
export const HEAR_RANGE = 2;           // cells within which a say is heard

export const START_RES = { food: 4, wood: 6, stone: 0, meals: 2 };

export const VILLAGER_DEFS = [
    { name: 'Rowan', role: 'farmer',   temperament: 'steady',   color: [0.32, 0.46, 0.22, 1], voice: 'am_michael' },
    { name: 'Bryn',  role: 'forester', temperament: 'restless', color: [0.16, 0.38, 0.30, 1], voice: 'am_fenrir' },
    { name: 'Merek', role: 'mason',    temperament: 'gruff',    color: [0.36, 0.38, 0.46, 1], voice: 'am_adam' },
    { name: 'Sella', role: 'cook',     temperament: 'warm',     color: [0.60, 0.28, 0.20, 1], voice: 'af_heart' },
    { name: 'Wynn',  role: 'elder',    temperament: 'wry',      color: [0.40, 0.28, 0.44, 1], voice: 'am_eric' },
];

export const PHASE_LABEL = {
    dawn: 'Dawn', morning: 'Morning', midday: 'Midday', evening: 'Evening', night: 'Night',
};
