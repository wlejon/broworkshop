// Listen Lab — streams as tabs: each source is a full, identical dashboard.
// (load after gestures.js)
//
// The mic is tab #0; the user adds more sources (another mic, system-audio
// loopback, or one specific app from bro.listen.apps()). Every stream runs the
// SAME full stack — tier-0 sensors, tier-2 kws (the shared phrase vocabulary
// mirrored onto its own session over the one shared PhonemeNet), tier-0 gestures
// (mirrored), and tier-3 transcript (voice-gated) — so a stream's tab looks and
// behaves exactly like the mic's. Each stream owns its own dashboard STATE
// (history ring, events, view, playback, transcript, feed); the shared DOM
// rebinds to whichever tab is active. Background streams keep accumulating.
import { LL } from "/app/core.js";
    const { $srcSel, $addStream, $tabStrip,
            status, fusionRow, bindTimeline, closeDetail, drawStream } = LL;

let appNames = {};                // pid -> name, from the last bro.listen.apps() scan

// ── source abstraction ────────────────────────────────────────────────────────
// One uniform interface over either the default-mic globals (tab #0) or an opened
// stream handle: sense / kws / gesture analysers + a listen surface (retain /
// audio / frame / info). Methods stay bound to their owner.
function makeSource(kind, handle) {
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
        kwsLoaded: () => LL.kwsReady,   // a session is "loaded" iff the shared net is
    };
}

// ── per-stream state ──────────────────────────────────────────────────────────
function makeStream(source, meta) {
    const st = {
        id: meta.id, kind: meta.kind, label: meta.label, source,
        ring: LL.makeRing(), events: [], view: LL.makeView(), playback: LL.makePlayback(),
        phLabels: { 0: 'sil' },
        feed: [], spots: 0,
        lastS: null, lastPh: null, prevSnap: null, tonalAnnounced: false,
        armState: {}, lastCompletions: {}, lastGeneration: -1,
        kwsListening: false, gestureListening: false,
        txLines: [], txCtx: null,
    };
    st.txCtx = LL.makeTxCtx(st);
    return st;
}

// Resolve a source spec into the bro.listen.open() argument + a display label.
function sourceArg(spec) {
    if (spec.kind === 'system') return 'system';
    if (spec.kind === 'process') return { process: spec.pid };
    return 'mic';
}
function sourceLabel(spec) {
    if (spec.kind === 'system') return 'system audio';
    if (spec.kind === 'process') return (spec.name || ('pid ' + spec.pid));
    return 'mic';
}

// ── tabs ──────────────────────────────────────────────────────────────────────
function renderTabs() {
    $tabStrip.innerHTML = '';
    LL.streams.forEach((st, i) => {
        const b = document.createElement('button');
        b.className = 'tab ' + st.kind + (st === LL.active ? ' active' : '');
        const lbl = document.createElement('span');
        lbl.className = 'tlabel'; lbl.textContent = st.label;
        b.appendChild(lbl);
        b.addEventListener('click', () => switchTab(i));
        if (i > 0) {                                   // tab #0 (mic) is not closable
            const x = document.createElement('span');
            x.className = 'tclose'; x.textContent = '×'; x.title = 'close this stream';
            x.addEventListener('click', (e) => { e.stopPropagation(); removeStream(st); });
            b.appendChild(x);
        }
        $tabStrip.appendChild(b);
    });
}

function switchTab(i) {
    if (i < 0 || i >= LL.streams.length) return;
    bindActive(LL.streams[i]);
}

// Repoint the shared dashboard at a stream: rebind the timeline working refs,
// then re-render every shared surface from this stream's state.
function bindActive(st) {
    LL.active = st;
    bindTimeline(st);
    renderTabs();
    closeDetail();                          // the detail panel belonged to the old tab
    LL.renderFeed(st);                      // fusion feed
    LL.renderLines();                       // transcript committed lines
    LL.renderActivePartial('');             // transcript live partial
    LL.txSetStatus(LL.Transcribe.ready ? 'ready · voice-gated' : '…');
    LL.forceTemplateRebuild();              // template rows reflect this stream's progress
    LL.renderGestureRows();
    LL.renderSensors(st);                   // sensor cards from this stream's latest frame
    LL.updateListenButton();                // Listen toggle reflects this stream's session
    drawStream();
    status('viewing “' + st.label + '” — tab #' + LL.streams.indexOf(st));
}

