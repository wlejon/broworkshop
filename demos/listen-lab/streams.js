// Listen Lab — streams rack: N sources, per-stream sensors/actions, WAV export.
// (load after gestures.js)
;(function () {
    const LL = globalThis.LL;
    const { $streamCards, $srcSel, $streamsSub,
            status, fusionRow, mkbtn, phrasePolicy, ensureAudioCtx,
            Transcribe, initTxCtx, transcribeTick, txReset, clipStore, policyStore } = LL;

// ── streams rack: N independent sources, each configured live ──────────────────
// The payoff of the multi-stream host: the mic dashboard above is stream #0, and
// the user can open any number of MORE pipelines — another mic, the whole-system
// render mix, or one specific application — each unmixed and concurrent. Per
// stream the user picks WHICH SENSORS / ACTIONS run on it:
//
//   tier-0  sense      — model-free level / voice / onset / tonality
//   tier-2  kws        — the mic's enrolled phrases mirrored onto this stream's
//                        own session over the ONE shared PhonemeNet (no copy)
//   tier-0  gestures   — non-speech rhythm/tone matching (its own GestureSpotter)
//   tier-3  transcript — voice-gated Parakeet, this stream's OWN transcript
//                        (model calls serialized with every other stream's)
//
// Each stream keeps its own frame axis, sensors, and matcher state; toggling a
// member on a stream is independent of every other stream and of the mic above.

const panels = [];                // open StreamPanel objects
let appNames = {};                // pid -> name, from the last bro.listen.apps() scan

// Resolve a source spec into the bro.listen.open() argument + a display label.
function sourceArg(spec) {
    if (spec.kind === 'system') return 'system';
    if (spec.kind === 'process') return { process: spec.pid };
    return 'mic';
}
function sourceLabel(spec) {
    if (spec.kind === 'system') return 'system audio';
    if (spec.kind === 'process') return (spec.name || ('pid ' + spec.pid)) + ' (#' + spec.pid + ')';
    return 'mic';
}

// Mirror the mic's plain phrase templates onto a stream's kws session.
// enrollFromClasses replays the decoded class ids over the SHARED net — rhythm
// (gap) templates can't round-trip through classes, so they're skipped. The
// stream session is bounced around the mutation (single-producer rule, per
// stream); only called while the stream's kws action is on.
function mirrorPhrasesTo(p) {
    if (!p.handle.valid || !LL.kwsReady || !p.actions.kws) return;
    if (p.kwsListening) { p.handle.kws.stop(); p.kwsListening = false; }
    try {
        p.handle.kws.clear();
        for (const name of bro.kws.templates()) {
            const v = bro.kws.inspect(name);
            if (!v || v.hasGaps) continue;                 // rhythm/gap → skip
            const cls = v.states.filter((st) => !st.gap).map((st) => st.cls);
            if (cls.length) p.handle.kws.enrollFromClasses(name, cls, phrasePolicy());
        }
    } catch (e) { status('mirror → ' + p.name + ': ' + (e.message || e), true); }
    if (p.handle.kws.templates().length) startPanelKws(p);
}

// Re-mirror the current phrase vocabulary onto every kws-enabled stream — called
// whenever the mic's templates change (withMutableSpotter).
function mirrorToStreams() {
    for (const p of panels) if (p.actions.kws) mirrorPhrasesTo(p);
}

function startPanelKws(p) {
    if (!p.handle.valid || p.kwsListening) return;
    p.handle.kws.listen({
        onSpot: (name, confidence) => panelSpot(p, '“' + name + '” @ ' + confidence.toFixed(2),
            'kws: "' + name + '" @ conf ' + confidence.toFixed(3)),
    });
    p.kwsListening = true;
}

function startPanelGestures(p) {
    if (!p.handle.valid || p.gestureListening) return;
    // The stream's gesture session shares the mic's enrolled gesture vocabulary
    // by re-enrolling the retained clips onto its own spotter.
    try {
        p.handle.gesture.clear && p.handle.gesture.clear();
    } catch (e) { /* clear is best-effort */ }
    for (const name of bro.gesture.templates()) {
        const clip = clipStore[name];
        if (clip) { try { p.handle.gesture.enrollFromAudio(name, clip, policyStore[name] || {}); } catch (e) { /* skip */ } }
    }
    p.handle.gesture.listen({
        onGesture: (name, confidence, kind) => panelSpot(p,
            '“' + name + '” (' + kind + ') @ ' + confidence.toFixed(2),
            'gesture: "' + name + '" (' + kind + ') @ conf ' + confidence.toFixed(3)),
    });
    p.gestureListening = true;
}

// A fired spot/gesture on a stream → its card's spot line + a tagged fusion row.
function panelSpot(p, line, feed) {
    p.dom.spot.textContent = line;
    p.dom.spot.classList.add('fired');
    p.flashAt = Date.now();
    p.dom.root.classList.add('fired');
    setTimeout(() => { if (p.dom) p.dom.root.classList.remove('fired'); }, 600);
    fusionRow('sys', p.name + ' — ' + feed);
}


// ── add / remove / configure a stream ─────────────────────────────────────────

function addStream(spec) {
    if (spec.kind !== 'mic' && !bro.listen.supported()) {
        status('loopback / per-app capture not available on this build', true);
        return null;
    }
    let handle;
    try { handle = bro.listen.open(sourceArg(spec)); }
    catch (e) { status('open ' + sourceLabel(spec) + ': ' + (e.message || e), true); return null; }
    if (!handle || !handle.valid) { status('could not open ' + sourceLabel(spec), true); return null; }

    const p = {
        handle, spec, name: sourceLabel(spec),
        actions: { sense: true, kws: false, gestures: false, transcript: false },
        kwsListening: false, gestureListening: false, flashAt: 0,
        lastSnap: null, prevSnap: null, dom: null, txSource: null,
    };
    p.txSource = {
        id: 'stream-' + handle.id, name: p.name, _prev: null, _cur: null,
        audio: (a, b) => handle.audio(a, b),
        frame: () => handle.frame(),
        oldest: () => { const i = handle.info(); return i.streamFrame - i.heldFrames; },
        active: () => handle.valid && handle.info().active,
        onPartial: (partial) => {
            if (!p.dom) return;
            p.dom.tx.textContent = partial || '';
            if (!partial) p.dom.tx.innerHTML = (p.txSource.tx && p.txSource.tx.active)
                ? '<span class="ph">…</span>'
                : '<span class="ph">— voice-gated; speak on this stream —</span>';
        },
        onCommit: (text, a, b) => {
            if (text) {
                panelSpot(p, '“' + text + '”', 'transcript: “' + text + '”');
                if (p.dom) p.dom.tx.innerHTML = '<span class="ph">— ' + text + ' —</span>';
            }
        },
        onStatus: () => {},
    };
    initTxCtx(p.txSource);                           // its own voice-gated lifecycle + runner

    p.handle.sense.start({});                       // tier-0 on by default
    panels.push(p);
    renderStreamCard(p);
    fusionRow('sys', 'opened ' + p.name + ' stream #' + handle.id + ' — tier-0 sensors on');
    status('opened stream "' + p.name + '" (#' + handle.id + ') — toggle sensors/actions on its card');
    return p;
}

function removeStream(p) {
    const i = panels.indexOf(p);
    if (i < 0) return;
    txReset(p.txSource);                            // stop driving its transcript
    if (p.kwsListening) { try { p.handle.kws.stop(); } catch (e) {} }
    if (p.gestureListening) { try { p.handle.gesture.stop(); } catch (e) {} }
    const id = p.handle.id;
    try { p.handle.close(); } catch (e) {}
    panels.splice(i, 1);
    if (p.dom) p.dom.root.remove();
    p.dom = null;
    fusionRow('sys', 'closed stream #' + id + ' (' + p.name + ')');
}

// Toggle one action/sensor on a stream, bouncing the relevant session.
function setPanelAction(p, action, on) {
    p.actions[action] = on;
    if (action === 'sense') {
        if (on) p.handle.sense.start({}); else p.handle.sense.stop();
    } else if (action === 'kws') {
        if (on) { if (!p.handle.sense.isActive()) { p.actions.sense = true; p.handle.sense.start({}); } mirrorPhrasesTo(p); }
        else if (p.kwsListening) { p.handle.kws.stop(); p.kwsListening = false; }
    } else if (action === 'gestures') {
        if (on) { if (!p.handle.sense.isActive()) { p.actions.sense = true; p.handle.sense.start({}); } startPanelGestures(p); }
        else if (p.gestureListening) { p.handle.gesture.stop(); p.gestureListening = false; }
    } else if (action === 'transcript') {
        if (on) {
            // Transcript needs voice gating (sense) + retained audio to pull from.
            // It runs CONCURRENTLY with the mic and every other stream — no
            // stealing; the model calls are serialized by the shared TxQueue.
            if (!p.handle.sense.isActive()) { p.actions.sense = true; p.handle.sense.start({}); }
            if (!p.handle.info().active) p.handle.retain(30);
            if (!Transcribe.ready) status('transcript model not loaded — no Parakeet weights', true);
        } else {
            txReset(p.txSource);                    // drop any in-progress utterance
            if (p.dom) p.dom.tx.innerHTML = '';
        }
    }
    renderStreamCard(p);                            // reflect toggle + show/hide rows
}

// ── stream card DOM ───────────────────────────────────────────────────────────

function mkToggle(label, on, extraClass, fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = (extraClass || '') + (on ? ' on' : '');
    b.addEventListener('click', fn);
    return b;
}

function renderStreamCard(p) {
    const exists = p.dom && p.dom.root;
    const root = exists ? p.dom.root : document.createElement('div');
    root.className = 'sc' + (root.classList.contains('fired') ? ' fired' : '');
    root.innerHTML =
        '<div class="scHdr">' +
          '<span class="scKind ' + p.spec.kind + '">' + p.spec.kind + '</span>' +
          '<span class="scName"></span>' +
          '<button class="scClose" title="close this stream">×</button>' +
        '</div>' +
        '<div class="scToggles"></div>' +
        '<div class="scMeters"></div>' +
        '<div class="scSpot">— no spot yet —</div>' +
        '<div class="scTx"></div>' +
        '<div class="scExport"></div>';
    root.querySelector('.scName').textContent = p.name + ' · #' + p.handle.id;
    root.querySelector('.scClose').addEventListener('click', () => removeStream(p));

    const tg = root.querySelector('.scToggles');
    tg.appendChild(mkToggle('tier-0', p.actions.sense, '', () => setPanelAction(p, 'sense', !p.actions.sense)));
    const kwsBtn = mkToggle('kws', p.actions.kws, '', () => setPanelAction(p, 'kws', !p.actions.kws));
    kwsBtn.disabled = !LL.kwsReady;
    tg.appendChild(kwsBtn);
    const gBtn = mkToggle('gestures', p.actions.gestures, '', () => setPanelAction(p, 'gestures', !p.actions.gestures));
    gBtn.disabled = !LL.kwsReady;
    tg.appendChild(gBtn);
    const txBtn = mkToggle('transcript', p.actions.transcript, 'tx', () => setPanelAction(p, 'transcript', !p.actions.transcript));
    txBtn.title = 'voice-gated Parakeet — single-op, takes the one transcriber';
    tg.appendChild(txBtn);

    const meters = root.querySelector('.scMeters');
    meters.classList.toggle('hidden', !p.actions.sense);
    meters.innerHTML =
        '<span class="scm"><span class="dot" data-m="voiceDot"></span><span data-m="voiceTxt">quiet</span></span>' +
        '<span class="scm" data-m="db">−∞ dB</span>' +
        '<span class="scm"><span class="dot onset" data-m="onsetDot"></span><span data-m="onsets">0</span> onsets</span>' +
        '<span class="scm"><span class="dot tonal" data-m="tonalDot"></span><span data-m="tonalTxt">—</span></span>';

    const spot = root.querySelector('.scSpot');
    spot.classList.toggle('hidden', !(p.actions.kws || p.actions.gestures || p.actions.transcript));

    const tx = root.querySelector('.scTx');
    tx.classList.toggle('hidden', !p.actions.transcript);
    if (p.actions.transcript && !tx.textContent)
        tx.innerHTML = '<span class="ph">— voice-gated; speak on this stream —</span>';

    const exp = root.querySelector('.scExport');
    buildExportRow(exp, p);

    p.dom = {
        root, spot, tx,
        voiceDot: meters.querySelector('[data-m=voiceDot]'),
        voiceTxt: meters.querySelector('[data-m=voiceTxt]'),
        db: meters.querySelector('[data-m=db]'),
        onsetDot: meters.querySelector('[data-m=onsetDot]'),
        onsets: meters.querySelector('[data-m=onsets]'),
        tonalDot: meters.querySelector('[data-m=tonalDot]'),
        tonalTxt: meters.querySelector('[data-m=tonalTxt]'),
    };
    if (!exists) $streamCards.appendChild(root);
}

// Per-stream WAV export row: a retention toggle (capture must be on to have any
// audio to save) + a Save button that writes the held buffer to a .wav.
function buildExportRow(exp, p) {
    exp.innerHTML = '';
    const info = p.handle.info();
    const retBtn = mkbtn(info.active ? '◉ capturing ' + info.seconds + 's' : '○ capture off', () => {
        const cur = p.handle.info();
        p.handle.retain(cur.active ? 0 : 30);
        renderStreamCard(p);
    });
    retBtn.title = 'retain raw audio on this stream so it can be saved';
    exp.appendChild(retBtn);
    const save = mkbtn('💾 Save WAV', () => saveStreamWav(p));
    save.disabled = !info.active || info.heldFrames <= 0;
    save.title = info.active ? 'save the retained buffer to a .wav file' : 'turn capture on first';
    exp.appendChild(save);
    const held = document.createElement('span');
    held.textContent = info.active ? info.heldSeconds.toFixed(1) + ' s held' : '';
    exp.appendChild(held);
}

// Polled from the tick loop: refresh each stream's own tier-0 meters from its
// OWN sense hub, keep its transcript source snapshots fresh, and fade spots.
function updateStreamPanels() {
    for (const p of panels) {
        if (!p.handle.valid) continue;
        let s = null;
        if (p.actions.sense && p.handle.sense.isActive()) s = p.handle.sense.snapshot();
        if (s && p.dom) {
            const d = p.dom;
            d.voiceDot.className = 'dot' + (s.voice ? ' on' : '');
            d.voiceTxt.textContent = s.voice ? 'voice' : 'quiet';
            d.db.textContent = (s.db <= -90 ? '−∞' : s.db.toFixed(1)) + ' dB';
            d.onsetDot.className = 'dot onset' + (s.frames - s.lastOnsetFrame < 15 ? ' on' : '');
            d.onsets.textContent = String(s.onsets);
            d.tonalDot.className = 'dot tonal' + (s.tonal ? ' on' : '');
            d.tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
        }
        // Drive this stream's OWN voice-gated transcript when its action is on —
        // each stream transcribes concurrently; model calls are serialized.
        if (p.actions.transcript) {
            p.txSource._prev = p.prevSnap; p.txSource._cur = s;
            transcribeTick(p.txSource);
        }
        p.prevSnap = s;
        if (p.dom && p.dom.spot.classList.contains('fired') && Date.now() - p.flashAt > 2500)
            p.dom.spot.classList.remove('fired');
    }
}

// ── WAV export (showSaveFileDialog + audioCtx.saveWav) ────────────────────────

let exportPathOverride = null;          // headless seam: skip the native dialog
function setExportPath(p) { exportPathOverride = p; }   // exposed for the test seam

// Write a mono Float32Array to a .wav. Returns the path written, or null.
function exportWav(pcm, rate, defaultName) {
    if (!pcm || !pcm.length) { status('nothing to export', true); return null; }
    let path = exportPathOverride;
    if (!path) {
        if (typeof showSaveFileDialog !== 'function') { status('save dialog unavailable', true); return null; }
        path = showSaveFileDialog('WAV audio|wav', defaultName || 'clip.wav');
    }
    if (!path) return null;                       // cancelled
    if (!/\.wav$/i.test(path)) path += '.wav';
    const ok = ensureAudioCtx().saveWav(path, pcm, 1, rate || 16000);
    if (ok) { status('saved ' + (pcm.length / (rate || 16000)).toFixed(2) + ' s → ' + path);
              fusionRow('info', 'exported ' + pcm.length + ' samples → ' + path); }
    else status('WAV export failed', true);
    return ok ? path : null;
}

function saveStreamWav(p) {
    const info = p.handle.info();
    if (!info.active) { status('turn capture on for this stream first', true); return; }
    const newest = p.handle.frame();
    const oldest = info.streamFrame - info.heldFrames;
    const pcm = p.handle.audio(oldest, newest);
    if (!pcm || !pcm.length) { status('no retained audio on this stream yet', true); return; }
    const tag = p.spec.kind + '-' + p.handle.id;
    exportWav(pcm, info.rate, 'listen-' + tag + '.wav');
}

// ── source picker: populate the dropdown from bro.listen.apps() ───────────────
// Offers mic, system audio (where loopback is supported), and one entry per app
// currently holding a render-audio session — the candidates for {process: pid}.
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
    // Restore the previous selection if it still exists. (bro's <select> exposes
    // .value but not the .options collection — enumerate the <option> children.)
    if (prev && Array.from($srcSel.querySelectorAll('option')).some((o) => o.value === prev))
        $srcSel.value = prev;
    $streamsSub.textContent = supported
        ? 'mic dashboard = stream #0 · add a mic, system audio, or a specific app — each unmixed, with its own sensors'
        : 'mic dashboard = stream #0 · add another mic tap (system/per-app loopback unsupported on this build)';
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
        addStream, removeStream, setPanelAction, panels, mirrorToStreams,
        updateStreamPanels, buildSourceOptions, specFromSelect,
        exportWav, saveStreamWav, setExportPath,
    });
})();
