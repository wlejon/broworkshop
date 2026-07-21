// ═══ Worldgen Lab — shared core ══════════════════════════════════════════════
//
// bro.worldgen is a diffusion terrain model: three magnitude-preserving UNets in
// series (a 2.8M coarse net, a 253.7M latent net, a 27.9M decoder) that produce
// an infinite, deterministic world in METRES at 30 m/cell. It is a REPLACEMENT
// for FBm, not a filter on it — it has coherent drainage, coastlines and shelves
// because it knows water flows downhill, which no octave sum does.
//
// This lab drives that model through its real SEAMS — the places where you can
// watch what the model is doing and where it can go wrong. Each seam is a self-
// contained PROBE (lib/probes/*.js) that registers itself; adding a new one is a
// new file plus one import. The four that ship:
//
//   PIPELINE     the DAG decomposition — coarse → latentInit → latent →
//                residual → elevation. WHICH stage puts a coastline in.
//   CLIMATE      the coarse net's six channels (elevation + five climate) and the
//                biome they imply. This is the conditioning seam.
//   RELIEF       the elevation product as lit 3D + hypsometry + a cross-section.
//                What the world actually IS, at ground scale.
//   COMPOSITION  the tile seam — independently generated neighbours must compose
//                bit-exactly, and `margin` is why. Where the infinite world stitches.
//
// One LOCATION spine (lib/region.js) owns seed + position + extent and a coarse
// overview map you click to aim; every probe reads that region and regenerates
// against it. One GENERATION queue (lib/registry.js) keeps to the pipeline's
// "one request at a time" rule (its tile cache is not thread-safe).
//
// Modules share nothing but these exports and the DOM. Shared MUTABLE state lives
// in `state` below so a probe never reaches into another module for it.

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ─── shared mutable state ─────────────────────────────────────────────────────
// region.i/j are NATIVE (30 m) cell indices of the sample window's NW corner;
// region.extent is its side in native cells. Every probe maps these into its own
// stage's coarser grid (see STAGE.cellDiv). The origin is just the seed's
// reference point, not a corner of anything, so i/j may be negative.
export const state = {
    dir:    'D:/projects/brodiffusion/weights/terrain-diffusion-30m-bro',
    world:  null,          // the loaded World, or null
    seed:   1,             // fixed at load; a reseed is a reload
    region: { i: -560, j: -128, extent: 256 },
    busy:   false,         // a load or a generate is in flight
    loading:false,
};
// Test seams: the smoke loads synchronously and drives these directly.
export function setWorld(w) { state.world = w; }
export function isReady()   { return !!state.world; }
export function world()     { return state.world; }

// ─── pipeline stage metadata ──────────────────────────────────────────────────
// DAG order, which is also coarse-to-fine, so a strip reads left→right as the
// pipeline runs. cellDiv is how many NATIVE cells one of this stage's cells spans
// — the coarse net is 256x coarser than the elevation it feeds, the latent 8x —
// so a fixed native window covers very different EXTENTS per stage (coarse spans
// hundreds of km, elevation a few). The channel names/units are NOT hardcoded:
// every probe reads them off the result so a checkpoint with a different layout
// cannot be mislabelled here.
export const STAGE = {
    order:  ['coarse', 'latentInit', 'latent', 'residual', 'elevation'],
    cellDiv: { coarse: 256, latentInit: 8, latent: 8, residual: 1, elevation: 1 },
    blurb: {
        coarse:     'climate + elevation at 7.68 km/cell, from the 2.8M coarse net',
        latentInit: 'the latent after step 1 of 2 — noisier, exposed to attribute a discrepancy to one TrigFlow step',
        latent:     'the latent refined over two TrigFlow steps at 240 m/cell (253.7M net)',
        residual:   'the Laplacian residual at 30 m — STANDARDISED, not metres',
        elevation:  'elevation in metres at 30 m/cell — the pipeline product',
    },
};
export function cellDiv(stage) { return STAGE.cellDiv[stage] || 1; }

// ─── colour ramps ─────────────────────────────────────────────────────────────
// Built once, lazily, after bro.image exists. Elevation reads as a planet —
// ocean, shelf, lowland, snow — so it earns the landscape palette. Every other
// channel is a scalar field with no such convention and gets a neutral ramp;
// a signed field (the standardised residual) gets a diverging one centred on 0.
let _luts = null;
export function luts() {
    if (_luts) return _luts;
    _luts = {
        terrain: bro.image.gradient([
            [0.00,  12,  34,  74],
            [0.42,  28,  92, 140],
            [0.48, 232, 220, 156],
            [0.55,  96, 165,  92],
            [0.72,  74, 110,  70],
            [0.86, 150, 140, 128],
            [1.00, 252, 252, 252],
        ], 256),
        scalar: bro.image.gradient([
            [0.00,  20,  20,  45],
            [0.50, 140, 130, 120],
            [1.00, 245, 240, 220],
        ], 256),
        diverging: bro.image.gradient([
            [0.00,  40, 110, 200],
            [0.50, 245, 245, 240],
            [1.00, 200,  70,  55],
        ], 256),
        heat: bro.image.gradient([
            [0.00,  20,  24,  60],
            [0.35, 190,  60, 120],
            [0.70, 250, 150,  60],
            [1.00, 250, 245, 200],
        ], 256),
    };
    return _luts;
}
// Which ramp a (stage, channel) wants, from the unit the binding reports.
export function rampFor(res, ch) {
    const u = res && res.units && res.units[ch];
    const name = res && res.names && res.names[ch];
    if (u === 'm') return luts().terrain;
    if (name === 'residual') return luts().diverging;
    return luts().scalar;
}

// ─── a tiny event bus ─────────────────────────────────────────────────────────
// 'region'  — the sample window moved (probes regenerate)
// 'world'   — a checkpoint finished loading (or was cleared)
// 'status'  — a line of user-facing status text  (msg, isError)
const _subs = {};
export function on(evt, fn)  { (_subs[evt] || (_subs[evt] = [])).push(fn); }
export function emit(evt, ...a) { for (const fn of _subs[evt] || []) fn(...a); }
export function status(msg, bad) { emit('status', msg, !!bad); }
