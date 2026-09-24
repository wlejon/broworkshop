// Listen Lab — streams as tabs: each source is a full, identical dashboard.
//
// The mic is tab #0; the user adds more sources (another mic, system-audio
// loopback, or one specific app from bro.listen.apps()). Every stream runs the
// SAME full stack (tier-0 sensors, tier-2 kws with the shared phrase vocabulary
// mirrored onto its own session over the one shared PhonemeNet, tier-0
// gestures (mirrored), and the voice-gated tier-3 transcript), so a stream's
// tab looks and behaves exactly like the mic's. Each stream owns its own
// dashboard STATE (history ring, events, view, playback, transcript, feed); the
// shared DOM rebinds to whichever tab is active. Background streams keep
// accumulating.

import { h, clear } from "/lib/kit/dom.js";
import { sourcePicker } from "/lib/kit/audio-ui.js";
import { D, app, status, fusionRow, renderFeed } from "/app/state.js";
import { makeRing, makeView, makePlayback, bindTimeline, setLive } from "/app/ring.js";
import { closeDetail } from "/app/detail.js";
import { drawStream } from "/app/timeline.js";
import { renderSensors } from "/app/sensors.js";
import {
    mirrorKwsTo, startStreamKws, stopStreamKws, forceTemplateRebuild, updateListenButton,
} from "/app/kws.js";
import {
    renderGestureRows, mirrorGesturesToStreams, startStreamGesture, stopStreamGesture,
} from "/app/gestures.js";
import {
    Transcribe, makeTxCtx, txReset, txSetStatus, renderLines, renderActivePartial,
} from "/app/transcript.js";

/** The "add stream" source <select> (another mic tap, system loopback, per-app). */
export const picker = sourcePicker(D.srcSel, { refresh: D.refreshApps });

/**
 * One uniform interface over the default-mic globals (tab #0) or an opened
 * stream handle: sense / kws / gesture analysers + a listen surface
 * (retain / audio / frame / info).
 */
export function makeSource(kind, handle) {
    if (kind === 'mic-default') {
        return {
            isHandle: false, handle: null,
            sense: bro.sense, kws: bro.kws, gesture: bro.gesture, listen: bro.listen,
            kwsLoaded: () => bro.kws.isLoaded(),
        };
    }
    return {
        isHandle: true, handle,
        sense: handle.sense, kws: handle.kws, gesture: handle.gesture, listen: handle,
        kwsLoaded: () => app.kwsReady,      // a session is "loaded" iff the shared net is
    };
}

export function makeStream(source, meta) {
    const st = {
        id: meta.id, kind: meta.kind, label: meta.label, source,
        ring: makeRing(), events: [], view: makeView(), playback: makePlayback(),
        phLabels: { 0: 'sil' },
        feed: [], spots: 0,
        lastS: null, lastPh: null, tonalAnnounced: false,
        armState: {}, lastCompletions: {}, lastGeneration: -1,
        kwsListening: false, gestureListening: false,
        txLines: [], txCtx: null,
    };
    st.txCtx = makeTxCtx(st);
    return st;
}

const sourceArg = (spec) => spec.kind === 'system' ? 'system' : spec.kind === 'process' ? { process: spec.pid } : 'mic';
const sourceLabel = (spec) => spec.kind === 'system' ? 'system audio'
    : spec.kind === 'process' ? (spec.name || ('pid ' + spec.pid)) : 'mic';

// ── tabs ────────────────────────────────────────────────────────────────────

function renderTabs() {
    clear(D.tabStrip);
    app.streams.forEach((st, i) => {
        D.tabStrip.appendChild(h('button.tab.' + st.kind + (st === app.active ? '.active' : ''), {
            onclick: () => switchTab(i),
        },
            h('span.tlabel', null, st.label),
            i > 0 ? h('span.tclose', {                  // tab #0 (mic) is not closable
                title: 'close this stream',
                onclick: (e) => { e.stopPropagation(); removeStream(st); },
            }, '×') : null));
    });
}

export function switchTab(i) {
    if (i < 0 || i >= app.streams.length) return;
    bindActive(app.streams[i]);
}

/** Repoint the shared dashboard at a stream and re-render every shared surface from it. */
export function bindActive(st) {
    app.active = st;
    bindTimeline(st);
    setLive(st.view.follow);                // the Live button reflects this tab's view
    renderTabs();
    closeDetail();                          // the detail panel belonged to the old tab
    renderFeed(st);
    renderLines();
    renderActivePartial('');
    txSetStatus(Transcribe.ready ? 'ready · voice-gated' : '…');
    forceTemplateRebuild();
    renderGestureRows();
    renderSensors(st);
    updateListenButton();
    drawStream();
    status('viewing “' + st.label + '” — tab #' + app.streams.indexOf(st));
}

// ── add / remove ────────────────────────────────────────────────────────────

export function addStream(spec) {
    if (spec.kind !== 'mic' && !bro.listen.supported()) {
        status('loopback / per-app capture not available on this build', true);
        return null;
    }
    let handle;
    try { handle = bro.listen.open(sourceArg(spec)); }
    catch (e) { status('open ' + sourceLabel(spec) + ': ' + (e.message || e), true); return null; }
    if (!handle || !handle.valid) { status('could not open ' + sourceLabel(spec), true); return null; }

    const st = makeStream(makeSource('handle', handle), { id: handle.id, kind: spec.kind, label: sourceLabel(spec) });
    // Bring up its full stack: exactly what the mic runs.
    st.source.sense.start({});
    handle.retain(60);                                  // history + transcript + export
    app.streams.push(st);
    if (app.kwsReady) {
        mirrorKwsTo(st);
        if (bro.kws.templates().length) startStreamKws(st);
        if (bro.gesture.templates().length) {
            mirrorGesturesToStreams();
            startStreamGesture(st);
        }
    }
    fusionRow(st, 'sys', 'opened ' + st.label + ' (#' + handle.id + ') — full dashboard, all tiers');
    switchTab(app.streams.length - 1);
    return st;
}

export function removeStream(st) {
    const i = app.streams.indexOf(st);
    if (i <= 0) return;                                 // the mic (tab #0) stays
    txReset(st.txCtx);
    stopStreamGesture(st);
    if (st.kwsListening) stopStreamKws(st);
    try { st.source.handle.close(); } catch (e) { /* already closed */ }
    app.streams.splice(i, 1);
    if (app.active === st) switchTab(0); else renderTabs();
    fusionRow(app.active, 'sys', 'closed stream #' + st.id + ' (' + st.label + ')');
}
