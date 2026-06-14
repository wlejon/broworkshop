// ═══ Mix — style mixing across the W+ layer stack ═════════════════════════════
// W+ is (numWs × wDim), one row per synthesis layer. The coarse rows govern
// pose/shape, the fine rows govern color/texture. Take rows [0,k) from source A
// and [k,numWs) from source B: A's structure wearing B's style. k is the
// crossover layer.

import { $, S } from "/app/lib/state.js";
import { curPsi, curCutoff } from "/app/lib/model.js";
import { runSeq, runOne, buildSynth } from "/app/lib/engine.js";
import { drawBitmap, mixW } from "/app/lib/helpers.js";
import { anchorStep } from "/app/lib/walk.js";

export function syncMixLabel() {
  const k = parseInt($('#mix-k').value, 10);
  $('#mix-k-val').textContent = k;
}

export function prepareMix() {
  if (!S.gan) return;
  const a = parseInt($('#mix-a').value, 10) || 0, b = parseInt($('#mix-b').value, 10) || 0;
  const psi = curPsi(), cutoff = curCutoff();
  runSeq('mix sources',
    [anchorStep(S.pinnedA, a, psi, cutoff), anchorStep(S.pinnedB, b, psi, cutoff)],
    function (i, r) {
      if (i === 0) { S.mixWA = r.w; drawBitmap($('#mix-a-canvas'), r.image); }
      else         { S.mixWB = r.w; drawBitmap($('#mix-b-canvas'), r.image); }
    },
    function () { renderMix(); });
}

export function renderMix() {
  if (!S.gan || !S.mixWA || !S.mixWB) return;
  const k = parseInt($('#mix-k').value, 10);
  const w = mixW(S.mixWA, S.mixWB, k, S.META.numWs, S.META.wDim);
  runOne('mix', buildSynth(w), function (r) {
    drawBitmap($('#mix-result'), r.image);
    $('#mix-meta').textContent = k <= 0
      ? 'all rows from B'
      : k >= S.META.numWs
        ? 'all rows from A'
        : 'coarse 0–' + (k - 1) + ' from A · fine ' + k + '–' + (S.META.numWs - 1) + ' from B';
  });
}
