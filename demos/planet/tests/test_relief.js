// Planet — the ridged relief's noise as the ground's shader evaluates it
// (relief.bk simplex_grad): from a lattice cell found in f64 and an offset
// in f32, the same value as the truth's noise() at the same point, and a
// gradient that matches its finite differences, far from the origin too.
//   Run: scripts/validate.sh demos/planet/tests/test_relief.js
import { check, test, done } from "/lib/kit/test.js";

const fs = require('fs');
const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const mod = bro.kernel.compile(readApp('tests/measure.bk'),
                               { file: 'measure.bk', modules: { 'planet::ground': readApp('ground.bk'), 'planet::relief': readApp('relief.bk'), 'planet::rivers': readApp('rivers.bk') } });
const k = mod.kernel('k_simplex');

let seed = 4242;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// Anchors at the scales the relief's octaves reach on an Earth-radius planet
// (p ~ 2.65, times 2^4 to 2^21), offsets up to a few lattice cells.
for (const scale of [16, 4096, 5.5e6]) {
    test(`simplex_grad matches noise() at |q| ~ ${scale}`, () => {
        let worstV = 0, worstG = 0, gsum = 0;
        const n = 200, h = 1e-3;
        for (let i = 0; i < n; i++) {
            const q = [(rnd() * 2 - 1) * scale, (rnd() * 2 - 1) * scale, (rnd() * 2 - 1) * scale];
            const o = [(rnd() * 2 - 1) * 3, (rnd() * 2 - 1) * 3, (rnd() * 2 - 1) * 3];
            const s = 100 + (i % 17);
            const at = (dx, dy, dz) => k.run(1, q[0], q[1], q[2], o[0] + dx, o[1] + dy, o[2] + dz, s, 0)[0];
            const truth = at(0, 0, 0);
            const v = k.run(1, q[0], q[1], q[2], o[0], o[1], o[2], s, 1)[0];
            worstV = Math.max(worstV, Math.abs(v - truth));
            const fd = [(at(h, 0, 0) - at(-h, 0, 0)) / (2 * h), (at(0, h, 0) - at(0, -h, 0)) / (2 * h),
                        (at(0, 0, h) - at(0, 0, -h)) / (2 * h)];
            for (let c = 0; c < 3; c++) {
                const g = k.run(1, q[0], q[1], q[2], o[0], o[1], o[2], s, 2 + c)[0];
                worstG = Math.max(worstG, Math.abs(g - fd[c]));
                gsum += Math.abs(g);
            }
        }
        console.log(`|q| ~ ${scale}: value error ${worstV.toExponential(2)}, gradient error ${worstG.toExponential(2)} (mean |g| ${(gsum / (3 * n)).toFixed(3)})`);
        check(worstV < 2e-4, `value as noise() (${worstV.toExponential(2)})`);
        check(worstG < 0.02, `gradient as noise()'s differences (${worstG.toExponential(2)})`);
    });
}

done('planet relief');
