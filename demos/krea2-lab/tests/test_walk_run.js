// The walk RUN — everything except the model. The worker's generate is stubbed,
// so what this pins is the part that has to be right for a walk to mean anything:
//
//   * one axis at a time — every frame differs from its neighbours in exactly
//     one number, and every other setting is byte-identical across the whole run
//   * the walked axis is removed from the held constants, so its resting slider
//     position cannot leak into the walk
//   * a zero step sends NO axis entry, matching what the slider at 0 would send
//   * the selection is made through the label, which is how a user clicks it
//   * cancel stops between frames and keeps the frames it finished
//
//   bro-headless ../broworkshop/demos/krea2-lab \
//                ../broworkshop/demos/krea2-lab/tests/test_walk_run.js

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';

flush();
advanceTime(300);
flush();

const fs = require('fs');
const path = require('path');

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); flush(); }
  return pred();
}

const ctx = window.__ctx;
const OUT = path.join(bro.appDir, 'tests', 'out', 'walkrun');
fs.rmSync(OUT, { recursive: true, force: true });

document.querySelector('.secbtn[data-sec="walk"]').click();
flush();
assert(pumpUntil(() => document.querySelectorAll('#walk-list .walk-row').length >= 400, 15000),
       'axis picker fully built');

// ── stub the worker ───────────────────────────────────────────────────────
// Captures every message the walk sends and answers with a flat frame whose
// colour encodes the axis value, so the stills can be checked later.
const sent = [];
const SIZE = 64;
// `gate` holds each answer until the test releases it. A real render takes
// seconds; the stub is instant, which would leave no window in which to press
// Cancel — the whole run would finish inside one event-loop turn.
let gate = false;
const held = [];
ctx.client.send = function (msg, cb) {
  sent.push(JSON.parse(JSON.stringify(msg)));
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  const ac = msg.axisControls || {};
  const keys = Object.keys(ac);
  const v = keys.length ? ac[keys[0]] : 0;
  const lvl = Math.round((v + 6) / 12 * 255);
  g.fillStyle = 'rgb(' + lvl + ',' + (255 - lvl) + ',10)';
  g.fillRect(0, 0, SIZE, SIZE);
  const resp = { bitmap: c, width: SIZE, height: SIZE, ms: 3 };
  // Async, like the real worker: the walk must not depend on a sync answer.
  if (gate) held.push(() => cb(null, resp));
  else Promise.resolve().then(() => cb(null, resp));
};
ctx.setLoaded(true);
ctx.refreshButtons();

// Two named axes, chosen by clicking the LABEL TEXT — the path a user takes, and
// the one that needed the engine's label activation behavior to work at all.
function pickByLabelText(key) {
  const rows = document.querySelectorAll('#walk-list .walk-row');
  for (let i = 0; i < rows.length; i++) {
    const nm = rows[i].querySelector('.walk-name');
    if (nm.title.split(' ')[0] !== key) continue;
    const r = nm.getBoundingClientRect();
    click(r.left + r.width / 2, r.top + r.height / 2);
    flush();
    return rows[i].querySelector('input').checked;
  }
  return false;
}
$('btn-walk-none').click(); flush();
assert(pickByLabelText('composition.proximity'), 'clicking the axis NAME selected it');
assert(pickByLabelText('color.temperature'), 'clicking the second axis name selected it');
assert(ctx.walkInternals.selected.length === 2,
       'two axes selected (got ' + ctx.walkInternals.selected.length + ')');

// Give one of the walked axes a resting value, and another axis a value that must
// be HELD. This is what proves the walk removes only the axis under test.
const bank = document.querySelectorAll('#axis-categories .ctl');
function setBankAxis(key, v) {
  for (const row of bank) {
    if (row.getAttribute('data-key') !== key) continue;
    const r = row.querySelector('input[type=range]');
    r.value = String(v);
    r.dispatchEvent(new Event('input'));
    return true;
  }
  return false;
}
assert(setBankAxis('composition.proximity', 4), 'parked the walked axis at +4');
assert(setBankAxis('mood.drama', -2.5), 'parked a bystander axis at -2.5');
flush();

