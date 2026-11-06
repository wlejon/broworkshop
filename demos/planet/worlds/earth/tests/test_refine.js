// Planet — refine, never replace, measured on the height function itself.
// A coarse tile's cell must hold what the finer cells covering it average
// to: what is represented must not shift with elevation. For patches over
// the whole planet, each coarse cell (as k_tile computes it, through k_cell)
// is compared with the mean of the 8 x 8 cells three octaves finer that
// cover it. The bias (a systematic shift) must be near zero; the spread is
// the detail the finer cells add, zero-mean, and must stay small.
//   Run: scripts/validate.sh demos/planet/worlds/earth/tests/test_refine.js
import { check, test, done, tier } from "/lib/kit/test.js";
import { readApp as readAppPath, sourcePath } from "/app/core/shaders.js";

const fs = require('fs');
// A file by its path from the app's folder, or a .bk file's name alone (the
// core's or Earth's: core/shaders.js sourcePath).
const readApp = (path) => readAppPath(sourcePath(path));
const mod = bro.kernel.compile(readApp('worlds/earth/tests/measure.bk'),
                               { file: 'measure.bk', modules: { 'planet::ground': readApp('ground.bk'), 'planet::relief': readApp('relief.bk'), 'planet::rivers': readApp('rivers.bk'),
                                                                'planet::anchor': readApp('anchor.bk'), 'planet::climate': readApp('climate.bk'), 'planet::dendry': readApp('dendry.bk'), tiles: bro.tiles.module } });
// The drainage network the app built (rivers.js), which the ground carves.
const NET = planet.rivers.cpu;
const kCell = mod.kernel('k_cell');
const kCellColor = mod.kernel('k_cell_color');
const RADIUS = 6371000, SEED = 7, BASE_WAVELENGTH = 2400000;

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

const gndBuf = new Float64Array(7);
const colBuf = new Float64Array(4);

// A cell `size` (in units of `a`) about (s, t) of the frame (dir; t, b).
const cell = (dir, t, b, s, tt, size, octaves) =>
    kCell.run(1, dir[0] + t[0] * s + b[0] * tt, dir[1] + t[1] * s + b[1] * tt, dir[2] + t[2] * s + b[2] * tt,
               t[0], t[1], t[2], b[0], b[1], b[2], 1, size, RADIUS, octaves, SEED, NET, gndBuf)[0];

function patch(dir, coarse) {
    // The frame: tangent axes scaled to one coarse cell, so the coarse cell
    // spans (s, t) in [-0.5, 0.5]^2.
    const a = BASE_WAVELENGTH / (2.5 * Math.pow(2, coarse)) / RADIUS;
    const t0 = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]);
    const b0 = [dir[1] * t0[2] - dir[2] * t0[1], dir[2] * t0[0] - dir[0] * t0[2], dir[0] * t0[1] - dir[1] * t0[0]];
    const t = t0.map((x) => x * a), b = b0.map((x) => x * a);
    const fine = kCell.run(1, dir[0], dir[1], dir[2], t[0], t[1], t[2], b[0], b[1], b[2], 8, 1 / 8, RADIUS, coarse + 3, SEED, NET, gndBuf)[0];
    const c = kCell.run(1, dir[0], dir[1], dir[2], t[0], t[1], t[2], b[0], b[1], b[2], 1, 1, RADIUS, coarse, SEED, NET, gndBuf)[0];
    return { fine, coarse: c };
}

for (const coarse of [1.5, 3.5, 6.5, 9.5]) {
    test(`a ${coarse}-octave cell is the average of the cells three octaves finer`, () => {
        let bias = 0, sq = 0, range = 0;
        const n = tier(12, 40);
        for (let k = 0; k < n; k++) {
            const p = patch(norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]), coarse);
            bias += p.fine - p.coarse;
            sq += (p.fine - p.coarse) ** 2;
            range = Math.max(range, Math.abs(p.coarse));
        }
        bias /= n;
        const rms = Math.sqrt(sq / n);
        console.log(`octaves ${coarse} -> ${coarse + 3}: bias ${bias.toFixed(1)} m, rms ${rms.toFixed(1)} m, highest ${range.toFixed(0)} m`);
        check(Math.abs(bias) < 0.02 * range, `no systematic shift: bias ${bias.toFixed(1)} m of ${range.toFixed(0)} m`);
        check(rms < 0.08 * range, `the shift stays small: rms ${rms.toFixed(1)} m of ${range.toFixed(0)} m`);
    });
}

