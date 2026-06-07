// ═══ engine — single-owner, latest-wins job queue over generate/synthesize ════
// The model is single-owner: one generate()/synthesize() may be in flight at a
// time, and a second concurrent call throws "generator busy". Crucially,
// cancel() does NOT synchronously free the generator — the background thread is
// still attached until its onDone fires. So we never start a new op while one is
// in flight: we stash the desired job in `pending`, cancel whatever's running,
// and let the cancelled op's onDone start the pending job once the slot is truly
// free. Newest request always wins. (Same shape as the TTS lab's synth.js.)
//
// A "step" is a builder `(onDone) => AsyncHandle`: it kicks one model call and
// returns its handle. A job is an ordered list of steps run one at a time (a
// single image is one step; a Walk strip is N). onStep(i, result) places each
// result; onAll() fires when the whole sequence finishes.

function setBadge(text, err) {
  const b = $('#backend');
  if (!b) return;
  b.textContent = text;
  b.classList.toggle('err', !!err);
}

function runSeq(label, steps, onStep, onAll) {
  if (!gan) return;
  pending = { id: ++seqCounter, label: label, steps: steps, i: 0, onStep: onStep, onAll: onAll };
  kick();
}

// Convenience for the common one-image job.
function runOne(label, build, done) {
  runSeq(label, [build], function (i, r) { if (done) done(r); });
}

// Drop everything (in flight + queued). Used on load/teardown. The cancelled
// op's onDone still fires, but its sequence id won't match, so it's ignored.
function cancelAll() {
  pending = null; curSeq = null;
  if (inflight) { try { inflight.cancel(); } catch (e) {} }
}

// Start the next op — but only when the generator is free. If something is
// running, ask it to stop; its onDone re-enters kick() once the slot frees.
function kick() {
  if (inflight) { try { inflight.cancel(); } catch (e) {} return; }
  if (!pending) return;
  curSeq = pending; pending = null;
  pump();
}

function pump() {
  const s = curSeq;
  if (!s) { kick(); return; }
  if (s.i >= s.steps.length) {                       // sequence complete
    curSeq = null;
    setBadge('ready · ' + seamHint());
    if (s.onAll) s.onAll();
    kick();
    return;
  }
  const i = s.i;
  setBadge(s.steps.length > 1 ? s.label + ' ' + (i + 1) + '/' + s.steps.length + '…'
                             : s.label + '…');
  try {
    inflight = s.steps[i](function (r, info) {
      inflight = null;
      // A newer job arrived while this ran: abandon this sequence, start it.
      if (pending) { curSeq = null; kick(); return; }
      // Stale callback from a superseded/cancelled sequence.
      if (!curSeq || curSeq.id !== s.id) { kick(); return; }
      if (info && info.error)     { setBadge(s.label + ': ' + info.error, true); curSeq = null; kick(); return; }
      if (info && info.cancelled) { curSeq = null; kick(); return; }
      try { s.onStep(i, r); }
      catch (e) { setBadge(s.label + ': ' + e.message, true); curSeq = null; kick(); return; }
      s.i++;
      pump();
    });
  } catch (e) {
    inflight = null; curSeq = null;
    setBadge(s.label + ': ' + e.message, true);
    kick();
  }
}

// ── step builders ─────────────────────────────────────────────────────────────

// z(seed) → image + mapped w+ (cached). Used wherever a panel needs the latent.
function buildW(seed, psi, cutoff) {
  return function (onDone) {
    return gan.generate({
      seed: seed, truncation: psi, truncationCutoff: cutoff, returnLatents: true,
      onDone: function (r, info) {
        if (info && !info.error && !info.cancelled && r && r.w) {
          wCache.set(wKey(seed, psi, cutoff), r.w);
        }
        onDone(r, info);
      },
    });
  };
}

// z(seed) → image only (no latents) — the Grid path, where we never reuse the w+.
function buildImg(seed, psi, cutoff) {
  return function (onDone) {
    return gan.generate({ seed: seed, truncation: psi, truncationCutoff: cutoff, onDone: onDone });
  };
}

// an explicit/edited w+ → image — the Walk/Mix render path.
function buildSynth(w) {
  return function (onDone) { return gan.synthesize(w, { onDone: onDone }); };
}