// ── configure and run ─────────────────────────────────────────────────────
// Pin the prompt explicitly. The app persists it, so a bare re-run of this test
// would boot with whatever prompt the LAST run left behind — and since the prompt
// is part of a walk's identity, an inherited one collided with the "changed
// setting" prompt further down and made that run reuse instead of re-render.
$('prompt').value = 'walk test scene ONE';
$('prompt').dispatchEvent(new Event('change'));
$('walk-dir').value = OUT;
$('walk-steps').value = '5';   // each axis walks its own full range
$('walk-ms').value = '200';
// Pin the mode and clear any stored per-axis ranges. The app persists both, so a
// bare re-run would otherwise inherit whatever the LAST test in the suite left
// behind — the same trap as the prompt below.
$('walk-mode-each').checked = true;
$('walk-mode-each').dispatchEvent(new Event('change'));
$('btn-walk-full').click();
flush();
$('walk-pingpong').checked = false;
$('walk-gif').checked = false;
['walk-steps', 'walk-ms'].forEach((id) => $(id).dispatchEvent(new Event('change')));
flush();
assert($('walk-plan').textContent.indexOf('2 axes × 5 frames = 10 renders') >= 0,
       'plan reads 2 axes x 5 frames, got: ' + $('walk-plan').textContent);
assert(!$('btn-walk-start').disabled, 'Start is enabled with a model loaded and axes picked');

$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000),
       'walk finished, status: ' + $('walk-status').textContent);

// ── one axis at a time ────────────────────────────────────────────────────
assert(sent.length === 10, '10 renders were requested (got ' + sent.length + ')');

// Axes run in catalogue order, one after the other, so the run is two blocks of
// five. NOTE that the other walked axis is, during this axis' walk, simply one
// more held setting — "the other settings as they are" includes the axis bank.
const walked = ['composition.proximity', 'color.temperature'];
const groups = [sent.slice(0, 5), sent.slice(5, 10)];

// The core invariant: inside one axis' walk, the ONLY thing that differs between
// frames is that axis' own value. Strip it and every message must be identical.
groups.forEach((g, gi) => {
  const axis = walked[gi];
  const stripped = g.map((m) => {
    const copy = JSON.parse(JSON.stringify(m));
    delete copy.axisControls[axis];
    return JSON.stringify(copy, Object.keys(copy).sort());
  });
  stripped.forEach((s, i) => {
    assert(s === stripped[0],
           'walk of ' + axis + ': frame ' + i + ' differs from frame 0 in something ' +
           'other than ' + axis);
  });
  // And that value really does sweep the grid, neutral included as an ABSENT key
  // (which is how the slider at 0 would have sent it).
  const vals = g.map((m) => {
    const v = m.axisControls[axis];
    return v === undefined ? 0 : v;
  });
  assert(vals.join(',') === '-6,-3,0,3,6',
         'walk of ' + axis + ' swept -6..6: got ' + vals.join(','));
  const zero = g.filter((m) => m.axisControls[axis] === undefined);
  assert(zero.length === 1,
         'walk of ' + axis + ' sent the neutral frame with the axis absent, not at 0');
});

// The bystander is held everywhere, in both walks.
sent.forEach((m, i) => {
  assert((m.axisControls || {})['mood.drama'] === -2.5,
         'frame ' + i + ' held the bystander axis at -2.5 (got ' +
         (m.axisControls || {})['mood.drama'] + ')');
});

// The axis under test never carries its own resting value as a constant: during
// its OWN walk it is the variable. (During the other axis' walk it is held at +4,
// which the group-invariant check above already covers.)
groups[0].forEach((m, i) => {
  const v = m.axisControls['composition.proximity'];
  assert(v !== 4, 'frame ' + i + ' of its own walk did not inherit the resting +4');
});
assert(groups[1].every((m) => m.axisControls['composition.proximity'] === 4),
       'during the other axis\' walk, the parked axis stays at +4');

// Constants really are constant: prompt/seed/size identical across all 10.
const invariant = (m) => JSON.stringify([m.prompt, m.negPrompt, m.opts]);
const firstInv = invariant(sent[0]);
sent.forEach((m, i) => {
  assert(invariant(m) === firstInv, 'frame ' + i + ' shares the run\'s constants');
});

