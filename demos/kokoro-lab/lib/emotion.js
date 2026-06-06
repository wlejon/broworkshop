// ── Tier 0 emotion: parametric prosody from a valence/arousal/dominance point ─
// No model and no training — emotion here is the PROSODY slice only: pitch
// register/range, energy, and speaking rate, as closed-form transforms of the
// predictor's own F0/N/duration output, re-decoded through the same decodeFrom
// boundary the manual editor uses. Voice-quality/timbre emotion (the rest of
// affect) lives in the decoder and is out of scope for Tier 0.
//
// Arousal is the dominant, reliable prosodic axis; valence and dominance leave
// only a weak prosodic trace (their main signature is timbre), so their gains
// are deliberately small — this panel is the prosodic component of affect, not
// the whole of it.
const EMO = {
  v: 0, a: 0, d: 0,                                          // valence / arousal / dominance, [-1, 1]
  pitchSemis:  (v, a, d) => 2.5 * a + 1.0 * v - 1.5 * d,     // register shift, semitones
  rangeScale:  (v, a, d) => clampf(1 + 0.45 * a + 0.20 * v - 0.15 * d, 0.5, 1.8),  // pitch range about the mean
  energyScale: (v, a, d) => clampf(1 + 0.35 * a + 0.20 * d, 0.5, 1.7),             // loudness
  rateScale:   (v, a, d) => clampf(1 + 0.30 * a - 0.12 * d, 0.6, 1.7),             // >1 = faster
  AXES: [
    ['v', 'valence',   'negative ↔ positive'],
    ['a', 'arousal',   'calm ↔ excited'],
    ['d', 'dominance', 'submissive ↔ assertive'],
  ],
};
function clampf(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function emotionActive() { return EMO.v !== 0 || EMO.a !== 0 || EMO.d !== 0; }

// Shift register + expand/contract pitch range in the log (musical) domain,
// anchored on the contour's own voiced geometric mean; unvoiced frames (F0≈0)
// stay unvoiced. Energy scales multiplicatively. Returns fresh arrays the same
// length / timing as the prediction.
function emoTransformContours(F0src, Nsrc) {
  const shift = Math.pow(2, EMO.pitchSemis(EMO.v, EMO.a, EMO.d) / 12);
  const rng = EMO.rangeScale(EMO.v, EMO.a, EMO.d);
  const eScale = EMO.energyScale(EMO.v, EMO.a, EMO.d);
  let sumLog = 0, nv = 0;
  for (let i = 0; i < F0src.length; i++) if (F0src[i] > 1e-3) { sumLog += Math.log(F0src[i]); nv++; }
  const meanLog = nv ? sumLog / nv : 0;
  const F0 = new Float32Array(F0src.length);
  for (let i = 0; i < F0src.length; i++) {
    const f = F0src[i];
    if (f <= 1e-3) { F0[i] = f; continue; }                 // keep unvoiced
    F0[i] = clampf(Math.exp(meanLog + (Math.log(f) - meanLog) * rng) * shift, 0, 1000);
  }
  const N = new Float32Array(Nsrc.length);
  for (let i = 0; i < Nsrc.length; i++) N[i] = Math.max(0, Nsrc[i] * eScale);
  return { F0, N };
}

// Re-derive the whole prosody surface from the model's CLEAN prediction for the
// current VAD point and re-decode in one pass. Always anchored on `predicted`,
// so dragging a slider never compounds. Routed through applyBackHalf, so the
// result is pinned and rides onto other voices like any manual edit.
function applyEmotion() {
  if (synthBusy || !kokoro || !voice || !lastTrace || !predicted ||
      !predicted.F0 || !predicted.N || !predicted.dur) return;
  if (!emotionActive()) { clearProsody(); return; }         // neutral → model's own prosody
  const get = (nm) => lastTrace.stages.find((s) => s.name === nm);
  const ten = get('t_en'), ph = get('phonemes');
  if (!ten || !ph) { setBadge('emotion: trace is missing stages', true); return; }

  const baseDur = predicted.dur, L = baseDur.length;
  const rate = EMO.rateScale(EMO.v, EMO.a, EMO.d);
  const newDur = new Array(L);
  for (let l = 0; l < L; l++) newDur[l] = Math.max(1, Math.round(baseDur[l] / rate));
  const totalP = newDur.reduce((a, b) => a + b, 0);
  if (totalP < 1) return;

  // length-regulate t_en (channel-major data[c*L + l]) into asr[c*totalP + t]
  const H = kokoro.hiddenDim, td = ten.data, asrP = new Float32Array(H * totalP);
  let t = 0;
  for (let l = 0; l < L; l++) {
    const reps = newDur[l] | 0;
    for (let rr = 0; rr < reps; rr++) { for (let c = 0; c < H; c++) asrP[c * totalP + t] = td[c * L + l]; t++; }
  }
  // transform in the prediction's timing, then restretch to the new timing
  const { F0: F0t, N: Nt } = emoTransformContours(predicted.F0, predicted.N);
  const F0p = resampleByDur(F0t, baseDur, newDur);
  const Np  = resampleByDur(Nt,  baseDur, newDur);

  let r;
  synthBusy = true;
  try { r = kokoro.decodeFrom(voice, asrP, F0p, Np, ph.w, { trace: true }); }
  catch (e) { synthBusy = false; setBadge('decodeFrom: ' + e.message, true); return; }
  synthBusy = false;

  const set = (nm, data, w) => { const s = get(nm); if (s) { s.data = data; if (w != null) s.w = w; } };
  set('asr', asrP, totalP);
  set('F0_pred', F0p, F0p.length);
  set('N_pred', Np, Np.length);
  set('pred_dur', Float32Array.from(newDur), L);
  curDur = newDur.slice();
  lastTrace.durations = newDur.slice();
  applyBackHalf(r, 'emotion v' + EMO.v.toFixed(2) + ' a' + EMO.a.toFixed(2) + ' d' + EMO.d.toFixed(2));
}

// Coalesce a VAD slider drag into a single re-decode once it settles.
function scheduleEmotion() {
  if (emoTimer) clearTimeout(emoTimer);
  emoTimer = setTimeout(() => { emoTimer = 0; applyEmotion(); }, 140);
}

function buildEmotion() {
  const root = $('#emotion .emo-axes'); if (!root) return;
  root.textContent = ''; emoCells = {};
  for (const [key, name, hint] of EMO.AXES) {
    const cell = el('div', 'emo-axis');
    const head = el('div', 'emo-head');
    head.appendChild(el('span', 'emo-name', name));
    head.appendChild(el('span', 'emo-hint', hint));
    const val = el('span', 'emo-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input');
    r.type = 'range'; r.min = '-1'; r.max = '1'; r.step = '0.01'; r.value = '0';
    r.addEventListener('input', () => { EMO[key] = +r.value; val.textContent = EMO[key].toFixed(2); scheduleEmotion(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    emoCells[key] = cell;
    root.appendChild(cell);
  }
}

// Back to neutral: zero the axes and drop the pinned emotion (the prediction).
function resetEmotion() {
  EMO.v = EMO.a = EMO.d = 0;
  for (const k of ['v', 'a', 'd']) {
    if (emoCells[k]) { emoCells[k]._range.value = '0'; emoCells[k]._val.textContent = '0.00'; }
  }
  if (emoTimer) { clearTimeout(emoTimer); emoTimer = 0; }
  clearProsody();
}

