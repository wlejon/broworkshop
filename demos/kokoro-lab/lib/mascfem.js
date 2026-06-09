// ── Masculine↔feminine: a bipolar vocal-quality axis in style space ───────────
// The voice-design companion to timbre.js (learned emotion). Built the same way
// (CAMEO — multilingual, permissive), but on gender labels via a between-speaker,
// within-corpus contrast: masc/fem is CONSTANT within a speaker, so the per-speaker
// centering that isolates emotion would erase it; instead we contrast male-vs-female
// inside each corpus and pool across languages. An ACOUSTIC axis — it moves pitch +
// formant/timbre through Kokoro's own duration/F0/energy predictor, NOT an identity
// label. Directions come from masc_fem_basis.json (beside the model, built by
// bro/tests/_masc_fem_basis.js):
//
//   style += alpha · full[M]       (full[M] = −full[F] → one signed slider)
//
// Applied in rebuildVoice() after the emotion offset, so a change re-runs the FULL
// pass. The section hides itself when the artifact is absent.

// add the current masc/fem offset to a style vector, in place
function addMascFem(style) {
  if (!mascFemBasis || !mfAlpha) return;
  const f = mascFemBasis.full.M;
  for (let d = 0; d < style.length; d++) style[d] += mfAlpha * f[d];
}
function mascFemActive() { return !!(mascFemBasis && mfAlpha); }

// Coalesce a fast slider drag into a single full re-synth once it settles.
function scheduleMascFem() {
  if (mfTimer) clearTimeout(mfTimer);
  mfTimer = setTimeout(() => { mfTimer = 0; run(); }, 140);
}

// Reflect a signed alpha into the slider + readout (masc / fem / neutral).
function setMfAlpha(a) {
  mfAlpha = a;
  if (mfSlider) mfSlider.value = String(a);
  if (mfVal) mfVal.textContent = a === 0 ? 'neutral' : ((a > 0 ? 'masc ' : 'fem ') + Math.abs(a).toFixed(2));
}

// One-click pole preset: push to that pole's calibrated default amount.
function setMascFemPreset(pole) {
  if (!mascFemBasis) return;
  const d = (mascFemBasis.defaultAlpha && mascFemBasis.defaultAlpha[pole]) || 2;
  setMfAlpha(pole === 'M' ? d : -d);
  scheduleMascFem();
}

// Build the single bipolar slider (hidden without a basis).
function buildMascFem() {
  const sec = $('#mascfem'); if (!sec) return;
  mfAlpha = 0;
  if (!mascFemBasis) { sec.style.display = 'none'; mfSlider = mfVal = null; return; }
  sec.style.display = '';
  const max = mascFemBasis.alphaMax || 3;
  const femL = sec.querySelector('.mf-fem'), mascL = sec.querySelector('.mf-masc');
  femL.textContent = '← ' + (mascFemBasis.label.F || 'feminine');
  mascL.textContent = (mascFemBasis.label.M || 'masculine') + ' →';
  femL.onclick = () => setMascFemPreset('F');
  mascL.onclick = () => setMascFemPreset('M');
  mfSlider = sec.querySelector('.mf-range');
  mfSlider.min = String(-max); mfSlider.max = String(max); mfSlider.step = '0.05'; mfSlider.value = '0';
  mfSlider.oninput = () => { setMfAlpha(+mfSlider.value); scheduleMascFem(); };
  mfVal = sec.querySelector('.mf-val');
  setMfAlpha(0);
}

// Drop the masc/fem shift, back to the designed voice.
function resetMascFem() {
  setMfAlpha(0);
  if (mfTimer) { clearTimeout(mfTimer); mfTimer = 0; }
  run();
}
