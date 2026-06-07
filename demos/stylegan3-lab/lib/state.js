// StyleGAN3 Lab — drive an NVlabs StyleGAN3-R generator through its real
// forward seams. StyleGAN3 runs latent → image; there is no decode-side contour
// to drag (that's the inversion direction, not built yet). What it *does* expose
// is a structured latent space, and this lab maps each control seam to a panel:
//
//   SAMPLE   z → image. A seed samples z ~ N(0,1); truncation ψ pulls W toward
//            the average face (tamer/more typical), with an optional row cutoff
//            so only the coarse layers are truncated. The unit of generation.
//   WALK     interpolation in W+ space between two anchor seeds — a continuous
//            morph. Drag t for the live midpoint, or render a strip across t.
//   MIX      style mixing — the signature StyleGAN seam. W+ is (numWs × wDim);
//            take the coarse rows (pose/shape) from source A and the fine rows
//            (color/texture) from source B, split at a crossover layer.
//   GRID     an N×N seed browser at the current ψ — scan the space, click a
//            tile to drop that seed into Sample.
//
// Every panel ultimately calls just two engine entry points: generate() (z→w+→
// image, optionally returning the w+) and synthesize() (an edited w+ → image).
// The mapped w+ for each (seed, ψ, cutoff) is cached so Walk/Mix reuse it.
//
// Modules share one global scope, loaded in order by index.html:
//   state.js    this file — shared state + the seam map
//   helpers.js  el / dom + fs/os bridges / image draw / W+ math
//   engine.js   setBadge + the single-owner latest-wins job queue
//   model.js    checkpoint load + adapting to its resolution/numWs
//   sample.js   the Sample seam
//   walk.js     the Walk seam (interpolation + strip)
//   mix.js      the Mix seam (style mixing)
//   grid.js     the Grid seam (seed browser)
//   app.js      wire the DOM up, seam switching, kick off the first load

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

let gan = null;                                   // the loaded StyleGAN3 handle
let META = { resolution: 256, zDim: 512, numWs: 16, wDim: 512, device: 'cuda' };
let seam = 'sample';                              // active panel

// engine: one model op in flight at a time (single-owner), latest-wins.
let inflight = null;                              // current AsyncHandle
let curSeq = null;                                // running job sequence
let pending = null;                               // job to start once the slot frees
let seqCounter = 0;                               // monotonic id, guards stale onDone

// latent cache: `${seed}|${psi}|${cutoff}` → Float32Array(numWs*wDim) (the mapped w+).
const wCache = new Map();

// last rendered Sample, so "→ A/B" can seed Walk/Mix from what's on screen.
let lastSample = null;                            // { seed, w }

// cached anchors for the live sliders (avoid refetching w+ on every drag).
let walkWA = null, walkWB = null;
let mixWA = null, mixWB = null;

// pinned anchors: a recovered (inverted) w+ override for the A/B anchors. When
// set, Walk/Mix use this latent directly instead of mapping the seed input —
// the bridge from the Invert seam ("→ A/B") into the editing seams.
let pinnedA = null, pinnedB = null;
