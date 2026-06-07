// ═══ Sample — z(seed) → image, the unit of generation ════════════════════════

function renderSample() {
  if (!gan) return;
  const seed = parseInt($('#seed').value, 10) || 0;
  const psi = curPsi(), cutoff = curCutoff();
  runOne('sample', buildW(seed, psi, cutoff), function (r) {
    drawBitmap($('#sample-canvas'), r.image);
    lastSample = { seed: seed, w: r.w };
    $('#sample-meta').textContent =
      'seed ' + seed + ' · ψ ' + psi.toFixed(2) + (cutoff >= 0 ? ' · cutoff ' + cutoff : ' · cutoff all');
  });
}

// Push the on-screen sample's seed into the Walk/Mix A or B anchor.
function sendSampleTo(which) {
  const seed = lastSample ? lastSample.seed : (parseInt($('#seed').value, 10) || 0);
  $('#walk-' + which).value = seed;
  $('#mix-' + which).value = seed;
  setBadge('seed ' + seed + ' → ' + which.toUpperCase() + ' (Walk + Mix)');
}
