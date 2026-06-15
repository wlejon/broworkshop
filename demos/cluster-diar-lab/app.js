// Cluster Diarization Lab — telling apart similar-sounding voices.
//
// Sortformer (and its NeMo reference) collapses acoustically similar voices —
// two women in the same pitch range — into one speaker slot. This lab drives the
// alternative: bro.diar.loadClusterDiarizer (Sortformer activity as VAD + ECAPA
// x-vectors + centered-cosine clustering). The cosine threshold is the "how
// different is different" knob Sortformer never exposed.
//
// The clusterer is OFFLINE (it re-clusters a whole clip), so the live loop here
// retains the source audio via bro.listen and, every couple seconds, re-diarizes
// the whole capture so far — the speaker count grows/settles as it hears more.
// Feed it CLEAN 16 kHz: bro.listen delivers exactly that, so we pull raw retained
// PCM (no decode/resample round-trip, which would blur the speaker margin).

const $ = (s) => document.querySelector(s);
const fs = require('fs');

export const state = {
  model: null,
  device: 'cpu',
  source: null,
  sourceKind: null,
  startFrame: -1,        // capture-start cursor in the retained ring
  hop: 160,
  rate: 16000,
  running: false,
  ticker: null,
  busy: false,           // a clusterDiarize is in flight
  cosine: 0.40,          // cluster threshold
  result: null,          // last Diarization
  numSpk: 0,
  frameSeconds: 0.08,
  lastMs: 0, capturedSec: 0,
};

const RERUN_MS = 2500;             // re-diarize cadence
const MIN_CAPTURE_SEC = 3.0;       // need a couple windows before the first run
const SPK_COLORS = ['#5ad1ff', '#ffb24d', '#7fe08a', '#ff6f91',
                    '#c79bff', '#ffe06b', '#6bd6c2', '#ff8f6b'];

const SORT_CANDIDATES = [
  '../../../brosoundml/weights/sortformer/4spk-v2.1',
  'D:/projects/brosoundml/weights/sortformer/4spk-v2.1',
];
const ENC_CANDIDATES = [
  '../../../brosoundml-data/qwen-tts/speaker-encoder',
  'D:/projects/brosoundml-data/qwen-tts/speaker-encoder',
];
function firstWith(cands, marker) {
  for (const p of cands) {
    try { if (fs.existsSync(p + marker)) return fs.realpathSync(p); } catch (e) {}
  }
  return cands[0];
}
export function defaultSortDir() { return firstWith(SORT_CANDIDATES, '/config.json'); }
export function defaultEncDir()  { return firstWith(ENC_CANDIDATES, '/model.safetensors'); }

function setBackend(text, cls) {
  const b = $('#backend'); b.textContent = text; b.className = 'badge' + (cls ? ' ' + cls : '');
}
function status(msg) {
  const el = $('#stats');
  if (el.querySelector('.placeholder')) el.innerHTML = '';
  el.innerHTML = msg;
}

// ── model load ───────────────────────────────────────────────────────────────
export function loadModel(sortDir, encDir) {
  setBackend('loading models…');
  $('#btn-load').disabled = true;
  try {
    bro.diar.loadClusterDiarizer(sortDir, encDir, {
      onReady: (m) => {
        state.model = m;
        const gpu = (typeof bro.gpu !== 'undefined') ? bro.gpu : null;
        state.device = gpu && gpu.available ? gpu.backend : 'cpu';
        setBackend('ClusterDiarizer · ' + state.device.toUpperCase(), 'ok');
        $('#model-meta').textContent = 'Sortformer VAD + ECAPA x-vectors';
        $('#btn-load').disabled = false;
        $('#btn-listen').disabled = false;
        status('Models ready. Pick a source and press <b>listen</b>.');
      },
      onError: (msg) => {
        setBackend('load failed', 'err');
        $('#btn-load').disabled = false;
        status('Model load failed: ' + msg);
      },
    });
  } catch (e) {
    setBackend('load failed', 'err');
    $('#btn-load').disabled = false;
    status('Model load failed: ' + (e.message || e));
  }
}

