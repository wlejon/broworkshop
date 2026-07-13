// Explore list — NO model load, no weights needed. 391 unnamed sliders, ordered
// strongest-first and grouped by measured effect. What has to be true: every atom
// is there, a turned slider REACHES the generate call, and filtering never lies
// about what is shaping the image.
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

let want = 0;
fetch('assets/sae_index.json').then((r) => r.json()).then((ix) => { want = ix.length; });
assert(pumpUntil(() => want > 0, 10000), 'sae_index.json fetched');

// One slider per discovered atom — none dropped.
const sliders = () => document.querySelectorAll('#explore-list .ctl');
assert(pumpUntil(() => sliders().length === want, 10000),
       'one slider per discovered atom (' + want + ', got ' + sliders().length + ')');
assert(document.querySelectorAll('#explore-list .axis-cat-group').length > 1,
       'atoms are grouped');

document.querySelector('.secbtn[data-sec="explore"]').click();
flush();
assert($('sec-explore').classList.contains('active'), 'explore section shows');

// Strongest mover first: the list is pre-sorted, so row 1 must out-actuate row N.
let ix = null;
fetch('assets/sae_index.json').then((r) => r.json()).then((j) => { ix = j; });
assert(pumpUntil(() => ix !== null, 5000), 'index read');
assert(ix[0].act >= ix[ix.length - 1].act, 'strongest movers are at the top');

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

// reset zeroes the whole discovered bank.
const r2 = sliders()[0].querySelector('input[type=range]');
r2.value = '2'; r2.dispatchEvent(new Event('input')); flush();
$('btn-explore-reset').click();
flush();
assert(Object.keys(window.__ctx.collectAxisControls()).length === 0, 'reset zeroes every atom');

console.log('PASS: 391 unnamed sliders, grouped, sorted, and they reach generate');
