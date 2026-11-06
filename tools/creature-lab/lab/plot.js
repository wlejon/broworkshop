// Plot frames for the 2D sheets: axes in a box with ticks and grid, and the
// sampling every chart shares (a quantity over a cycle's phase, every steady
// cycle at once, or over the run's time when it has none).

import { text, line, poly, rect, ticks, INK, DIM, FAINT } from "./page.js";

// Axes in box {x, y, w, h}: returns {X(v), Y(v), box}. `x`/`y` are [lo, hi].
export function axes(g, box, { x, y, xlabel = '', ylabel = '', xfmt = (v) => String(v), yfmt = (v) => String(v), xn = 5, yn = 4, band = null } = {}) {
    const L = box.x + 46, R = box.x + box.w - 8, T = box.y + 6, B = box.y + box.h - 22;
    const X = (v) => L + ((v - x[0]) / (x[1] - x[0] || 1)) * (R - L);
    const Y = (v) => B - ((v - y[0]) / (y[1] - y[0] || 1)) * (B - T);
    rect(g, L, T, R - L, B - T, '#fbfaf8', null);
    if (band) {
        const y0 = Math.max(T, Math.min(B, Y(band[1]))), y1 = Math.max(T, Math.min(B, Y(band[0])));
        if (y1 > y0) rect(g, L, y0, R - L, y1 - y0, band[2] || '#e6efe0', null);
    }
    for (const v of ticks(y[0], y[1], yn)) {
        line(g, L, Y(v), R, Y(v), '#e4e1da', 1);
        text(g, yfmt(v), L - 5, Y(v) + 4, { size: 10, color: DIM, align: 'right' });
    }
    for (const v of ticks(x[0], x[1], xn)) {
        line(g, X(v), T, X(v), B, '#ebe8e2', 1);
        text(g, xfmt(v), X(v), B + 13, { size: 10, color: DIM, align: 'center' });
    }
    line(g, L, B, R, B, FAINT, 1);
    line(g, L, T, L, B, FAINT, 1);
    if (xlabel) text(g, xlabel, R, B + 13, { size: 10, color: DIM, align: 'right' });
    if (ylabel) text(g, ylabel, L + 4, T + 11, { size: 10, color: DIM });
    return { X, Y, L, R, T, B };
}

export function curve(g, ax, xs, ys, color = INK, width = 1.5, dash = null) {
    const pts = [];
    for (let i = 0; i < xs.length; i++) pts.push(Number.isFinite(ys[i]) ? [ax.X(xs[i]), ax.Y(ys[i])] : null);
    poly(g, pts, color, width, dash);
}

// The range of a set of arrays (finite values only), padded.
export function rangeOf(arrays, pad = 0.08, minSpan = 1e-3) {
    let lo = Infinity, hi = -Infinity;
    for (const a of arrays) for (const v of a) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return [0, 1];
    const span = Math.max(hi - lo, minSpan);
    return [lo - span * pad, hi + span * pad];
}

// The time base of a run's charts: every steady cycle sampled at `n` even
// phases ({ phases, cycles: [[step...]] , mode: 'phase' }), or with no cycle
// the run's steps at `n` even times ({ mode: 'time', xs (s), cycles: [[step...]] }).
export function timeBase(rec, cyc, n = 101) {
    if (cyc && cyc.length) {
        const xs = Array.from({ length: n }, (_, i) => i / (n - 1));
        return { mode: 'phase', xs, cycles: cyc.map((c) => xs.map((p) => Math.min(rec.steps - 1, Math.round(c.a + p * (c.b - c.a))))) };
    }
    const m = Math.min(rec.steps, 600);
    const steps = Array.from({ length: m }, (_, i) => Math.round((i * (rec.steps - 1)) / (m - 1)));
    return { mode: 'time', xs: steps.map((k) => k * rec.dt), cycles: [steps] };
}

// The mean over cycles of f(step) at each sample.
export function meanOver(base, f) {
    return base.xs.map((_, i) => {
        let s = 0;
        for (const c of base.cycles) s += f(c[i]);
        return s / base.cycles.length;
    });
}