// ── source picker (mic / system / per-app) ───────────────────────────────────
let appNames = {};
export function buildSourceOptions() {
  const sel = $('#src-sel');
  const supported = bro.listen.supported();
  const apps = supported ? bro.listen.apps() : [];
  appNames = {};
  const prev = sel.value;
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label; sel.appendChild(o);
  };
  add('mic', 'microphone');
  if (supported) add('system', 'system audio (loopback)');
  for (const a of apps) { appNames[a.pid] = a.name; add('pid:' + a.pid, a.name + '  ·  #' + a.pid); }
  if (!supported) add('__nosys', '— loopback/per-app unsupported here —');
  if (prev && Array.from(sel.querySelectorAll('option')).some((o) => o.value === prev)) sel.value = prev;
}
function specFromSelect() {
  const v = $('#src-sel').value;
  if (v === 'mic') return { kind: 'mic', arg: 'mic', label: 'microphone' };
  if (v === 'system') return { kind: 'system', arg: 'system', label: 'system audio' };
  if (v && v.indexOf('pid:') === 0) {
    const pid = parseInt(v.slice(4), 10);
    return { kind: 'process', arg: { process: pid }, label: appNames[pid] || ('pid ' + pid) };
  }
  return null;
}

// ── listen / stop ─────────────────────────────────────────────────────────────
export function startListening() {
  if (!state.model) { status('Load the models first.'); return; }
  if (state.running) return;
  const spec = specFromSelect();
  if (!spec) { status('Pick a valid source.'); return; }

  let handle;
  try { handle = bro.listen.open(spec.arg); }
  catch (e) { status('open ' + spec.label + ': ' + (e.message || e)); return; }
  if (!handle || !handle.valid) { status('could not open ' + spec.label); return; }

  handle.retain(180);
  const info = handle.info();
  state.source = handle;
  state.sourceKind = spec.kind;
  state.rate = info.rate || 16000;
  state.hop = info.hop || 160;
  state.startFrame = handle.frame();   // diarize everything from now on
  state.running = true;

  $('#btn-listen').disabled = true;
  $('#btn-stop').disabled = false;
  $('#src-sel').disabled = true;
  status('Listening to <b>' + spec.label + '</b> — re-diarizing the whole capture every ' +
         (RERUN_MS / 1000) + ' s.');

  state.ticker = setInterval(rerun, RERUN_MS);
}

export function stopListening() {
  state.running = false;
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  if (state.source) { try { state.source.close(); } catch (e) {} state.source = null; }
  $('#btn-listen').disabled = !state.model;
  $('#btn-stop').disabled = true;
  $('#src-sel').disabled = false;
  $('#level-fill').style.width = '0%';
  status('Stopped.');
}

export function clearTimeline() {
  state.result = null; state.numSpk = 0; state.capturedSec = 0;
  // restart the capture window so the next run is fresh
  if (state.source && state.source.valid) state.startFrame = state.source.frame();
  $('#speakers').innerHTML = '';
  drawTimeline();
  status('Cleared.');
}

// ── the re-diarize loop: pull the whole capture, cluster it ──────────────────
function rerun() {
  if (!state.running || !state.source || state.busy) return;
  const h = state.source;
  if (!h.valid) { status('source ended'); stopListening(); return; }
  const newest = h.frame();
  const span = newest - state.startFrame;
  if (span * state.hop < 16000 * MIN_CAPTURE_SEC) return;   // not enough yet

  const pcm = h.audio(state.startFrame, newest);
  if (!pcm || !pcm.length) return;

  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
  $('#level-fill').style.width = Math.min(100, peak * 140).toFixed(0) + '%';

  diarizeBuffer(pcm);
}

// Run the clustering diarizer over one PCM buffer and render the result. Exposed
// so the headless smoke can drive it without a live source.
export function diarizeBuffer(pcm) {
  if (!state.model || state.busy) return;
  state.busy = true;
  const t0 = Date.now();
  bro.diar.clusterDiarize(state.model, { samples: pcm, sampleRate: 16000 }, {
    clusterThreshold: state.cosine,
    onDone: (res, info) => {
      state.busy = false;
      state.lastMs = Date.now() - t0;
      state.capturedSec = pcm.length / 16000;
      if (info && info.error) { status('diarize: ' + info.error); return; }
      if (res) { state.result = res; render(res); }
    },
  });
}

