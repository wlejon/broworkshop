// field.js — the terrain, its bro.ai.game NavGrid, and the flow field.
//
// World units are cells: the map is COLS x ROWS, cell (x, y) spans
// [x, x+1) x [y, y+1), and its centre is (x + 0.5, y + 0.5). World y is the
// NavGrid's z.
//
// The terrain lives twice, deliberately. `cost` is the app's typed array
// (the flow-field wave reads it cell by cell); `grid` is a bro.ai.game NavGrid
// kept in lockstep (setWalkable / setCellCost), which answers what the engine
// answers well: one A* route (the leader line) and grid line-of-sight (threat
// shadows and cover, tactics.js). What the engine does NOT have is a
// square-grid integration / flow field (HexNav.field is hex-only), so the
// wave below is JS: one fast-marching sweep out from the goal over every
// cell, then a direction per cell, and every unit samples it. One search for N units,
// where A* would be N searches.

export const COLS = 128, ROWS = 72;
export const TERRAIN = { OPEN: 1, ROUGH: 5, WALL: 255 };
/** Extra entry cost per unit of threat: the wave routes around danger. */
export const DANGER = 10;
const INF = 1e9;
const N = COLS * ROWS;

export const field = {
    cost: new Uint8Array(N),
    threat: new Float32Array(N),        // written by tactics.js
    integration: new Float32Array(N),   // cost-to-goal
    flowX: new Float32Array(N),
    flowY: new Float32Array(N),
    goal: { x: COLS * 0.75, y: ROWS * 0.5 },
    grid: null,
    dirty: true,             // wave must be recomputed
    version: 0,              // bumps on every terrain edit (tactics, render caches)
    lastWaveMs: 0,
    reached: 0,              // cells the last wave reached
};

export const idx = (x, y) => y * COLS + x;
export const inside = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
export const cellOf = (wx, wy) => [Math.floor(wx), Math.floor(wy)];
export const now = () => (globalThis.perf && perf.now ? perf.now() : performance.now());

/** Fresh open map with a wall border, and a NavGrid to match. */
export function resetTerrain() {
    field.cost.fill(TERRAIN.OPEN);
    field.grid = bro.ai.game.createNavGrid({ minX: 0, maxX: COLS, minZ: 0, maxZ: ROWS, cellSize: 1 });
    for (let x = 0; x < COLS; x++) { setCell(x, 0, TERRAIN.WALL); setCell(x, ROWS - 1, TERRAIN.WALL); }
    for (let y = 0; y < ROWS; y++) { setCell(0, y, TERRAIN.WALL); setCell(COLS - 1, y, TERRAIN.WALL); }
    touch();
}

function touch() { field.dirty = true; field.version++; }

/** One cell, mirrored into the NavGrid. */
export function setCell(x, y, value) {
    if (!inside(x, y)) return;
    const i = idx(x, y);
    if (field.cost[i] === value) return;
    field.cost[i] = value;
    const g = field.grid, cx = x + 0.5, cz = y + 0.5;
    g.setWalkable(cx, cz, value < TERRAIN.WALL);
    if (value < TERRAIN.WALL) g.setCellCost(cx, cz, value);
    touch();
}

export function getCost(x, y) { return inside(x, y) ? field.cost[idx(x, y)] : TERRAIN.WALL; }

/** Paint a disc of `value` (the map border is not paintable). Returns cells changed. */
export function paint(wx, wy, radius, value) {
    const [cx, cy] = cellOf(wx, wy), r = Math.max(0.5, radius);
    let n = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) continue;
            if ((x + 0.5 - wx) ** 2 + (y + 0.5 - wy) ** 2 > r * r) continue;
            if (field.cost[idx(x, y)] !== value) { setCell(x, y, value); n++; }
        }
    }
    return n;
}

/** A filled rectangle of cells (scenarios). */
export function fillRect(x0, y0, x1, y1, value) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(x, y, value);
}

export function setGoal(wx, wy) {
    field.goal = { x: Math.max(1.5, Math.min(COLS - 1.5, wx)), y: Math.max(1.5, Math.min(ROWS - 1.5, wy)) };
    field.dirty = true;
}

export function markDanger() { field.dirty = true; }

// --- the wave ---------------------------------------------------------------------------

// A binary min-heap over (cell, key) in typed arrays: no per-push objects.
// Each cell is pushed at most once per neighbour it has, so 4N bounds the heap.
const heapCell = new Int32Array(N * 4 + 8), heapKey = new Float32Array(N * 4 + 8), frozen = new Uint8Array(N);
let heapLen = 0;
function push(c, k) {
    let i = heapLen++;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= k) break;
        heapCell[i] = heapCell[p]; heapKey[i] = heapKey[p]; i = p;
    }
    heapCell[i] = c; heapKey[i] = k;
}
function pop() {
    const top = heapCell[0], c = heapCell[--heapLen], k = heapKey[heapLen];
    let i = 0;
    for (;;) {
        let m = 2 * i + 1;
        if (m >= heapLen) break;
        if (m + 1 < heapLen && heapKey[m + 1] < heapKey[m]) m++;
        if (heapKey[m] >= k) break;
        heapCell[i] = heapCell[m]; heapKey[i] = heapKey[m]; i = m;
    }
    heapCell[i] = c; heapKey[i] = k;
    return top;
}

