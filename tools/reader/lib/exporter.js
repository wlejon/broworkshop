// ═══ WAV export: narrate the document (or from here) to a file ════════════════
// A background job over the same async synthesis path playback uses: one
// sentence in flight at a time, progress + cancel in a modal, natural pauses
// between sentences (longer at paragraph breaks). Reuses the player's PCM cache
// on exact hits. exportToPath() is the dialog-free seam headless tests drive.
import { $ } from "/app/lib/state.js";
import { engines } from "/app/lib/engine.js";
import * as player from "/app/lib/player.js";

const RATE = 24000;               // both engines emit 24 kHz mono
const SENTENCE_GAP_S = 0.25;
const PARAGRAPH_GAP_S = 0.6;

let job = null;                   // { path, from, to, i, chunks, cancel, handle, done }

export function initExporter() {
  $('#btn-export').addEventListener('click', () => beginExport(true));
  $('#btn-export-cancel').addEventListener('click', cancelExport);
}

export function exporting() { return !!job; }

function beginExport(askScope) {
  if (!player.doc || !player.seg || job) return;
  if (typeof showSaveFileDialog !== 'function') { setStatus('save dialog unavailable in this build'); return; }
  const name = player.doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'narration';
  const p = showSaveFileDialog('WAV Files|wav', name + '.wav');
  if (!p) return;
  const from = askScope && player.cur > 0 ? Math.max(player.cur, 0) : 0;
  exportToPath(/\.wav$/i.test(p) ? p : p + '.wav', { from });
}

// The programmatic entry point: opts = { from?, to?, onDone?(err, path) }.
export function exportToPath(path, opts) {
  opts = opts || {};
  if (!player.doc || !player.seg) { opts.onDone && opts.onDone('no document open', path); return; }
  if (job) { opts.onDone && opts.onDone('an export is already running', path); return; }
  const n = player.seg.sentences.length;
  job = {
    path,
    from: Math.max(0, opts.from || 0),
    to: Math.min(n - 1, opts.to === undefined ? n - 1 : opts.to),
    i: Math.max(0, opts.from || 0),
    chunks: [],
    cancel: false,
    handle: null,
    done: opts.onDone || null,
  };
  showModal(true);
  setStatus('starting…');
  player.acquireModel(step);       // waits out any in-flight prefetch
}

export function cancelExport() {
  if (!job) return;
  job.cancel = true;
  if (job.handle) { try { job.handle.cancel(); } catch (e) {} }
  else finish('cancelled');
}

function step() {
  if (!job) return;
  if (job.cancel) { finish('cancelled'); return; }
  if (job.i > job.to) { writeWav(); return; }
  const seg = player.seg;
  const i = job.i;
  const text = seg.sentences[i].text;
  setStatus('sentence ' + (i - job.from + 1) + ' / ' + (job.to - job.from + 1));
  setBar((i - job.from) / (job.to - job.from + 1));

  const cached = player.peekCache(i);
  if (cached) { push(cached.samples, cached.sampleRate, i); job.i++; setTimeout(step, 0); return; }

  const name = player.engineName();
  const e = engines[name];
  const onDone = (r, info) => {
    if (!job) return;
    job.handle = null;
    if (job.cancel || info.cancelled) { finish('cancelled'); return; }
    if (info.error) { finish('synthesize: ' + info.error); return; }
    push(r.samples, r.sampleRate, i);
    job.i++;
    step();
  };
  try {
    if (name === 'kokoro') {
      const ids = bro.tts.phonemize(text);
      if (!ids || !ids.length) { job.i++; setTimeout(step, 0); return; }
      job.handle = bro.tts.synthesize(e.model, ids, e.voice, { speed: player.speed(), onDone });
    } else {
      job.handle = bro.tts.synthesize(e.model, text, { speaker: player.qwenSpeaker(), language: 'english', onDone });
    }
  } catch (err) { finish('synthesize: ' + err.message); }
}

function push(samples, sampleRate, i) {
  // resample to RATE if an engine ever disagrees (both are 24 kHz today)
  if (Math.abs(sampleRate - RATE) > 1) {
    const ratio = RATE / sampleRate, n = Math.floor(samples.length * ratio);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const t = k / ratio, j = t | 0, f = t - j;
      out[k] = samples[j] * (1 - f) + (samples[j + 1] !== undefined ? samples[j + 1] : samples[j]) * f;
    }
    samples = out;
  }
  job.chunks.push(samples);
  const seg = player.seg;
  if (i < job.to) {
    const paraBreak = seg.sentences[i + 1].para !== seg.sentences[i].para;
    job.chunks.push(new Float32Array(Math.round(RATE * (paraBreak ? PARAGRAPH_GAP_S : SENTENCE_GAP_S))));
  }
}

function writeWav() {
  let total = 0;
  for (const c of job.chunks) total += c.length;
  const all = new Float32Array(total);
  let off = 0;
  for (const c of job.chunks) { all.set(c, off); off += c.length; }
  let err = null;
  try {
    if (!player.audioCtx().saveWav(job.path, all, 1, RATE)) err = 'saveWav failed for ' + job.path;
  } catch (e) { err = e.message; }
  setBar(1);
  finish(err, (total / RATE).toFixed(1) + 's written');
}

function finish(err, okMsg) {
  const done = job && job.done, path = job && job.path;
  job = null;
  player.releaseModel();
  if (err) setStatus(err === 'cancelled' ? 'cancelled' : 'export failed: ' + err);
  else setStatus('saved ' + (okMsg || '') + ' → ' + path);
  setTimeout(() => showModal(false), err === 'cancelled' ? 400 : 1600);
  if (done) { try { done(err || null, path); } catch (e) {} }
}

function showModal(on) { $('#export-modal').style.display = on ? 'flex' : 'none'; }
function setStatus(t) { $('#export-status').textContent = t; }
function setBar(f) { $('#export-fill').style.width = Math.round(f * 100) + '%'; }
