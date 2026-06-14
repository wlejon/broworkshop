// Listen Lab — orchestrator: per-stream poll loop, sensor cards + template rows
// for the active tab, enroll/listen controls, boot, and the headless test seam.
// The heavy machinery lives in sibling modules sharing the `LL` namespace (see
// core.js): timeline.js (per-stream ring + detail + playback), transcript.js
// (tier-3 Qwen3-ASR, one ctx per stream), diarize.js (speaker x-vector + online
// clustering), translate.js (non-English → English via bro.lm), gestures.js
// (non-speech + clip editor), streams.js (sources + tabs). This file loads LAST.
import { LL } from "/app/core.js";
// Load order (these publish onto LL; main wires them at the end — see core.js).
import "/app/timeline.js";
import "/app/transcript.js";
import "/app/diarize.js";
import "/app/translate.js";
import "/app/gestures.js";
import "/app/streams.js";
{
    const fs = require('fs');
    const {
        $dbBig, $levelFill, $floorMark, $levelSmall, $voiceDot, $voiceTxt, $voiceSmall,
        $onsetDot, $onsetTxt, $tonalDot, $tonalTxt, $tonalSmall, $streamT,
        $tmpls, $noTmpls, $listen, $phrase, $enroll, $record, $threshold, $txToggle,
        $srcSel, $addStream, $refreshApps, $spotCount, $tlLive, $tlSpan, $chart, $overview,
        status, fusionRow, FPS, phrasePolicy, PH_CONF,
        drawStream, sizeCanvas, setLive, viewWindow,
        onTimelineDown, onTimelineMove, onTimelineUp, onTimelineWheel, onOverviewNav,
        logEvent, toStreamSpan, selectEvent, closeDetail, focusRegion, playFrac, updatePlayback,
        scratchToGesture, renderScratchBar, clearScratch, scratchSpan, decodedOver,
        Transcribe, transcribeTick, txLoad, txSetStatus, renderActivePartial, renderLines,
        makeStream, makeSource, addStream, removeStream, switchTab, bindActive,
        buildSourceOptions, specFromSelect, exportWav, saveStreamWav, setExportPath,
        enrollGesture, buildEditor, gainedSlice, clipStore, gestRows, toggleRecord,
        renderGestureRows,
    } = LL;

    const WEIGHT_CANDIDATES = [
        '../../../brosoundml/weights/phoneme/english.bpm',
        '../../../brosoundml/build-cuda/english.bpm',
        'D:/projects/brosoundml/weights/phoneme/english.bpm',
        'D:/projects/brosoundml/build-cuda/english.bpm',
    ];

    const rhythmNames = {};           // name -> true for templates enrolled with gaps

// ── tier-0 sensor cards (render the ACTIVE stream's latest frame) ─────────────

const dbPct = (db) => Math.max(0, Math.min(100, (db + 80) / 80 * 100));

function renderSensors(st) {
    const s = st && st.lastS, ph = st && st.lastPh;
    if (!s) {
        $dbBig.textContent = '−∞ dB'; $levelFill.style.width = '0%';
        $floorMark.style.left = '0%'; $levelSmall.textContent = 'floor — · snr —';
        $voiceDot.className = 'dot'; $voiceTxt.textContent = 'quiet'; $voiceSmall.textContent = 'events 0';
        $onsetDot.className = 'dot onset'; $onsetTxt.textContent = '0';
        $tonalDot.className = 'dot tonal'; $tonalTxt.textContent = '—'; $tonalSmall.textContent = 'periodicity —';
        $streamT.textContent = '0.0 s';
        return;
    }
    $dbBig.textContent = (s.db <= -90 ? '−∞' : s.db.toFixed(1)) + ' dB';
    $levelFill.style.width = dbPct(s.db).toFixed(0) + '%';
    $floorMark.style.left = dbPct(s.noiseFloorDb).toFixed(0) + '%';
    $levelSmall.textContent = 'floor ' + s.noiseFloorDb.toFixed(0) +
        ' dB · snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB';

    $voiceDot.className = 'dot' + (s.voice ? ' on' : '');
    $voiceTxt.textContent = s.voice ? 'voice' : 'quiet';
    $voiceSmall.textContent = (s.voice
        ? 'run ' + (s.voiceFrames / 100).toFixed(1) + ' s · events ' + s.voiceEvents
        : 'events ' + s.voiceEvents) +
        (ph ? ' · /' + ph.label + '/' : '');

    $onsetDot.className = 'dot onset' + (s.frames - s.lastOnsetFrame < 15 ? ' on' : '');
    $onsetTxt.textContent = String(s.onsets);

    $tonalDot.className = 'dot tonal' + (s.tonal ? ' on' : '');
    $tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
    $tonalSmall.textContent = 'periodicity ' + s.periodicity.toFixed(2) +
        (s.tonal ? ' · run ' + (s.tonalFrames / 100).toFixed(1) + ' s' : '');

    $streamT.textContent = s.t.toFixed(1) + ' s';
}

// ── tier-0 event edges → a stream's fusion feed ──────────────────────────────

function emitTier0Events(st, prev, s) {
    if (s.voiceEvents > prev.voiceEvents)
        fusionRow(st, 'voice', 'voice started (snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB)');
    if (!s.voice && prev.voice)
        fusionRow(st, 'voice', 'voice ended after ' + (prev.voiceFrames / 100).toFixed(1) + ' s');
    if (s.onsets > prev.onsets) {
        const n = s.onsets - prev.onsets;
        fusionRow(st, 'onset', n === 1 ? 'transient' : n + ' transients');
    }
    if (s.tonal && s.tonalFrames >= 30 && !st.tonalAnnounced) {
        st.tonalAnnounced = true;
        fusionRow(st, 'tonal', 'sustained tone ~' + Math.round(s.dominantHz) +
            ' Hz (periodicity ' + s.periodicity.toFixed(2) + ')');
    }
    if (!s.tonal) st.tonalAnnounced = false;
}

// ── tier-2 kws sessions (one per stream over the shared net) ──────────────────
// The phrase vocabulary is the master (bro.kws = the mic's matcher). Each added
// stream mirrors it onto its own session (enrollFromClasses replays decoded class
// ids over the SHARED net; rhythm/gap templates can't round-trip, so they're
// skipped). Every stream listens independently and fires onto its own dashboard.

function mirrorKwsTo(st) {
    if (!st.source.isHandle || !LL.kwsReady) return;
    const k = st.source.kws;
    try {
        k.clear();
        for (const name of bro.kws.templates()) {
            const v = bro.kws.inspect(name);
            if (!v || v.hasGaps) continue;
            const cls = v.states.filter((s) => !s.gap).map((s) => s.cls);
            if (cls.length) k.enrollFromClasses(name, cls, phrasePolicy());
        }
    } catch (e) { status('mirror → ' + st.label + ': ' + (e.message || e), true); }
}

function onKwsSpot(st, name, confidence, span) {
    st.spots++;
    const s = st.source.sense.isActive() ? st.source.sense.snapshot() : null;
    fusionRow(st, 'spot', '"' + name + '" completed @ conf ' + confidence.toFixed(3) +
        (s && s.voice ? ' · voice run ' + (s.voiceFrames / 100).toFixed(1) + ' s' : ''));
    // The matcher reports the span on the SPOTTER's frame axis; re-anchor onto
    // the stream axis via the matched DURATION ending ~now (the fire just happened).
    logEvent(st, 'spot', name, confidence, '', null, toStreamSpan(span, s));
    st.armState[name] = false;
    if (st === LL.active) { flashRow(name); $spotCount.textContent = String(st.spots); }
}

function startStreamKws(st) {
    if (st.kwsListening) return;
    st.source.kws.listen({ onSpot: (name, conf, span) => onKwsSpot(st, name, conf, span) });
    st.kwsListening = true;
    updateListenButton();
}

function stopStreamKws(st) {
    try { st.source.kws.stop(); } catch (e) {}
    st.kwsListening = false;
    updateListenButton();
}

function updateListenButton() {
    const st = LL.active;
    const on = !!(st && st.kwsListening);
    $listen.textContent = on ? 'Stop' : 'Listen';
    $listen.classList.toggle('active', on);
    $listen.disabled = !LL.kwsReady || bro.kws.templates().length === 0;
}

// ── tier-2 template rows (bro.kws.progress for the ACTIVE stream) ─────────────

const tmplRows = {};           // name -> { root, fill, meta }

function rebuildTemplateRows(st, p) {
    Object.keys(tmplRows).forEach((k) => { tmplRows[k].root.remove(); delete tmplRows[k]; });
    $noTmpls.style.display = p.templates.length ? 'none' : '';
    for (const t of p.templates) {
        const root = document.createElement('div');
        root.className = 'tmpl';
        root.innerHTML =
            '<div class="trow"><span class="tname"></span>' +
            (rhythmNames[t.name] ? '<span class="badge">rhythm</span>' : '') +
            '<button class="tok" title="show the decoded token sequence">⋯</button>' +
            '<button class="rm">×</button></div>' +
            '<div class="tbar"><div class="tfill"></div></div>' +
            '<span class="tmeta"></span>';
        root.querySelector('.tname').textContent = t.name;
        root.querySelector('.tok').addEventListener('click', (e) => toggleTokens(t.name, root, e.target));
        root.querySelector('.rm').addEventListener('click', () => withMutableSpotter(() => {
            bro.kws.remove(t.name);
            delete rhythmNames[t.name];
        }));
        $tmpls.appendChild(root);
        tmplRows[t.name] = { root, fill: root.querySelector('.tfill'), meta: root.querySelector('.tmeta') };
        st.lastCompletions[t.name] = t.completions;
    }
    $listen.disabled = !LL.kwsReady || p.templates.length === 0;
}

function updateTemplateRows(st, p, s) {
    if (p.generation !== st.lastGeneration) {
        st.lastGeneration = p.generation;
        rebuildTemplateRows(st, p);
    }
    for (const t of p.templates) {
        const row = tmplRows[t.name];
        if (!row) continue;
        row.fill.style.width = (t.progress * 100).toFixed(0) + '%';
        row.meta.textContent = t.matched + '/' + t.length +
            ' · conf ' + t.confidence.toFixed(2) + ' · fires ' + t.completions;
        if (t.completions > (st.lastCompletions[t.name] || 0)) flashRow(t.name);
        st.lastCompletions[t.name] = t.completions;

        // The fusion moment: most of a template has aligned and its partial
        // confidence is already in threshold territory — where a heavier tier
        // would arm, seconds before any onSpot fires.
        if (!st.armState[t.name] && t.matched < t.length && t.progress >= 0.5) {
            st.armState[t.name] = true;
            fusionRow(st, 'arm', '"' + t.name + '" ' + t.matched + '/' + t.length +
                ' aligned @ conf ' + t.confidence.toFixed(2) +
                (s && s.voice ? ' · voice live' : '') +
                ' — confirmation tier would arm here');
            logEvent(st, 'arm', t.name, t.confidence, '',
                { matched: t.matched, length: t.length });
        } else if (st.armState[t.name] && t.progress < 0.3) {
            st.armState[t.name] = false;
        }
    }
}

// Force the template rows to rebuild against the active stream (tab switch).
function forceTemplateRebuild() { if (LL.active) LL.active.lastGeneration = -1; }

function flashRow(name) {
    const row = tmplRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    setTimeout(() => { if (tmplRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── token panel — bro.kws.inspect: see (and edit) what a template became ──────

function toggleTokens(name, root, btn) {
    const existing = root.querySelector('.tokens');
    if (existing) { existing.remove(); btn.classList.remove('open'); return; }
    const view = bro.kws.inspect(name);
    if (!view) { status('inspect: no template "' + name + '"', true); return; }
    btn.classList.add('open');

    const panel = document.createElement('div');
    panel.className = 'tokens';
    let edited = view.states.map((s) => ({ ...s }));

    function render() {
        panel.innerHTML = '';
        const chips = document.createElement('div');
        chips.className = 'chips';
        edited.forEach((s, i) => {
            const chip = document.createElement('span');
            chip.className = 'chip' + (s.gap ? ' gap' : '');
            chip.textContent = s.gap
                ? 'gap ' + Math.round(s.gapLo * view.frameMs) + '–' +
                  Math.round(s.gapHi * view.frameMs) + ' ms'
                : s.label;
            if (!s.gap && !view.hasGaps) {
                const x = document.createElement('button');
                x.className = 'x';
                x.textContent = '×';
                x.title = 'drop this token';
                x.addEventListener('click', () => { edited.splice(i, 1); render(); });
                chip.appendChild(x);
            }
            chips.appendChild(chip);
        });
        panel.appendChild(chips);

        if (view.hasGaps) {
            const hint = document.createElement('span');
            hint.className = 'tokhint';
            hint.textContent = 'rhythm template — speech tokens are approximate; ' +
                'the timed gaps carry the gesture';
            panel.appendChild(hint);
        } else {
            const acts = document.createElement('div');
            acts.className = 'tokedit';
            const apply = document.createElement('button');
            apply.textContent = 'apply edit';
            const changed = edited.length !== view.states.length;
            apply.disabled = !changed || edited.length === 0;
            apply.addEventListener('click', () => withMutableSpotter(() => {
                const cls = edited.filter((s) => !s.gap).map((s) => s.cls);
                bro.kws.enrollFromClasses(name, cls, phrasePolicy());
                status('edited "' + name + '" → ' + cls.length + ' tokens');
                fusionRow(LL.active, 'info', 'edited "' + name + '" to ' + cls.length + ' tokens');
            }));
            const reset = document.createElement('button');
            reset.textContent = 'reset';
            reset.disabled = !changed;
            reset.addEventListener('click', () => { edited = view.states.map((s) => ({ ...s })); render(); });
            acts.append(apply, reset);
            panel.appendChild(acts);
        }
    }
    render();
    root.appendChild(panel);
}

// ── the poll loop — update EVERY stream, render the ACTIVE one ────────────────

let txBooted = false;

// Tier-3 transcript auto-load, deferred to the first frame (headless globals are
// installed after the app's boot runs). The Qwen3-ASR / speaker-encoder / Qwen3
// loads are real — auto-load them for the live app; in headless the test installs
// stubs through the seams (so the VAD-gated lifecycle is testable without the GPU
// models).
function bootTranscript() {
    if (txBooted) return;
    txBooted = true;
    if (typeof advanceTime === 'function') { txSetStatus('headless — install a runner to test'); return; }
    txLoad();          // Qwen3-ASR transcription + language ID
    LL.dzLoad();       // ECAPA speaker encoder → diarization
    LL.tlLoad();       // NLLB-200 → English translation of non-English lines
}

// Update one stream's state (no DOM): sensor snapshot → ring, tier-0 edges, the
// tier-1 phoneme, and its voice-gated transcript context.
function updateStream(st) {
    const src = st.source;
    const s = src.sense.isActive() ? src.sense.snapshot() : null;
    let ph = null;
    if (LL.kwsReady && src.kwsLoaded()) {
        const post = src.kws.posterior(1);
        if (post && post.top.length) {
            const top = post.top[0];
            st.phLabels[top.cls] = top.label;
            if (top.cls !== 0 && top.p >= PH_CONF) ph = top;
        }
    }
    st.lastPh = ph;
    const prev = st.lastS;
    if (s) {
        if (!prev || s.frames > prev.frames) st.ring.push(prev, s, ph);
        if (prev) emitTier0Events(st, prev, s);
        st.lastS = s;
    }
    // Drive this stream's own transcript (serialized with every other stream's).
    st.txCtx._prev = prev; st.txCtx._cur = s;
    transcribeTick(st.txCtx);
}

function renderActive() {
    const st = LL.active;
    renderSensors(st);
    if (LL.kwsReady && st.source.kwsLoaded()) {
        const p = st.source.kws.progress();
        if (p) updateTemplateRows(st, p, st.lastS);
    }
    updatePlayback();
    drawStream();
    $spotCount.textContent = String(st.spots);
}

function tick() {
    bootTranscript();
    for (const st of LL.streams) updateStream(st);
    renderActive();
    requestAnimationFrame(tick);
}

// ── enroll / record / listen ─────────────────────────────────────────────────

// Template mutators share each spotter's feed thread, so they're rejected while
// listening; bounce EVERY stream's session around the master mutation, then
// re-mirror the vocabulary onto the handle streams and restart them all.
function withMutableSpotter(fn) {
    const were = LL.streams.filter((st) => st.kwsListening);
    for (const st of were) stopStreamKws(st);
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    for (const st of LL.streams) {
        if (st.source.isHandle) mirrorKwsTo(st);
        if (bro.kws.templates().length) startStreamKws(st);
    }
    updateListenButton();
}

function enrollPhrase() {
    const text = $phrase.value.trim();
    if (!text || !LL.kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enroll(text, bro.tts.phonemize(text), phrasePolicy());
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        fusionRow(LL.active, 'info', 'enrolled phrase "' + text + '" (' + len + ' classes)');
        $phrase.value = '';
    });
}

$enroll.addEventListener('click', enrollPhrase);
$phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
$record.addEventListener('click', toggleRecord);
$listen.addEventListener('click', () => {
    const st = LL.active;
    if (st.kwsListening) stopStreamKws(st); else startStreamKws(st);
});
$txToggle.addEventListener('click', () => {
    Transcribe.enabled = !Transcribe.enabled;           // pauses every stream's transcript
    if (!Transcribe.enabled && LL.active) {
        LL.active.txCtx.tx.active = false; LL.active.txCtx.tx.partial = '';
        renderActivePartial('');
    }
    txSetStatus(Transcribe.enabled ? 'ready · voice-gated' : 'paused');
});

$addStream.addEventListener('click', () => {
    const spec = specFromSelect();
    if (!spec) { status('pick a source first', true); return; }
    addStream(spec);
});
$refreshApps.addEventListener('click', buildSourceOptions);

// expose the main-owned pieces that streams.js/bindActive reach at runtime
Object.assign(LL, {
    renderSensors, forceTemplateRebuild, updateListenButton,
    mirrorKwsTo, startStreamKws, stopStreamKws,
});

// ── boot ─────────────────────────────────────────────────────────────────────

(function boot() {
    sizeCanvas($chart);
    sizeCanvas($overview);

    $chart.addEventListener('mousedown', onTimelineDown);
    window.addEventListener('mousemove', onTimelineMove);
    window.addEventListener('mouseup', onTimelineUp);
    $chart.addEventListener('wheel', onTimelineWheel, { passive: false });
    $chart.addEventListener('mouseleave', () => { LL.active.view.hoverFrame = -1; });
    $tlLive.addEventListener('click', () => { setLive(true); });
    let ovDrag = false;
    $overview.addEventListener('mousedown', (e) => { ovDrag = true; onOverviewNav(e); });
    window.addEventListener('mousemove', (e) => { if (ovDrag) onOverviewNav(e); });
    window.addEventListener('mouseup', () => { ovDrag = false; });

    setInterval(() => {
        const secs = viewWindow().span / FPS;
        $tlSpan.textContent = (secs >= 60 ? (secs / 60).toFixed(1) + ' min' : secs.toFixed(1) + ' s') +
            (LL.active.view.follow ? '' : ' · scrubbing');
    }, 100);

    // The mic is tab #0 — a stream over the default-mic globals. Create it and
    // bind the dashboard to it before anything emits feed rows.
    const micSt = makeStream(makeSource('mic-default'), { id: 0, kind: 'mic', label: 'mic' });
    LL.streams = [micSt];
    bindActive(micSt);

    bro.sense.start({});
    fusionRow(micSt, 'info', 'tier-0 sensors live (level / voice / onset / tonality)');

    // Retain ~10 min of the mic's raw stream so a matched region replays from the
    // detail panel. Added streams retain on open (60 s) — see addStream.
    bro.listen.retain(600);
    fusionRow(micSt, 'info', 'stream retention on — ' +
        (bro.listen.info().seconds / 60).toFixed(0) + ' min of raw audio kept');

    // Streams rack: populate the source picker (system/per-app only where loopback
    // is available; the null backend leaves just "another mic tap").
    buildSourceOptions();

    let weights = null;
    for (const p of WEIGHT_CANDIDATES) {
        try { if (fs.existsSync(p)) { weights = fs.realpathSync(p); break; } }
        catch (e) { /* next candidate */ }
    }
    if (!weights) {
        status('tier-0 only — no PhonemeNet checkpoint found (' + WEIGHT_CANDIDATES.join(', ') + ')', true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }
    try {
        bro.kws.load({ weights, threshold: +$threshold.value });
        LL.kwsReady = true;
    } catch (e) {
        status('kws load failed: ' + (e.message || e), true);
        $enroll.disabled = $record.disabled = $listen.disabled = true;
        requestAnimationFrame(tick);
        return;
    }

    // Seed one phrase template and go live (withMutableSpotter starts the mic's
    // kws session) — the dashboard is the demo.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'), phrasePolicy());
    });
    fusionRow(micSt, 'info', 'tier-2 spotter live on the shared host (template "hello there")');
    status('listening — speak, click, whistle; add a stream to watch another source');

    requestAnimationFrame(tick);
})();

// ── headless test seam ────────────────────────────────────────────────────────
// The gesture-enroll path (no live mic to record from), timeline internals
// (history ring, event log, click-to-inspect), the tabs/streams API, WAV export,
// and transcript/diarizer/translator stub installers so the VAD-gated lifecycle
// is testable without the GPU model loads. Active-stream state is exposed via accessors (the
// dashboard is now per-stream; `active()` is whichever tab is shown).
globalThis.listenLab = {
    enrollGesture, buildEditor, gainedSlice, clipStore, gestRows,
    // active-stream introspection
    active: () => LL.active,
    streams: () => LL.streams,
    ring: () => LL.activeRing(),
    events: () => LL.activeEvents(),
    view: () => LL.activeView(),
    playback: () => LL.activePlayback(),
    phLabels: () => LL.activePhLabels(),
    selectEvent, closeDetail, decodedOver, focusRegion, playFrac,
    scratchToGesture, renderScratchBar, clearScratch, scratchSpan,
    // tabs / streams
    addStream, removeStream, switchTab, buildSourceOptions, specFromSelect,
    // WAV export (+ a headless seam that forces the output path)
    exportWav, saveStreamWav, exportTo: setExportPath,
    // tier-3 transcript: real loader (manual e2e) + a stub for the test.
    Transcribe, loadTranscriber: txLoad,
    installTranscriber: (runFn) => {
        Transcribe.stubRun = runFn;                     // used by every stream's queue jobs
        Transcribe.ready = true;
        Transcribe.enabled = true;
        if (!Transcribe.tok) Transcribe.tok = { decode: () => '' };
        txSetStatus('ready · voice-gated (stub)');
        renderActivePartial('');
    },
    // tier-3.5 diarization + translation: real loaders + stubs for the test.
    Diarize: LL.Diarize, Translate: LL.Translate,
    loadDiarizer: LL.dzLoad, loadTranslator: LL.tlLoad,
    installDiarizer: (embedFn) => { LL.Diarize.stub = embedFn; LL.Diarize.ready = true; },
    installTranslator: (xlateFn) => { LL.Translate.stub = xlateFn; LL.Translate.ready = true; },
    // streaming sentence chunker — exposed so the test can drive a seal directly.
    sealSentences: (ctx, text, a, b) => LL.maybeSealSentences(ctx, text, a, b),
};
}
