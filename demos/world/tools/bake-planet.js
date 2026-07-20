// =============================================================================
// Bake the whole planet's coarse elevation field, once.
//
//   bro-headless ../broworkshop/demos/world tools/bake-planet.js
//
// WHY THIS EXISTS. The app generates its coarse field live, in a synchronous
// call, sized to what the camera can see. On the ground that is cheap. From
// 400 km up the horizon is 2000 km and the window is over 1200 cells square,
// which measured 36 s — a hard lock of the whole application, once per re-cut.
// No amount of window tuning removes it, because the cost is real work that has
// to happen while the camera waits.
//
// The planet is finite, so the honest fix is to stop generating at runtime. The
// entire globe at the coarse cell is ~54 MB and a few minutes of work, paid once
// by whoever authors the world, after which the runtime only ever reads memory.
//
// It also produces the field the cube-sphere needs. Faces sample this by
// direction; they hold no data of their own, so face seams are not a data
// problem. See CHART in planet.js for why the chart is equirectangular and how
// its two edges are closed.
// =============================================================================
import { PLANET, CHART, chartSize, foldLongitude, closePoles }
    from '/app/planet.js';

const fs = require('fs');

const WEIGHTS = 'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro';
const OUT_BIN = '/app/planet-coarse.bin';
const OUT_JSON = '/app/planet-coarse.json';

// Tile the generation. Cost is dominated by fixed overhead rather than area
// (156^2 measured 1.3 s, 1212^2 measured 36 s — roughly 25x the cells for 28x
// the time), so tiles want to be large. 1024 keeps each call's working set
// sane while staying deep in the efficient regime.
const TILE = 1024;

if (!bro.worldgen || !bro.worldgen.available) {
    console.log('BAKE SKIPPED: this build has no bro.worldgen');
} else {
    bro.worldgen.init();
    bro.worldgen.loadWorld(WEIGHTS, {
        seed: PLANET.seed,
        onReady: (world) => { bake(world); },
        onError: (m) => { console.log('BAKE FAILED: ' + m); },
    });
}

function bake(world) {
    // One probe read to learn the generator's coarse cell size. It is a property
    // of the checkpoint (native resolution x latent compression x 32), not a
    // constant this tool gets to assume.
    const probe = world.coarse(0, 0, 4, 4);
    const cell = probe.cellSize;

    const { width: W, height: H } = chartSize(PLANET.radius, cell);
    const total = (W + CHART.wrapBand) * H;
    console.log('planet "' + PLANET.name + '"  seed ' + PLANET.seed +
                '  radius ' + (PLANET.radius / 1000).toFixed(0) + ' km');
    console.log('chart ' + W + ' x ' + H + ' cells at ' + (cell / 1000).toFixed(2) +
                ' km  (' + (total * 4 / 1048576).toFixed(1) + ' MB)');

    // Generate WRAP_BAND columns PAST the meridian. Those extra columns are what
    // makes the wrap continuous rather than averaged — see foldLongitude.
    const GW = W + CHART.wrapBand;
    const field = new Float32Array(GW * H);

    // --- generate -------------------------------------------------------------
    // The generator is a pure function of (seed, position) and tiles agree
    // exactly where they overlap, so the tiling here is an implementation detail
    // with no seams of its own. Only the CHART's two edges need repair.
    const t0 = Date.now();
    let done = 0;
    for (let i0 = 0; i0 < H; i0 += TILE) {
        for (let j0 = 0; j0 < GW; j0 += TILE) {
            const i1 = Math.min(H, i0 + TILE), j1 = Math.min(GW, j0 + TILE);
            const t = world.coarse(i0, j0, i1, j1);
            for (let r = 0; r < t.height; r++) {
                const src = r * t.width;
                const dst = (i0 + r) * GW + j0;
                for (let c = 0; c < t.width; c++) field[dst + c] = t.data[src + c];
            }
            done += (i1 - i0) * (j1 - j0);
            const pct = (100 * done / total).toFixed(0);
            console.log('  ' + pct.padStart(3) + '%  rows ' + i0 + '-' + i1 +
                        '  cols ' + j0 + '-' + j1 +
                        '  (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
        }
    }

    const folded = foldLongitude(field, GW, H);
    closePoles(folded, W, H);

    // --- write ----------------------------------------------------------------
    // Raw f32 plus a sidecar, rather than a container format. The runtime wants
    // to hand this straight to setHeightLayer with no decode step, and the
    // sidecar is what lets a loader REFUSE a field baked for a different planet
    // instead of drawing the wrong world.
    fs.writeFileSync(OUT_BIN, Buffer.from(folded.buffer));
    fs.writeFileSync(OUT_JSON, JSON.stringify({
        name: PLANET.name, seed: PLANET.seed, radius: PLANET.radius,
        width: W, height: H, cellSize: cell,
        chart: 'equirectangular',
        wrapBand: CHART.wrapBand, poleBand: CHART.poleBand,
    }, null, 2));

    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < W * H; k++) { const v = folded[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    console.log('elevation ' + lo.toFixed(0) + ' .. ' + hi.toFixed(0) + ' m');
    console.log('wrote ' + OUT_BIN + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    console.log('BAKE OK');
}
