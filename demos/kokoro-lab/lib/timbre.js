// ── Tier 1 emotion: learned emotion directions in style space ─────────────────
// The data-driven companion to emotion.js (Tier 0's manual VAD prosody). Nudging
// the voice along an emotion's `full` direction (the neutral→e style shift,
// from CAMEO — multilingual, permissively licensed) feeds Kokoro's own
// duration/F0/energy predictor,
// so the model renders emotional PITCH / ENERGY / PACE *and* timbre in one move —
// the "full affect" coupling, for free, through the model. Directions come from
// emotion_basis.json (beside the model, built by bro/tests/_emotion_basis.js):
//
//   style += Σ alphaₑ · full[e]
//
// (We tried `resid` — the timbre-only residual, prosody projected out — but it
// left the predicted prosody almost unchanged, so it didn't read as the emotion;
// `full` is what carries it. resid stays in the artifact for experiments.)
// Applied in rebuildVoice(), so a change re-runs the FULL pass. Tier 0 rides on
// top if also dialed — leave it neutral to avoid stacking prosody twice.

// add the current emotion offset to a style vector, in place
function addTimbre(style) {
  if (!emotionBasis || !emotionBasis.full) return;
  for (const e of emotionBasis.emotions) {
    const a = emoTimbre[e] || 0; if (!a) continue;
    const r = emotionBasis.full[e]; if (!r) continue;
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

// One-click preset: set this emotion to its calibrated default amount (≈0.55σ of
// the full shift), zero the others — "just give me angry", then fine-tune.
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
    head.appendChild(el('span', 'emo-hint', 'σ ' + ((emotionBasis.sigmaFull && emotionBasis.sigmaFull[e]) || 0).toFixed(2)));
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

// Drop all emotion, back to the designed voice.
function resetTimbre() {
  if (emotionBasis) for (const e of emotionBasis.emotions) emoTimbre[e] = 0;
  for (const e in timbreCells) { timbreCells[e]._range.value = '0'; timbreCells[e]._val.textContent = '0.00'; }
  if (timbreTimer) { clearTimeout(timbreTimer); timbreTimer = 0; }
  run();
}
