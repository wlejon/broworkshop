// Kokoro Lab — steer a voice through Kokoro's style space, then watch and hear
// the selected voice take shape stage by stage.
//
// "Selected voice" is no longer one of a few named packs — it's a point in
// Kokoro's 256-D style space, steered by sliders aligned to the principal axes
// of the 606 clean swept voices (voicebasis.json, built by tests/_voice_basis.js):
//
//   coords (σ units) ─► style = mean + Σ coordₖ·stdₖ·compₖ ─► kokoro.createVoice
//      ─► synthesizeTraced(ids, voice) ─► { samples, durations, stages[] }
//
// Each stage is a row-major (h×w) Float32Array captured inside the real Kokoro
// forward pass (brosoundml KokoroTrace), rendered in the form that reads best.
// Seeds for the sliders: any of the 28 named anchors, the neutral centroid, a
// random in-distribution draw, or a real clip cloned through the ECAPA→style
// bridge (bridge.f32). Changing the voice re-traces it, so the stage stream and
// the audio always reflect exactly what the sliders define.

const $ = (s) => document.querySelector(s);

let kokoro = null;
let voice = null;
let lastTrace = null;     // { samples, sampleRate, durations, stages }
let audioCtx = null;
let clipId = -1;          // the published audio clip for the current synthesis
let clipSamples = 0;      // sample count of that clip (for phoneme-segment regions)

// ─── stage metadata ────────────────────────────────────────────────────────
// kind  = how to draw it.  desc = plain words.
// flow  = how a single phoneme maps onto this stage, so selecting one phoneme
//         can highlight its territory at every stage (the data-flow view):
//           axis 'x'|'y'|'chip' = which axis carries the unit
//           time 'sym'          = phoneme time (unit = column/row index / L)
//           time 'frame'        = frame time   (unit = its duration span / total)
const STAGE_INFO = {
  phonemes: { kind: 'chips', desc: 'input phoneme ids — symbol time, length L', flow: { axis: 'chip' } },
  bert_dur: { kind: 'heat',  desc: 'plBERT contextual features — L phonemes x 768 dims', flow: { axis: 'y', time: 'sym' } },
  d_en:     { kind: 'heat',  desc: 'predictor conditioning (PROSODY branch) — 512 ch x L', flow: { axis: 'x', time: 'sym' } },
  t_en:     { kind: 'heat',  desc: 'text-encoder content (CONTENT branch) — 512 ch x L', flow: { axis: 'x', time: 'sym' } },
  pred_dur: { kind: 'align', desc: 'predicted frames per phoneme — the alignment (symbol -> time)', flow: { axis: 'x', time: 'frame' } },
  F0_pred:  { kind: 'curve', desc: 'pitch contour (Hz) at frame rate', color: '#ffcf6b', flow: { axis: 'x', time: 'frame' } },
  N_pred:   { kind: 'curve', desc: 'energy contour at frame rate', color: '#7fd1a6', flow: { axis: 'x', time: 'frame' } },
  asr:      { kind: 'heat',  desc: 'duration-aligned content — 512 ch x T frames', flow: { axis: 'x', time: 'frame' } },
  gen_in:   { kind: 'heat',  desc: 'decoder-backbone output — 512 ch x 2T', flow: { axis: 'x', time: 'frame' } },
  har:      { kind: 'heat',  desc: 'harmonic-source excitation — (n_fft+2) x frames', flow: { axis: 'x', time: 'frame' } },
  audio:    { kind: 'wave',  desc: 'output waveform — 24 kHz', flow: { axis: 'x', time: 'frame' } },
};

// flow state: overlays/chips per stage, and the currently traced phoneme.
let flowStages = [];
let selPhoneme = -1;

// ═══ voice-space designer ════════════════════════════════════════════════════
// The slider basis: principal axes of the clean swept voices, std-scaled so a
// slider unit == 1σ of real voice variation. See tests/_voice_basis.js.
let basis = null;          // voicebasis.json
let coords = null;         // Float64Array(K) — current position, in σ units
let bridge = null;         // { D, M, xm, ym, B } — lazy (clone only)
let qwen = null;           // Qwen Base model — lazy (clone only, for embedSpeaker)
let designTimer = 0;       // debounce slider drags before re-synthesizing