// The colour refines too: a coarse cell's colour (luminance, and how much
// is water) against the mean of the 4 x 4 cells two octaves finer covering
// it. The colour of a cell's mean height shifts as cells shrink (peaks turn
// to snow, coasts to sea); the mean colour of the truth under it must not.
// The naive colour is measured the same way, to show what is gained.
const TRUTH = Math.log2(BASE_WAVELENGTH / (2.5 * RADIUS * Math.PI / 2 / 2 ** 22 / 32));
function evalCellColors(cx, cy, cz, t, b, size, octaves) {
    kCell.run(1, cx, cy, cz, t[0], t[1], t[2], b[0], b[1], b[2], 0, size, RADIUS, octaves, SEED, NET, gndBuf);
    kCellColor.run(1, cx, cy, cz, t[0], t[1], t[2], b[0], b[1], b[2], size, RADIUS, octaves, TRUTH, SEED, 0, 0, gndBuf, colBuf);
    return [colBuf[0], colBuf[1], colBuf[2], colBuf[3]];
}

function colorPatch4(dir, coarse) {
    const a = BASE_WAVELENGTH / (2.5 * Math.pow(2, coarse)) / RADIUS;
    const t0 = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]);
    const b0 = [dir[1] * t0[2] - dir[2] * t0[1], dir[2] * t0[0] - dir[0] * t0[2], dir[0] * t0[1] - dir[1] * t0[0]];
    const t = t0.map((x) => x * a), b = b0.map((x) => x * a);
    const n = 4;
    const fine = [0, 0, 0, 0];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const s = (i + 0.5) / n - 0.5, tt = (j + 0.5) / n - 0.5;
            const c = evalCellColors(dir[0] + t[0] * s + b[0] * tt, dir[1] + t[1] * s + b[1] * tt, dir[2] + t[2] * s + b[2] * tt,
                                     t, b, 1 / n, coarse + 2);
            for (let k = 0; k < 4; k++) fine[k] += c[k] / (n * n);
        }
    }
    const coarseCols = evalCellColors(dir[0], dir[1], dir[2], t, b, 1, coarse);
    return { fine, coarse: coarseCols };
}

function varyPatch(dir, coarse) {
    const a = BASE_WAVELENGTH / (2.5 * Math.pow(2, coarse)) / RADIUS;
    const t0 = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]);
    const b0 = [dir[1] * t0[2] - dir[2] * t0[1], dir[2] * t0[0] - dir[0] * t0[2], dir[0] * t0[1] - dir[1] * t0[0]];
    const t = t0.map((x) => x * a), b = b0.map((x) => x * a);
    const n = 4;
    let fine = 0;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const s = (i + 0.5) / n - 0.5, tt = (j + 0.5) / n - 0.5;
            fine += kCellColor.run(1, dir[0] + t[0] * s + b[0] * tt, dir[1] + t[1] * s + b[1] * tt, dir[2] + t[2] * s + b[2] * tt,
                                   t[0], t[1], t[2], b[0], b[1], b[2], 1 / n, RADIUS, coarse + 2, TRUTH, SEED, 2, 0, gndBuf, colBuf)[0];
        }
    }
    const c = kCellColor.run(1, dir[0], dir[1], dir[2], t[0], t[1], t[2], b[0], b[1], b[2], 1, RADIUS, coarse, TRUTH, SEED, 2, 0, gndBuf, colBuf)[0];
    return { fine: fine / (n * n), coarse: c };
}

// Most of the planet is open sea or flat lowland, one colour at every
// scale: the patches are drawn where colour changes, half on coasts and half
// in the mountains.
function places(coarse, n) {
    const out = [];
    let coast = 0;
    const a = BASE_WAVELENGTH / (2.5 * Math.pow(2, coarse)) / RADIUS;
    for (let tries = 0; out.length < n && tries < 20000; tries++) {
        const dir = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
        const t = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]).map((x) => x * a);
        const h = cell(dir, t, [0, 0, 0], 0, 0, 1, coarse);
        if (Math.abs(h) < 150 && coast < n / 2) { out.push({ dir, coast: true }); coast++; }
        else if (h > 2200 && out.length - coast < n / 2) out.push({ dir, coast: false });
    }
    return out.map((p) => p.dir);
}

