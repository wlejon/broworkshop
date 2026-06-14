// Listen Lab — orchestrator: tier-0 sensor cards, tier-2 template rows, the poll
// loop that fuses every tier, enroll/listen controls, boot, and the headless
// test seam. The heavy machinery lives in sibling modules sharing the `LL`
// namespace (see core.js): timeline.js (history ring + detail + playback),
// transcript.js (tier-3 Parakeet), gestures.js (non-speech + clip editor),
// streams.js (the streams rack). This file loads LAST.
;(function () {
    const LL = globalThis.LL;
    const fs = require('fs');
    const {
        $dbBig, $levelFill, $floorMark, $levelSmall, $voiceDot, $voiceTxt, $voiceSmall,
        $onsetDot, $onsetTxt, $tonalDot, $tonalTxt, $tonalSmall, $streamT,
        $tmpls, $noTmpls, $listen, $phrase, $enroll, $record, $threshold, $txToggle,
        $srcSel, $addStream, $refreshApps, $streamsSub, $spotCount, $tlLive, $tlSpan,
        $chart, $overview,
        status, fusionRow, FPS, phrasePolicy, PH_CONF,
        phLabels, Stream, drawStream, sizeCanvas, setLive, viewWindow,
        onTimelineDown, onTimelineMove, onTimelineUp, onTimelineWheel, onOverviewNav,
        logEvent, toStreamSpan, decodedOver, selectEvent, closeDetail, focusRegion,
        playFrac, Playback, View, events, updatePlayback,
        scratchToGesture, renderScratchBar, clearScratch, scratchSpan,
        Transcribe, PrimarySource, transcribeTick, txLoad, txSetStatus, renderPartial,
        updateStreamPanels, mirrorToStreams,
        buildSourceOptions, specFromSelect, addStream, removeStream, setPanelAction, panels,
        exportWav, saveStreamWav, setExportPath,
        enrollGesture, buildEditor, gainedSlice, clipStore, gestRows, toggleRecord,
    } = LL;

    const WEIGHT_CANDIDATES = [
        '../../../brosoundml/weights/phoneme/english.bpm',
        '../../../brosoundml/build-cuda/english.bpm',
        'D:/projects/brosoundml/weights/phoneme/english.bpm',
        'D:/projects/brosoundml/build-cuda/english.bpm',
    ];

    let listening = false;            // bro.kws.listen() active on the mic dashboard
    const rhythmNames = {};           // name -> true for templates enrolled with gaps

// ── tier-0 sensor cards ──────────────────────────────────────────────────────

const dbPct = (db) => Math.max(0, Math.min(100, (db + 80) / 80 * 100));

function updateSensorCards(s, ph) {
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

    // Onset is true only on its trigger frame; hold the dot lit briefly via
    // the last-event frame index instead of trying to catch that one frame.
    $onsetDot.className = 'dot onset' + (s.frames - s.lastOnsetFrame < 15 ? ' on' : '');
    $onsetTxt.textContent = String(s.onsets);

    $tonalDot.className = 'dot tonal' + (s.tonal ? ' on' : '');
    $tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
    $tonalSmall.textContent = 'periodicity ' + s.periodicity.toFixed(2) +
        (s.tonal ? ' · run ' + (s.tonalFrames / 100).toFixed(1) + ' s' : '');

    $streamT.textContent = s.t.toFixed(1) + ' s';
}

// ── tier-0 event edges → fusion feed ─────────────────────────────────────────

let tonalAnnounced = false;

function emitTier0Events(prev, s) {
    if (s.voiceEvents > prev.voiceEvents)
        fusionRow('voice', 'voice started (snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB)');
    if (!s.voice && prev.voice)
        fusionRow('voice', 'voice ended after ' + (prev.voiceFrames / 100).toFixed(1) + ' s');
    if (s.onsets > prev.onsets) {
        const n = s.onsets - prev.onsets;
        fusionRow('onset', n === 1 ? 'transient' : n + ' transients');
    }
    if (s.tonal && s.tonalFrames >= 30 && !tonalAnnounced) {
        tonalAnnounced = true;
        fusionRow('tonal', 'sustained tone ~' + Math.round(s.dominantHz) +
            ' Hz (periodicity ' + s.periodicity.toFixed(2) + ')');
    }
    if (!s.tonal) tonalAnnounced = false;
}

// ── tier-2 template rows (bro.kws.progress) ──────────────────────────────────

const tmplRows = {};           // name -> { root, fill, meta }
let lastGeneration = -1;
const armState = {};           // name -> announced "arming" for the current attempt
const lastCompletions = {};

function rebuildTemplateRows(p) {
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
        lastCompletions[t.name] = t.completions;
    }
    $listen.disabled = !LL.kwsReady || p.templates.length === 0;
}

function updateTemplateRows(p, s) {
    if (p.generation !== lastGeneration) {
        lastGeneration = p.generation;
        rebuildTemplateRows(p);
    }
    for (const t of p.templates) {
        const row = tmplRows[t.name];
        if (!row) continue;
        row.fill.style.width = (t.progress * 100).toFixed(0) + '%';
        row.meta.textContent = t.matched + '/' + t.length +
            ' · conf ' + t.confidence.toFixed(2) + ' · fires ' + t.completions;
        if (t.completions > (lastCompletions[t.name] || 0)) flashRow(t.name);
        lastCompletions[t.name] = t.completions;

        // The fusion moment: most of a template has aligned and its partial
        // confidence is already in threshold territory — this is where a
        // heavier tier (streaming STT confirmation) would spin up, seconds
        // before any onSpot fires.
        if (!armState[t.name] && t.matched < t.length && t.progress >= 0.5) {
            armState[t.name] = true;
            fusionRow('arm', '"' + t.name + '" ' + t.matched + '/' + t.length +
                ' aligned @ conf ' + t.confidence.toFixed(2) +
                (s && s.voice ? ' · voice live' : '') +
                ' — confirmation tier would arm here');
            logEvent('arm', t.name, t.confidence, '',
                { matched: t.matched, length: t.length });
        } else if (armState[t.name] && t.progress < 0.3) {
            armState[t.name] = false;
        }
    }
}

function flashRow(name) {
    const row = tmplRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    // Re-look-up at expiry: a template-set rebuild may have replaced (and
    // detached) this row in the meantime.
    setTimeout(() => { if (tmplRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── token panel — bro.kws.inspect: see (and edit) what a template became ──────
// A phrase enrolled as "what is the first" is really the phoneme sequence
// [W AH T · IH Z · DH AH · F ER S T]; a recorded click gesture is whatever
// garbage phonemes the speech model decoded plus its timed gaps. Showing that
// makes both the suffix-firing and the "sounds don't work" problems legible —
// and for a plain phrase the user can drop tokens and re-enroll the trimmed
// sequence (enrollFromClasses), the intuitive clip edit.

function toggleTokens(name, root, btn) {
    const existing = root.querySelector('.tokens');
    if (existing) { existing.remove(); btn.classList.remove('open'); return; }
    const view = bro.kws.inspect(name);
    if (!view) { status('inspect: no template "' + name + '"', true); return; }
    btn.classList.add('open');

    const panel = document.createElement('div');
    panel.className = 'tokens';
    // A working copy of the editable token list (sound states only; gaps are
    // shown but not editable — re-enroll goes through enrollFromClasses, which
    // can't carry timed gaps).
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
            // Editable only for plain (non-rhythm) phrases.
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
                fusionRow('info', 'edited "' + name + '" to ' + cls.length + ' tokens');
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

// ── the poll loop — ONE place fuses every tier ───────────────────────────────

let lastS = null;
let txBooted = false;

// Tier-3 transcript auto-load decision, deferred to the first frame: the
// headless globals (advanceTime) are installed AFTER the app's top-level boot
// runs, so the only reliable place to detect headless is from a frame callback.
// The 2.4 GB Parakeet load is real — auto-load it for the live app; in headless
// the test installs a stub runner through the seam instead, so the suite never
// pulls the heavy model.
function bootTranscript() {
    if (txBooted) return;
    txBooted = true;
    if (typeof advanceTime === 'function') txSetStatus('headless — install a runner to test');
    else txLoad();
}

function tick() {
    bootTranscript();
    const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
    // tier-1: the live top phoneme, cached and ring-stored alongside the sensors.
    let ph = null;
    if (LL.kwsReady && bro.kws.isLoaded()) {
        const post = bro.kws.posterior(1);
        if (post && post.top.length) {
            const top = post.top[0];
            phLabels[top.cls] = top.label;
            if (top.cls !== 0 && top.p >= PH_CONF) ph = top;
        }
    }
    if (s) {
        updateSensorCards(s, ph);
        if (!lastS || s.frames > lastS.frames) Stream.push(lastS, s, ph);
        if (lastS) emitTier0Events(lastS, s);
        PrimarySource._prev = lastS; PrimarySource._cur = s;
        lastS = s;
    }
    if (LL.kwsReady && bro.kws.isLoaded()) {
        const p = bro.kws.progress();
        if (p) updateTemplateRows(p, s);
    }
    updateStreamPanels();
    // Primary (mic) transcript — runs concurrently with any stream transcripts
    // (updateStreamPanels drives those); all model calls share one queue.
    transcribeTick(PrimarySource);
    updatePlayback();
    drawStream();
    requestAnimationFrame(tick);
}

// ── enroll / record / listen ─────────────────────────────────────────────────

// Template mutators share the spotter's feed thread, so they're rejected while
// listening; bounce the live session around any mutation.
function withMutableSpotter(fn) {
    const wasListening = listening;
    if (wasListening) stopListening();
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    if (wasListening && bro.kws.templates().length) startListening();
    $listen.disabled = !LL.kwsReady || bro.kws.templates().length === 0;
    mirrorToStreams();                    // keep every kws stream's vocabulary in sync
}

function enrollPhrase() {
    const text = $phrase.value.trim();
    if (!text || !LL.kwsReady) return;
    withMutableSpotter(() => {
        const len = bro.kws.enroll(text, bro.tts.phonemize(text), phrasePolicy());
        status('enrolled "' + text + '" (' + len + ' phoneme classes)');
        fusionRow('info', 'enrolled phrase "' + text + '" (' + len + ' classes)');
        $phrase.value = '';
    });
}

function startListening() {
    bro.kws.listen({
        onSpot: (name, confidence, span) => {
            LL.spots++;
            $spotCount.textContent = String(LL.spots);
            const s = bro.sense.isActive() ? bro.sense.snapshot() : null;
            fusionRow('spot', '"' + name + '" completed @ conf ' + confidence.toFixed(3) +
                (s && s.voice ? ' · voice run ' + (s.voiceFrames / 100).toFixed(1) + ' s' : ''));
            // The matcher reports the span on the SPOTTER's frame axis; the
            // timeline + retention run on the shared STREAM axis (bro.sense /
            // host frames), which diverges from the spotter's once the spotter
            // joins after sense (live mic). Re-anchor on the stream axis using
            // the axis-independent matched DURATION ending ~now (the fire just
            // happened): start = now − matchedFrames. Gestures already report on
            // the sense axis, so only spots need this.
            logEvent('spot', name, confidence, '', null, toStreamSpan(span, s));
            flashRow(name);
            armState[name] = false;
        },
    });
    listening = true;
    $listen.textContent = 'Stop';
    $listen.classList.add('active');
}

function stopListening() {
    bro.kws.stop();
    listening = false;
    $listen.textContent = 'Listen';
    $listen.classList.remove('active');
}

$enroll.addEventListener('click', enrollPhrase);
$phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
$record.addEventListener('click', toggleRecord);
$listen.addEventListener('click', () => (listening ? stopListening() : startListening()));
$txToggle.addEventListener('click', () => {
    Transcribe.enabled = !Transcribe.enabled;           // pauses every context's transcript
    if (!Transcribe.enabled) {
        PrimarySource.tx.active = false; PrimarySource.tx.partial = '';
        renderPartial(PrimarySource);
    }
    txSetStatus(Transcribe.enabled ? 'ready · voice-gated' : 'paused');
});

$addStream.addEventListener('click', () => {
    const spec = specFromSelect();
    if (!spec) { status('pick a source first', true); return; }
    addStream(spec);
});
$refreshApps.addEventListener('click', buildSourceOptions);

// ── boot ─────────────────────────────────────────────────────────────────────

(function boot() {
    sizeCanvas($chart);
    sizeCanvas($overview);
    // drawStream() re-checks canvas size every frame (see sizeCanvas), so it
    // self-corrects on resize / DPI change without a separate resize listener.

    // Timeline interaction: drag to pan, wheel to zoom, click a marker to
    // inspect, Live to re-pin the edge, overview to scrub the full history.
    $chart.addEventListener('mousedown', onTimelineDown);
    window.addEventListener('mousemove', onTimelineMove);
    window.addEventListener('mouseup', onTimelineUp);
    $chart.addEventListener('wheel', onTimelineWheel, { passive: false });
    $chart.addEventListener('mouseleave', () => { View.hoverFrame = -1; });
    $tlLive.addEventListener('click', () => { setLive(true); });
    let ovDrag = false;
    $overview.addEventListener('mousedown', (e) => { ovDrag = true; onOverviewNav(e); });
    window.addEventListener('mousemove', (e) => { if (ovDrag) onOverviewNav(e); });
    window.addEventListener('mouseup', () => { ovDrag = false; });

    // Keep the visible span label in sync with the view each frame.
    setInterval(() => {
        const secs = viewWindow().span / FPS;
        $tlSpan.textContent = (secs >= 60 ? (secs / 60).toFixed(1) + ' min' : secs.toFixed(1) + ' s') +
            (View.follow ? '' : ' · scrubbing');
    }, 100);

    // Tier-0 first: model-free, always available, no weights needed.
    bro.sense.start({});
    fusionRow('info', 'tier-0 sensors live (level / voice / onset / tonality)');

    // Retain ~10 min of the raw shared stream so a matched region can be
    // replayed from the detail panel (opt-in; ~38 MB). Source-agnostic — it
    // captures whatever feeds the host, mic or otherwise.
    bro.listen.retain(600);
    fusionRow('info', 'stream retention on — ' +
        (bro.listen.info().seconds / 60).toFixed(0) + ' min of raw audio kept');

    // Streams rack: populate the source picker. System / per-app loopback is
    // offered only where render-side capture is available (Windows here; the
    // null backend reports unsupported, leaving just "another mic tap").
    buildSourceOptions();

    // require('fs') resolves relative paths against the app dir, but the C++
    // loader resolves against the process CWD — hand it an absolute path.
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

    // Seed one phrase template and go live — the dashboard is the demo.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'), phrasePolicy());
    });
    startListening();
    fusionRow('info', 'tier-2 spotter live on the shared host (template "hello there")');
    status('listening — speak, click, whistle; enroll phrases or record a rhythm gesture');

    requestAnimationFrame(tick);
})();

// Headless test seam: the gesture-enroll path (no live mic to record from)
// plus the timeline internals (history ring, event log, click-to-inspect) so
// the scrollback/marker/detail behaviour is testable without mouse events.
globalThis.listenLab = {
    enrollGesture,
    Stream, events, View, phLabels,
    selectEvent, closeDetail, decodedOver,
    scratchToGesture, renderScratchBar, clearScratch, scratchSpan,
    buildEditor, gainedSlice, clipStore, gestRows,
    Playback, focusRegion, playFrac,
    // streams rack: open/close/configure arbitrary-source streams + reach them.
    addStream, removeStream, setPanelAction, panels,
    buildSourceOptions, specFromSelect, mirrorToStreams,
    PrimarySource,
    // WAV export: the dialog-driven path plus a headless seam that skips the
    // native dialog by forcing the output path (exportPathOverride).
    exportWav, saveStreamWav,
    exportTo: setExportPath,
    // tier-3 transcript: real loader (manual e2e check) + a stub installer that
    // makes the VAD-gated lifecycle testable without the 2.4 GB Parakeet load.
    Transcribe, loadTranscriber: txLoad,
    installTranscriber: (runFn) => {
        Transcribe.stubRun = runFn;                     // used by every context's queue jobs
        Transcribe.ready = true;
        Transcribe.enabled = true;
        if (!Transcribe.tok) Transcribe.tok = { decode: () => '' };
        txSetStatus('ready · voice-gated (stub)');
        renderPartial(PrimarySource);
    },
};
})();