const ATTR_WORD = { f0_mean: 'pitch', rms: 'volume', energy: 'energy', rate: 'pace', zcr: 'brightness' };

function loadBasis() {
  try {
    basis = JSON.parse(require('fs').readFileSync('voicebasis.json', 'utf-8'));
    coords = new Float64Array(basis.k);
  } catch (e) {
    setBadge('voicebasis.json missing — run tests/_voice_basis.js', true);
  }
}

// a faint hint of which perceptual attribute this axis pushes, and which way.
function hintFor(k) {
  const h = basis.attrHint[k];
  if (!h || !h.attr || Math.abs(h.r) < 0.3) return '';
  return (h.r > 0 ? '↑' : '↓') + (ATTR_WORD[h.attr] || h.attr);
}

function buildSliders() {
  const root = $('#sliders'); root.textContent = '';
  for (let k = 0; k < basis.k; k++) {
    const cell = el('div', 'pc' + (k < 6 ? ' lead' : ''));
    const head = el('div', 'pc-head');
    head.appendChild(el('span', 'pc-name', 'PC' + (k + 1)));
    head.appendChild(el('span', 'pc-hint', hintFor(k)));
    const val = el('span', 'pc-val', '0.00');
    head.appendChild(val);
    cell.appendChild(head);

    const r = document.createElement('input');
    r.type = 'range';
    const [lo, hi] = basis.range[k];
    r.min = (lo * 1.15).toFixed(3); r.max = (hi * 1.15).toFixed(3); r.step = '0.01'; r.value = '0';
    r.addEventListener('input', () => {
      coords[k] = +r.value; val.textContent = coords[k].toFixed(2); scheduleDesign();
    });
    cell.appendChild(r);
    cell._range = r; cell._val = val;
    root.appendChild(cell);
  }
}

