// Listen Lab — the listening stack live: bro.sense tier-0 sensors, bro.kws
// template alignment, bro.gesture non-speech matching and a voice-gated
// Qwen3-ASR transcript (diarized + translated), fused in one poll loop over
// every open stream.
//
//   state.js       DOM handles, the stream list, status, fusion feed, WAV export
//   ring.js        per-stream history ring / view / playback + the event log
//   timeline.js    the scrollable ~10 min timeline, overview and scratch bar
//   detail.js      click-to-inspect panel + region playback
//   sensors.js     tier-0 cards + feed edges
//   kws.js         tier-2 sessions, template rows, token panel
//   gestures.js    tier-0 gestures, clip editor, ● Record
//   transcript.js  tier-3 Qwen3-ASR, one context per stream, sentence chunker
//   diarize.js     tier-3.5 speaker x-vectors + online clustering
//   translate.js   tier-3.5 NLLB-200 live/fast + Qwen3-1.7B context refine
//   streams.js     sources as tabs
//
// This module wires them, runs the poll loop, boots, and exports `lab`, the
// seam tests/test_main.js drives. main.js only imports it.

import { boot } from "/lib/kit/app.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";
import { D, app, status, fusionRow, phrasePolicy, exportWav, saveStreamWav, setExportPath } from "/app/state.js";
import { cur, PH_CONF, decodedOver, focusRegion } from "/app/ring.js";
import { selectEvent, closeDetail, playFrac, updatePlayback } from "/app/detail.js";
import { drawStream, spanLabel, bindTimelineInput, scratchToGesture, renderScratchBar, clearScratch, scratchSpan } from "/app/timeline.js";
import { renderSensors, emitTier0Events } from "/app/sensors.js";
import { updateTemplateRows, withMutableSpotter, startStreamKws, stopStreamKws, enrollPhrase } from "/app/kws.js";
import { enrollGesture, buildEditor, gainedSlice, clipStore, gestRows, toggleRecord } from "/app/gestures.js";
import {
    Transcribe, commitHooks, partialHooks, transcribeTick, txLoad, txSetStatus, renderActivePartial,
    renderLines, installTranscriber, maybeSealSentences,
} from "/app/transcript.js";
import { Diarize, assignSpeaker, dzLoad } from "/app/diarize.js";
import { Translate, Refine, maybeTranslate, onLivePartial, tlLoad, ctxRefine } from "/app/translate.js";
import { picker, makeSource, makeStream, bindActive, addStream, removeStream, switchTab } from "/app/streams.js";

boot();

// The published model (brosoundml-data), else phoneme_train's default output.
const PHONEME_NET = ['brosoundml-data/phoneme/english.bpm', 'brosoundml/weights/phoneme/english.bpm'];

// Tier-3.5 rides every committed line and every live partial.
commitHooks.push(assignSpeaker, maybeTranslate);
partialHooks.push(onLivePartial);

// ── the poll loop: update EVERY stream, render the ACTIVE one ───────────────

let txBooted = false;

// The Qwen3-ASR / speaker-encoder / Qwen3 loads are real GPU loads: auto-load
// them in the live app, deferred to the first frame. Headless tests install
// stubs through the seam instead, so the VAD-gated lifecycle is testable
// without the models.
function bootTranscript() {
    if (txBooted) return;
    txBooted = true;
    if (typeof advanceTime === 'function') { txSetStatus('headless — install a runner to test'); return; }
    txLoad();          // Qwen3-ASR transcription + language ID
    dzLoad();          // ECAPA speaker encoder -> diarization
    tlLoad();          // NLLB-200 (live/fast) + Qwen3-1.7B (context correctness) -> English
}

