// waveform.js — the bro.media.peaks lane: min/max envelope, mirrored RMS
// curve, time ruler, hover readout, playhead. Click / drag scrubs,
// shift-drag selects a region, the wheel zooms the view about the pointer.
//
// The view window [from, to] zooms within the analysed data; a region
// re-analysed at full resolution (app.js "Zoom region") replaces the data.

import { fitCanvas } from "/lib/kit/gauges.js";

const C = {
    bg: '#12151e', ruler: '#2b3248', grid: '#1e2333', text: '#8892b0', center: '#23293d',
    env: 'rgba(59, 130, 246, 0.75)', envHot: '#38bdf8', rms: '#10b981',
    playhead: '#f43f5e', hover: 'rgba(255, 255, 255, 0.35)',
    sel: 'rgba(139, 92, 246, 0.25)', selEdge: '#8b5cf6', selText: '#c4b5fd',
};
const RULER = 22, MIN_SPAN = 0.05;

/** A "nice" tick step (1, 2, 5 x 10^n) near `raw`. */
export function niceStep(raw) {
    const exp = Math.floor(Math.log10(raw)), f = raw / Math.pow(10, exp);
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * Math.pow(10, exp);
}

function tickLabel(t, span) {
    if (span < 2) return t.toFixed(2) + 's';
    if (span < 10) return t.toFixed(1) + 's';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m > 0 ? m + ':' + String(s).padStart(2, '0') : s + 's';
}

/**
 * opts: { onSeek(t), onSelect({ from, to }), onView(from, to) }.
 * Handle: setData(peaks, duration), setPlayhead(t), setView(from, to),
 * zoom(factor, at 0..1), fit(), selection (get/set { from, to } | null),
 * view { from, to }, playhead, duration, peaks, timeAt(x), xAt(t), render().
 */
