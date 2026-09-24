// Listen Lab — gestures (tier-0 non-speech) + clip editor + mic recording.
//
// The gesture VOCABULARY is shared (one master, bro.gesture = the mic stream's
// matcher); the right-column rows render it. But EVERY stream runs its own
// gesture session (the mic's master + each added stream's handle session) over
// the shared SensorHub, so a click/whistle on any source fires on THAT
// stream's dashboard. Enrolling adds to the master and mirrors onto every
// stream. Each enrolled clip is kept, so a row's editor can audition, trim,
// change the volume, re-record and tune the match tolerances.

import { h, clear } from "/lib/kit/dom.js";
import { gained, peakOf, toDb, micRecorder } from "/lib/kit/audio.js";
import { waveView } from "/lib/kit/audio-ui.js";
import { D, app, status, fusionRow, btn } from "/app/state.js";
import { logEvent } from "/app/ring.js";
import { playSamples } from "/app/detail.js";

export const gestRows = {};     // name -> { root, body, editBtn }
export const clipStore = {};    // name -> Float32Array (raw 16 kHz enroll clip)
const policyStore = {};         // name -> per-gesture tolerance overrides
let openEditor = null;          // name of the gesture whose editor is expanded
let currentEd = null;           // the live editor (for listener teardown)
const GEST_RATE = 16000;        // bro.gesture.sampleRate(): fixed host rate

/** Scale a clip slice by a gain (the volume slider's bake). */
export const gainedSlice = gained;

function rhythmShape(v) {
    if (!v.onsets || !v.onsets.length) return '';
    let voiced = 0, pitchSum = 0, pitchN = 0;
    for (const o of v.onsets) {
        if (o.voiced >= 0.5) { voiced++; if (o.pitchHz > 0) { pitchSum += o.pitchHz; pitchN++; } }
    }
    if (voiced === 0) return ' · clicks';
    if (voiced === v.onsets.length) return pitchN ? ' · voiced ~' + Math.round(pitchSum / pitchN) + ' Hz' : ' · voiced';
    return ' · mixed';
}

export function gestureSummary(v) {
    if (!v) return '';
    if (v.kind === 'tone') {
        return 'tone · ' + Math.round(v.toneHz) + ' Hz · ' + Math.round(v.toneMs) +
            ' ms · ±' + (v.toneSpread * 100).toFixed(1) + '%';
    }
    return 'rhythm · ' + (v.intervalsMs.length + 1) + ' taps · ' +
        v.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms' + rhythmShape(v);
}

export function renderGestureRows() {
    for (const k of Object.keys(gestRows)) { gestRows[k].root.remove(); delete gestRows[k]; }
    const names = bro.gesture.templates();
    D.noGest.style.display = names.length ? 'none' : '';
    for (const name of names) {
        const v = bro.gesture.inspect(name);
        const has = !!clipStore[name];
        const editBtn = h('button.edit', {
            disabled: !has, onclick: () => toggleEditor(name),
            title: has ? 'audition, trim, tune' : 'no retained clip (enrolled before edit existed)',
        }, 'edit');
        const body = h('div.geditor');
        const root = h('div.gest', null,
            h('div.grow', null,
                h('span.gname', null, name),
                h('span.gkind' + (v ? '.' + v.kind : ''), null, v ? v.kind : '?'),
                h('span.gmeta', null, gestureSummary(v)),
                editBtn,
                h('button.rm', {
                    title: 'remove',
                    onclick: () => {
                        if (openEditor === name) openEditor = null;
                        delete clipStore[name]; delete policyStore[name];
                        withMutableGesture(() => bro.gesture.remove(name));
                    },
                }, '×')),
            body);
        D.gestures.appendChild(root);
        gestRows[name] = { root, body, editBtn };
    }
    if (openEditor && gestRows[openEditor]) buildEditor(openEditor);
}

function flashGesture(name) {
    const row = gestRows[name];
    if (!row) return;
    row.root.classList.add('fired');
    setTimeout(() => { if (gestRows[name] === row) row.root.classList.remove('fired'); }, 600);
}

// ── clip editor (audition / trim / volume / re-record / tune) ───────────────

function detachEditor() {
    if (currentEd) currentEd.view.dispose();
    currentEd = null;
}

function toggleEditor(name) {
    if (!clipStore[name]) { status('no retained clip for "' + name + '" — re-record to edit', true); return; }
    openEditor = (openEditor === name) ? null : name;
    for (const k of Object.keys(gestRows)) {
        if (k !== openEditor) { clear(gestRows[k].body); gestRows[k].editBtn.classList.remove('open'); }
    }
    if (!openEditor) { detachEditor(); return; }
    buildEditor(openEditor);
}

