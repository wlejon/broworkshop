// Kokoro Voice: kokoro-lab on one card. Voice-space design (PCA sliders,
// seeds, random, clone from a clip), VAD prosody, learned timbre, masc/fem,
// hand-painted F0 / energy and per-phoneme durations (kept across voice
// changes as a pinned edit), and the pipeline trace.
//
// exec() (Run, tests, reopened projects) uses the blocking
// synthesizeTraced / decodeFrom. The card's own controls use the
// asynchronous bro.tts.synthesize / decodeFrom, audio first and the trace a
// beat later like kokoro-lab, so a drag never blocks the UI thread.
// Not ported from kokoro-lab: the cross-stage phoneme highlight.

import { h } from "/lib/kit/dom.js";
import { types } from "./types.js";
import { mountCurvePainter } from "../widgets/curve-painter.js";
import { mountDurationCells } from "../widgets/duration-cells.js";
import { mountHeatmap } from "../widgets/heatmap.js";
import {
    section, row, pathRow, audioOut, axisSlider, directionSliders, mascFemSection,
    drawWaveform, decodeNative, gauss, fileName, AUDIO_FILTER,
} from "./common.js";
import { defaultDataRoot, loadBridge, coordsFromStyle, bridgeApply, emotionActive } from "./kokoro/voice.js";
import {
    stageOf, ensureLoaded, rebuildVoice, notePrediction, synthSyncFull, capturePin,
    emotionPlan, pinPlan, durationPlan, contourPlan, decodeAsync,
} from "./kokoro/synth.js";

const fs = require('fs');

function seedDefaults(p) {
    if (p.dataRoot === undefined) p.dataRoot = defaultDataRoot();
    if (p.text === undefined) p.text = 'Hello there. This is a test of the pipeline.';
    if (p.coords === undefined) p.coords = [];
    if (p.emo === undefined) p.emo = { v: 0, a: 0, d: 0 };
    if (p.timbre === undefined) p.timbre = {};
    if (p.mfAlpha === undefined) p.mfAlpha = 0;
    if (p.refWav === undefined) p.refWav = '';
    if (p.spkEncDir === undefined) p.spkEncDir = '';
    if (p.autoplay === undefined) p.autoplay = true;
}

const outOf = (r) => [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];

