// Sortformer Lab — live streaming speaker diarization on any audio source.
//
// Pipeline: bro.listen.open(source) gives an independent 16 kHz stream (the mic,
// the whole-system output, or one app's audio — same source model as listen-lab).
// We retain its raw audio and, each tick, pull the new samples and push them
// through a bro.diar Sortformer streaming session (model.createSession() +
// session.feed(window, /*isLast*/ true)). Each flush continues the session's
// Arrival-Order Speaker Cache, so speaker labels stay stable across windows, and
// returns per-80 ms-frame activity probabilities for up to four speakers, which
// we scroll across the timeline canvas and surface as live per-speaker meters.
//
// Why flush a window at a time: the C++ session buffers audio and only runs the
// model on feed(..., isLast=true), so each flush runs the streaming forward over
// that window while the persistent Arrival-Order Speaker Cache keeps speaker
// identities consistent across flushes. The window size (state.windowSec, the
// "context" control) is the latency/accuracy dial: Sortformer has no clustering
// or sensitivity knob — it separates speakers by attending over a span of audio,
// so it needs to HEAR enough of each voice to tell similar-sounding speakers
// apart. Short windows ≈ the model's lowest-latency mode and collapse similar
// voices into one; longer windows (toward the native ~15 s chunk) separate them.
// Offline whole-clip diarization is the separate bro.diar.diarize(model, audio)
// path (not used by this live lab).

const $ = (s) => document.querySelector(s);
const fs = require('fs');

// ── module state (exported for the headless smoke test) ──────────────────────
export const state = {
  model: null,
  session: null,
  device: 'cpu',
  source: null,          // ListenStream handle (or null)
  sourceKind: null,
  lastFrame: -1,         // retention frame cursor
  hop: 160,
  rate: 16000,
  running: false,
  ticker: null,
  threshold: 0.5,
  windowSec: 4,          // audio fed per update (the latency/accuracy dial)
  frames: [],            // [{ probs: Float32Array(S) }] scrolling history
  totalFrames: 0,        // diarization frames emitted since clear
  numSpk: 4,
  frameSeconds: 0.08,
  lastRtf: 0, lastFeedMs: 0, audioSeconds: 0,
};

const MAX_FRAMES = 1800;                  // ~144 s of 80 ms columns
const SPK_COLORS = ['#5ad1ff', '#ffb24d', '#7fe08a', '#ff6f91'];

// ── model dir discovery ──────────────────────────────────────────────────────
const MODEL_CANDIDATES = [
  '../../../brosoundml-data/sortformer/4spk-v2.1',
  'D:/projects/brosoundml-data/sortformer/4spk-v2.1',
];
export function defaultModelDir() {
  for (const p of MODEL_CANDIDATES) {
    try { if (fs.existsSync(p + '/config.json')) return fs.realpathSync(p); }
    catch (e) { /* next */ }
  }
  return MODEL_CANDIDATES[0];
}

function setBackend(text, cls) {
  const b = $('#backend');
  b.textContent = text;
  b.className = 'badge' + (cls ? ' ' + cls : '');
}

function status(msg) {
  const el = $('#stats');
  if (el.querySelector('.placeholder')) el.innerHTML = '';
  el.innerHTML = msg;
}

