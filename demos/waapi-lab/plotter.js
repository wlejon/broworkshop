// plotter.js — the requested easing curve, with the engine's MEASURED
// progress plotted on top of it.
//
// The line is what the preset asked for (parsed here from the easing string).
// The dots are (directed iteration fraction, getComputedTiming().progress)
// pairs sampled every frame: what the engine actually applied. When the two
// agree the dots sit on the line. When they don't, the gap is the finding:
// an easing the engine did not honour shows up as dots off the curve.

/** Parse a CSS easing into { kind: 'bezier', p } | { kind: 'steps', n, start }. */
export function parseEasing(str) {
    const s = String(str || 'linear').trim().toLowerCase();
    const named = {
        linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1],
        'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
    };
    if (named[s]) return { kind: 'bezier', p: named[s] };
    let m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(s);
    if (m) return { kind: 'bezier', p: m.slice(1).map(Number) };
    m = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/.exec(s);
    if (m) return { kind: 'steps', n: Math.max(1, +m[1]), start: m[2] === 'start' || m[2] === 'jump-start' };
    if (s === 'step-start') return { kind: 'steps', n: 1, start: true };
    if (s === 'step-end') return { kind: 'steps', n: 1, start: false };
    return { kind: 'bezier', p: named.ease };     // CSS falls back to ease too
}

const bez = (t, a, b) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;

/** The eased value of `x` in [0,1] under a parsed easing. */
export function ease(e, x) {
    if (e.kind === 'steps') {
        const k = Math.floor(x * e.n) + (e.start ? 1 : 0);
        return Math.min(1, k / e.n);
    }
    const [x1, y1, x2, y2] = e.p;
    // Solve bezX(t) = x by bisection (x(t) is monotonic for x1,x2 in [0,1]).
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 40; i++) {
        t = (lo + hi) / 2;
        if (bez(t, x1, x2) < x) lo = t; else hi = t;
    }
    return bez(t, y1, y2);
}

/**
 * Largest |measured - requested| over a trail of {x, y} samples: 0 when the
 * engine honoured the easing, visibly large when it substituted another one.
 */
export function deviation(e, trail) {
    let d = 0;
    for (const s of trail) d = Math.max(d, offCurve(e, s));
    return d;
}

// Distance of a sample from the curve. A step function jumps, and a sample
// taken exactly at a jump may land on either side of it depending on the
// last bit of the float that measured x — both sides count as on the curve.
function offCurve(e, s) {
    const d = Math.abs(s.y - ease(e, s.x));
    if (e.kind !== 'steps') return d;
    const eps = 1e-6;
    return Math.min(d, Math.abs(s.y - ease(e, s.x - eps)), Math.abs(s.y - ease(e, s.x + eps)));
}

const W = 300, H = 200, PX = 26, PY = 26;

/** Draw curve + trail + current point onto a W×H canvas. */
export function drawPlot(canvas, easingStr, trail, cur) {
    const ctx = canvas.getContext('2d');
    const e = parseEasing(easingStr);
    const gw = W - PX * 2, gh = H - PY * 2;
    // y spans -0.25..1.25 so overshooting curves (elastic pop) stay on-canvas.
    const sx = (x) => PX + x * gw;
    const sy = (y) => PY + gh - ((y + 0.25) / 1.5) * gh;

    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1d2330';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const x = sx(i / 4) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, PY); ctx.lineTo(x, PY + gh); ctx.stroke();
    }
    for (const y of [0, 0.5, 1]) {
        ctx.beginPath(); ctx.moveTo(PX, sy(y) + 0.5); ctx.lineTo(PX + gw, sy(y) + 0.5); ctx.stroke();
    }

    // Requested curve.
    ctx.strokeStyle = '#5c9dff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(ease(e, 0)));
    for (let i = 1; i <= 120; i++) { const x = i / 120; ctx.lineTo(sx(x), sy(ease(e, x))); }
    ctx.stroke();

    // Measured samples: green on the curve, amber off it.
    for (const s of trail) {
        const off = offCurve(e, s) > 0.02;
        ctx.fillStyle = off ? '#e6c07f' : '#7fe6a8';
        ctx.fillRect(sx(s.x) - 1.5, sy(s.y) - 1.5, 3, 3);
    }
    if (cur && cur.frac != null && cur.progress != null) {
        ctx.fillStyle = '#ff8585';
        ctx.beginPath(); ctx.arc(sx(cur.frac), sy(cur.progress), 5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#6b7686';
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillText('0', PX - 10, sy(0) + 3);
    ctx.fillText('1', PX - 10, sy(1) + 3);
    ctx.fillText('iteration fraction →', PX, H - 6);
    ctx.fillText('progress', 4, 12);
}

export const PLOT_W = W, PLOT_H = H;
