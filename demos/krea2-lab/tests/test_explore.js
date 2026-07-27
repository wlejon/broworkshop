// Explore list — NO model load, no weights needed. One slider per UNNAMED atom,
// ordered strongest-first and grouped by measured effect. What has to be true:
// every unnamed atom is there, the atoms the axis bank already names are NOT
// (one direction, one slider), a turned slider REACHES the generate call, and
// filtering never lies about what is shaping the image.
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
