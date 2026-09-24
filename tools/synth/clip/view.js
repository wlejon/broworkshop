// clip/view.js — the clip editor's waveform canvas.
//
//   click          place the cursor (seeks while playing)
//   drag           select a region
//   double-click   select all
//   wheel          zoom toward the pointer; shift+wheel pans
//   ruler click    seek without touching the selection
//
// DAW-style drawing: a min/max bar per pixel column with the RMS as a
// brighter core, a time ruler whose tick spacing follows the zoom, the
// selection dimming everything outside it, and the cursor (red while
// playing).

import { fitCanvas } from "/lib/kit/gauges.js";
import { fmtTime } from "./doc.js";

const RULER = 18;
const TICKS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];

export function clipView(canvas, doc, { onHover } = {}) {
    let w = 1;
    const s = doc.state;
    const toX = (i) => ((i - s.view.a) / Math.max(1, s.view.b - s.view.a)) * w;
    const toSample = (x) => Math.round(s.view.a + (x / w) * (s.view.b - s.view.a));
    const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: Math.max(0, Math.min(w, e.clientX - r.left)), y: e.clientY - r.top };
    };

    function ruler(ctx) {
        const rate = doc.rate;
        const dur = (s.view.b - s.view.a) / rate;
        const step = TICKS.find((t) => dur / t <= w / 90) || 60;
        const t0 = s.view.a / rate, t1 = s.view.b / rate;
        ctx.strokeStyle = '#1e1e28';
        ctx.beginPath();
        for (let t = Math.ceil(t0 / (step / 4)) * (step / 4); t < t1; t += step / 4) {
            const x = Math.round(toX(t * rate)) + 0.5;
            ctx.moveTo(x, RULER - 3); ctx.lineTo(x, RULER);
        }
        ctx.stroke();
        ctx.strokeStyle = '#2a2a38';
        ctx.fillStyle = '#666';
        ctx.font = '9px monospace';
        ctx.beginPath();
        for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) {
            const x = Math.round(toX(t * rate)) + 0.5;
            ctx.moveTo(x, RULER - 8); ctx.lineTo(x, RULER);
            ctx.fillText(fmtTime(t), x + 3, RULER - 4);
        }
        ctx.moveTo(0, RULER + 0.5); ctx.lineTo(w, RULER + 0.5);
        ctx.stroke();
    }

    function draw() {
        const fit = fitCanvas(canvas);
        const ctx = fit.ctx, hh = fit.h;
        w = fit.w;
        ctx.fillStyle = '#121218';
        ctx.fillRect(0, 0, w, hh);
        ctx.fillStyle = '#0e0e14';
        ctx.fillRect(0, 0, w, RULER);
        const pcm = s.pcm;
        if (!pcm) {
            ctx.fillStyle = '#555';
            ctx.font = '13px system-ui';
            ctx.fillText('No audio loaded', w / 2 - 50, hh / 2 - 10);
            ctx.fillStyle = '#444';
            ctx.font = '11px system-ui';
            ctx.fillText('Load a file, record, or generate a tone.', w / 2 - 105, hh / 2 + 10);
            return;
        }
        const top = RULER, waveH = hh - RULER, mid = top + waveH / 2, half = waveH / 2;
        const span = s.view.b - s.view.a;
        const bins = Math.max(1, Math.min(Math.floor(w), span));
        const per = span / bins, binW = w / bins;
        const mins = new Float32Array(bins), maxs = new Float32Array(bins), rms = new Float32Array(bins);
        let pk = 0;
        for (let i = 0; i < bins; i++) {
            const a = s.view.a + Math.floor(i * per), b = Math.min(pcm.length, s.view.a + Math.floor((i + 1) * per));
            let lo = 1, hi = -1, sq = 0;
            for (let j = a; j < b; j++) { const v = pcm[j]; if (v < lo) lo = v; if (v > hi) hi = v; sq += v * v; }
            if (b <= a) { lo = 0; hi = 0; }
            mins[i] = lo; maxs[i] = hi; rms[i] = b > a ? Math.sqrt(sq / (b - a)) : 0;
            pk = Math.max(pk, Math.abs(lo), Math.abs(hi));
        }
        const scale = pk > 0.001 ? 0.85 / pk : 1;

        if (s.sel) {
            ctx.fillStyle = 'rgba(90,180,255,0.06)';
            ctx.fillRect(toX(s.sel.a), top, toX(s.sel.b) - toX(s.sel.a), waveH);
        }
        ctx.strokeStyle = '#252530';
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
        ctx.strokeStyle = '#1a1a24';
        ctx.beginPath();
        ctx.moveTo(0, mid - half / 2); ctx.lineTo(w, mid - half / 2);
        ctx.moveTo(0, mid + half / 2); ctx.lineTo(w, mid + half / 2);
        ctx.stroke();

        const bw = Math.max(1, binW);
        for (let i = 0; i < bins; i++) {
            const x = i * binW, y0 = mid - maxs[i] * scale * half, y1 = mid - mins[i] * scale * half;
            ctx.fillStyle = '#1a4a5a';
            ctx.fillRect(x, y0, bw, Math.max(1, y1 - y0));
            const r = rms[i] * scale * half;
            if (r > 0.5) { ctx.fillStyle = '#2a90a8'; ctx.fillRect(x, mid - r, bw, r * 2); }
        }
        ctx.strokeStyle = '#40c0d8';
        for (const arr of [maxs, mins]) {
            ctx.beginPath();
            for (let i = 0; i < bins; i++) {
                const x = i * binW + binW / 2, y = mid - arr[i] * scale * half;
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
            ctx.stroke();
        }
        if (s.sel) {
            // dim the waveform outside the selection
            const x1 = toX(s.sel.a), x2 = toX(s.sel.b);
            ctx.fillStyle = 'rgba(18,18,24,0.55)';
            ctx.fillRect(0, top, x1, waveH);
            ctx.fillRect(x2, top, w - x2, waveH);
            ctx.fillStyle = 'rgba(90,180,255,0.7)';
            ctx.fillRect(toX(s.sel.a), top, 1, waveH);
            ctx.fillRect(toX(s.sel.b) - 1, top, 1, waveH);
        }
        ruler(ctx);

        const cx = toX(s.cursor);
        if (cx >= 0 && cx <= w) {
            if (doc.playing) {
                ctx.fillStyle = '#ff4444';
                ctx.fillRect(cx - 1, 0, 2, hh);
                ctx.beginPath(); ctx.moveTo(cx - 4, 0); ctx.lineTo(cx + 4, 0); ctx.lineTo(cx, 6); ctx.closePath(); ctx.fill();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillRect(cx, top, 1, waveH);
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.beginPath(); ctx.moveTo(cx - 3, top); ctx.lineTo(cx + 3, top); ctx.lineTo(cx, top + 5); ctx.closePath(); ctx.fill();
            }
        }
        ctx.fillStyle = '#555';
        ctx.font = '9px monospace';
        ctx.fillText(pk > 0 ? (20 * Math.log10(pk)).toFixed(1) + 'dB' : '-inf', w - 42, RULER + 12);
    }

    // ---- mouse ------------------------------------------------------------------
    let drag = null;       // { x, sample, moved }
    canvas.addEventListener('mousedown', (e) => {
        if (!s.pcm || e.button !== 0) return;
        const p = local(e);
        const at = toSample(p.x);
        if (p.y < RULER) { doc.setCursor(at); return; }
        drag = { x: p.x, sample: at, moved: false };
        doc.clearSelection();
        doc.setCursor(at);
        e.preventDefault();
    });
    canvas.addEventListener('mousemove', (e) => {
        if (!s.pcm) return;
        const p = local(e);
        if (onHover) onHover(toSample(p.x));
        if (!drag) return;
        if (!drag.moved && Math.abs(p.x - drag.x) > 3) drag.moved = true;
        if (drag.moved) doc.select(drag.sample, toSample(p.x));
    });
    const end = () => { drag = null; };
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('dblclick', () => doc.selectAll());
    canvas.addEventListener('wheel', (e) => {
        if (!s.pcm) return;
        e.preventDefault();
        const span = s.view.b - s.view.a;
        if (e.shiftKey) {
            const d = Math.round(span * 0.15) * (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
            doc.setView(s.view.a + d, s.view.b + d);
        } else {
            doc.zoom(e.deltaY < 0 ? 0.7 : 1.4, toSample(local(e).x));
        }
    });

    return { draw, toSample, toX, get width() { return w; } };
}
