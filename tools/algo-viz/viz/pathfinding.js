// A* pathfinding, stepwise. The point is to show how A* works: the open set
// (frontier), the closed set (visited), the running g-cost, the heuristic,
// and how f = g + h balances them.
//
// Walkability comes from the C++ NavGrid (bro.ai.game.createNavGrid), with
// obstacle padding applied natively. A* itself runs in JS (pathfinding/
// astar.js) so every expansion is visible.

import { h } from "/lib/kit/dom.js";
import { readout } from "/lib/kit/ui.js";
import { register } from "./registry.js";
import { controls, button, toggle, lifetime } from "./ui.js";
import { AStar, HEURISTICS, CLOSED, OPEN, packedPalette, mulberry32 } from "./pathfinding/astar.js";

const WORLD_HALF = 20;

// g-cost ramp for closed cells + flat colours, all packed 0xAABBGGRR.
const COST_PALETTE = packedPalette([
    [0.00, 20, 40, 90], [0.40, 30, 120, 140], [0.75, 220, 180, 80], [1.00, 200, 60, 60],
]);
const COL_UNWALKABLE = 0xff050505;
const COL_WALKABLE = 0xff20180e;   // #0e1820
const COL_OPEN = 0xff826a2c;       // #2c6a82
const COL_CLOSED = 0xff50351e;     // #1e3550 (cost colour off)

function createObstacles(n, rng) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const hw = 0.8 + rng() * 2.0, hd = 0.8 + rng() * 2.0;
        out.push({
            x: (rng() * 2 - 1) * (WORLD_HALF - hw - 1),
            z: (rng() * 2 - 1) * (WORLD_HALF - hd - 1),
            hw, hd,
        });
    }
    return out;
}

