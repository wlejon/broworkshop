// ═══ checkpoint load + adapting to the generator's shape ══════════════════════

import { $, S, wCache } from "/app/lib/state.js";
import { _os, recall, pExists, remember } from "/app/lib/helpers.js";
import { cancelAll, setBadge } from "/app/lib/engine.js";
import { syncMixLabel } from "/app/lib/mix.js";
import { syncCutoffLabel, refreshSeam } from "/app/app.js";

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

// Probe a sensible default checkpoint for this machine on first run.
export function defaultModelDir(htmlDefault) {
  let home = ''; try { home = _os.homedir(); } catch (e) {}
  const cands = [
    recall('sg3.modelDir'),
    htmlDefault,
    home && home + '/projects/brovisionml/weights/stylegan3-r-ffhqu-256',
  ].filter(Boolean);
  for (const c of cands) if (pExists(c + '/model.safetensors')) return c;
  return recall('sg3.modelDir') || htmlDefault;
}

// Load a checkpoint asynchronously; adapt the UI to its shape once ready.
export function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  cancelAll();
  S.gan = null; S.lastSample = null; S.walkWA = S.walkWB = S.mixWA = S.mixWB = null;
  S.pinnedA = S.pinnedB = null; S.invTargetData = null; S.invW = null; S.invCurve = [];
  wCache.clear();
  if (!pExists(dir + '/model.safetensors')) { setBadge('no model.safetensors in ' + dir, true); return; }
  const res = parseInt($('#resolution').value, 10) || 256;
  // The config family is part of the released checkpoint name (stylegan3-{r,t}-…),
  // so trust the directory when it says so; otherwise honor the dropdown.
  const vSel = $('#variant');
  if (/stylegan3-t-/i.test(dir)) vSel.value = 't';
  else if (/stylegan3-r-/i.test(dir)) vSel.value = 'r';
  const variant = vSel.value || 'r';
  const device = $('#device').value || 'cuda';
  $('#model-meta').textContent = '';
  setBadge('loading checkpoint…');
  try {
    bro.vision.loadStyleGAN3(dir, {
      resolution: res, variant: variant, device: device,
      onReady: function (g) {
        S.gan = g; remember('sg3.modelDir', dir);
        S.META = { resolution: g.resolution, variant: g.variant, zDim: g.zDim, numWs: g.numWs, wDim: g.wDim, device: g.device };
        $('#model-meta').textContent =
          g.resolution + '² · ' + (g.variant === 't' ? 'config-T' : 'config-R') + ' · ' +
          g.device + ' · z' + g.zDim + ' · w ' + g.numWs + '×' + g.wDim;
        onModelReady();
        setBadge('ready · ' + seamHint());
      },
      onError: function (m) { setBadge('load failed: ' + m, true); },
    });
  } catch (e) { setBadge('load failed: ' + e.message, true); }
}

// Once the generator's numWs is known, size the row-indexed controls (the
// truncation cutoff and the style-mix crossover), then render the active seam.
export function onModelReady() {
  const n = S.META.numWs;
  const cut = $('#cutoff'); cut.max = n; if (curCutoff() > n) cut.value = -1; syncCutoffLabel();
  const k = $('#mix-k'); k.max = n; if (parseInt(k.value, 10) > n) k.value = Math.floor(n / 2); syncMixLabel();
  refreshSeam();
}
