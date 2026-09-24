// lib/kit/audio-ui.js — audio widgets: scopes, waveforms, source pickers,
// transport and mixer strips. Each takes elements already in the page and
// returns a small handle; none of them owns layout. PCM helpers live in
// audio.js; the generic meter bar / line plot / fitCanvas in gauges.js.
//
//   import { waveView, transport } from "/lib/kit/audio-ui.js";
//   const wave = waveView('#wave', { trim: true, onTrim });
//   wave.set({ clip, gain });

import { h, clear, $ as el, fmtClock } from "./dom.js";
import { fitCanvas, levelMeter } from "./gauges.js";

const PAL = {
    bg: '#0a0c10', grid: '#1d2330', text: '#5a657a', wave: '#9aa6bc',
    line: '#ffd97b', fill: '#3c8c63', onset: '#ffb454', sel: '#54d68a',
};

/**
 * A scrolling column scope: one column per pushed value (a chunk peak),
 * newest at the right edge, mirrored about the midline.
 * opts: { history = 1200, color(v) -> css }.
 * Handle: push(v), draw(), clear(), count.
 */
export function peakScope(target, opts) {
    const canvas = el(target);
    const o = Object.assign({ history: 1200, color: null }, opts);
    const buf = new Float32Array(o.history);
    let head = 0, filled = 0;
    const color = o.color || ((p) => 'rgb(60,' + Math.floor(120 + 135 * Math.min(1, p)) + ',120)');
    return {
        push(v) {
            buf[head] = v;
            head = (head + 1) % o.history;
            if (filled < o.history) filled++;
        },
        draw() {
            const { ctx, w, h: hh } = fitCanvas(canvas);
            ctx.fillStyle = '#0c0e12';
            ctx.fillRect(0, 0, w, hh);
            ctx.strokeStyle = PAL.grid;
            ctx.beginPath(); ctx.moveTo(0, hh / 2); ctx.lineTo(w, hh / 2); ctx.stroke();
            const cols = Math.min(filled, w);
            for (let i = 0; i < cols; i++) {
                const p = buf[(head - 1 - i + o.history * 2) % o.history];
                const bar = Math.min(1, p) * (hh / 2 - 6);
                ctx.fillStyle = color(p);
                ctx.fillRect(w - 1 - i, hh / 2 - bar, 1, bar * 2);
            }
        },
        clear() { head = 0; filled = 0; },
        get count() { return filled; },
        el: canvas,
    };
}

/**
 * A triggered oscilloscope of a time-domain buffer (an AnalyserNode's
 * getFloatTimeDomainData, a mic chunk): waits for a rising zero crossing in
 * the first quarter so a steady tone stands still, draws at most one point
 * per pixel, and auto-scales the peak to 80% of the half height (a floor
 * keeps silence from blowing up into noise).
 * opts: { color, bg, autoscale = true, glow = true (a wide faint stroke
 * under the line while there is signal) }.
 * Handle: draw(data) -> { peak, rms }, color (get/set).
 */