function render(res) {
  state.result = res;
  state.numSpk = res.numSpeakers;
  state.frameSeconds = res.frameSeconds;
  buildSpeakerCards(res);
  drawTimeline();
  status('<b>' + res.numSpeakers + '</b> speaker(s) · <b>' + state.capturedSec.toFixed(1) +
         ' s</b> captured · diarized in <b>' + state.lastMs + ' ms</b> · cosine ' +
         state.cosine.toFixed(2) + ' · ' + state.device.toUpperCase());
}

// ── speaker chips (count + per-speaker total speaking time) ───────────────────
function buildSpeakerCards(res) {
  const wrap = $('#speakers');
  wrap.innerHTML = '';
  const S = res.numSpeakers;
  if (!S) { wrap.innerHTML = '<span class="meta">no speech detected yet</span>'; return; }
  const secs = new Float64Array(S);
  for (let t = 0; t < res.numFrames; t++)
    for (let s = 0; s < S; s++)
      if (res.probs[t * S + s] > 0.5) secs[s] += res.frameSeconds;
  for (let s = 0; s < S; s++) {
    const c = SPK_COLORS[s % SPK_COLORS.length];
    const el = document.createElement('div');
    el.className = 'spk';
    el.innerHTML =
      '<span class="dot" style="background:' + c + '"></span>' +
      '<span class="nm">Speaker ' + (s + 1) + '</span>' +
      '<span class="pct">' + secs[s].toFixed(1) + ' s</span>';
    wrap.appendChild(el);
  }
}

// ── timeline canvas (whole capture, dynamic lanes) ───────────────────────────
function drawTimeline() {
  const cv = $('#timeline');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#0a0c11';
  ctx.fillRect(0, 0, W, H);

  const res = state.result;
  const S = res ? res.numSpeakers : 0;
  if (!res || !S || !res.numFrames) {
    ctx.fillStyle = '#5c6478'; ctx.font = '12px sans-serif';
    ctx.fillText('waiting for speech…', 10, 22);
    return;
  }
  const laneH = H / S;
  ctx.strokeStyle = '#1a1f2c';
  for (let s = 0; s < S; s++) {
    const y = s * laneH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const n = res.numFrames;
  const colW = W / n;
  for (let t = 0; t < n; t++) {
    const x = t * colW;
    for (let s = 0; s < S; s++) {
      if (res.probs[t * S + s] <= 0.5) continue;
      ctx.fillStyle = SPK_COLORS[s % SPK_COLORS.length];
      ctx.fillRect(x, s * laneH + 2, Math.ceil(colW), laneH - 4);
    }
  }
  ctx.fillStyle = '#5c6478'; ctx.font = '11px sans-serif';
  for (let s = 0; s < S; s++) ctx.fillText('S' + (s + 1), 4, s * laneH + 13);
}

// ── wire up ───────────────────────────────────────────────────────────────────
function init() {
  bro.diar.init();
  $('#sort-dir').value = defaultSortDir();
  $('#enc-dir').value = defaultEncDir();
  buildSourceOptions();

  $('#btn-load').addEventListener('click', () =>
    loadModel($('#sort-dir').value.trim(), $('#enc-dir').value.trim()));
  $('#btn-listen').addEventListener('click', startListening);
  $('#btn-stop').addEventListener('click', stopListening);
  $('#btn-clear').addEventListener('click', clearTimeline);
  $('#src-sel').addEventListener('mousedown', buildSourceOptions);
  $('#cos').addEventListener('input', (e) => {
    state.cosine = parseFloat(e.target.value);
    $('#cos-val').textContent = state.cosine.toFixed(2);
  });
  // re-diarize immediately when the knob settles, so the effect is visible live
  $('#cos').addEventListener('change', () => {
    if (state.running && state.source && state.source.valid && !state.busy) {
      const newest = state.source.frame();
      if ((newest - state.startFrame) * state.hop >= 16000 * MIN_CAPTURE_SEC)
        diarizeBuffer(state.source.audio(state.startFrame, newest));
    }
  });

  drawTimeline();
  try {
    if (fs.existsSync($('#sort-dir').value + '/config.json') &&
        fs.existsSync($('#enc-dir').value + '/model.safetensors'))
      loadModel($('#sort-dir').value, $('#enc-dir').value);
  } catch (e) { /* manual load */ }
}

init();