export function createWaveform(canvas, opts) {
    const o = opts || {};
    const s = { peaks: null, duration: 0, from: 0, to: 0, playhead: 0, sel: null, hover: null };
    let w = 0, hgt = 0, drag = null;

    const span = () => s.to - s.from;
    const xAt = (t) => (span() > 0 ? ((t - s.from) / span()) * w : 0);
    const timeAt = (x) => s.from + Math.max(0, Math.min(1, x / (w || 1))) * span();
    /** The span the data covers (a windowed analysis covers less than the file). */
    const dataSpan = () => {
        const p = s.peaks;
        const a = p && typeof p.from === 'number' ? p.from : 0;
        return [a, p && p.to > a ? p.to : s.duration];
    };

    function render() {
        const fit = fitCanvas(canvas);
        const ctx = fit.ctx;
        w = fit.w; hgt = fit.h;
        const waveH = hgt - RULER, mid = RULER + waveH / 2;
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, hgt);
        ctx.fillStyle = C.ruler; ctx.fillRect(0, 0, w, RULER);
        drawRuler(ctx, waveH);
        ctx.strokeStyle = C.center; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

        if (s.peaks && s.peaks.buckets > 0) drawPeaks(ctx, waveH, mid);
        else {
            ctx.fillStyle = '#4a5568'; ctx.font = '12px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(s.duration ? 'No audio track in this file' : 'Load a media file to see its waveform', w / 2, mid);
        }
        if (s.sel) drawSelection(ctx, waveH);
        if (s.hover != null) drawHover(ctx);
        if (s.duration > 0 && s.playhead >= s.from && s.playhead <= s.to) drawPlayhead(ctx);
    }

    function drawRuler(ctx, waveH) {
        if (span() <= 0) return;
        const step = niceStep(span() / Math.max(4, Math.floor(w / 90)));
        ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        for (let t = Math.ceil(s.from / step) * step; t <= s.to; t += step) {
            const x = xAt(t);
            ctx.strokeStyle = '#475569';
            ctx.beginPath(); ctx.moveTo(x, RULER - 6); ctx.lineTo(x, RULER); ctx.stroke();
            ctx.strokeStyle = C.grid;
            ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, RULER + waveH); ctx.stroke();
            ctx.fillStyle = C.text; ctx.fillText(tickLabel(t, span()), x, 4);
            ctx.strokeStyle = '#334155';
            for (let k = 1; k < 4; k++) {
                const sx = xAt(t + (k * step) / 4);
                if (sx > w) break;
                ctx.beginPath(); ctx.moveTo(sx, RULER - 3); ctx.lineTo(sx, RULER); ctx.stroke();
            }
        }
    }

    function drawPeaks(ctx, waveH, mid) {
        const p = s.peaks, n = p.buckets, half = (waveH / 2) * 0.92;
        const [a, b] = dataSpan();
        const tOf = (i) => a + ((i + 0.5) / n) * (b - a);          // bucket centres over [from, to)
        const barW = Math.max(1, (w * (b - a)) / (n * span()));
        ctx.save();
        ctx.beginPath(); ctx.rect(0, RULER, w, waveH); ctx.clip();
        for (let i = 0; i < n; i++) {
            const x = xAt(tOf(i));
            if (x < -barW || x > w + barW) continue;
            const hi = Math.min(1, Math.max(0, p.max[i])), lo = Math.max(-1, Math.min(0, p.min[i]));
            ctx.fillStyle = hi > 0.8 ? C.envHot : C.env;
            ctx.fillRect(x - barW / 2, mid - hi * half, barW, Math.max(1, (hi - lo) * half));
        }
        ctx.strokeStyle = C.rms; ctx.lineWidth = 2;
        for (const sign of [-1, 1]) {
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const y = mid + sign * Math.min(1, Math.max(0, p.rms[i])) * half;
                if (i === 0) ctx.moveTo(xAt(tOf(i)), y); else ctx.lineTo(xAt(tOf(i)), y);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawSelection(ctx, waveH) {
        const x1 = xAt(Math.min(s.sel.from, s.sel.to)), x2 = xAt(Math.max(s.sel.from, s.sel.to));
        const sw = Math.max(1, x2 - x1);
        ctx.fillStyle = C.sel; ctx.fillRect(x1, RULER, sw, waveH);
        ctx.strokeStyle = C.selEdge; ctx.lineWidth = 1.5; ctx.strokeRect(x1, RULER, sw, waveH);
        ctx.fillStyle = C.selText; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(Math.abs(s.sel.to - s.sel.from).toFixed(3) + 's', x1 + sw / 2, RULER + 14);
    }

    function drawHover(ctx) {
        const x = s.hover, label = timeAt(x).toFixed(3) + 's';
        ctx.strokeStyle = C.hover; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hgt); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px monospace';
        const tw = ctx.measureText(label).width + 8, tx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; ctx.fillRect(tx, RULER + 2, tw, 14);
        ctx.strokeStyle = '#475569'; ctx.strokeRect(tx, RULER + 2, tw, 14);
        ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(label, tx + 4, RULER + 9);
    }

    function drawPlayhead(ctx) {
        const x = xAt(s.playhead), label = s.playhead.toFixed(2) + 's';
        ctx.strokeStyle = C.playhead; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hgt); ctx.stroke();
        ctx.fillStyle = C.playhead;
        ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
        ctx.font = 'bold 10px monospace';
        const bw = ctx.measureText(label).width + 6, bx = Math.max(2, Math.min(w - bw - 2, x - bw / 2));
        ctx.fillRect(bx, 9, bw, 12);
        ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + bw / 2, 15);
    }

    // --- input -------------------------------------------------------------------

    const localX = (e) => e.clientX - canvas.getBoundingClientRect().left;
    const seek = (t) => { api.setPlayhead(t); if (o.onSeek) o.onSeek(t); };

    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || span() <= 0) return;
        const t = timeAt(localX(e));
        if (e.shiftKey) { drag = 'select'; s.sel = { from: t, to: t }; render(); }
        else { drag = 'scrub'; seek(t); }
    });
    window.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        s.hover = inside ? e.clientX - r.left : null;
        if (drag === 'scrub') seek(timeAt(e.clientX - r.left));
        else if (drag === 'select') { s.sel.to = timeAt(e.clientX - r.left); render(); }
        else if (inside || s.hover !== null) render();
    });
    window.addEventListener('mouseup', () => {
        if (drag === 'select') {
            const sel = api.selection;
            if (!sel) s.sel = null;
            render();
            if (sel && o.onSelect) o.onSelect(sel);
        }
        drag = null;
    });
    canvas.addEventListener('mouseleave', () => { if (!drag) { s.hover = null; render(); } });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        api.zoom(e.deltaY < 0 ? 1.25 : 0.8, localX(e) / (w || 1));
    });

    const api = {
        setData(peaks, duration) {
            s.peaks = peaks;
            s.duration = duration || (peaks && peaks.duration) || 0;
            s.sel = null;
            const [a, b] = dataSpan();
            api.setView(a, b || 1);
        },
        setPlayhead(t) { s.playhead = Math.max(0, Math.min(s.duration, t)); render(); },
        /** Show [from, to] (clamped to the file, at least 50 ms). */
        setView(from, to) {
            const d = s.duration || to;
            s.from = Math.max(0, Math.min(from, d - MIN_SPAN));
            s.to = Math.min(d, Math.max(to, s.from + MIN_SPAN));
            render();
            if (o.onView) o.onView(s.from, s.to);
        },
        /** Zoom by `factor` (> 1 in) keeping the time at `at` (0..1 across the lane) fixed. */
        zoom(factor, at) {
            if (!s.duration) return;
            const r = at == null ? 0.5 : Math.max(0, Math.min(1, at));
            const ns = Math.max(MIN_SPAN, Math.min(s.duration, span() / factor));
            const pivot = s.from + span() * r;
            const from = Math.max(0, Math.min(s.duration - ns, pivot - ns * r));
            api.setView(from, from + ns);
        },
        /** Back to the whole analysed span; drops the selection. */
        fit() { s.sel = null; const [a, b] = dataSpan(); api.setView(a, b); },
        get selection() {
            if (!s.sel) return null;
            const from = Math.min(s.sel.from, s.sel.to), to = Math.max(s.sel.from, s.sel.to);
            return to - from < 0.01 ? null : { from, to };
        },
        set selection(v) { s.sel = v ? { from: v.from, to: v.to } : null; render(); },
        get view() { return { from: s.from, to: s.to }; },
        get playhead() { return s.playhead; },
        get duration() { return s.duration; },
        get peaks() { return s.peaks; },
        timeAt, xAt, render,
    };
    render();
    return api;
}
