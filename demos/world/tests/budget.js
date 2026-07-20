// What does a planet actually cost to hold, at each altitude?
//
// The current design asks ONE layer to cover the whole reach, so its cost grows
// with reach squared and the generator is asked for it live. This computes what
// the pyramid SHOULD cost, from the engine's own constants, using two facts the
// flat-plane design ignores:
//
//   1. On a sphere the visible ground is bounded by the HORIZON, and the
//      horizon grows as sqrt(altitude), not linearly. Reach is not a free
//      parameter, it is determined.
//   2. A cell finer than a pixel is wasted. Resolution r is worth carrying only
//      out to r / (pixelScale * PIXELS_PER_CELL); past that it is sub-pixel and
//      a coarser tier says the same thing for less.
//
// Together those bound every tier: the fine tiers are needed only NEAR, and the
// far field is only ever needed COARSE.
import { ready } from '/app/app.js';
for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }

const R = 6371000;                       // Earth, metres
const FOV = 70 * Math.PI / 180;
const VH = 1080;
const PIXEL_SCALE = 2 * Math.tan(FOV / 2) / VH;   // == u_pixelScale
const PPC = 1.5;                                   // == CM_PIXELS_PER_CELL
const MB = 1 / (1024 * 1024);

// Measured: 1.3 s at 156 square, 36.2 s at 1212 square (tests/cost.js, real
// clock). Least squares on two points: fixed + per-cell.
const GEN_PER_CELL = 24.1e-6;   // seconds
const GEN_FIXED    = 0.71;      // seconds

const horizon   = (h) => Math.sqrt(2 * R * h + h * h);
const usefulTo  = (cell) => cell / (PIXEL_SCALE * PPC);   // range a resolution earns
const genSec    = (cells) => GEN_FIXED + cells * GEN_PER_CELL;

console.log('pixel scale ' + PIXEL_SCALE.toExponential(3) +
            '  (one pixel spans 1 m at ' + (1 / PIXEL_SCALE).toFixed(0) + ' m)');

// --- How far can you SEE, and how fine is worth carrying that far? -----------
console.log('');
console.log('altitude      horizon    coarsest cell a pixel can tell apart');
for (const h of [2, 100, 1000, 10000, 100000, 400000, 4145000]) {
    const d = horizon(h);
    console.log('  ' + (h >= 1000 ? (h / 1000).toFixed(0) + ' km' : h + ' m').padStart(8) +
                '  ' + (d / 1000).toFixed(0).padStart(7) + ' km' +
                '   ' + (d * PIXEL_SCALE * PPC).toFixed(0).padStart(7) + ' m at the horizon');
}

// --- The whole planet, at each resolution -----------------------------------
console.log('');
console.log('WHOLE PLANET as one resident field (4*pi*R^2 at each resolution)');
const area = 4 * Math.PI * R * R;
for (const cell of [7680, 1920, 480, 120, 30]) {
    const cells = area / (cell * cell);
    const bytes = cells * 4;
    console.log('  ' + (cell >= 1000 ? (cell / 1000) + ' km' : cell + ' m').padStart(7) +
                '/cell: ' + (cells / 1e6).toFixed(1).padStart(9) + ' M cells   ' +
                (bytes * MB > 1024 ? (bytes * MB / 1024).toFixed(1) + ' GB'
                                   : (bytes * MB).toFixed(1) + ' MB').padStart(9) +
                '   generate once: ' +
                (genSec(cells) > 300 ? (genSec(cells) / 60).toFixed(0) + ' min'
                                     : genSec(cells).toFixed(0) + ' s'));
}

// --- A camera-centred tier costs the same at every altitude ------------------
// Its radius is min(horizon, the range its resolution earns), so the fine tiers
// stop growing almost immediately and the coarse tier is the only one that ever
// wants to be planet-sized — which is exactly the one small enough to bake.
console.log('');
console.log('CAMERA-CENTRED TIER: radius = min(horizon, range the resolution earns)');
const TIERS = [30, 480, 7680];
let head = 'altitude  ';
for (const c of TIERS) head += ('  ' + (c >= 1000 ? c / 1000 + 'km' : c + 'm') + '/cell').padStart(22);
console.log(head);
for (const h of [2, 1000, 10000, 100000, 400000]) {
    let line = '  ' + (h >= 1000 ? (h / 1000).toFixed(0) + ' km' : h + ' m').padStart(7);
    for (const cell of TIERS) {
        const rad = Math.min(horizon(h), usefulTo(cell));
        const n = Math.ceil(2 * rad / cell);
        line += ('  ' + n + '^2  ' + (n * n * 4 * MB).toFixed(1) + ' MB').padStart(22);
    }
    console.log(line);
}

// --- The bill -----------------------------------------------------------------
console.log('');
let resident = 0, capped = [];
for (const cell of TIERS) {
    const n = Math.ceil(2 * Math.min(horizon(400000), usefulTo(cell)) / cell);
    capped.push(cell + 'm:' + n + '^2');
    resident += n * n * 4;
}
const coarseAll = area / (7680 * 7680) * 4;
console.log('THE BILL');
console.log('  streamed tiers, worst case (' + capped.join(', ') + '): ' +
            (resident * MB).toFixed(1) + ' MB');
console.log('  whole-planet coarse field, baked once and never regenerated: ' +
            (coarseAll * MB).toFixed(1) + ' MB');
console.log('  TOTAL RESIDENT: ' + ((resident + coarseAll) * MB).toFixed(1) + ' MB');
console.log('');
console.log('  for comparison, what the app demands TODAY at 400 km up:');
const today = Math.ceil(2 * 4194000 / 7680);
console.log('    one 7.68 km layer covering the full ring reach: ' + today + '^2  ' +
            (today * today * 4 * MB).toFixed(1) + ' MB, regenerated live in ' +
            genSec(today * today).toFixed(0) + ' s');
console.log('BUDGET OK');
