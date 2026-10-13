// The Editor's timeline: an overview of the whole song, a zoomable waveform
// with a time ruler, the selection (dragged out, its edges dragged to adjust,
// or marked in/out at the playhead), and a playhead that plays, pauses and
// steps. All positions are frames (25 fps, 1920 samples a frame), the unit the
// edit moves work in.
//
//   click             move the playhead (seeks while playing)
//   drag              select; drag an edge of the selection to move it
//   shift+click       extend the selection to there
//   wheel             zoom around the pointer; shift+wheel scrolls
//   overview          click or drag to move the view
//
// One clip per rendered version: playing is a region of it, so a pause is
// exact, and switching versions while playing carries on at the same place.

import { $ } from "/lib/kit/dom.js";
import { audioContext } from "/lib/kit/audio.js";
import { interleave } from "./player.js";

export const FPS = 25, HOP = 1920;
const BIN = 256;           // samples per level-0 peak bin
const RULER = 18;          // px of ruler at the top of the waveform
const EDGE = 6;            // px within which a selection edge is grabbed
const MIN_VIEW = 2 * FPS;  // the closest zoom: 2 s across

export const fmt = (frames) => {
    const s = Math.max(0, frames) / FPS;
    return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
};

// ── state ────────────────────────────────────────────────────────────────────
let ver = null;            // the version shown: { semantic, audio?, span? }
let T = 0;                 // its length in frames
let v0 = 0, v1 = 0;        // the view, frames
let sel = null;            // [a, b) frames or null
let head = 0;              // the playhead, frames (where play starts)
let pending = null;        // { span: [a, b] | null, text, frac } while a job runs on this version
let onChange = () => {};   // the selection or playhead moved

const play = { clip: -1, audio: null, scale: 1, pb: -1, from: 0, to: 0, loop: false, startHead: 0 };
let peaks = null;          // { audio, levels: [Float32Array min/max pairs] }
let drag = null;

// ── the song shown ───────────────────────────────────────────────────────────
/** Show a version. keepView keeps the zoom (and selection) when its length allows. */
export function showVersion(v, keepView) {
    const wasPlaying = playing(), at = position();
    const len = v ? v.semantic.length : 0;
    if (!keepView || len !== T) { v0 = 0; v1 = len; }
    if (!keepView) { sel = null; head = 0; }
    ver = v; T = len;
    v1 = Math.min(v1, T); v0 = Math.max(0, Math.min(v0, v1 - MIN_VIEW));
    if (sel && sel[1] > T) sel = null;
    head = Math.min(head, T);
    if (!v || !v.audio) { stop(); return; }
    if (play.audio !== v.audio) {
        stop();
        if (wasPlaying && keepView) start(Math.min(at, T - 1));
    }
}
export function clearSong() { stop(); freeClip(); ver = null; T = 0; sel = null; head = 0; pending = null; }

export function selection() { return sel; }
export function setSelection(a, b) {
    a = Math.max(0, Math.min(T, Math.round(a))); b = Math.max(0, Math.min(T, Math.round(b)));
    sel = b - a >= 1 ? [Math.min(a, b), Math.max(a, b)] : null;
    onChange();
}
export function clearSelection() { sel = null; onChange(); }
export function playhead() { return playing() ? position() : head; }
export function setPending(p) { pending = p; }
export function onTimelineChange(f) { onChange = f; }

// ── view ─────────────────────────────────────────────────────────────────────
function setView(a, b) {
    let w = Math.max(MIN_VIEW, Math.min(T, b - a));
    a = Math.max(0, Math.min(T - w, a));
    v0 = a; v1 = a + w;
}
export function zoom(factor, about) {
    if (!T) return;
    const c = about == null ? (v0 + v1) / 2 : about;
    const w = (v1 - v0) * factor, t = (c - v0) / (v1 - v0);
    setView(c - t * w, c - t * w + w);
}
export function zoomFit() { setView(0, T); }
export function zoomToSelection() {
    if (!sel) return;
    const pad = Math.max(FPS, (sel[1] - sel[0]) * 0.15);
    setView(sel[0] - pad, sel[1] + pad);
}
function keepInView(f) {
    const w = v1 - v0;
    if (f < v0 || f > v1) setView(f - w * 0.1, f - w * 0.1 + w);
    else if (f > v1 - w * 0.03 && v1 < T) setView(f - w * 0.1, f - w * 0.1 + w);   // follow the playhead
}

