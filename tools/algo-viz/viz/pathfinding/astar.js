// A* over an integer grid, one expansion per step() so each can be drawn.
//
// Cells are flat indices cx + cz*ncols. Walkability is a Uint8Array sampled
// once from the NavGrid (a per-neighbour native call was the hot path).
// Every state change is pushed to `dirty` so the renderer repaints only the
// cells that changed since the last frame.

export const HEURISTICS = {
    // h = 0 reduces A* to Dijkstra: uniform-cost search.
    dijkstra:  () => 0,
    manhattan: (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz),
    euclidean: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
    // Octile distance: admissible for 8-connected grids.
    diagonal:  (ax, az, bx, bz) => {
        const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
        return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    },
};

const DIRS4 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
const DIRS8 = DIRS4.concat([[1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
                            [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]);

export const UNSEEN = 0, OPEN = 1, CLOSED = 2;

export class AStar {
    /** opts: { ncols, nrows, walk: Uint8Array (1 = walkable), diagonal, heur, weight }. */
    constructor(opts) {
        this.ncols = opts.ncols;
        this.nrows = opts.nrows;
        this.walk = opts.walk;
        this.diagonal = !!opts.diagonal;
        this.heur = opts.heur;
        this.weight = opts.weight == null ? 1 : opts.weight;   // >1 = greedier

        const n = this.ncols * this.nrows;
        this.g = new Float64Array(n);
        this.f = new Float64Array(n);
        this.parent = new Int32Array(n);
        this.state = new Uint8Array(n);
        this.heap = [];              // min-heap of [f, tiebreak, idx]
        this.dirty = [];
        this.openCount = 0;
        this.closedCount = 0;
        this.maxG = 0;
    }

    reset(sx, sz, gx, gz) {
        this.g.fill(Infinity);
        this.f.fill(Infinity);
        this.parent.fill(-1);
        this.state.fill(UNSEEN);
        this.heap.length = 0;
        this.dirty.length = 0;
        this.tie = 0;
        this.start = sx + sz * this.ncols;
        this.goal = gx + gz * this.ncols;
        this.gx = gx; this.gz = gz;
        this.current = -1;
        this.done = false; this.found = false;
        this.path = [];
        this.steps = 0;
        this.openCount = 0;
        this.closedCount = 0;
        this.maxG = 0;
        if (!this.walk[this.start] || !this.walk[this.goal]) { this.done = true; return; }
        this.g[this.start] = 0;
        this.f[this.start] = this.weight * this.heur(sx, sz, gx, gz);
        this._open(this.start);
    }

    _open(i) {
        if (this.state[i] !== OPEN) {
            this.state[i] = OPEN;
            this.openCount++;
            this.dirty.push(i);
        }
        this._push(this.f[i], i);
    }

    _push(f, idx) {
        const h = this.heap;
        h.push([f, this.tie++, idx]);
        let i = h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!less(h[i], h[p])) break;
            const t = h[i]; h[i] = h[p]; h[p] = t; i = p;
        }
    }

    _pop() {
        const h = this.heap;
        const top = h[0], last = h.pop();
        if (h.length) {
            h[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let s = i;
                if (l < h.length && less(h[l], h[s])) s = l;
                if (r < h.length && less(h[r], h[s])) s = r;
                if (s === i) break;
                const t = h[i]; h[i] = h[s]; h[s] = t; i = s;
            }
        }
        return top;
    }

    /** One expansion. Returns true while more work remains. */
    step() {
        if (this.done) return false;
        while (this.heap.length) {
            const cur = this._pop()[2];
            if (this.state[cur] === CLOSED) continue;       // stale heap entry
            this.state[cur] = CLOSED;
            this.openCount--;
            this.closedCount++;
            this.current = cur;
            this.steps++;
            if (this.g[cur] > this.maxG) this.maxG = this.g[cur];
            this.dirty.push(cur);
            if (cur === this.goal) {
                this.done = true; this.found = true;
                this.path = this._reconstruct();
                return false;
            }
            this._relax(cur);
            return true;
        }
        this.done = true;                                   // open set empty: no path
        return false;
    }

    _relax(cur) {
        const NC = this.ncols, NR = this.nrows, W = this.walk;
        const cz = (cur / NC) | 0, cx = cur - cz * NC;
        const dirs = this.diagonal ? DIRS8 : DIRS4;
        for (const [dx, dz, cost] of dirs) {
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= NC || nz >= NR) continue;
            const ni = nx + nz * NC;
            if (!W[ni] || this.state[ni] === CLOSED) continue;
            // No diagonal step that cuts a blocked corner.
            if (dx && dz && (!W[cx + dx + cz * NC] || !W[cx + (cz + dz) * NC])) continue;
            const tentative = this.g[cur] + cost;
            if (tentative < this.g[ni]) {
                this.parent[ni] = cur;
                this.g[ni] = tentative;
                this.f[ni] = tentative + this.weight * this.heur(nx, nz, this.gx, this.gz);
                this._open(ni);
            }
        }
    }

    runToCompletion(maxSteps = 1e6) {
        for (let i = 0; i < maxSteps && this.step(); i++) { /* expand */ }
    }

    _reconstruct() {
        const out = [];
        for (let cur = this.goal; cur !== -1; cur = this.parent[cur]) {
            const cz = (cur / this.ncols) | 0;
            out.push({ cx: cur - cz * this.ncols, cz });
            if (cur === this.start) break;
        }
        return out.reverse();
    }

    /** Path cost to the goal (Infinity until found). */
    get cost() { return this.found ? this.g[this.goal] : Infinity; }
}

function less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

/**
 * A 256-entry palette from gradient stops [[t, r, g, b], ...], packed
 * 0xAABBGGRR so a Uint32Array view over ImageData takes one write per cell.
 */
export function packedPalette(stops) {
    const out = new Uint32Array(256);
    for (let k = 0; k < 256; k++) {
        const t = k / 255;
        let [, r, g, b] = stops[stops.length - 1];
        for (let i = 1; i < stops.length; i++) {
            if (t > stops[i][0]) continue;
            const a = stops[i - 1], c = stops[i], u = (t - a[0]) / (c[0] - a[0]);
            r = (a[1] + (c[1] - a[1]) * u) | 0;
            g = (a[2] + (c[2] - a[2]) * u) | 0;
            b = (a[3] + (c[3] - a[3]) * u) | 0;
            break;
        }
        out[k] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return out;
}

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
