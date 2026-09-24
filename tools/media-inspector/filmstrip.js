// filmstrip.js — the bro.media.thumbnails lane: every grabbed frame in its
// own cell with its timestamp, the frame nearest the playhead outlined, a
// needle at the playhead, a hover tooltip, click to seek to a frame.

import { fitCanvas } from "/lib/kit/gauges.js";
import { h } from "/lib/kit/dom.js";

const C = {
    bg: '#0e1118', border: '#2b3248', badge: 'rgba(15, 23, 42, 0.85)', badgeText: '#cbd5e1',
    active: '#38bdf8', hover: '#a78bfa', playhead: '#f43f5e',
};
const BADGE = 16;

/** The strip's pixels as a canvas (one ImageData, every thumbnail side by side). */
export function stripCanvas(strip) {
    const W = strip.width * strip.count;
    const c = document.createElement('canvas');
    c.width = W; c.height = strip.height;
    // ImageData wants clamped bytes; bro.media hands back a Uint8Array
    // (ENGINE-ISSUES.md), so view the same buffer either way.
    const d = strip.data;
    const bytes = d instanceof Uint8ClampedArray ? d : new Uint8ClampedArray(d.buffer, d.byteOffset, d.length);
    c.getContext('2d').putImageData(new ImageData(bytes, W, strip.height), 0, 0);
    return c;
}

/**
 * opts: { onSeek(t), tooltipHost (element the tooltip is positioned in) }.
 * Handle: setData(strip, span { from, to }, duration), setPlayhead(t),
 * activeIndex(), frameAt(x), strip, span, render().
 */
export function createFilmstrip(canvas, opts) {
    const o = opts || {};
    const s = { strip: null, image: null, from: 0, to: 0, duration: 0, playhead: 0, hover: -1 };
    let w = 0, hgt = 0;
    const host = o.tooltipHost || canvas.parentElement;
    const tip = h('div.filmstrip-tip', { hidden: true });
    host.appendChild(tip);

    function render() {
        const fit = fitCanvas(canvas);
        const ctx = fit.ctx;
        w = fit.w; hgt = fit.h;
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, hgt);
        const st = s.strip;
        if (!st || !st.count) {
            ctx.fillStyle = '#4a5568'; ctx.font = '12px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(s.duration ? 'No video track: audio-only media' : 'Load a video to see its filmstrip', w / 2, hgt / 2);
            return;
        }
        const cellW = w / st.count, cellH = hgt - BADGE;
        for (let i = 0; i < st.count; i++) {
            const x = i * cellW, hot = i === s.hover;
            ctx.drawImage(s.image, i * st.width, 0, st.width, st.height, x, 0, cellW, cellH);
            ctx.strokeStyle = hot ? C.hover : C.border; ctx.lineWidth = hot ? 2 : 1;
            ctx.strokeRect(x, 0, cellW, cellH);
            ctx.fillStyle = hot ? '#312e81' : C.badge; ctx.fillRect(x, cellH, cellW, BADGE);
            ctx.fillStyle = hot ? '#e0e7ff' : C.badgeText;
            ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText((st.times[i] || 0).toFixed(2) + 's', x + cellW / 2, cellH + BADGE / 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(x + 2, 2, 18, 12);
            ctx.fillStyle = '#94a3b8'; ctx.font = '8px monospace';
            ctx.fillText('#' + (i + 1), x + 11, 8);
        }
        const active = api.activeIndex();
        if (active >= 0) {
            ctx.strokeStyle = C.active; ctx.lineWidth = 2;
            ctx.strokeRect(active * cellW + 1, 1, cellW - 2, cellH - 2);
        }
        // The needle maps the playhead onto the strip's span, not its first/last grab.
        if (s.to > s.from && s.playhead >= s.from && s.playhead <= s.to) {
            const x = ((s.playhead - s.from) / (s.to - s.from)) * w;
            ctx.strokeStyle = C.playhead; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hgt); ctx.stroke();
        }
    }

    const frameAt = (clientX) => {
        const st = s.strip;
        if (!st || !st.count) return -1;
        const r = canvas.getBoundingClientRect();
        const i = Math.floor(((clientX - r.left) / r.width) * st.count);
        return i >= 0 && i < st.count ? i : -1;
    };

    canvas.addEventListener('mousemove', (e) => {
        const i = frameAt(e.clientX);
        if (i !== s.hover) { s.hover = i; render(); }
        if (i < 0) { tip.hidden = true; return; }
        const st = s.strip, r = canvas.getBoundingClientRect();
        tip.textContent = st.times[i].toFixed(3) + 's · frame ' + (i + 1) + '/' + st.count + ' · ' + st.width + 'x' + st.height;
        tip.style.left = Math.max(8, Math.min(r.width - 180, e.clientX - r.left - 60)) + 'px';
        tip.hidden = false;
    });
    canvas.addEventListener('mouseleave', () => { s.hover = -1; tip.hidden = true; render(); });
    canvas.addEventListener('click', (e) => {
        const i = frameAt(e.clientX);
        if (i >= 0 && o.onSeek) o.onSeek(s.strip.times[i]);
    });

    const api = {
        /** A new strip always rebuilds its image (same-size strips used to keep the stale one). */
        setData(strip, span, duration) {
            s.strip = strip && strip.count ? strip : null;
            s.image = s.strip ? stripCanvas(s.strip) : null;
            s.duration = duration || 0;
            s.from = span && span.from || 0;
            s.to = span && span.to > 0 ? span.to : s.duration;
            s.hover = -1;
            tip.hidden = true;
            render();
        },
        setPlayhead(t) { s.playhead = t; render(); },
        /** The thumbnail nearest the playhead, or -1. */
        activeIndex() {
            const st = s.strip;
            if (!st) return -1;
            let best = -1, bd = Infinity;
            st.times.forEach((t, i) => { const d = Math.abs(t - s.playhead); if (d < bd) { bd = d; best = i; } });
            return best;
        },
        frameAt,
        get strip() { return s.strip; },
        get span() { return { from: s.from, to: s.to }; },
        get image() { return s.image; },
        render,
    };
    render();
    return api;
}
