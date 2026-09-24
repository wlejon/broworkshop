// lib/kit/gauges.js — live-value widgets: a meter bar, a scrolling line plot,
// and the HiDPI canvas sizing every canvas widget uses. Audio labs, process
// monitors and dashboards share them; audio-specific scopes and waveforms
// are in audio-ui.js.
//
//   import { levelMeter, historyPlot, fitCanvas } from "/lib/kit/gauges.js";
//   const cpu = levelMeter('#cpu', { max: 100 });   cpu.set(pct);
//   const plot = historyPlot('#load', { max: 1, ref: 0.5 });
//   plot.push(v); plot.draw();
//
// Canvas widgets draw in CSS pixels on a devicePixelRatio backing store
// (fitCanvas), so lines stay crisp on HiDPI screens.

import { h, clear, $ as el } from "./dom.js";

const BG = '#0a0c10', LINE = '#ffd97b';

/**
 * Size a canvas backing store to its CSS box at devicePixelRatio and set the
 * transform so drawing is in CSS pixels. opts: { width, height, minWidth = 1 }
 * (width defaults to the canvas's layout width; height to its layout height).
 * Resizes only when the size or ratio changed. Returns { ctx, w, h }.
 */
export function fitCanvas(target, opts) {
    const canvas = el(target);
    const o = opts || {};
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = Math.max(o.minWidth || 1, Math.round(o.width || canvas.clientWidth || canvas.width || 300));
    const hh = Math.max(1, Math.round(o.height || canvas.clientHeight || canvas.height || 150));
    const f = canvas._kitFit;
    if (!f || f.w !== w || f.h !== hh || f.dpr !== dpr) {
        if (o.height) canvas.style.height = hh + 'px';
        if (o.width) canvas.style.width = w + 'px';
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hh * dpr);
        canvas._kitFit = { w, h: hh, dpr };
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hh };
}

/**
 * A horizontal meter bar (.k-meter) built into `target`.
 * opts: { min = 0, max = 1, curve(t) -> t (e.g. Math.sqrt), mark = false
 * (a second marker, e.g. a noise floor), needle = false (draw a centred
 * marker instead of a fill: bipolar values like pitch bend) }.
 * Handle: set(v), mark(v), color(css), value.
 */
export function levelMeter(target, opts) {
    const node = el(target);
    const o = Object.assign({ min: 0, max: 1, curve: null, mark: false, needle: false }, opts);
    node.classList.add('k-meter');
    clear(node);
    const fill = h(o.needle ? 'i.needle' : 'i.fill');
    node.appendChild(fill);
    const markEl = o.mark ? h('i.mark') : null;
    if (markEl) node.appendChild(markEl);
    const frac = (v) => {
        let t = (v - o.min) / (o.max - o.min);
        t = Math.max(0, Math.min(1, isFinite(t) ? t : 0));
        return o.curve ? Math.max(0, Math.min(1, o.curve(t))) : t;
    };
    let value = o.min;
    return {
        set(v) {
            value = v;
            const pct = (frac(v) * 100).toFixed(1) + '%';
            if (o.needle) fill.style.left = pct; else fill.style.width = pct;
        },
        mark(v) { if (markEl) markEl.style.left = (frac(v) * 100).toFixed(1) + '%'; },
        color(c) { fill.style.background = c; },
        get value() { return value; },
        el: node,
    };
}

/**
 * A fixed-range line plot of the last `size` values (nulls break the line),
 * with a reference line: a ratio, a level, a pitch over time.
 * opts: { size = 260, min = 0, max = 1, ref = null, labels = true,
 *         color, fmt(v) -> label, values (an array to plot in place; the
 *         owner may push into it directly) }.
 * Handle: push(v), reset(), draw(), values (the array).
 */
export function historyPlot(target, opts) {
    const canvas = el(target);
    const o = Object.assign({ size: 260, min: 0, max: 1, ref: null, labels: true, color: LINE,
                              fmt: (v) => String(v) }, opts);
    const values = o.values || new Array(o.size).fill(null);
    return {
        values,
        push(v) { values.push(v); if (values.length > o.size) values.shift(); },
        reset() { values.fill(null); },
        draw() {
            const { ctx, w, h: hh } = fitCanvas(canvas);
            ctx.fillStyle = BG;
            ctx.fillRect(0, 0, w, hh);
            const y = (v) => hh - ((v - o.min) / (o.max - o.min)) * hh;
            if (o.ref != null) {
                ctx.strokeStyle = '#26384c'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, y(o.ref) + 0.5); ctx.lineTo(w, y(o.ref) + 0.5); ctx.stroke();
            }
            if (o.labels) {
                ctx.fillStyle = '#4f6a86';
                ctx.font = '9px system-ui';
                ctx.fillText(o.fmt(o.max), 3, 10);
                ctx.fillText(o.fmt(o.min), 3, hh - 3);
                if (o.ref != null) ctx.fillText(o.fmt(o.ref), 3, y(o.ref) - 3);
            }
            ctx.strokeStyle = o.color; ctx.lineWidth = 1.5;
            ctx.beginPath();
            let pen = false;
            for (let i = 0; i < values.length; i++) {
                const v = values[i];
                if (v === null) { pen = false; continue; }
                const px = (i / (o.size - 1)) * w, py = y(Math.max(o.min, Math.min(o.max, v)));
                if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
            }
            ctx.stroke();
            ctx.lineWidth = 1;
        },
        el: canvas,
    };
}
