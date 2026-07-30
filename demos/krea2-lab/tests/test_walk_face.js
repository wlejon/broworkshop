// Walking the FACE axes. The face controls do not live in `axisControls` — the
// expression splices an adjective into the prompt and the baked banks ride their
// own `spectrum` / `mouth` message fields — so each of them tells the walk how to
// apply a value and how to set its own resting value aside. What this pins is
// that those two operations reproduce exactly what the panel would have sent:
//
//   * an expression axis walks ONE word's strength, and displaces any other
//     resting word (the field is exclusive — the splice fixes the tokenization)
//   * a baked-bank axis walks one key and HOLDS its bank-mates at rest
//   * a zero sends what the panel sends at zero: no expression at all, and a
//     bank that is null only when every one of its keys is zero
//   * each axis walks its own domain (±3 for a bank, 0…5 for an expression)
//     rather than a run-wide range that would ask for values it cannot hold
//   * an unbaked bank is not offered at all, rather than offered and broken
//
//   bro-headless ../broworkshop/demos/krea2-lab \
//                ../broworkshop/demos/krea2-lab/tests/test_walk_face.js

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
const OUT = path.join(bro.appDir, 'tests', 'out', 'walkface');
fs.rmSync(OUT, { recursive: true, force: true });

document.querySelector('.secbtn[data-sec="walk"]').click();
flush();
assert(pumpUntil(() => document.querySelectorAll('#walk-list .walk-row').length >= 400, 15000),
       'axis picker fully built');

const keysOf = () => ctx.walkInternals.rows.map((r) => r.key);

// ── an unbaked bank is not on the menu ────────────────────────────────────
// The worker rejects a bank it never loaded, so every frame of such a walk would
// fail. The expression words need no bank and are always there.
assert(keysOf().indexOf('face.spectrum.valence') < 0,
       'no spectrum axis before the worker reports the bank');
assert(keysOf().indexOf('face.mouth.open') < 0,
       'no mouth axis before the worker reports the bank');
assert(keysOf().indexOf('face.expr.happiness') >= 0,
       'expression words are walkable with no bank at all');

ctx.setSpectrumAvailable(true);
ctx.setMouthAvailable(true);
flush();
assert(pumpUntil(() => keysOf().indexOf('face.spectrum.valence') >= 0, 5000),
       'the spectrum axes appear once the bank is reported');
assert(keysOf().indexOf('face.mouth.teeth') >= 0, 'and the mouth axes too');

// ── each axis' own domain ─────────────────────────────────────────────────
const rowFor = (k) => ctx.walkInternals.rows.filter((r) => r.key === k)[0];
$('walk-steps').value = '5';   // each axis walks its own full range
// Pin the mode and clear any stored per-axis ranges. The app persists both, so a
// bare re-run would otherwise inherit whatever the LAST test in the suite left
// behind — the same trap as the prompt further down.
$('walk-mode-each').checked = true;
$('walk-mode-each').dispatchEvent(new Event('change'));
$('btn-walk-full').click();
flush();
const exprVals = ctx.walkInternals.walkValues(rowFor('face.expr.happiness'));
const specVals = ctx.walkInternals.walkValues(rowFor('face.spectrum.valence'));
const bankVals = ctx.walkInternals.walkValues(rowFor('composition.proximity'));
assert(exprVals.join(',') === '0,1.25,2.5,3.75,5',
       'an expression starts at its own 0…5, got ' + exprVals.join(','));
assert(specVals.join(',') === '-3,-1.5,0,1.5,3',
       'a baked bank at its own ±3, got ' + specVals.join(','));
assert(bankVals.join(',') === '-6,-3,0,3,6',
       'and an axisControls axis at the full ±6, got ' + bankVals.join(','));

// ── stub the worker ───────────────────────────────────────────────────────
const sent = [];
const SIZE = 64;
ctx.client.send = function (msg, cb) {
  sent.push(JSON.parse(JSON.stringify(msg)));
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  const a = msg.expression ? msg.expression.alpha : 0;
  const s = msg.spectrum ? msg.spectrum.valence : 0;
  g.fillStyle = 'rgb(' + Math.round(a / 5 * 255) + ',' +
                Math.round((s + 3) / 6 * 255) + ',20)';
  g.fillRect(0, 0, SIZE, SIZE);
  Promise.resolve().then(() => cb(null, { bitmap: c, width: SIZE, height: SIZE, ms: 3 }));
};
ctx.setLoaded(true);
ctx.refreshButtons();