function updateInfo(ed) {
    const a = Math.round(ed.sel.a), b = Math.round(ed.sel.b), v = ed.v;
    const kindStr = v ? (v.kind === 'tone'
        ? 'tone · ' + Math.round(v.toneHz) + ' Hz · captured ±' + (v.toneSpread * 100).toFixed(1) + '% spread'
        : 'rhythm · ' + (v.intervalsMs.length + 1) + ' taps' + rhythmShape(v)) : '';
    const pk = toDb(peakOf(ed.clip, ed.gain, a, b));
    ed.info.textContent = 'selection ' + ((b - a) / GEST_RATE).toFixed(2) + ' s · ' + kindStr +
        ' · peak ' + (pk === -Infinity ? '−∞' : pk.toFixed(1)) + ' dB' + (pk > -0.1 ? ' ⚠ clipping' : '');
}

/** A tolerance slider: re-enrolls with the new policy on release. */
function tolSlider(name, label, key, val, min, max, step) {
    const out = h('b', null, (val * 100).toFixed(0) + '%');
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val) });
    input.addEventListener('input', () => { out.textContent = (+input.value * 100).toFixed(0) + '%'; });
    input.addEventListener('change', () => {
        const pol = Object.assign({}, policyStore[name] || {});
        pol[key] = +input.value;
        reEnroll(name, clipStore[name], pol);
    });
    return h('label.gslider', null, h('span', null, label), input, out);
}

/** The volume slider: redraws live, bakes the gain into the clip on release. */
function gainSlider(ed, name) {
    const out = h('b', null, '×' + ed.gain.toFixed(2));
    const input = h('input', { type: 'range', min: '0', max: '4', step: '0.05', value: String(ed.gain) });
    input.addEventListener('input', () => {
        ed.gain = +input.value;
        out.textContent = '×' + ed.gain.toFixed(2);
        ed.view.set({ gain: ed.gain });
        updateInfo(ed);
    });
    input.addEventListener('change', () => {
        ed.gain = +input.value;
        if (Math.abs(ed.gain - 1) < 1e-3) return;
        reEnroll(name, gained(ed.clip, ed.gain), policyStore[name]);
    });
    return h('label.gslider', null, h('span', null, 'volume'), input, out);
}

export function buildEditor(name) {
    const row = gestRows[name];
    if (!row) return;
    const clip = clipStore[name];
    if (!clip) { clear(row.body).appendChild(h('span.ghint', null, 'no retained clip — re-record to edit')); return; }
    detachEditor();
    row.editBtn.classList.add('open');
    const v = bro.gesture.inspect(name);
    const canvas = h('canvas.gwave');
    const ed = { name, clip, v, gain: 1, sel: { a: 0, b: clip.length }, info: h('div.ginfo'), view: null };
    currentEd = ed;

    const rerec = btn('● Re-record', () => startRecord(name, rerec));
    const pol = policyStore[name] || {};
    const pick = (k, d) => (pol[k] != null ? pol[k] : d);
    clear(row.body).append(
        canvas, ed.info,
        h('div.gacts', null,
            btn('▶ Play', () => playSamples(gained(clip, ed.gain, Math.round(ed.sel.a), Math.round(ed.sel.b)), GEST_RATE)),
            rerec,
            btn('✂ Trim & re-enroll', () => {
                const a = Math.round(ed.sel.a), b = Math.round(ed.sel.b);
                if (b - a < GEST_RATE / 10) { status('selection too short (<0.1 s)', true); return; }
                reEnroll(name, gained(clip, ed.gain, a, b), policyStore[name]);
            })),
        h('div.gtol', null,
            gainSlider(ed, name),
            v && v.kind === 'tone'
                ? [tolSlider(name, 'pitch ±', 'pitchTol', pick('pitchTol', 0.12), 0.02, 0.30, 0.01),
                   tolSlider(name, 'steadiness', 'pitchStabilityTol', pick('pitchStabilityTol', 0.06), 0.01, 0.20, 0.005)]
                : [tolSlider(name, 'tempo ±', 'tempoTol', pick('tempoTol', 0.40), 0.05, 0.80, 0.05),
                   tolSlider(name, 'shape ±', 'shapeTol', pick('shapeTol', 0.30), 0.10, 0.60, 0.05)]));

    ed.view = waveView(canvas, { height: 76, trim: true, onTrim: () => updateInfo(ed) });
    ed.view.set({ clip, gain: 1, analysis: bro.sense.analyze(clip), sel: ed.sel });
    updateInfo(ed);
}

