// The motion oracle, image half: turns a run of rendered frames into
// pictures and numbers that show how things MOVE, for a reviewer who reads
// stills. Use it from any headless capture script:
//
//   import { MotionRun } from "/lib/kit/motion.js";
//   const run = new MotionRun({ name: 'grove_fir', out: OUT, fps: 30,
//       regions: [{ name: 'fir', rect: [0.3, 0.1, 0.7, 0.9] }], keepFrames: true });
//   for (let i = 0; i < 150; i++) { advanceTime(1000 / 30); run.grab({ t: i / 30 }); }
//   const summary = run.finish();   // writes <out>/<name>_motion*.jpg, .txt, .json
//
// What it measures. Every pair of frames is cut into 16 x 16 px blocks
// (analysed at half resolution) and each block is followed to the next
// frame by block matching (coarse to fine, sub-pixel). Per block and frame
// pair that gives:
//   V  its motion (px/frame), or lost (it moved further than 16 px or has no
//      texture to follow)
//   P  its brightness change ALONG the motion (luma levels 0..255): smooth
//      motion carries a block's brightness with it, so P is near 0 and slow;
//      flicker, shading pops and tier swaps show here
//   D  what is left once the motion and P are taken out: a structure change
//      (things appearing, vanishing, re-arranging)
// From the series, per block:
//   motion     RMS of V about its mean (px/frame at full resolution)
//   wiggle     the motion's effective frequency (Hz): fps/pi asin(rms(dV) /
//              (2 rms(V))); a sinusoid at f Hz gives f, white positional
//              noise gives fps/3 (10 Hz at 30 fps). Sway is < 2 Hz, leaf
//              flutter 3-8 Hz, noise and aliasing above
//   jitter     positional noise (px): rms(d2V) / sqrt(20), what white
//              frame-to-frame noise of that size would give (a smooth sway
//              has almost no second difference of its speed)
//   flicker    brightness noise (levels): rms(d2P) / sqrt(20), with its own
//              wiggle frequency
// and, per frame pair, EVENTS: a block whose D, brightness kick (P less its
// neighbours' mean) or motion kick (dV) stands out of its own last second by
// more than 6 robust deviations and an absolute floor; neighbouring blocks
// at one frame join into one event. Each event keeps crops of the frames
// before, at and after it.
//
// Coherence: the moving blocks' displacement series (along each block's
// main axis) are cross-correlated pairwise; by screen separation, the
// median peak correlation and the lag at it. Lockstep is far blocks
// correlating near 1 at lag 0; noise is near blocks not correlating.
//
// Outputs (in `out`):
//   <name>_motion.jpg         overview: events + flicker map, motion map,
//                             per-region timelines, slit-scans at the worst
//                             events
//   <name>_motion_events.jpg  the top events: frames t-1, t, t+1 cropped
//   <name>_motion_slits*.jpg  slit-scans: a line of pixels stacked over time
//                             (time runs down): smooth motion draws smooth
//                             curves; a pop is a horizontal break; flicker is
//                             a striped band; jitter a ragged edge
//   <name>_motion.txt/.json   the numbers and the flagged anomalies
//
// Thresholds were set from a calibrate scenario (the former demos/grove's
// motion.js `calibrate`, in git history): a smoothly swaying object scores
// clean, injected pops, flicker, jitter and lockstep are flagged.

import { THRESHOLDS, B, MARGIN, median, pctl, fx, sheet, motionSheetMethods } from "./motion-sheet.js";
export { THRESHOLDS, sheet };

// `matcher=js` on a run's command line: the block matching in JS (the
// reference bro.image.blockMotion ports, to the bit), as opts.native false.
const MATCHER_JS = ((bro.app && bro.app.argv) || []).includes('matcher=js');

const R = 4;          // coarse search radius at quarter resolution (16 px full)
const WARM = 12;      // frame pairs before events are judged (the baseline)
const BASE = 30;      // the baseline's length (frame pairs)

// Box downsample a luma plane by 2.
function half(src, W, H) {
    const w = W >> 1, h = H >> 1, out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const r0 = 2 * y * W, r1 = r0 + W;
        for (let x = 0; x < w; x++) out[y * w + x] = (src[r0 + 2 * x] + src[r0 + 2 * x + 1] + src[r1 + 2 * x] + src[r1 + 2 * x + 1] + 2) >> 2;
    }
    return out;
}

function ssd(a, b, W, ax, ay, bx, by, n) {
    let s = 0;
    for (let j = 0; j < n; j++) {
        let ia = (ay + j) * W + ax, ib = (by + j) * W + bx;
        for (let i = 0; i < n; i++, ia++, ib++) { const d = a[ia] - b[ib]; s += d * d; }
    }
    return s;
}

