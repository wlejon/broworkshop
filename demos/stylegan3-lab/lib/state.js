// StyleGAN3 Lab — drive an NVlabs StyleGAN3-R/T generator through its real
// seams. StyleGAN3 runs latent → image and exposes a structured latent space;
// each panel maps one control seam:
//
//   SAMPLE   z → image. A seed samples z ~ N(0,1); truncation ψ pulls W toward
//            the average face, with an optional row cutoff so only the coarse
//            layers are truncated.
//   WALK     interpolation in W+ between two anchors: drag t for the live
//            midpoint, or render a strip across t.
//   MIX      style mixing: coarse rows (pose/shape) from A, fine rows
//            (color/texture) from B, split at a crossover layer.
//   INVERT   image → W+ by Adam descent through the frozen synthesis, run in
//            chunks so the face refines live; the result pins into Walk/Mix.
//   GRID     an N×N seed browser at the current ψ; click a tile for Sample.
//
// Every panel calls generate() (z → w+ → image), synthesize() (edited w+ →
// image) or invert(). The mapped w+ per (seed, ψ, cutoff) is cached.
//
// Modules:
//   state.js    this file: shared state
//   helpers.js  dom + fs bridges, image draw, W+ math
//   engine.js   status + the single-owner latest-wins job queue
//   model.js    checkpoint discovery (lib/kit/weights.js) + load
//   seams.js    seam tabs, refresh, shared-param labels
//   sample.js / walk.js / mix.js / invert.js / grid.js   the seams
//   ../lab.js   DOM wiring;  ../main.js  the thin entry

export const $  = (s) => document.querySelector(s);
export const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

// Shared mutable state in one object: ES-module imports are read-only
// bindings, so cross-file writers mutate this live object instead.
export const S = {
  gan: null,                                      // the loaded StyleGAN3 handle
  META: { resolution: 256, zDim: 512, numWs: 16, wDim: 512, device: 'cuda' },
  seam: 'sample',                                 // active panel
  status: null,                                   // kit statusLine (lab.js)

  // last rendered Sample, so "→ A/B" can seed Walk/Mix from what's on screen.
  lastSample: null,                               // { seed, w }

  // cached anchors for the live sliders (avoid refetching w+ on every drag).
  walkWA: null, walkWB: null,
  mixWA: null, mixWB: null,

  // pinned anchors: a recovered (inverted) w+ used for A/B instead of mapping
  // the seed input; the bridge from Invert ("→ A/B") into the editing seams.
  pinnedA: null, pinnedB: null,

  // Invert seam state (here so model.js can reset it on load).
  invTargetData: null,                            // RGBA { data, width, height } at model res
  invW: null,                                     // recovered w+ (Float32Array)
  invCurve: [],                                   // accumulated per-step MSE across chunks
};

// latent cache: `${seed}|${psi}|${cutoff}` → Float32Array(numWs*wDim) (the mapped w+).
export const wCache = new Map();
