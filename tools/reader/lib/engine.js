// ═══ TTS engines: weight discovery, resident models, voices ══════════════════
// Two engines, user's choice per document:
//   Kokoro   — 82M phoneme pipeline. phonemize() → synthesize(ids, voice) with
//              per-phoneme durations → word-accurate highlight timing, and a
//              native speaking-rate opt (speed baked into the PCM).
//   Qwen3-TTS — 0.6B CustomVoice checkpoint. Text-driven, preset speakers, no
//              durations and no rate param (speed rides playback rate instead).
// Models load once (async, background thread) and stay resident.
import { settings } from "/app/lib/state.js";

const _fs = require('fs');
const _os = require('os');
function pExists(p) { try { return _fs.existsSync(p); } catch (e) { return false; } }

export const engines = {
  kokoro: { model: null, voice: null, voiceName: '', voiceCache: {}, voices: [], status: 'idle', error: '', dir: '', loadMs: 0 },
  qwen:   { model: null, speakers: [], status: 'idle', error: '', dir: '', loadMs: 0 },
};
export const ENGINE_LABEL = { kokoro: 'Kokoro', qwen: 'Qwen3-TTS' };

const listeners = [];
export function onEngineChange(cb) { listeners.push(cb); }
function emit() { for (const cb of listeners) { try { cb(); } catch (e) {} } }

// ── GPU gate ─────────────────────────────────────────────────────────────────
export function gpuOk() { try { return !!(bro.gpu && bro.gpu.available); } catch (e) { return false; } }
export function gpuBackend() { try { return (bro.gpu && bro.gpu.backend) || 'none'; } catch (e) { return 'none'; } }

// ── weight discovery ─────────────────────────────────────────────────────────
// The brosoundml sibling repo (<root>/weights/…) or the published
// brosoundml-data layout (<root>/…) — same detection the labs use.
export function layoutOf(root) {
  if (!root) return null;
  if (pExists(root + '/weights/kokoro/config.json') || pExists(root + '/weights/qwen-tts')) return 'sibling';
  if (pExists(root + '/kokoro/config.json') || pExists(root + '/qwen-tts')) return 'data';
  return null;
}
export function detectRoot() {
  let home = '';
  try { home = _os.homedir().replace(/\\/g, '/'); } catch (e) {}
  const cands = [
    settings.dataRoot,
    'D:/projects/brosoundml',
    home && home + '/projects/brosoundml',
    'D:/projects/brosoundml-data',
    home && home + '/projects/brosoundml-data',
  ].filter(Boolean);
  for (const c of cands) if (layoutOf(c)) return c;
  return settings.dataRoot || cands[1];
}
export function paths() {
  const root = detectRoot();
  const kind = layoutOf(root) || 'sibling';
  const w = kind === 'sibling' ? root + '/weights' : root;
  return { root, kind, kokoro: w + '/kokoro', qwen: w + '/qwen-tts/0.6B-customvoice' };
}
function configureAssets(p) {
  // Point the phonemizer at this source's g2p/POS/config assets.
  if (p.kind === 'sibling') bro.tts.setAssetRoot(p.root);
  else bro.tts.setAssets({
    lexicon: p.root + '/g2p/lexicon_en_us.bin',
    posTagger: p.root + '/pos_tagger/model.bin',
    kokoroConfig: p.root + '/kokoro/config.json',
  });
}

export function listKokoroVoices(dir) {
  try {
    return _fs.readdirSync(dir + '/voices')
      .filter((f) => /\.bin$/i.test(f))
      .map((f) => f.replace(/\.bin$/i, ''))
      .sort();
  } catch (e) { return []; }
}

// ── load (async, once) ───────────────────────────────────────────────────────
// done(err) fires when this call resolves the state; while a load is already in
// flight, callers watch onEngineChange instead (done is queued).
const pendingDone = { kokoro: [], qwen: [] };
export function loadEngine(name, done) {
  const e = engines[name];
  if (!e) { done && done('unknown engine ' + name); return; }
  if (e.status === 'ready') { done && done(null); return; }
  if (done) pendingDone[name].push(done);
  if (e.status === 'loading') return;
  const finish = (err) => {
    const q = pendingDone[name].splice(0);
    for (const cb of q) { try { cb(err); } catch (ex) {} }
  };
  if (!gpuOk()) {
    e.status = 'error';
    e.error = 'no GPU backend (bro.gpu.backend = ' + gpuBackend() + ') — TTS inference needs CUDA';
    emit(); finish(e.error); return;
  }
  const p = paths();
  const dir = name === 'kokoro' ? p.kokoro : p.qwen;
  if (!pExists(dir + '/config.json')) {
    e.status = 'error';
    e.error = ENGINE_LABEL[name] + ' weights not found — expected ' + dir;
    emit(); finish(e.error); return;
  }
  e.status = 'loading'; e.error = ''; e.dir = dir;
  emit();
  const t0 = Date.now();   // wall clock — performance.now() is virtual in headless
  const onError = (m) => { e.status = 'error'; e.error = String(m); emit(); finish(e.error); };
  try {
    if (name === 'kokoro') {
      configureAssets(p);
      bro.tts.loadKokoro(dir, {
        onReady: (k) => {
          e.model = k;
          e.voices = listKokoroVoices(dir);
          e.loadMs = Date.now() - t0;
          e.status = 'ready';
          setKokoroVoice(settings.kokoroVoice);
          emit(); finish(null);
        },
        onError,
      });
    } else {
      bro.tts.loadQwen(dir, {
        onReady: (q) => {
          e.model = q;
          try { e.speakers = q.speakers() || []; } catch (ex) { e.speakers = []; }
          if (!settings.qwenSpeaker && e.speakers.length) settings.qwenSpeaker = e.speakers[0];
          e.loadMs = Date.now() - t0;
          e.status = 'ready';
          emit(); finish(null);
        },
        onError,
      });
    }
  } catch (err) { onError(err.message); }
}

// ── Kokoro voice selection ───────────────────────────────────────────────────
// Voice embeddings are tiny; keep every one we've loaded.
export function setKokoroVoice(name) {
  const e = engines.kokoro;
  if (!e.model) return false;
  if (!name || e.voices.indexOf(name) < 0)
    name = e.voices.indexOf('af_heart') >= 0 ? 'af_heart' : e.voices[0];
  if (!name) { e.error = 'no voices found in ' + e.dir + '/voices'; emit(); return false; }
  if (e.voiceName === name && e.voice) return true;
  try {
    if (!e.voiceCache[name]) e.voiceCache[name] = e.model.loadVoice(e.dir + '/voices/' + name + '.bin');
    e.voice = e.voiceCache[name];
    e.voiceName = name;
    emit();
    return true;
  } catch (err) { e.error = 'voice ' + name + ': ' + err.message; emit(); return false; }
}

// One-line status for the badge.
export function statusText(name) {
  const e = engines[name];
  if (e.status === 'idle') return ENGINE_LABEL[name] + ' · not loaded';
  if (e.status === 'loading') return 'loading ' + ENGINE_LABEL[name] + '…';
  if (e.status === 'error') return e.error;
  const extra = name === 'kokoro' ? e.voices.length + ' voices' : e.speakers.length + ' speakers';
  return ENGINE_LABEL[name] + ' ready · ' + extra + ' · ' + (e.loadMs / 1000).toFixed(1) + 's load · ' + gpuBackend();
}