// ── park the face panel ───────────────────────────────────────────────────
// A resting expression that is NOT the one being walked, and a bank-mate of the
// walked spectrum key. Both are "the other settings as they are", and the walk
// has to treat them differently: the bank-mate is held, the rival word is not
// (it cannot be — one expression per render).
document.querySelector('.secbtn[data-sec="face"]').click();
flush();
// Reset first: the app persists the picked word, and a chip click TOGGLES, so a
// re-run of this test would otherwise deselect the word its last run left behind.
$('btn-reset-expr').click();
flush();
const chips = document.querySelectorAll('#expr-words .word-chip');
let sadChip = null;
chips.forEach((c) => { if (c.textContent === 'sadness') sadChip = c; });
assert(sadChip, 'found the sadness chip');
sadChip.click();
flush();
const exprRange = $('expr-strength-row').querySelector('input[type=range]');
exprRange.value = '2';
exprRange.dispatchEvent(new Event('input'));
flush();

function setRowValue(hostId, key, v) {
  const rows = document.querySelectorAll('#' + hostId + ' .ctl');
  for (const row of rows) {
    if (row.getAttribute('data-key') !== key) continue;
    const r = row.querySelector('input[type=range]');
    r.value = String(v);
    r.dispatchEvent(new Event('input'));
    return true;
  }
  return false;
}
assert(setRowValue('spec-rows', 'arousal', 1.5), 'parked arousal at +1.5');
assert(setRowValue('spec-rows', 'valence', -2), 'parked the walked key at -2');
flush();

// The panel's own message is the reference the walk has to match.
const ref = ctx.buildGenerateMsg('full');
assert(ref.expression && ref.expression.adj === 'sad' && ref.expression.alpha === 2,
       'the panel sends sadness at 2, got ' + JSON.stringify(ref.expression));
assert(ref.spectrum && ref.spectrum.valence === -2 && ref.spectrum.arousal === 1.5,
       'the panel sends valence -2 / arousal 1.5, got ' + JSON.stringify(ref.spectrum));

// ── select and run ────────────────────────────────────────────────────────
document.querySelector('.secbtn[data-sec="walk"]').click();
flush();
$('btn-walk-none').click(); flush();
// Filter down to the one axis first, then click its NAME — the path a user
// actually takes to reach a face axis, which sits below several hundred bank rows
// in a scroller. (Clicking the name at all depends on the engine forwarding a
// <label> click to the control it labels.)
function pickByLabelText(key) {
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
assert(pickByLabelText('face.expr.happiness'), 'picked the happiness walk');
assert(pickByLabelText('face.spectrum.valence'), 'picked the valence walk');
assert(ctx.walkInternals.selected.length === 2, 'two face axes selected');

$('prompt').value = 'walk face scene ONE';
$('prompt').dispatchEvent(new Event('change'));
$('walk-dir').value = OUT;
$('walk-ms').value = '200';
$('walk-pingpong').checked = false;
$('walk-gif').checked = false;
['walk-steps', 'walk-ms'].forEach((id) => $(id).dispatchEvent(new Event('change')));
flush();
assert($('walk-plan').textContent.indexOf('2 axes × 5 frames = 10 renders') >= 0,
       'plan reads 2 axes x 5 frames, got: ' + $('walk-plan').textContent);

$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000),
       'walk finished, status: ' + $('walk-status').textContent);
assert(sent.length === 10, '10 renders were requested (got ' + sent.length + ')');

// ── the expression walk ───────────────────────────────────────────────────
// Catalogue order puts the expression words before the baked banks, so the first
// five messages are the happiness walk.
const exprGroup = sent.slice(0, 5);
exprGroup.forEach((m, i) => {
  const want = exprVals[i];
  if (want === 0) {
    assert(m.expression === null,
           'frame 0 sends NO expression, exactly as the panel does with no word ' +
           'picked — got ' + JSON.stringify(m.expression));
  } else {
    assert(m.expression && m.expression.adj === 'joyfully smiling',
           'frame ' + i + ' walks the happiness word, got ' + JSON.stringify(m.expression));
    assert(m.expression.alpha === want,
           'frame ' + i + ' alpha is ' + want + ', got ' + m.expression.alpha);
  }
  // The rival resting word is gone: one expression per render, so walking a word
  // displaces whatever else was picked rather than stacking with it.
  assert(!(m.expression && m.expression.adj === 'sad'),
         'the resting sadness word does not ride along in the happiness walk');
  // Everything that is NOT the expression field is held, the spectrum included.
  assert(m.spectrum && m.spectrum.valence === -2 && m.spectrum.arousal === 1.5,
         'frame ' + i + ' holds the whole spectrum panel at rest, got ' +
         JSON.stringify(m.spectrum));
});

