// ═══ EMOTION — learned emotion directions in x-vector space (Base only) ═══════
// The Base-variant companion to the designer's anchor blend, and Qwen's analog of
// Kokoro's Tier-1 emotion timbre. Each emotion is a CONTRASTIVE within-speaker
// direction in the ECAPA speaker x-vector space (from CAMEO — multilingual,
// permissively licensed), built by bro/tests/_qwen_emotion_basis.js into
// emotion_basis.json beside the Base checkpoint. Dialing emotion e nudges the
// designed x-vector along full[e] before synthesize_with_xvector:
//
//   xvector += Σ alphaₑ · full[e]
//
// x-vector-only: CustomVoice/VoiceDesign have no x-vector seam, so this panel only
// shows in Base. ECAPA embeddings are speaker-verification features (emotion is
// partly factored out), so this is an honest experiment — press Render to hear
// whether a direction reads; the panel hides gracefully when no basis is present.
// Like the anchor sliders, a change updates state + meta but does NOT auto-render
// (Qwen's AR synth is too costly to re-run on every tick).

let emotionBasis = null;     // parsed emotion_basis.json, or null (panel hides)
const emoAlpha = {};         // per-emotion intensity (alpha)
let emoCells = {};           // emotion -> slider cell, for preset writes

// Load the basis sitting beside the Base checkpoint (graceful if absent).
function loadEmotionBasis(modelDir) {
  emotionBasis = null;
  for (const k in emoAlpha) delete emoAlpha[k];
  try {
    const b = JSON.parse(_fs.readFileSync(modelDir + '/emotion_basis.json', 'utf-8'));
    if (b && b.full && b.emotions && b.emotions.length) emotionBasis = b;
  } catch (e) {}
}

// designedXvec + Σ alphaₑ·full[e] — a fresh array (the blend stays untouched).
function applyEmotion(x) {
  if (!x || !emotionBasis || !emotionActive()) return x;
  const out = Float32Array.from(x);
  for (const e of emotionBasis.emotions) {
    const a = emoAlpha[e] || 0; if (!a) continue;
    const f = emotionBasis.full[e]; if (!f) continue;
    const n = Math.min(out.length, f.length);
    for (let d = 0; d < n; d++) out[d] += a * f[d];
  }
  return out;
}
function emotionActive() {
  if (!emotionBasis) return false;
  for (const e of emotionBasis.emotions) if (emoAlpha[e]) return true;
  return false;
}
// A short "· angry 1.20 + sad 0.30" summary of the active emotion mix (or '').
function emotionSummary() {
  if (!emotionActive()) return '';
  const parts = [];
  for (const e of emotionBasis.emotions) {
    const a = emoAlpha[e] || 0; if (!a) continue;
    parts.push(((emotionBasis.label && emotionBasis.label[e]) || e) + ' ' + a.toFixed(2));
  }
  return parts.length ? ' · ' + parts.join(' + ') : '';
}

// One-click: set this emotion to its calibrated default amount, zero the others.
function setEmotionPreset(e) {
  if (!emotionBasis) return;
  for (const k of emotionBasis.emotions) {
    emoAlpha[k] = (k === e) ? (emotionBasis.defaultAlpha[e] || 2) : 0;
    const c = emoCells[k];
    if (c) { c._range.value = String(emoAlpha[k]); c._val.textContent = emoAlpha[k].toFixed(2); }
  }
  updateDesignerMeta();
}

// Build the emotion sliders into the Base designer panel (hidden without a basis).
function buildEmotion() {
  const sec = $('#emotion'); if (!sec) return;
  const root = sec.querySelector('.emo-axes'); if (!root) return;
  root.textContent = ''; emoCells = {};
  for (const k in emoAlpha) delete emoAlpha[k];
  if (!emotionBasis) { sec.style.display = 'none'; return; }
  sec.style.display = 'flex';
  for (const e of emotionBasis.emotions) {
    const label = (emotionBasis.label && emotionBasis.label[e]) || e;
    const cell = el('div', 'emo-axis');
    const head = el('div', 'emo-head');
    const nm = el('span', 'emo-name preset', label);
    nm.title = 'set a default amount of ' + label + ', zero the rest';
    nm.addEventListener('click', () => setEmotionPreset(e));
    head.appendChild(nm);
    head.appendChild(el('span', 'emo-hint', 'σ' + ((emotionBasis.sigmaFull && emotionBasis.sigmaFull[e]) || 0).toFixed(2)));
    const val = el('span', 'emo-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input');
    r.type = 'range'; r.min = '0'; r.max = String(emotionBasis.alphaMax || 5); r.step = '0.05'; r.value = '0';
    r.addEventListener('input', () => { emoAlpha[e] = +r.value; val.textContent = emoAlpha[e].toFixed(2); updateDesignerMeta(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    emoCells[e] = cell;
    root.appendChild(cell);
  }
}

// Drop all emotion, back to the plain designed voice.
function resetEmotion() {
  if (emotionBasis) for (const e of emotionBasis.emotions) emoAlpha[e] = 0;
  for (const e in emoCells) { emoCells[e]._range.value = '0'; emoCells[e]._val.textContent = '0.00'; }
  updateDesignerMeta();
}
