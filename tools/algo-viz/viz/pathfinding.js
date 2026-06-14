// A* pathfinding, stepwise. The point is to show how A* works: the open
// set (frontier), the closed set (visited), the running g-cost, the
// heuristic, and how the algorithm balances them through f = g + h.
//
// Walkability comes from the C++ NavGrid (bro.ai.game). A* itself runs
// in JS so each expansion is visible — one step pops the lowest-f cell
// from the open set, adds it to the closed set, and relaxes its neighbors.

import { VIZ } from "/app/viz/_registry.js";
export let AVUI;

(function () {
    const WORLD_HALF = 20;

    const HEURISTICS = {
        // h = 0 reduces A* to Dijkstra — uniform-cost search.
        dijkstra:  (ax, az, bx, bz) => 0,
        manhattan: (ax, az, bx, bz) => Math.abs(ax - bx) + Math.abs(az - bz),
        euclidean: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
        // Diagonal (octile) distance — admissible for 8-connected grids.
        diagonal:  (ax, az, bx, bz) => {
            const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
            return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
        },
    };

    function createObstacles(n, rng) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const hw = 0.8 + rng() * 2.0;
            const hd = 0.8 + rng() * 2.0;
            const x = (rng() * 2 - 1) * (WORLD_HALF - hw - 1);
            const z = (rng() * 2 - 1) * (WORLD_HALF - hd - 1);
            out.push({ x, z, hw, hd });
        }
        return out;
    }

    function mulberry32(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ------- A* state machine over an integer grid -----------------------------
    // Each cell is a flat index cx + cz*ncols. Arrays are sized once per grid.
    // Walkability is a Uint8Array — sampling the NavGrid once in JS for every
    // neighbour expansion was the hot path; direct array lookup kills it.
    class AStar {
        constructor(opts) {
            this.ncols = opts.ncols;
            this.nrows = opts.nrows;
            this.walk = opts.walk;               // Uint8Array(ncols*nrows), 1=walkable
            this.diagonal = opts.diagonal;
            this.heur = opts.heur;
            this.weight = opts.weight || 1.0;    // h weight (>1 = greedier)

            const n = this.ncols * this.nrows;
            this.g       = new Float64Array(n);
            this.f       = new Float64Array(n);
            this.parent  = new Int32Array(n);
            this.state   = new Uint8Array(n);   // 0=unseen, 1=open, 2=closed
            this.openOrder = new Int32Array(n); // counter so we can sort frontier deterministically
            this.openSet = new Set();           // indices currently in open; used for redraw enumeration
            this.heap = [];                     // min-heap of [f, tiebreak, idx]
            this.tieCounter = 0;
            this.start = -1; this.goal = -1;
            this.current = -1;
            this.done = false; this.found = false;
            this.path = [];
            this.steps = 0;
            // Incremental stats — updated inside step() so draw() never has to
            // rescan the full grid (was O(ncells) × 3 per frame).
            this._maxG = 0;
            this._closedCount = 0;
            // Indices that changed state since the last drain() call. The
            // renderer paints only these into the gridU32 each frame instead
            // of looping over every cell.
            this.dirty = [];
        }

        reset(sx, sz, gx, gz) {
            this.g.fill(Infinity);
            this.f.fill(Infinity);
            this.parent.fill(-1);
            this.state.fill(0);
            this.openSet.clear();
            this.heap.length = 0;
            this.tieCounter = 0;
            this.start = sx + sz * this.ncols;
            this.goal  = gx + gz * this.ncols;
            this.current = -1;
            this.done = false; this.found = false;
            this.path = [];
            this.steps = 0;
            this._maxG = 0;
            this._closedCount = 0;
            this.dirty.length = 0;

            if (!this.walk[sx + sz * this.ncols] || !this.walk[gx + gz * this.ncols]) {
                this.done = true; this.found = false;
                return;
            }

            this.g[this.start] = 0;
            const h0 = this._h(sx, sz, gx, gz);
            this.f[this.start] = h0 * this.weight;
            this.state[this.start] = 1;
            this.openSet.add(this.start);
            this.dirty.push(this.start);
            this._heapPush(this.f[this.start], this.start);
        }

        _h(ax, az, bx, bz) {
            return this.heur(ax, az, bx, bz);
        }

        _heapPush(f, idx) {
            const h = this.heap;
            h.push([f, this.tieCounter++, idx]);
            let i = h.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (this._less(h[i], h[p])) { const t = h[i]; h[i] = h[p]; h[p] = t; i = p; }
                else break;
            }
        }
        _heapPop() {
            const h = this.heap;
            if (h.length === 0) return null;
            const top = h[0];
            const last = h.pop();
            if (h.length > 0) {
                h[0] = last;
                let i = 0; const n = h.length;
                for (;;) {
                    const l = i*2+1, r = i*2+2;
                    let s = i;
                    if (l < n && this._less(h[l], h[s])) s = l;
                    if (r < n && this._less(h[r], h[s])) s = r;
                    if (s === i) break;
                    const t = h[i]; h[i] = h[s]; h[s] = t; i = s;
                }
            }
            return top;
        }
        _less(a, b) { return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); }

        // One expansion. Returns true if more work remains.
        step() {
            if (this.done) return false;
            while (this.heap.length) {
                const top = this._heapPop();
                const cur = top[2];
                // Stale entry (we found a better g earlier and re-pushed). Skip.
                if (this.state[cur] === 2) continue;
                this.state[cur] = 2;
                this.openSet.delete(cur);
                this.current = cur;
                this.steps++;
                this._closedCount++;
                const gCur = this.g[cur];
                if (gCur > this._maxG) this._maxG = gCur;
                this.dirty.push(cur);

                if (cur === this.goal) {
                    this.done = true; this.found = true;
                    this._reconstruct();
                    return false;
                }

                const cz = (cur / this.ncols) | 0;
                const cx = cur - cz * this.ncols;
                const gc = this.g[cur];
                const dirs = this.diagonal ? AStar.DIRS8 : AStar.DIRS4;
                const W = this.walk, NC = this.ncols, NR = this.nrows;
                for (let i = 0; i < dirs.length; i++) {
                    const dx = dirs[i][0], dz = dirs[i][1], stepCost = dirs[i][2];
                    const nx = cx + dx, nz = cz + dz;
                    if (nx < 0 || nz < 0 || nx >= NC || nz >= NR) continue;
                    const ni = nx + nz * NC;
                    if (!W[ni]) continue;
                    // Disallow diagonal moves that cut through a blocked corner.
                    if (this.diagonal && (dx !== 0 && dz !== 0)) {
                        if (!W[cx + dx + cz * NC] || !W[cx + (cz + dz) * NC]) continue;
                    }
                    if (this.state[ni] === 2) continue;
                    const tentative = gc + stepCost;
                    if (tentative < this.g[ni]) {
                        this.parent[ni] = cur;
                        this.g[ni] = tentative;
                        const gz_ = (this.goal / this.ncols) | 0;
                        const gx_ = this.goal - gz_ * this.ncols;
                        this.f[ni] = tentative + this.weight * this._h(nx, nz, gx_, gz_);
                        if (this.state[ni] !== 1) {
                            this.state[ni] = 1;
                            this.openSet.add(ni);
                            this.dirty.push(ni);
                        }
                        this._heapPush(this.f[ni], ni);
                    }
                }
                return true;
            }
            // open set empty — no path
            this.done = true; this.found = false;
            return false;
        }

        runToCompletion(maxSteps = 1e6) {
            for (let i = 0; i < maxSteps && this.step(); i++) {}
        }

        _reconstruct() {
            const out = [];
            let cur = this.goal;
            while (cur !== -1) {
                const cz = (cur / this.ncols) | 0;
                const cx = cur - cz * this.ncols;
                out.push({ cx, cz });
                if (cur === this.start) break;
                cur = this.parent[cur];
            }
            out.reverse();
            this.path = out;
        }

        // Stats — O(1) reads of incrementally tracked counters.
        maxG()        { return this._maxG || 1; }
        countClosed() { return this._closedCount; }
    }
    // Build a 256-entry Uint32 palette from gradient stops. Result is packed
    // 0xAA_BB_GG_RR (little-endian RGBA in memory) so it lines up with
    // ImageData.data when viewed as Uint32Array — one assignment per cell
    // instead of four.
    function buildCostPalette(stops) {
        const out = new Uint32Array(256);
        for (let k = 0; k < 256; k++) {
            const t = k / 255;
            let r = stops[stops.length - 1][1];
            let g = stops[stops.length - 1][2];
            let b = stops[stops.length - 1][3];
            for (let i = 1; i < stops.length; i++) {
                if (t <= stops[i][0]) {
                    const a = stops[i - 1], c = stops[i];
                    const u = (t - a[0]) / (c[0] - a[0]);
                    r = (a[1] + (c[1] - a[1]) * u) | 0;
                    g = (a[2] + (c[2] - a[2]) * u) | 0;
                    b = (a[3] + (c[3] - a[3]) * u) | 0;
                    break;
                }
            }
            out[k] = (0xff << 24) | (b << 16) | (g << 8) | r;
        }
        return out;
    }

    AStar.DIRS4 = [[ 1,0,1],[-1,0,1],[0, 1,1],[0,-1,1]];
    AStar.DIRS8 = [[ 1,0,1],[-1,0,1],[0, 1,1],[0,-1,1],
                   [ 1, 1,Math.SQRT2],[ 1,-1,Math.SQRT2],
                   [-1, 1,Math.SQRT2],[-1,-1,Math.SQRT2]];

    VIZ.push({
        id: 'pathfinding',
        name: 'A* Pathfinding',
        category: 'Path & Navigation',
        subtitle: 'A* step by step — open set (frontier), closed set (visited), g-cost gradient, and reconstructed path. Click to set start, shift-click to set goal.',

        init({ stage, params }) {
            const canvas = document.createElement('canvas');
            stage.appendChild(canvas);
            const ctx = canvas.getContext('2d');

            const hint = document.createElement('div');
            hint.id = 'hint';
            hint.textContent = 'click: start · shift-click: goal · space: play/pause · n: step · r: randomize';
            stage.appendChild(hint);

            // Legend overlay so the colors are self-explanatory.
            const legend = document.createElement('div');
            legend.style.cssText = 'position:absolute;right:10px;top:10px;'
                + 'padding:6px 10px;background:rgba(0,0,0,0.6);color:#ccc;'
                + 'font:11px monospace;line-height:1.45;pointer-events:none;'
                + 'border:1px solid #222;border-radius:3px;';
            stage.appendChild(legend);

            const state = {
                cellSize: 0.5,
                padding:  0.4,
                seed:     1,
                numObstacles: 12,
                obstacles: [],
                nav: null,
                heuristic: 'diagonal',
                diagonal: true,
                weight: 1.0,
                showCost: true,
                showParents: false,

                running: false,           // play/pause for stepping
                stepsPerTick: 4,          // expansions per frame when running

                start: { x: -16, z: -16 },
                goal:  { x:  16, z:  16 },
                astar: null,              // AStar instance
                ncols: 0, nrows: 0,

                animFrame: null,
                drawDirty: true,          // redraw only when state changed
                lastCanvasW: 0, lastCanvasH: 0,
                gridU32Valid: false,      // gridU32 reflects current astar state
                invCostScale: 1,          // fixed 255/maxExpectedG (computed per search)
            };

            function markDraw() { state.drawDirty = true; }
            // Invalidating the gridU32 forces the next draw to repaint every
            // cell from scratch (walkable, open, closed). Used when the grid
            // is rebuilt, the search is reset, or color mode toggles.
            function invalidateGrid() { state.gridU32Valid = false; markDraw(); }

            // --- grid <-> world helpers -----------------------------------------
            function worldToCell(wx, wz) {
                const cs = state.cellSize;
                const cx = Math.floor((wx + WORLD_HALF) / cs);
                const cz = Math.floor((wz + WORLD_HALF) / cs);
                return { cx, cz };
            }
            function cellCenterWorld(cx, cz) {
                const cs = state.cellSize;
                return { x: -WORLD_HALF + (cx + 0.5) * cs, z: -WORLD_HALF + (cz + 0.5) * cs };
            }

            function rebuild() {
                const rng = mulberry32(state.seed);
                state.obstacles = createObstacles(state.numObstacles, rng);
                state.nav = bro.ai.game.createNavGrid({
                    minX: -WORLD_HALF, minZ: -WORLD_HALF,
                    maxX:  WORLD_HALF, maxZ:  WORLD_HALF,
                    cellSize: state.cellSize,
                    obstacles: state.obstacles,
                    padding: state.padding,
                });
                state.ncols = Math.round(2 * WORLD_HALF / state.cellSize);
                state.nrows = state.ncols;
                // Cache walkability once per (re)build — was ncols×nrows
                // isWalkable C++ calls *per draw frame* before.
                const n = state.ncols * state.nrows;
                if (!state.walkMask || state.walkMask.length !== n) {
                    state.walkMask = new Uint8Array(n);
                }
                for (let cz = 0; cz < state.nrows; cz++) {
                    for (let cx = 0; cx < state.ncols; cx++) {
                        const wc = cellCenterWorld(cx, cz);
                        state.walkMask[cx + cz * state.ncols] =
                            state.nav.isWalkable(wc.x, wc.z) ? 1 : 0;
                    }
                }
                // Offscreen at one pixel per cell; nearest-neighbour scaled to
                // the visible canvas. This collapses 6400 fillRects per frame
                // into one putImageData + one drawImage.
                if (!state.gridCanvas || state.gridCanvas.width !== state.ncols) {
                    state.gridCanvas = document.createElement('canvas');
                    state.gridCanvas.width  = state.ncols;
                    state.gridCanvas.height = state.nrows;
                    state.gridCtx = state.gridCanvas.getContext('2d');
                    state.gridImg = state.gridCtx.createImageData(state.ncols, state.nrows);
                    state.gridU32 = new Uint32Array(state.gridImg.data.buffer);
                }
                resetSearch();
                markDraw();
            }

            function resetSearch() {
                state.astar = new AStar({
                    ncols: state.ncols, nrows: state.nrows,
                    walk: state.walkMask,
                    diagonal: state.diagonal,
                    heur: HEURISTICS[state.heuristic],
                    weight: state.weight,
                });
                const s = worldToCell(state.start.x, state.start.z);
                const g = worldToCell(state.goal.x,  state.goal.z);
                // Clamp inside grid
                const clamp = (v, hi) => Math.max(0, Math.min(hi - 1, v));
                state.astar.reset(clamp(s.cx, state.ncols), clamp(s.cz, state.nrows),
                                  clamp(g.cx, state.ncols), clamp(g.cz, state.nrows));
                // Pre-compute a fixed cost->palette scale so closed cells can
                // be painted once at transition time without ever needing a
                // global rescan when maxG grows. Picked to leave headroom for
                // costs that exceed the start→goal heuristic distance.
                const h0 = HEURISTICS.diagonal(
                    clamp(s.cx, state.ncols), clamp(s.cz, state.nrows),
                    clamp(g.cx, state.ncols), clamp(g.cz, state.nrows));
                state.invCostScale = 255 / Math.max(1, h0 * 1.5);
                invalidateGrid();
            }

            // --- drawing ---------------------------------------------------------
            function worldToScreen() {
                const w = canvas.width, h = canvas.height;
                const side = Math.min(w, h);
                const scale = side / (2 * WORLD_HALF);
                const ox = (w - side) * 0.5 + side * 0.5;
                const oy = (h - side) * 0.5 + side * 0.5;
                return { scale, ox, oy };
            }
            function w2s(x, z, m) { return [m.ox + x * m.scale, m.oy + z * m.scale]; }
            function s2w(sx, sy, m) { return { x: (sx - m.ox) / m.scale, z: (sy - m.oy) / m.scale }; }

            // Palette = 256-entry RGBA gradient for the g-cost ramp, packed as
            // little-endian 0xAABBGGRR so we can write one Uint32 per cell.
            const COST_PALETTE = buildCostPalette([
                [0.00,  20,  40,  90],
                [0.40,  30, 120, 140],
                [0.75, 220, 180,  80],
                [1.00, 200,  60,  60],
            ]);
            // Single-color overlays (also 0xAABBGGRR).
            const COL_BG         = 0xff050505;   // matches stage background
            const COL_UNWALKABLE = 0xff050505;
            const COL_WALKABLE   = 0xff20180e;   // = #0e1820 in BGR order
            const COL_OPEN       = 0xff826a2c;   // = #2c6a82
            const COL_CLOSED     = 0xff50351e;   // = #1e3550 (showCost=false)

            function draw() {
                const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w; canvas.height = h;
                }
                const m = worldToScreen();
                const cs = state.cellSize;
                const cellPx = cs * m.scale;

                ctx.fillStyle = '#050505';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                const a = state.astar;

                // gridU32 is a persistent surface — full repaint only when it
                // was just (re)allocated, the search was reset, or the color
                // mode toggled. Otherwise each step()'s transitions land in
                // a.dirty[] and we paint just those.
                const W = state.walkMask, ST = a.state, G = a.g;
                const U32 = state.gridU32;
                const ncells = state.ncols * state.nrows;
                const invScale = state.invCostScale;
                if (!state.gridU32Valid) {
                    for (let i = 0; i < ncells; i++) {
                        if (!W[i]) { U32[i] = COL_UNWALKABLE; continue; }
                        const s = ST[i];
                        if (s === 2)      U32[i] = state.showCost
                                                ? COST_PALETTE[Math.min(255, (G[i] * invScale) | 0)]
                                                : COL_CLOSED;
                        else if (s === 1) U32[i] = COL_OPEN;
                        else              U32[i] = COL_WALKABLE;
                    }
                    a.dirty.length = 0;
                    state.gridU32Valid = true;
                } else if (a.dirty.length) {
                    const d = a.dirty;
                    for (let k = 0; k < d.length; k++) {
                        const i = d[k];
                        if (!W[i]) { U32[i] = COL_UNWALKABLE; continue; }
                        const s = ST[i];
                        if (s === 2)      U32[i] = state.showCost
                                                ? COST_PALETTE[Math.min(255, (G[i] * invScale) | 0)]
                                                : COL_CLOSED;
                        else if (s === 1) U32[i] = COL_OPEN;
                        else              U32[i] = COL_WALKABLE;
                    }
                    d.length = 0;
                }
                state.gridCtx.putImageData(state.gridImg, 0, 0);
                const side = Math.min(canvas.width, canvas.height);
                const gx0 = m.ox - side * 0.5, gy0 = m.oy - side * 0.5;
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(state.gridCanvas,
                    0, 0, state.ncols, state.nrows,
                    gx0, gy0, side, side);

                // Gridlines — cell borders that the old fillRect(cellPx-1) gave
                // for free. One Path2D, one stroke, ~(ncols+nrows)*2 segments.
                const cellPxNow = side / state.ncols;
                if (cellPxNow >= 4) {
                    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    for (let i = 0; i <= state.ncols; i++) {
                        const px = (gx0 + i * cellPxNow) | 0;
                        ctx.moveTo(px + 0.5, gy0);
                        ctx.lineTo(px + 0.5, gy0 + side);
                    }
                    for (let j = 0; j <= state.nrows; j++) {
                        const py = (gy0 + j * cellPxNow) | 0;
                        ctx.moveTo(gx0,        py + 0.5);
                        ctx.lineTo(gx0 + side, py + 0.5);
                    }
                    ctx.stroke();
                }

                // Pass 2: parent arrows (optional). Each closed cell points to
                // its predecessor — shows how the search tree fans out.
                if (state.showParents) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    for (let cz = 0; cz < state.nrows; cz++) {
                        for (let cx = 0; cx < state.ncols; cx++) {
                            const idx = cx + cz * state.ncols;
                            if (a.state[idx] !== 2) continue;
                            const p = a.parent[idx];
                            if (p < 0 || p === idx) continue;
                            const pz = (p / state.ncols) | 0, px_ = p - pz * state.ncols;
                            const w1 = cellCenterWorld(cx, cz);
                            const w2 = cellCenterWorld(px_, pz);
                            const [ax, ay] = w2s(w1.x, w1.z, m);
                            const [bx, by] = w2s(w2.x, w2.z, m);
                            ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
                        }
                    }
                    ctx.stroke();
                }

                // Pass 3: obstacles outline (truth, pre-padding)
                ctx.strokeStyle = '#ff6b6b';
                ctx.lineWidth = 1;
                ctx.fillStyle = 'rgba(80,15,15,0.55)';
                for (const o of state.obstacles) {
                    const [px, py] = w2s(o.x - o.hw, o.z - o.hd, m);
                    const sw = o.hw * 2 * m.scale, sh = o.hd * 2 * m.scale;
                    ctx.fillRect(px, py, sw, sh);
                    ctx.strokeRect(px + 0.5, py + 0.5, sw - 1, sh - 1);
                }

                // Pass 4: current cell highlight
                if (a.current >= 0 && !a.done) {
                    const cz = (a.current / state.ncols) | 0;
                    const cx = a.current - cz * state.ncols;
                    const wc = cellCenterWorld(cx, cz);
                    const [px, py] = w2s(wc.x - cs * 0.5, wc.z - cs * 0.5, m);
                    ctx.strokeStyle = '#ffe066';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
                }

                // Pass 5: reconstructed path
                if (a.found && a.path.length >= 2) {
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    for (let i = 0; i < a.path.length; i++) {
                        const wc = cellCenterWorld(a.path[i].cx, a.path[i].cz);
                        const [px, py] = w2s(wc.x, wc.z, m);
                        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    }
                    ctx.stroke();
                }

                // Pass 6: endpoints
                drawDot(ctx, w2s(state.start.x, state.start.z, m), '#7bed9f', 'S');
                drawDot(ctx, w2s(state.goal.x,  state.goal.z,  m), '#ffa502', 'G');

                // Stats panel
                ctx.fillStyle = '#bbb';
                ctx.font = '11px monospace';
                const opens = a.openSet.size;
                const closed = a.countClosed();
                const lines = [
                    `steps:   ${a.steps}`,
                    `open:    ${opens}`,
                    `closed:  ${closed}`,
                    a.done ? (a.found ? `found path · waypoints ${a.path.length} · cost ${a.g[a.goal].toFixed(2)}`
                                      : `no path`)
                           : 'searching…',
                ];
                for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 10, 18 + i * 14);
            }

            function drawDot(ctx, [x, y], color, label) {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#000';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y);
                ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
            }

            function updateLegend() {
                legend.innerHTML =
                    `<span style="color:#7bed9f">●</span> start &nbsp; ` +
                    `<span style="color:#ffa502">●</span> goal<br>` +
                    `<span style="display:inline-block;width:10px;height:10px;background:#2c6a82;vertical-align:middle"></span> open set (frontier)<br>` +
                    `<span style="display:inline-block;width:10px;height:10px;background:linear-gradient(90deg,rgb(20,40,90),rgb(220,180,80),rgb(200,60,60));vertical-align:middle"></span> closed (by g-cost)<br>` +
                    `<span style="color:#ffe066">▢</span> current expansion<br>` +
                    `<span style="color:#fff">━</span> reconstructed path`;
            }

            function loop() {
                if (state.running && state.astar && !state.astar.done) {
                    for (let i = 0; i < state.stepsPerTick; i++) {
                        if (!state.astar.step()) break;
                    }
                    state.drawDirty = true;
                }
                // Catch CSS-driven canvas resizes (no resize event in this app).
                const cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
                if (cw !== state.lastCanvasW || ch !== state.lastCanvasH) {
                    state.lastCanvasW = cw; state.lastCanvasH = ch;
                    state.drawDirty = true;
                }
                if (state.drawDirty) {
                    state.drawDirty = false;
                    draw();
                }
                state.animFrame = requestAnimationFrame(loop);
            }

            // --- Input -----------------------------------------------------------
            function onClick(e) {
                const r = canvas.getBoundingClientRect();
                const sx = e.clientX - r.left, sy = e.clientY - r.top;
                if (canvas.width !== canvas.clientWidth) {
                    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
                }
                const wp = s2w(sx, sy, worldToScreen());
                if (wp.x < -WORLD_HALF || wp.x > WORLD_HALF ||
                    wp.z < -WORLD_HALF || wp.z > WORLD_HALF) return;
                if (e.shiftKey) state.goal  = wp;
                else            state.start = wp;
                resetSearch();
            }
            function onKey(e) {
                if (e.key === ' ') { state.running = !state.running; playBtn.classList.toggle('toggled', state.running); e.preventDefault(); }
                else if (e.key === 'n' || e.key === 'N') { if (state.astar) { state.astar.step(); markDraw(); } }
                else if (e.key === 'r' || e.key === 'R') {
                    state.seed = (state.seed + 1) | 0;
                    seedInput.value = state.seed;
                    rebuild();
                }
            }
            canvas.addEventListener('click', onClick);
            window.addEventListener('keydown', onKey);

            // --- Params ----------------------------------------------------------
            const seedInput = AVUI.mkNumber(params, 'seed', state.seed, 1, v => {
                state.seed = v | 0; rebuild();
            });
            AVUI.mkRange(params, 'cell', state.cellSize, 0.25, 1.5, 0.05, v => {
                state.cellSize = v; rebuild();
            }, v => v.toFixed(2));
            AVUI.mkRange(params, 'padding', state.padding, 0.0, 1.0, 0.05, v => {
                state.padding = v; rebuild();
            }, v => v.toFixed(2));
            AVUI.mkRange(params, 'obstacles', state.numObstacles, 0, 30, 1, v => {
                state.numObstacles = v | 0; rebuild();
            }, v => `${v|0}`);
            AVUI.mkSelect(params, 'heuristic', Object.keys(HEURISTICS), state.heuristic, v => {
                state.heuristic = v; resetSearch();
            });
            AVUI.mkRange(params, 'h weight', state.weight, 0.0, 3.0, 0.1, v => {
                state.weight = v; resetSearch();
            }, v => v.toFixed(1));
            AVUI.mkRange(params, 'speed', state.stepsPerTick, 1, 200, 1, v => {
                state.stepsPerTick = v | 0;
            }, v => `${v|0}/f`);

            const diagBtn = AVUI.mkButton(params, '8-neighbor', () => {
                state.diagonal = !state.diagonal;
                diagBtn.classList.toggle('toggled', state.diagonal);
                resetSearch();
            });
            diagBtn.classList.toggle('toggled', state.diagonal);

            const costBtn = AVUI.mkButton(params, 'cost color', () => {
                state.showCost = !state.showCost;
                costBtn.classList.toggle('toggled', state.showCost);
                invalidateGrid();
            });
            costBtn.classList.toggle('toggled', state.showCost);

            const parentBtn = AVUI.mkButton(params, 'parents', () => {
                state.showParents = !state.showParents;
                parentBtn.classList.toggle('toggled', state.showParents);
                markDraw();
            });

            const playBtn = AVUI.mkButton(params, 'Play', () => {
                state.running = !state.running;
                playBtn.classList.toggle('toggled', state.running);
            });
            AVUI.mkButton(params, 'Step', () => {
                state.running = false; playBtn.classList.remove('toggled');
                if (state.astar) { state.astar.step(); markDraw(); }
            });
            AVUI.mkButton(params, 'Finish', () => {
                state.running = false; playBtn.classList.remove('toggled');
                if (state.astar) { state.astar.runToCompletion(); markDraw(); }
            });
            AVUI.mkButton(params, 'Reset', () => {
                state.running = false; playBtn.classList.remove('toggled');
                resetSearch();
            });
            AVUI.mkButton(params, 'Randomize', () => {
                state.seed = (state.seed + 1) | 0;
                seedInput.value = state.seed; rebuild();
            });

            updateLegend();
            rebuild();
            state.running = true; playBtn.classList.add('toggled');
            loop();

            return { canvas, hint, legend, onClick, onKey, state };
        },

        destroy(handle) {
            if (handle.state && handle.state.animFrame) cancelAnimationFrame(handle.state.animFrame);
            if (handle.canvas) handle.canvas.removeEventListener('click', handle.onClick);
            window.removeEventListener('keydown', handle.onKey);
        },
    });

    // -- shared mini control helpers ------------------------------------------
    function mkRange(parent, label, value, min, max, step, onChange, fmt) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const input = document.createElement('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = fmt ? fmt(value) : value;
        input.oninput = () => {
            const v = parseFloat(input.value);
            num.textContent = fmt ? fmt(v) : v;
            onChange(v);
        };
        wrap.appendChild(input); wrap.appendChild(num);
        parent.appendChild(wrap);
        return input;
    }
    function mkNumber(parent, label, value, step, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const input = document.createElement('input');
        input.type = 'number'; input.value = value; input.step = step;
        input.style.width = '70px';
        input.onchange = () => onChange(parseFloat(input.value));
        wrap.appendChild(input); parent.appendChild(wrap);
        return input;
    }
    function mkSelect(parent, label, options, value, onChange) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        wrap.innerHTML = `<span class="lbl">${label}</span>`;
        const sel = document.createElement('select');
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        }
        sel.onchange = () => onChange(sel.value);
        wrap.appendChild(sel); parent.appendChild(wrap);
        return sel;
    }
    function mkButton(parent, label, onClick) {
        const b = document.createElement('button');
        b.className = 'opbtn'; b.textContent = label; b.onclick = onClick;
        parent.appendChild(b); return b;
    }

    AVUI = { mkRange, mkNumber, mkSelect, mkButton };
})();
