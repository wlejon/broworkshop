// ═══ Sample — z(seed) → image, the unit of generation ════════════════════════

import { $, S } from "/app/lib/state.js";
import { curPsi, curCutoff } from "/app/lib/model.js";
import { runOne, buildW, setBadge } from "/app/lib/engine.js";
import { drawBitmap } from "/app/lib/helpers.js";

export function renderSample() {
  if (!S.gan) return;
  const seed = parseInt($('#seed').value, 10) || 0;
  const psi = curPsi(), cutoff = curCutoff();
  runOne('sample', buildW(seed, psi, cutoff), function (r) {
    drawBitmap($('#sample-canvas'), r.image);
    S.lastSample = { seed: seed, w: r.w };
    $('#sample-meta').textContent =
      'seed ' + seed + ' · ψ ' + psi.toFixed(2) + (cutoff >= 0 ? ' · cutoff ' + cutoff : ' · cutoff all');
  });
}

// Push the on-screen sample's seed into the Walk/Mix A or B anchor.
export function sendSampleTo(which) {
  const seed = S.lastSample ? S.lastSample.seed : (parseInt($('#seed').value, 10) || 0);
  $('#walk-' + which).value = seed;
  $('#mix-' + which).value = seed;
  setBadge('seed ' + seed + ' → ' + which.toUpperCase() + ' (Walk + Mix)');
}
