// pipeline.js — the scalar-field pipeline. Every bro.image verb is one
// toggleable stage applied in order to a ping-pong buffer pair:
//
//   source → [ map | combine | stencil | resample ]* → (histogram-eq) → colorize
//
// All buffers are bro.image.alloc'd once per field size and reused across
// frames; JS never enters the per-pixel loop except for the cached test
// pattern sources (kernels.js).

import { STENCILS, DYNAMIC_SOURCES, fillSource } from "/app/kernels.js";

export const MAP_OPS = ['affine', 'abs', 'log', 'sqrt', 'exp', 'pow'];
export const COMBINE_OPS = ['add', 'sub', 'mul', 'min', 'max', 'lerp', 'wsum'];
export const COMBINE_SOURCES = ['radial', 'gradient', 'simplex', 'checker'];
export const EDGES = ['clamp', 'wrap', 'zero'];
export const FACTORS = [2, 4, 8, 16];
export const FILTERS = ['nearest', 'bilinear'];

/** The stages, in application order. `ms` is the last frame's time for the stage. */
export const stages = [
    { id: 'map',      verb: 'bro.image.map',      name: 'map',      on: false, cfg: { op: 'affine', a: 1, b: 0, exp: 2.2 }, ms: 0 },
    { id: 'combine',  verb: 'bro.image.combine',  name: 'combine',  on: false, cfg: { op: 'lerp', src2: 'radial', t: 0.5, wa: 1, wb: 1 }, ms: 0 },
    { id: 'stencil',  verb: 'bro.image.stencil',  name: 'stencil',  on: false, cfg: { kernel: 'gaussian', edge: 'clamp' }, ms: 0 },
    { id: 'resample', verb: 'bro.image.resample', name: 'resample', on: false, cfg: { factor: 4, filter: 'nearest' }, ms: 0 },
    { id: 'histeq',   verb: 'bro.image.reduce → lookup', name: 'histogram-eq', on: false, cfg: {}, ms: 0 },
];
export const stage = (id) => stages.find((s) => s.id === id);

/** Field buffers + source cache. Read through this object (tests see it live). */
export const field = {
    w: 0, h: 0,
    a: null, b: null,        // ping-pong
    source: null,            // cached main source, copied into `a` each frame
    src2: null,              // combine's second source
    edge: null,              // edge-magnitude scratch (second sobel pass)
    lo: null, loW: 0, loH: 0,// resample's low-res scratch
    sourceDirty: true, src2Dirty: true, src2Kind: '',
};

export function allocField(w, h) {
    Object.assign(field, {
        w, h,
        a: bro.image.alloc(w, h, 1), b: bro.image.alloc(w, h, 1),
        source: bro.image.alloc(w, h, 1), src2: bro.image.alloc(w, h, 1),
        edge: null, lo: null, loW: 0, loH: 0,
        sourceDirty: true, src2Dirty: true, src2Kind: '',
    });
}

function runMap(c, src, dst) {
    const spec = c.op === 'affine' ? { op: 'affine', a: c.a, b: c.b }
               : c.op === 'pow' ? { op: 'pow', exp: c.exp } : { op: c.op };
    bro.image.map(dst, src, spec);
}

function runCombine(c, src, dst, ctx) {
    // Refill the second source only when it is dynamic noise being animated, or
    // it changed / the field was resized: never re-run a JS pattern per frame.
    const dyn = DYNAMIC_SOURCES.has(c.src2);
    if ((dyn && ctx.animate) || field.src2Dirty || c.src2 !== field.src2Kind) {
        fillSource(field.src2, c.src2, field.w, field.h, dyn ? ctx.time * 0.5 + 3.0 : 0);
        field.src2Kind = c.src2;
        field.src2Dirty = false;
    }
    const spec = c.op === 'lerp' ? { op: 'lerp', t: c.t }
               : c.op === 'wsum' ? { op: 'wsum', wa: c.wa, wb: c.wb } : { op: c.op };
    bro.image.combine(dst, src, field.src2, spec);
}

function runStencil(c, src, dst) {
    const W = field.w, H = field.h;
    if (c.kernel === 'edgemag') {
        // sqrt(gx² + gy²): two stencils, two squares, a sum and a sqrt. The
        // scratch keeps either pass from clobbering `src` while the other needs it.
        if (!field.edge) field.edge = bro.image.alloc(W, H, 1);
        const gx = field.edge, sx = STENCILS.sobelX, sy = STENCILS.sobelY;
        bro.image.stencil(gx, src, sx, { srcW: W, srcH: H, edge: c.edge, divisor: sx.divisor });
        bro.image.stencil(dst, src, sy, { srcW: W, srcH: H, edge: c.edge, divisor: sy.divisor });
        bro.image.combine(gx, gx, gx, { op: 'mul' });
        bro.image.combine(dst, dst, dst, { op: 'mul' });
        bro.image.combine(dst, dst, gx, { op: 'add' });
        bro.image.map(dst, dst, { op: 'sqrt' });
        return;
    }
    const k = STENCILS[c.kernel];
    bro.image.stencil(dst, src, k, { srcW: W, srcH: H, edge: c.edge, divisor: k.divisor, bias: k.bias });
}

function runResample(c, src, dst) {
    // Down to 1/factor, then back up with the chosen filter: the recipe that
    // makes nearest (blocky) vs bilinear (smooth) visible.
    const W = field.w, H = field.h;
    const loW = Math.max(2, Math.round(W / c.factor)), loH = Math.max(2, Math.round(H / c.factor));
    if (!field.lo || loW !== field.loW || loH !== field.loH) {
        field.lo = bro.image.alloc(loW, loH, 1);
        field.loW = loW; field.loH = loH;
    }
    bro.image.resample(field.lo, src, { srcW: W, srcH: H, dstW: loW, dstH: loH, channels: 1, filter: 'bilinear' });
    bro.image.resample(dst, field.lo, { srcW: loW, srcH: loH, dstW: W, dstH: H, channels: 1, filter: c.filter });
}

const RUN = { map: runMap, combine: runCombine, stencil: runStencil, resample: runResample };

/**
 * Run the enabled stages. ctx: { source (kind), animate, time }.
 * Returns { buf, eqActive, tSource }; eqActive routes colorize through the
 * histogram-eq LUT instead of the chosen gradient.
 */
export function applyPipeline(ctx) {
    const t0 = performance.now();
    const dyn = DYNAMIC_SOURCES.has(ctx.source);
    if ((dyn && ctx.animate) || field.sourceDirty || field.sourceKind !== ctx.source) {
        fillSource(field.source, ctx.source, field.w, field.h, dyn ? ctx.time : 0);
        field.sourceDirty = false;
        field.sourceKind = ctx.source;
    }
    field.a.set(field.source);      // a memcpy, not a pixel loop
    const tSource = performance.now() - t0;

    let src = field.a, dst = field.b, eqActive = false;
    for (const s of stages) {
        s.ms = 0;
        if (!s.on) continue;
        if (s.id === 'histeq') { eqActive = true; continue; }   // applied at colorize
        const s0 = performance.now();
        RUN[s.id](s.cfg, src, dst, ctx);
        s.ms = performance.now() - s0;
        [src, dst] = [dst, src];
    }
    return { buf: src, eqActive, tSource };
}
