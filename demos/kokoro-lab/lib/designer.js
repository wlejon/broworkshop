// a faint hint of which perceptual attribute this axis pushes, and which way.
// attribute axes are already named (pitch/brightness/…), so their hint just
// shows how cleanly the axis tracks that attribute; character axes show their
// strongest incidental correlate, if any.
function hintFor(k) {
  const h = basis.attrHint[k];
  if (basis.axisKind && basis.axisKind[k] === 'attr')
    return h && h.r ? 'r ' + Math.abs(h.r).toFixed(2) : '';
  if (!h || !h.attr || Math.abs(h.r) < 0.3) return '';
  return (h.r > 0 ? '↑' : '↓') + (ATTR_WORD[h.attr] || h.attr);
}

function buildSliders() {
  const root = $('#sliders'); root.textContent = '';
  sliderCells = [];
  let lastKind = null;
  for (let k = 0; k < basis.k; k++) {
    const kind = basis.axisKind ? basis.axisKind[k] : 'char';
    if (kind !== lastKind) {            // a full-width header before each bank
      root.appendChild(el('div', 'slider-group',
        kind === 'attr' ? 'perceptual — labeled, always audible' : 'character — timbre & identity'));
      lastKind = kind;
    }
    const isAttr = kind === 'attr';
    // emphasize the attribute axes and the first few character axes
    const firstChar = basis.axisKind ? basis.axisKind.indexOf('char') : 6;
    const lead = isAttr || k < firstChar + 4;
    const cell = el('div', 'pc' + (isAttr ? ' attr' : '') + (lead ? ' lead' : ''));
    const head = el('div', 'pc-head');
    head.appendChild(el('span', 'pc-name', basis.axisName ? basis.axisName[k] : ('PC' + (k + 1))));
    head.appendChild(el('span', 'pc-hint', hintFor(k)));
    const val = el('span', 'pc-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);

    const r = document.createElement('input');
    r.type = 'range';
    const [lo, hi] = basis.range[k];
    r.min = (lo * 1.15).toFixed(3); r.max = (hi * 1.15).toFixed(3); r.step = '0.01'; r.value = '0';
    // dragging updates the readout instantly; the see+hear re-render is
    // debounced so it fires once you pause, never mid-drag
    r.addEventListener('input', () => { coords[k] = +r.value; val.textContent = coords[k].toFixed(2); scheduleRender(); });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    sliderCells.push(cell);
    root.appendChild(cell);
  }
}

// push coords[] back onto the slider widgets (after a seed / clone / random)
function syncSliders() {
  for (let k = 0; k < basis.k; k++) {
    sliderCells[k]._range.value = String(coords[k]);
    sliderCells[k]._val.textContent = coords[k].toFixed(2);
  }
}

// coords (σ units) -> 256-D style vector
function styleFromCoords() {
  const { dim, k, mean, comps, std } = basis;
  const s = new Float32Array(dim);
  for (let d = 0; d < dim; d++) s[d] = mean[d];
  for (let i = 0; i < k; i++) {
    const c = coords[i] * std[i]; if (!c) continue;
    const v = comps[i];
    for (let d = 0; d < dim; d++) s[d] += c * v[d];
  }
  return s;
}

// rebuild the Voice object from the current coords. Cheap (a style-table pack),
// no synthesis — so it's safe to call on every change. Returns success.
function rebuildVoice() {
  if (!kokoro || !basis) return false;
  try {
    const style = styleFromCoords();
    if (typeof addTimbre === 'function') addTimbre(style);   // Tier-1 emotion offset (no-op if none dialed)
    voice = kokoro.createVoice(style, 'designed');
    $('#btn-run').disabled = false;
    $('#btn-save').disabled = false;
    return true;
  } catch (e) { setBadge('createVoice: ' + e.message, true); return false; }
}

// Coalesce a fast slider drag into a single render shortly after it settles, so
// dragging stays smooth and the (synchronous) see+hear trace only runs once you
// pause — never on every tick, never mid-drag.
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderTimer = 0; run(); }, 120);
}

// seed the sliders from a named anchor (or the neutral centroid). `render`
// false on initial load (don't speak/draw until the user asks), true on picks.
function seedFrom(name, render) {
  if (!basis) return;
  if (name === '__neutral__') coords.fill(0);
  else {
    const i = basis.names.indexOf(name); if (i < 0) return;
    const a = basis.anchors[i];
    for (let k = 0; k < basis.k; k++) coords[k] = a[k];
  }
  syncSliders();
  $('#voice-meta').textContent = 'seed: ' + (name === '__neutral__' ? 'neutral centroid' : name);
  if (render) run(); else rebuildVoice();
}

// randomize within the realizable range, weighted toward the dominant axes so
// draws stay plausible (tail axes get small kicks, not full-range noise)
function randomVoice() {
  if (!basis) return;
  for (let k = 0; k < basis.k; k++) {
    const g = gauss() * (0.5 + basis.varExplained[k] * 3);
    const [lo, hi] = basis.range[k];
    coords[k] = Math.max(lo, Math.min(hi, g));
  }
  syncSliders();
  $('#source').value = '__neutral__';
  $('#voice-meta').textContent = 'random draw';
  run();
}

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

