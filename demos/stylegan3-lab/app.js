// StyleGAN3 Lab — entry point: wire the DOM, switch seams, kick the first load.

import { $, S } from "/app/lib/state.js";
import { curPsi, curCutoff, loadModel, defaultModelDir } from "/app/lib/model.js";
import { renderSample, sendSampleTo } from "/app/lib/sample.js";
import { prepareWalk, renderWalkMid, renderWalkStrip } from "/app/lib/walk.js";
import { prepareMix, renderMix, syncMixLabel } from "/app/lib/mix.js";
import { refreshInvert, invFromSeed, invFromFile, runInvert, sendInvTo } from "/app/lib/invert.js";
import { renderGrid, gridPage, onGridClick } from "/app/lib/grid.js";
import { browseFolder, pParent, randSeed } from "/app/lib/helpers.js";

// Show exactly one seam panel; refresh it for the loaded model.
export function showSeam(name) {
  S.seam = name;
  ['sample', 'walk', 'mix', 'invert', 'grid'].forEach(function (s) {
    $('#panel-' + s).style.display = (s === name) ? 'flex' : 'none';
    $('#seam-' + s).classList.toggle('active', s === name);
  });
  refreshSeam();
}

// Re-run the active seam (after a seam switch or a shared-param change).
export function refreshSeam() {
  if (!S.gan) return;
  if (S.seam === 'sample')      renderSample();
  else if (S.seam === 'walk')   prepareWalk();
  else if (S.seam === 'mix')    prepareMix();
  else if (S.seam === 'invert') refreshInvert();   // never auto-runs the (slow) inversion
  else                          renderGrid();
}

export function syncCutoffLabel() {
  const v = curCutoff();
  $('#cutoff-val').textContent = v < 0 ? 'all' : v;
}

function init() {
  // ── checkpoint bar ──────────────────────────────────────────────────────────
  $('#btn-browse-model').addEventListener('click', function () {
    const d = browseFolder(pParent($('#model-dir').value.trim()));
    if (d) { $('#model-dir').value = d; loadModel(d); }
  });
  $('#model-dir').addEventListener('change', function () { loadModel($('#model-dir').value.trim()); });
  $('#resolution').addEventListener('change', function () { loadModel($('#model-dir').value.trim()); });
  $('#device').addEventListener('change', function () { loadModel($('#model-dir').value.trim()); });
  $('#btn-reload').addEventListener('click', function () { loadModel($('#model-dir').value.trim()); });

  // ── shared params (ψ + cutoff) — changing either invalidates the cached
  //    anchors and re-renders the active seam ─────────────────────────────────
  $('#psi').addEventListener('input', function () { $('#psi-val').textContent = curPsi().toFixed(2); });
  $('#psi').addEventListener('change', function () {
    S.walkWA = S.walkWB = S.mixWA = S.mixWB = null; refreshSeam();
  });
  $('#cutoff').addEventListener('input', syncCutoffLabel);
  $('#cutoff').addEventListener('change', function () {
    S.walkWA = S.walkWB = S.mixWA = S.mixWB = null; refreshSeam();
  });

  // ── seam chips ──────────────────────────────────────────────────────────────
  ['sample', 'walk', 'mix', 'invert', 'grid'].forEach(function (s) {
    $('#seam-' + s).addEventListener('click', function () { showSeam(s); });
  });

  // ── Sample ────────────────────────────────────────────────────────────────
  $('#btn-render').addEventListener('click', renderSample);
  $('#seed').addEventListener('change', renderSample);
  $('#btn-rand-seed').addEventListener('click', function () { $('#seed').value = randSeed(); renderSample(); });
  $('#btn-to-a').addEventListener('click', function () { sendSampleTo('a'); });
  $('#btn-to-b').addEventListener('click', function () { sendSampleTo('b'); });

  // ── Walk ────────────────────────────────────────────────────────────────────
  // Choosing a seed for an anchor drops any pinned (inverted) latent on it.
  $('#walk-a').addEventListener('change', function () { S.pinnedA = null; S.walkWA = null; prepareWalk(); });
  $('#walk-b').addEventListener('change', function () { S.pinnedB = null; S.walkWB = null; prepareWalk(); });
  $('#btn-walk-rand-a').addEventListener('click', function () { $('#walk-a').value = randSeed(); S.pinnedA = null; S.walkWA = null; prepareWalk(); });
  $('#btn-walk-rand-b').addEventListener('click', function () { $('#walk-b').value = randSeed(); S.pinnedB = null; S.walkWB = null; prepareWalk(); });
  $('#walk-t').addEventListener('input', renderWalkMid);
  $('#btn-walk-strip').addEventListener('click', renderWalkStrip);

  // ── Mix ───────────────────────────────────────────────────────────────────
  $('#mix-a').addEventListener('change', function () { S.pinnedA = null; S.mixWA = null; prepareMix(); });
  $('#mix-b').addEventListener('change', function () { S.pinnedB = null; S.mixWB = null; prepareMix(); });
  $('#btn-mix-rand-a').addEventListener('click', function () { $('#mix-a').value = randSeed(); S.pinnedA = null; S.mixWA = null; prepareMix(); });
  $('#btn-mix-rand-b').addEventListener('click', function () { $('#mix-b').value = randSeed(); S.pinnedB = null; S.mixWB = null; prepareMix(); });
  $('#mix-k').addEventListener('input', function () { syncMixLabel(); renderMix(); });

  // ── Invert ──────────────────────────────────────────────────────────────────
  $('#btn-inv-from-seed').addEventListener('click', invFromSeed);
  $('#btn-inv-from-file').addEventListener('click', invFromFile);
  $('#btn-invert').addEventListener('click', runInvert);
  $('#btn-inv-to-a').addEventListener('click', function () { sendInvTo('a'); });
  $('#btn-inv-to-b').addEventListener('click', function () { sendInvTo('b'); });

  // ── Grid ──────────────────────────────────────────────────────────────────
  $('#grid-size').addEventListener('change', renderGrid);
  $('#grid-base').addEventListener('change', renderGrid);
  $('#btn-grid-regen').addEventListener('click', renderGrid);
  $('#btn-grid-prev').addEventListener('click', function () { gridPage(-1); });
  $('#btn-grid-next').addEventListener('click', function () { gridPage(1); });
  $('#grid-out').addEventListener('click', onGridClick);

  // initial control labels + seam
  $('#psi-val').textContent = curPsi().toFixed(2);
  syncCutoffLabel();
  syncMixLabel();
  showSeam('sample');

  // first load
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  loadModel(dir);
}

init();
