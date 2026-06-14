// Headless smoke for the StyleGAN3 Lab. Runs in the loaded app context, so it
// checks BOTH that the lab wired up (globals + DOM) and that the underlying
// bro.vision generator path works end to end. Exercises the API synchronously
// (no callbacks → inline) to stay deterministic; the live app uses the async
// queue. GPU headless: bro-headless ../broworkshop/demos/stylegan3-lab _smoke.js

import { renderSample } from "/app/lib/sample.js";
import { prepareWalk } from "/app/lib/walk.js";
import { renderMix } from "/app/lib/mix.js";
import { renderGrid } from "/app/lib/grid.js";
import { runInvert, setInvTarget } from "/app/lib/invert.js";
import { lerpW, mixW, drawBitmap } from "/app/lib/helpers.js";

const WROOT = (typeof process !== 'undefined' && process.env.BRO_WEIGHTS) || 'D:/projects';
const DIR = WROOT + '/brovisionml/weights/stylegan3-r-ffhqu-256';

// ── lab wired up ──────────────────────────────────────────────────────────────
assert(typeof renderSample === 'function', 'sample.js loaded');
assert(typeof prepareWalk === 'function', 'walk.js loaded');
assert(typeof renderMix === 'function', 'mix.js loaded');
assert(typeof renderGrid === 'function', 'grid.js loaded');
assert(typeof runInvert === 'function' && typeof setInvTarget === 'function', 'invert.js loaded');
assert(typeof lerpW === 'function' && typeof mixW === 'function', 'W+ math loaded');
['#sample-canvas', '#walk-mid', '#mix-result', '#grid-out', '#psi', '#mix-k',
 '#panel-invert', '#inv-target', '#inv-recovered', '#inv-loss', '#btn-invert'].forEach(function (s) {
  assert(document.querySelector(s), 'DOM present: ' + s);
});

// ── W+ math is correct ────────────────────────────────────────────────────────
(function () {
  const a = new Float32Array([0, 0, 1, 1]);   // 2 rows × wDim 2
  const b = new Float32Array([2, 2, 3, 3]);
  const mid = lerpW(a, b, 0.5);
  assert(mid[0] === 1 && mid[2] === 2, 'lerpW midpoint');
  const mx = mixW(a, b, 1, 2, 2);             // row0 from a, row1 from b
  assert(mx[0] === 0 && mx[1] === 0 && mx[2] === 3 && mx[3] === 3, 'mixW crossover');
})();

// ── generator path: z → image, w+, synthesize ────────────────────────────────
const g = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
assert(g && g.numWs > 0 && g.wDim > 0, 'loaded: numWs=' + g.numWs + ' wDim=' + g.wDim);

const r = g.generate({ seed: 42, truncation: 0.7, returnLatents: true });
assert(r.image && r.width === 256 && r.height === 256, 'generate 256² image');
assert(r.w && r.w.length === g.numWs * g.wDim, 'returnLatents w+ length = ' + r.w.length);

// edit the w+ and render it back — the Walk/Mix path
const r2 = g.generate({ seed: 7, returnLatents: true });
const blended = lerpW(r.w, r2.w, 0.5);
const s = g.synthesize(blended);
assert(s.image && s.width === 256, 'synthesize(edited w+) → image');

const mixed = mixW(r.w, r2.w, Math.floor(g.numWs / 2), g.numWs, g.wDim);
const sm = g.synthesize(mixed);
assert(sm.image, 'synthesize(style-mixed w+) → image');

// ── invert path: image → w+, resume (initW), then edit the recovered latent ───
// Synchronous (no onDone) so it's deterministic under headless virtual time.
const inv = g.invert(r.image, { steps: 30, lr: 0.1 });
assert(inv.w && inv.w.length === g.numWs * g.wDim, 'invert → recovered w+');
assert(inv.lossCurve && inv.lossCurve.length === 30, 'invert → loss curve');
assert(inv.loss < inv.lossCurve[0], 'invert reduced loss: ' + inv.lossCurve[0].toExponential(2) + ' → ' + inv.loss.toExponential(2));
const inv2 = g.invert(r.image, { steps: 30, lr: 0.1, initW: inv.w });   // resume
assert(inv2.lossCurve[0] < inv.lossCurve[0] * 0.5, 'initW resume started low (progressive chunking)');
// the recovered latent edits like any other (the "→ A/B then Walk/Mix" payoff)
const recMix = mixW(inv2.w, r2.w, Math.floor(g.numWs / 2), g.numWs, g.wDim);
assert(g.synthesize(recMix).image, 'edit recovered w+ (style-mix) → image');

// draw the results onto the lab's own canvases and snapshot
drawBitmap(document.querySelector('#sample-canvas'), r.image);
drawBitmap(document.querySelector('#walk-mid'), s.image);
drawBitmap(document.querySelector('#mix-result'), sm.image);
flush();
screenshot('_smoke.png');

console.log('OK — StyleGAN3 Lab smoke passed');