// ── playback ─────────────────────────────────────────────────────────────────
function freeClip() {
    if (play.clip >= 0) { try { audioContext().deleteClip(play.clip); } catch (e) { /* gone */ } }
    play.clip = -1; play.audio = null;
}
function ensureClip() {
    const a = ver && ver.audio;
    if (!a) return false;
    if (play.audio === a && play.clip >= 0) return true;
    freeClip();
    const ctx = audioContext();
    play.clip = ctx.createClip(interleave(a.samples.subarray(0, a.frames), a.samples.subarray(a.frames)), 2, a.sampleRate);
    if (play.clip < 0) return false;
    play.audio = a;
    play.scale = ctx.getClipSampleCount(play.clip) / a.frames;   // engine frames per song sample
    return true;
}
export function playing() { return play.pb >= 0; }
function position() {
    if (play.pb < 0) return head;
    const s = audioContext().getPlaybackPositionSeconds(play.pb) * (play.audio ? play.audio.sampleRate : 48000) / HOP;
    return Math.min(play.to, play.from + s);
}
// Play [from, to) (to the song's end by default), looped when loop.
function startRegion(from, to, loop, at) {
    if (!ensureClip()) return;
    const ctx = audioContext();
    if (play.pb >= 0) { try { ctx.stopPlayback(play.pb); } catch (e) { /* finished */ } }
    const k = HOP * play.scale;
    play.pb = ctx.playClip(play.clip, 1, !!loop);
    if (play.pb < 0) return;
    ctx.setPlaybackRegion(play.pb, Math.floor(from * k), Math.floor(Math.min(T, to) * k));
    if (at != null && at > from) ctx.seekPlayback(play.pb, (at - from) * HOP / play.audio.sampleRate);
    play.from = from; play.to = Math.min(T, to); play.loop = !!loop;
}
/** Play from frame f: within a looped selection, the selection over and over; else to the end. */
function start(f) {
    const loop = $('#edit-loop') && $('#edit-loop').checked && sel;
    play.startHead = f;
    if (loop) startRegion(sel[0], sel[1], true, f >= sel[0] && f < sel[1] ? f : sel[0]);
    else startRegion(f, T, false);
}
export function stop() {
    if (play.pb >= 0) { try { audioContext().stopPlayback(play.pb); } catch (e) { /* finished */ } }
    play.pb = -1;
}
export function togglePlay() {
    if (playing()) { head = position(); stop(); }
    else if (ver && ver.audio) start(head >= T - 1 ? 0 : head);
    onChange();
}
/** Play [a, b), leaving the playhead where it started once it ends. */
export function playSpan(a, b) {
    if (!ver || !ver.audio) return;
    head = a; play.startHead = a;
    startRegion(a, b, false);
    onChange();
}
export function seek(f) {
    f = Math.max(0, Math.min(T, f));
    if (playing()) {
        if (play.loop && sel) {
            if (f >= sel[0] && f < sel[1]) audioContext().seekPlayback(play.pb, (f - sel[0]) * HOP / play.audio.sampleRate);
            else { head = f; stop(); start(f); }
        } else { stop(); start(f); }
    } else head = f;
    keepInView(f);
    onChange();
}
export function nudge(df) { seek(playhead() + df); }
export function markIn() {
    const f = Math.round(playhead());
    setSelection(f, sel && sel[1] > f ? sel[1] : Math.min(T, f + 5 * FPS));
}
export function markOut() {
    const f = Math.round(playhead());
    setSelection(sel && sel[0] < f ? sel[0] : Math.max(0, f - 5 * FPS), f);
}

