// Planet — refine, never replace, measured on the height function itself.
// A coarse tile's cell must hold what the finer cells covering it average
// to: what is represented must not shift with elevation. For patches over
// the whole planet, each coarse cell (as k_tile computes it, through k_cell)
// is compared with the mean of the 8 x 8 cells three octaves finer that
// cover it. The bias (a systematic shift) must be near zero; the spread is
// the detail the finer cells add, zero-mean, and must stay small.
//   Run: scripts/validate.sh demos/planet/tests/test_refine.js
import { check, test, done } from "/lib/kit/test.js";

const fs = require('fs');
const mod = bro.kernel.compile(fs.readFileSync(bro.resolvePath('/app/planet.bk'), 'utf-8'), { file: 'planet.bk' });
const kCell = mod.kernel('k_cell');
const RADIUS = 6371000, SEED = 7, BASE_WAVELENGTH = 2400000;

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// A cell `size` (in units of `a`) about (s, t) of the frame (dir; t, b).
const cell = (dir, t, b, s, tt, size, octaves) =>
    kCell.eval(dir[0] + t[0] * s + b[0] * tt, dir[1] + t[1] * s + b[1] * tt, dir[2] + t[2] * s + b[2] * tt,
               t[0], t[1], t[2], b[0], b[1], b[2], size, RADIUS, octaves, SEED);

function patch(dir, coarse) {
    // The frame: tangent axes scaled to one coarse cell, so the coarse cell
    // spans (s, t) in [-0.5, 0.5]^2.
    const a = BASE_WAVELENGTH / (2.5 * Math.pow(2, coarse)) / RADIUS;
    const t0 = norm(Math.abs(dir[1]) < 0.9 ? [dir[2], 0, -dir[0]] : [0, -dir[2], dir[1]]);
    const b0 = [dir[1] * t0[2] - dir[2] * t0[1], dir[2] * t0[0] - dir[0] * t0[2], dir[0] * t0[1] - dir[1] * t0[0]];
    const t = t0.map((x) => x * a), b = b0.map((x) => x * a);
    const N = 8;
    let sum = 0;
    for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++)
            sum += cell(dir, t, b, (i + 0.5) / N - 0.5, (j + 0.5) / N - 0.5, 1 / N, coarse + 3);
    return { fine: sum / (N * N), coarse: cell(dir, t, b, 0, 0, 1, coarse) };
}

for (const coarse of [1.5, 3.5, 6.5, 9.5]) {
    test(`a ${coarse}-octave cell is the average of the cells three octaves finer`, () => {
        let bias = 0, sq = 0, range = 0;
        const n = 40;
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

done('planet refine');
