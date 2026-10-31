// Planet clouds — one field at every scale (clouds.js, clouds.bk): a column
// resolved at any footprint agrees with every finer one within the variance
// it leaves unresolved, and the cloud cover the fine footprints count is
// the cover a coarse footprint's statistics predict (the occupancy's
// logistic over its unresolved variance). And the ground's light cache
// holds, where a tile is drawn, what the light is at that point.
//   Run: scripts/validate.sh demos/planet
import { check, frames, test, done } from "/lib/kit/test.js";
import { GROUND_LIGHT, CLOUD_DETAIL_VAR } from "/app/clouds.js";

const fs = require('fs');
const readApp = (path) => fs.readFileSync(bro.resolvePath('/app/' + path), 'utf-8');
const mod = bro.kernel.compile(readApp('tests/measure_clouds.bk'), {
    file: 'measure_clouds.bk',
    modules: { 'planet::ground': readApp('ground.bk'), 'planet::relief': readApp('relief.bk'), 'planet::rivers': readApp('rivers.bk'),
               'planet::clouds': readApp('clouds.bk'), tiles: bro.tiles.module },
});
const kColumn = mod.kernel('k_column'), kLight = mod.kernel('k_ground_light');
const RADIUS = 6371000, SEED = 7;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const column = (d, w) => [kColumn.run(1, d[0], d[1], d[2], w, RADIUS, 0)[0], kColumn.run(1, d[0], d[1], d[2], w, RADIUS, 1)[0]];
// A tangent frame at d, its axes `a` radians long.
function frame(d, a) {
    const t = norm(Math.abs(d[1]) < 0.9 ? [d[2], 0, -d[0]] : [0, -d[2], d[1]]);
    const b = [d[1] * t[2] - d[2] * t[1], d[2] * t[0] - d[0] * t[2], d[0] * t[1] - d[1] * t[0]];
    return (s, u) => norm([0, 1, 2].map((c) => d[c] + (t[c] * s + b[c] * u) * a));
}

test('every footprint agrees with the finest within what it leaves unresolved', () => {
    for (const d of [norm([0.3, 0.8, 0.5]), norm([-0.7, 0.1, 0.7]), norm([0.2, -0.9, -0.4])]) {
        const [fine] = column(d, 49);
        let worst = 0;
        for (let w = 98; w <= 400000; w *= 2) {
            const [F, V] = column(d, w);
            worst = Math.max(worst, Math.abs(F - fine) / Math.sqrt(V + 1e-6));
        }
        check(worst < 4, `each footprint within 4 of its unresolved deviations of the finest (worst ${worst.toFixed(2)})`);
    }
});

// Over patches `span` metres across about several points (one patch holds
// too few clouds to say), so the comparison is of expectations.
test('fine footprints count the cover a coarse one predicts', () => {
    const points = [[0.3, 0.8, 0.5], [-0.7, 0.1, 0.7], [0.2, -0.9, -0.4], [0.9, -0.2, 0.3], [-0.4, -0.5, -0.8], [0.1, 0.4, -0.9]];
    for (const [wf, wc] of [[100, 6400], [400, 25600], [1600, 51200]]) {
        const span = 16 * wc;
        let cover = 0, predicted = 0;
        const n = 64, m = 16;
        for (const p of points) {
            const at = frame(norm(p), span / RADIUS);
            for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
                if (column(at((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5), wf)[0] > 0.02) cover++;
            for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
                const [F, V] = column(at((i + 0.5) / m - 0.5, (j + 0.5) / m - 0.5), wc);
                predicted += sigmoid(1.7 * (F - 0.02) / Math.sqrt(V + 1e-5));
            }
        }
        cover /= n * n * points.length;
        predicted /= m * m * points.length;
        check(Math.abs(cover - predicted) < 0.06,
              `${wf} m footprints count ${cover.toFixed(3)} cover at the base, ${wc} m predicts ${predicted.toFixed(3)}`);
    }
});

test("the ground's light cache holds the light where its tiles are", () => {
    Object.assign(planet.cam, { lat: 0.45, lon: 0.3, alt: 2000, pitch: -20, heading: 0 });
    perf.settle({ held: false });
    const g = planet.clouds.ground, sun = planet.clouds.sun;
    const cells = GROUND_LIGHT.tile + 2 * GROUND_LIGHT.border;
    const pool = g.layer('light').read(new Uint32Array(g.capacity * cells * cells));
    const errors = [];
    const drawn = g.drawn;
    for (let k = 0; k < drawn.length; k += Math.max(1, Math.floor(drawn.length / 40))) {
        const t = drawn[k];
        // The tile's centre, between its four central cells.
        const c0 = GROUND_LIGHT.border + GROUND_LIGHT.tile / 2 - 1;
        const held = [0, 0, 0];
        for (const [x, y] of [[c0, c0], [c0 + 1, c0], [c0, c0 + 1], [c0 + 1, c0 + 1]]) {
            const word = pool[(t.slot * cells + y) * cells + x];
            for (let ch = 0; ch < 3; ch++) held[ch] += ((word >>> (8 * ch)) & 255) / 255 / 4;
        }
        // The cell's footprint there (clouds.bk tile_cell).
        const d = norm(t.center);
        const m = Math.max(...d.map(Math.abs));
        const uv = d.map((x) => x / m).filter((x) => Math.abs(Math.abs(x) - 1) > 1e-9);
        const u = uv[0] || 0, v = uv[1] || 0;
        const stretch = Math.sqrt(1 + Math.max(u * u, v * v)) / (1 + u * u + v * v);
        const w = 2 * RADIUS * (2 / 2 ** t.level / GROUND_LIGHT.tile) * stretch;
        for (let ch = 0; ch < 3; ch++) {
            const truth = kLight.run(1, d[0], d[1], d[2], w, sun[0], sun[1], sun[2], RADIUS, SEED, CLOUD_DETAIL_VAR, ch)[0];
            errors.push(Math.abs(held[ch] - truth));
        }
    }
    errors.sort((a, b) => a - b);
    check(drawn.length > 0, `${drawn.length} tiles drawn`);
    const median = errors[Math.floor(errors.length / 2)];
    check(median < 0.03, `the cells about ${errors.length / 3} tiles' centres hold the light there (median error ${median.toFixed(4)})`);
});

done('planet clouds');
