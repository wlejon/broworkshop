// Every visualisation mounts from the sidebar, draws, and tears down cleanly.
//   scripts/validate.sh tools/algo-viz

import { check, eq, test, done, frames, clickOn, q, shot, setValue, waitFor } from "/lib/kit/test.js";

frames(10);
const shell = globalThis.algoViz;
check(shell, 'main.js exposes the shell as globalThis.algoViz');
const ids = shell.VIZ.map((v) => v.id);
eq(ids, ['pathfinding', 'noise', 'terrain', 'isosurface'], 'registered visualisations');

const stage = q('#stage');
const sr = stage.getBoundingClientRect();
check(sr.width > 200 && sr.height > 200, 'stage too small: ' + sr.width + 'x' + sr.height);

/** True if a 5-point cross over `el` is not uniformly near-black. */
function drawn(el) {
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.width / 2) | 0, cy = (r.top + r.height / 2) | 0;
    const px = [[0, 0], [-80, 0], [80, 0], [0, -60], [0, 60]].map(([dx, dy]) => getPixel(cx + dx, cy + dy));
    if (px.some((p) => p.r + p.g + p.b > 60)) return true;
    return px.some((p) => Math.abs(p.r - px[0].r) + Math.abs(p.g - px[0].g) + Math.abs(p.b - px[0].b) > 8);
}

for (const id of ids) {
    test(id + ' mounts and draws', () => {
        clickOn(`.viz-item[data-id="${id}"]`);
        frames(25);
        eq(shell.current && shell.current.id, id, 'active viz');
        check(q(`.viz-item[data-id="${id}"]`).classList.contains('active'), 'sidebar row highlighted');
        eq(q('#title').textContent, shell.current.name, 'title');
        check(shell.handle, id + ' init returned a handle (status: ' + q('#status').textContent + ')');
        check(q('#params').children.length > 0, 'controls built');
        if (id === 'terrain') {
            // The model is not loaded in the smoke (test_terrain.js does it):
            // the view explains itself instead of drawing.
            const ph = q('#stage .av-placeholder');
            check(ph && ph.textContent.length > 0, 'terrain placeholder text');
            check(q('#status').textContent.length > 0, 'terrain status line');
        } else {
            const cv = q('#stage canvas');
            check(drawn(cv), id + ': canvas appears empty');
        }
        shot('shot_' + id);
    });
}

test('noise: a CPU type (worker tile) draws with visible structure', () => {
    clickOn('.viz-item[data-id="noise"]');
    frames(3);
    setValue(q('#params select'), 'Perlin');
    const h = globalThis.algoViz.handle;
    waitFor(() => h.cpu.ready, 'worker tile', 10000);
    frames(20);
    const r = q('#stage canvas').getBoundingClientRect();
    const y = (r.top + r.height / 2) | 0;
    const row = [];
    for (let x = r.left + 20; x < r.right - 20; x += 40) row.push(getPixel(x | 0, y));
    const lum = row.map((p) => p.r + p.g + p.b);
    check(Math.max(...lum) - Math.min(...lum) > 120, 'Perlin tile varies across the view: ' + lum.join(','));
    shot('noise-perlin');
});

test('switching back re-mounts from scratch', () => {
    clickOn('.viz-item[data-id="pathfinding"]');
    frames(5);
    eq(q('#stage').querySelectorAll('canvas').length, 1, 'one canvas after re-mount');
    eq(q('#stage').querySelectorAll('.av-legend').length, 1, 'one legend after re-mount');
});

done('algo-viz smoke');
