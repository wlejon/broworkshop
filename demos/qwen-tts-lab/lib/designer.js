// ═══ DESIGNER — voice-identity MAP + sliders over the Qwen x-vector manifold ══
// Shared by Base and CustomVoice. qwen_voice_basis.json (bro/tests/_qwen_voice_basis.js)
// turns the 1024-D ECAPA x-vector space into:
//   · a 2-D VOICE MAP — every CAMEO speaker plotted by its two dominant identity
//     axes (V1 ≈ masc↔fem on x, V2 on y). Drag the handle to move through voice
//     space; click a speaker dot to snap to that real, complete voice.
//   · σ-unit fine-tune sliders (all axes) — collapsed by default, for power users.
// coords (σ units) → designedXvec = mean + Σ coordₖ·stdₖ·compₖ. On Base that x-vector
// IS the voice; on CustomVoice it can REPLACE the preset slot (speakerVector). The
// emotion / masc-fem axes ride on top via currentVoice. A change updates state +
// meta but does NOT auto-render (Qwen's AR synth is costly — press Render).

let voiceBasis = null;       // parsed qwen_voice_basis.json, or null (panel hidden)
let coords = null;           // Float64Array(k) — current σ-unit position
let sliderCells = [];
let mapCanvas = null, mapCtx = null, mapDragging = false, mapWired = false;
const MAP_PAD = 16, SNAP_PX = 11;

function loadVoiceBasis(modelDir) {
  voiceBasis = null; coords = null;
  const b = readBasisJson(modelDir, 'qwen_voice_basis.json');
  if (b && b.comps && b.mean && b.std && b.k && b.points) { voiceBasis = b; coords = new Float64Array(b.k); }
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

// project a raw x-vector onto the basis → σ-unit coords (exact on the subspace —
// the axes are orthonormal): cₖ = (x−mean)·compₖ/stdₖ.
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

// recompute designedXvec from coords, redraw the map handle, refresh meta (no synth).
function rebuildDesigned() {
  designedXvec = xvecFromCoords();
  drawMap();
  if (variant === 'customvoice' && typeof markDesigned === 'function') markDesigned();
  updateDesignerMeta();
}

// ── the 2-D voice map ────────────────────────────────────────────────────────
// Map axis a∈{0,1} domain (σ, padded for headroom) → canvas pixels and back.
function mapDomain(a) { const [lo, hi] = voiceBasis.range[a]; const pad = 0.18 * (hi - lo || 1); return [lo - pad, hi + pad]; }
function mapToPx(c0, c1) {
  const W = mapCanvas.width, H = mapCanvas.height;
  const [x0, x1] = mapDomain(0), [y0, y1] = mapDomain(1);
  return [MAP_PAD + (c0 - x0) / (x1 - x0 || 1) * (W - 2 * MAP_PAD),
          H - MAP_PAD - (c1 - y0) / (y1 - y0 || 1) * (H - 2 * MAP_PAD)];
}
function pxToMap(px, py) {
  const W = mapCanvas.width, H = mapCanvas.height;
  const [x0, x1] = mapDomain(0), [y0, y1] = mapDomain(1);
  return [x0 + (px - MAP_PAD) / (W - 2 * MAP_PAD || 1) * (x1 - x0),
          y0 + (H - MAP_PAD - py) / (H - 2 * MAP_PAD || 1) * (y1 - y0)];
}
const GCOLOR = ['#ff7eb6', '#5ad1ff', '#ffd166'];   // F · M · C

function drawMap() {
  if (!mapCtx || !voiceBasis) return;
  const W = mapCanvas.width, H = mapCanvas.height, ctx = mapCtx;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H);
  // zero cross
  const [zx] = mapToPx(0, 0), zy = mapToPx(0, 0)[1];
  ctx.strokeStyle = '#1b2230'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(zx, 0); ctx.lineTo(zx, H); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
  // speaker dots
  for (const p of voiceBasis.points) {
    const [px, py] = mapToPx(p[1], p[2]);
    ctx.fillStyle = GCOLOR[p[0]] || '#9aa';
    ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // axis labels
  ctx.fillStyle = '#5b6678'; ctx.font = '10px sans-serif';
  ctx.fillText('← feminine', 6, H - 5); ctx.textAlign = 'right'; ctx.fillText('masculine →', W - 6, H - 5); ctx.textAlign = 'left';
  ctx.save(); ctx.translate(11, 14); ctx.fillText('timbre ↑', 0, 0); ctx.restore();
  // the designed-voice handle
  const [hx, hy] = mapToPx(coords[0], coords[1]);
  ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, hy, 8.5, 0, 6.2832); ctx.stroke();
}