// ── peaks ────────────────────────────────────────────────────────────────────
// Level 0 is min/max of the mono mix per BIN samples, each level above halves
// it: a column of any zoom reads a handful of bins.
function peaksOf(a) {
    if (peaks && peaks.audio === a) return peaks;
    const n = Math.ceil(a.frames / BIN), L = a.samples, R = a.frames;
    let lv = new Float32Array(n * 2);
    for (let b = 0; b < n; b++) {
        let mn = 0, mx = 0;
        const s1 = Math.min(a.frames, (b + 1) * BIN);
        for (let s = b * BIN; s < s1; s += 2) {
            const x = 0.5 * (L[s] + L[R + s]);
            if (x < mn) mn = x; else if (x > mx) mx = x;
        }
        lv[2 * b] = mn; lv[2 * b + 1] = mx;
    }
    const levels = [lv];
    while (lv.length > 4) {
        const m = Math.ceil(lv.length / 4), up = new Float32Array(m * 2);
        for (let b = 0; b < m; b++) {
            const i = 4 * b, j = Math.min(lv.length - 2, i + 2);
            up[2 * b] = Math.min(lv[i], lv[j]); up[2 * b + 1] = Math.max(lv[i + 1], lv[j + 1]);
        }
        levels.push(up); lv = up;
    }
    peaks = { audio: a, levels };
    return peaks;
}
// min/max of samples [s0, s1) from the coarsest level that still resolves it.
function range(p, a, s0, s1, out) {
    let mn = 0, mx = 0;
    if (s1 - s0 < BIN) {
        const L = a.samples, R = a.frames;
        for (let s = Math.max(0, s0); s < Math.min(a.frames, s1); s++) {
            const x = 0.5 * (L[s] + L[R + s]);
            if (x < mn) mn = x; else if (x > mx) mx = x;
        }
    } else {
        let lvl = 0, size = BIN;
        while (lvl + 1 < p.levels.length && size * 2 * 4 <= s1 - s0) { lvl++; size *= 2; }
        const lv = p.levels[lvl], b0 = Math.floor(s0 / size), b1 = Math.min(lv.length / 2, Math.ceil(s1 / size));
        for (let b = b0; b < b1; b++) { if (lv[2 * b] < mn) mn = lv[2 * b]; if (lv[2 * b + 1] > mx) mx = lv[2 * b + 1]; }
    }
    out[0] = mn; out[1] = mx;
}

// ── drawing ──────────────────────────────────────────────────────────────────
const C = { bg: '#10141c', wave: '#7fa8ff', waveDim: '#4a6191', sel: 'rgba(90,140,255,0.24)', selEdge: '#8fb0ff',
            span: 'rgba(255,190,80,0.14)', spanEdge: 'rgba(255,190,80,0.55)', head: '#ffffff', ruler: '#161b26',
            tick: 'rgba(255,255,255,0.30)', label: 'rgba(255,255,255,0.55)', pend: 'rgba(255,255,255,0.07)' };
const mm = new Float32Array(2);

function fit(cv) {
    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    return [W, H];
}
function stepFor(pxPerSec) {
    for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pxPerSec >= 64) return s;
    return 600;
}
function stripes(g, x0, x1, H, top) {
    g.save();
    g.beginPath(); g.rect(x0, top, x1 - x0, H - top); g.clip();
    g.fillStyle = C.pend; g.fillRect(x0, top, x1 - x0, H - top);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    const off = (performance.now() / 40) % 24;
    for (let x = x0 - H - 24 + off; x < x1 + H; x += 24) {
        g.beginPath(); g.moveTo(x, H); g.lineTo(x + 12, H); g.lineTo(x + 12 + (H - top), top); g.lineTo(x + (H - top), top); g.closePath(); g.fill();
    }
    g.restore();
}

