// ── Tier 1 emotion: learned voice-quality (timbre) directions in style space ──
// The companion to emotion.js (Tier 0). Where Tier 0 transforms the predicted
// pitch/energy/rate contours (prosody), Tier 1 nudges the VOICE itself along
// emotion directions learned in Kokoro's 256-D style space — the part of affect
// that lives in the decoder's timbre, which prosody can't reach (you can hear a
// smile on "happy"). Directions come from emotion_basis.json (beside the model,
// built by bro/tests/_emotion_basis.js from CREMA-D embeddings):
//
//   style += Σ alphaₑ · resid[e]      (resid = the neutral→e style shift with the
//                                       prosody axes projected out — timbre only)
//
// Applied in rebuildVoice(), so a change re-runs the FULL pass (the predictor
// must see the emotional voice too) — unlike Tier 0's back-half-only re-decode.
// Tier 0 (if dialed) still rides on top, on the fresh prediction.

// add the current timbre offset to a style vector, in place
function addTimbre(style) {
  if (!emotionBasis || !emotionBasis.resid) return;
  for (const e of emotionBasis.emotions) {
    const a = emoTimbre[e] || 0; if (!a) continue;
    const r = emotionBasis.resid[e]; if (!r) continue;
    for (let d = 0; d < style.length; d++) style[d] += a * r[d];
  }
}
function timbreActive() {
  if (!emotionBasis) return false;
  for (const e of emotionBasis.emotions) if (emoTimbre[e]) return true;
  return false;
}

// Coalesce a fast slider drag into a single full re-synth once it settles.
function scheduleTimbre() {
  if (timbreTimer) clearTimeout(timbreTimer);
  timbreTimer = setTimeout(() => { timbreTimer = 0; run(); }, 140);
}

// One-click preset: set this emotion to its calibrated default amount (≈0.7σ of
// timbre), zero the others — "just give me angry", then fine-tune with sliders.
function setTimbrePreset(e) {
  if (!emotionBasis) return;
  for (const k of emotionBasis.emotions) {
    emoTimbre[k] = (k === e) ? (emotionBasis.defaultAlpha[e] || 2) : 0;
    const c = timbreCells[k];
    if (c) { c._range.value = String(emoTimbre[k]); c._val.textContent = emoTimbre[k].toFixed(2); }
  }
  scheduleTimbre();
}

function buildTimbre() {
  const sec = $('#timbre'); if (!sec) return;
  const root = sec.querySelector('.emo-axes'); if (!root) return;
  root.textContent = ''; timbreCells = {};
  if (!emotionBasis) { sec.style.display = 'none'; return; }   // graceful: no artifact → no panel
  sec.style.display = '';
  for (const e of emotionBasis.emotions) {
    const label = (emotionBasis.label && emotionBasis.label[e]) || e;
    const cell = el('div', 'emo-axis');
    const head = el('div', 'emo-head');
    const nm = el('span', 'emo-name preset', label);
    nm.title = 'click for a default amount';
    nm.addEventListener('click', () => setTimbrePreset(e));
    head.appendChild(nm);
    head.appendChild(el('span', 'emo-hint', 'σ ' + (emotionBasis.sigmaResid[e] || 0).toFixed(2)));
    const val = el('span', 'emo-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input');
    r.type = 'range'; r.min = '0'; r.max = String(emotionBasis.alphaMax || 5); r.step = '0.05'; r.value = '0';
    r.addEventListener('input', () => { emoTimbre[e] = +r.value; val.textContent = emoTimbre[e].toFixed(2); scheduleTimbre(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    timbreCells[e] = cell;
    root.appendChild(cell);
  }
}

// Drop all timbre emotion, back to the designed voice.
function resetTimbre() {
  if (emotionBasis) for (const e of emotionBasis.emotions) emoTimbre[e] = 0;
  for (const e in timbreCells) { timbreCells[e]._range.value = '0'; timbreCells[e]._val.textContent = '0.00'; }
  if (timbreTimer) { clearTimeout(timbreTimer); timbreTimer = 0; }
  run();
}
