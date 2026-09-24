// RAVE Lab — the latent curve editor.
//
// One editable contour per latent dimension over `work` (the editable copy of
// the encoded latent, channel-major: row c = work[c*frames .. (c+1)*frames)).
// Drag on a curve to repaint it (a continuous sweep, gaps filled by linear
// interpolation); per-row buttons do the common moves (reset / smooth /
// flatten / invert / nudge). Each edit calls onEdit (the app debounces a
// re-decode); a finished drag calls onCommit.
//
// RAVE's latent axes are PCA-sorted by variance, so the first rows carry the
// big interpretable controls (loudness, pitch) and later rows carry timbre.

import { h, clear } from "/lib/kit/dom.js";
import { fitCanvas } from "/lib/kit/audio-ui.js";

const PAD = 6;
const HUES = [42, 198, 150, 280, 16, 100, 320, 222];

const dimLabel = (c) => 'dim ' + c + (c === 0 ? ' · loudness' : c === 1 ? ' · pitch' : ' · timbre');
const dimColor = (c) => 'hsl(' + HUES[c % HUES.length] + ',70%,64%)';

/**
 * Build the editor into `host` for an encode `enc` ({ latent, nLatent, frames })
 * and its editable copy `work`. opts: { onEdit(c), onCommit(), locked() }.
 * Handle: redraw(c), redrawAll(), op(name, c, arg?), paint(c, points) (a
 * drag from test code: [{ x, y }] in 0..1 canvas fractions), ranges, cells.
 */
