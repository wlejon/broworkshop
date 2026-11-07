// Mars: boots and refines from orbit to the ground, its craters give back
// what their bowls take (zero-mean, so craters too small for a cell average
// to nothing in it), and a coarse cell holds the mean of the cells three
// octaves finer covering it (refine, never replace).
//   Run: scripts/validate.sh demos/planet/worlds/mars/tests/test_mars.js
import { check, frames, test, done, tier } from "/lib/kit/test.js";
import { readApp } from "/app/core/shaders.js";
import { applyPlanetView, settlePlanetView } from "/app/core/views.js";

const RADIUS = 3389500, SEED = 11, BASE_WAVELENGTH = 2097152;
const modules = { 'planet::anchor': readApp('core/anchor.bk'), 'planet::layers': readApp('core/layers.bk'),
                  'planet::noise': readApp('core/noise.bk'), tiles: bro.tiles.module, ...planet.world.modules };
const mod = bro.kernel.compile(readApp('worlds/mars/tests/measure.bk'), { file: 'measure.bk', modules });
const kCell = mod.kernel('k_cell');
const kVolume = mod.kernel('k_volume');

let seed = 4242;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

test('Mars boots, settles from orbit and refines to the ground', () => {
    check(planet.world.name === 'mars', `the world is ${planet.world.name}`);
    for (const name of ['orbit', 'rover']) {
        const v = planet.world.views.find((x) => x.name === name);
        applyPlanetView(v);
        const s = settlePlanetView(v, { settleFrames: 900 });
        check(s.settled && planet.cache.pending === 0, `${name} settles (${planet.cache.pending} pending)`);
        const deepest = Math.max(...planet.cache.drawn.map((t) => t.level));
        check(name === 'orbit' ? deepest <= 6 : deepest >= 18, `${name}: deepest level ${deepest}`);
    }
    frames(2);
});

test("a crater's rim and ejecta give back what its bowl takes", () => {
    for (const [diameter, worn] of [[30, 0], [800, 0.3], [9000, 0], [40000, 0.6], [150000, 0.2]]) {
        const all = kVolume.run(1, diameter, worn, 0)[0];
        const bowl = kVolume.run(1, diameter, worn, 1)[0];
        check(Math.abs(all) < 0.01 * Math.abs(bowl),
              `${diameter} m crater, worn ${worn}: volume ${all.toFixed(4)} of the bowl's ${bowl.toFixed(3)} (R^2 m)`);
    }
});

// A coarse cell against the mean of the 8 x 8 cells three octaves finer.
for (const coarse of [3.5, 6.5, 9.5, 12.5]) {
    test(`a ${coarse}-octave cell is the mean of the cells three octaves finer`, () => {
        const a = BASE_WAVELENGTH / (2.5 * 2 ** coarse) / RADIUS;
        let bias = 0, sq = 0, spread = 0;
        const n = tier(10, 30);
        for (let k = 0; k < n; k++) {
            const dir = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
            const t0 = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]);
            const b0 = [dir[1] * t0[2] - dir[2] * t0[1], dir[2] * t0[0] - dir[0] * t0[2], dir[0] * t0[1] - dir[1] * t0[0]];
            const t = t0.map((x) => x * a), b = b0.map((x) => x * a);
            const run = (m, size, oct) => kCell.run(1, ...dir, ...t, ...b, m, size, RADIUS, oct, SEED)[0];
            const fine = run(8, 1 / 8, coarse + 3);
            const c = run(1, 1, coarse);
            // How much the ground varies across the cell: its fine cells'
            // spread from their mean, the scale the error is judged by.
            const corners = [run(1, 1, coarse + 3)];
            for (const [s, q] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
                corners.push(kCell.run(1, dir[0] + t[0] * s + b[0] * q, dir[1] + t[1] * s + b[1] * q, dir[2] + t[2] * s + b[2] * q,
                                       ...t.map((x) => x / 8), ...b.map((x) => x / 8), 1, 1, RADIUS, coarse + 3, SEED)[0]);
            }
            spread += Math.sqrt(corners.reduce((s2, h) => s2 + (h - fine) ** 2, 0) / corners.length) / n;
            bias += (fine - c) / n;
            sq += (fine - c) ** 2 / n;
        }
        const rms = Math.sqrt(sq);
        console.log(`octaves ${coarse} -> ${coarse + 3}: bias ${bias.toFixed(1)} m, rms ${rms.toFixed(1)} m, the cell's relief ${spread.toFixed(1)} m`);
        check(Math.abs(bias) < 0.1 * spread + 2, `no systematic shift: bias ${bias.toFixed(1)} m against ${spread.toFixed(1)} m of relief`);
        check(rms < 0.5 * spread + 5, `the coarse cell holds its fine cells' mean: rms ${rms.toFixed(1)} m against ${spread.toFixed(1)} m`);
    });
}

done('mars');