// push coords[] back onto the slider widgets (after a seed / clone / random)
function syncSliders() {
  const cells = $('#sliders').children;
  for (let k = 0; k < basis.k; k++) {
    cells[k]._range.value = String(coords[k]);
    cells[k]._val.textContent = coords[k].toFixed(2);
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

// rebuild the Voice from the current coords and re-trace it (see + hear it)
function applyVoice(meta) {
  if (!kokoro || !basis) return;
  try {
    voice = kokoro.createVoice(styleFromCoords(), 'designed');
    $('#btn-run').disabled = false;
    $('#btn-save').disabled = false;
    if (meta) $('#voice-meta').textContent = meta;
    run();
  } catch (e) { setBadge('createVoice: ' + e.message, true); }
}

// re-synthesize shortly after a slider settles, not on every pixel of a drag
function scheduleDesign() {
  if (designTimer) clearTimeout(designTimer);
  designTimer = setTimeout(() => { designTimer = 0; applyVoice(); }, 140);
}

// seed the sliders from a named anchor (or the neutral centroid)
function seedFrom(name) {
  if (!basis) return;
  if (name === '__neutral__') coords.fill(0);
  else {
    const i = basis.names.indexOf(name); if (i < 0) return;
    const a = basis.anchors[i];
    for (let k = 0; k < basis.k; k++) coords[k] = a[k];
  }
  syncSliders();
  applyVoice('seed: ' + (name === '__neutral__' ? 'neutral centroid' : name));
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
  applyVoice('random draw');
}

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ── clone a real clip into the slider space, via the ECAPA->style bridge ─────
function loadBridge() {
  if (bridge) return true;
  try {
    const ab = require('fs').readFileSync('bridge.f32');
    const buf = ab instanceof ArrayBuffer ? ab : ab.buffer;
    const iv = new Int32Array(buf, 0, 2); const D = iv[0], M = iv[1];
    let off = 8;
    const xm = new Float32Array(buf, off, D); off += 4 * D;
    const ym = new Float32Array(buf, off, M); off += 4 * M;
    const B = new Float32Array(buf, off, D * M);
    bridge = { D, M, xm, ym, B };
    return true;
  } catch (e) { setBadge('bridge.f32 missing — run tests/_voice_basis.js', true); return false; }
}

// x(1024) -> style(256): style = ym + (x - xm)·B   (B row-major D×M)
function bridgeApply(x) {
  const { D, M, xm, ym, B } = bridge;
  const s = new Float64Array(M);
  for (let m = 0; m < M; m++) s[m] = ym[m];
  for (let j = 0; j < D; j++) {
    const xc = x[j] - xm[j]; if (!xc) continue;
    const bj = j * M;
    for (let m = 0; m < M; m++) s[m] += xc * B[bj + m];
  }
  return s;
}

// project a 256-D style onto the slider axes (σ units)
function coordsFromStyle(style) {
  const { dim, k, mean, comps, std } = basis;
  const c = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const v = comps[i]; let s = 0;
    for (let d = 0; d < dim; d++) s += (style[d] - mean[d]) * v[d];
    c[i] = s / (std[i] || 1);
  }
  return c;
}

function clone() {
  if (!basis || !kokoro) return;
  if (!loadBridge()) return;
  const wav = $('#ref-wav').value.trim();
  // the Qwen Base checkpoint sits beside the kokoro dir: …/weights/{kokoro,qwen-tts/…}
  const qdir = $('#model-dir').value.trim().replace(/[\\\/]?kokoro[\\\/]?$/, '') + '/qwen-tts/0.6B-Base';

  const proceed = () => {
    try {
      audioCtx = audioCtx || new AudioContext();
      const dec = audioCtx.decodeAudioFile(wav);
      if (!dec) { setBadge('clone: cannot decode ' + wav, true); return; }
      let mono = dec.samples;
      if (dec.channels === 2) {
        mono = new Float32Array(dec.numFrames);
        for (let i = 0; i < dec.numFrames; i++) mono[i] = 0.5 * (dec.samples[2 * i] + dec.samples[2 * i + 1]);
      }
      const x = qwen.embedSpeaker(mono, { sampleRate: dec.sampleRate });
      coords = coordsFromStyle(bridgeApply(x));
      for (let k = 0; k < basis.k; k++) {        // clamp into the widgets' range
        const [lo, hi] = basis.range[k];
        coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, coords[k]));
      }
      syncSliders();
      $('#source').value = '__neutral__';
      const nm = wav.split(/[\\\/]/).pop();
      setBadge('ready · cloned ' + nm);
      applyVoice('clone: ' + nm);
    } catch (e) { setBadge('clone: ' + e.message, true); }
  };

  if (qwen) { proceed(); return; }
  setBadge('clone: loading speaker encoder…');
  bro.tts.loadQwen(qdir, {
    onReady: (q) => { qwen = q; proceed(); },
    onError: (m) => setBadge('clone: qwen load failed: ' + m, true),
  });
}

// save the current voice as a raw little-endian FP32 pack (loadVoice's format)
function saveVoice() {
  if (!voice) return;
  try {
    const data = voice.data;                 // Float32Array(rows*cols)
    const u8 = new Uint8Array(data.length * 4);
    new Float32Array(u8.buffer).set(data);
    const p = $('#model-dir').value.trim() + '/voices/designed.bin';
    require('fs').writeFileSync(p, u8);
    $('#voice-meta').textContent = 'saved → ' + p;
  } catch (e) { setBadge('save: ' + e.message, true); }
}

// ═══ load ══════════════════════════════════════════════════════════════════
function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

