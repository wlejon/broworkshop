// ═══ checkpoint load + adapting to the generator's shape ══════════════════════

// Shared generation params (the param bar), read live by every seam.
function curPsi()    { return parseFloat($('#psi').value); }
function curCutoff() { return parseInt($('#cutoff').value, 10); }   // -1 = all rows

function seamHint() {
  return seam === 'sample' ? 'pick a seed · ψ truncates toward the mean face'
       : seam === 'walk'   ? 'two anchors → drag t, or render the strip'
       : seam === 'mix'    ? 'coarse rows from A, fine rows from B'
       : seam === 'invert' ? 'image → latent · then → A/B to edit it'
       :                     'click a tile to send it to Sample';
}

// Probe a sensible default checkpoint for this machine on first run.
function defaultModelDir(htmlDefault) {
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
function loadModel(dir) {
  dir = (dir || '').replace(/[\\\/]+$/, '');
  cancelAll();
  gan = null; lastSample = null; walkWA = walkWB = mixWA = mixWB = null;
  pinnedA = pinnedB = null; invTargetData = null; invW = null; invCurve = [];
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
        gan = g; remember('sg3.modelDir', dir);
        META = { resolution: g.resolution, variant: g.variant, zDim: g.zDim, numWs: g.numWs, wDim: g.wDim, device: g.device };
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
function onModelReady() {
  const n = META.numWs;
  const cut = $('#cutoff'); cut.max = n; if (curCutoff() > n) cut.value = -1; syncCutoffLabel();
  const k = $('#mix-k'); k.max = n; if (parseInt(k.value, 10) > n) k.value = Math.floor(n / 2); syncMixLabel();
  refreshSeam();
}
