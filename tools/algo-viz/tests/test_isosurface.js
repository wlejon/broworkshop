// Isosurface: slice analysis, the dual-vertex solve, the sweep state machine
// run to completion, and the viz's controls.

import { check, eq, near, test, done, frames, clickOn, q, setValue, shot } from "/lib/kit/test.js";
import { buildField, analyseSlice, solveVertex, MSQ_TABLE, cssToRgb } from "/app/viz/isosurface/field.js";
import { Sweep, FILL_ALPHA } from "/app/viz/isosurface/sweep.js";
import { buildWireGeometry } from "/app/viz/isosurface/wire.js";

const N = 16;

test('sphere slice: active cells ring the contour', () => {
    const f = buildField('sphere', N, 1);
    const s = analyseSlice(f, N, (N - 1) >> 1, 0);
    check(s.order.length > 8, 'active cells: ' + s.order.length);
    for (const ci of s.order) {
        const code = s.cases[ci];
        check(code !== 0 && code !== 15, 'active cell is mixed');
        eq(s.cellPts[ci].length / 5, MSQ_TABLE[code].length === 4 ? 4 : 2, 'crossings match the case');
    }
    const top = analyseSlice(f, N, 0, 0);
    eq(top.order.length, 0, 'the cap slice is outside the sphere');
});

test('QEF puts the dual vertex on the corner of two tangent lines', () => {
    // Crossings on a vertical line x = 0.8 and a horizontal line y = 0.3.
    const pts = [0.8, 0, 1, 0, 0, 0.8, 1, 1, 0, 0, 0, 0.3, 0, 1, 3, 1, 0.3, 0, 1, 1];
    const v = solveVertex('dualContour', pts);
    near(v.u, 0.8, 1e-6, 'u');
    near(v.v, 0.3, 1e-6, 'v');
    const c = solveVertex('surfaceNets', pts);
    near(c.u, 0.65, 1e-6, 'centroid u');
});

test('colour parsing', () => {
    const [r, g, b] = cssToRgb('hsl(0, 100%, 50%)');
    near(r, 1, 1e-6); near(g, 0, 1e-6); near(b, 0, 1e-6);
    eq(cssToRgb('#0080ff').map((x) => Math.round(x * 255)), [0, 128, 255], 'hex');
});

for (const algo of ['marchingCubes', 'surfaceNets', 'dualContour']) {
    test(algo + ': sweep runs to a filled mesh', () => {
        const events = { ghost: [], slices: 0, stopped: false };
        const sw = new Sweep({
            ghost: (a) => events.ghost.push(a),
            slice: () => { events.slices++; },
            playing: (on) => { if (!on) events.stopped = true; },
        });
        sw.algo = algo;
        sw.setField(buildField('sphere', N, 1), N, 0, 0.7);
        sw.reset();
        sw.speedExp = 1;                    // 50x once ramped
        sw.rampMs = 1;
        let guard = 0;
        while (sw.playing && guard++ < 200000) sw.tick(16);
        check(!sw.playing && events.stopped, 'animation ended (' + guard + ' ticks)');
        check(sw.finished, 'reached the fill');
        eq(sw.ghostAlpha, FILL_ALPHA, 'ghost filled');
        check(events.slices > 3, 'swept several slices');
        check(sw.segments3D.length > 50, 'wire segments: ' + sw.segments3D.length);
        const z = new Set(sw.segments3D.map((g) => g.z0));
        check(z.size > 3, 'segments span several z');
        check(sw.segments3D.some((g) => g.z0 !== g.z1), 'stitch connectors between slices');
        const geom = buildWireGeometry(sw.segments3D, 0.05);
        eq(geom.positions.length, sw.segments3D.length * 24, 'eight corners per segment');
        eq(geom.colors.length, sw.segments3D.length * 32, 'per-vertex colours');
    });
}

test('step, skip and finish on one slice', () => {
    const sw = new Sweep();
    sw.setField(buildField('torus', N, 1), N, 0, 0.7);
    sw.reset();
    sw.setSlice((N - 1) >> 1);
    const total = sw.cellOrder.length;
    check(total > 0, 'torus slice has active cells');
    sw.step();
    check(!sw.playing, 'step pauses');
    eq(sw.phaseIdx, 1, 'one micro-step');
    sw.skip();
    eq(sw.cellStep, 1, 'skip finishes the cell');
    eq(sw.emittedMC.length, 1, 'one cell emitted');
    sw.finish();
    check(sw.sweptSlice, 'finish sweeps the slice');
    eq(sw.emittedMC.length, total, 'every active cell emitted');
});

test('viz: controls rebuild and the sweep advances', () => {
    clickOn('.viz-item[data-id="isosurface"]');
    frames(20);
    const h = globalThis.algoViz.handle;
    check(h.sweep.playing, 'plays on mount');
    check(h.ghost, 'ghost mesh built');
    check(h.triCount > 0, 'tris: ' + h.triCount);
    const sel = [...q('#params').querySelectorAll('select')];
    setValue(sel[0], 'dualContour');
    frames(2);
    eq(h.sweep.algo, 'dualContour', 'algo switched');
    setValue(sel[1], 'sphere');
    frames(2);
    eq(h.state.field, 'sphere', 'field switched');
    const btn = (label) => [...q('#stage').querySelectorAll('button')].find((b) => b.textContent === label);
    clickOn(btn('Finish'));
    frames(2);
    check(!h.sweep.playing, 'finish pauses');
    check(/slice/.test(q('.av-badge').textContent) || h.sweep.cellOrder.length === 0, 'badge: ' + q('.av-badge').textContent);
    clickOn(btn('Reset'));
    frames(30);
    check(h.sweep.playing, 'reset plays');
    shot('isosurface-dc');
});

done('isosurface');
