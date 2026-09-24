// ═══ seam switching: the tab bar, re-rendering the active seam ═══════════════

import { $, S } from "/app/lib/state.js";
import { tabs } from "/lib/kit/ui.js";
import { curCutoff } from "/app/lib/model.js";
import { renderSample } from "/app/lib/sample.js";
import { prepareWalk } from "/app/lib/walk.js";
import { prepareMix } from "/app/lib/mix.js";
import { refreshInvert } from "/app/lib/invert.js";
import { renderGrid } from "/app/lib/grid.js";

let bar = null;

/** Build the seam tab bar (#seams); each switch re-renders the new seam. */
export function initSeams() {
  bar = tabs('#seams', { onChange: function (name) { S.seam = name; refreshSeam(); } });
}

/** Show exactly one seam panel and refresh it for the loaded model. */
export function showSeam(name) {
  if (bar) bar.select(name);
  else { S.seam = name; refreshSeam(); }
}

/** Re-run the active seam (after a seam switch or a shared-param change). */
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