/**
 * Recompute the integration and flow fields if anything changed. Returns
 * whether it ran.
 *
 * The wave is a fast-marching (eikonal) solve rather than plain 8-way
 * Dijkstra: each cell's cost-to-goal comes from its best horizontal and
 * vertical neighbours together, which approximates true straight-line
 * distance. Octile Dijkstra distances have ridges along the rows and
 * diagonals through the goal, and a swarm descending them funnels into a
 * few thin lanes; the eikonal field descends in straight rays. 4-connected,
 * so it never cuts a wall corner.
 *
 * The loop is written out flat (typed arrays in locals, the heap push
 * inlined): it visits ~9k cells x 4 neighbours, and a helper call per
 * neighbour dominated it.
 */
export function updateField() {
    if (!field.dirty) return false;
    const t0 = now();
    const { cost, threat, integration: dist, flowX, flowY } = field;
    const WALL = TERRAIN.WALL, HC = heapCell, HK = heapKey;
    dist.fill(INF); flowX.fill(0); flowY.fill(0); frozen.fill(0);
    heapLen = 0;
    const [gx, gy] = cellOf(field.goal.x, field.goal.y);
    let reached = 0;
    if (inside(gx, gy) && cost[idx(gx, gy)] < WALL) {
        dist[idx(gx, gy)] = 0;
        push(idx(gx, gy), 0);
    }
    // Update cell n (open, in bounds) from its neighbours' current values.
    const relax = (n) => {
        const x = n % COLS, y = (n / COLS) | 0, f = cost[n] + DANGER * threat[n];
        const a = Math.min(x > 0 ? dist[n - 1] : INF, x < COLS - 1 ? dist[n + 1] : INF);
        const b = Math.min(y > 0 ? dist[n - COLS] : INF, y < ROWS - 1 ? dist[n + COLS] : INF);
        const lo = a < b ? a : b, gap = a - b;
        const nd = gap > -f && gap < f ? (a + b + Math.sqrt(2 * f * f - gap * gap)) / 2 : lo + f;
        if (nd < dist[n]) {
            dist[n] = nd;
            let i = heapLen++;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (HK[p] <= nd) break;
                HC[i] = HC[p]; HK[i] = HK[p]; i = p;
            }
            HC[i] = n; HK[i] = nd;
        }
    };
    while (heapLen) {
        const k = HK[0], c = pop();
        if (frozen[c] || k > dist[c]) continue;   // stale entry
        frozen[c] = 1;                            // accepted: never updated again
        reached++;
        const x = c % COLS, y = (c / COLS) | 0;
        if (x < COLS - 1 && cost[c + 1] < WALL && !frozen[c + 1]) relax(c + 1);
        if (x > 0 && cost[c - 1] < WALL && !frozen[c - 1]) relax(c - 1);
        if (y < ROWS - 1 && cost[c + COLS] < WALL && !frozen[c + COLS]) relax(c + COLS);
        if (y > 0 && cost[c - COLS] < WALL && !frozen[c - COLS]) relax(c - COLS);
    }
    // Direction: minus the upwind gradient, per axis (walls and unreached
    // cells hold INF and are never upwind).
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const c = idx(x, y), d = dist[c];
            if (cost[c] >= WALL || d >= INF) continue;
            const l = x > 0 ? dist[c - 1] : INF, r = x < COLS - 1 ? dist[c + 1] : INF;
            const u = y > 0 ? dist[c - COLS] : INF, dn = y < ROWS - 1 ? dist[c + COLS] : INF;
            const fx = l < r ? (l < d ? l - d : 0) : (r < d ? d - r : 0);
            const fy = u < dn ? (u < d ? u - d : 0) : (dn < d ? d - dn : 0);
            const fl = Math.sqrt(fx * fx + fy * fy);
            if (fl > 1e-6) { flowX[c] = fx / fl; flowY[c] = fy / fl; }
        }
    }
    field.reached = reached;
    field.dirty = false;
    field.lastWaveMs = now() - t0;
    return true;
}

/** Bilinear flow at a world point, normalised; {0,0} where there is none. */
export function sampleFlow(wx, wy, out) {
    const gx = wx - 0.5, gy = wy - 0.5;
    const x0 = Math.max(0, Math.min(COLS - 2, Math.floor(gx))), y0 = Math.max(0, Math.min(ROWS - 2, Math.floor(gy)));
    const tx = Math.max(0, Math.min(1, gx - x0)), ty = Math.max(0, Math.min(1, gy - y0));
    const a = idx(x0, y0), b = a + 1, c = a + COLS, d = c + 1;
    const { flowX: X, flowY: Y } = field;
    const vx = (X[a] * (1 - tx) + X[b] * tx) * (1 - ty) + (X[c] * (1 - tx) + X[d] * tx) * ty;
    const vy = (Y[a] * (1 - tx) + Y[b] * tx) * (1 - ty) + (Y[c] * (1 - tx) + Y[d] * tx) * ty;
    const l = Math.hypot(vx, vy);
    out.x = l > 1e-4 ? vx / l : 0; out.y = l > 1e-4 ? vy / l : 0;
    return out;
}

export function distanceAt(wx, wy) {
    const [x, y] = cellOf(wx, wy);
    return inside(x, y) ? field.integration[idx(x, y)] : INF;
}

export function reachable(wx, wy) { return distanceAt(wx, wy) < INF; }

/**
 * The engine's answer for ONE unit: NavGrid A* (cell costs included) from a
 * point to the goal, as [{x, y}] in world units, plus its length.
 */
export function leaderRoute(from) {
    const g = field.grid;
    if (!g) return null;
    const t0 = now();
    const raw = g.findPath(from.x, from.y, field.goal.x, field.goal.y);
    const ms = now() - t0;
    if (!raw || !raw.length) return null;
    const points = raw.map((p) => ({ x: p.x, y: p.z }));
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return { points, length, partial: !!raw.partial, ms };
}
