// Terrain diffusion viz end to end: load the checkpoint in the worker, read
// every stage, draw it, switch view and channel. Needs the weights + GPU (ml).

import { check, eq, test, done, frames, clickOn, q, waitFor, setValue, skip, needWeights, shot } from "/lib/kit/test.js";
import { STAGES, CHANNELS, WEIGHT_CANDIDATES } from "/app/viz/terrain.js";

if (!globalThis.bro || !bro.diffusion || typeof bro.diffusion.loadTerrain !== 'function') {
    skip('bro.diffusion.loadTerrain is not in this build');
}
const dir = needWeights('terrain-diffusion-30m-bro', WEIGHT_CANDIDATES, { probe: 'config.json' });

frames(5);
clickOn('.viz-item[data-id="terrain"]');
frames(5);
const h = globalThis.algoViz.handle;
eq(h.state.dir, dir, 'weights found by default');
const btn = (label) => [...q('#params').querySelectorAll('button')].find((b) => b.textContent === label);

test('Load generates every stage', () => {
    clickOn(btn('Load'));
    waitFor(() => /^ready/.test(q('#status').textContent) || q('#status').className === 'err',
        'terrain ready', 240000, 50);
    check(/^ready/.test(q('#status').textContent), 'status: ' + q('#status').textContent);
    for (const s of STAGES) {
        const r = h.state.results[s];
        check(r, s + ' read');
        eq(r.channels, CHANNELS[s].length, s + ' channel count');
        eq([r.width, r.height], [96, 96], s + ' extent');
        check(r.data.length === r.channels * 96 * 96, s + ' data size');
        check(r.data.every((v) => Number.isFinite(v)), s + ' finite');
    }
    const elev = h.state.results.elevation.data;
    let lo = Infinity, hi = -Infinity;
    for (const v of elev) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    check(hi - lo > 10, 'elevation has relief: ' + lo + '..' + hi);
    check(/elevation\.elevation .* m\n/.test(q('.av-overlay').textContent), 'overlay: ' + q('.av-overlay').textContent);
    check(q('.av-placeholder').style.display === 'none', 'placeholder hidden');
    shot('terrain-elevation');
});

test('view + channel select', () => {
    clickOn('.av-stagecell[data-stage="coarse"]');
    frames(2);
    eq(h.state.view, 'coarse', 'thumbnail click selects the stage');
    const chan = q('#params').querySelectorAll('select')[1];
    eq(chan.options.length, 6, 'coarse channels listed');
    setValue(chan, '2');
    frames(2);
    eq(h.state.channel, 2, 'channel');
    check(/coarse\.temperature/.test(q('.av-overlay').textContent), 'overlay names the channel');
    check(/\d m\/cell/.test(q('.av-overlay').textContent), 'cell size shown');
    shot('terrain-coarse');
});

done('terrain');