// Strip the walked field and every message in the group must be identical.
function stripped(m, field) {
  const c = JSON.parse(JSON.stringify(m));
  delete c[field];
  return JSON.stringify(c, Object.keys(c).sort());
}
const exprBase = stripped(exprGroup[0], 'expression');
exprGroup.forEach((m, i) => {
  assert(stripped(m, 'expression') === exprBase,
         'frame ' + i + ' of the expression walk differs from its group in ' +
         'something other than the expression');
});

// ── the spectrum walk ─────────────────────────────────────────────────────
const specGroup = sent.slice(5, 10);
specGroup.forEach((m, i) => {
  const want = specVals[i];
  assert(m.spectrum, 'frame ' + i + ' sends a spectrum (arousal is still 1.5)');
  assert(m.spectrum.valence === want,
         'frame ' + i + ' walks valence to ' + want + ', got ' + m.spectrum.valence);
  assert(m.spectrum.arousal === 1.5,
         'frame ' + i + ' holds arousal at 1.5, got ' + m.spectrum.arousal);
  assert(m.spectrum.hostility === 0 && m.spectrum.surprise === 0,
         'frame ' + i + ' leaves the untouched keys at 0');
  // A bank-mate holds; a rival expression does not exist here, so the resting
  // sadness word is part of "the other settings as they are" and must survive.
  assert(m.expression && m.expression.adj === 'sad' && m.expression.alpha === 2,
         'frame ' + i + ' keeps the resting expression, got ' +
         JSON.stringify(m.expression));
});
const specBase = stripped(specGroup[0], 'spectrum');
specGroup.forEach((m, i) => {
  assert(stripped(m, 'spectrum') === specBase,
         'frame ' + i + ' of the spectrum walk differs from its group in ' +
         'something other than the spectrum');
});

// The walked key's own resting value (-2) must not be in the folder identity, or
// the same walk started from a different resting position would look like
// different settings. It IS absent because hold() zeroes it before hashing.
const specConst = ctx.walkInternals.constantsFor('face.spectrum.valence');
assert(specConst.spectrum.valence === 0,
       'the walked spectrum key is zeroed in the constants, got ' + specConst.spectrum.valence);
assert(specConst.spectrum.arousal === 1.5,
       'while its bank-mates stay in the constants');
const exprConst = ctx.walkInternals.constantsFor('face.expr.happiness');
assert(exprConst.expression === null,
       'the expression field is emptied in the constants, got ' +
       JSON.stringify(exprConst.expression));

// ── the output ────────────────────────────────────────────────────────────
['face.expr.happiness', 'face.spectrum.valence'].forEach((key) => {
  const dir = path.join(OUT, key);
  assert(fs.existsSync(dir), 'a folder for ' + key);
  const sigs = fs.readdirSync(dir);
  assert(sigs.length === 1, key + ' wrote exactly one settings folder, got ' + sigs.length);
  const files = fs.readdirSync(path.join(dir, sigs[0]));
  const pngs = files.filter((f) => f.endsWith('.png'));
  assert(pngs.length === 5, key + ' wrote 5 stills, got ' + pngs.length);
  assert(files.indexOf('walk_5f_200ms.webm') >= 0,
         key + ' wrote the animation, got ' + files.join(','));
});

// A neutral expression frame is named off the same 0.01 grid as everything else,
// so 0 lands at tick 600 and the walk still sorts in order.
const exprFiles = (() => {
  const d = path.join(OUT, 'face.expr.happiness');
  return fs.readdirSync(path.join(d, fs.readdirSync(d)[0]))
           .filter((f) => f.endsWith('.png')).sort();
})();
assert(exprFiles[0] === 'v_0600_p0.00.png',
       'the neutral frame is v_0600_p0.00.png, got ' + exprFiles[0]);
assert(exprFiles[exprFiles.length - 1] === 'v_1100_p5.00.png',
       'the top frame is v_1100_p5.00.png, got ' + exprFiles[exprFiles.length - 1]);

// ── re-running asks for nothing ───────────────────────────────────────────
const before = sent.length;
$('btn-walk-start').click();
assert(pumpUntil(() => $('btn-walk-start').disabled === false &&
                       $('walk-status').textContent.indexOf('done') >= 0, 60000),
       'the second walk finished');
assert(sent.length === before,
       'an identical re-run rendered nothing (' + (sent.length - before) + ' extra)');

fs.rmSync(OUT, { recursive: true, force: true });
console.log('PASS walk face axes');
