function snapshotPredicted(r) {
  const f = r.stages.find((s) => s.name === 'F0_pred');
  const n = r.stages.find((s) => s.name === 'N_pred');
  const d = r.stages.find((s) => s.name === 'pred_dur');
  const dur = d ? Array.from(d.data, (v) => Math.round(v)) : null;
  predicted = {
    F0: f ? Float32Array.from(f.data) : null,
    N:  n ? Float32Array.from(n.data) : null,
    dur: dur ? dur.slice() : null,
  };
  curDur = dur ? dur.slice() : null;     // F0/N start aligned to the prediction
  edited = false;
}

// Shared tail: a decodeFrom result `r` carries the re-decoded back-half stages
// (gen_in/har/audio). Swap them into the trace, play the new audio, and redraw
// the whole pipeline so the edit propagates visually.
function applyBackHalf(r, label) {
  for (const st of r.stages) { const i = lastTrace.stages.findIndex((x) => x.name === st.name); if (i >= 0) lastTrace.stages[i] = st; }
  setClip(r.samples, r.sampleRate);
  setTimeout(play, 30);
  edited = true;
  const sc = $('#stages').scrollTop;
  renderStages(lastTrace.stages);
  $('#stages').scrollTop = sc;
  $('#run-meta').textContent = label + ' · ' +
    (r.samples.length / r.sampleRate).toFixed(2) + 's · ↺ reset to restore';
  capturePinnedEdit();    // remember this edit as a delta, to ride onto the next voice
}

// Re-run only the decoder back half from the (possibly edited) asr/F0/N grids
// the trace already holds — synchronous, so guard against a background synth.
function commitEdit() {
  if (synthBusy || !kokoro || !voice || !lastTrace) return;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const asr = get('asr'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
  if (!asr || !F0 || !N || !ph) { setBadge('edit: trace is missing stages', true); return; }
  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asr.data, F0.data, N.data, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;
  applyBackHalf(r, 'pitch/energy edited');
}

// Resample a frame-rate contour from one per-phoneme duration set to another,
// preserving each phoneme's contour SHAPE while restretching its time span.
// src is at 2× frame rate (2*sum(srcDur)); returns 2*sum(dstDur).
function resampleByDur(src, srcDur, dstDur) {
  const L = srcDur.length;
  let sumD = 0; for (let l = 0; l < L; l++) sumD += dstDur[l];
  const dst = new Float32Array(2 * sumD);
  let sOff = 0, dOff = 0;
  for (let l = 0; l < L; l++) {
    const sLen = 2 * srcDur[l], dLen = 2 * dstDur[l];
    const sStart = 2 * sOff, dStart = 2 * dOff;
    for (let k = 0; k < dLen; k++) {
      if (sLen === 0) { dst[dStart + k] = 0; continue; }    // no source samples
      const sp = dLen <= 1 ? 0 : (k / (dLen - 1)) * (sLen - 1);
      const i0 = Math.floor(sp), i1 = Math.min(sLen - 1, i0 + 1), f = sp - i0;
      dst[dStart + k] = src[sStart + i0] * (1 - f) + src[sStart + i1] * f;
    }
    sOff += srcDur[l]; dOff += dstDur[l];
  }
  return dst;
}

// Re-time: the per-phoneme frame counts changed. Rebuild asr by re-expanding the
// text-encoder features (length regulate), resample the F0/N contours from the
// old timing to the new, and re-decode. No predictor re-run.
function commitDuration(newDur) {
  if (synthBusy || !kokoro || !voice || !lastTrace || !curDur) return;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes');
  if (!ten || !F0 || !N || !ph) { setBadge('re-time: trace is missing stages', true); return; }
  const H = kokoro.hiddenDim, L = newDur.length;
  const totalP = newDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return;

  // length-regulate t_en (channel-major data[c*L + l]) into asr[c*totalP + t]
  const td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = newDur[l] | 0;
    for (let r = 0; r < reps; r++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }
  const F0p = resampleByDur(F0.data, curDur, newDur);
  const Np  = resampleByDur(N.data,  curDur, newDur);

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0p, Np, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;

  // commit the new front-stage grids so the next edit composes correctly
  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0p, F0p.length);
  set('N_pred', Np, Np.length);
  set('pred_dur', Float32Array.from(newDur), L);
  curDur = newDur.slice();
  lastTrace.durations = newDur.slice();    // selectPhoneme reads this
  applyBackHalf(r, 'timing edited');
}

