// tactics.js — the tactical read of the map: threat, influence, chokes, cover.
//
//   threat     each threat source projects falloff only into cells it can SEE
//              (NavGrid.hasLineOfSight), so walls cast shadows. The wave in
//              field.js prices threat as extra entry cost: routes bend away.
//   influence  where our own units are, diffused a few steps and depressed by
//              threat (refreshed on a timer while units move).
//   chokes     cells whose cheap-ground span across one axis is narrow while
//              the other axis runs long: a gap in a wall, a bridge over a
//              river. Grouped into regions; a region is one choke point.
//   cover      open cells inside a threat's reach that it cannot see, beside a
//              wall: where a unit would want to stand.

import { COLS, ROWS, TERRAIN, field, idx, inside, cellOf, markDanger } from "/app/field.js";

const N = COLS * ROWS;
export const CHOKE_MAX = 12;      // widest span (cells) that still counts as a choke

export const tactics = {
    threats: [],                   // { x, y, radius, strength }
    influence: new Float32Array(N),
    choke: new Uint8Array(N),      // 1 = choke cell
    cover: new Uint8Array(N),      // 1 = cover cell
    chokes: [],                    // regions: { x, y, width, cells }
    coverCells: 0,
    version: -1,                   // field.version the terrain analysis ran for
    threatVersion: 0,
};

export function addThreat(x, y, radius = 14, strength = 1.2) {
    tactics.threats.push({ x, y, radius, strength });
    threatsChanged();
}

/** Remove threats within r of a point. Returns how many went. */
export function removeThreatsNear(x, y, r) {
    const before = tactics.threats.length;
    tactics.threats = tactics.threats.filter((t) => Math.hypot(t.x - x, t.y - y) > r);
    if (tactics.threats.length !== before) threatsChanged();
    return before - tactics.threats.length;
}

export function clearThreats() {
    tactics.threats = [];
    threatsChanged();
}

function threatsChanged() {
    tactics.threatVersion++;
    projectThreat();
}

/** Threat per cell, line-of-sight gated. Re-run on threat or terrain change. */
export function projectThreat() {
    const T = field.threat, g = field.grid;
    T.fill(0);
    for (const t of tactics.threats) {
        const r = Math.ceil(t.radius);
        const [cx, cy] = cellOf(t.x, t.y);
        for (let y = cy - r; y <= cy + r; y++) {
            for (let x = cx - r; x <= cx + r; x++) {
                if (!inside(x, y)) continue;
                const i = idx(x, y);
                if (field.cost[i] >= TERRAIN.WALL) continue;
                const d = Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y);
                if (d >= t.radius || !g.hasLineOfSight(t.x, t.y, x + 0.5, y + 0.5)) continue;
                const f = 1 - d / t.radius;
                T[i] = Math.max(T[i], t.strength * f * f);
            }
        }
    }
    markDanger();
    analyzeCover();
}

/** Friendly influence from unit positions (flat x/y arrays, count n). */
export function updateInfluence(xs, ys, n) {
    const I = tactics.influence;
    I.fill(0);
    const stride = Math.max(1, Math.ceil(n / 800));
    for (let i = 0; i < n; i += stride) {
        const [x, y] = cellOf(xs[i], ys[i]);
        if (inside(x, y)) I[idx(x, y)] += 0.4 * stride;
    }
    const tmp = new Float32Array(N), C = field.cost;
    for (let it = 0; it < 3; it++) {
        tmp.set(I);
        for (let y = 1; y < ROWS - 1; y++) {
            for (let x = 1; x < COLS - 1; x++) {
                const i = idx(x, y);
                if (C[i] >= TERRAIN.WALL) continue;
                let s = tmp[i] * 0.6;
                for (const j of [i - 1, i + 1, i - COLS, i + COLS]) if (C[j] < TERRAIN.WALL) s += tmp[j] * 0.1;
                I[i] = Math.min(2, s * 0.97);
            }
        }
    }
    const T = field.threat;
    for (let i = 0; i < N; i++) I[i] -= T[i] * 1.5;
}

/** Choke regions from the terrain (cheap-ground spans). Cached per terrain version. */
export function analyzeTerrain() {
    if (tactics.version === field.version) return false;
    tactics.version = field.version;
    const C = field.cost, cheap = (i) => C[i] === TERRAIN.OPEN;
    const H = new Uint16Array(N), V = new Uint16Array(N);
    // Run lengths of open ground along each row and each column.
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS;) {
            if (!cheap(idx(x, y))) { x++; continue; }
            let e = x;
            while (e < COLS && cheap(idx(e, y))) e++;
            for (let k = x; k < e; k++) H[idx(k, y)] = e - x;
            x = e;
        }
    }
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS;) {
            if (!cheap(idx(x, y))) { y++; continue; }
            let e = y;
            while (e < ROWS && cheap(idx(x, e))) e++;
            for (let k = y; k < e; k++) V[idx(x, k)] = e - y;
            y = e;
        }
    }
    const K = tactics.choke;
    K.fill(0);
    for (let i = 0; i < N; i++) {
        if (!cheap(i)) continue;
        const lo = Math.min(H[i], V[i]), hi = Math.max(H[i], V[i]);
        if (lo >= 2 && lo <= CHOKE_MAX && hi >= 3 * lo) K[i] = 1;
    }
    // Regions: 4-connected flood fill; tiny specks are noise.
    tactics.chokes = [];
    const seen = new Uint8Array(N), stack = [];
    for (let s = 0; s < N; s++) {
        if (!K[s] || seen[s]) continue;
        let sx = 0, sy = 0, n = 0, width = Infinity;
        stack.push(s); seen[s] = 1;
        const cells = [];
        while (stack.length) {
            const i = stack.pop(), x = i % COLS, y = (i / COLS) | 0;
            cells.push(i); sx += x + 0.5; sy += y + 0.5; n++;
            width = Math.min(width, Math.min(H[i], V[i]));
            for (const j of [i - 1, i + 1, i - COLS, i + COLS]) if (j >= 0 && j < N && K[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
        if (n >= 6) tactics.chokes.push({ x: sx / n, y: sy / n, width, cells: n });
        else for (const i of cells) K[i] = 0;
    }
    analyzeCover();
    return true;
}

/** Cover: open, within 1.3x a threat's reach, unseen by every threat, next to a wall. */
export function analyzeCover() {
    const Cv = tactics.cover, C = field.cost, g = field.grid;
    Cv.fill(0);
    let n = 0;
    if (!g || !tactics.threats.length) { tactics.coverCells = 0; return; }
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            const i = idx(x, y);
            if (C[i] >= TERRAIN.WALL) continue;
            let wall = false;
            for (const j of [i - 1, i + 1, i - COLS, i + COLS]) if (C[j] >= TERRAIN.WALL) { wall = true; break; }
            if (!wall) continue;
            const px = x + 0.5, py = y + 0.5;
            let near = false, seen = false;
            for (const t of tactics.threats) {
                if (Math.hypot(px - t.x, py - t.y) > t.radius * 1.3) continue;
                near = true;
                if (g.hasLineOfSight(t.x, t.y, px, py)) { seen = true; break; }
            }
            if (near && !seen) { Cv[i] = 1; n++; }
        }
    }
    tactics.coverCells = n;
}

export function threatAt(wx, wy) {
    const [x, y] = cellOf(wx, wy);
    return inside(x, y) ? field.threat[idx(x, y)] : 0;
}