function reload() {
  kokoro = null; voice = null;
  $('#btn-run').disabled = true;
  $('#btn-play').disabled = true;
  $('#btn-save').disabled = true;
  setBadge('loading model…');
  try {
    bro.tts.setAssetRoot($('#asset-root').value.trim());
    bro.tts.loadKokoro($('#model-dir').value.trim(), {
      onReady: (k) => { kokoro = k; setBadge('model ready'); seedFrom($('#source').value); },
      onError: (m) => setBadge('model error: ' + m, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}

// ═══ run ═══════════════════════════════════════════════════════════════════
function run() {
  if (!kokoro || !voice) return;
  const text = $('#text').value;
  let ids;
  try {
    ids = bro.tts.phonemize(text);
  } catch (e) { setBadge('phonemize: ' + e.message, true); return; }
  if (!ids || !ids.length) { setBadge('no phonemes for that text', true); return; }

  const t0 = performance.now();
  let r;
  try {
    r = kokoro.synthesizeTraced(ids, voice);
  } catch (e) { setBadge('synthesize: ' + e.message, true); return; }
  const ms = (performance.now() - t0).toFixed(0);

  lastTrace = r;
  $('#run-meta').textContent =
    ids.length + ' phonemes · ' + r.stages.length + ' stages · ' +
    (r.samples.length / r.sampleRate).toFixed(2) + 's audio · ' + ms + ' ms';
  $('#btn-play').disabled = false;
  renderStages(r.stages);
  ensureClip();              // upload the audio now...
  setTimeout(play, 80);      // ...trigger playback a few frames later (let it land)
}

// ═══ render ════════════════════════════════════════════════════════════════
function renderStages(stages) {
  const root = $('#stages');
  root.textContent = '';
  flowStages = [];
  selPhoneme = -1;
  $('#sel-label').textContent = '';

  for (const s of stages) {
    const info = STAGE_INFO[s.name] || { kind: 'heat', desc: '' };
    const card = el('div', 'stage');
    const head = el('div', 'stage-head');
    head.appendChild(el('span', 'stage-name', s.name));
    head.appendChild(el('span', 'stage-shape', s.h + ' x ' + s.w));
    head.appendChild(el('span', 'stage-desc', info.desc));
    const st = stats(s.data);
    head.appendChild(el('span', 'stage-stats',
      'min ' + st.mn.toFixed(2) + '  max ' + st.mx.toFixed(2) + '  μ ' + st.mean.toFixed(2)));
    card.appendChild(head);

    const body = el('div', 'stage-body');
    card.appendChild(body);
    root.appendChild(card);

    try {
      if (info.kind === 'chips')      renderChips(body, s);
      else if (info.kind === 'align') renderAlign(body, s);
      else if (info.kind === 'curve') renderCurve(body, s, info.color || '#8ad9ff');
      else if (info.kind === 'wave')  renderWave(body, s);
      else                            renderHeat(body, s);
    } catch (e) {
      body.appendChild(el('div', 'axis-note', 'render error: ' + e.message));
    }

    // register this stage for the data-flow highlight
    if (info.flow) {
      if (info.flow.axis === 'chip') {
        const chips = [...body.querySelectorAll('.chip')];
        chips.forEach((c, i) => c.addEventListener('click', () => selectPhoneme(i)));
        flowStages.push({ flow: info.flow, chips });
      } else {
        const cv = body.querySelector('canvas');
        if (cv && cv._overlay) flowStages.push({ flow: info.flow, overlay: cv._overlay });
      }
    }
  }
}

// Trace one phoneme through the whole pipeline: highlight its territory at
// every stage. Symbol-time stages light the phoneme's column/row; frame-time
// stages light its duration span. Click the same phoneme again to clear.
function selectPhoneme(l) {
  selPhoneme = (l === selPhoneme) ? -1 : l;
  const dur = lastTrace ? lastTrace.durations : null;
  const L = dur ? dur.length : 0;
  let total = 0; for (let i = 0; i < L; i++) total += dur[i];

  for (const fs of flowStages) {
    if (fs.flow.axis === 'chip') {
      fs.chips.forEach((c, i) => c.classList.toggle('sel', i === selPhoneme));
      continue;
    }
    const ov = fs.overlay;
    if (selPhoneme < 0 || !dur || !total) { ov.style.display = 'none'; continue; }
    let p0, p1;
    if (fs.flow.time === 'sym') { p0 = selPhoneme / L; p1 = (selPhoneme + 1) / L; }
    else { let s = 0; for (let i = 0; i < selPhoneme; i++) s += dur[i]; p0 = s / total; p1 = (s + dur[selPhoneme]) / total; }
    ov.style.display = 'block';
    if (fs.flow.axis === 'y') {
      ov.style.left = '0'; ov.style.right = '0'; ov.style.width = '';
      ov.style.top = (p0 * 100) + '%'; ov.style.height = ((p1 - p0) * 100) + '%';
    } else {
      ov.style.top = '0'; ov.style.bottom = '0'; ov.style.height = '';
      ov.style.left = (p0 * 100) + '%'; ov.style.width = ((p1 - p0) * 100) + '%';
    }
  }

  const lab = $('#sel-label');
  if (selPhoneme < 0 || !lastTrace) lab.textContent = '';
  else lab.textContent = 'tracing phoneme #' + selPhoneme +
    ' · id ' + (lastTrace.stages[0].data[selPhoneme] | 0) +
    ' · ' + (dur ? dur[selPhoneme] : 0) + ' frames';

  // hear what you just lit up: play this phoneme's slice of the waveform
  if (selPhoneme >= 0 && dur && total) playPhonemeSegment(selPhoneme, dur, total);
}

// Play just one phoneme's audio. Its frame span maps proportionally onto the
// published clip (same time axis, different sample rate), so we trigger the
// existing clip and restrict playback to that sub-region — no re-upload.
function playPhonemeSegment(l, dur, total) {
  if (clipId < 0 || !audioCtx || !clipSamples) return;
  let s = 0; for (let i = 0; i < l; i++) s += dur[i];
  const a = Math.floor((s / total) * clipSamples);
  const b = Math.max(a + 1, Math.floor(((s + dur[l]) / total) * clipSamples));
  try {
    const pb = audioCtx.playClip(clipId, 1.0, false);
    audioCtx.setPlaybackRegion(pb, a, b);
  } catch (e) { setBadge('audio: ' + e.message, true); }
}

function renderChips(body, s) {
  const wrap = el('div', 'chips');
  for (let i = 0; i < s.data.length; i++)
    wrap.appendChild(el('span', 'chip', String(s.data[i] | 0)));
  body.appendChild(wrap);
}

// Alignment: each phoneme gets horizontal width proportional to its frame
// count — the literal symbol-time -> frame-time layout.
function renderAlign(body, s) {
  const W = 1100, H = 54;
  const cv = mkCanvas(body, W, H);
  const ctx = cv.getContext('2d');
  const total = s.data.reduce((a, b) => a + b, 0) || 1;
  let x = 0;
  for (let i = 0; i < s.data.length; i++) {
    const w = (s.data[i] / total) * W;
    ctx.fillStyle = (i % 2) ? '#1f3350' : '#284873';
    ctx.fillRect(x, 0, Math.max(1, w - 1), H);
    if (w > 16) {
      ctx.fillStyle = '#9fb6d4';
      ctx.font = '10px monospace';
      ctx.fillText(String(s.data[i] | 0), x + 3, 14);
    }
    x += w;
  }
  // click a block to trace that phoneme through every stage
  cv.addEventListener('click', (e) => {
    const frac = e.offsetX / cv.clientWidth, target = frac * total;
    let acc = 0;
    for (let i = 0; i < s.data.length; i++) { acc += s.data[i]; if (target < acc) { selectPhoneme(i); break; } }
  });
  body.appendChild(el('div', 'axis-note',
    'left -> right = time · block width = frames for that phoneme · sum = ' + total +
    ' frames · click a block to trace it'));
}

function renderCurve(body, s, color) {
  const W = 1100, H = 130, pad = 6;
  const cv = mkCanvas(body, W, H);
  const ctx = cv.getContext('2d');
  const d = s.data, n = d.length;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const range = (mx - mn) || 1;
  // zero baseline if it falls inside the range
  if (mn < 0 && mx > 0) {
    const zy = H - pad - ((0 - mn) / range) * (H - 2 * pad);
    ctx.strokeStyle = '#222b38'; ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(W, zy); ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const i = Math.floor(x * n / W);
    const y = H - pad - ((d[i] - mn) / range) * (H - 2 * pad);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  body.appendChild(el('div', 'axis-note',
    'range ' + mn.toFixed(1) + ' … ' + mx.toFixed(1) + ' over ' + n + ' frames'));
}

function renderWave(body, s) {
  const W = 1100, H = 120, mid = H / 2;
  const cv = mkCanvas(body, W, H);
  const ctx = cv.getContext('2d');
  const d = s.data, n = d.length, per = Math.max(1, Math.floor(n / W));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  ctx.strokeStyle = '#5aa0e0';
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    const s0 = x * per, s1 = Math.min(n, s0 + per);
    for (let i = s0; i < s1; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const y0 = mid - (hi / peak) * mid, y1 = mid - (lo / peak) * mid;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 0.5); ctx.stroke();
  }
}

// Diverging colormap: blue (neg) -> dark (0) -> amber (pos).
function divColor(t) {
  t = t < -1 ? -1 : t > 1 ? 1 : t;
  const base = [14, 18, 24];
  const pos = [235, 150, 70], neg = [90, 175, 255];
  const to = t >= 0 ? pos : neg, m = Math.abs(t);
  return [
    base[0] + (to[0] - base[0]) * m,
    base[1] + (to[1] - base[1]) * m,
    base[2] + (to[2] - base[2]) * m,
  ];
}

// A reference signal (F0 / energy) from the current trace, resampled to width w.
function getRef(name, w) {
  if (!lastTrace) return null;
  const s = lastTrace.stages.find((x) => x.name === name);
  if (!s) return null;
  const ref = s.data, R = ref.length, out = new Float32Array(w);
  for (let x = 0; x < w; x++) out[x] = ref[Math.floor(x * R / w)];
  return out;
}

// Channel (row) order for a heatmap. 'native' = as stored; 'variance' = most
// active channels first; 'f0'/'energy' = sorted by correlation to that contour,
// so channels that track pitch/energy cluster together. This is the first
// "derived" view: a question-driven reordering of an opaque latent.
function channelOrder(s, mode) {
  const { h, w, data } = s;
  const idx = Array.from({ length: h }, (_, i) => i);
  if (mode === 'native') return idx;

  const score = new Float64Array(h);
  if (mode === 'variance') {
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let v = 0; for (let x = 0; x < w; x++) { const dd = data[base + x] - m; v += dd * dd; }
      score[c] = v;
    }
  } else {
    const ref = getRef(mode === 'f0' ? 'F0_pred' : 'N_pred', w);
    if (!ref) return idx;
    let rm = 0; for (let x = 0; x < w; x++) rm += ref[x]; rm /= w;
    let rv = 0; for (let x = 0; x < w; x++) { const dd = ref[x] - rm; rv += dd * dd; }
    rv = Math.sqrt(rv) || 1;
    for (let c = 0; c < h; c++) {
      const base = c * w; let m = 0;
      for (let x = 0; x < w; x++) m += data[base + x]; m /= w;
      let cov = 0, sv = 0;
      for (let x = 0; x < w; x++) { const a = data[base + x] - m; cov += a * (ref[x] - rm); sv += a * a; }
      score[c] = cov / ((Math.sqrt(sv) || 1) * rv);
    }
  }
  idx.sort((a, b) => score[b] - score[a]);
  return idx;
}

function renderHeat(body, s) {
  // robust z-score scale: subtract the mean, scale by 3σ, clip — so a few
  // outliers no longer crush the bulk to black (the bert_dur / gen_in problem).
  let m = 0; for (let i = 0; i < s.data.length; i++) m += s.data[i]; m /= s.data.length;
  let v = 0; for (let i = 0; i < s.data.length; i++) { const dd = s.data[i] - m; v += dd * dd; }
  const sd = Math.sqrt(v / s.data.length) || 1;

  const dispW = Math.min(s.w, 1100);
  const dispH = Math.max(120, Math.min(s.h, 420));   // give thin stages real height

  // row-ordering control
  const ctrl = el('div', 'heat-ctrl');
  ctrl.appendChild(el('span', 'ctrl-label', 'rows:'));
  const sel = document.createElement('select');
  [['native', 'native'], ['variance', 'by variance'],
   ['f0', 'by F0 corr'], ['energy', 'by energy corr']].forEach(([val, txt]) => {
    const o = document.createElement('option'); o.value = val; o.textContent = txt; sel.appendChild(o);
  });
  ctrl.appendChild(sel);
  body.appendChild(ctrl);

  const cv = mkCanvas(body, dispW, dispH);
  const ctx = cv.getContext('2d');
  const note = el('div', 'axis-note', '');
  body.appendChild(note);

  function draw(mode) {
    const order = channelOrder(s, mode);
    const img = ctx.createImageData(dispW, dispH);
    for (let y = 0; y < dispH; y++) {
      const sc = order[Math.floor(y * s.h / dispH)], base = sc * s.w;
      for (let x = 0; x < dispW; x++) {
        const sx = Math.floor(x * s.w / dispW);
        const c = divColor((s.data[base + sx] - m) / (3 * sd));
        const o = (y * dispW + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    note.textContent = 'rows = ' + s.h + ' (channel' + (mode === 'native' ? '' : ', ' + mode + '-ordered') +
      ')  ·  cols = ' + s.w + '  ·  z-scored: blue below-avg, amber above-avg (μ ' +
      m.toFixed(2) + ' σ ' + sd.toFixed(2) + ')';
  }
  sel.addEventListener('change', () => draw(sel.value));
  draw('native');
}

// ═══ audio ═════════════════════════════════════════════════════════════════
// bro's AudioContext is clip-based (broaudio), not Web Audio createBuffer.
//
// Threading note: createClip publishes the samples to the audio thread (a
// lock-free RCU hand-off), playClip triggers playback. Doing both in the same
// tick on every press re-uploads the buffer and fires it before the transfer
// has cycled — and leaks a clip per press. So we upload ONCE per synthesis
// (ensureClip, in run()) and let Play just re-trigger the already-published
// clip; the auto-play after a run is deferred a few frames so the upload lands.
function ensureClip() {
  if (!lastTrace) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const outRate = audioCtx.sampleRate || 48000;
    const src = lastTrace.samples, inRate = lastTrace.sampleRate;
    let buf;
    if (Math.abs(outRate - inRate) < 1) {
      buf = src;
    } else {
      const ratio = outRate / inRate, n = Math.floor(src.length * ratio);
      buf = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        buf[i] = src[j] * (1 - f) + (src[j + 1] !== undefined ? src[j + 1] : src[j]) * f;
      }
    }
    if (clipId >= 0) { try { audioCtx.deleteClip(clipId); } catch (e) {} }
    clipId = audioCtx.createClip(buf, 1);
    clipSamples = buf.length;
  } catch (e) { setBadge('audio: ' + e.message, true); clipId = -1; clipSamples = 0; }
}

function play() {
  if (clipId < 0 || !audioCtx) return;
  try { audioCtx.playClip(clipId, 1.0, false); }
  catch (e) { setBadge('audio: ' + e.message, true); }
}

// ═══ small helpers ═════════════════════════════════════════════════════════
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function mkCanvas(body, w, h) {
  const wrap = el('div', 'canvas-wrap');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ov = el('div', 'flow-hl');
  wrap.appendChild(cv); wrap.appendChild(ov);
  body.appendChild(wrap);
  cv._overlay = ov;   // retrieved by renderStages to drive the flow highlight
  return cv;
}
function stats(d) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { mn, mx, mean: d.length ? sum / d.length : 0 };
}

// ═══ wire up ═══════════════════════════════════════════════════════════════
function init() {
  loadBasis();
  if (basis) {
    const src = $('#source');
    const neu = document.createElement('option');
    neu.value = '__neutral__'; neu.textContent = 'neutral (centroid)';
    src.appendChild(neu);
    for (const n of basis.names) {
      const o = document.createElement('option'); o.value = n; o.textContent = n; src.appendChild(o);
    }
    src.value = 'af_heart';
    buildSliders();
    src.addEventListener('change', () => seedFrom(src.value));
    $('#btn-random').addEventListener('click', randomVoice);
    $('#btn-neutral').addEventListener('click', () => { $('#source').value = '__neutral__'; seedFrom('__neutral__'); });
    $('#btn-clone').addEventListener('click', clone);
    $('#btn-save').addEventListener('click', saveVoice);
  }
  $('#btn-run').addEventListener('click', run);
  $('#btn-play').addEventListener('click', play);
  $('#btn-reload').addEventListener('click', reload);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  reload();
}
init();
