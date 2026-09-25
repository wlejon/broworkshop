// ═══ model — resolve the model dir, gate on the GPU, load, hand the vocabulary
// to the panels ═══════════════════════════════════════════════════════════════
import { $, omni, setOmni, setBusy } from "/app/lib/state.js";
import { setBadge, pExists, pParent, recall, remember } from "/app/lib/helpers.js";
import { resolved } from "../../../ai/voice-pipeline/models.js";
import { weightPath } from "/lib/kit/weights.js";
import { buildVoicePanel } from "/app/lib/voice.js";
import { buildTextPanel } from "/app/lib/text.js";
import { updateEstimate } from "/app/lib/schedule.js";
import { cancel } from "/app/lib/synth.js";

// The app-owned model catalog resolves the dev sibling first, then the shared
// per-user download cache (ai/voice-pipeline/models.js, group 'omnivoice').
function catalogDir(key) {
  try { return resolved()[key] || ''; } catch (e) { return ''; }
}

// Probe a sensible model dir for this machine: remembered > catalog > the
// field's value. The catalog already covers BRO_WEIGHTS, the dev sibling found
// from the app's own path, and the per-user download cache. With nothing on
// disk the field shows where the dev sibling would be.
export function defaultModelDir(htmlDefault) {
  const cands = [
    recall('omnivoice-lab.modelDir'),
    catalogDir('omniDir'),
    htmlDefault,
  ].filter(Boolean);
  for (const c of cands) if (pExists(c + '/config.json') && pExists(c + '/model.safetensors')) return c;
  return recall('omnivoice-lab.modelDir') || htmlDefault || weightPath('brosoundml/weights/omnivoice');
}

// Whisper (for transcribing a reference clip) lives beside OmniVoice in the
// weights root; the catalog's stt group resolves it too.
export function whisperDir() {
  const cands = [catalogDir('whisperDir'), pParent($('#model-dir').value.trim()) + '/whisper'];
  for (const c of cands) if (c && pExists(c + '/model.safetensors')) return c;
  return '';
}

export function gpuOk() { return !!(typeof bro !== 'undefined' && bro.gpu && bro.gpu.available); }

export function transport(enabled) {
  $('#btn-generate').disabled = !enabled;
  $('#btn-pipeline').disabled = !enabled;
}

// Load asynchronously; build every model-derived panel once ready.
export function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  cancel();
  if (omni) { try { omni.unload(); } catch (e) {} }
  setOmni(null); setBusy(false);
  transport(false);
  $('#model-meta').textContent = '';
  const backend = gpuOk() ? bro.gpu.backend : 'cpu';
  $('#gpu-meta').textContent = 'backend ' + String(backend).toUpperCase();
  if (!pExists(dir + '/config.json')) { setBadge('no config.json in ' + dir, true); return; }
  if (!gpuOk()) {
    // Every diffusion step is a full 0.6B forward: the LM is GPU-only here.
    setBadge('no GPU backend (' + backend + ') — OmniVoice\'s LM runs on the GPU only; not loading', true);
    return;
  }
  setBadge('loading OmniVoice (bf16)…');
  try {
    bro.tts.loadOmniVoice(dir, {
      precision: 'bf16',
      onReady: (o) => {
        setOmni(o); remember('omnivoice-lab.modelDir', dir);
        const c = o.config;
        $('#model-meta').textContent = o.device + ' · ' + o.precision + ' · ' + c.numLayers + ' layers · ' +
          c.numCodebooks + ' codebooks × ' + c.audioVocabSize + ' · ' + c.frameRate + ' fps · ' + (c.sampleRate / 1000) + ' kHz';
        buildVoicePanel();
        buildTextPanel();
        updateEstimate();
        transport(true);
        setBadge('ready · ' + o.device + ' ' + o.precision);
      },
      onError: (m) => setBadge('load failed: ' + m, true),
    });
  } catch (e) { setBadge('load failed: ' + e.message, true); }
}
