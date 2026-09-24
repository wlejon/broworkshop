// A* correctness on hand-built grids, and the pathfinding viz's controls.

import { check, eq, near, test, done, frames, clickOn, q } from "/lib/kit/test.js";
import { AStar, HEURISTICS, mulberry32, packedPalette } from "/app/viz/pathfinding/astar.js";

/** A grid from rows of '.' (walkable) and '#' (blocked). */
function grid(rows) {
    const nrows = rows.length, ncols = rows[0].length;
    const walk = new Uint8Array(ncols * nrows);
    rows.forEach((r, z) => { for (let x = 0; x < ncols; x++) walk[x + z * ncols] = r[x] === '.' ? 1 : 0; });
    return { ncols, nrows, walk };
}

function solve(g, opts, s, e) {
    const a = new AStar(Object.assign({}, g, opts));
    a.reset(s[0], s[1], e[0], e[1]);
    a.runToCompletion();
    return a;
}

test('straight corridor, 4-neighbour', () => {
    const a = solve(grid(['......']), { diagonal: false, heur: HEURISTICS.manhattan }, [0, 0], [5, 0]);
    check(a.found, 'found');
    eq(a.path.length, 6, 'path cells');
    near(a.cost, 5, 1e-9, 'cost');
});

test('diagonal moves cost sqrt(2) and octile is admissible', () => {
    const g = grid(['.....', '.....', '.....', '.....', '.....']);
    const a = solve(g, { diagonal: true, heur: HEURISTICS.diagonal }, [0, 0], [4, 4]);
    near(a.cost, 4 * Math.SQRT2, 1e-9, 'octile cost');
    const d = solve(g, { diagonal: true, heur: HEURISTICS.dijkstra }, [0, 0], [4, 4]);
    near(d.cost, a.cost, 1e-9, 'dijkstra agrees');
    check(d.closedCount >= a.closedCount, 'dijkstra expands at least as much as A*');
});

test('wall forces a detour; no corner cutting', () => {
    const g = grid([
        '.#...',
        '.#.#.',
        '...#.',
    ]);
    const a = solve(g, { diagonal: true, heur: HEURISTICS.diagonal }, [0, 0], [4, 0]);
    check(a.found, 'found');
    for (let i = 1; i < a.path.length; i++) {
        const p = a.path[i - 1], c = a.path[i];
        const dx = c.cx - p.cx, dz = c.cz - p.cz;
        check(g.walk[c.cx + c.cz * g.ncols], 'path stays on walkable cells');
        if (dx && dz) {
            check(g.walk[p.cx + dx + p.cz * g.ncols] && g.walk[p.cx + (p.cz + dz) * g.ncols], 'diagonal cut a corner');
        }
    }
});

test('enclosed goal: no path, search terminates', () => {
    const a = solve(grid(['..#..', '..#..', '..#..']), { diagonal: true, heur: HEURISTICS.euclidean }, [0, 0], [4, 2]);
    check(a.done && !a.found, 'no path');
    eq(a.cost, Infinity, 'cost');
});

test('blocked start is done immediately', () => {
    const a = solve(grid(['#...']), { heur: HEURISTICS.manhattan }, [0, 0], [3, 0]);
    check(a.done && !a.found && a.steps === 0, 'nothing expanded');
});

test('helpers: deterministic PRNG, packed palette', () => {
    const r1 = mulberry32(7), r2 = mulberry32(7);
    for (let i = 0; i < 5; i++) eq(r1(), r2(), 'same sequence');
    const pal = packedPalette([[0, 255, 0, 0], [1, 0, 0, 255]]);
    eq(pal[0] >>> 0, 0xff0000ff, 'first entry red, 0xAABBGGRR');
    eq(pal[255] >>> 0, 0xffff0000, 'last entry blue');
});

test('viz: Finish solves the default map, Randomize reseeds', () => {
    clickOn('.viz-item[data-id="pathfinding"]');
    frames(3);
    const h = globalThis.algoViz.handle;
    const finish = [...q('#params').querySelectorAll('button')].find((b) => b.textContent === 'Finish');
    clickOn(finish);
    frames(2);
    check(h.grid.astar.done, 'search done');
    check(h.grid.astar.found, 'default map has a path');
    check(/path/.test(q('.av-stats').textContent), 'result readout: ' + q('.av-stats').textContent);
    const seed = h.state.seed;
    const rand = [...q('#params').querySelectorAll('button')].find((b) => b.textContent === 'Randomize');
    clickOn(rand);
    frames(2);
    eq(h.state.seed, seed + 1, 'seed advanced');
    eq(h.grid.astar.steps, 0, 'search restarted');
});

done('pathfinding');
