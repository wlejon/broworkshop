// ═══ DESIGNER — PCA voice-identity sliders over the Qwen x-vector manifold ════
// Base-only. qwen_voice_basis.json (built by bro/tests/_qwen_voice_basis.js) turns
// the 1024-D ECAPA x-vector space into a handful of σ-unit sliders over ~hundreds
// of real CAMEO speakers — continuous identity sculpting, seeded from named
// anchors or a cloned clip, far finer than blending the 9 CustomVoice presets.
// It IS the designed x-vector: coords → mean + Σ coordₖ·stdₖ·compₖ, which the
// emotion / masc-fem axes then ride on top of (currentVoice composes them). A
// slider / seed change updates coords + designedXvec + meta but does NOT auto-
// render (Qwen's AR synth is costly — press Render).

let voiceBasis = null;       // parsed qwen_voice_basis.json, or null (panel hidden)
let coords = null;           // Float64Array(k) — current σ-unit slider position
let sliderCells = [];

function loadVoiceBasis(modelDir) {
  voiceBasis = null; coords = null;
  const b = readBasisJson(modelDir, 'qwen_voice_basis.json');
  if (b && b.comps && b.mean && b.std && b.k) { voiceBasis = b; coords = new Float64Array(b.k); }
}

// coords (σ units) → designed 1024-D x-vector: mean + Σ coordₖ·stdₖ·compₖ.
function xvecFromCoords() {
  if (!voiceBasis) return null;
  const { dim, k, mean, comps, std } = voiceBasis;
  const x = new Float32Array(dim);
  for (let d = 0; d < dim; d++) x[d] = mean[d];
  for (let i = 0; i < k; i++) {
    const c = coords[i] * std[i]; if (!c) continue;
    const v = comps[i];
    for (let d = 0; d < dim; d++) x[d] += c * v[d];
  }
  return x;
}

// project a raw x-vector onto the basis → σ-unit coords: cₖ = (x−mean)·compₖ/stdₖ.
// (Exact inverse of xvecFromCoords on the basis subspace — the axes are orthonormal.)
function coordsFromXvec(x) {
  if (!voiceBasis) return null;
  const { dim, k, mean, comps, std } = voiceBasis;
  const c = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const v = comps[i]; let s = 0;
    for (let d = 0; d < dim; d++) s += (x[d] - mean[d]) * v[d];
    c[i] = s / (std[i] || 1);
  }
  return c;
}

// recompute designedXvec from the current coords and refresh the meta (no synth).
function rebuildDesigned() {
  designedXvec = xvecFromCoords();
  updateDesignerMeta();
}

// a faint hint: how the axis aligns with the masc↔fem direction, else its variance.
function hintFor(k) {
  const gc = voiceBasis.genderCos && voiceBasis.genderCos[k];
  if (gc && Math.abs(gc) > 0.3) return (gc > 0 ? '↑masc' : '↑fem');
  return 've ' + (((voiceBasis.varExplained[k] || 0) * 100)).toFixed(1) + '%';
}

function buildVoiceSliders() {
  const wrap = $('#voice-sliders-wrap');
  const root = $('#voice-sliders'); if (!root) return;
  root.textContent = ''; sliderCells = [];
  if (!voiceBasis) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = 'flex';
  // seed dropdown: neutral centroid + the named anchor voices.
  const seed = $('#seed-voice');
  if (seed) {
    seed.textContent = '';
    const neu = document.createElement('option'); neu.value = '__mean__'; neu.textContent = 'neutral (centroid)'; seed.appendChild(neu);
    for (const nm of voiceBasis.names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; seed.appendChild(o); }
    seed.value = '__mean__';
    seed.onchange = () => seedVoice(seed.value);
  }
  for (let k = 0; k < voiceBasis.k; k++) {
    const cell = el('div', 'pc' + (k < 8 ? ' lead' : ''));   // emphasize the dominant axes
    const head = el('div', 'pc-head');
    head.appendChild(el('span', 'pc-name', voiceBasis.axisName ? voiceBasis.axisName[k] : ('V' + (k + 1))));
    head.appendChild(el('span', 'pc-hint', hintFor(k)));
    const val = el('span', 'pc-val', '0.00'); head.appendChild(val);
    cell.appendChild(head);
    const r = document.createElement('input'); r.type = 'range';
    const [lo, hi] = voiceBasis.range[k];
    r.min = (lo * 1.15).toFixed(3); r.max = (hi * 1.15).toFixed(3); r.step = '0.01'; r.value = '0';
    r.addEventListener('input', () => { coords[k] = +r.value; val.textContent = coords[k].toFixed(2); rebuildDesigned(); });
    cell.appendChild(r); cell._range = r; cell._val = val;
    sliderCells.push(cell); root.appendChild(cell);
  }
}

// push coords[] back onto the slider widgets (after a seed / clone / random).
function syncSliders() {
  for (let k = 0; k < sliderCells.length; k++) {
    sliderCells[k]._range.value = String(coords[k]);
    sliderCells[k]._val.textContent = coords[k].toFixed(2);
  }
}

// seed coords from a named anchor (or the neutral centroid), refresh + redesign.
function seedVoice(name) {
  if (!voiceBasis) return;
  if (name === '__mean__') coords.fill(0);
  else {
    const i = voiceBasis.names.indexOf(name); if (i < 0) return;
    const a = voiceBasis.anchors[i]; for (let k = 0; k < voiceBasis.k; k++) coords[k] = a[k];
  }
  syncSliders(); rebuildDesigned();
}

// a random in-distribution voice: gaussian coords weighted toward the dominant
// axes (the tail gets small kicks, not full-range noise) so draws stay plausible.
function randomDesigned() {
  if (!voiceBasis) { setBadge('no voice basis — run tests/_qwen_voice_basis.js', true); return; }
  for (let k = 0; k < voiceBasis.k; k++) {
    const g = gauss() * (0.5 + voiceBasis.varExplained[k] * 3);
    const [lo, hi] = voiceBasis.range[k];
    coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, g));
  }
  syncSliders(); rebuildDesigned();
  if ($('#seed-voice')) $('#seed-voice').value = '__mean__';
  setBadge('random voice · press Render');
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
