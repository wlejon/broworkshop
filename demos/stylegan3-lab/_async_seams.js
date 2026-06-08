// Async regression for the multi-image seams (walk anchors + midpoint + strip,
// mix anchors + result). The lab's _smoke.js drives the generator INLINE
// (synchronous) so it can't catch ordering bugs in the async queue. This drives
// the REAL engine.js sequences — each step's onDone synchronously kicks the next,
// and the anchor sequence's onAll() launches the continuation op (midpoint /
// result). Two bugs lived on this path:
//   1. the binding cleared its `busy` flag AFTER the onDone callback, so the
//      chained step 2 threw "generator busy" (the reported symptom); and
//   2. engine.js pump() ran a trailing kick() after onAll(), cancelling the very
//      op onAll() had just started, so the midpoint/result never rendered.
// This guards both: no badge error, the queue drains, and the continuation op's
// side effects (its onStep set #walk-meta / #mix-meta) are present.
//   bro-headless ../broworkshop/demos/stylegan3-lab _async_seams.js

const DIR = 'D:/projects/brovisionml/weights/stylegan3-r-ffhqu-256';

gan = bro.vision.loadStyleGAN3(DIR, { resolution: 256 });
assert(gan && gan.numWs > 0, 'model loaded');
META = { resolution: gan.resolution, zDim: gan.zDim, numWs: gan.numWs, wDim: gan.wDim, device: gan.device };
onModelReady();   // sizes row controls + renders the initial (sample) seam

const badge = () => $('#backend');
const isErr = () => badge().classList.contains('err');

// Pump until the queue is fully idle (the source of truth — not the badge text),
// giving the worker real wall-clock between ticks. Fails fast on a badge error.
function settle(what) {
  for (let i = 0; i < 600; i++) {
    assert(!isErr(), what + ' — badge error: ' + badge().textContent);
    if (!inflight && !curSeq && !pending) return;
    wallSleep(16); sleep(1);
  }
  assert(false, what + ' — queue never drained: ' + badge().textContent);
}

settle('initial sample');   // drive from a clean idle state

// ── Walk: 2 anchors (chained generate) → onAll midpoint → N-frame strip ───────
$('#walk-a').value = '11'; $('#walk-b').value = '22'; prepareWalk();
settle('walk anchors + midpoint');
assert(walkWA && walkWB, 'both walk anchors mapped');
assert($('#walk-meta').textContent.indexOf('t =') === 0, 'midpoint rendered (onAll not cancelled)');

$('#walk-steps').value = '5'; renderWalkStrip();
settle('walk strip');
assert($('#walk-strip').children.length === 5, 'strip rendered 5 cells');

// ── Mix: 2 anchors (chained generate) → onAll style-mixed result ──────────────
$('#mix-a').value = '33'; $('#mix-b').value = '44'; prepareMix();
settle('mix anchors + result');
assert(mixWA && mixWB, 'both mix anchors mapped');
assert($('#mix-meta').textContent.length > 0, 'mix result rendered (onAll not cancelled)');

// ── latest-wins: supersede a walk mid-flight; the newest request must win ──────
$('#walk-a').value = '55'; pinnedA = null; walkWA = null; prepareWalk();
$('#walk-b').value = '66'; pinnedB = null; walkWB = null; prepareWalk();
settle('walk re-issue (cancel/restart)');
assert(walkWA && walkWB, 're-issued walk anchors mapped');

console.log('OK — async multi-image seams render fully: no "generator busy", '
          + 'midpoint/result not cancelled, queue drains clean');