function drawWave() {
    const cv = $('#edit-wave');
    if (!cv || !cv.offsetWidth) return;
    const [W, H] = fit(cv);
    const g = cv.getContext('2d');
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = C.ruler; g.fillRect(0, 0, W, RULER);
    if (!ver || !T) { label(g, W, H, 'open a saved song from the list on the left'); return; }
    const x = (f) => ((f - v0) / (v1 - v0)) * W;
    const mid = RULER + (H - RULER) / 2, amp = (H - RULER) * 0.46;
    if (ver.span) {
        g.fillStyle = C.span; g.fillRect(x(ver.span[0]), RULER, x(ver.span[1]) - x(ver.span[0]), H - RULER);
        g.fillStyle = C.spanEdge; g.fillRect(x(ver.span[0]), RULER, 1, H - RULER); g.fillRect(x(ver.span[1]), RULER, 1, H - RULER);
    }
    if (sel) { g.fillStyle = C.sel; g.fillRect(x(sel[0]), RULER, x(sel[1]) - x(sel[0]), H - RULER); }
    const a = ver.audio;
    if (a) {
        const p = peaksOf(a), spp = ((v1 - v0) * HOP) / W;
        for (let c = 0; c < W; c++) {
            const s0 = Math.floor(v0 * HOP + c * spp), s1 = Math.max(s0 + 1, Math.floor(v0 * HOP + (c + 1) * spp));
            range(p, a, s0, s1, mm);
            const f = (s0 / HOP);
            g.fillStyle = sel && (f < sel[0] || f >= sel[1]) ? C.waveDim : C.wave;
            const y0 = mid - mm[1] * amp, y1 = mid - mm[0] * amp;
            g.fillRect(c, y0, 1, Math.max(1, y1 - y0));
        }
    }
    if (pending) {
        const s = pending.span || [v0, v1];
        stripes(g, Math.max(0, x(s[0])), Math.min(W, x(s[1])), H, RULER);
    }
    if (!a && !pending) label(g, W, H, 'no audio');
    if (pending) label(g, W, H, pending.text + (pending.frac > 0 ? '  ·  ' + Math.round(pending.frac * 100) + '%' : ''));
    if (sel) {
        g.fillStyle = C.selEdge;
        g.fillRect(x(sel[0]) - 1, RULER, 2, H - RULER); g.fillRect(x(sel[1]) - 1, RULER, 2, H - RULER);
        g.fillRect(x(sel[0]) - 1, RULER, 7, 3); g.fillRect(x(sel[1]) - 6, RULER, 7, 3);
    }
    // ruler
    const pxPerSec = (W / (v1 - v0)) * FPS, step = stepFor(pxPerSec);
    g.font = '10px sans-serif';
    const first = Math.ceil(v0 / FPS / step) * step;
    for (let s = first; s * FPS <= v1; s += step) {
        const xx = Math.round(x(s * FPS));
        g.fillStyle = C.tick; g.fillRect(xx, RULER - 6, 1, 6);
        g.fillStyle = C.label;
        const t = step < 1 ? fmt(s * FPS) : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
        g.fillText(t, xx + 3, 11);
        for (let k = 1; k < 5; k++) { g.fillStyle = C.tick; g.fillRect(Math.round(x((s + (k * step) / 5) * FPS)), RULER - 3, 1, 3); }
    }
    // playhead
    const f = playhead();
    if (f >= v0 && f <= v1) {
        const xx = Math.round(x(f));
        g.fillStyle = C.head; g.fillRect(xx, RULER, 1, H - RULER);
        g.beginPath(); g.moveTo(xx - 5, 0); g.lineTo(xx + 6, 0); g.lineTo(xx + 0.5, 8); g.closePath(); g.fill();
    }
}
function label(g, W, H, text) {
    g.font = '12px sans-serif';
    const w = g.measureText(text).width;
    g.fillStyle = 'rgba(16,20,28,0.85)'; g.fillRect(W / 2 - w / 2 - 10, RULER + (H - RULER) / 2 - 13, w + 20, 24);
    g.fillStyle = '#c8d0e0'; g.fillText(text, W / 2 - w / 2, RULER + (H - RULER) / 2 + 4);
}

