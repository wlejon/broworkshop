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

function renderHeat(body, s) {
  const h = s.h, w = s.w, d = s.data;
  const dispW = Math.min(w, 1100), dispH = Math.min(h, 360);
  const cv = mkCanvas(body, dispW, dispH);
  const ctx = cv.getContext('2d');
  // symmetric scale around 0 by robust max-abs
  let maxAbs = 1e-6;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > maxAbs) maxAbs = a; }
  const img = ctx.createImageData(dispW, dispH);
  for (let y = 0; y < dispH; y++) {
    const sy = Math.floor(y * h / dispH);
    for (let x = 0; x < dispW; x++) {
      const sx = Math.floor(x * w / dispW);
      const c = divColor(d[sy * w + sx] / maxAbs);
      const o = (y * dispW + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  body.appendChild(el('div', 'axis-note',
    'rows = ' + h + ' (feature/channel)  ·  cols = ' + w +
    ' (phoneme or frame)  ·  blue −  amber +  · |max| ' + maxAbs.toFixed(2)));
}

// ═══ audio ═════════════════════════════════════════════════════════════════
function play() {
  if (!lastTrace) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const b = audioCtx.createBuffer(1, lastTrace.samples.length, lastTrace.sampleRate);
    b.getChannelData(0).set(lastTrace.samples);
    const src = audioCtx.createBufferSource();
    src.buffer = b; src.connect(audioCtx.destination); src.start();
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
