// layers.js — the collision-layer matrix.
//
// Jolt's object layers are the cheapest filter in the engine: a pair that the
// matrix says cannot collide is rejected in the broadphase, before any narrow-
// phase work happens. bro exposes the whole table through Physics.setLayers,
// and — this is the part worth demonstrating — reconfiguring it takes effect
// for bodies that ALREADY exist. So the HUD's checkbox grid is not a "restart
// the level" setting; flipping a cell changes what the next step collides.
//
// The default engine config is just ["static", "moving"]. We replace it with
// six layers so there is something asymmetric to look at:
//
//   static      the floor strips — never moves
//   moving      Jolt's default dynamic layer, kept at index 1 because
//               createBody falls back to it for anything without an explicit
//               layer, and to index 0 for static bodies
//   player      the "important" object: collides with everything
//   debris      collides with the world but NOT with itself, so a pile of
//               debris interpenetrates instead of stacking
//   projectile  passes THROUGH scenery (ramps/walls) and through other
//               projectiles, but still hits the floor, the player and debris
//   scenery     the ramps and perimeter walls
//
// The matrix must be symmetric — Jolt asks it in both orders and a lopsided
// table gives order-dependent collisions that look like random tunnelling.
// toggle() below always writes both cells for exactly that reason.

const T = true, F = false;

export const LAYER_NAMES = ['static', 'moving', 'player', 'debris', 'projectile', 'scenery'];

// Layers the HUD colour-codes and lets you spawn onto. `static` and `moving`
// are engine plumbing rather than gameplay categories, so they are not offered
// as spawn targets — but they still appear in the matrix grid, because the
// interesting rows (projectile-vs-scenery) only make sense next to them.
export const SPAWN_LAYERS = ['player', 'debris', 'projectile', 'scenery'];

export const LAYER_COLORS = {
    static:     '#5a6069',
    moving:     '#b0bec5',
    player:     '#4fa3ff',
    debris:     '#ff9f43',
    projectile: '#ff4f7d',
    scenery:    '#8d7b68',
};

export const layerIndex = (name) => LAYER_NAMES.indexOf(name);

// Row-major n*n, symmetric. The falses are the whole point:
//   debris/debris          — debris ignores debris (piles merge)
//   debris/projectile      — projectiles fly past debris clouds
//   projectile/projectile  — projectiles never clip each other
//   projectile/scenery     — projectiles pass through ramps and walls
//   scenery/scenery        — scenery is effectively static furniture
//   static/static          — Jolt's own default, kept
const DEFAULT_MATRIX = [
    //  static moving player debris projectile scenery
    /* static     */ F, T, T, T, T, T,
    /* moving     */ T, T, T, T, T, T,
    /* player     */ T, T, T, T, T, T,
    /* debris     */ T, T, T, F, F, T,
    /* projectile */ T, T, T, F, F, F,
    /* scenery    */ T, T, T, T, F, F,
];

const n = LAYER_NAMES.length;
let matrix = DEFAULT_MATRIX.slice();

/** Push the current matrix at Jolt. Safe to call at any time. */
export function applyLayers() {
    return Physics.setLayers({ names: LAYER_NAMES, matrix: matrix.slice() });
}

export function getMatrix() {
    return matrix.slice();
}

export function collides(a, b) {
    const i = typeof a === 'string' ? layerIndex(a) : a;
    const j = typeof b === 'string' ? layerIndex(b) : b;
    return matrix[i * n + j];
}

/**
 * Set one pair on or off, keeping the table symmetric, and push it. Returns
 * the value actually written so HUD checkboxes can be re-synced from it.
 */
export function setPair(a, b, on) {
    const i = typeof a === 'string' ? layerIndex(a) : a;
    const j = typeof b === 'string' ? layerIndex(b) : b;
    matrix[i * n + j] = !!on;
    matrix[j * n + i] = !!on;
    applyLayers();
    return !!on;
}

export function togglePair(a, b) {
    return setPair(a, b, !collides(a, b));
}

export function resetLayers() {
    matrix = DEFAULT_MATRIX.slice();
    applyLayers();
}

// Applied at import time: layer config has to exist before stage.js starts
// creating bodies, since createBody resolves layer NAMES against this table.
applyLayers();
