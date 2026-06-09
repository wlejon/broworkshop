// ═══ MASCULINE↔FEMININE — a bipolar vocal-quality axis in x-vector space (Base) ═══
// An ACOUSTIC masc/fem direction (it moves pitch + formant/timbre), the voice-design
// companion to the emotion panel. Built by bro/tests/_masc_fem_basis.js into
// masc_fem_basis.json beside the Base checkpoint, derived from CAMEO's gender labels
// — that's provenance only; the slider controls the SOUND, not an identity. The two
// poles are antisymmetric (full[M] = −full[F]), so it's ONE signed slider: +alpha
// masculine, −alpha feminine, 0 neutral:
//
//   xvector += alpha · full[M]
//
// Base-only (CustomVoice/VoiceDesign have no x-vector seam). Like emotion, a change
// updates state + meta but does NOT auto-render (Qwen's AR synth is costly). The
// panel hides gracefully when no basis sits beside the checkpoint.

let mascFemBasis = null;     // parsed masc_fem_basis.json, or null (panel hides)
let mfAlpha = 0;             // signed intensity along full[M]: + masculine, − feminine
let mfSlider = null, mfVal = null;

// Load the basis sitting beside the Base checkpoint (graceful if absent). For a
// CustomVoice checkpoint readBasisJson resolves it from the sibling 0.6B-Base.
function loadMascFemBasis(modelDir) {
  mascFemBasis = null; mfAlpha = 0;
  const b = readBasisJson(modelDir, 'masc_fem_basis.json');
  if (b && b.full && b.full.M) mascFemBasis = b;
}

// designedXvec + alpha·full[M] — a fresh array (the blend stays untouched).
function applyMascFem(x) {
  if (!x || !mascFemBasis || !mfAlpha) return x;
  const out = Float32Array.from(x);
  const f = mascFemBasis.full.M;
  const n = Math.min(out.length, f.length);
  for (let d = 0; d < n; d++) out[d] += mfAlpha * f[d];
  return out;
}
function mascFemActive() { return !!(mascFemBasis && mfAlpha); }

// "· masculine 1.20" / "· feminine 0.80" / '' for the designer meta line.
function mascFemSummary() {
  if (!mascFemActive()) return '';
  const lab = mfAlpha > 0 ? (mascFemBasis.label.M || 'masculine') : (mascFemBasis.label.F || 'feminine');
  return ' · ' + lab + ' ' + Math.abs(mfAlpha).toFixed(2);
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
  updateDesignerMeta();
}

// Build the single bipolar slider into the Base designer (hidden without a basis).
function buildMascFem() {
  const sec = $('#mascfem'); if (!sec) return;
  mfAlpha = 0;
  if (!mascFemBasis) { sec.style.display = 'none'; mfSlider = mfVal = null; return; }
  sec.style.display = 'flex';
  const max = mascFemBasis.alphaMax || 3;
  const femL = sec.querySelector('.mf-fem'), mascL = sec.querySelector('.mf-masc');
  femL.textContent = '← ' + (mascFemBasis.label.F || 'feminine');
  mascL.textContent = (mascFemBasis.label.M || 'masculine') + ' →';
  femL.onclick = () => setMascFemPreset('F');
  mascL.onclick = () => setMascFemPreset('M');
  mfSlider = sec.querySelector('.mf-range');
  mfSlider.min = String(-max); mfSlider.max = String(max); mfSlider.step = '0.05'; mfSlider.value = '0';
  mfSlider.oninput = () => { setMfAlpha(+mfSlider.value); updateDesignerMeta(); };
  mfVal = sec.querySelector('.mf-val');
  setMfAlpha(0);
}

// Back to the neutral designed voice.
function resetMascFem() { setMfAlpha(0); updateDesignerMeta(); }