let ovCache = null;
function drawOverview() {
    const cv = $('#edit-overview');
    if (!cv || !cv.offsetWidth) return;
    const [W, H] = fit(cv);
    const g = cv.getContext('2d');
    g.fillStyle = '#0c1017'; g.fillRect(0, 0, W, H);
    if (!ver || !T) return;
    const x = (f) => (f / T) * W, a = ver.audio;
    if (a) {
        if (!ovCache || ovCache.audio !== a || ovCache.W !== W) {
            const p = peaksOf(a), out = new Float32Array(W * 2), spp = a.frames / W;
            for (let c = 0; c < W; c++) { range(p, a, Math.floor(c * spp), Math.floor((c + 1) * spp), mm); out[2 * c] = mm[0]; out[2 * c + 1] = mm[1]; }
            ovCache = { audio: a, W, out };
        }
        g.fillStyle = '#3d4f75';
        for (let c = 0; c < W; c++) {
            const y0 = H / 2 - ovCache.out[2 * c + 1] * H * 0.46, y1 = H / 2 - ovCache.out[2 * c] * H * 0.46;
            g.fillRect(c, y0, 1, Math.max(1, y1 - y0));
        }
    }
    if (ver.span) { g.fillStyle = 'rgba(255,190,80,0.35)'; g.fillRect(x(ver.span[0]), H - 3, Math.max(2, x(ver.span[1]) - x(ver.span[0])), 3); }
    if (sel) { g.fillStyle = 'rgba(90,140,255,0.35)'; g.fillRect(x(sel[0]), 0, Math.max(2, x(sel[1]) - x(sel[0])), H); }
    if (pending) { const s = pending.span || [0, T]; stripes(g, x(s[0]), x(s[1]), H, 0); }
    // the view window
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
    g.strokeRect(Math.round(x(v0)) + 0.5, 0.5, Math.max(3, Math.round(x(v1) - x(v0)) - 1), H - 1);
    g.fillStyle = C.head; g.fillRect(Math.round(x(playhead())), 0, 1, H);
}

/** Per frame on the Edit tab: playback state, the follow-scroll, both canvases, the clock. */
export function tickTimeline() {
    if (play.pb >= 0) {
        const ctx = audioContext();
        if (!ctx.isClipPlaying(play.pb) && !play.loop) {
            // Ended: the playhead goes back to where play started.
            stop(); head = play.startHead; onChange();
        } else keepInView(position());
    }
    if (drag && drag.mode !== 'pan' && drag.autoX != null) {
        // A drag held past either edge scrolls the view.
        const cv = $('#edit-wave'), w = v1 - v0;
        if (drag.autoX < 12) setView(v0 - w * 0.02, v1 - w * 0.02);
        else if (drag.autoX > cv.offsetWidth - 12) setView(v0 + w * 0.02, v1 + w * 0.02);
        dragTo(drag.lastE);
    }
    drawOverview();
    drawWave();
    const t = $('#edit-time');
    if (t) t.textContent = T ? fmt(playhead()) + ' / ' + fmt(T) : '';
    const pb = $('#edit-play');
    if (pb) pb.textContent = playing() ? '❚❚' : '▶';
}

// ── input ────────────────────────────────────────────────────────────────────
function frameAtX(cv, clientX) {
    const r = cv.getBoundingClientRect();
    return Math.max(0, Math.min(T, v0 + ((clientX - r.left) / r.width) * (v1 - v0)));
}
function dragTo(e) {
    if (!drag || !e) return;
    const cv = $('#edit-wave'), f = Math.round(frameAtX(cv, e.clientX));
    if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === 'edge0') sel = [Math.min(f, sel[1] - 1), sel[1]];
    else if (drag.mode === 'edge1') sel = [sel[0], Math.max(f, sel[0] + 1)];
    else sel = f === drag.anchor ? null : [Math.min(f, drag.anchor), Math.max(f, drag.anchor)];
    onChange();
}

