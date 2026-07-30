// Walking several axes as one RIG. Some concepts are not one axis: the mouth
// barely opens unless `round` travels against `open`, so a per-axis walk of
// `open` shows almost nothing and reads as "the model has no mouth control".
//
// What this pins:
//
//   * every member moves on every frame, each along its OWN from/to — including
//     backwards, which is the whole point (from > to reverses it)
//   * a member can be given a shorter run than the rest of the rig
//   * one folder and one animation for the rig, not one per member
//   * the same reuse rule as a single axis: doubling the frame count renders
//     only the steps in between, and changing a member's range forks new frames
//     beside the old ones instead of overwriting a walk you already made
//   * two members of an exclusive field (two expression words) are REFUSED
//     rather than silently walked as one
//
//   bro-headless ../broworkshop/demos/krea2-lab \
//                ../broworkshop/demos/krea2-lab/tests/test_walk_rig.js

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
const OUT = path.join(bro.appDir, 'tests', 'out', 'walkrig');
fs.rmSync(OUT, { recursive: true, force: true });

document.querySelector('.secbtn[data-sec="walk"]').click();
flush();
assert(pumpUntil(() => document.querySelectorAll('#walk-list .walk-row').length >= 400, 15000),
       'axis picker fully built');
ctx.setSpectrumAvailable(true);
ctx.setMouthAvailable(true);
assert(pumpUntil(() => ctx.walkInternals.rows.some((r) => r.key === 'face.mouth.open'), 5000),
       'the mouth axes are walkable');

// ── stub the worker ───────────────────────────────────────────────────────
const sent = [];
const SIZE = 64;
ctx.client.send = function (msg, cb) {
  sent.push(JSON.parse(JSON.stringify(msg)));
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  const m = msg.mouth || {};
  g.fillStyle = 'rgb(' + Math.round(((m.open || 0) + 3) / 6 * 255) + ',' +
                Math.round(((m.round || 0) + 3) / 6 * 255) + ',' +
                Math.round(((m.teeth || 0) + 3) / 6 * 255) + ')';
  g.fillRect(0, 0, SIZE, SIZE);
  Promise.resolve().then(() => cb(null, { bitmap: c, width: SIZE, height: SIZE, ms: 3 }));
};
ctx.setLoaded(true);
ctx.refreshButtons();

// ── build the mouth rig ───────────────────────────────────────────────────
function pick(key) {
  $('walk-filter').value = key;
  $('walk-filter').dispatchEvent(new Event('input'));
  flush();
  const rows = document.querySelectorAll('#walk-list .walk-row');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].style.display === 'none') continue;
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
assert(pick('face.mouth.open'), 'picked open');
assert(pick('face.mouth.round'), 'picked round');
assert(pick('face.mouth.teeth'), 'picked teeth');

$('prompt').value = 'walk rig scene ONE';
$('prompt').dispatchEvent(new Event('change'));
$('walk-dir').value = OUT;
$('walk-steps').value = '5';   // each axis walks its own full range
$('walk-ms').value = '200';
$('walk-pingpong').checked = false;
$('walk-gif').checked = false;
['walk-steps', 'walk-ms'].forEach((id) => $(id).dispatchEvent(new Event('change')));
$('walk-mode-together').checked = true;
$('walk-mode-together').dispatchEvent(new Event('change'));
flush();

// A newly selected axis starts at its OWN full range — there is no run-wide
// from/to to misread. A baked bank is ±3, not the ±6 an axisControls slider has.
const R = ctx.walkInternals.effectiveRange;
const openRow = ctx.walkInternals.picked.filter((r) => r.key === 'face.mouth.open')[0];
assert(R(openRow).from === -3 && R(openRow).to === 3,
       'a freshly picked baked-bank axis starts at ±3, got ' +
       R(openRow).from + '…' + R(openRow).to);

// `round` runs against `open`, and `teeth` runs a shorter distance — the two
// things a rig needs that a shared range cannot express.
ctx.walkInternals.setRange('face.mouth.round', 3, -3);
ctx.walkInternals.setRange('face.mouth.teeth', -1.5, 1.5);
flush();