// One block's match from frame a to frame b (full, half and quarter luma
// planes; x0, y0 its corner at half resolution). Coarse to fine: quarter
// resolution +-R, half +-2, full +-1, then two Lucas-Kanade steps
// (inverse compositional, translation) for the sub-pixel part, which a
// parabola through the SSD gets wrong by up to ~0.2 px in a pattern that
// cycles with the motion (and so reads as jitter). Writes out = [dx, dy
// (full px), P (mean change along the motion), D (rms of what is left),
// sigma (the block's texture), status (0 tracked, 1 lost: past the search,
// 2 untextured: P and D at zero motion only)].
const LK = new Float64Array(3 * 256);
function matchBlock(fa, fb, ha, hb, qa, qb, W, W2, x0, y0, out) {
    const F = 2 * B, FF = F * F, X0 = 2 * x0, Y0 = 2 * y0, Wq = W2 >> 1;
    let s = 0, s2 = 0;
    for (let j = 0; j < F; j++) { const r = (Y0 + j) * W + X0; for (let i = 0; i < F; i++) { const v = fa[r + i]; s += v; s2 += v * v; } }
    const sig = Math.sqrt(Math.max(0, s2 / FF - (s / FF) * (s / FF)));
    out[4] = sig;
    let dx = 0, dy = 0, status = 0;
    if (sig < THRESHOLDS.lostTexture) status = 2;
    else {
        const qx = x0 >> 1, qy = y0 >> 1;
        let best = Infinity, bx = 0, by = 0;
        for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
            const c = ssd(qa, qb, Wq, qx, qy, qx + u, qy + v, 4) + 2 * (Math.abs(u) + Math.abs(v));
            if (c < best) { best = c; bx = u; by = v; }
        }
        if (Math.abs(bx) === R || Math.abs(by) === R) status = 1;
        else {
            best = Infinity;
            let hx = 2 * bx, hy = 2 * by;
            for (let v = 2 * by - 2; v <= 2 * by + 2; v++) for (let u = 2 * bx - 2; u <= 2 * bx + 2; u++) {
                const c = ssd(ha, hb, W2, x0, y0, x0 + u, y0 + v, B) + 2 * (Math.abs(u) + Math.abs(v));
                if (c < best) { best = c; hx = u; hy = v; }
            }
            const fxb = 2 * hx, fyb = 2 * hy;
            dx = fxb; dy = fyb;
            // Lucas-Kanade: the template's gradients and their Hessian once;
            // each step the residual (less its mean: brightness may change)
            // against them. The shift is one for the whole block, so are the
            // bilinear weights.
            let hxx = 0, hxy = 0, hyy = 0, gxs = 0, gys = 0;
            for (let j = 0, n = 0; j < F; j++) for (let i = 0; i < F; i++, n++) {
                const o = (Y0 + j) * W + X0 + i;
                const gx = 0.5 * (fa[o + 1] - fa[o - 1]), gy = 0.5 * (fa[o + W] - fa[o - W]);
                LK[3 * n] = gx; LK[3 * n + 1] = gy; LK[3 * n + 2] = fa[o];
                hxx += gx * gx; hxy += gx * gy; hyy += gy * gy; gxs += gx; gys += gy;
            }
            const det = hxx * hyy - hxy * hxy;
            if (det > 1e-6 * (hxx + hyy) * (hxx + hyy) && det > 1) {
                for (let it = 0; it < 4; it++) {
                    const ix = Math.floor(dx), iy = Math.floor(dy), wx = dx - ix, wy = dy - iy;
                    const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
                    let ex = 0, ey = 0, em = 0;
                    for (let j = 0, n = 0; j < F; j++) {
                        let o = (Y0 + j + iy) * W + X0 + ix;
                        for (let i = 0; i < F; i++, n++, o++) {
                            const e = w00 * fb[o] + w10 * fb[o + 1] + w01 * fb[o + W] + w11 * fb[o + W + 1] - LK[3 * n + 2];
                            em += e; ex += LK[3 * n] * e; ey += LK[3 * n + 1] * e;
                        }
                    }
                    em /= FF;
                    ex -= em * gxs; ey -= em * gys;
                    const ux = (hyy * ex - hxy * ey) / det, uy = (hxx * ey - hxy * ex) / det;
                    dx -= Math.max(-1, Math.min(1, ux)); dy -= Math.max(-1, Math.min(1, uy));
                    if (ux * ux + uy * uy < 1e-4) break;
                }
                if (Math.abs(dx - fxb) > 2 || Math.abs(dy - fyb) > 2) { dx = fxb; dy = fyb; }
            }
        }
    }
    // Brightness change along the motion, and the structure left.
    const ix = Math.floor(dx), iy = Math.floor(dy), wx = dx - ix, wy = dy - iy;
    const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
    let sb = 0, sd = 0;
    for (let j = 0; j < F; j++) {
        let o = (Y0 + j + iy) * W + X0 + ix, oa = (Y0 + j) * W + X0;
        for (let i = 0; i < F; i++, o++, oa++) {
            const d = w00 * fb[o] + w10 * fb[o + 1] + w01 * fb[o + W] + w11 * fb[o + W + 1] - fa[oa];
            sb += d; sd += d * d;
        }
    }
    const m = sb / FF;
    out[0] = dx; out[1] = dy; out[2] = m; out[3] = Math.sqrt(Math.max(0, sd / FF - m * m)); out[5] = status;
}

// Per block (the run's grid, full res), the rms luma difference of `cur`
// against `ref`: how far each block's picture is from how it looked then.
function blockChange(ref, cur, W, nx, ny, out) {
    const S = 2 * B;
    for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
        const x0 = 2 * MARGIN + bx * S, y0 = 2 * MARGIN + by * S;
        let s = 0;
        for (let y = 0; y < S; y++) {
            let o = (y0 + y) * W + x0;
            for (let x = 0; x < S; x++, o++) { const d = cur[o] - ref[o]; s += d * d; }
        }
        out[by * nx + bx] = Math.sqrt(s / (S * S));
    }
}

// The rms residual of a half-resolution block when each pixel takes the
// best of the motions in `hyp` (pairs, half-res px), less the block's mean.
function multiResidual(ha, hb, W2, x0, y0, hyp) {
    const nh = hyp.length >> 1;
    let s = 0, s2 = 0;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
        const av = ha[(y0 + j) * W2 + x0 + i];
        let best = Infinity, be = 0;
        for (let h = 0; h < nh; h++) {
            const dx = hyp[2 * h], dy = hyp[2 * h + 1];
            const X = x0 + i + dx, Y = y0 + j + dy, ix = Math.floor(X), iy = Math.floor(Y), wx = X - ix, wy = Y - iy, o = iy * W2 + ix;
            const e = (1 - wy) * ((1 - wx) * hb[o] + wx * hb[o + 1]) + wy * ((1 - wx) * hb[o + W2] + wx * hb[o + W2 + 1]) - av;
            if (Math.abs(e) < best) { best = Math.abs(e); be = e; }
        }
        s += be; s2 += be * be;
    }
    const m = s / (B * B);
    return Math.sqrt(Math.max(0, s2 / (B * B) - m * m));
}

