import { $, basis, putBasis, putBridge, putCoords, putKokoro, putSpkEnc, putVoice } from "/app/lib/state.js";
import { detectSource, loadBasis, loadEmotionBasis, loadMascFemBasis, paths, rememberRoot, setSource } from "/app/lib/source.js";
import { buildSliders, seedFrom } from "/app/lib/designer.js";
import { buildTimbre } from "/app/lib/timbre.js";
import { buildMascFem } from "/app/lib/mascfem.js";

// ═══ load ══════════════════════════════════════════════════════════════════
export function setBadge(text, err) {
  const b = $('#backend');
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

export function reload() {
  putKokoro(null); putVoice(null);
  $('#btn-run').disabled = true;
  $('#btn-play').disabled = true;
  $('#btn-save').disabled = true;
  setBadge('loading model…');
  try {
    paths.configureAssets();
    bro.tts.loadKokoro(paths.model, {
      onReady: (k) => { putKokoro(k); setBadge('ready · drag a slider to hear & watch it take shape'); seedFrom($('#source').value, false); },
      onError: (m) => setBadge('model error: ' + m, true),
    });
  } catch (e) {
    setBadge('load failed: ' + e.message, true);
  }
}

// (Re)adopt a data source end-to-end: detect its layout, reload the PCA basis +
// sliders + clone adapters from it, then reload the Kokoro model. This is the
// one entry point for "the source changed" — browse, a typed path + Reload, or
// first load all route through here.
export function switchSource(root) {
  setSource(root);
  if (detectSource(root)) rememberRoot(paths.root);   // a real source — remember it
  putBridge(null); putSpkEnc(null);          // clone adapters are per-source
  putBasis(null); putCoords(null);
  loadBasis();
  loadEmotionBasis();                    // Tier-1 timbre directions (optional)
  loadMascFemBasis();                    // masc↔fem voice-design axis (optional)
  populateSources();
  if (basis) buildSliders();
  buildTimbre();                         // (re)build / hide the timbre panel for this source
  buildMascFem();                        // (re)build / hide the masc↔fem panel
  reload();                              // configures assets + loads the model, then seeds
}

// Fill the seed dropdown from the current basis' named anchors (+ neutral).
export function populateSources() {
  const src = $('#source');
  src.textContent = '';
  if (!basis) return;
  const neu = document.createElement('option');
  neu.value = '__neutral__'; neu.textContent = 'neutral (centroid)';
  src.appendChild(neu);
  for (const n of basis.names) {
    const o = document.createElement('option'); o.value = n; o.textContent = n; src.appendChild(o);
  }
  if (basis.names.indexOf('af_heart') >= 0) src.value = 'af_heart';
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

