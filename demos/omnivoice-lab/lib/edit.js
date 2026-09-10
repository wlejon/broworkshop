// ═══ edit — re-roll: inpaint the grid through generateCodes' init ═════════════
// An init grid is the whole seam: `tokens` = the take's codes, `keep[i]` = 1
// where the cell stays, 0 where it starts masked. The schedule then only has
// the masked cells to fill (they are excluded from total_masked, so the step
// sizes shrink with the mask), conditioned on the kept ones through the
// bidirectional attention — the kept cells are context, not just pass-through.
import { $, omni, busy, NQ, current } from "/app/lib/state.js";
import { setBadge } from "/app/lib/helpers.js";
import { rerollMask, rerollSeed, sel, cbs } from "/app/lib/grid.js";
import { currentParams } from "/app/lib/schedule.js";
import { mkTake, addTake } from "/app/lib/takes.js";
import { makeRecorder, startOp, endOp, setInflight, snapshotParams } from "/app/lib/synth.js";
import { beginLive, liveDone } from "/app/lib/render.js";

// preset: 'acoustics' | 'span' | 'around'; seedOverride for tests / scripts.
export function reroll(preset, seedOverride) {
  if (!omni || busy) return null;
  const take = current;
  if (!take || !take.codes) { setBadge('load a take into the grid first', true); return null; }
  const { mask, why } = rerollMask(preset);
  if (!mask) { setBadge('re-roll: ' + why, true); return null; }
  const T = take.numFrames, n = NQ * T;
  const keep = new Uint8Array(n);
  let masked = 0;
  for (let i = 0; i < n; i++) { keep[i] = mask[i] ? 0 : 1; masked += mask[i]; }
  if (!masked) { setBadge('re-roll: nothing is masked', true); return null; }
  const seed = seedOverride != null ? (seedOverride | 0) : rerollSeed();
  const params = currentParams();
  params.seed = seed;
  const cond = take.cond || {};
  const opts = Object.assign({}, params, { frames: T, trace: true, init: { tokens: take.codes, keep } });
  if (cond.prompt) opts.prompt = cond.prompt;
  if (cond.language) opts.language = cond.language;
  if (cond.instruct) opts.instruct = cond.instruct;
  opts.denoise = cond.denoise !== false;
  const rec = makeRecorder(keep);
  opts.onStep = rec.onStep;
  const t0 = Date.now();
  const label = preset === 'acoustics' ? 're-roll acoustics (q1–q7)' :
                preset === 'span' ? 're-roll span ' + sel.t0 + '–' + sel.t1 : 're-roll around span ' + sel.t0 + '–' + sel.t1;
  startOp(label + ' · ' + masked + ' of ' + n + ' cells masked · seed ' + seed + '…');
  beginLive(T, params.numSteps, label, keep);
  opts.onDone = (r, info) => {
    endOp();
    if (info.error) { setBadge('re-roll: ' + info.error, true); liveDone(); return; }
    if (info.cancelled) { $('#run-meta').textContent = 'cancelled'; liveDone(); return; }
    let dec; const tc = Date.now();
    try { dec = omni.decodeCodes(r.codes, r.numFrames); } catch (e) { setBadge('decodeCodes: ' + e.message, true); liveDone(); return; }
    const codecSeconds = (Date.now() - tc) / 1000;
    // which positions changed (and, as a check on the seam, none outside the mask)
    const changed = new Uint8Array(n);
    let nChanged = 0, leaked = 0;
    for (let i = 0; i < n; i++) {
      if (r.codes[i] !== take.codes[i]) { changed[i] = 1; nChanged++; if (!mask[i]) leaked++; }
    }
    const fin = rec.finish();
    const out = mkTake({
      kind: 'reroll', text: take.text, codes: r.codes, numFrames: r.numFrames, samples: dec.samples, sampleRate: dec.sampleRate,
      unmaskStep: r.trace ? r.trace.unmaskStep : fin.unmask, commitScore: fin.score, stepStats: fin.stepStats,
      params: snapshotParams(Object.assign({ frames: T }, opts)), cond, promptName: take.promptName,
      changed, masked: mask, parentId: take.id, preset, segments: take.segments,
      lmSeconds: r.trace ? r.trace.lmSeconds : 0, codecSeconds, wallMs: Date.now() - t0, exact: true,
      rerollInfo: { masked, changed: nChanged, leaked, seed, preset,
                    span: sel ? { t0: sel.t0, t1: sel.t1 } : null, codebooks: cbs.slice() },
    });
    addTake(out, true);
    setBadge('re-rolled · ' + nChanged + ' of ' + masked + ' masked cells changed' + (leaked ? ' · ' + leaked + ' LEAKED outside the mask' : ' · none outside the mask'));
  };
  try { setInflight(omni.generateCodes(take.text, opts)); }
  catch (e) { endOp(); liveDone(); setBadge('generateCodes: ' + e.message, true); return null; }
  return true;
}