// ── what landed on disk ───────────────────────────────────────────────────
walked.forEach((axis) => {
  const adir = path.join(OUT, axis);
  assert(fs.existsSync(adir), 'a folder per axis: ' + adir);
  const sigs = fs.readdirSync(adir);
  assert(sigs.length === 1, axis + ' has one settings folder (got ' + sigs.length + ')');
  const d = path.join(adir, sigs[0]);
  const pngs = fs.readdirSync(d).filter((f) => f.endsWith('.png'));
  assert(pngs.length === 5, axis + ' wrote 5 stills (got ' + pngs.length + ')');
  const webms = fs.readdirSync(d).filter((f) => f.endsWith('.webm'));
  assert(webms.length === 1, axis + ' wrote one clip (got ' + webms.join(',') + ')');
  assert(webms[0] === 'walk_5f_200ms.webm', 'clip is named for its recipe: ' + webms[0]);
  assert(fs.existsSync(path.join(d, 'manifest.json')), axis + ' wrote a manifest');
});

// ── re-running renders nothing ────────────────────────────────────────────
sent.length = 0;
$('btn-walk-start').click();
assert(pumpUntil(() => $('walk-status').textContent.indexOf('done') >= 0 &&
                       !$('btn-walk-start').disabled, 60000), 'second walk finished');
assert(sent.length === 0,
       'an identical re-run asked the worker for nothing (got ' + sent.length + ')');
assert($('walk-status').textContent.indexOf('0 rendered') >= 0,
       'status says nothing was rendered: ' + $('walk-status').textContent);

// ── changing a held setting forks the output, and re-renders ───────────────
$('prompt').value = 'walk test scene TWO';
$('prompt').dispatchEvent(new Event('change'));
flush();
sent.length = 0;
$('btn-walk-start').click();
assert(pumpUntil(() => $('walk-status').textContent.indexOf('done') >= 0 &&
                       !$('btn-walk-start').disabled, 60000), 'third walk finished');
assert(sent.length === 10, 'a changed prompt re-rendered all 10 (got ' + sent.length + ')');
walked.forEach((axis) => {
  const sigs = fs.readdirSync(path.join(OUT, axis));
  assert(sigs.length === 2, axis + ' now has two settings folders (got ' + sigs.length + ')');
});

// ── cancel stops between frames ───────────────────────────────────────────
$('prompt').value = 'walk test scene THREE';
$('prompt').dispatchEvent(new Event('change'));
flush();
sent.length = 0;
gate = true;
held.length = 0;
$('btn-walk-start').click();
// Cancel while the first frame is still in the worker.
assert(pumpUntil(() => held.length >= 1, 20000), 'the walk asked for its first frame');
assert($('btn-walk-start').disabled, 'Start is disabled while a walk runs');
assert(!$('btn-walk-cancel').disabled, 'Cancel is live while a walk runs');
$('btn-walk-cancel').click();
flush();
assert($('walk-status').textContent.indexOf('cancelling') >= 0,
       'cancel says it is finishing the frame in flight: ' + $('walk-status').textContent);
gate = false;
held.shift()();          // let the in-flight frame land, as the worker would
assert(pumpUntil(() => !$('btn-walk-start').disabled &&
                       $('walk-status').textContent.indexOf('cancelled') >= 0, 60000),
       'walk reports cancelled, status: ' + $('walk-status').textContent);
assert(sent.length < 10, 'cancelling stopped short of the full run (did ' + sent.length + ')');
assert(sent.length >= 1, 'the frame in flight was allowed to finish');

// Resuming keeps what the cancelled run produced.
const before = sent.length;
sent.length = 0;
$('btn-walk-start').click();
assert(pumpUntil(() => $('walk-status').textContent.indexOf('done') >= 0 &&
                       !$('btn-walk-start').disabled, 60000), 'resume finished');
assert(sent.length === 10 - before,
       'resume rendered only what the cancel left undone (' + sent.length +
       ' after ' + before + ')');

fs.rmSync(OUT, { recursive: true, force: true });
console.log('PASS: one axis at a time, constants held, idempotent, cancellable');
