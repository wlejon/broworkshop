// ═══ checkpoint discovery + load, adapting the UI to the generator's shape ═══

import { $, S, wCache } from "/app/lib/state.js";
import { recall, pExists, remember } from "/app/lib/helpers.js";
import { cancelAll, setBadge } from "/app/lib/engine.js";
import { syncMixLabel } from "/app/lib/mix.js";
import { syncCutoffLabel, refreshSeam } from "/app/lib/seams.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";

/** Converted checkpoints brovisionml/scripts/download-stylegan3.sh produces, in preference order. */
export const CHECKPOINTS = [
  'brovisionml/weights/stylegan3-r-ffhqu-256',
  'brovisionml/weights/stylegan3-t-ffhqu-256',
  'brovisionml/weights/stylegan3-r-afhqv2-512',
];

// Shared generation params (the param bar), read live by every seam.
export function curPsi()    { return parseFloat($('#psi').value); }
export function curCutoff() { return parseInt($('#cutoff').value, 10); }   // -1 = all rows

export function seamHint() {
  return S.seam === 'sample' ? 'pick a seed · ψ truncates toward the mean face'
       : S.seam === 'walk'   ? 'two anchors → drag t, or render the strip'
       : S.seam === 'mix'    ? 'coarse rows from A, fine rows from B'
       : S.seam === 'invert' ? 'image → latent · then → A/B to edit it'
       :                       'click a tile to send it to Sample';
}

/** The checkpoint to open at boot: the last one used if still present, else the first found. */
export function defaultModelDir() {
  const last = recall('sg3.modelDir');
  if (last && pExists(last + '/model.safetensors')) return last;
  return findWeights(CHECKPOINTS, { probe: 'model.safetensors' }) || '';
}

// Released checkpoint names carry the config family and resolution
// (stylegan3-{r,t}-<data>-<res>). The binding needs both to match, so trust
// the directory name when it says so; otherwise honour the dropdowns.
function syncConfigFromName(dir) {
  const name = dir.replace(/^.*[\\\/]/, '');
  const v = /stylegan3-([rt])-/i.exec(name);
  if (v) $('#variant').value = v[1].toLowerCase();
  const res = /-(256|512|1024)$/.exec(name);
  if (res) $('#resolution').value = res[1];
}

let loadSeq = 0;                                  // a newer request supersedes an older one

// Load a checkpoint and adapt the UI to its shape. loadStyleGAN3 is
// synchronous (docs/vision-api.js: it returns the generator and takes no
// onReady), so the load runs one tick later, after the status has painted,
// and only if no newer request arrived in between.
/** Fill the device selector with the backends registered at run time
 *  (bro.gpu.devices, e.g. ['cpu', 'metal']), the default device selected. */
export function populateDevices() {
  const sel = $('#device');
  const gpu = (typeof bro !== 'undefined' && bro.gpu) || null;
  const devs = gpu && gpu.devices && gpu.devices.length ? gpu.devices.slice() : ['cpu'];
  const def = gpu && gpu.backend ? gpu.backend : 'cpu';
  devs.sort((a, b) => (a === 'cpu') - (b === 'cpu'));   // GPU backends first
  sel.textContent = '';
  for (const d of devs) {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    if (d === def) o.selected = true;
    sel.appendChild(o);
  }
  sel.value = def;
}

export function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  const seq = ++loadSeq;
  cancelAll();
  S.gan = null; S.lastSample = null; S.walkWA = S.walkWB = S.mixWA = S.mixWB = null;
  S.pinnedA = S.pinnedB = null; S.invTargetData = null; S.invW = null; S.invCurve = [];
  wCache.clear();
  if (!dir) { setBadge(missingWeights('StyleGAN3 checkpoint', CHECKPOINTS), true); return; }
  if (!pExists(dir + '/model.safetensors')) { setBadge('no model.safetensors in ' + dir, true); return; }
  syncConfigFromName(dir);
  const res = parseInt($('#resolution').value, 10) || 256;
  const variant = $('#variant').value || 'r';
  const device = $('#device').value || undefined;   // undefined: the loader picks the best device
  $('#model-meta').textContent = '';
  setBadge('loading ' + dir.replace(/^.*[\\\/]/, '') + '…');
  setTimeout(function () {
    if (seq !== loadSeq) return;                  // superseded before it started
    let g;
    try { g = bro.vision.loadStyleGAN3(dir, { resolution: res, variant: variant, device: device }); }
    catch (e) { setBadge('load failed: ' + e.message, true); return; }
    S.gan = g; remember('sg3.modelDir', dir);
    S.META = { resolution: g.resolution, variant: g.variant, zDim: g.zDim, numWs: g.numWs, wDim: g.wDim, device: g.device };
    $('#model-meta').textContent =
      g.resolution + '² · ' + (g.variant === 't' ? 'config-T' : 'config-R') + ' · ' +
      g.device + ' · z' + g.zDim + ' · w ' + g.numWs + '×' + g.wDim;
    onModelReady();
    setBadge('ready · ' + seamHint());
  }, 30);
}

// Once the generator's numWs is known, size the row-indexed controls (the
// truncation cutoff and the style-mix crossover), then render the active seam.
export function onModelReady() {
  const n = S.META.numWs;
  const cut = $('#cutoff'); cut.max = n; if (curCutoff() > n) cut.value = -1; syncCutoffLabel();
  const k = $('#mix-k'); k.max = n; if (parseInt(k.value, 10) > n) k.value = Math.floor(n / 2); syncMixLabel();
  refreshSeam();
}
