// sim/layers.js — the collision-layer matrix.
//
// Jolt's object layers are the cheapest filter in the engine: a pair the
// matrix says cannot collide is rejected in the broadphase. Physics.setLayers
// takes the whole table, and reconfiguring it takes effect for bodies that
// ALREADY exist, so the panel's checkbox grid changes what the next step
// collides rather than being a "restart the level" setting.
//
//   static      the lanes and pads (never moves)
//   moving      Jolt's default dynamic layer; kept at index 1 because
//               createBody falls back to it without an explicit layer
//   player      the "important" object: collides with everything
//   debris      hits the world but NOT itself, so a debris pile interpenetrates
//   projectile  passes through scenery and other projectiles, hits the rest
//   scenery     ramps and perimeter walls
//
// The matrix must be symmetric (Jolt asks in both orders; a lopsided table
// gives order-dependent tunnelling), so setPair always writes both cells.

const T = true, F = false;

export const LAYER_NAMES = ['static', 'moving', 'player', 'debris', 'projectile', 'scenery'];

/** Layers offered as spawn targets (static/moving are engine plumbing). */
export const SPAWN_LAYERS = ['player', 'debris', 'projectile', 'scenery'];

export const LAYER_COLORS = {
    static: '#5a6069', moving: '#b0bec5', player: '#4fa3ff',
    debris: '#ff9f43', projectile: '#ff4f7d', scenery: '#8d7b68',
};

const index = (x) => (typeof x === 'string' ? LAYER_NAMES.indexOf(x) : x);

// Row-major n*n, symmetric. The falses are the whole point: debris ignores
// debris, projectiles fly past debris and each other and through scenery,
// scenery ignores scenery, and Jolt's own static/static.
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

/** Push the current matrix at Jolt. */
export function applyLayers() {
    return Physics.setLayers({ names: LAYER_NAMES, matrix: matrix.slice() });
}

export const getMatrix = () => matrix.slice();

export function collides(a, b) { return matrix[index(a) * n + index(b)]; }

/** Set one pair on or off (both cells), push it, return the written value. */
export function setPair(a, b, on) {
    const i = index(a), j = index(b);
    matrix[i * n + j] = matrix[j * n + i] = !!on;
    applyLayers();
    return !!on;
}

export function resetLayers() {
    matrix = DEFAULT_MATRIX.slice();
    applyLayers();
}

// Applied at import: createBody resolves layer NAMES against this table, so it
// has to exist before the stage builds a single body. main.js imports this
// module first for that reason.
applyLayers();
