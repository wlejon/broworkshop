// Listen Lab — per-stream dashboard state: the history ring, the view window,
// the playback cursor, the event log, and the ACTIVE stream's working refs.
//
// Every stream owns its OWN state (makeRing / makeView / makePlayback, plus an
// events array and a phoneme-label table). The draw and interaction code
// (timeline.js, detail.js) renders whichever stream is active through `cur`,
// which bindTimeline(st) repoints on a tab switch. Per-stream UPDATES
// (logEvent, ring.push) take an explicit `st`, so a background stream keeps
// accumulating history while another tab is shown.

import { D, FPS } from "/app/state.js";

export const CAP = 10 * 60 * FPS;          // ~10 min of frames
export const PH_CONF = 0.45;               // posterior above which a phoneme counts as heard

/**
 * A columnar history ring (~10 min): level envelope + adaptive floor,
 * voice/tonal/onset flags, and the tier-1 phoneme lane.
 */
export function makeRing() {
    return {
        frame: new Float64Array(CAP),
        db:    new Float32Array(CAP),
        floor: new Float32Array(CAP),
        peak:  new Float32Array(CAP),
        domHz: new Float32Array(CAP),
        flags: new Uint8Array(CAP),           // bit0 voice · bit1 tonal · bit2 onset
        phCls: new Int16Array(CAP),           // tier-1: top phoneme class (0 = silence)
        phP:   new Float32Array(CAP),         //         its posterior
        head: 0, count: 0,
        push(prev, s, ph) {
            const i = this.head;
            this.frame[i] = s.frames;
            this.db[i] = s.db; this.floor[i] = s.noiseFloorDb;
            this.peak[i] = s.peak; this.domHz[i] = s.tonal ? s.dominantHz : 0;
            this.flags[i] = (s.voice ? 1 : 0) | (s.tonal ? 2 : 0) |
                ((prev && s.onsets > prev.onsets) ? 4 : 0);
            this.phCls[i] = ph ? ph.cls : 0;
            this.phP[i] = ph ? ph.p : 0;
            this.head = (i + 1) % CAP;
            this.count = Math.min(this.count + 1, CAP);
        },
        slot(i) { return (this.head - this.count + i + CAP) % CAP; },   // logical -> slot
        newestFrame() { return this.count ? this.frame[this.slot(this.count - 1)] : 0; },
        oldestFrame() { return this.count ? this.frame[this.slot(0)] : 0; },
        /** Nearest stored sample to an absolute frame (linear; the ring is small). */
        nearest(f) {
            let bi = -1, bd = Infinity;
            for (let i = 0; i < this.count; i++) {
                const sl = this.slot(i), d = Math.abs(this.frame[sl] - f);
                if (d < bd) { bd = d; bi = sl; }
            }
            return bi;
        },
    };
}

export function makeView() {
    return {
        follow: true,
        span: 10 * FPS,           // visible width, in frames (default 10 s)
        endFrame: 0,              // right edge frame when scrubbing
        hoverFrame: -1,
        selId: -1,                // selected event (detail panel open)
        selRegion: null,          // { a, b } frame span highlighted for the selection
        scratchSel: null,         // { a, b } stream-frame region grabbed for a new clip
    };
}

export function makePlayback() {
    return { active: false, a: 0, b: 0, startMs: 0, durMs: 0, key: '' };
}

/** The active stream's working references (repointed by bindTimeline). */
export const cur = {
    ring: makeRing(), events: [], view: makeView(), playback: makePlayback(),
    phLabels: { 0: 'sil' }, src: null,
};

export function bindTimeline(st) {
    cur.ring = st.ring;
    cur.events = st.events;
    cur.view = st.view;
    cur.playback = st.playback;
    cur.phLabels = st.phLabels;
    cur.src = st.source;
}

// ── the visible window ──────────────────────────────────────────────────────

export const SPAN_MIN = 2 * FPS, SPAN_MAX = CAP;

/** The active view's frame window: { start, end, span }. */
export function viewWindow() {
    const end = cur.view.follow ? cur.ring.newestFrame() : cur.view.endFrame;
    const span = Math.max(SPAN_MIN, Math.min(SPAN_MAX, cur.view.span));
    return { start: end - span, end, span };
}

/** Follow the live edge (on) or hold the scrubbed window (off). */
export function setLive(on) {
    cur.view.follow = on;
    D.tlLive.classList.toggle('active', on);
}

/** Keep a scrubbed window inside the ring; reaching the newest frame goes live. */
export function clampScrub() {
    const V = cur.view, newest = cur.ring.newestFrame(), oldest = cur.ring.oldestFrame();
    const span = viewWindow().span;
    if (V.endFrame >= newest) setLive(true);
    else if (V.endFrame - span < oldest) V.endFrame = oldest + span;
}

/** Frame the active view on [a, b] with a margin (leaves live mode). */
export function focusRegion(a, b) {
    const V = cur.view, R = cur.ring;
    const margin = Math.max(FPS, (b - a) * 0.6);
    V.span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, (b - a) + 2 * margin));
    setLive(false);
    V.endFrame = Math.min(R.newestFrame(), b + margin);
    const span = viewWindow().span;
    if (V.endFrame - span < R.oldestFrame()) V.endFrame = R.oldestFrame() + span;
}

// ── event log (timeline markers + click-inspect targets) ────────────────────

let evId = 0;
const EV_CAP = 4000;

/**
 * Re-anchor a spotter-axis span onto the shared stream axis (bro.sense
 * frames) using the matched duration, so spot markers and regions line up
 * with the envelope and the retained audio.
 */
export function toStreamSpan(span, s) {
    if (!span || !(span.matchedFrames > 0) || !s) return span;
    return { startFrame: s.frames - span.matchedFrames + 1, endFrame: s.frames,
             matchedFrames: span.matchedFrames };
}

/** Log a discrete event onto a SPECIFIC stream's timeline (not necessarily the active one). */
export function logEvent(st, type, name, conf, kind, detail, span) {
    const s = st.source.sense.isActive() ? st.source.sense.snapshot() : null;
    const exact = span && span.startFrame >= 0;
    const anchor = exact ? span.endFrame : (s ? s.frames : st.ring.newestFrame());
    const ev = {
        id: ++evId, type, name: name || '',
        conf: (conf == null ? null : conf), kind: kind || '',
        frame: anchor,
        t: anchor / FPS,
        span: exact ? { a: span.startFrame, b: span.endFrame } : null,
        detail: detail || null,
    };
    st.events.push(ev);
    while (st.events.length > EV_CAP) st.events.shift();
    return ev;
}

/**
 * Tier-1: collapse the active ring's per-frame top phoneme over [a, b] into a
 * legible run (silence / low-confidence frames dropped, repeats merged).
 */
export function decodedOver(a, b) {
    const R = cur.ring, out = [];
    let last = -1;
    for (let i = 0; i < R.count; i++) {
        const sl = R.slot(i), f = R.frame[sl];
        if (f < a || f > b) continue;
        const cls = R.phCls[sl];
        if (cls === 0 || R.phP[sl] < PH_CONF) { last = -1; continue; }
        if (cls === last) continue;
        out.push(cur.phLabels[cls] || ('#' + cls));
        last = cls;
    }
    return out;
}

/** "m:ss.s" (or "m:ss" with digits 0) for a frame count. */
export function fmtFrame(frame, digits) {
    const t = frame / FPS, mm = Math.floor(t / 60);
    if (digits === 0) return mm + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    return mm + ':' + (t % 60).toFixed(1).padStart(4, '0');
}
