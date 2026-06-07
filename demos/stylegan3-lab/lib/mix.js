// ═══ Mix — style mixing across the W+ layer stack ═════════════════════════════
// W+ is (numWs × wDim), one row per synthesis layer. The coarse rows govern
// pose/shape, the fine rows govern color/texture. Take rows [0,k) from source A
// and [k,numWs) from source B: A's structure wearing B's style. k is the
// crossover layer.

function syncMixLabel() {
  const k = parseInt($('#mix-k').value, 10);
  $('#mix-k-val').textContent = k;
}

function prepareMix() {
  if (!gan) return;
  const a = parseInt($('#mix-a').value, 10) || 0, b = parseInt($('#mix-b').value, 10) || 0;
  const psi = curPsi(), cutoff = curCutoff();
  runSeq('mix sources',
    [buildW(a, psi, cutoff), buildW(b, psi, cutoff)],
    function (i, r) {
      if (i === 0) { mixWA = r.w; drawBitmap($('#mix-a-canvas'), r.image); }
      else         { mixWB = r.w; drawBitmap($('#mix-b-canvas'), r.image); }
    },
    function () { renderMix(); });
}

function renderMix() {
  if (!gan || !mixWA || !mixWB) return;
  const k = parseInt($('#mix-k').value, 10);
  const w = mixW(mixWA, mixWB, k, META.numWs, META.wDim);
  runOne('mix', buildSynth(w), function (r) {
    drawBitmap($('#mix-result'), r.image);
    $('#mix-meta').textContent = k <= 0
      ? 'all rows from B'
      : k >= META.numWs
        ? 'all rows from A'
        : 'coarse 0–' + (k - 1) + ' from A · fine ' + k + '–' + (META.numWs - 1) + ' from B';
  });
}
