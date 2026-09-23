// Headless smoke for Laya triage on the real model (GPU). Loads the
// checkpoint the app finds on its own, decides one preset, runs open-loop
// traffic and a burst through the app's own controls, and checks that the
// concurrency view shows requests sharing forwards.
// Run from the bro repo root:
//   bro-headless ../broworkshop/tools/laya-triage ../broworkshop/tools/laya-triage/tests/test_smoke.js
// Needs a Laya checkout (LAYA_MODEL_DIR, or laya/ beside an ancestor of the app).

// (Mutable state is read through objects: an imported `let` does not follow
// the module's later assignments in a headless script.)
import { traffic, windowSummary } from "/app/lib/traffic.js";
import { session } from "/app/lib/session.js";

const $ = (s) => document.querySelector(s);

function pumpUntil(desc, pred, seconds) {
  const end = Date.now() + seconds * 1000;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for ' + desc);
    advanceTime(16);
    wallSleep(4);
  }
}
function pumpFor(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { advanceTime(16); wallSleep(4); }
}

if (bro.lm.available === false || !bro.gpu.available) {
  console.log('SKIP: needs bro.lm and a GPU');
} else {
  // ── 1. the app found and loaded the checkpoint by itself ─────────────────
  pumpUntil('model load', () => !session.loading, 120);
  assert(!session.loadError, 'loaded: ' + session.loadError);
  const model = session.model;
  assert(model, 'model handle');
  assert($('#unavailable').classList.contains('hidden'), 'no unavailable banner');
  console.log('loaded ' + $('#model-dir').value + ' in ' + session.loadMs + ' ms; ' + $('#status').textContent);

  // ── 2. one request through a preset button ───────────────────────────────
  const outage = [...document.querySelectorAll('.preset')].find((b) => b.dataset.id === 'outage');
  outage.click();
  pumpUntil('single result', () => session.lastResult || session.singleError, 20);
  assert(!session.singleError, 'single request: ' + session.singleError);
  assert(session.lastResult.answers.department.choice === 'technical', 'outage routes to technical: ' +
         session.lastResult.answers.department.choice);
  assert($('#answers').children.length === 5, 'five answer cards');
  assert(/^(Act|Escalate)/.test($('#decision-head').textContent), 'a decision: ' + $('#decision-head').textContent);
  console.log('single: ' + $('#decision-head').textContent + ' | ' + $('#single-timing').textContent);

  // A clear billing ticket clears the default 45% routing gate and is flagged.
  session.lastResult = null;
  [...document.querySelectorAll('.preset')].find((b) => b.dataset.id === 'duplicate').click();
  pumpUntil('duplicate result', () => session.lastResult || session.singleError, 20);
  assert(/^Act: route to billing/.test($('#decision-head').textContent), 'duplicate acts: ' + $('#decision-head').textContent);
  assert($('#decision-head').textContent.includes('refund'), 'refund flagged');
  console.log('single: ' + $('#decision-head').textContent);

  // ── 3. open-loop traffic via the app's controls ──────────────────────────
  const rate = $('#rate');
  rate.value = '200';
  rate.dispatchEvent(new Event('input'));
  $('#btn-traffic').click();
  assert(traffic.running && traffic.rate === 200, 'traffic running at 200 req/s');
  pumpFor(4000);
  const win = windowSummary(3000);
  const st = model.stats();
  console.log('traffic @200 req/s: done ' + win.rps.toFixed(0) + '/s, p50 ' + win.p50.toFixed(1) + ' ms, p99 ' +
              win.p99.toFixed(1) + ' ms, missed ' + win.missed + '/' + win.n + '; ' + st.meanBatchRequests.toFixed(1) +
              ' requests/forward, occupancy ' + (100 * st.meanOccupancy).toFixed(0) + '%, frame delivery +' +
              win.seenMean.toFixed(0) + ' ms');
  assert(win.n > 300, 'hundreds of requests completed: ' + win.n);
  assert(st.meanBatchRequests > 1.2, 'concurrent requests share forwards');
  assert(traffic.failed === 0, 'no failures: ' + traffic.lastError);
  assert($('#m-p99').textContent !== '--', 'p99 shown');
  screenshot('../broworkshop/tools/laya-triage/tests/out/traffic.png');
  $('#btn-traffic').click();
  assert(!traffic.running, 'traffic stopped');
  pumpUntil('traffic drain', () => traffic.inFlight === 0, 20);

  // ── 4. a burst of 64 at once ─────────────────────────────────────────────
  $('#btn-reset').click();
  $('#btn-burst').click();
  assert(traffic.inFlight === 64, '64 in flight');
  pumpUntil('burst', () => traffic.inFlight === 0, 20);
  const b = model.stats();
  console.log('burst of 64: ' + b.forwards + ' forwards, ' + b.meanBatchRequests.toFixed(1) +
              ' requests/forward, p99 ' + b.latencyP99.toFixed(1) + ' ms');
  assert(b.completed === 64 && b.forwards < 32, 'burst packed into few forwards');
  pumpFor(300);
  screenshot('../broworkshop/tools/laya-triage/tests/out/burst.png');
  console.log('laya-triage smoke OK');
}