register({
    id: 'pathfinding',
    name: 'A* Pathfinding',
    category: 'Path & Navigation',
    subtitle: 'A* step by step: open set (frontier), closed set (visited), g-cost gradient, and the reconstructed path. Click to set the start, shift-click to set the goal.',

    init({ stage, params }) {
        const life = lifetime();
        const canvas = h('canvas.av-crosshair');
        stage.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        const statsHud = h('div.k-hud.av-stats');
        const legend = h('div.k-hud.right.av-legend', null,
            h('div', null, h('span', { style: 'color:#7bed9f' }, '●'), ' start  ',
                           h('span', { style: 'color:#ffa502' }, '●'), ' goal'),
            h('div', null, h('span.av-swatch', { style: 'background:#2c6a82' }), ' open set (frontier)'),
            h('div', null, h('span.av-swatch.av-cost'), ' closed (by g-cost)'),
            h('div', null, h('span', { style: 'color:#ffe066' }, '▢'), ' current expansion'),
            h('div', null, h('span', { style: 'color:#fff' }, '━'), ' reconstructed path'));
        const hint = h('div.av-hint', null, 'click: start · shift-click: goal · space: play/pause · n: step · r: randomize');
        stage.append(statsHud, legend, hint);
        const stats = readout(statsHud, { steps: 'steps', open: 'open', closed: 'closed', result: 'result' });

        const state = {
            seed: 1, cell: 0.5, padding: 0.4, obstacles: 12,
            heuristic: 'diagonal', weight: 1.0, speed: 4,
            diagonal: true, showCost: true, showParents: false, running: false,
            start: { x: -16, z: -16 }, goal: { x: 16, z: 16 },
        };
        const grid = { ncols: 0, nrows: 0, walk: null, boxes: [], astar: null, invCostScale: 1 };
        const paint = { canvas: null, ctx: null, img: null, u32: null, valid: false };
        let drawDirty = true, lastW = 0, lastH = 0;

        const cellCenter = (cx, cz) => ({
            x: -WORLD_HALF + (cx + 0.5) * state.cell, z: -WORLD_HALF + (cz + 0.5) * state.cell,
        });
        const toCell = (v, n) => Math.max(0, Math.min(n - 1, Math.floor((v + WORLD_HALF) / state.cell)));

        function rebuild() {
            grid.boxes = createObstacles(state.obstacles, mulberry32(state.seed));
            const nav = bro.ai.game.createNavGrid({
                minX: -WORLD_HALF, minZ: -WORLD_HALF, maxX: WORLD_HALF, maxZ: WORLD_HALF,
                cellSize: state.cell, obstacles: grid.boxes, padding: state.padding,
            });
            grid.ncols = grid.nrows = Math.round(2 * WORLD_HALF / state.cell);
            const n = grid.ncols * grid.nrows;
            grid.walk = new Uint8Array(n);
            for (let cz = 0; cz < grid.nrows; cz++) {
                for (let cx = 0; cx < grid.ncols; cx++) {
                    const c = cellCenter(cx, cz);
                    grid.walk[cx + cz * grid.ncols] = nav.isWalkable(c.x, c.z) ? 1 : 0;
                }
            }
            // One pixel per cell, scaled up nearest-neighbour: one putImageData
            // + drawImage instead of thousands of fillRects.
            if (!paint.canvas || paint.canvas.width !== grid.ncols) {
                paint.canvas = document.createElement('canvas');
                paint.canvas.width = grid.ncols; paint.canvas.height = grid.nrows;
                paint.ctx = paint.canvas.getContext('2d');
                paint.img = paint.ctx.createImageData(grid.ncols, grid.nrows);
                paint.u32 = new Uint32Array(paint.img.data.buffer);
            }
            resetSearch();
        }

        function resetSearch() {
            const a = grid.astar = new AStar({
                ncols: grid.ncols, nrows: grid.nrows, walk: grid.walk,
                diagonal: state.diagonal, heur: HEURISTICS[state.heuristic], weight: state.weight,
            });
            const sx = toCell(state.start.x, grid.ncols), sz = toCell(state.start.z, grid.nrows);
            const gx = toCell(state.goal.x, grid.ncols), gz = toCell(state.goal.z, grid.nrows);
            a.reset(sx, sz, gx, gz);
            // A fixed cost -> palette scale, so a closed cell is painted once
            // when it closes, with headroom beyond the straight-line distance.
            grid.invCostScale = 255 / Math.max(1, HEURISTICS.diagonal(sx, sz, gx, gz) * 1.5);
            paint.valid = false;
            drawDirty = true;
        }

        function cellColor(i) {
            if (!grid.walk[i]) return COL_UNWALKABLE;
            const s = grid.astar.state[i];
            if (s === CLOSED) {
                return state.showCost
                    ? COST_PALETTE[Math.min(255, (grid.astar.g[i] * grid.invCostScale) | 0)]
                    : COL_CLOSED;
            }
            return s === OPEN ? COL_OPEN : COL_WALKABLE;
        }

        function view() {
            const w = canvas.width, hh = canvas.height, side = Math.min(w, hh);
            return { side, scale: side / (2 * WORLD_HALF), ox: w / 2, oy: hh / 2 };
        }
        const w2s = (x, z, m) => [m.ox + x * m.scale, m.oy + z * m.scale];

        function draw() {
            const w = canvas.clientWidth | 0, hh = canvas.clientHeight | 0;
            if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
            const m = view(), a = grid.astar;
            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, w, hh);

            // Cells: full repaint after a reset, else only what changed.
            const u32 = paint.u32;
            if (!paint.valid) {
                for (let i = 0; i < u32.length; i++) u32[i] = cellColor(i);
                paint.valid = true;
            } else {
                for (const i of a.dirty) u32[i] = cellColor(i);
            }
            a.dirty.length = 0;
            paint.ctx.putImageData(paint.img, 0, 0);
            const gx0 = m.ox - m.side / 2, gy0 = m.oy - m.side / 2;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(paint.canvas, 0, 0, grid.ncols, grid.nrows, gx0, gy0, m.side, m.side);

            const cellPx = m.side / grid.ncols;
            if (cellPx >= 4) {
                ctx.strokeStyle = 'rgba(0,0,0,0.55)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 0; i <= grid.ncols; i++) {
                    const p = ((gx0 + i * cellPx) | 0) + 0.5;
                    ctx.moveTo(p, gy0); ctx.lineTo(p, gy0 + m.side);
                }
                for (let j = 0; j <= grid.nrows; j++) {
                    const p = ((gy0 + j * cellPx) | 0) + 0.5;
                    ctx.moveTo(gx0, p); ctx.lineTo(gx0 + m.side, p);
                }
                ctx.stroke();
            }

            if (state.showParents) {
                // Each closed cell points at its predecessor: the search tree.
                ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (let i = 0; i < a.state.length; i++) {
                    const p = a.parent[i];
                    if (a.state[i] !== CLOSED || p < 0) continue;
                    const cz = (i / grid.ncols) | 0, pz = (p / grid.ncols) | 0;
                    const c0 = cellCenter(i - cz * grid.ncols, cz), c1 = cellCenter(p - pz * grid.ncols, pz);
                    const [ax, ay] = w2s(c0.x, c0.z, m), [bx, by] = w2s(c1.x, c1.z, m);
                    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
                }
                ctx.stroke();
            }

            // Obstacles as authored (before the NavGrid's padding).
            ctx.strokeStyle = '#ff6b6b';
            ctx.fillStyle = 'rgba(80,15,15,0.55)';
            ctx.lineWidth = 1;
            for (const o of grid.boxes) {
                const [px, py] = w2s(o.x - o.hw, o.z - o.hd, m);
                const sw = o.hw * 2 * m.scale, sh = o.hd * 2 * m.scale;
                ctx.fillRect(px, py, sw, sh);
                ctx.strokeRect(px + 0.5, py + 0.5, sw - 1, sh - 1);
            }

            if (a.current >= 0 && !a.done) {
                const cz = (a.current / grid.ncols) | 0;
                const c = cellCenter(a.current - cz * grid.ncols, cz);
                const [px, py] = w2s(c.x - state.cell / 2, c.z - state.cell / 2, m);
                ctx.strokeStyle = '#ffe066';
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
            }

            if (a.found && a.path.length >= 2) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                a.path.forEach((p, i) => {
                    const c = cellCenter(p.cx, p.cz);
                    const [px, py] = w2s(c.x, c.z, m);
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                });
                ctx.stroke();
            }

            dot(w2s(state.start.x, state.start.z, m), '#7bed9f', 'S');
            dot(w2s(state.goal.x, state.goal.z, m), '#ffa502', 'G');

            stats.set({ steps: a.steps, open: a.openCount, closed: a.closedCount });
            stats.set('result', !a.done ? 'searching…'
                : a.found ? 'path · ' + a.path.length + ' cells · cost ' + a.cost.toFixed(2) : 'no path',
                a.done && a.found);
        }

        function dot([x, y], color, label) {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(label, x, y);
            ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        }

        life.loop(() => {
            const a = grid.astar;
            if (state.running && !a.done) {
                for (let i = 0; i < state.speed && a.step(); i++) { /* expand */ }
                drawDirty = true;
            }
            const cw = canvas.clientWidth | 0, ch = canvas.clientHeight | 0;
            if (cw !== lastW || ch !== lastH) { lastW = cw; lastH = ch; drawDirty = true; }
            if (drawDirty) { drawDirty = false; draw(); }
        });

        // --- input -------------------------------------------------------------
        canvas.addEventListener('click', (e) => {
            const r = canvas.getBoundingClientRect(), m = view();
            const x = (e.clientX - r.left - m.ox) / m.scale, z = (e.clientY - r.top - m.oy) / m.scale;
            if (Math.abs(x) > WORLD_HALF || Math.abs(z) > WORLD_HALF) return;
            state[e.shiftKey ? 'goal' : 'start'] = { x, z };
            resetSearch();
        });
        life.listen(window, 'keydown', (e) => {
            const t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
            if (e.key === ' ') { setRunning(!state.running); e.preventDefault(); }
            else if (e.key === 'n' || e.key === 'N') step();
            else if (e.key === 'r' || e.key === 'R') randomize();
        });

        // --- params ------------------------------------------------------------
        const panel = controls(params, state, {
            seed:      { type: 'number', step: 1 },
            cell:      { min: 0.25, max: 1.5, step: 0.05 },
            padding:   { min: 0, max: 1, step: 0.05 },
            obstacles: { min: 0, max: 30, step: 1 },
            heuristic: { options: Object.keys(HEURISTICS) },
            weight:    { min: 0, max: 3, step: 0.1, label: 'h weight' },
            speed:     { min: 1, max: 200, step: 1, fmt: (v) => (v | 0) + '/f' },
        }, (key) => {
            if (key === 'seed') state.seed |= 0;
            if (key === 'seed' || key === 'cell' || key === 'padding' || key === 'obstacles') rebuild();
            else if (key === 'heuristic' || key === 'weight') resetSearch();
        });
        toggle(params, '8-neighbor', state.diagonal, (on) => { state.diagonal = on; resetSearch(); });
        toggle(params, 'cost color', state.showCost, (on) => { state.showCost = on; paint.valid = false; drawDirty = true; });
        toggle(params, 'parents', state.showParents, (on) => { state.showParents = on; drawDirty = true; });
        const playBtn = toggle(params, 'Play', false, (on) => setRunning(on));
        button(params, 'Step', step);
        button(params, 'Finish', () => { setRunning(false); grid.astar.runToCompletion(); drawDirty = true; });
        button(params, 'Reset', () => { setRunning(false); resetSearch(); });
        button(params, 'Randomize', randomize);

        function setRunning(on) { state.running = on; playBtn.on = on; }
        function step() { setRunning(false); grid.astar.step(); drawDirty = true; }
        function randomize() { panel.set('seed', (state.seed + 1) | 0); }

        rebuild();
        setRunning(true);
        return { life, state, grid };
    },

    destroy(handle) { handle.life.dispose(); },
});
