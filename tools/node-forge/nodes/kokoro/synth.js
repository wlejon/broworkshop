// The Kokoro card's node-state core, shared by exec() (synchronous) and the
// card's live controls (asynchronous): model + basis loading, the current
// voice, and the "back half" re-decodes that edit prosody without rerunning
// the text encoder.
//
// Node fields (per card, since a graph can hold several Kokoro cards):
//   _kokoro _basis _emotionBasis _mascFemBasis _bridge _spkEnc _paths
//   _voice        the current style voice
//   _lastTrace    the last full trace ({ stages, samples, sampleRate })
//   _predicted    { F0, N, dur } as the model predicted them for this text
//   _curDur       the durations the current audio was decoded with
//   _pinnedEdit   a retained prosody edit ({ durRatio, dF0, dN, baseDur })
//                 re-applied on top of every new voice / text
//
// A decode "plan" is { asrP, totalP, F0, N, dur, L }: everything decodeFrom
// needs plus what mergeBack writes into the trace.

import {
    resolvePaths, configureAssets, styleFromCoords, addDirections, addMascFem,
    resampleByDur, lengthRegulate, EMO_FN, emotionActive, emoTransformContours,
} from "./voice.js";
import { readJSON } from "../common.js";

export const stageOf = (trace, name) => trace.stages.find((s) => s.name === name);

/** Load (or keep) the model and bases for node.params.dataRoot. Throws when unusable. */
export function ensureLoaded(node) {
    const p = node.params;
    const paths = resolvePaths(p.dataRoot);
    if (node._modelSig !== paths.model) {
        configureAssets(paths);
        node._kokoro = bro.tts.loadKokoro(paths.model);
        node._basis = readJSON(paths.model + '/voice_basis.json');
        node._emotionBasis = readJSON(paths.model + '/emotion_basis.json');
        const mf = readJSON(paths.model + '/masc_fem_basis.json');
        node._mascFemBasis = mf && mf.full && mf.full.M ? mf : null;
        node._bridge = null; node._spkEnc = null;
        node._paths = paths;
        node._modelSig = paths.model;
        if (node._basis && (!p.coords || p.coords.length !== node._basis.k)) p.coords = new Array(node._basis.k).fill(0);
    }
    if (!node._kokoro) throw new Error('Kokoro model failed to load from ' + paths.model);
    if (!node._basis) throw new Error('voice_basis.json missing from ' + paths.model);
    return node._kokoro;
}

/** A fresh voice from the coords + learned timbre + masc/fem. */
export function rebuildVoice(node) {
    const p = node.params;
    const style = styleFromCoords(node._basis, p.coords);
    addDirections(style, node._emotionBasis, p.timbre);
    addMascFem(style, node._mascFemBasis, p.mfAlpha);
    node._voice = node._kokoro.createVoice(style, 'designed');
    return node._voice;
}

/** A new full trace landed: remember what the model predicted. */
export function notePrediction(node, trace) {
    node._lastTrace = trace;
    node._predicted = {
        F0: Float32Array.from(stageOf(trace, 'F0_pred').data),
        N: Float32Array.from(stageOf(trace, 'N_pred').data),
        dur: Array.from(stageOf(trace, 'pred_dur').data, (v) => Math.round(v)),
    };
    node._curDur = node._predicted.dur.slice();
}

// --- plans ------------------------------------------------------------------------------

/** Tier-0 emotion over the predicted contours and durations. */
export function emotionPlan(node, trace) {
    const emo = node.params.emo, base = node._predicted.dur, L = base.length;
    const rate = EMO_FN.rateScale(emo.v, emo.a, emo.d);
    const dur = base.map((d) => Math.max(1, Math.round(d / rate)));
    const { asrP, totalP } = lengthRegulate(stageOf(trace, 't_en').data, node._kokoro.hiddenDim, L, dur);
    const t = emoTransformContours(node._predicted.F0, node._predicted.N, emo);
    return { asrP, totalP, F0: resampleByDur(t.F0, base, dur), N: resampleByDur(t.N, base, dur), dur, L };
}

/** The pinned edit re-applied over a fresh prediction; null when it no longer fits. */
export function pinPlan(node, trace) {
    const pin = node._pinnedEdit;
    const pred = Array.from(stageOf(trace, 'pred_dur').data, (v) => Math.round(v)), L = pred.length;
    if (!pin || pin.durRatio.length !== L) return null;
    const dur = pred.map((d, l) => Math.max(1, Math.round(d * pin.durRatio[l])));
    const { asrP, totalP } = lengthRegulate(stageOf(trace, 't_en').data, node._kokoro.hiddenDim, L, dur);
    const F0 = stageOf(trace, 'F0_pred').data, N = stageOf(trace, 'N_pred').data;
    const dF0 = resampleByDur(pin.dF0, pin.baseDur, pred), dN = resampleByDur(pin.dN, pin.baseDur, pred);
    const F0e = new Float32Array(F0.length), Ne = new Float32Array(N.length);
    for (let i = 0; i < F0e.length; i++) F0e[i] = Math.max(0, F0[i] + (dF0[i] || 0));
    for (let i = 0; i < Ne.length; i++) Ne[i] = N[i] + (dN[i] || 0);
    return { asrP, totalP, F0: resampleByDur(F0e, pred, dur), N: resampleByDur(Ne, pred, dur), dur, L };
}

