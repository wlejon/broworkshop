// Planet — the horizon layer against the ground it stands for. For points on
// the drawn tiles, each of the 8 stored horizons (the full horizon the ground
// is shaded by) is compared with a dense march of the ground from the same
// point toward the same direction (measure.bk k_horizon_truth: steps 5%
// apart out to REACH, at the octaves the tile shades with). Reports the
// elevation error in degrees per level (bias, mean |error|, p95) and how
// often a sun at LOW degrees is lit by one and shadowed by the other.
//   Run: scripts/validate.sh demos/planet/tests/test_horizon.js
import { check, frames, test, done } from "/lib/kit/test.js";

const fs = require('fs');
const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const mod = bro.kernel.compile(readApp('tests/measure.bk'),
                               { file: 'measure.bk', modules: { 'planet::ground': readApp('ground.bk') } });
const kTruth = mod.kernel('k_horizon_truth');
const RADIUS = 6371000, SEED = 7, BASE_WAVELENGTH = 2400000;
const TILE = 32, BORDER = 2, C = TILE + 2 * BORDER, N = C / 2;
const REACH = 300000, LOW = 6;
const RATIO = 1.05, FILTER = 0.05;
const octavesFor = (extent) => Math.min(30, Math.max(1, Math.log2(BASE_WAVELENGTH / (2.5 * extent / TILE))));
const DEG = 180 / Math.PI;

window.requestAnimationFrame = () => 0;
planet.cam.alt = 320; planet.cam.pitch = -1;
const settle = () => { for (let i = 0; i < 900 && (i < 10 || planet.cache.pending > 0); i++) frames(1); };

test('horizons follow the ground', () => {
    settle();
    const t0 = Date.now();
    const pos = new Float32Array(planet.cache.layer('position').byteLength / 4);
    planet.cache.layer('position').read(pos);
    const hzBuf = planet.cache.layer('horizon');
    const hz = new Uint32Array(hzBuf.byteLength / 4);
    hzBuf.read(hz);

    const drawn = planet.cache.drawn;
    const dirAt = (t, x, y) => {
        const i = ((t.slot * C + y) * C + x) * 4;
        const p = [t.center[0] + pos[i], t.center[1] + pos[i + 1], t.center[2] + pos[i + 2]];
        const l = Math.hypot(p[0], p[1], p[2]);
        return [p[0] / l, p[1] / l, p[2] / l];
    };
    const angle = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));

    // Spread the sample over the levels drawn: up to 6 tiles a level, 4
    // points a tile.
    const byLevel = new Map();
    for (const t of drawn) {
        if (!byLevel.has(t.level)) byLevel.set(t.level, []);
        byLevel.get(t.level).push(t);
    }
    let seed = 99;
    const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    const rows = [];
    let all = [], flips = 0, lows = 0;
    for (const [level, tiles] of [...byLevel].sort((a, b) => a[0] - b[0])) {
        const errs = [], farErrs = [];
        for (let k = 0; k < Math.min(6, tiles.length); k++) {
            const t = tiles[rnd(tiles.length)];
            const extent = RADIUS * angle(dirAt(t, BORDER, C / 2), dirAt(t, BORDER + TILE, C / 2));
            const cell = extent / TILE, octaves = octavesFor(extent) + 1;
            for (let p = 0; p < 4; p++) {
                const gx = 1 + rnd(N - 2), gy = 1 + rnd(N - 2);
                const dir = dirAt(t, 2 * gx, 2 * gy);
                // The grid's axes on the tangent plane: direction k is cos * gu + sin * gv.
                const axis = (a, b) => {
                    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                    const dd = t[0] * dir[0] + t[1] * dir[1] + t[2] * dir[2];
                    return [t[0] - dir[0] * dd, t[1] - dir[1] * dd, t[2] - dir[2] * dd];
                };
                const gu = axis(dirAt(t, 2 * gx - 1, 2 * gy), dirAt(t, 2 * gx + 1, 2 * gy));
                const gv = axis(dirAt(t, 2 * gx, 2 * gy - 1), dirAt(t, 2 * gx, 2 * gy + 1));
                const at = ((t.slot * N + gy) * N + gx) * 16;
                for (let d = 0; d < 8; d++) {
                    const ang = d * Math.PI / 4, c = Math.cos(ang), s = Math.sin(ang);
                    const tk = [gu[0] * c + gv[0] * s, gu[1] * c + gv[1] * s, gu[2] * c + gv[2] * s];
                    const word = hz[at + (d >> 1)];
                    const stored = ((d & 1 ? word >>> 16 : word & 65535) / 65535) * 2 - 1;
                    const truth = kTruth.eval(dir[0], dir[1], dir[2], tk[0], tk[1], tk[2], cell, REACH, RATIO, FILTER,
                                              RADIUS, octaves, SEED);
                    const e = (Math.asin(stored) - Math.asin(truth)) * DEG;
                    errs.push(e);
                    const fw = hz[at + 4 + d];
                    const storedFar = ((fw & 65535) / 65535) * 2 - 1;
                    const truthFar = kTruth.eval(dir[0], dir[1], dir[2], tk[0], tk[1], tk[2], cell * 8, REACH, RATIO, FILTER, RADIUS, octaves, SEED);
                    farErrs.push((Math.asin(storedFar) - Math.asin(truthFar)) * DEG);
                    const sun = Math.sin(LOW / DEG);
                    if ((stored < sun) !== (truth < sun)) flips++;
                    lows++;
                }
            }
        }
        const abs = errs.map(Math.abs).sort((x, y) => x - y);
        const bias = errs.reduce((s, x) => s + x, 0) / errs.length;
        const mean = abs.reduce((s, x) => s + x, 0) / abs.length;
        const farBias = farErrs.reduce((s, x) => s + x, 0) / farErrs.length;
        const farMean = farErrs.reduce((s, x) => s + Math.abs(x), 0) / farErrs.length;
        rows.push(`level ${level}: n ${errs.length} bias ${bias.toFixed(2)} mean|e| ${mean.toFixed(2)} p95 ${abs[Math.floor(abs.length * 0.95)].toFixed(2)} deg; far bias ${farBias.toFixed(2)} mean|e| ${farMean.toFixed(2)}`);
        all = all.concat(errs);
    }
    rows.forEach((r) => console.log(r));
    console.log(`truth ${(Date.now() - t0).toFixed(0)} ms`);
    const abs = all.map(Math.abs).sort((x, y) => x - y);
    const bias = all.reduce((s, x) => s + x, 0) / all.length;
    const mean = abs.reduce((s, x) => s + x, 0) / abs.length;
    const p95 = abs[Math.floor(abs.length * 0.95)];
    console.log(`all: n ${all.length} bias ${bias.toFixed(2)} mean|e| ${mean.toFixed(2)} p95 ${p95.toFixed(2)} deg, ` +
                `sun at ${LOW} deg disagrees ${(100 * flips / lows).toFixed(1)}%`);
    check(Math.abs(bias) < 1.0, `bias ${bias.toFixed(2)} deg`);
    check(p95 < 4.0, `p95 ${p95.toFixed(2)} deg`);
});

done();