types.define({
    type: 'kokoro', label: 'Kokoro Voice', cat: 'Audio', color: '#c084fc',
    desc: 'Kokoro-82M TTS: voice design, emotion, prosody and duration editing, pipeline trace',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) {
        ensureLoaded(node);
        rebuildVoice(node);
        return outOf(synthSyncFull(node));
    },

    mount(body, node, graph, api) {
        seedDefaults(node.params);
        const p = node.params;
        const timers = {};
        const later = (key, ms, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
        api.onUnmount(() => { for (const k in timers) clearTimeout(timers[k]); });
        const edited = (key, ms, fn) => { api.markDirty(); later(key, ms, fn); };

        // --- on the card: text + output ------------------------------------------------------
        const text = h('input.form-input.wide', { type: 'text', value: p.text, placeholder: 'Type something to speak…' });
        const speak = () => { p.text = text.value; api.markDirty(); run(); };
        text.addEventListener('change', speak);
        const out = audioOut(node, { empty: 'no audio yet — set a data root', wavName: 'kokoro.wav' });
        body.append(row(null, text, h('button.small', { title: 'Speak', onclick: speak }, '▶')), out.el);

        // --- model & data source -------------------------------------------------------------
        const root = pathRow({ label: 'Data root', value: p.dataRoot, onChange: (v) => { p.dataRoot = v; node._modelSig = null; api.markDirty(); run(); } });
        const modelMeta = h('div.axis-note');

        // --- voice design ---------------------------------------------------------------------
        const seedSel = h('select.form-input.wide');
        const sliderBank = h('div.basis-sliders');
        const voiceMeta = h('span.curve-stats');
        const wav = pathRow({ label: 'Clone .wav', value: p.refWav, folder: false, filter: AUDIO_FILTER, onChange: (v) => { p.refWav = v; } });
        wav.row.appendChild(h('button.small', { onclick: () => cloneFrom(wav.input.value.trim()) }, '⤓ clone'));
        const voiceSec = section('Voice design',
            row(null, seedSel,
                h('button.small', { title: 'Random voice', onclick: randomVoice }, '🎲'),
                h('button.small', { title: 'Neutral centroid', onclick: () => setCoords(null, 'neutral centroid') }, '○')),
            sliderBank, wav.row,
            row(null, h('button.small', { onclick: saveVoicePack }, 'save voice pack'), voiceMeta));

        // --- emotion: VAD prosody (Tier 0) ---------------------------------------------------
        const vad = {};
        const vadSec = section('Emotion — prosody (VAD)');
        for (const [key, name, hint] of [['v', 'valence', 'negative ↔ positive'], ['a', 'arousal', 'calm ↔ excited'], ['d', 'dominance', 'submissive ↔ assertive']]) {
            vad[key] = axisSlider({ name, hint, min: -1, max: 1, value: p.emo[key], onInput: (v) => { p.emo[key] = v; edited('emo', 140, emotionChanged); } });
            vadSec.appendChild(vad[key].el);
        }
        vadSec.appendChild(h('button.small', {
            onclick: () => {
                p.emo.v = p.emo.a = p.emo.d = 0;
                for (const k in vad) vad[k].set(0);
                unpin(); api.markDirty(); run();
            },
        }, '○ neutral'));

        // --- emotion: learned timbre (Tier 1), masc / fem --------------------------------------
        const timbreAxes = h('div');
        const timbreOpts = { onInput: () => edited('timbre', 140, run), onPick: () => { api.markDirty(); run(); } };
        const timbreSec = section('Emotion ✦ learned', timbreAxes, h('button.small', {
            onclick: () => {
                if (node._emotionBasis) for (const e of node._emotionBasis.emotions) p.timbre[e] = 0;
                directionSliders(timbreAxes, node._emotionBasis, p.timbre, timbreOpts);
                api.markDirty(); run();
            },
        }, '○ neutral'));
        const mf = mascFemSection(p, { onInput: () => edited('mf', 140, run), onCommit: () => { api.markDirty(); run(); } });

        // --- prosody + trace ------------------------------------------------------------------
        const pinLabel = h('div.axis-note', { style: { display: 'none' } }, '✎ prosody pinned — rides across voice/emotion changes');
        const curveWrap = h('div'), alignWrap = h('div'), traceWrap = h('div');

        api.dialogBody.append(
            section('Model & data source', root.row, modelMeta), voiceSec, vadSec, timbreSec, mf.el,
            section('Prosody & alignment', pinLabel, curveWrap, alignWrap),
            section('Pipeline trace', traceWrap));

        // --- voice controls ------------------------------------------------------------------
        const sliders = [];
        function buildVoicePanel() {
            const basis = node._basis;
            seedSel.textContent = ''; sliderBank.textContent = ''; sliders.length = 0;
            if (!basis) return;
            seedSel.append(h('option', { value: '__neutral__' }, 'neutral (centroid)'), basis.names.map((n) => h('option', { value: n }, n)));
            for (let k = 0; k < basis.k; k++) {
                const [lo, hi] = basis.range[k];
                const s = axisSlider({
                    name: basis.axisName ? basis.axisName[k] : 'PC' + (k + 1), min: (lo * 1.15).toFixed(3), max: (hi * 1.15).toFixed(3),
                    value: p.coords[k] || 0, onInput: (v) => { p.coords[k] = v; edited('voice', 120, run); },
                });
                s.el.className = 'pc';
                sliders.push(s);
                sliderBank.appendChild(s.el);
            }
        }
        const syncSliders = () => sliders.forEach((s, k) => s.set(p.coords[k] || 0));
        function setCoords(values, note) {
            const basis = node._basis;
            if (!basis) return;
            for (let k = 0; k < basis.k; k++) p.coords[k] = values ? values[k] : 0;
            syncSliders();
            seedSel.value = '__neutral__';
            voiceMeta.textContent = note;
            api.markDirty();
            run();
        }
        seedSel.addEventListener('change', () => {
            const basis = node._basis;
            if (!basis) return;
            const i = basis.names.indexOf(seedSel.value);
            for (let k = 0; k < basis.k; k++) p.coords[k] = i >= 0 ? basis.anchors[i][k] : 0;
            syncSliders();
            voiceMeta.textContent = 'seed: ' + seedSel.value;
            api.markDirty();
            run();
        });
        function randomVoice() {
            const basis = node._basis;
            if (!basis) return;
            setCoords(basis.range.map(([lo, hi], k) => Math.max(lo, Math.min(hi, gauss() * (0.5 + basis.varExplained[k] * 3)))), 'random draw');
        }
        function saveVoicePack() {
            if (!node._voice) return;
            try {
                const u8 = new Uint8Array(node._voice.data.length * 4);
                new Float32Array(u8.buffer).set(node._voice.data);
                const path = node._paths.model + '/voices/designed.bin';
                fs.writeFileSync(path, u8);
                voiceMeta.textContent = 'saved → ' + path;
            } catch (e) { api.setBadge('save: ' + ((e && e.message) || e), true); }
        }
        function cloneFrom(path) {
            const basis = node._basis;
            if (!basis || !node._kokoro || !path) return;
            if (!node._bridge) node._bridge = loadBridge(node._paths.model);
            if (!node._bridge) { api.setBadge('voice_bridge.bin missing', true); return; }
            const enroll = () => {
                const dec = decodeNative(path);
                if (!dec) { api.setBadge('clone: cannot decode ' + path, true); return; }
                api.setBadge('clone: enrolling…', false);
                node._spkEnc.embedSpeaker(dec.pcm, {
                    sampleRate: dec.rate,
                    onDone: (x) => {
                        const c = coordsFromStyle(basis, bridgeApply(node._bridge, x));
                        setCoords(basis.range.map(([lo, hi], k) => Math.max(lo * 1.15, Math.min(hi * 1.15, c[k]))), 'clone: ' + fileName(path));
                        api.setBadge('ready', false);
                    },
                    onError: (m) => api.setBadge('clone: ' + m, true),
                });
            };
            if (node._spkEnc) { enroll(); return; }
            api.setBadge('clone: loading speaker encoder…', false);
            bro.tts.loadSpeakerEncoder(p.spkEncDir || node._paths.spkenc, {
                onReady: (enc) => { node._spkEnc = enc; enroll(); },
                onError: (m) => api.setBadge('clone: ' + m, true),
            });
        }

        // --- prosody editors + trace -------------------------------------------------------
        function rebuildProsody() {
            curveWrap.textContent = ''; alignWrap.textContent = '';
            const t = node._lastTrace;
            if (!t) return;
            const F0 = stageOf(t, 'F0_pred'), N = stageOf(t, 'N_pred'), pd = stageOf(t, 'pred_dur');
            if (F0 && N) {
                node._prosF0 = Array.from(F0.data); node._prosN = Array.from(N.data);
                curveWrap.appendChild(mountCurvePainter(node, {
                    count: () => 2,
                    label: (n, i) => (i === 0 ? 'pitch (F0_pred)' : 'energy (N_pred)'),
                    get: (n, i) => (i === 0 ? node._prosF0 : node._prosN),
                    original: (n, i) => node._predicted && (i === 0 ? node._predicted.F0 : node._predicted.N),
                    clamp: (n, i, v) => (i === 0 ? Math.max(0, v) : v),
                }, { onEdit: () => later('prosody', 60, commitProsody) }));
            }
            if (pd) {
                mountDurationCells(alignWrap, { count: () => pd.data.length, get: (i) => pd.data[i] }, {
                    onCommit: requestDuration,
                    onReset: () => { if (node._predicted) requestDuration(node._predicted.dur.slice()); },
                });
            }
        }
        function rebuildTrace() {
            traceWrap.textContent = '';
            const t = node._lastTrace;
            if (!t) return;
            const refs = {};
            if (stageOf(t, 'F0_pred')) refs['F0 corr'] = stageOf(t, 'F0_pred').data;
            if (stageOf(t, 'N_pred')) refs['energy corr'] = stageOf(t, 'N_pred').data;
            for (const s of t.stages) {
                if (s.name === 'F0_pred' || s.name === 'N_pred' || s.name === 'pred_dur') continue;
                let view;
                if (s.name === 'phonemes') view = h('div.chips', null, Array.from(s.data, (v) => h('span.chip', null, String(v | 0))));
                else if (s.name === 'audio') { view = h('canvas.curve-canvas', { width: 1100, height: 100 }); drawWaveform(view, s.data, 1, '#5aa0e0'); }
                else { view = h('div'); mountHeatmap(view, s, { refs }); }
                traceWrap.appendChild(h('div.trace-card', null, h('div.trace-head', null, h('span.trace-name', null, s.name), h('span', null, s.h + '×' + s.w)), view));
            }
        }
        const updatePinUI = () => { pinLabel.style.display = node._pinnedEdit ? '' : 'none'; };
        function unpin() { node._pinnedEdit = null; updatePinUI(); }

        // --- synthesis: full passes (async, two-pass like kokoro-lab) ------------------------------
        function loadLive() {
            try {
                ensureLoaded(node);
                buildVoicePanel(); syncSliders();
                directionSliders(timbreAxes, node._emotionBasis, p.timbre, timbreOpts);
                timbreSec.style.display = node._emotionBasis ? '' : 'none';
                mf.build(node._mascFemBasis);
                modelMeta.textContent = node._paths.kind + ' · ' + node._paths.model;
                api.setBadge('ready', false);
                return true;
            } catch (e) {
                modelMeta.textContent = String((e && e.message) || e);
                api.setBadge('load: ' + modelMeta.textContent, true);
                return false;
            }
        }
        function run() {
            if (!loadLive()) return;
            rebuildVoice(node);
            node._dirty = true;
            pump();
        }
        function pump() {
            if (node._synthBusy || !node._dirty || !node._kokoro || !node._voice) return;
            node._dirty = false;
            let ids;
            try { ids = bro.tts.phonemize(p.text); } catch (e) { api.setBadge('phonemize: ' + e.message, true); return; }
            if (!ids || !ids.length) { api.setBadge('no phonemes for that text', true); return; }
            if (node._pinnedEdit) synth(ids, true); else synth(ids, false);
        }
        // trace=false: audio first (fast feedback), then a traced pass for the editors.
        function synth(ids, trace) {
            const t0 = performance.now();
            node._synthBusy = true;
            try {
                bro.tts.synthesize(node._kokoro, ids, node._voice, {
                    trace,
                    onDone: (r, info) => {
                        node._synthBusy = false;
                        if (info.error) api.setBadge('synthesize: ' + info.error, true);
                        else if (!info.cancelled) {
                            if (!trace) out.publish(r.samples, r.sampleRate, 1);
                            else traced(r, performance.now() - t0);
                        }
                        if (node._dirty) pump();
                        else if (!trace && !info.error && !info.cancelled) synth(ids, true);
                    },
                });
            } catch (e) {
                node._synthBusy = false;
                api.setBadge('synthesize: ' + e.message, true);
            }
        }
        function traced(r, ms) {
            notePrediction(node, r);
            rebuildProsody(); rebuildTrace();
            api.invalidate(node, outOf(r), ms);
            if (node._pinnedEdit) {
                if (!backHalf(pinPlan(node, r), () => { rebuildProsody(); rebuildTrace(); })) { unpin(); out.publish(r.samples, r.sampleRate, 1); }
            } else if (emotionActive(p.emo)) applyEmotion();
        }

        // --- back-half re-decodes (prosody edits without the text encoder) ------------------------
        function backHalf(plan, after) {
            if (!plan || node._synthBusy || !node._lastTrace) return false;
            decodeAsync(node, plan, (t) => {
                out.publish(t.samples, t.sampleRate, 1);
                if (after) after(t);
                api.invalidate(node, outOf(t), 0);
                if (node._dirty) pump();
                else if (durPending) pumpDuration();
            }, (err) => api.setBadge('decode: ' + err, true));
            return true;
        }
        function applyEmotion() {
            if (!node._predicted || !emotionActive(p.emo)) return;
            backHalf(emotionPlan(node, node._lastTrace), () => { rebuildProsody(); rebuildTrace(); capturePin(node); updatePinUI(); });
        }
        // A back-half edit made while a decode is in flight waits for it.
        function emotionChanged() {
            if (node._synthBusy) { later('emo', 60, emotionChanged); return; }
            if (!emotionActive(p.emo)) { unpin(); run(); } else applyEmotion();
        }
        function commitProsody() {
            if (node._synthBusy) { later('prosody', 60, commitProsody); return; }
            if (!node._lastTrace || !stageOf(node._lastTrace, 'asr')) return;
            api.markDirty();
            backHalf(contourPlan(node, node._lastTrace, Float32Array.from(node._prosF0), Float32Array.from(node._prosN)),
                () => { rebuildTrace(); capturePin(node); updatePinUI(); });
        }
        let durPending = false;
        function requestDuration(work) {
            node._pendingDur = work;
            durPending = true;
            api.markDirty();
            pumpDuration();
        }
        function pumpDuration() {
            if (node._synthBusy || !durPending || !node._lastTrace || !node._curDur) return;
            durPending = false;
            backHalf(durationPlan(node, node._lastTrace, node._pendingDur.slice()), () => {
                if (durPending) return;
                later('heat', 350, () => { rebuildProsody(); rebuildTrace(); });
                capturePin(node); updatePinUI();
            });
        }

        if (node._lastTrace) { rebuildProsody(); rebuildTrace(); updatePinUI(); }
        if (p.dataRoot) run();
    },
});