// ── retained prosody ─────────────────────────────────────────────────────────
// A prosody edit is the *difference* from the model's own prediction, not an
// absolute contour — so it can ride along onto a different voice. We store it as
//   · durRatio[l]  — per-phoneme timing multiplier (phoneme count L is fixed by
//                    the text, so this maps cleanly across voices)
//   · dF0 / dN     — additive contour deltas, anchored back onto the prediction's
//                    timing (baseDur) so resampleByDur can restretch them later
// Captured after every commit (manual or re-applied), so the pin always reflects
// the current on-screen prosody relative to the current voice's prediction.
function capturePinnedEdit() {
  const F0 = lastTrace && lastTrace.stages.find((s) => s.name === 'F0_pred');
  const N  = lastTrace && lastTrace.stages.find((s) => s.name === 'N_pred');
  if (!predicted || !predicted.F0 || !predicted.N || !predicted.dur || !curDur || !F0 || !N) {
    pinnedEdit = null; updatePinUI(); return;
  }
  const base = predicted.dur, L = base.length;
  const durRatio = new Float64Array(L);
  for (let l = 0; l < L; l++) durRatio[l] = curDur[l] / (base[l] || 1);
  // map the current contours back onto the prediction's timing, then subtract
  const f0AtPred = resampleByDur(F0.data, curDur, base);
  const nAtPred  = resampleByDur(N.data,  curDur, base);
  const dF0 = new Float32Array(predicted.F0.length);
  for (let i = 0; i < dF0.length; i++) dF0[i] = f0AtPred[i] - predicted.F0[i];
  const dN = new Float32Array(predicted.N.length);
  for (let i = 0; i < dN.length; i++) dN[i] = nAtPred[i] - predicted.N[i];
  pinnedEdit = { durRatio, dF0, dN, baseDur: base.slice() };
  updatePinUI();
}

// Re-apply the retained edit onto the *fresh* prediction the trace just produced:
// scale its durations by durRatio, add the contour deltas (restretched to this
// voice's spans), and re-decode the back half. Returns false (and drops the pin)
// if the text changed so the phoneme count no longer lines up.
function reapplyPinnedEdit() {
  if (!pinnedEdit || synthBusy || !kokoro || !voice || !lastTrace) return false;
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), F0 = get('F0_pred'), N = get('N_pred'), ph = get('phonemes'), pd = get('pred_dur');
  if (!ten || !F0 || !N || !ph || !pd) return false;
  const predDur = Array.from(pd.data, (v) => Math.round(v));   // this voice's predicted timing
  const L = predDur.length;
  if (pinnedEdit.durRatio.length !== L) { pinnedEdit = null; updatePinUI(); return false; }

  const targetDur = new Array(L);
  for (let l = 0; l < L; l++) targetDur[l] = Math.max(1, Math.round(predDur[l] * pinnedEdit.durRatio[l]));
  const totalP = targetDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return false;

  // contours: prediction + delta (delta restretched from baseDur onto predDur),
  // then the whole thing retimed from predDur onto the edited targetDur
  const dF0v = resampleByDur(pinnedEdit.dF0, pinnedEdit.baseDur, predDur);
  const dNv  = resampleByDur(pinnedEdit.dN,  pinnedEdit.baseDur, predDur);
  const f0Ed = new Float32Array(F0.data.length), nEd = new Float32Array(N.data.length);
  for (let i = 0; i < f0Ed.length; i++) f0Ed[i] = Math.max(0, F0.data[i] + (dF0v[i] || 0));
  for (let i = 0; i < nEd.length; i++)  nEd[i]  = N.data[i] + (dNv[i] || 0);
  const F0f = resampleByDur(f0Ed, predDur, targetDur);
  const Nf  = resampleByDur(nEd,  predDur, targetDur);

  // length-regulate t_en (channel-major data[c*L + l]) onto the edited timing
  const H = kokoro.hiddenDim, td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = targetDur[l] | 0;
    for (let r = 0; r < reps; r++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0f, Nf, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('reapply: ' + e.message, true); return false; }
  synthBusy = false;

  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0f, F0f.length);
  set('N_pred', Nf, Nf.length);
  set('pred_dur', Float32Array.from(targetDur), L);
  curDur = targetDur.slice();
  lastTrace.durations = targetDur.slice();
  applyBackHalf(r, 'prosody retained');
  return true;
}

// Drop the retained edit and fall back to the model's own prosody.
function clearProsody() {
  pinnedEdit = null;
  updatePinUI();
  run();
}

function updatePinUI() {
  const p = $('#pin'); if (!p) return;
  p.textContent = '';
  if (!pinnedEdit) { p.style.display = 'none'; return; }
  p.style.display = '';
  p.appendChild(el('span', null, '✎ prosody pinned'));
  const x = el('span', 'pin-clear', '✕ clear');
  x.addEventListener('click', clearProsody);
  p.appendChild(x);
}

// Restore one contour (F0 or N) to the model's prediction, then re-decode.
function resetSignal(name) {
  if (!predicted || !lastTrace) return;
  const st = lastTrace.stages.find((s) => s.name === name);
  const src = name === 'F0_pred' ? predicted.F0 : predicted.N;
  if (st && src && st.data.length === src.length) st.data.set(src);
  commitEdit();
}

// Restore the predicted timing (resamples the current contours back).
function resetDurations() {
  if (!predicted || !predicted.dur) return;
  commitDuration(predicted.dur.slice());
}

