// A multi-curve painter: N editable contours, each a live plain number[]
// the widget mutates in place (RAVE latent dims, Kokoro's F0 / energy).
//
// cfg (all take (node) or (node, i)):
//   count(node)            number of curves
//   label(node, i)         caption
//   color(node, i)         css color (optional; a default palette)
//   get(node, i)           the LIVE plain number[] for curve i (edited in place;
//                          a plain array so it survives a JSON save)
//   original(node, i)      a ghost baseline number[], or null
//   range(node, i)         fixed [min, max] (optional; else fitted around the
//                          baseline with 1.8x headroom)
//   clamp(node, i, v)      constrain a painted value (optional)
// ctx.onEdit() fires on every drag tick and button op.
//
// Each cell exposes _testMouseDown / _testMouseMove / _testMouseUp so a
// headless test can paint without real mouse events.

import { h, trackDrag } from "/lib/kit/dom.js";

const CURVE_W = 1100, CURVE_H = 96, PAD = 6;
const HUES = [42, 198, 150, 280, 16, 100, 320, 222];

function fitRange(cfg, node, i) {
    const base = (cfg.original && cfg.original(node, i)) || cfg.get(node, i);
    let mn = Infinity, mx = -Infinity;
    for (let t = 0; t < base.length; t++) { if (base[t] < mn) mn = base[t]; if (base[t] > mx) mx = base[t]; }
    if (mn === Infinity) { mn = 0; mx = 1; }
    const c = (mn + mx) / 2, half = Math.max((mx - mn) / 2, 0.5) * 1.8;
    return [c - half, c + half];
}

export function mountCurvePainter(node, cfg, ctx) {
    const root = h('div.curve-panel');
    const count = cfg.count(node);
    const clamp = (i, v) => (cfg.clamp ? cfg.clamp(node, i, v) : v);
    const cells = [];

    function drawCell(i) {
        const cell = cells[i], cv = cell.cv, c2 = cv.getContext('2d'), W = cv.width, H = cv.height;
        const [mn, mx] = cell.range, span = (mx - mn) || 1;
        const yOf = (v) => H - PAD - ((v - mn) / span) * (H - 2 * PAD);
        c2.clearRect(0, 0, W, H);
        if (mn < 0 && mx > 0) {
            c2.strokeStyle = '#1b2330';
            c2.beginPath(); c2.moveTo(0, yOf(0)); c2.lineTo(W, yOf(0)); c2.stroke();
        }
        const plot = (d, style, w) => {
            if (!d || !d.length) return;
            c2.strokeStyle = style; c2.lineWidth = w; c2.beginPath();
            for (let x = 0; x < W; x++) {
                const y = yOf(d[Math.floor(x * d.length / W)]);
                if (x === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
            }
            c2.stroke();
        };
        const orig = cfg.original ? cfg.original(node, i) : null, d = cfg.get(node, i);
        if (orig) plot(orig, '#39414f', 1);
        plot(d, cell.color, 1.6);
        let lo = Infinity, hi = -Infinity, delta = 0;
        for (let t = 0; t < d.length; t++) {
            if (d[t] < lo) lo = d[t];
            if (d[t] > hi) hi = d[t];
            if (orig) delta += Math.abs(d[t] - orig[t]);
        }
        cell.stats.textContent = lo.toFixed(2) + ' … ' + hi.toFixed(2) + (orig && delta > 1e-4 ? '  ·  Δ' + delta.toFixed(1) : '');
    }

    const mean = (d) => { let m = 0; for (let t = 0; t < d.length; t++) m += d[t]; return m / (d.length || 1); };
    const OPS = [
        ['↺', 'reset to original', (i, d) => { const o = cfg.original && cfg.original(node, i); if (o) for (let t = 0; t < d.length; t++) d[t] = o[t]; }],
        ['∼', 'smooth', (i, d) => {
            const s = d.slice(), n = d.length;
            for (let t = 0; t < n; t++) d[t] = (s[Math.max(0, t - 1)] + 2 * s[t] + s[Math.min(n - 1, t + 1)]) / 4;
        }],
        ['─', 'flatten to mean', (i, d) => { const m = mean(d); for (let t = 0; t < d.length; t++) d[t] = m; }],
        ['⤨', 'invert around mean', (i, d) => { const m = mean(d); for (let t = 0; t < d.length; t++) d[t] = clamp(i, 2 * m - d[t]); }],
        ['▲', 'nudge up (+0.5)', (i, d) => { for (let t = 0; t < d.length; t++) d[t] = clamp(i, d[t] + 0.5); }],
        ['▼', 'nudge down (−0.5)', (i, d) => { for (let t = 0; t < d.length; t++) d[t] = clamp(i, d[t] - 0.5); }],
    ];

    function paintAt(i, e, p) {
        if (!p) return;
        const cv = cells[i].cv, rect = cv.getBoundingClientRect();
        const xf = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / (rect.width || 1)));
        const yPix = ((e.clientY - rect.top) / (rect.height || 1)) * CURVE_H;
        const [mn, mx] = cells[i].range;
        const d = cfg.get(node, i), idx = Math.floor(xf * d.length);
        const v = clamp(i, mn + ((CURVE_H - PAD - yPix) / (CURVE_H - 2 * PAD)) * ((mx - mn) || 1));
        if (p.lastI >= 0 && p.lastI !== idx) {
            const a = Math.min(p.lastI, idx), b = Math.max(p.lastI, idx);
            const va = p.lastI < idx ? p.lastV : v, vb = p.lastI < idx ? v : p.lastV;
            for (let k = a; k <= b; k++) d[k] = va + (vb - va) * ((k - a) / ((b - a) || 1));
        } else {
            d[idx] = v;
        }
        p.lastI = idx; p.lastV = v;
        drawCell(i);
        ctx.onEdit();
    }

    for (let i = 0; i < count; i++) {
        const stats = h('span.curve-stats');
        const tools = h('span.curve-tools', null, OPS.map(([label, title, fn]) => h('button.small', {
            title, onclick: () => { fn(i, cfg.get(node, i)); drawCell(i); ctx.onEdit(); },
        }, label)));
        const cv = h('canvas.curve-canvas', { width: CURVE_W, height: CURVE_H });
        const cell = h('div.curve-cell', null, h('div.curve-head', null, h('span.curve-name', null, cfg.label(node, i)), stats, tools), cv);
        root.appendChild(cell);
        cells.push({
            cv, stats,
            color: cfg.color ? cfg.color(node, i) : 'hsl(' + HUES[i % HUES.length] + ',70%,64%)',
            range: cfg.range ? cfg.range(node, i) : fitRange(cfg, node, i),
        });
        drawCell(i);

        let paint = null;
        cv.addEventListener('mousedown', (e) => {
            e.preventDefault();
            paint = { lastI: -1, lastV: 0 };
            paintAt(i, e, paint);
            trackDrag((ev) => paintAt(i, ev, paint), () => { paint = null; });
        });
        cell._testMouseDown = (e) => { paint = { lastI: -1, lastV: 0 }; paintAt(i, e, paint); };
        cell._testMouseMove = (e) => paintAt(i, e, paint);
        cell._testMouseUp = () => { paint = null; };
    }
    return root;
}