// ── add / remove a stream ─────────────────────────────────────────────────────
function addStream(spec) {
    if (spec.kind !== 'mic' && !bro.listen.supported()) {
        status('loopback / per-app capture not available on this build', true);
        return null;
    }
    let handle;
    try { handle = bro.listen.open(sourceArg(spec)); }
    catch (e) { status('open ' + sourceLabel(spec) + ': ' + (e.message || e), true); return null; }
    if (!handle || !handle.valid) { status('could not open ' + sourceLabel(spec), true); return null; }

    const st = makeStream(makeSource('handle', handle),
                          { id: handle.id, kind: spec.kind, label: sourceLabel(spec) });
    // Bring up its full stack — exactly what the mic runs.
    st.source.sense.start({});                          // tier-0 sensors
    handle.retain(60);                                  // history + transcript + export
    LL.streams.push(st);
    if (LL.kwsReady) {
        LL.mirrorKwsTo(st);                             // tier-2 vocabulary onto its session
        if (bro.kws.templates().length) LL.startStreamKws(st);
        if (bro.gesture.templates().length) {           // tier-0 gesture vocabulary, if any
            LL.mirrorGesturesToStreams();
            LL.startStreamGesture(st);
        }
    }
    fusionRow(st, 'sys', 'opened ' + st.label + ' (#' + handle.id + ') — full dashboard, all tiers');
    switchTab(LL.streams.length - 1);                   // jump to the new tab
    return st;
}

function removeStream(st) {
    const i = LL.streams.indexOf(st);
    if (i <= 0) return;                                 // the mic (tab #0) stays
    LL.txReset(st.txCtx);
    LL.stopStreamGesture(st);
    if (st.kwsListening) LL.stopStreamKws(st);
    const id = st.id;
    try { st.source.handle.close(); } catch (e) {}
    LL.streams.splice(i, 1);
    if (LL.active === st) switchTab(0);                 // fall back to the mic tab
    else renderTabs();
    fusionRow(LL.active, 'sys', 'closed stream #' + id + ' (' + st.label + ')');
}

// ── WAV export (showSaveFileDialog + audioCtx.saveWav) ────────────────────────
let exportPathOverride = null;          // headless seam: skip the native dialog
function setExportPath(p) { exportPathOverride = p; }

function exportWav(pcm, rate, defaultName) {
    if (!pcm || !pcm.length) { status('nothing to export', true); return null; }
    let path = exportPathOverride;
    if (!path) {
        if (typeof showSaveFileDialog !== 'function') { status('save dialog unavailable', true); return null; }
        path = showSaveFileDialog('WAV audio|wav', defaultName || 'clip.wav');
    }
    if (!path) return null;
    if (!/\.wav$/i.test(path)) path += '.wav';
    const ok = LL.ensureAudioCtx().saveWav(path, pcm, 1, rate || 16000);
    if (ok) { status('saved ' + (pcm.length / (rate || 16000)).toFixed(2) + ' s → ' + path);
              fusionRow(LL.active, 'info', 'exported ' + pcm.length + ' samples → ' + path); }
    else status('WAV export failed', true);
    return ok ? path : null;
}

// Save a whole stream's retained buffer to a .wav.
function saveStreamWav(st) {
    const info = st.source.listen.info();
    if (!info.active) { status('retention is off for this stream', true); return; }
    const newest = st.source.listen.frame();
    const oldest = info.streamFrame - info.heldFrames;
    const pcm = st.source.listen.audio(oldest, newest);
    if (!pcm || !pcm.length) { status('no retained audio on this stream yet', true); return; }
    exportWav(pcm, info.rate, 'listen-' + st.kind + '-' + st.id + '.wav');
}

// ── source picker: populate the dropdown from bro.listen.apps() ───────────────
function buildSourceOptions() {
    const supported = bro.listen.supported();
    const apps = supported ? bro.listen.apps() : [];
    appNames = {};
    const prev = $srcSel.value;
    $srcSel.innerHTML = '';
    const add = (value, label) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = label;
        $srcSel.appendChild(o);
    };
    add('mic', 'mic (another tap)');
    if (supported) add('system', 'system audio (loopback)');
    for (const a of apps) {
        appNames[a.pid] = a.name;
        add('pid:' + a.pid, a.name + '  ·  #' + a.pid);
    }
    if (!supported) {
        const o = document.createElement('option');
        o.disabled = true; o.textContent = '— loopback/per-app unsupported here —';
        $srcSel.appendChild(o);
    }
    // bro's <select> exposes .value but not the .options collection — enumerate
    // the <option> children to restore the previous selection.
    if (prev && Array.from($srcSel.querySelectorAll('option')).some((o) => o.value === prev))
        $srcSel.value = prev;
}

function specFromSelect() {
    const v = $srcSel.value;
    if (v === 'mic') return { kind: 'mic' };
    if (v === 'system') return { kind: 'system' };
    if (v && v.indexOf('pid:') === 0) {
        const pid = parseInt(v.slice(4), 10);
        return { kind: 'process', pid, name: appNames[pid] };
    }
    return null;
}

    Object.assign(LL, {
        makeSource, makeStream, renderTabs, switchTab, bindActive,
        addStream, removeStream, buildSourceOptions, specFromSelect,
        exportWav, saveStreamWav, setExportPath,
    });
