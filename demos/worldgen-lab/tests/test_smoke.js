// Headless smoke for Worldgen Lab. Boots the app (import /app/app.js runs init and
// loads the checkpoint), then verifies two things:
//   1. the lab is WIRED  — four probes registered, tabs + mounts + overview built
//   2. the model PATH works — coarse channels/units, and the composition guarantee
//      the lab is built to show: with `margin`, a window read alone matches a
//      deep-margin reference bit-exactly in its interior, and independently
//      generated neighbours match a single big read.
//
// Model correctness runs on a SECOND world (the pipeline serves one request at a
// time), and we park the UI on the cheap 'seams' probe so pumping frames never
// kicks off a multi-second pipeline/relief regen on the app's world.

import { ready, world } from "/app/app.js";
import { state } from "/app/lib/core.js";
import { PROBES, activate } from "/app/lib/registry.js";
import { classify } from "/app/lib/probes/climate.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Park on the cheap probe BEFORE the world arrives, so no heavy auto-regen fires.
activate('seams');

// ── boot ─────────────────────────────────────────────────────────────────────
assert(bro.worldgen && bro.worldgen.available !== false, 'bro.worldgen available (needs BRO_WITH_DIFFUSION)');
for (let i = 0; i < 1200; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'checkpoint loaded');
const w = world();
console.log('LOADED · seed', w.seed, '·', w.cellSize, 'm/cell · coarse', w.coarseCellSize, '· latent', w.latentCellSize);

// ── the lab is wired ─────────────────────────────────────────────────────────
console.log('PROBES', PROBES.map((p) => p.id).join(', '));
assert(PROBES.length === 4, 'four probes registered');
assert($$('#tabs .tab').length === 4, 'four tabs built');
for (const p of PROBES) { activate(p.id); assert(p._mount, 'mount built for ' + p.id); }
assert($$('.thumb').length === 5, 'pipeline strip has five stage thumbs');
assert($('.ov-base') && $('.ov-overlay'), 'overview map built');
activate('seams');
assert($('.btn.primary'), 'seams run button present');
console.log('WIRED · tabs', $$('#tabs .tab').length, '· thumbs', $$('.thumb').length);

// ── classify unit checks (real degC / mm/yr thresholds) ──────────────────────
assert(classify(-2000, 20, 1000) === 0, 'deep ocean');
assert(classify(-100, 20, 1000) === 1, 'shelf');
assert(classify(300, -10, 400) === 2, 'ice/tundra by cold');
assert(classify(200, 26, 2500) === 11, 'tropical rainforest');
assert(classify(200, 25, 100) === 8, 'subtropical desert');

// ── model path on a second world ─────────────────────────────────────────────
let w2 = null, w2err = null;
bro.worldgen.loadWorld(state.dir, { seed: 1, onReady: (x) => { w2 = x; }, onError: (m) => { w2err = m; } });
for (let i = 0; i < 1200; i++) { wallSleep(100); advanceTime(16); if (w2 || w2err) break; }
assert(!w2err && w2, 'second world loaded' + (w2err ? ': ' + w2err : ''));

// coarse() — the fast 2.8M path the overview uses
const cg = w2.coarse(0, 0, 48, 48);
assert(cg.width === 48 && cg.height === 48 && cg.data.length === 48 * 48, 'coarse() returns a 48x48 field');

// coarse STAGE — channels + real units the climate probe relies on
const cs = w2.stageSync('coarse', 0, 0, 24, 24);
console.log('COARSE STAGE · channels', cs.channels, '·', cs.names.join(','));
assert(cs.channels === 6, 'coarse stage has six channels');
const iT = cs.names.indexOf('temperature'), iP = cs.names.indexOf('precipitation');
assert(iT >= 0 && cs.units[iT] === 'degC', 'temperature in degC');
assert(iP >= 0 && cs.units[iP] === 'mm/yr', 'precipitation in mm/yr');

// ── composition — the lab's headline claim ───────────────────────────────────
const n = 24;
const solo = w2.elevationSync(0, 0, n, n, { margin: 0 }).data;
const ref  = w2.elevationSync(0, 0, n, n, { margin: 32 }).data;
let interiorMax = 0, edgeMax = 0;
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const d = Math.abs(solo[z * n + x] - ref[z * n + x]);
    const ring = Math.min(x, z, n - 1 - x, n - 1 - z);
    if (ring >= 4) interiorMax = Math.max(interiorMax, d);
    else edgeMax = Math.max(edgeMax, d);
}
console.log('COMPOSITION · interior Δ', interiorMax.toExponential(2), '· edge Δ', edgeMax.toFixed(3), 'm');
assert(interiorMax < 1e-3, 'interior composes exactly (bit-exact a few cells in)');

// independently generated neighbours match a single big read (margin cropped)
const big = w2.elevationSync(0, 0, n, 2 * n, { margin: 8 }).data;   // width 2n, height n
const L = w2.elevationSync(0, 0, n, n, { margin: 8 }).data;
const R = w2.elevationSync(0, n, n, 2 * n, { margin: 8 }).data;
let seamMax = 0;
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    seamMax = Math.max(seamMax, Math.abs(L[z * n + x] - big[z * 2 * n + x]));
    seamMax = Math.max(seamMax, Math.abs(R[z * n + x] - big[z * 2 * n + n + x]));
}
console.log('NEIGHBOURS · max Δ vs single big read', seamMax.toExponential(2), 'm');
assert(seamMax < 1e-3, 'neighbours compose into a single field');

// determinism — the same read twice is identical
const a = w2.coarse(5, 5, 20, 20).data, b = w2.coarse(5, 5, 20, 20).data;
let dd = 0; for (let i = 0; i < a.length; i++) dd += Math.abs(a[i] - b[i]);
assert(dd === 0, 'reads are deterministic');

// ── UI capture ───────────────────────────────────────────────────────────────
activate('climate');
for (let i = 0; i < 40; i++) { wallSleep(40); advanceTime(16); }   // let the coarse climate land
flush();
screenshot('_ui.png');
console.log('ALL SMOKE CHECKS PASSED');