// At 9.5 octaves a coast's unresolved relief is a few metres, so only the
// few coasts whose relief crosses the shore or the sand's edge differ between
// the model and the colour of the mean: 120 patches hold enough of them that
// the comparison is not decided by one or two. The comparison is by mean
// absolute error: an rms over the patches is decided by the worst of them,
// and the worst is where the coarse cell's height misses its finer cells'
// (a crest a hundred metres high across a snow line), which the height
// checks above measure; the colour model can only take the height it is
// given.
const PATCHES = tier(30, 120);
for (const coarse of [3.5, 6.5, 9.5]) {
    test(`a ${coarse}-octave cell's colour is the mean of the cells two octaves finer`, () => {
        seed = 777;
        const where = places(coarse, PATCHES);
        check(where.length === PATCHES, `found coasts and mountains to measure (${where.length})`);
        const patches = where.map((dir) => colorPatch4(dir, coarse));
        for (const [ch, what] of [[0, 'luminance'], [1, 'water']]) {
            const stats = [0, 1].map((naive) => {
                let bias = 0, sq = 0, abs = 0;
                const n = patches.length, idx = naive * 2 + ch;
                for (const p of patches) {
                    const diff = p.fine[idx] - p.coarse[idx];
                    bias += diff;
                    sq += diff * diff;
                    abs += Math.abs(diff);
                }
                return { bias: bias / n, rms: Math.sqrt(sq / n), mae: abs / n };
            });
            const [model, naive] = stats;
            console.log(`octaves ${coarse} -> ${coarse + 2} ${what}: bias ${model.bias.toFixed(4)} mae ${model.mae.toFixed(4)} rms ${model.rms.toFixed(4)}` +
                        ` (colour of the mean: bias ${naive.bias.toFixed(4)} mae ${naive.mae.toFixed(4)} rms ${naive.rms.toFixed(4)})`);
            // The finer cells add zero-mean detail; over the patches the mean
            // of it is only known to its standard error.
            const bound = Math.max(0.01, 2.5 * model.rms / Math.sqrt(where.length));
            check(Math.abs(model.bias) < bound, `${what}: no systematic shift (${model.bias.toFixed(4)}, bound ${bound.toFixed(4)})`);
            // Closer than the colour of the mean, or within two 8-bit steps
            // of the finer cells (the 3.8 km cells of hill country's coasts
            // sit there), where a refine's blend shows nothing.
            check(model.mae < Math.max(0.8 * naive.mae, 2 / 255), `${what}: closer to the finer cells than the colour of the mean`);
        }
    });
}

// The albedo variation refines on its own, anywhere: a cell's factor is the
// mean of the factors of the cells two octaves finer, and the factor's mean
// over the planet is 1, so it changes no scale's average colour.
for (const coarse of [6.5, 12.5, 18.5]) {
    test(`a ${coarse}-octave cell's albedo variation is the mean of the cells two octaves finer`, () => {
        seed = 909;
        const n = tier(30, 120);
        let bias = 0, sq = 0, mean = 0;
        for (let k = 0; k < n; k++) {
            const p = varyPatch(norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]), coarse);
            bias += p.fine - p.coarse;
            sq += (p.fine - p.coarse) ** 2;
            mean += p.coarse;
        }
        const rms = Math.sqrt(sq / n);
        bias /= n;
        mean /= n;
        console.log(`octaves ${coarse} -> ${coarse + 2} variation: bias ${bias.toFixed(4)} rms ${rms.toFixed(4)}, mean factor ${mean.toFixed(4)}`);
        check(Math.abs(bias) < Math.max(0.004, 2.5 * rms / Math.sqrt(n)), `no systematic shift (${bias.toFixed(4)})`);
        check(Math.abs(mean - 1) < 0.05, `mean factor near 1 (${mean.toFixed(4)})`);
    });
}

done('planet refine');
