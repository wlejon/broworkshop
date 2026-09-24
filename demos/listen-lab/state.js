// Listen Lab — shared state: DOM handles, the stream list, the status line,
// each stream's fusion feed, clip playback and WAV export.
//
// Multi-stream: the dashboard is a per-stream component. `app.streams` holds one
// state object per source (the mic = tab #0, plus any added stream);
// `app.active` is the one whose dashboard is currently shown. The shared DOM
// (sensor cards, timeline, transcript, feed) renders whichever stream is active.

import { h, ids, clear } from "/lib/kit/dom.js";
import { statusLine } from "/lib/kit/ui.js";
import { clipPlayer, saveWav } from "/lib/kit/audio.js";

/** Every element the lab touches, looked up once. */
export const D = ids(
    'dbBig', 'levelMeter', 'levelSmall', 'voiceDot', 'voiceTxt', 'voiceSmall',
    'onsetDot', 'onsetTxt', 'tonalDot', 'tonalTxt', 'tonalSmall',
    'chart', 'feed', 'overview', 'detail', 'scratch',
    'tlLive', 'tlSpan', 'tlHover',
    'phrase', 'enroll', 'record', 'threshold', 'coverage', 'listen',
    'tmpls', 'noTmpls', 'gestures', 'noGest',
    'status', 'streamT', 'spotCount',
    'transcript', 'txStat', 'txTl', 'txLive', 'txLiveEn', 'txLines', 'txToggle',
    'srcSel', 'addStream', 'refreshApps', 'tabStrip',
);

export const FPS = 100;              // sensor frame rate (10 ms hop)

/** Mutable, shared across modules. */
export const app = {
    streams: [],
    active: null,
    kwsReady: false,                 // PhonemeNet checkpoint loaded + bro.kws live
    gestureN: 0,                     // auto-name counter for unnamed gesture clips
};

const line = statusLine(D.status);
export function status(text, isErr) {
    if (isErr) line.error(text); else line.set(text);
}

// ── per-stream fusion feed ──────────────────────────────────────────────────
// Each stream keeps its OWN feed (switching tabs shows that stream's events).
// fusionRow appends to a stream's feed and, when it is the active tab, renders
// the row into the shared #feed; renderFeed rebuilds it on a tab switch.
const FEED_MAX = 200;
const pad = (n) => String(n).padStart(2, '0');

function feedRow(entry) {
    return h('div.row', null,
        h('span.t', null, entry.ts),
        h('span.kind.' + entry.kind, null, entry.kind),
        h('span.txt', null, entry.text));
}

export function fusionRow(st, kind, text) {
    if (!st) st = app.active;
    if (!st) return;
    const t = new Date();
    const entry = { kind, text, ts: pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) };
    st.feed.unshift(entry);
    while (st.feed.length > FEED_MAX) st.feed.pop();
    if (st === app.active) {
        D.feed.insertBefore(feedRow(entry), D.feed.firstChild);
        while (D.feed.children.length > FEED_MAX) D.feed.removeChild(D.feed.lastChild);
    }
}

export function renderFeed(st) {
    clear(D.feed);
    if (!st) return;
    for (const entry of st.feed) D.feed.appendChild(feedRow(entry));   // newest-first
}

/** A button with a click handler. */
export function btn(label, fn, props) {
    return h('button', Object.assign({ onclick: fn }, props), label);
}

// A typed phrase carries minCoverage: a completion must have at least that
// fraction of its phonemes ACTUALLY heard (not riding the emission floor).
export function phrasePolicy() {
    return { threshold: +D.threshold.value, minCoverage: +D.coverage.value };
}

// ── clip playback + WAV export ──────────────────────────────────────────────
const player = clipPlayer();
export function playPcm(pcm, rate) { player.play(pcm, rate || 16000); }

let exportPathOverride = null;       // test seam: skip the native save dialog
export function setExportPath(p) { exportPathOverride = p; }

/** Save PCM to a .wav (the native dialog unless a test forced a path). */
export function exportWav(pcm, rate, defaultName) {
    if (!pcm || !pcm.length) { status('nothing to export', true); return null; }
    if (!exportPathOverride && typeof showSaveFileDialog !== 'function') {
        status('save dialog unavailable', true);
        return null;
    }
    const r = rate || 16000;
    const path = saveWav(pcm, r, { path: exportPathOverride, defaultName: defaultName || 'clip.wav' });
    if (path) {
        status('saved ' + (pcm.length / r).toFixed(2) + ' s → ' + path);
        fusionRow(app.active, 'info', 'exported ' + pcm.length + ' samples → ' + path);
    } else if (exportPathOverride) {
        status('WAV export failed', true);
    }
    return path;
}

/** Save a whole stream's retained buffer to a .wav. */
export function saveStreamWav(st) {
    const info = st.source.listen.info();
    if (!info.active) { status('retention is off for this stream', true); return; }
    const newest = st.source.listen.frame();
    const oldest = info.streamFrame - info.heldFrames;
    const pcm = st.source.listen.audio(oldest, newest);
    if (!pcm || !pcm.length) { status('no retained audio on this stream yet', true); return; }
    exportWav(pcm, info.rate, 'listen-' + st.kind + '-' + st.id + '.wav');
}