// ── model load ───────────────────────────────────────────────────────────────
export function loadModel(dir) {
  setBackend('loading model…');
  $('#btn-load').disabled = true;
  try {
    bro.diar.loadSortformer(dir, {
      onReady: (m) => {
        state.model = m;
        state.numSpk = m.numSpeakers;
        state.frameSeconds = m.frameSeconds;
        const gpu = (typeof bro.gpu !== 'undefined') ? bro.gpu : null;
        state.device = gpu && gpu.available ? gpu.backend : 'cpu';
        setBackend('Sortformer · ' + state.device.toUpperCase(), 'ok');
        $('#model-meta').textContent =
          m.numSpeakers + ' speakers · frame ' + (m.frameSeconds * 1000) + ' ms · enc ' +
          m.fcDModel + 'd / head ' + m.tfDModel + 'd';
        $('#btn-load').disabled = false;
        $('#btn-listen').disabled = false;
        buildSpeakerCards();
        status('Model ready. Pick a source and press <b>listen</b>.');
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
    o.value = value; o.textContent = label;
    sel.appendChild(o);
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
  if (!state.model) { status('Load a model first.'); return; }
  if (state.running) return;
  const spec = specFromSelect();
  if (!spec) { status('Pick a valid source.'); return; }

  let handle;
  try { handle = bro.listen.open(spec.arg); }
  catch (e) { status('open ' + spec.label + ': ' + (e.message || e)); return; }
  if (!handle || !handle.valid) { status('could not open ' + spec.label); return; }

  handle.retain(180);                      // raw-audio ring we pull windows from
  const info = handle.info();
  state.source = handle;
  state.sourceKind = spec.kind;
  state.rate = info.rate || 16000;
  state.hop = info.hop || 160;
  state.lastFrame = -1;
  state.session = state.model.createSession();
  state.running = true;

  $('#btn-listen').disabled = true;
  $('#btn-stop').disabled = false;
  $('#src-sel').disabled = true;
  status('Listening to <b>' + spec.label + '</b> — ' + state.windowSec +
         ' s context window per update.');

  state.ticker = setInterval(tick, 250);
}

export function stopListening() {
  state.running = false;
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  if (state.source) { try { state.source.close(); } catch (e) {} state.source = null; }
  state.session = null;
  $('#btn-listen').disabled = !state.model;
  $('#btn-stop').disabled = true;
  $('#src-sel').disabled = false;
  $('#level-fill').style.width = '0%';
  status('Stopped.');
}

export function clearTimeline() {
  state.frames = [];
  state.totalFrames = 0;
  state.audioSeconds = 0;
  if (state.session) { try { state.session.reset(); } catch (e) {} state.lastFrame = -1; }
  for (let s = 0; s < state.numSpk; s++) updateSpeakerCard(s, 0);
  drawTimeline();
  status('Cleared.');
}

// ── the live pull → feed loop ────────────────────────────────────────────────
function tick() {
  if (!state.running || !state.source || !state.session) return;
  const h = state.source;
  if (!h.valid) { status('source ended'); stopListening(); return; }

  const newest = h.frame();
  if (state.lastFrame < 0) { state.lastFrame = newest; return; }   // skip startup backlog
  const span = newest - state.lastFrame;
  if (span * state.hop < 16000 * state.windowSec) return;          // wait for a full context window

  const pcm = h.audio(state.lastFrame, newest);
  state.lastFrame = newest;
  if (!pcm || !pcm.length) return;

  // input level meter
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
  $('#level-fill').style.width = Math.min(100, peak * 140).toFixed(0) + '%';

  feedWindow(pcm);
}

// Push one window of 16 kHz mono PCM through the session and fold the result into
// the timeline. Exposed so the headless test can drive it without a live source.
export function feedWindow(pcm) {
  if (!state.session) return null;
  const t0 = Date.now();
  let d;
  try { d = state.session.feed({ samples: pcm, sampleRate: 16000 }, /*isLast*/ true); }
  catch (e) { status('feed: ' + (e.message || e)); return null; }
  const ms = Date.now() - t0;

  const S = d.numSpeakers;
  for (let f = 0; f < d.numFrames; f++) {
    const probs = new Float32Array(S);
    for (let s = 0; s < S; s++) probs[s] = d.probs[f * S + s];
    state.frames.push({ probs });
  }
  if (state.frames.length > MAX_FRAMES) state.frames.splice(0, state.frames.length - MAX_FRAMES);
  state.totalFrames += d.numFrames;
  state.audioSeconds += pcm.length / 16000;

  const winSec = pcm.length / 16000;
  state.lastFeedMs = ms;
  state.lastRtf = winSec > 0 ? (ms / 1000) / winSec : 0;

  // live meters from the most recent frame
  const last = state.frames[state.frames.length - 1];
  for (let s = 0; s < state.numSpk; s++) updateSpeakerCard(s, last ? (last.probs[s] || 0) : 0);

  drawTimeline();
  renderStats();
  return d;
}

function renderStats() {
  status(
    '<b>' + state.totalFrames + '</b> frames · <b>' + state.audioSeconds.toFixed(1) +
    ' s</b> diarized · last window <b>' + state.lastFeedMs + ' ms</b> (RTF ' +
    state.lastRtf.toFixed(3) + ') · ' + state.device.toUpperCase());
}

// ── speaker cards ─────────────────────────────────────────────────────────────
function buildSpeakerCards() {
  const wrap = $('#speakers');
  wrap.innerHTML = '';
  for (let s = 0; s < state.numSpk; s++) {
    const c = SPK_COLORS[s % SPK_COLORS.length];
    const el = document.createElement('div');
    el.className = 'spk idle';
    el.id = 'spk-' + s;
    el.innerHTML =
      '<span class="dot" style="background:' + c + '"></span>' +
      '<span class="nm">Speaker ' + (s + 1) + '</span>' +
      '<span class="bar"><i style="background:' + c + '"></i></span>' +
      '<span class="pct">0%</span>';
    wrap.appendChild(el);
  }
}

function updateSpeakerCard(s, prob) {
  const el = $('#spk-' + s);
  if (!el) return;
  el.querySelector('i').style.width = (prob * 100).toFixed(0) + '%';
  el.querySelector('.pct').textContent = (prob * 100).toFixed(0) + '%';
  el.classList.toggle('idle', prob < state.threshold);
}

// ── timeline canvas ───────────────────────────────────────────────────────────
function drawTimeline() {
  const cv = $('#timeline');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#0a0c11';
  ctx.fillRect(0, 0, W, H);

  const S = state.numSpk;
  const laneH = H / S;
  // lane separators + labels
  ctx.strokeStyle = '#1a1f2c';
  for (let s = 0; s < S; s++) {
    const y = s * laneH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const n = state.frames.length;
  if (n) {
    const colW = Math.max(1, W / Math.min(n, MAX_FRAMES));
    const x0 = W - n * colW;
    for (let i = 0; i < n; i++) {
      const probs = state.frames[i].probs;
      const x = x0 + i * colW;
      for (let s = 0; s < S; s++) {
        const p = probs[s] || 0;
        if (p <= 0.02) continue;
        const c = SPK_COLORS[s % SPK_COLORS.length];
        ctx.globalAlpha = p >= state.threshold ? Math.min(1, 0.35 + p * 0.65) : p * 0.45;
        ctx.fillStyle = c;
        const pad = 2;
        ctx.fillRect(x, s * laneH + pad, Math.ceil(colW), laneH - pad * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // lane labels on top
  ctx.fillStyle = '#5c6478';
  ctx.font = '11px sans-serif';
  for (let s = 0; s < S; s++) ctx.fillText('S' + (s + 1), 4, s * laneH + 13);
}

// ── wire up ───────────────────────────────────────────────────────────────────
function init() {
  bro.diar.init();
  $('#model-dir').value = defaultModelDir();
  buildSourceOptions();

  $('#btn-load').addEventListener('click', () => loadModel($('#model-dir').value.trim()));
  $('#btn-browse-model').addEventListener('click', () => {
    if (typeof showOpenFolderDialog !== 'function') return;
    const d = showOpenFolderDialog();
    if (d) { $('#model-dir').value = d; }
  });
  $('#btn-listen').addEventListener('click', startListening);
  $('#btn-stop').addEventListener('click', stopListening);
  $('#btn-clear').addEventListener('click', clearTimeline);
  $('#src-sel').addEventListener('mousedown', buildSourceOptions);   // refresh app list on open
  $('#ctx').value = String(state.windowSec);
  $('#ctx').addEventListener('change', (e) => {
    state.windowSec = parseFloat(e.target.value);
    if (state.running) status('Context window: <b>' + state.windowSec + ' s</b> per update.');
  });
  $('#thresh').addEventListener('input', (e) => {
    state.threshold = parseFloat(e.target.value);
    $('#thresh-val').textContent = state.threshold.toFixed(2);
    drawTimeline();
  });

  drawTimeline();
  // auto-load if the default checkpoint is present
  try { if (fs.existsSync($('#model-dir').value + '/config.json')) loadModel($('#model-dir').value); }
  catch (e) { /* manual load */ }
}

init();
