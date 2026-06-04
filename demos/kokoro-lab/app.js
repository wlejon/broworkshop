// Kokoro Lab — drive Kokoro and watch every pipeline stage transform the data.
//
// Flow: text -> bro.tts.phonemize -> kokoro.synthesizeTraced(ids, voice) which
// returns { samples, sampleRate, durations, stages[] }. Each stage is a
// row-major (h x w) Float32Array captured inside the real Kokoro forward pass
// (see brosoundml KokoroTrace). We render each in the form that reads best.
//
// EXTENSION SEAM: every rendered stage is an attach point. `lastTrace` holds
// the full set of intermediates; a future "derived" panel can take any
// stage's tensor as input to a JS-authored transform and render its output
// alongside these — that's how this observatory grows into a workbench.

const $ = (s) => document.querySelector(s);

const VOICES = ['af_heart', 'af_bella', 'af_alloy', 'af_aoede', 'af_jessica'];

let kokoro = null;
let voice = null;
let lastTrace = null;     // { samples, sampleRate, durations, stages }
let audioCtx = null;

// ─── stage metadata: what each representation is, in plain words ───────────
const STAGE_INFO = {
  phonemes: { kind: 'chips',  desc: 'input phoneme ids — symbol time, length L' },
  bert_dur: { kind: 'heat',   desc: 'plBERT contextual features — L phonemes x 768 dims' },
  d_en:     { kind: 'heat',   desc: 'predictor conditioning (PROSODY branch) — 512 ch x L' },
  t_en:     { kind: 'heat',   desc: 'text-encoder content (CONTENT branch) — 512 ch x L' },
  pred_dur: { kind: 'align',  desc: 'predicted frames per phoneme — the alignment (symbol -> time)' },
  F0_pred:  { kind: 'curve',  desc: 'pitch contour (Hz) at frame rate', color: '#ffcf6b' },
  N_pred:   { kind: 'curve',  desc: 'energy contour at frame rate', color: '#7fd1a6' },
  asr:      { kind: 'heat',   desc: 'duration-aligned content — 512 ch x T frames' },
  gen_in:   { kind: 'heat',   desc: 'decoder-backbone output — 512 ch x 2T' },
  har:      { kind: 'heat',   desc: 'harmonic-source excitation — (n_fft+2) x frames' },
  audio:    { kind: 'wave',   desc: 'output waveform — 24 kHz' },
};

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
  setBadge('loading model…');
  try {
    bro.tts.setAssetRoot($('#asset-root').value.trim());
    bro.tts.loadKokoro($('#model-dir').value.trim(), {
      onReady: (k) => { kokoro = k; setBadge('model ready · loading voice…'); loadVoice(); },
      onError: (m) => setBadge('model error: ' + m, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}

function loadVoice() {
  if (!kokoro) return;
  const name = $('#voice').value;
  const path = $('#model-dir').value.trim() + '/voices/' + name + '.bin';
  kokoro.loadVoice(path, {
    onReady: (v) => {
      voice = v;
      setBadge('ready · ' + name + ' (' + v.rows + 'x' + v.cols + ')');
      $('#btn-run').disabled = false;
    },
    onError: (m) => setBadge('voice error: ' + m, true),
  });
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
  play();   // auto-play once
}

// ═══ render ════════════════════════════════════════════════════════════════
function renderStages(stages) {
  const root = $('#stages');
  root.textContent = '';
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
  }
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
  body.appendChild(el('div', 'axis-note',
    'left -> right = time · block width = frames for that phoneme · sum = ' + total + ' frames'));
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
// bro's AudioContext is clip-based (broaudio), not Web Audio createBuffer. Clips
// play at the engine sample rate, so resample Kokoro's 24 kHz to ctx.sampleRate.
function play() {
  if (!lastTrace) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const outRate = audioCtx.sampleRate || 48000;
    const src = lastTrace.samples, inRate = lastTrace.sampleRate;
    let buf;
    if (Math.abs(outRate - inRate) < 1) {
      buf = src;
    } else {
      const ratio = outRate / inRate;
      const n = Math.floor(src.length * ratio);
      buf = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        buf[i] = src[j] * (1 - f) + (src[j + 1] !== undefined ? src[j + 1] : src[j]) * f;
      }
    }
    const clip = audioCtx.createClip(buf, 1);
    audioCtx.playClip(clip, 1.0, false);
  } catch (e) { setBadge('audio: ' + e.message, true); }
}

// ═══ small helpers ═════════════════════════════════════════════════════════
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function mkCanvas(body, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  body.appendChild(cv);
  return cv;
}
function stats(d) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  return { mn, mx, mean: d.length ? sum / d.length : 0 };
}

// ═══ wire up ═══════════════════════════════════════════════════════════════
function init() {
  const sel = $('#voice');
  for (const v of VOICES) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  $('#btn-run').addEventListener('click', run);
  $('#btn-play').addEventListener('click', play);
  $('#btn-reload').addEventListener('click', reload);
  sel.addEventListener('change', loadVoice);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  reload();
}
init();
