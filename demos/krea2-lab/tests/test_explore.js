// Explore list — NO model load, no weights needed. One slider per UNNAMED atom,
// ordered strongest-first and grouped by measured effect. What has to be true:
// every unnamed atom is there, the atoms the axis bank already names are NOT
// (one direction, one slider), the shipped verdicts reach the rows that earned
// them, your own mark overrides one and survives, a turned slider REACHES the
// generate call, and filtering never lies about what is shaping the image.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_explore.js

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';        // blank BEFORE the worker can pump — no auto-load

flush();
advanceTime(300);
flush();

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

let index = null, meta = null;
fetch('assets/sae_index.json').then((r) => r.json()).then((j) => { index = j; });
fetch('assets/axes_meta.json').then((r) => r.json()).then((j) => { meta = j; });
assert(pumpUntil(() => index && meta, 10000), 'sae_index.json + axes_meta.json fetched');

// The atoms the axis bank names are the ones NOT expected here.
const namedAtoms = index.filter((e) => meta['sae.' + e.atom]);
assert(namedAtoms.length > 0, 'the bank names some atoms (' + namedAtoms.length + ')');
const want = index.length - namedAtoms.length;

// One slider per UNNAMED atom — none dropped, and no named atom duplicated.
const sliders = () => document.querySelectorAll('#explore-list .ctl');
assert(pumpUntil(() => sliders().length === want, 10000),
       'one slider per unnamed atom (' + want + ', got ' + sliders().length + ')');
assert(document.querySelectorAll('#explore-list .axis-cat-group').length > 1,
       'atoms are grouped');

// A named atom must have exactly one slider in the whole app — the bank's.
// Two sliders on one direction is the bug this list used to have: explore's
// value overwrote the bank's in collectAxisControls, so the bank's silently
// stopped counting.
const dupKey = 'sae.' + namedAtoms[0].atom;
assert(document.querySelectorAll('#explore-list .ctl[data-key="' + dupKey + '"]').length === 0,
       dupKey + ' is named — the axis bank owns it, explore must not repeat it');
assert(document.querySelectorAll('#axis-categories .ctl[data-key="' + dupKey + '"]').length === 1,
       dupKey + ' has exactly one slider, in the axis bank');

// No empty groups: skipping a named atom must not leave a bare header behind.
document.querySelectorAll('#explore-list .axis-cat-group').forEach((g) => {
  assert(g.querySelectorAll('.ctl').length > 0, 'every group header has rows under it');
});

// ── verdicts ──────────────────────────────────────────────────────────────
// The point of shipping them: atom 214 replaces the subject with a castle and
// is one of the STRONGEST movers in the file, so ordering alone puts it near the
// top. A badge is the only thing standing between that and a wasted render.
// Start from a known state: marks persist across sessions, so whatever the last
// real session (or the last test run) believed about an atom is still in prefs.
$('btn-marks-clear').click();
flush();

let vjson = null;
fetch('assets/sae_verdicts.json').then((r) => r.json()).then((j) => { vjson = j; });
assert(pumpUntil(() => vjson !== null, 10000), 'sae_verdicts.json fetched');
const verdicts = vjson.verdicts;
const atomRow = (a) => document.querySelector('#explore-list .ctl[data-key="sae.' + a + '"]');

Object.keys(verdicts).forEach((a) => {
  // Every verdict must land on a row — a typo'd atom id would silently do nothing.
  const row = atomRow(a);
  assert(row, 'verdict for sae.' + a + ' has a row to land on');
  const badge = row.querySelector('.atom-verdict');
  assert(badge && badge.classList.contains('show'), 'sae.' + a + ' shows a badge');
  assert(badge.classList.contains('v-' + verdicts[a].v),
         'sae.' + a + ' badge reads ' + verdicts[a].v);
  assert(!badge.classList.contains('mine'), 'a shipped verdict is not marked as yours');
});
// An unjudged atom carries no badge — silence is the honest majority state.
const plain = Array.prototype.filter.call(sliders(),
  (r) => !verdicts[r.getAttribute('data-key').slice(4)]);
assert(plain.length > 300, 'most atoms are unjudged (' + plain.length + ')');
assert(!plain[0].querySelector('.atom-verdict').classList.contains('show'),
       'an unjudged atom shows no badge');

// Filtering by verdict.
function shownCount() {
  let n = 0;
  sliders().forEach((r) => { if (r.style.display !== 'none') n++; });
  return n;
}
function setVerdictFilter(v) {
  $('explore-verdict').value = v;
  $('explore-verdict').dispatchEvent(new Event('change'));
  flush();
}
const shipped = Object.keys(verdicts);
const nKeep = shipped.filter((a) => verdicts[a].v === 'keep').length;
const nRej = shipped.length - nKeep;
setVerdictFilter('promising');
assert(shownCount() === nKeep, 'the keep filter shows exactly the keeps (' + nKeep + ')');
setVerdictFilter('rejected');
assert(shownCount() === nRej, 'the reject filter shows exactly the rejects (' + nRej + ')');
setVerdictFilter('unjudged');
assert(shownCount() === want - shipped.length, 'the rest are unjudged');