export function oscilloscope(target, opts) {
    const canvas = el(target);
    const o = Object.assign({ color: PAL.line, bg: PAL.bg, autoscale: true, glow: true }, opts);
    return {
        draw(data) {
            const { ctx, w, h: hh } = fitCanvas(canvas);
            const mid = hh / 2;
            ctx.fillStyle = o.bg;
            ctx.fillRect(0, 0, w, hh);
            ctx.strokeStyle = PAL.grid; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, mid); ctx.lineTo(w, mid);
            ctx.moveTo(0, mid / 2); ctx.lineTo(w, mid / 2);
            ctx.moveTo(0, mid * 1.5); ctx.lineTo(w, mid * 1.5);
            ctx.stroke();
            const n = data ? data.length : 0;
            if (!n) return { peak: 0, rms: 0 };
            let peak = 0, sq = 0;
            for (let i = 0; i < n; i++) { const v = data[i]; sq += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
            const rms = Math.sqrt(sq / n);
            const scale = o.autoscale ? (mid * 0.8) / Math.max(peak, 0.01) : mid * 0.95;
            let start = 0;
            for (let i = 1; i < n / 4; i++) if (data[i - 1] <= 0 && data[i] > 0) { start = i; break; }
            const len = Math.max(2, Math.min(n - start, Math.floor(n / 2), Math.ceil(w)));
            const path = () => {
                ctx.beginPath();
                for (let i = 0; i < len; i++) {
                    const x = (i / (len - 1)) * w, y = mid - data[start + i] * scale;
                    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                }
                ctx.stroke();
            };
            if (o.glow && rms > 0.0025) {
                ctx.globalAlpha = 0.18; ctx.strokeStyle = o.color; ctx.lineWidth = 6;
                path();
                ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = o.color; ctx.lineWidth = 1.5;
            path();
            ctx.lineWidth = 1;
            return { peak, rms };
        },
        get color() { return o.color; },
        set color(c) { o.color = c; },
        el: canvas,
    };
}

/** Pitch -> hue (150 Hz blue .. 4 kHz red), for tonal shading. */
export function pitchColor(hz, alpha) {
    const lo = Math.log2(150), hi = Math.log2(4000);
    const t = Math.max(0, Math.min(1, (Math.log2(Math.max(1, hz)) - lo) / (hi - lo)));
    return 'hsla(' + (210 - t * 210).toFixed(0) + ',72%,56%,' + (alpha != null ? alpha : 0.34) + ')';
}

/**
 * A clip waveform (min/max per pixel column) with optional overlays:
 *   analysis  bro.sense.analyze(clip) result: tonal frames shaded by pitch,
 *             onsets as ticks ({ frames, hop, flags, dominantHz })
 *   sel       { a, b } sample range; outside is dimmed, edges get handles
 *   gain      display gain
 * opts: { height = 76, trim = false, onTrim(sel) } — with trim, dragging
 * moves the nearer selection edge (onTrim fires on every move).
 * Handle: set({ clip, gain, analysis, sel }), draw(), sel, dispose().
 */
export function waveView(target, opts) {
    const canvas = el(target);
    const o = Object.assign({ height: 76, trim: false, onTrim: null }, opts);
    const s = { clip: null, gain: 1, analysis: null, sel: null };
    let w = 0;

    function draw() {
        const width = Math.max(180, (canvas.parentNode && canvas.parentNode.clientWidth) || 320);
        const fit = fitCanvas(canvas, { width, height: o.height });
        const ctx = fit.ctx, hh = fit.h;
        w = fit.w;
        ctx.fillStyle = PAL.bg;
        ctx.fillRect(0, 0, w, hh);
        const clip = s.clip;
        if (!clip || !clip.length) return;
        const n = clip.length, mid = hh / 2, a = s.analysis;
        const x = (samp) => samp / n * w;
        if (a) {
            for (let f = 0; f < a.frames; f++) {
                if (!(a.flags[f] & 2)) continue;
                const x0 = x(f * a.hop), x1 = x(f * a.hop + a.hop);
                ctx.fillStyle = pitchColor(a.dominantHz[f]);
                ctx.fillRect(x0, 0, Math.max(1, x1 - x0), hh);
            }
        }
        ctx.strokeStyle = PAL.grid;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
        ctx.strokeStyle = PAL.wave; ctx.lineWidth = 1;
        ctx.beginPath();
        const g = s.gain;
        for (let px = 0; px < w; px++) {
            const s0 = Math.floor(px / w * n), s1 = Math.max(s0 + 1, Math.floor((px + 1) / w * n));
            let mn = 1, mx = -1;
            for (let i = s0; i < s1 && i < n; i++) { const v = clip[i] * g; if (v < mn) mn = v; if (v > mx) mx = v; }
            if (mn > mx) { mn = 0; mx = 0; }
            ctx.moveTo(px + 0.5, mid - mx * mid * 0.92);
            ctx.lineTo(px + 0.5, mid - mn * mid * 0.92);
        }
        ctx.stroke();
        if (a) {
            ctx.fillStyle = PAL.onset;
            for (let f = 0; f < a.frames; f++) if (a.flags[f] & 4) ctx.fillRect(x(f * a.hop) - 0.5, 0, 1.5, hh);
        }
        if (s.sel) {
            const xa = x(s.sel.a), xb = x(s.sel.b);
            ctx.fillStyle = 'rgba(8,10,14,0.62)';
            ctx.fillRect(0, 0, xa, hh); ctx.fillRect(xb, 0, w - xb, hh);
            ctx.fillStyle = PAL.sel;
            ctx.fillRect(xa - 1, 0, 2, hh); ctx.fillRect(xb - 1, 0, 2, hh);
            ctx.fillRect(xa - 3, mid - 8, 6, 16); ctx.fillRect(xb - 3, mid - 8, 6, 16);
        }
    }

    let drag = null;
    const sampAt = (clientX) => {
        const r = canvas.getBoundingClientRect();
        const px = Math.max(0, Math.min(w, clientX - r.left));
        return Math.round(px / Math.max(1, w) * s.clip.length);
    };
    const moveEdge = (v) => {
        const sel = s.sel;
        if (drag === 'a') sel.a = Math.max(0, Math.min(v, sel.b - 1));
        else sel.b = Math.min(s.clip.length, Math.max(v, sel.a + 1));
        draw();
        if (o.onTrim) o.onTrim(sel);
    };
    const onDown = (e) => {
        if (!s.clip || !s.sel) return;
        const v = sampAt(e.clientX);
        drag = Math.abs(v - s.sel.a) <= Math.abs(v - s.sel.b) ? 'a' : 'b';
        moveEdge(v);
        e.preventDefault();
    };
    const onMove = (e) => { if (drag) moveEdge(sampAt(e.clientX)); };
    const onUp = () => { drag = null; };
    if (o.trim) {
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    return {
        set(v) { Object.assign(s, v); draw(); return this; },
        draw,
        get sel() { return s.sel; },
        dispose() {
            canvas.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        },
        el: canvas,
    };
}

/**
 * A <select> of bro.listen capture sources: another mic tap, system audio
 * (where loopback exists) and each app currently playing audio.
 * Handle: rebuild() (rescan apps, keep the selection), spec() -> { kind:
 * 'mic' | 'system' | 'process', pid, name } or null, supported.
 * Pass `refresh` (a button) to rebuild on click.
 */
export function sourcePicker(target, opts) {
    const sel = el(target);
    const o = opts || {};
    let names = {};
    const supported = () => !!(bro.listen && bro.listen.supported && bro.listen.supported());
    function rebuild() {
        const sup = supported();
        const apps = sup ? bro.listen.apps() : [];
        const prev = sel.value;
        names = {};
        clear(sel);
        sel.appendChild(h('option', { value: 'mic' }, 'mic (another tap)'));
        if (sup) sel.appendChild(h('option', { value: 'system' }, 'system audio (loopback)'));
        for (const a of apps) {
            names[a.pid] = a.name;
            sel.appendChild(h('option', { value: 'pid:' + a.pid }, a.name + '  ·  #' + a.pid));
        }
        if (!sup) sel.appendChild(h('option', { disabled: true }, '— loopback/per-app unsupported here —'));
        // bro's <select> has .value but no .options collection: scan the children.
        if (prev && Array.from(sel.querySelectorAll('option')).some((x) => x.value === prev)) sel.value = prev;
    }
    if (o.refresh) el(o.refresh).addEventListener('click', rebuild);
    rebuild();
    return {
        rebuild,
        spec() {
            const v = sel.value;
            if (v === 'mic' || v === 'system') return { kind: v };
            if (v && v.indexOf('pid:') === 0) {
                const pid = parseInt(v.slice(4), 10);
                return { kind: 'process', pid, name: names[pid] };
            }
            return null;
        },
        get supported() { return supported(); },
        el: sel,
    };
}

/**
 * Play/pause + seek slider + time readout over any playable thing.
 * parts: { toggle, seek (range, 0..1000), time } (selectors or elements).
 * src: { duration() s, position() s, seek(s), setPlaying(on), playing()? },
 * swappable via setSource() (each source keeps its own play state when it
 * reports playing()). Call update() from the frame loop to move the slider
 * and readout (not while the user is dragging it).
 * Handle: update(), setSource(src), playing (get/set), scrubbing.
 */
export function transport(parts, src) {
    const toggle = el(parts.toggle), seek = el(parts.seek), time = el(parts.time);
    let source = src, playing = src.playing ? src.playing() : true, scrubbing = false;
    const paint = () => { toggle.textContent = playing ? 'pause' : 'play'; toggle.classList.toggle('active', !playing); };
    toggle.addEventListener('click', () => { api.playing = !playing; });
    seek.addEventListener('input', () => {
        scrubbing = true;
        source.seek((parseFloat(seek.value) / 1000) * source.duration());
    });
    seek.addEventListener('change', () => { scrubbing = false; });
    const api = {
        update() {
            // A source that reports its own state (a clip that ran out) wins.
            if (source.playing && source.playing() !== playing) { playing = !!source.playing(); paint(); }
            const pos = source.position(), dur = source.duration();
            time.textContent = pos.toFixed(2) + ' / ' + dur.toFixed(2) + ' s';
            if (!scrubbing && dur > 0) seek.value = String(Math.round((pos / dur) * 1000));
        },
        setSource(s) {
            source = s;
            if (s.playing) playing = s.playing(); else s.setPlaying(playing);
            paint();
            api.update();
        },
        get playing() { return playing; },
        set playing(on) { playing = !!on; source.setPlaying(playing); paint(); },
        get scrubbing() { return scrubbing; },
    };
    paint();
    return api;
}

/**
 * Mixer strips: one row per bus with name, mute (M), solo (S) and a level
 * meter, built into `host`. rows: [{ key, label }].
 * opts: { onMute(key), onSolo(key), level(key) -> 0..1 (drawn with a sqrt
 * curve so quiet buses still show) }.
 * Handle: update() (meters), paint(key, { muted, solo }), rows.
 */
export function mixerStrips(host, rows, opts) {
    const node = el(host);
    const o = opts || {};
    clear(node);
    const strips = {};
    for (const r of rows) {
        const mute = h('button.small', { title: 'mute', onclick: () => o.onMute && o.onMute(r.key) }, 'M');
        const solo = h('button.small', { title: 'solo', onclick: () => o.onSolo && o.onSolo(r.key) }, 'S');
        const bar = h('span.k-grow');
        node.appendChild(h('div.k-strip', { dataset: { bus: r.key } }, h('span.nm', null, r.label), mute, solo, bar));
        strips[r.key] = { mute, solo, meter: levelMeter(bar, { curve: (t) => Math.sqrt(t) * 1.4 }) };
    }
    return {
        rows: strips,
        update() {
            if (!o.level) return;
            for (const r of rows) strips[r.key].meter.set(o.level(r.key));
        },
        paint(key, st) {
            const s = strips[key];
            if (!s) return;
            if (st.muted != null) s.mute.classList.toggle('active', !!st.muted);
            if (st.solo != null) s.solo.classList.toggle('solo', !!st.solo);
        },
        el: node,
    };
}