export class MotionRun {
    // opts: name, out (directory), fps (30), keepFrames (keep every frame's
    // luma for slit-scans placed after the fact: static views), slits
    // ([{label, y, x0, x1}] in 0..1 of the view: fixed lines recorded every
    // frame, for long or moving runs), regions ([{name, rect: [x0, y0, x1,
    // y1]}] in 0..1) or regionAt(frame) returning such a list (a subject that
    // moves on screen), cameraMoving (skip coherence), notes (lines for the
    // summary's head), meta keys printed per event (eventMeta: (frameMeta) =>
    // string), mask(frame) returning rects [x0, y0, x1, y1] (0..1) to leave
    // out of that frame (a mover's own body), native (false: the block
    // matching in JS here, the reference bro.image.blockMotion ports).
    constructor(opts) {
        this.o = Object.assign({ fps: 30, keepFrames: false, slits: [], regions: [], cameraMoving: false, notes: [] }, opts);
        this.W = innerWidth; this.H = innerHeight;
        this.W2 = this.W >> 1; this.H2 = this.H >> 1;
        this.nx = Math.floor((this.W2 - 2 * MARGIN) / B);
        this.ny = Math.floor((this.H2 - 2 * MARGIN) / B);
        this.nb = this.nx * this.ny;
        this.frames = 0;
        this.meta = [];
        this.V = [];      // per pair: Float32Array(2 nb), NaN when lost
        this.P = [];      // per pair: Float32Array(nb)
        this.D = [];      // per pair: Float32Array(nb)
        this.tex = new Float32Array(this.nb);
        this.lumaAll = [];
        this.ring = [];   // the last 3 frames' RGBA (page rows only), for event crops
        this.slitRows = this.o.slits.map(() => []);
        this.events = [];
        this.pending = [];   // events waiting for their t+1 frame
        this.prev = null;
        this.firstRGB = null;
        this.midRGB = null;
    }

    blockCentre(b) {
        const bx = b % this.nx, by = (b / this.nx) | 0;
        return [(MARGIN + bx * B + B / 2) * 2, (MARGIN + by * B + B / 2) * 2];   // full-res px
    }

    /** The block under full-res px (x, y), or -1. */
    blockAt(x, y) {
        const bx = Math.floor((x / 2 - MARGIN) / B), by = Math.floor((y / 2 - MARGIN) / B);
        return bx < 0 || by < 0 || bx >= this.nx || by >= this.ny ? -1 : by * this.nx + bx;
    }