function reEnroll(name, clip, policy) {
    withMutableGesture(() => {
        bro.gesture.enrollFromAudio(name, clip, policy || {});
        clipStore[name] = clip;
        if (policy) policyStore[name] = policy;
        const summary = gestureSummary(bro.gesture.inspect(name));
        status('re-enrolled "' + name + '" (' + summary + ')');
        fusionRow(app.active, 'info', 're-enrolled gesture "' + name + '" — ' + summary);
    });
}

// ── per-stream gesture sessions ─────────────────────────────────────────────

function onGestureFire(st, name, confidence, kind, span) {
    st.spots++;
    fusionRow(st, 'spot', 'gesture "' + name + '" (' + kind + ') @ conf ' + confidence.toFixed(3));
    logEvent(st, 'gesture', name, confidence, kind, null, span);
    if (st === app.active) {
        flashGesture(name);
        D.spotCount.textContent = String(st.spots);
    }
}

export function startStreamGesture(st) {
    if (st.gestureListening) return;
    st.source.gesture.listen({
        onGesture: (name, confidence, kind, span) => onGestureFire(st, name, confidence, kind, span),
    });
    st.gestureListening = true;
}

export function stopStreamGesture(st) {
    try { st.source.gesture.stop(); } catch (e) { /* not listening */ }
    st.gestureListening = false;
}

/**
 * Replay the master vocabulary onto every added (handle) stream's own session;
 * the mic stream IS the master, so it is skipped. Sessions must be stopped
 * first (mutators share the matcher feed thread).
 */
export function mirrorGesturesToStreams() {
    for (const st of app.streams) {
        if (!st.source.isHandle) continue;
        try { if (st.source.gesture.clear) st.source.gesture.clear(); } catch (e) { /* best-effort */ }
        for (const name of bro.gesture.templates()) {
            const clip = clipStore[name];
            if (!clip) continue;
            try { st.source.gesture.enrollFromAudio(name, clip, policyStore[name] || {}); }
            catch (e) { /* skip a clip that won't enroll on this session */ }
        }
    }
}

/** Bounce every stream's session around a vocabulary change, then re-mirror + restart. */
function withMutableGesture(fn) {
    for (const st of app.streams.filter((s) => s.gestureListening)) stopStreamGesture(st);
    try { fn(); }
    catch (e) { status(String(e.message || e), true); }
    renderGestureRows();
    mirrorGesturesToStreams();
    if (bro.gesture.templates().length) for (const st of app.streams) startStreamGesture(st);
}

export function enrollGesture(name, clip) {
    if (!app.kwsReady) return;
    withMutableGesture(() => {
        bro.gesture.enrollFromAudio(name, clip, policyStore[name] || {});
        clipStore[name] = clip;
        const summary = gestureSummary(bro.gesture.inspect(name));
        status('enrolled gesture "' + name + '" (' + summary + ')');
        fusionRow(app.active, 'info', 'enrolled gesture "' + name + '" — ' + summary +
            ' (' + (clip.length / bro.gesture.sampleRate()).toFixed(1) + ' s clip)');
    });
}

/** Enroll a clip cut from the timeline and open it in the editor. */
export function enrollGestureFromTimeline(name, clip) {
    openEditor = name;
    enrollGesture(name, clip);
}

// ── ● Record: raw (no-AGC) mic PCM at the spotter rate ──────────────────────

let recorder = null, recordTarget = null, recBtn = null;

function startRecord(target, button) {
    if (!app.kwsReady) return;
    if (recorder && recorder.recording) { stopRecord(); return; }
    recorder = micRecorder({ rate: bro.kws.sampleRate(), chunkFrames: 160, agc: false });
    try { recorder.start(); }
    catch (e) { status('mic: ' + (e.message || e), true); return; }
    recordTarget = target || null;
    recBtn = button || D.record;
    recBtn.textContent = '■ Stop';
    recBtn.classList.add('rec');
    status(recordTarget
        ? 'recording — re-perform "' + recordTarget + '", then Stop'
        : 'recording — perform the gesture (clicks, taps, a whistle), then Stop');
}

function stopRecord() {
    const clip = recorder.stop();
    const target = recordTarget, button = recBtn;
    recordTarget = null; recBtn = null;
    if (button) {
        button.textContent = button === D.record ? '● Record' : '● Re-record';
        button.classList.remove('rec');
    }
    if (!clip || clip.length < bro.kws.sampleRate() / 10) { status('recording too short, discarded', true); return; }
    if (target) {
        reEnroll(target, clip, policyStore[target]);
    } else {
        enrollGesture(D.phrase.value.trim() || ('gesture-' + (++app.gestureN)), clip);
        D.phrase.value = '';
    }
}

export function toggleRecord() { startRecord(null, D.record); }