// nearest speaker dot to a canvas point, within SNAP_PX (or -1).
function nearestPoint(px, py) {
  let bi = -1, bd = SNAP_PX * SNAP_PX;
  for (let i = 0; i < voiceBasis.points.length; i++) {
    const p = voiceBasis.points[i], [dx, dy] = mapToPx(p[1], p[2]);
    const d = (dx - px) * (dx - px) + (dy - py) * (dy - py);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

// snap ALL coords to a real speaker (its complete identity), or free-move the two
// map axes from a clicked position (other coords kept).
function snapToPoint(i) {
  const p = voiceBasis.points[i];
  for (let k = 0; k < voiceBasis.k; k++) coords[k] = p[k + 1];
  syncSliders(); rebuildDesigned();
}
function moveMapTo(c0, c1) { coords[0] = c0; coords[1] = c1; syncSliders(); rebuildDesigned(); }

function mapEventPx(ev) {
  const r = mapCanvas.getBoundingClientRect();
  return [(ev.clientX - r.left) * (mapCanvas.width / (r.width || mapCanvas.width)),
          (ev.clientY - r.top) * (mapCanvas.height / (r.height || mapCanvas.height))];
}

// ── build the designer (map + seed + sliders) ────────────────────────────────
function buildDesigner() {
  fillLanguages($('#language3'));
  const wrap = $('#designer-body');
  if (!voiceBasis) { if (wrap) wrap.style.display = 'none'; designedXvec = null; return; }
  if (wrap) wrap.style.display = 'flex';

  mapCanvas = $('#voice-map'); mapCtx = mapCanvas ? mapCanvas.getContext('2d') : null;
  if (mapCanvas && !mapWired) {
    mapWired = true;
    mapCanvas.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const [px, py] = mapEventPx(ev);
      const i = nearestPoint(px, py);
      if (i >= 0) { snapToPoint(i); mapDragging = false; }
      else { mapDragging = true; const [c0, c1] = pxToMap(px, py); moveMapTo(c0, c1); }
    });
    document.addEventListener('mousemove', (ev) => {
      if (!mapDragging) return;
      const [px, py] = mapEventPx(ev); const [c0, c1] = pxToMap(px, py); moveMapTo(c0, c1);
    });
    document.addEventListener('mouseup', () => { mapDragging = false; });
  }

  // seed dropdown: neutral centroid + named anchor voices.
  const seed = $('#seed-voice');
  if (seed) {
    seed.textContent = '';
    const neu = document.createElement('option'); neu.value = '__mean__'; neu.textContent = 'neutral (centroid)'; seed.appendChild(neu);
    for (const nm of voiceBasis.names) { const o = document.createElement('option'); o.value = nm; o.textContent = nm; seed.appendChild(o); }
    seed.value = '__mean__'; seed.onchange = () => seedVoice(seed.value);
  }
  buildSliders();
  seedVoice('__mean__');     // a neutral designed voice, ready to render
  // the initial seed is setup, not a user pick — keep CustomVoice on its preset
  // until the user actually touches the map / sliders.
  if (variant === 'customvoice') { cvSource = 'preset'; if (typeof updateCvSource === 'function') updateCvSource(); }
}

function buildSliders() {
  const root = $('#voice-sliders'); if (!root) return;
  root.textContent = ''; sliderCells = [];
  for (let k = 0; k < voiceBasis.k; k++) {
    const cell = el('div', 'pc' + (k < 8 ? ' lead' : ''));
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
function hintFor(k) {
  const gc = voiceBasis.genderCos && voiceBasis.genderCos[k];
  if (gc && Math.abs(gc) > 0.3) return (gc > 0 ? '↑masc' : '↑fem');
  return 've ' + (((voiceBasis.varExplained[k] || 0) * 100)).toFixed(1) + '%';
}

function syncSliders() {
  for (let k = 0; k < sliderCells.length; k++) {
    sliderCells[k]._range.value = String(coords[k]);
    sliderCells[k]._val.textContent = coords[k].toFixed(2);
  }
}

// seed coords from a named anchor (or the neutral centroid).
function seedVoice(name) {
  if (!voiceBasis) return;
  if (name === '__mean__') coords.fill(0);
  else {
    const i = voiceBasis.names.indexOf(name); if (i < 0) return;
    const a = voiceBasis.anchors[i]; for (let k = 0; k < voiceBasis.k; k++) coords[k] = a[k];
  }
  syncSliders(); rebuildDesigned();
}

// a random in-distribution voice: gaussian coords weighted toward the dominant axes.
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

// Decode a reference clip → x-vector and project it onto the sliders/map (so it
// can be sculpted from there). Without a basis, fall back to the raw clip x-vector.
function enrollRef() {
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference .wav first', true); return; }
  try {
    audioCtx = audioCtx || new AudioContext();
    const dec = audioCtx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.samples.length) { setBadge('could not decode ' + path, true); return; }
    const xv = qwen.embedSpeaker(toMono(dec.samples, dec.channels), { sampleRate: dec.sampleRate });
    if (voiceBasis) { coords = coordsFromXvec(xv); syncSliders(); rebuildDesigned(); }
    else { designedXvec = xv; updateDesignerMeta(); }
    setBadge('enrolled "' + pName(path).replace(/\.[^.]+$/, '') + '" → ' + (voiceBasis ? 'voice map' : 'x-vector'));
  } catch (e) { setBadge('enroll: ' + e.message, true); }
}