/** One stream's state, no DOM: snapshot -> ring, tier-0 edges, tier-1 phoneme, transcript. */
function updateStream(st) {
    const src = st.source;
    const s = src.sense.isActive() ? src.sense.snapshot() : null;
    let ph = null;
    if (app.kwsReady && src.kwsLoaded()) {
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
    st.txCtx._prev = prev; st.txCtx._cur = s;
    transcribeTick(st.txCtx);
}

function renderActive() {
    const st = app.active;
    renderSensors(st);
    if (app.kwsReady && st.source.kwsLoaded()) {
        const p = st.source.kws.progress();
        if (p) updateTemplateRows(st, p, st.lastS);
    }
    if (updatePlayback()) renderLines();
    drawStream();
    D.spotCount.textContent = String(st.spots);
    D.tlSpan.textContent = spanLabel();
}

function tick() {
    bootTranscript();
    for (const st of app.streams) updateStream(st);
    renderActive();
    requestAnimationFrame(tick);
}

// ── controls ────────────────────────────────────────────────────────────────

D.enroll.addEventListener('click', enrollPhrase);
D.phrase.addEventListener('keydown', (e) => { if (e.key === 'Enter') enrollPhrase(); });
D.record.addEventListener('click', toggleRecord);
D.listen.addEventListener('click', () => {
    const st = app.active;
    if (st.kwsListening) stopStreamKws(st); else startStreamKws(st);
});
D.txToggle.addEventListener('click', () => {
    Transcribe.enabled = !Transcribe.enabled;            // pauses every stream's transcript
    if (!Transcribe.enabled && app.active) {
        app.active.txCtx.tx.active = false;
        app.active.txCtx.tx.partial = '';
        renderActivePartial('');
    }
    txSetStatus(Transcribe.enabled ? 'ready · voice-gated' : 'paused');
});
D.addStream.addEventListener('click', () => {
    const spec = picker.spec();
    if (!spec) { status('pick a source first', true); return; }
    addStream(spec);
});
bindTimelineInput();

// ── boot ────────────────────────────────────────────────────────────────────

// The mic is tab #0: a stream over the default-mic globals. Bind the dashboard
// to it before anything emits feed rows.
const micSt = makeStream(makeSource('mic-default'), { id: 0, kind: 'mic', label: 'mic' });
app.streams = [micSt];
bindActive(micSt);

bro.sense.start({});
fusionRow(micSt, 'info', 'tier-0 sensors live (level / voice / onset / tonality)');

// Retain ~10 min of the mic's raw stream so a matched region replays from the
// detail panel. Added streams retain 60 s (see addStream).
bro.listen.retain(600);
fusionRow(micSt, 'info', 'stream retention on — ' + (bro.listen.info().seconds / 60).toFixed(0) + ' min of raw audio kept');

(function bootKws() {
    const weights = findWeights(PHONEME_NET);
    const off = (msg) => {
        status(msg, true);
        D.enroll.disabled = D.record.disabled = D.listen.disabled = true;
    };
    if (!weights) { off('tier-0 only — ' + missingWeights('PhonemeNet checkpoint', PHONEME_NET)); return; }
    try {
        bro.kws.load({ weights, threshold: +D.threshold.value });
        app.kwsReady = true;
    } catch (e) { off('kws load failed: ' + (e.message || e)); return; }

    // Seed one phrase template and go live: the dashboard is the demo.
    withMutableSpotter(() => {
        bro.kws.enroll('hello there', bro.tts.phonemize('hello there'), phrasePolicy());
    });
    fusionRow(micSt, 'info', 'tier-2 spotter live on the shared host (template "hello there")');
    status('listening — speak, click, whistle; add a stream to watch another source');
})();

requestAnimationFrame(tick);

// ── test seam ───────────────────────────────────────────────────────────────
// The gesture-enroll path (no live mic to record from), timeline internals,
// the tabs/streams API, WAV export, and stub installers for the transcript,
// diarizer, translator and correctness tier, so their lifecycles are testable
// without the GPU models. `active()` is whichever tab is shown.
export const lab = {
    enrollGesture, buildEditor, gainedSlice, clipStore, gestRows,
    active: () => app.active,
    streams: () => app.streams,
    ring: () => cur.ring,
    events: () => cur.events,
    view: () => cur.view,
    playback: () => cur.playback,
    phLabels: () => cur.phLabels,
    selectEvent, closeDetail, decodedOver, focusRegion, playFrac,
    scratchToGesture, renderScratchBar, clearScratch, scratchSpan,
    addStream, removeStream, switchTab,
    buildSourceOptions: () => picker.rebuild(),
    specFromSelect: () => picker.spec(),
    exportWav, saveStreamWav, exportTo: setExportPath,
    Transcribe, loadTranscriber: txLoad, installTranscriber,
    Diarize, Translate, Refine,
    loadDiarizer: dzLoad, loadTranslator: tlLoad,
    installDiarizer: (embedFn) => { Diarize.stub = embedFn; Diarize.ready = true; },
    installTranslator: (xlateFn) => { Translate.stub = xlateFn; Translate.ready = true; },
    installRefiner: (refineFn) => { Refine.stub = refineFn; Refine.ready = true; },
    refine: (st, line) => ctxRefine(st, line),
    sealSentences: (ctx, text, a, b) => maybeSealSentences(ctx, text, a, b),
};
