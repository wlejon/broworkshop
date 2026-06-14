// ═══ Walk — interpolation in W+ space between two anchor seeds ═════════════════
// Map both anchors to w+ once, then synthesize() the t-blend live as the slider
// drags. The strip renders N evenly spaced points across t in one sequence.

import { $, S } from "/app/lib/state.js";
import { curPsi, curCutoff } from "/app/lib/model.js";
import { runSeq, runOne, buildW, buildSynth } from "/app/lib/engine.js";
import { drawBitmap, lerpW } from "/app/lib/helpers.js";

// An anchor step: a pinned (inverted) latent synthesizes directly; otherwise the
// seed maps to a fresh w+ (cached). Either way onStep gets an { image, w }.
export function anchorStep(pin, seed, psi, cutoff) {
  if (pin) return function (onDone) {
    return S.gan.synthesize(pin, { onDone: function (r, info) {
      if (r) r.w = pin;                    // carry the latent through like buildW does
      onDone(r, info);
    } });
  };
  return buildW(seed, psi, cutoff);
}

// Fetch (or reuse) both anchors' w+, draw the endpoint thumbs, then the midpoint.
export function prepareWalk() {
  if (!S.gan) return;
  const a = parseInt($('#walk-a').value, 10) || 0, b = parseInt($('#walk-b').value, 10) || 0;
  const psi = curPsi(), cutoff = curCutoff();
  runSeq('walk anchors',
    [anchorStep(S.pinnedA, a, psi, cutoff), anchorStep(S.pinnedB, b, psi, cutoff)],
    function (i, r) {
      if (i === 0) { S.walkWA = r.w; drawBitmap($('#walk-a-canvas'), r.image); }
      else         { S.walkWB = r.w; drawBitmap($('#walk-b-canvas'), r.image); }
    },
    function () { renderWalkMid(); });
}

// The live midpoint at the current t — a single synthesize of the W+ blend.
export function renderWalkMid() {
  if (!S.gan || !S.walkWA || !S.walkWB) return;
  const t = parseFloat($('#walk-t').value);
  runOne('interpolate', buildSynth(lerpW(S.walkWA, S.walkWB, t)), function (r) {
    drawBitmap($('#walk-mid'), r.image);
    $('#walk-meta').textContent = 't = ' + t.toFixed(2) + '  (A ' + (1 - t).toFixed(2) + ' · B ' + t.toFixed(2) + ')';
  });
}

// A row of N frames evenly spaced across t ∈ [0,1].
export function renderWalkStrip() {
  if (!S.gan || !S.walkWA || !S.walkWB) return;
  const n = parseInt($('#walk-steps').value, 10) || 7;
  const row = $('#walk-strip'); row.textContent = '';
  const cells = [];
  for (let k = 0; k < n; k++) {
    const cv = document.createElement('canvas');
    cv.className = 'strip-cell';
    row.appendChild(cv);
    cells.push(cv);
  }
  const steps = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    steps.push(buildSynth(lerpW(S.walkWA, S.walkWB, t)));
  }
  runSeq('strip', steps, function (i, r) { drawBitmap(cells[i], r.image); });
}