// One row per selected axis, and the ones given a range of their own say so.
const rngRows = document.querySelectorAll('#walk-ranges .walk-rng');
assert(rngRows.length === 3, 'a range row per selected axis, got ' + rngRows.length);
const setRows = document.querySelectorAll('#walk-ranges .walk-rng.set');
assert(setRows.length === 2, 'two rows carry a set range, got ' + setRows.length);

// A configured range survives everything that is not that range. Changing the
// frame count used to rebuild these rows from a default and silently throw the
// configuration away, which is the whole reason the run-wide from/to is gone.
$('walk-steps').value = '7';
$('walk-steps').dispatchEvent(new Event('input'));
$('walk-steps').dispatchEvent(new Event('change'));
$('walk-mode-each').checked = true;
$('walk-mode-each').dispatchEvent(new Event('change'));
$('walk-mode-together').checked = true;
$('walk-mode-together').dispatchEvent(new Event('change'));
flush();
const roundRow = ctx.walkInternals.picked.filter((r) => r.key === 'face.mouth.round')[0];
assert(R(roundRow).from === 3 && R(roundRow).to === -3,
       'the reversed range survived a frame-count and mode change, got ' +
       R(roundRow).from + '…' + R(roundRow).to);
assert(document.querySelectorAll('#walk-ranges .walk-rng.set').length === 2,
       'and the rows still show it as set');
// Put the frame count back for the run below.
$('walk-steps').value = '5';
$('walk-steps').dispatchEvent(new Event('change'));
flush();

// ── the grid ──────────────────────────────────────────────────────────────
const grid = ctx.walkInternals.comboGrid(ctx.walkInternals.picked);
assert(grid.length === 5, 'five frames, got ' + grid.length);
const asText = grid.map((e) => e.v['face.mouth.open'] + '/' + e.v['face.mouth.round'] +
                              '/' + e.v['face.mouth.teeth']).join(' ');
assert(asText === '-3/3/-1.5 -1.5/1.5/-0.75 0/0/0 1.5/-1.5/0.75 3/-3/1.5',
       'open rises, round falls against it, teeth runs half as far — got ' + asText);
assert(grid[0].t === 0 && grid[4].t === 1, 'the parameter runs 0…1');

assert($('walk-plan').textContent.indexOf('3 axes moving together × 5 frames = 5 renders') >= 0,
       'the plan counts one render per frame, not per axis: ' + $('walk-plan').textContent);

// ── run it ────────────────────────────────────────────────────────────────
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000),
       'the rig walk finished, status: ' + $('walk-status').textContent);
assert(sent.length === 5, '5 renders for 3 axes (got ' + sent.length + ')');

// Every member moved on every frame, to exactly the grid's values.
sent.forEach((m, i) => {
  const want = grid[i].v;
  const zero = !want['face.mouth.open'] && !want['face.mouth.round'] &&
               !want['face.mouth.teeth'];
  // An all-zero frame is the panel's own "nothing set": the whole bank goes
  // away rather than being sent as three zeros, so the rig's neutral frame
  // renders (and caches) like the same picture made with the sliders at rest.
  if (zero) {
    assert(m.mouth === null,
           'the all-zero frame sends no mouth at all, got ' + JSON.stringify(m.mouth));
    return;
  }
  assert(m.mouth, 'frame ' + i + ' carries a mouth');
  assert(m.mouth.open === want['face.mouth.open'] &&
         m.mouth.round === want['face.mouth.round'] &&
         m.mouth.teeth === want['face.mouth.teeth'],
         'frame ' + i + ' is ' + JSON.stringify(m.mouth) + ', wanted ' +
         JSON.stringify(want));
});
assert(sent[2].mouth === null, 'the middle frame is the neutral one');

// Nothing else moved across the rig.
function stripped(m) {
  const c = JSON.parse(JSON.stringify(m));
  delete c.mouth;
  return JSON.stringify(c, Object.keys(c).sort());
}
const base = stripped(sent[0]);
sent.forEach((m, i) => assert(stripped(m) === base,
  'frame ' + i + ' differs from the rig in something other than the mouth'));

