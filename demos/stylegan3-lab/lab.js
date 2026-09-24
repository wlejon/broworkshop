// StyleGAN3 Lab — DOM wiring and the first model load. The seams, the job
// queue and the model live under lib/ (see lib/state.js for the map).

import { boot } from "/lib/kit/app.js";
import { $, S } from "/app/lib/state.js";
import { curPsi, loadModel, defaultModelDir } from "/app/lib/model.js";
import { initSeams, showSeam, refreshSeam, syncCutoffLabel } from "/app/lib/seams.js";
import { renderSample, sendSampleTo } from "/app/lib/sample.js";
import { prepareWalk, renderWalkMid, renderWalkStrip } from "/app/lib/walk.js";
import { prepareMix, renderMix, syncMixLabel } from "/app/lib/mix.js";
import { invFromSeed, invFromFile, runInvert, sendInvTo } from "/app/lib/invert.js";
import { renderGrid, gridPage, onGridClick } from "/app/lib/grid.js";
import { browseFolder, pParent, randSeed } from "/app/lib/helpers.js";

const on = (sel, ev, fn) => $(sel).addEventListener(ev, fn);
const reload = () => loadModel($('#model-dir').value.trim());

// A shared-param change invalidates the cached anchors and re-renders.
function paramsChanged() { S.walkWA = S.walkWB = S.mixWA = S.mixWB = null; refreshSeam(); }

// Choosing a seed for an anchor drops any pinned (inverted) latent on it.
function reseed(which, seam, randomize) {
  const input = '#' + seam + '-' + which;
  if (randomize) $(input).value = randSeed();
  if (which === 'a') S.pinnedA = null; else S.pinnedB = null;
  if (seam === 'walk') { if (which === 'a') S.walkWA = null; else S.walkWB = null; prepareWalk(); }
  else { if (which === 'a') S.mixWA = null; else S.mixWB = null; prepareMix(); }
}

export function init() {
  S.status = boot().status;

  // ── checkpoint bar ──
  on('#btn-browse-model', 'click', function () {
    const d = browseFolder(pParent($('#model-dir').value.trim()));
    if (d) { $('#model-dir').value = d; loadModel(d); }
  });
  on('#model-dir', 'change', reload);
  on('#resolution', 'change', reload);
  on('#variant', 'change', reload);
  on('#device', 'change', reload);
  on('#btn-reload', 'click', reload);

  // ── shared params ──
  on('#psi', 'input', function () { $('#psi-val').textContent = curPsi().toFixed(2); });
  on('#psi', 'change', paramsChanged);
  on('#cutoff', 'input', syncCutoffLabel);
  on('#cutoff', 'change', paramsChanged);

  // ── Sample ──
  on('#btn-render', 'click', renderSample);
  on('#seed', 'change', renderSample);
  on('#btn-rand-seed', 'click', function () { $('#seed').value = randSeed(); renderSample(); });
  on('#btn-to-a', 'click', function () { sendSampleTo('a'); });
  on('#btn-to-b', 'click', function () { sendSampleTo('b'); });

  // ── Walk ──
  on('#walk-a', 'change', function () { reseed('a', 'walk'); });
  on('#walk-b', 'change', function () { reseed('b', 'walk'); });
  on('#btn-walk-rand-a', 'click', function () { reseed('a', 'walk', true); });
  on('#btn-walk-rand-b', 'click', function () { reseed('b', 'walk', true); });
  on('#walk-t', 'input', renderWalkMid);
  on('#btn-walk-strip', 'click', renderWalkStrip);

  // ── Mix ──
  on('#mix-a', 'change', function () { reseed('a', 'mix'); });
  on('#mix-b', 'change', function () { reseed('b', 'mix'); });
  on('#btn-mix-rand-a', 'click', function () { reseed('a', 'mix', true); });
  on('#btn-mix-rand-b', 'click', function () { reseed('b', 'mix', true); });
  on('#mix-k', 'input', function () { syncMixLabel(); renderMix(); });

  // ── Invert ──
  on('#btn-inv-from-seed', 'click', invFromSeed);
  on('#btn-inv-from-file', 'click', invFromFile);
  on('#btn-invert', 'click', runInvert);
  on('#btn-inv-to-a', 'click', function () { sendInvTo('a'); });
  on('#btn-inv-to-b', 'click', function () { sendInvTo('b'); });

  // ── Grid ──
  on('#grid-size', 'change', renderGrid);
  on('#grid-base', 'change', renderGrid);
  on('#btn-grid-regen', 'click', renderGrid);
  on('#btn-grid-prev', 'click', function () { gridPage(-1); });
  on('#btn-grid-next', 'click', function () { gridPage(1); });
  on('#grid-out', 'click', onGridClick);

  $('#psi-val').textContent = curPsi().toFixed(2);
  syncCutoffLabel();
  syncMixLabel();
  initSeams();
  showSeam('sample');

  const dir = defaultModelDir();
  $('#model-dir').value = dir;
  loadModel(dir);
}