// Your own mark wins over silence, and over a shipped verdict.
setVerdictFilter('all');
const mineRow = plain[0], mineAtom = mineRow.getAttribute('data-key').slice(4);
mineRow.querySelector('.atom-mark.keep').click();
flush();
assert(mineRow.querySelector('.atom-verdict').classList.contains('mine'),
       'your mark is badged as yours, not as somebody else\'s judgement');
setVerdictFilter('promising');
assert(shownCount() === nKeep + 1, 'your keep joins the keeps');

// A hijack you disagree with is yours to overrule.
const hijack = shipped.find((a) => verdicts[a].v === 'hijack');
setVerdictFilter('all');
atomRow(hijack).querySelector('.atom-mark.keep').click();
flush();
setVerdictFilter('rejected');
assert(shownCount() === nRej - 1, 'overruling a hijack takes it out of the rejects');

// Clicking the same mark again hands the atom back to the shipped verdict.
setVerdictFilter('all');
atomRow(hijack).querySelector('.atom-mark.keep').click();
flush();
setVerdictFilter('rejected');
assert(shownCount() === nRej, 'clearing your mark restores the shipped verdict');
// And the clear-all path, which is what let this test start from a known state.
setVerdictFilter('all');
assert($('btn-marks-clear').style.display !== 'none', 'the clear-marks button shows once you have marks');
$('btn-marks-clear').click();
flush();
assert(atomRow(mineAtom).querySelector('.atom-verdict').classList.contains('show') === false,
       'forgetting your marks takes the badge back off an unjudged atom');
assert($('btn-marks-clear').style.display === 'none', 'and the button hides again');
setVerdictFilter('promising');
assert(shownCount() === nKeep, 'and the keeps are back to the shipped ones');
setVerdictFilter('all');

document.querySelector('.secbtn[data-sec="explore"]').click();
flush();
assert($('sec-explore').classList.contains('active'), 'explore section shows');

// Strongest mover first: the list is pre-sorted, so row 1 must out-actuate row N.
assert(index[0].act >= index[index.length - 1].act, 'strongest movers are at the top');

// Turning a slider reaches the generate call. This is the load-bearing one: a
// list you can scroll is useless if the knobs do not go on the wire.
const first = sliders()[0];
const key = first.getAttribute('data-key');
const range = first.querySelector('input[type=range]');
range.value = '3.5';
range.dispatchEvent(new Event('input'));
flush();
const ac = window.__ctx.collectAxisControls();
assert(ac[key] === 3.5, 'a turned slider reaches generate (got ' + JSON.stringify(ac) + ')');

// Filtering must not hide a slider that is currently ON — that would be lying
// about what is shaping the image.
$('explore-minact').value = '0.4';
$('explore-minact').dispatchEvent(new Event('input'));
flush();
assert(first.style.display !== 'none', 'a turned-up slider stays visible through a filter');
assert(window.__ctx.collectAxisControls()[key] === 3.5, 'and keeps injecting');

// Zeroed, it may be filtered away — and then it must stop injecting.
range.value = '0';
range.dispatchEvent(new Event('input'));
$('explore-minact').dispatchEvent(new Event('input'));
flush();
assert(window.__ctx.collectAxisControls()[key] === undefined, 'a zeroed slider injects nothing');

// reset zeroes the whole discovered bank — and NOTHING else. The old assertion
// here was `collectAxisControls()` is empty, which is a claim about the entire
// app; it passed only when the saved prefs happened to hold no axis-bank values,
// and failed the moment a real session had left one turned up. What reset owes
// you is that every atom is off and that it did not reach into the axis bank.
// Turn a NAMED bank axis up first, so this run always has something for reset to
// leave alone — depending on whatever the saved prefs happen to hold would make
// the check silently vacuous (and it was: a previous test run zeroing the bank
// was enough to stop it testing anything).
const bankRow = document.querySelector('#axis-categories .ctl');
const bankKey = bankRow.getAttribute('data-key');
const bankRange = bankRow.querySelector('input[type=range]');
bankRange.value = '1.75';
bankRange.dispatchEvent(new Event('input'));
flush();
assert(window.__ctx.collectAxisControls()[bankKey] === 1.75, 'a bank axis is turned up');

const before = window.__ctx.collectAxisControls();
const r2 = sliders()[0].querySelector('input[type=range]');
r2.value = '2'; r2.dispatchEvent(new Event('input')); flush();
$('btn-explore-reset').click();
flush();
const after = window.__ctx.collectAxisControls();
assert(Object.keys(after).filter((k) => k.indexOf('sae.') === 0).length === 0,
       'reset zeroes every atom (left ' + JSON.stringify(after) + ')');
Object.keys(before).forEach((k) => {
  assert(after[k] === before[k], 'reset left the axis bank alone (' + k + ')');
});

console.log('PASS: ' + want + ' unnamed sliders (' + namedAtoms.length +
            ' named atoms left to the bank), grouped, sorted, and they reach generate');