// ── one folder, one animation ─────────────────────────────────────────────
const dirs = fs.readdirSync(OUT);
assert(dirs.length === 1, 'the rig wrote ONE folder, not one per axis — got ' + dirs.join(','));
assert(dirs[0].indexOf('rig_') === 0, 'named as a rig, got ' + dirs[0]);
assert(dirs[0].indexOf('face.mouth.open') >= 0 && dirs[0].indexOf('face.mouth.teeth') >= 0,
       'the folder names its members, got ' + dirs[0]);
const sigDirs = fs.readdirSync(path.join(OUT, dirs[0]));
assert(sigDirs.length === 1, 'one settings folder, got ' + sigDirs.length);
const rigDir = path.join(OUT, dirs[0], sigDirs[0]);
let files = fs.readdirSync(rigDir);
assert(files.filter((f) => f.endsWith('.png')).length === 5, '5 stills');
assert(files.indexOf('walk_5f_200ms.webm') >= 0,
       'one animation for the rig, got ' + files.join(','));
// Frames sort in walk order by their position, and carry every member's value.
const pngs = files.filter((f) => f.endsWith('.png')).sort();
assert(pngs[0] === 'v_t00000_m3.00_p3.00_m1.50.png',
       'the first frame names its whole vector, got ' + pngs[0]);
assert(pngs[4] === 'v_t10000_p3.00_m3.00_p1.50.png',
       'the last frame likewise, got ' + pngs[4]);

// ── reuse ─────────────────────────────────────────────────────────────────
let before = sent.length;
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000), 'rerun finished');
assert(sent.length === before, 'an identical re-run rendered nothing');

// Doubling the frame count renders only the steps that fall between the ones
// already on disk: 9 frames, 5 of which are the run above.
before = sent.length;
$('walk-steps').value = '9';
$('walk-steps').dispatchEvent(new Event('change'));
flush();
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000), 'finer run finished');
assert(sent.length - before === 4,
       'a 5→9 refinement rendered the 4 new steps only, got ' + (sent.length - before));
assert(fs.readdirSync(rigDir).filter((f) => f.endsWith('.png')).length === 9,
       'nine stills on disk');

// Changing ONE member's range makes new frames beside the old ones — the walks
// are the deliverable, so nothing is overwritten silently.
before = sent.length;
$('walk-steps').value = '5';
$('walk-steps').dispatchEvent(new Event('change'));
ctx.walkInternals.setRange('face.mouth.teeth', -3, 3);
flush();
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000), 'widened run finished');
assert(sent.length - before === 4,
       'widening teeth re-rendered the 4 frames it moved (the centre is unchanged), got ' +
       (sent.length - before));
files = fs.readdirSync(rigDir).filter((f) => f.endsWith('.png'));
assert(files.length === 13, 'the old frames are still there beside the new, got ' + files.length);
assert(files.indexOf('v_t00000_m3.00_p3.00_m1.50.png') >= 0,
       'the original first frame survives the range change');
assert(files.indexOf('v_t00000_m3.00_p3.00_m3.00.png') >= 0, 'and the new one is beside it');

// ── an exclusive field cannot be rigged against itself ────────────────────
$('btn-walk-none').click(); flush();
assert(pick('face.expr.happiness'), 'picked happiness');
assert(pick('face.expr.anger'), 'picked anger');
$('btn-walk-start').click();
flush();
assert($('walk-status').textContent.indexOf('cannot move') >= 0,
       'two expression words in one rig are refused, status: ' + $('walk-status').textContent);
assert($('walk-status').className.indexOf('err') >= 0, 'and refused as an error');

// Separately, the same two are fine.
$('walk-mode-each').checked = true;
$('walk-mode-each').dispatchEvent(new Event('change'));
flush();
before = sent.length;
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000),
       'walked separately instead, status: ' + $('walk-status').textContent);
assert(sent.length - before === 10, 'two words × 5 frames apiece, got ' + (sent.length - before));

fs.rmSync(OUT, { recursive: true, force: true });
console.log('PASS walk rig');
