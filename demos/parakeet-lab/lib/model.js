// ═══ model load + dialogs ════════════════════════════════════════════════════

import { $ } from "/app/lib/state.js";
import { srcSamples } from "/app/lib/transcribe.js";

export let model = null;            // the loaded bro.stt Parakeet handle
export let tok = null;              // the loaded ParakeetTokenizer (SentencePiece)

export function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

const _fs = (typeof require === 'function') ? require('fs') : null;
const _os = (typeof require === 'function') ? require('os') : null;
export function fileExists(p) { try { return !!_fs && _fs.existsSync(p); } catch (e) { return false; } }

function remember(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function recall(key)        { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

// Probe the usual spots for a Parakeet checkpoint so the field is pre-filled.
export function defaultModelDir(current) {
  const home = _os ? _os.homedir().replace(/\\/g, '/') : '';
  const cands = [
    current,
    recall('parakeet-lab.modelDir'),
    home && home + '/projects/brosoundml/weights/parakeet/0.6b-v3',
    'D:/projects/brosoundml/weights/parakeet/0.6b-v3',
    '../brosoundml/weights/parakeet/0.6b-v3',
  ].filter(Boolean);
  for (const d of cands) if (fileExists(d + '/config.json')) return d;
  return cands.find(Boolean) || '';
}

// Native dialogs, defensively gated (absent in headless / GPU-less builds).
export function browseFolder(start) {
  if (typeof showOpenFolderDialog !== 'function') { setBadge('folder dialog unavailable in this build', true); return null; }
  const r = showOpenFolderDialog(start || null);
  return r && r.length ? r[0] : null;
}
export function browseFile(filter) {
  if (typeof showOpenFileDialog !== 'function') { setBadge('file dialog unavailable in this build', true); return null; }
  const r = showOpenFileDialog(filter || '');
  return r && r.length ? r[0] : null;
}

// Load the model and its SentencePiece tokenizer in parallel (both async, so
// the UI stays live during the ~2.4 GB weight upload).
export function loadModel(dir) {
  dir = (dir || '').trim().replace(/[\\\/]+$/, '');
  if (!dir) { setBadge('pick a model directory', true); return; }
  if (!fileExists(dir + '/config.json')) { setBadge('no config.json in ' + dir, true); return; }
  model = null;
  tok = null;
  $('#model-meta').textContent = '';
  $('#btn-transcribe').disabled = true;
  setBadge('loading model…');

  const maybeReady = () => {
    if (!model || !tok) return;
    remember('parakeet-lab.modelDir', dir);
    $('#model-meta').textContent =
      `${model.sampleRate / 1000} kHz · vocab ${model.vocabSize} · ` +
      `${(model.frameSeconds * 1000).toFixed(0)} ms/frame · ${tok.vocabCount} pieces`;
    $('#btn-transcribe').disabled = !srcSamples;
    setBadge('ready · record or load a file');
  };

  try {
    bro.stt.loadParakeet(dir, {
      onReady: (m) => { model = m; maybeReady(); },
      onError: (e) => setBadge('model error: ' + e, true),
    });
    bro.stt.loadParakeetTokenizer(dir + '/tokenizer.json', {
      onReady: (t) => { tok = t; maybeReady(); },
      onError: (e) => setBadge('tokenizer error: ' + e, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}