/** New per-phoneme durations, stretching the current contours to fit. */
export function durationPlan(node, trace, dur) {
    const { asrP, totalP } = lengthRegulate(stageOf(trace, 't_en').data, node._kokoro.hiddenDim, dur.length, dur);
    return {
        asrP, totalP, dur, L: dur.length,
        F0: resampleByDur(stageOf(trace, 'F0_pred').data, node._curDur, dur),
        N: resampleByDur(stageOf(trace, 'N_pred').data, node._curDur, dur),
    };
}

/** Hand-painted F0 / energy at the current timing. */
export function contourPlan(node, trace, F0, N) {
    const asr = stageOf(trace, 'asr');
    return { asrP: asr.data, totalP: asr.w, F0, N, dur: node._curDur, L: node._curDur.length };
}

// --- decoding ------------------------------------------------------------------------------

/** Write a back-half decode into `trace` and the node. */
export function mergeBack(node, trace, back, plan) {
    for (const st of back.stages) {
        const i = trace.stages.findIndex((x) => x.name === st.name);
        if (i >= 0) trace.stages[i] = st;
    }
    const set = (name, data, w) => { const s = stageOf(trace, name); if (s) { s.data = data; if (w != null) s.w = w; } };
    set('asr', plan.asrP, plan.totalP);
    set('F0_pred', plan.F0, plan.F0.length);
    set('N_pred', plan.N, plan.N.length);
    set('pred_dur', Float32Array.from(plan.dur), plan.L);
    trace.samples = back.samples;
    trace.sampleRate = back.sampleRate;
    trace.durations = plan.dur.slice();
    node._curDur = plan.dur.slice();
}

/** Blocking back-half decode of `plan` into `trace`. */
export function decodeSync(node, trace, plan) {
    const back = node._kokoro.decodeFrom(node._voice, plan.asrP, plan.F0, plan.N, stageOf(trace, 'phonemes').w, { trace: true });
    mergeBack(node, trace, back, plan);
    return trace;
}

/**
 * Background back-half decode of `plan` into node._lastTrace; onDone(trace)
 * after the merge (not called on error / cancel). Sets node._synthBusy.
 */
export function decodeAsync(node, plan, onDone, onError) {
    const trace = node._lastTrace;
    node._synthBusy = true;
    bro.tts.decodeFrom(node._kokoro, node._voice, plan.asrP, plan.F0, plan.N, stageOf(trace, 'phonemes').w, {
        trace: true,
        onDone: (r, info) => {
            node._synthBusy = false;
            if (info.error) { if (onError) onError(info.error); return; }
            if (info.cancelled) return;
            mergeBack(node, trace, r, plan);
            onDone(trace);
        },
    });
}

/**
 * The synchronous path (exec): a full forward pass, then a retained pin or
 * the Tier-0 emotion re-applied on top, like the live path does it.
 */
export function synthSyncFull(node) {
    const ids = bro.tts.phonemize(node.params.text);
    if (!ids || !ids.length) throw new Error('no phonemes for that text');
    const trace = node._kokoro.synthesizeTraced(ids, node._voice, { trace: true });
    notePrediction(node, trace);
    const pin = pinPlan(node, trace);
    if (pin) decodeSync(node, trace, pin);
    else if (emotionActive(node.params.emo)) decodeSync(node, trace, emotionPlan(node, trace));
    return trace;
}

/** Remember the current prosody (relative to the prediction) so it rides across voice changes. */
export function capturePin(node) {
    const t = node._lastTrace, pred = node._predicted, cur = node._curDur;
    if (!t || !pred || !cur || cur.length !== pred.dur.length) { node._pinnedEdit = null; return; }
    const base = pred.dur, L = base.length;
    const durRatio = new Float64Array(L);
    for (let l = 0; l < L; l++) durRatio[l] = cur[l] / (base[l] || 1);
    const f0 = resampleByDur(stageOf(t, 'F0_pred').data, cur, base), n = resampleByDur(stageOf(t, 'N_pred').data, cur, base);
    const dF0 = new Float32Array(pred.F0.length), dN = new Float32Array(pred.N.length);
    for (let i = 0; i < dF0.length; i++) dF0[i] = f0[i] - pred.F0[i];
    for (let i = 0; i < dN.length; i++) dN[i] = n[i] - pred.N[i];
    node._pinnedEdit = { durRatio, dF0, dN, baseDur: base.slice() };
}