function bindWave() {
    const cv = $('#edit-wave');
    const xOf = (f) => ((f - v0) / (v1 - v0)) * cv.getBoundingClientRect().width + cv.getBoundingClientRect().left;
    const edgeAt = (e) => {
        if (!sel) return null;
        if (Math.abs(e.clientX - xOf(sel[0])) <= EDGE) return 'edge0';
        if (Math.abs(e.clientX - xOf(sel[1])) <= EDGE) return 'edge1';
        return null;
    };
    cv.addEventListener('pointerdown', (e) => {
        if (!T) return;
        const f = Math.round(frameAtX(cv, e.clientX));
        if (e.shiftKey) {
            const anchor = sel ? (Math.abs(f - sel[0]) < Math.abs(f - sel[1]) ? sel[1] : sel[0]) : Math.round(playhead());
            setSelection(anchor, f);
            drag = { mode: 'new', anchor, x0: -1e9, moved: true, lastE: e, autoX: null };
        } else drag = { mode: edgeAt(e) || 'new', anchor: f, x0: e.clientX, moved: false, lastE: e, autoX: null };
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* headless */ }
    });
    cv.addEventListener('pointermove', (e) => {
        if (!drag) { cv.style.cursor = edgeAt(e) ? 'ew-resize' : 'text'; return; }
        drag.lastE = e;
        drag.autoX = e.clientX - cv.getBoundingClientRect().left;
        dragTo(e);
    });
    cv.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (!d.moved) seek(frameAtX(cv, e.clientX));
        onChange();
    });
    cv.addEventListener('wheel', (e) => {
        if (!T) return;
        e.preventDefault();
        const horiz = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (horiz) {
            const d = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY, w = v1 - v0;
            setView(v0 + Math.sign(d) * w * 0.1, v1 + Math.sign(d) * w * 0.1);
        } else zoom(e.deltaY > 0 ? 1.25 : 0.8, frameAtX(cv, e.clientX));
    });
    const ov = $('#edit-overview');
    let panning = false;
    const centre = (e) => {
        const r = ov.getBoundingClientRect(), f = ((e.clientX - r.left) / r.width) * T, w = v1 - v0;
        setView(f - w / 2, f + w / 2);
    };
    ov.addEventListener('pointerdown', (e) => { if (!T) return; panning = true; centre(e); try { ov.setPointerCapture(e.pointerId); } catch (err) { /* headless */ } });
    ov.addEventListener('pointermove', (e) => { if (panning) centre(e); });
    ov.addEventListener('pointerup', () => { panning = false; });
}

function bindKeys(actions) {
    document.addEventListener('keydown', (e) => {
        if (!document.body.classList.contains('editing') || !T) return;
        const t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
        const fine = e.shiftKey ? 0.1 * FPS : FPS;
        let used = true;
        switch (e.key) {
            case ' ': togglePlay(); break;
            case 'ArrowLeft': nudge(-fine); break;
            case 'ArrowRight': nudge(fine); break;
            case 'Home': seek(0); break;
            case 'End': seek(T); break;
            case '[': markIn(); break;
            case ']': markOut(); break;
            case 'Escape': clearSelection(); break;
            case '+': case '=': zoom(0.8, playhead()); break;
            case '-': case '_': zoom(1.25, playhead()); break;
            case '0': zoomFit(); break;
            case 'z': case 'Z':
                if (e.ctrlKey || e.metaKey) { if (e.shiftKey) actions.redo(); else actions.undo(); }
                else zoomToSelection();
                break;
            case 'y': case 'Y': if (e.ctrlKey || e.metaKey) actions.redo(); else used = false; break;
            case 'p': case 'P': if (sel) { if (e.shiftKey) playSpan(Math.max(0, sel[0] - 4 * FPS), T); else playSpan(sel[0], sel[1]); } break;
            case 'l': case 'L': { const l = $('#edit-loop'); l.checked = !l.checked; if (playing()) { const f = position(); stop(); start(f); } break; }
            default: used = false;
        }
        if (used) e.preventDefault();
    });
}

/** actions: { undo(), redo() } — the history the keys step through. */
export function buildTimeline(actions) {
    bindWave();
    bindKeys(actions);
    const on = (id, f) => $(id).addEventListener('click', f);
    on('#edit-play', togglePlay);
    on('#edit-home', () => seek(0));
    on('#edit-back', () => nudge(-FPS));
    on('#edit-fwd', () => nudge(FPS));
    on('#edit-zoom-in', () => zoom(0.8, playhead()));
    on('#edit-zoom-out', () => zoom(1.25, playhead()));
    on('#edit-zoom-fit', zoomFit);
    on('#edit-zoom-sel', zoomToSelection);
    on('#edit-mark-in', markIn);
    on('#edit-mark-out', markOut);
    on('#edit-clear-sel', clearSelection);
    on('#edit-play-sel', () => { if (sel) playSpan(sel[0], sel[1]); });
    on('#edit-play-from', () => { if (sel) playSpan(Math.max(0, sel[0] - 4 * FPS), T); });
    $('#edit-loop').addEventListener('change', () => { if (playing()) { const f = position(); stop(); start(f); } });
}

/** The view window, frames (tests). */
export function viewWindow() { return [v0, v1]; }