    /** The image's own track at full-res px (x, y): per frame, the
     *  displacement (x, y) summed from the median motion of the reliable
     *  blocks within `r` blocks of it (0 where none is). */
    trackAt(x, y, r = 1) {
        const c = this.blockAt(x, y), out = [[0, 0]];
        if (c < 0) return null;
        const cx = c % this.nx, cy = (c / this.nx) | 0;
        let ax = 0, ay = 0;
        for (let k = 0; k < this.V.length; k++) {
            const xs = [], ys = [];
            for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) {
                const X = cx + u, Y = cy + v;
                if (X < 0 || Y < 0 || X >= this.nx || Y >= this.ny) continue;
                const b = Y * this.nx + X;
                if (this.reliable[k][b] === 1) { xs.push(this.V[k][2 * b]); ys.push(this.V[k][2 * b + 1]); }
            }
            if (xs.length) { ax += median(xs); ay += median(ys); }
            out.push([ax, ay]);
        }
        return out;
    }

    /** With keepFrames: per frame, each block's rms luma difference from
     *  frame `ref` (levels): change from rest, for a still scene something
     *  passes through (a flattened blade is a change, not a translation). */
    changeFrom(ref = 0) {
        const out = [];
        for (const f of this.lumaAll) {
            const c = new Float32Array(this.nb);
            blockChange(this.lumaAll[ref], f, this.W, this.nx, this.ny, c);
            out.push(c);
        }
        return out;
    }

    regionsAt(k) { return this.o.regionAt ? this.o.regionAt(k) : this.o.regions; }
    regionOf(b, k) {
        const [x, y] = this.blockCentre(b);
        const u = x / this.W, v = y / this.H;
        for (const r of this.regionsAt(k) || []) {
            const [x0, y0, x1, y1] = r.rect;
            if (u >= x0 && u <= x1 && v >= y0 && v <= y1) return r.name;
        }
        return null;
    }

    /** Take the frame now on screen (after advanceTime/flush). `meta`: {t, ...} anything to keep with it;
     *  `f`: a frameImage() already taken (one frame into two runs: another render of it is not bit-identical). */
    grab(meta = {}, f = frameImage()) {
        const W = this.W, H = this.H, top = Math.max(0, f.height - H);
        const rgba = new Uint8Array(W * H * 4);
        rgba.set(new Uint8Array(f.data.buffer, f.data.byteOffset + top * f.width * 4, W * H * 4));
        let luma, h2, q;
        if (this.o.native !== false && !MATCHER_JS && bro.image && bro.image.motionLuma) {
            ({ full: luma, half: h2, quarter: q } = bro.image.motionLuma(rgba, { width: W, height: H }));
        } else {
            luma = new Uint8Array(W * H);
            for (let i = 0, o = 0; i < W * H; i++, o += 4) luma[i] = (54 * rgba[o] + 183 * rgba[o + 1] + 19 * rgba[o + 2]) >> 8;
            h2 = half(luma, W, H); q = half(h2, this.W2, this.H2);
        }
        this.meta.push(meta);
        if (!this.firstRGB) this.firstRGB = rgba;
        if (this.frames === (this.o.frames ? this.o.frames >> 1 : 0)) this.midRGB = rgba;
        if (this.o.keepFrames) this.lumaAll.push(luma);
        this.o.slits.forEach((s, i) => {
            const y = Math.round(s.y * (H - 1)), x0 = Math.round(s.x0 * (W - 1)), x1 = Math.round(s.x1 * (W - 1));
            this.slitRows[i].push(rgba.slice((y * W + x0) * 4, (y * W + x1 + 1) * 4));
        });
        this.ring.push(rgba);
        if (this.ring.length > 3) this.ring.shift();
        const cur = { full: luma, h2, q };
        if (this.prev) this.pair(this.prev, cur);
        this.prev = cur;
        this.frames++;
    }

    pair(a, b) {
        const W = this.W, W2 = this.W2, nb = this.nb, k = this.V.length;
        const V = new Float32Array(2 * nb), P = new Float32Array(nb), D = new Float32Array(nb);
        if (k === 0) this.reliable = [];
        const rel = new Uint8Array(nb), out = this.scratch || (this.scratch = new Float64Array(8));
        // The matching runs natively (bro.image.blockMotion: the same numbers,
        // threaded); opts.native false runs the JS here instead.
        const grid = this.grid || (this.grid = { width: W, height: this.H, nx: this.nx, ny: this.ny, block: B, margin: MARGIN, radius: R,
            lostTexture: THRESHOLDS.lostTexture, out: new Float64Array(6 * nb) });
        const native = this.o.native !== false && !MATCHER_JS && bro.image && bro.image.blockMotion;
        if (native) bro.image.blockMotion(a.full, b.full, a.h2, b.h2, a.q, b.q, grid);
        for (let bi = 0; bi < nb; bi++) {
            if (native) for (let i = 0; i < 6; i++) out[i] = grid.out[6 * bi + i];
            else matchBlock(a.full, b.full, a.h2, b.h2, a.q, b.q, W, W2, MARGIN + (bi % this.nx) * B, MARGIN + ((bi / this.nx) | 0) * B, out);
            const [dx, dy, m, dd, sig, status] = out;
            if (k === 0) this.tex[bi] = sig;
            // Untextured (sky, flat ground): no motion to see, but its brightness
            // at zero motion still tells flicker (rel 2).
            if (status === 2) { V[2 * bi] = V[2 * bi + 1] = NaN; P[bi] = m; D[bi] = dd; rel[bi] = 2; continue; }
            const lost = status !== 0;
            V[2 * bi] = lost ? NaN : dx; V[2 * bi + 1] = lost ? NaN : dy;
            P[bi] = m; D[bi] = dd;
            // One motion explains the block: what is left is small against its
            // texture. A block over two motions (an edge against a still
            // background) is not: its V says little.
            rel[bi] = !lost && dd <= Math.max(4, 0.5 * sig) ? 1 : 0;
        }
        // A block whose motion disagrees with its neighbours' (when they
        // agree among themselves) is a mismatch, not a motion.
        const nx = this.nx, ny = this.ny, xs = [], ys = [];
        const drop = [];
        for (let bi = 0; bi < nb; bi++) {
            if (rel[bi] !== 1) continue;
            const cx = bi % nx, cy = (bi / nx) | 0;
            xs.length = 0; ys.length = 0;
            for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) {
                const x = cx + u, y = cy + v;
                if ((u || v) && x >= 0 && y >= 0 && x < nx && y < ny && rel[y * nx + x] === 1) { xs.push(V[2 * (y * nx + x)]); ys.push(V[2 * (y * nx + x) + 1]); }
            }
            if (xs.length < 3) continue;
            const mx = median(xs), my = median(ys);
            const spread = median(xs.map((x, i) => Math.hypot(x - mx, ys[i] - my)));
            if (Math.hypot(V[2 * bi] - mx, V[2 * bi + 1] - my) > Math.max(1, 3 * spread)) drop.push(bi);
        }
        for (const bi of drop) rel[bi] = 0;
        // Masked blocks (a mover's own body: its motion is not the plants'):
        // nothing seen there in either frame of the pair.
        if (this.o.mask) for (const r of [...(this.o.mask(k) || []), ...(this.o.mask(k + 1) || [])]) {
            const bx0 = Math.max(0, Math.floor((r[0] * W / 2 - MARGIN) / B)), bx1 = Math.min(nx - 1, Math.floor((r[2] * W / 2 - MARGIN) / B));
            const by0 = Math.max(0, Math.floor((r[1] * this.H / 2 - MARGIN) / B)), by1 = Math.min(ny - 1, Math.floor((r[3] * this.H / 2 - MARGIN) / B));
            for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
                const bi = y * nx + x;
                V[2 * bi] = V[2 * bi + 1] = NaN; P[bi] = NaN; D[bi] = NaN; rel[bi] = 0;
            }
        }
        // The structure left when each pixel may come from its own block's
        // motion, a neighbour's or none (half resolution): an edge sweeping
        // over a still background is explained, something that appears,
        // vanishes or changes shape is not.
        if (native) bro.image.blockResidual(a.h2, b.h2, V, D, grid);
        else for (let bi = 0; bi < nb; bi++) {
            if (!Number.isFinite(D[bi])) continue;
            const cx = bi % nx, cy = (bi / nx) | 0, hyp = [0, 0];
            for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) {
                const x = cx + u, y = cy + v;
                if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
                const n = y * nx + x;
                if (Number.isFinite(V[2 * n])) hyp.push(V[2 * n] / 2, V[2 * n + 1] / 2);
            }
            D[bi] = multiResidual(a.h2, b.h2, W2, MARGIN + cx * B, MARGIN + cy * B, hyp);
        }
        this.V.push(V); this.P.push(P); this.D.push(D); this.reliable.push(rel);
        this.detect();
    }

    // Events for pair k-1 (its brightness kick needs pair k): against each
    // block's previous BASE pairs.
    detect() {
        const k = this.V.length - 2;
        if (k < WARM) return;
        const nb = this.nb, T = THRESHOLDS;
        const flags = new Map();
        const lo = Math.max(1, k - BASE);
        const kick = (P, j, b) => P[j][b] - 0.5 * (P[j - 1][b] + P[j + 1][b]);
        const robust = (vals) => {
            const s = vals.filter(Number.isFinite).sort((p, q) => p - q);
            if (s.length < 8) return null;
            const med = s[s.length >> 1];
            const dev = s.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[s.length >> 1] * 1.4826;
            return [med, dev];
        };
        for (let b = 0; b < nb; b++) {
            const d = this.D[k][b];
            if (!Number.isFinite(d)) continue;
            // Only a block past an absolute floor is judged against its past.
            const pk0 = this.P[k][b] - 0.5 * (this.P[k - 1][b] + this.P[k + 1][b]);
            const ak0 = Math.hypot(this.V[k][2 * b] - this.V[k - 1][2 * b], this.V[k][2 * b + 1] - this.V[k - 1][2 * b + 1]);
            if (!(d > T.popFloorD) && !(Math.abs(pk0) > T.flashFloor) && !(ak0 > T.kickFloor)) continue;
            // Structure change.
            const hd = [];
            for (let j = lo; j < k; j++) hd.push(this.D[j][b]);
            const rd = d > T.popFloorD ? robust(hd) : null;
            let score = 0, kind = null, mag = 0;
            if (rd) {
                const z = (d - rd[0]) / Math.max(rd[1], 0.5);
                if (z > T.eventSigma && d - rd[0] > Math.max(T.popFloorD, 0.5 * this.tex[b]) && d > 3 * rd[0]) { score = z; kind = 'pop'; mag = d - rd[0]; }
            }
            // Brightness kick.
            const pk = kick(this.P, k, b);
            const steady = this.reliable[k - 1][b] && this.reliable[k][b] && this.reliable[k + 1][b];
            if (Number.isFinite(pk) && steady && Math.abs(pk) > T.flashFloor) {
                const hp = [];
                for (let j = lo; j < k; j++) hp.push(kick(this.P, j, b));
                const rp = robust(hp);
                if (rp) {
                    const z = Math.abs(pk - rp[0]) / Math.max(rp[1], 0.5);
                    if (z > T.eventSigma && Math.abs(pk) > T.flashFloor && z > score) { score = z; kind = 'flash'; mag = pk; }
                }
            }
            // Motion kick: the change in V into this pair against the last second's.
            const vx = this.V[k][2 * b], vy = this.V[k][2 * b + 1], px = this.V[k - 1][2 * b], py = this.V[k - 1][2 * b + 1];
            const relK = (j) => this.reliable[j][b] === 1 && this.reliable[j - 1][b] === 1;
            if (relK(k) && ak0 > T.kickFloor) {
                const a = Math.hypot(vx - px, vy - py);
                const ha = [];
                for (let j = lo; j < k; j++) if (relK(j)) ha.push(Math.hypot(this.V[j][2 * b] - this.V[j - 1][2 * b], this.V[j][2 * b + 1] - this.V[j - 1][2 * b + 1]));
                const ra = robust(ha);
                if (ra) {
                    const z = (a - ra[0]) / Math.max(ra[1], 0.1);
                    if (z > T.eventSigma && a > T.kickFloor && a > 3 * ra[0] && z > score) { score = z; kind = 'kick'; mag = a; }
                }
            }
            if (kind) flags.set(b, { kind, z: score, mag });
        }
        // Join neighbours into events.
        const seen = new Set();
        for (const [b] of flags) {
            if (seen.has(b)) continue;
            const stack = [b], blocks = [];
            seen.add(b);
            while (stack.length) {
                const c = stack.pop();
                blocks.push(c);
                const cx = c % this.nx, cy = (c / this.nx) | 0;
                for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) {
                    const x = cx + u, y = cy + v;
                    if (x < 0 || y < 0 || x >= this.nx || y >= this.ny) continue;
                    const n = y * this.nx + x;
                    if (flags.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
                }
            }
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zmax = 0, top = null;
            const kinds = {};
            for (const c of blocks) {
                const [x, y] = this.blockCentre(c), f = flags.get(c);
                x0 = Math.min(x0, x - 8); y0 = Math.min(y0, y - 8); x1 = Math.max(x1, x + 8); y1 = Math.max(y1, y + 8);
                kinds[f.kind] = (kinds[f.kind] || 0) + 1;
                if (f.z > zmax) { zmax = f.z; top = f; }
            }
            const kind = Object.entries(kinds).sort((p, q) => q[1] - p[1])[0][0];
            // A motion kick is a part of the picture jumping: several blocks
            // together. One or two kicking blocks are the matcher's mistakes.
            if (kind === 'kick' && blocks.length < 4) continue;
            const centre = [(x0 + x1) / 2, (y0 + y1) / 2];
            const ev = { frame: k + 1, pair: k, kind, blocks: blocks.length, z: zmax, mag: top.mag, box: [x0, y0, x1, y1], centre,
                         region: this.regionOf(blocks[0], k + 1), meta: this.meta[k + 1],
                         score: zmax * Math.sqrt(blocks.length) };
            this.events.push(ev);
            this.pending.push(ev);
        }
        this.flushPending();
    }

    // Crops: an event at frame f (pair f-1 -> f) wants frames f-1, f, f+1.
    // When detect() runs, the newest frame is k+2 (pairs 0..k+1 exist) and
    // the ring holds frames k, k+1, k+2 = f-1, f, f+1: crop right away.
    flushPending() {
        for (const ev of this.pending) {
            if (this.ring.length < 3) continue;
            const cw = 200, ch = 150, W = this.W, H = this.H;
            const x0 = Math.max(0, Math.min(W - cw, Math.round(ev.centre[0] - cw / 2)));
            const y0 = Math.max(0, Math.min(H - ch, Math.round(ev.centre[1] - ch / 2)));
            ev.crop = { x0, y0, w: cw, h: ch, px: this.ring.map((f) => {
                const o = new Uint8Array(cw * ch * 4);
                for (let y = 0; y < ch; y++) o.set(f.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + cw) * 4), y * cw * 4);
                return o;
            }) };
        }
        this.pending = [];
        // Keep crops only for the strongest events (memory).
        if (this.events.length > 60) {
            const keep = new Set([...this.events].sort((p, q) => q.score - p.score).slice(0, 40));
            for (const e of this.events) if (!keep.has(e)) e.crop = null;
        }
    }

    // Per-block series statistics.
    blockStats() {
        const N = this.V.length, nb = this.nb, fps = this.o.fps;
        const st = [];
        for (let b = 0; b < nb; b++) {
            let n = 0, mx = 0, my = 0;
            const ok = (k) => this.reliable[k][b] === 1;
            for (let k = 0; k < N; k++) if (ok(k)) { n++; mx += this.V[k][2 * b]; my += this.V[k][2 * b + 1]; }
            const valid = N ? n / N : 0;
            const s = { b, valid, tex: this.tex[b] };
            if (n > 0.7 * N && N > 4) {
                mx /= n; my /= n;
                let sv = 0, sd = 0, nd = 0, cxx = 0, cxy = 0, cyy = 0, s3 = 0, n3 = 0;
                for (let k = 0; k < N; k++) {
                    if (!ok(k)) continue;
                    const x = this.V[k][2 * b] - mx, y = this.V[k][2 * b + 1] - my;
                    sv += x * x + y * y; cxx += x * x; cxy += x * y; cyy += y * y;
                    if (k > 1 && ok(k - 1) && ok(k - 2)) {
                        const ux = this.V[k][2 * b] - 2 * this.V[k - 1][2 * b] + this.V[k - 2][2 * b];
                        const uy = this.V[k][2 * b + 1] - 2 * this.V[k - 1][2 * b + 1] + this.V[k - 2][2 * b + 1];
                        s3 += ux * ux + uy * uy; n3++;
                    }
                    if (k && ok(k - 1)) {
                        const ux = this.V[k][2 * b] - this.V[k - 1][2 * b], uy = this.V[k][2 * b + 1] - this.V[k - 1][2 * b + 1];
                        sd += ux * ux + uy * uy; nd++;
                    }
                }
                const rv = Math.sqrt(sv / n), rd = Math.sqrt(sd / Math.max(nd, 1));
                s.motion = rv;
                s.mean = [mx, my];
                s.wiggle = rv > 1e-4 ? fps / Math.PI * Math.asin(Math.min(1, rd / (2 * rv))) : 0;
                // White positional noise sigma gives rms(d2V) = sqrt(20) sigma;
                // a smooth sway at f Hz almost none ((2 pi f / fps)^2 of its speed).
                s.jitter = Math.sqrt(s3 / Math.max(n3, 1)) / Math.sqrt(20);
                // The main axis of its motion.
                const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
                s.axis = Math.cos(ang) >= 0 ? [Math.cos(ang), Math.sin(ang)] : [-Math.cos(ang), -Math.sin(ang)];
            }
            // Brightness along the motion.
            let np = 0, sp = 0, spd = 0, npd = 0, mp = 0, sp3 = 0, np3 = 0;
            for (let k = 0; k < N; k++) { const p = this.P[k][b]; if (Number.isFinite(p)) { np++; mp += p; } }
            if (np > 0.7 * N && N > 4) {
                mp /= np;
                for (let k = 0; k < N; k++) {
                    const p = this.P[k][b];
                    if (!Number.isFinite(p)) continue;
                    sp += (p - mp) * (p - mp);
                    if (k && Number.isFinite(this.P[k - 1][b])) { const d = p - this.P[k - 1][b]; spd += d * d; npd++; }
                    if (k > 1 && Number.isFinite(this.P[k - 1][b]) && Number.isFinite(this.P[k - 2][b])) {
                        const d = p - 2 * this.P[k - 1][b] + this.P[k - 2][b];
                        sp3 += d * d; np3++;
                    }
                }
                const rp = Math.sqrt(sp / np), rpd = Math.sqrt(spd / Math.max(npd, 1));
                // Brightness noise along the motion (levels), as jitter above.
                s.flicker = Math.sqrt(sp3 / Math.max(np3, 1)) / Math.sqrt(20);
                s.flickerWiggle = rp > 1e-4 ? fps / Math.PI * Math.asin(Math.min(1, rpd / (2 * rp))) : 0;
            }
            let dsum = 0, dn = 0;
            for (let k = 0; k < N; k++) { const d = this.D[k][b]; if (Number.isFinite(d)) { dsum += d; dn++; } }
            s.structure = dn ? dsum / dn : NaN;
            st.push(s);
        }
        return st;
    }

    // A block's displacement along its main axis (or `axis`), detrended and
    // normalised to unit energy.
    series(s, axis) {
        const N = this.V.length, ax = axis || s.axis, x = new Float32Array(N);
        if (!N) return x;
        let acc = 0;
        for (let k = 0; k < N; k++) {
            let vx = this.V[k][2 * s.b], vy = this.V[k][2 * s.b + 1];
            if (this.reliable[k][s.b] !== 1) { vx = s.mean[0]; vy = s.mean[1]; }
            acc += (vx - s.mean[0]) * ax[0] + (vy - s.mean[1]) * ax[1];
            x[k] = acc;
        }
        const mt = (N - 1) / 2;
        let mx = 0, sxx = 0, sxy = 0;
        for (let k = 0; k < N; k++) mx += x[k];
        mx /= N;
        for (let k = 0; k < N; k++) { sxx += (k - mt) * (k - mt); sxy += (k - mt) * (x[k] - mx); }
        const bb = sxx > 0 ? sxy / sxx : 0, a = mx - bb * mt;
        let ss = 0;
        for (let k = 0; k < N; k++) { x[k] -= a + bb * k; ss += x[k] * x[k]; }
        const n = Math.sqrt(ss) || 1;
        for (let k = 0; k < N; k++) x[k] /= n;
        return x;
    }

    /** How region `a`'s motion matches region `b`'s: the median over block
     *  pairs of the peak correlation and its lag (frames, b after a), along
     *  `axis` (screen, default x). */
    regionCorrelation(a, b, axis = [1, 0]) {
        const st = this.stats || this.blockStats(), N = this.V.length, mid = N >> 1;
        const pick = (name) => st.filter((s) => s.motion > 0.3 && s.valid > 0.9 && this.regionOf(s.b, mid) === name).slice(0, 30);
        const A = pick(a).map((s) => this.series(s, axis)), Bs = pick(b).map((s) => this.series(s, axis));
        const L = Math.min(Math.round(this.o.fps), N >> 2), corr = [], lag = [];
        for (const x of A) for (const y of Bs) {
            let best = -2, bl = 0;
            for (let l = -L; l <= L; l++) {
                let s = 0;
                for (let k = Math.max(0, -l); k < Math.min(N, N - l); k++) s += x[k] * y[k + l];
                if (s > best) { best = s; bl = l; }
            }
            corr.push(best); lag.push(bl);
        }
        return { corr: median(corr), lag: median(lag), pairs: corr.length };
    }

    // Pairwise coherence of the moving blocks (static views).
    coherence(st, regionName) {
        const N = this.V.length, fps = this.o.fps, T = THRESHOLDS;
        let cand = st.filter((s) => s.motion > 0.3 && s.valid > 0.9 && s.wiggle < 5 &&
                                    (regionName === undefined || this.regionOf(s.b, 0) === regionName));
        if (cand.length < 6 || N < 40) return null;
        const step = Math.max(1, Math.ceil(cand.length / 120));
        cand = cand.filter((_, i) => i % step === 0);
        const X = cand.map((s) => this.series(s));
        const L = Math.min(Math.round(fps), N >> 2);
        const bins = [[0, 64, 'near (<64 px)'], [64, 192, 'mid (64-192 px)'], [192, 480, 'far (192-480 px)'], [480, 1e9, 'farthest (>480 px)']];
        const res = bins.map(() => ({ corr: [], lag: [], dxLag: [] }));
        for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
            const [xi, yi] = this.blockCentre(cand[i].b), [xj, yj] = this.blockCentre(cand[j].b);
            const sep = Math.hypot(xi - xj, yi - yj);
            const bi = bins.findIndex((q) => sep >= q[0] && sep < q[1]);
            let best = -2, bl = 0;
            const A = X[i], Bv = X[j];
            for (let l = -L; l <= L; l++) {
                let s = 0;
                for (let k = Math.max(0, -l); k < Math.min(N, N - l); k++) s += A[k] * Bv[k + l];
                if (s > best) { best = s; bl = l; }
            }
            res[bi].corr.push(best);
            res[bi].lag.push(Math.abs(bl));
            if (Math.abs(xi - xj) > 64) res[bi].dxLag.push([xj - xi, bl]);
        }
        const out = bins.map((q, i) => {
            const r = res[i];
            if (!r.corr.length) return null;
            // Travel: lag (frames) per px of x separation, as a speed (px/s).
            let sxy = 0, sxx = 0;
            for (const [d, l] of r.dxLag) { sxy += d * l; sxx += d * d; }
            const slope = sxx ? sxy / sxx : 0;
            return { bin: q[2], pairs: r.corr.length, corr: median(r.corr), corrP10: pctl(r.corr, 0.1),
                     lagFrames: median(r.lag), travelPxPerS: Math.abs(slope) > 1e-4 ? fps / slope : Infinity };
        }).filter(Boolean);
        const near = out.find((o) => o.bin.startsWith('near')), far = out.filter((o) => o.bin.startsWith('far'));
        const flags = [];
        for (const f of far) if (f.corr > T.lockstepCorr && f.lagFrames <= 2)
            flags.push(`LOCKSTEP ${regionName || 'view'}: blocks ${f.bin} apart move together (median corr ${fx(f.corr)} at lag ${f.lagFrames} frames)`);
        if (near && near.corr < T.incoherentCorr)
            flags.push(`INCOHERENT ${regionName || 'view'}: neighbouring blocks do not move together (median corr ${fx(near.corr)})`);
        return { blocks: cand.length, bins: out, flags };
    }

    /** Analyse, draw the sheets, write the files. Returns the summary. */
    finish() {
        const o = this.o, T = THRESHOLDS, fps = o.fps, N = this.V.length;
        this.flushPending();
        const st = this.blockStats();
        const regionNames = [...new Set([...(o.regions || []).map((r) => r.name),
                                         ...(o.regionAt ? (o.regionAt(0) || []).map((r) => r.name) : [])])];
        const groups = regionNames.length ? regionNames : [null];
        const lines = [`motion oracle: ${o.name}  (${this.frames} frames at ${fps} fps, ${(this.frames / fps).toFixed(1)} s; ` +
                       `view ${this.W}x${this.H}; block 16 px)`];
        for (const n of o.notes) lines.push('  ' + n);
        const regions = {};
        const flags = [];
        // Per-region block statistics (a block's region: where it is at the run's middle frame).
        const mid = N >> 1;
        for (const name of groups) {
            const bs = st.filter((s) => (name === null ? true : this.regionOf(s.b, mid) === name));
            const moving = bs.filter((s) => s.motion > T.movingFloor);
            const tracked = bs.filter((s) => s.motion !== undefined);
            const noisy = moving.filter((s) => s.wiggle > T.noiseWiggle && s.jitter > T.noiseJitter);
            const jittery = moving.filter((s) => s.jitter > T.noiseJitter);
            const flick = bs.filter((s) => s.flicker > T.flickerLevels && s.flickerWiggle > T.flickerWiggle);
            const ev = this.events.filter((e) => name === null || e.region === name);
            const r = {
                blocks: bs.length, tracked: tracked.length, moving: moving.length,
                lost: bs.filter((s) => s.motion === undefined && s.tex >= T.lostTexture).length,
                motionMedian: median(moving.map((s) => s.motion)), motionP90: pctl(moving.map((s) => s.motion), 0.9),
                wiggleMedian: median(moving.map((s) => s.wiggle)), wiggleP90: pctl(moving.map((s) => s.wiggle), 0.9),
                jitterP90: pctl(moving.map((s) => s.jitter), 0.9),
                flickerP90: pctl(bs.filter((s) => s.flicker !== undefined).map((s) => s.flicker), 0.9),
                noisyBlocks: noisy.length, jitterBlocks: jittery.length, flickerBlocks: flick.length,
                events: { pop: ev.filter((e) => e.kind === 'pop').length, flash: ev.filter((e) => e.kind === 'flash').length,
                          kick: ev.filter((e) => e.kind === 'kick').length },
            };
            if (!o.cameraMoving) r.coherence = this.coherence(st, name === null ? undefined : name);
            regions[name || 'view'] = r;
            const tag = name || 'view';
            if (moving.length && noisy.length / moving.length > 0.15)
                flags.push(`NOISE ${tag}: ${noisy.length}/${moving.length} moving blocks wiggle like noise (> ${T.noiseWiggle} Hz, jitter > ${T.noiseJitter} px); wiggle p90 ${fx(r.wiggleP90, 1)} Hz`);
            else if (moving.length && jittery.length / moving.length > 0.15)
                flags.push(`JITTER ${tag}: ${jittery.length}/${moving.length} moving blocks shake frame to frame (jitter > ${T.noiseJitter} px; p90 ${fx(r.jitterP90)} px, wiggle p90 ${fx(r.wiggleP90, 1)} Hz)`);
            if (bs.length && flick.length / bs.length > 0.05)
                flags.push(`FLICKER ${tag}: ${flick.length}/${bs.length} blocks flicker (brightness noise > ${T.flickerLevels} levels faster than ${T.flickerWiggle} Hz); p90 ${fx(r.flickerP90)} levels`);
            const ne = ev.length;
            if (ne) flags.push(`EVENTS ${tag}: ${r.events.pop} pop, ${r.events.flash} flash, ${r.events.kick} kick (${(ne / (this.frames / fps)).toFixed(2)} a second)`);
            if (r.coherence) flags.push(...r.coherence.flags);
        }
        for (const [name, r] of Object.entries(regions)) {
            lines.push(`region ${name}: ${r.blocks} blocks, ${r.tracked} tracked, ${r.moving} moving, ${r.lost} lost`);
            lines.push(`  motion px/frame median ${fx(r.motionMedian)} p90 ${fx(r.motionP90)}; wiggle Hz median ${fx(r.wiggleMedian, 1)} p90 ${fx(r.wiggleP90, 1)}; ` +
                       `jitter p90 ${fx(r.jitterP90)} px; flicker p90 ${fx(r.flickerP90)} levels`);
            lines.push(`  noise-like blocks ${r.noisyBlocks}, jittery ${r.jitterBlocks}, flickering ${r.flickerBlocks}; events pop ${r.events.pop} flash ${r.events.flash} kick ${r.events.kick}`);
            if (r.coherence) for (const c of r.coherence.bins)
                lines.push(`  coherence ${c.bin.padEnd(20)} ${String(c.pairs).padStart(6)} pairs: corr median ${fx(c.corr)} p10 ${fx(c.corrP10)}, lag ${c.lagFrames} frames` +
                           (Number.isFinite(c.travelPxPerS) ? `, travel ${fx(c.travelPxPerS, 0)} px/s` : ''));
        }
        // Rank events.
        const ranked = [...this.events].sort((p, q) => q.score - p.score);
        ranked.forEach((e, i) => { e.rank = i + 1; });
        lines.push(`flags (${flags.length}):`);
        for (const f of flags) lines.push('  ' + f);
        lines.push(`top events (of ${this.events.length}; score = robust z x sqrt(blocks)):`);
        for (const e of ranked.slice(0, 20)) {
            const m = o.eventMeta ? o.eventMeta(e.meta || {}) : '';
            lines.push(`  #${e.rank} ${e.kind.padEnd(5)} frame ${e.frame} t=${fx((e.meta && e.meta.t !== undefined) ? e.meta.t : e.frame / fps)}s ` +
                       `at (${e.centre.map((v) => v.toFixed(0)).join(',')}) px, ${e.blocks} blocks, z ${e.z.toFixed(1)}, ` +
                       `${e.kind === 'kick' ? 'dV' : e.kind === 'flash' ? 'dP' : 'D'} ${e.mag.toFixed(1)}${e.region ? ' [' + e.region + ']' : ''}${m ? ' ' + m : ''}`);
        }
        this.summary = { name: o.name, frames: this.frames, fps, regions, flags, events: ranked.slice(0, 40).map((e) => (
            { rank: e.rank, kind: e.kind, frame: e.frame, t: e.meta && e.meta.t, centre: e.centre, box: e.box, blocks: e.blocks, z: +e.z.toFixed(2),
              mag: +e.mag.toFixed(2), region: e.region, meta: o.eventMeta ? o.eventMeta(e.meta || {}) : undefined })) };
        this.stats = st;
        this.ranked = ranked;
        const files = [this.drawOverview(st, ranked)];
        if (ranked.some((e) => e.crop)) files.push(this.drawEvents(ranked));
        files.push(...this.drawSlitPages(st, ranked));
        if (o.extraLines) lines.push(...o.extraLines);
        lines.push('files:', ...files.map((f) => '  ' + f));
        const fs = require('fs');
        fs.writeFileSync(`${o.out}/${o.name}_motion.txt`, lines.join('\n') + '\n');
        fs.writeFileSync(`${o.out}/${o.name}_motion.json`, JSON.stringify(this.summary, null, 1));
        console.log(lines.join('\n'));
        return this.summary;
    }
}

Object.assign(MotionRun.prototype, motionSheetMethods);