export function curveEditor(host, enc, work, opts) {
    const o = opts || {};
    const locked = () => !!(o.locked && o.locked());
    const row = (c) => work.subarray(c * enc.frames, (c + 1) * enc.frames);
    const orig = (c) => enc.latent.subarray(c * enc.frames, (c + 1) * enc.frames);

    // A fixed vertical frame per dim, from the ORIGINAL curve with headroom,
    // so a drag always has room and the frame is stable across edits.
    const ranges = [];
    for (let c = 0; c < enc.nLatent; c++) {
        const d = orig(c);
        let mn = Infinity, mx = -Infinity;
        for (let t = 0; t < d.length; t++) { if (d[t] < mn) mn = d[t]; if (d[t] > mx) mx = d[t]; }
        const mid = (mn + mx) / 2, half = Math.max((mx - mn) / 2, 0.5) * 1.8;
        ranges.push([mid - half, mid + half]);
    }

    const OPS = {
        reset: (c) => row(c).set(orig(c)),
        flatten: (c) => { const d = row(c); d.fill(mean(d)); },
        invert: (c) => { const d = row(c), m = mean(d); for (let t = 0; t < d.length; t++) d[t] = 2 * m - d[t]; },
        smooth: (c) => {
            const d = row(c), n = d.length, s = Float32Array.from(d);
            for (let t = 0; t < n; t++) d[t] = (s[Math.max(0, t - 1)] + 2 * s[t] + s[Math.min(n - 1, t + 1)]) / 4;
        },
        nudge: (c, dv) => { const d = row(c); for (let t = 0; t < d.length; t++) d[t] += dv; },
    };

    function draw(c) {
        const cell = cells[c];
        const { ctx, w, h: hh } = fitCanvas(cell.cv, { minWidth: 200 });
        const [mn, mx] = ranges[c], span = (mx - mn) || 1;
        const y = (v) => hh - PAD - ((v - mn) / span) * (hh - 2 * PAD);
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, w, hh);
        if (mn < 0 && mx > 0) {
            ctx.strokeStyle = '#1b2330';
            ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
        }
        const plot = (d, style, lw) => {
            ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath();
            for (let x = 0; x < w; x++) {
                const v = d[Math.floor(x * d.length / w)];
                if (x === 0) ctx.moveTo(x, y(v)); else ctx.lineTo(x, y(v));
            }
            ctx.stroke();
        };
        plot(orig(c), '#39414f', 1);          // ghost of the encoded curve
        plot(row(c), dimColor(c), 1.6);       // the edited contour
        ctx.lineWidth = 1;
        const d = row(c), od = orig(c);
        let lo = Infinity, hi = -Infinity, delta = 0;
        for (let t = 0; t < d.length; t++) { if (d[t] < lo) lo = d[t]; if (d[t] > hi) hi = d[t]; delta += Math.abs(d[t] - od[t]); }
        cell.stats.textContent = lo.toFixed(2) + ' … ' + hi.toFixed(2) + (delta > 1e-4 ? ' · Δ' + delta.toFixed(1) : '');
    }

    function op(name, c, arg) {
        if (locked()) return;
        OPS[name](c, arg);
        draw(c);
        if (o.onEdit) o.onEdit(c);
    }

    // ── freehand drag ─────────────────────────────────────────────────────
    let drag = null;     // { c, lastI, lastV }
    function paintFrac(c, xf, yf) {
        const d = row(c), n = d.length, [mn, mx] = ranges[c];
        const hh = cells[c].cv.clientHeight || 96;
        const i = Math.floor(Math.max(0, Math.min(0.99999, xf)) * n);
        const v = mn + ((hh - PAD - yf * hh) / (hh - 2 * PAD)) * ((mx - mn) || 1);
        if (drag.lastI >= 0 && drag.lastI !== i) {
            const a = Math.min(drag.lastI, i), b = Math.max(drag.lastI, i);
            const va = drag.lastI < i ? drag.lastV : v, vb = drag.lastI < i ? v : drag.lastV;
            for (let k = a; k <= b; k++) d[k] = va + (vb - va) * ((k - a) / (b - a));
        } else d[i] = v;
        drag.lastI = i; drag.lastV = v;
        draw(c);
    }
    const fracOf = (c, e) => {
        const r = cells[c].cv.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const onMove = (e) => { if (drag) paintFrac(drag.c, ...fracOf(drag.c, e)); };
    const onUp = () => { if (!drag) return; drag = null; if (o.onCommit) o.onCommit(); };

    clear(host);
    const cells = [];
    for (let c = 0; c < enc.nLatent; c++) {
        const cv = h('canvas');
        const stats = h('span.curve-stats');
        const btn = (label, title, name, arg) => h('button.small', { title, onclick: () => op(name, c, arg) }, label);
        host.appendChild(h('div.curve-cell', { dataset: { dim: c } },
            h('div.curve-head', null, h('span.curve-name', null, dimLabel(c)), stats,
                h('span.curve-tools', null,
                    btn('↺', 'reset to encoded', 'reset'), btn('∼', 'smooth', 'smooth'),
                    btn('─', 'flatten to mean', 'flatten'), btn('⤨', 'invert around mean', 'invert'),
                    btn('▲', 'nudge up (+0.5)', 'nudge', 0.5), btn('▼', 'nudge down (−0.5)', 'nudge', -0.5))),
            cv));
        cv.addEventListener('mousedown', (e) => {
            if (locked()) return;
            e.preventDefault();
            drag = { c, lastI: -1, lastV: 0 };
            if (o.onDragStart) o.onDragStart();
            paintFrac(c, ...fracOf(c, e));
        });
        cells.push({ cv, stats });
    }
    for (let c = 0; c < enc.nLatent; c++) draw(c);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    return {
        redraw: draw,
        redrawAll() { for (let c = 0; c < enc.nLatent; c++) draw(c); },
        op,
        paint(c, points) {
            drag = { c, lastI: -1, lastV: 0 };
            for (const p of points) paintFrac(c, p.x, p.y);
            onUp();
        },
        dispose() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); },
        ranges, cells,
    };
}

function mean(d) {
    let m = 0;
    for (let t = 0; t < d.length; t++) m += d[t];
    return m / d.length;
}
