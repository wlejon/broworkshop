// Explore grid — NO model load, no weights needed. The grid is built from
// assets/sae_index.json and the strips are pre-rendered, so browsing 391 atoms
// costs nothing; taking one has to produce a live axis that actually reaches the
// generate call, which is what this checks.
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

// One cell per atom in the index — every atom the sweep rendered, none dropped.
let want = 0;
fetch('assets/sae_index.json').then((r) => r.json()).then((ix) => { want = ix.length; });
assert(pumpUntil(() => want > 0, 10000), 'sae_index.json fetched');
assert(pumpUntil(() => document.querySelectorAll('#explore-grid .explore-cell').length === want, 10000),
       'grid has one cell per discovered atom (' + want + ')');

document.querySelector('.secbtn[data-sec="explore"]').click();
flush();
assert($('sec-explore').classList.contains('active'), 'explore section shows');

// Taking an atom promotes it to a live slider.
const cell = document.querySelector('#explore-grid .explore-cell');
const atom = cell.getAttribute('data-atom');
assert($('explore-picked').querySelectorAll('.ctl').length === 0, 'nothing taken yet');
cell.click();
flush();
assert(cell.classList.contains('picked'), 'cell marks as taken');
const row = $('explore-picked').querySelector('.ctl[data-key="sae.' + atom + '"]');
assert(row, 'taking an atom adds its slider');

// ...and a nonzero slider reaches the generate call. This is the load-bearing
// assertion: a strip you can look at is useless if turning its knob does nothing.
const range = row.querySelector('input[type=range]');
range.value = '3.5';
range.dispatchEvent(new Event('input'));
flush();
const ac = window.__ctx ? window.__ctx.collectAxisControls() : null;
assert(ac, 'ctx exposed for the test');
assert(ac['sae.' + atom] === 3.5,
       'taken axis reaches the generate call (got ' + JSON.stringify(ac) + ')');

// Dropping it takes it back out of the stack — a removed slider must stop injecting.
cell.click();
flush();
assert(!$('explore-picked').querySelector('.ctl[data-key="sae.' + atom + '"]'), 'dropped');
const ac2 = window.__ctx.collectAxisControls();
assert(ac2['sae.' + atom] === undefined, 'dropped axis no longer injects');

// Filtering by atom number narrows the grid without losing the taken ones.
$('explore-filter').value = String(atom);
$('explore-filter').dispatchEvent(new Event('input'));
flush();
const shown = document.querySelectorAll('#explore-grid .explore-cell').length;
assert(shown > 0 && shown < want, 'filter narrows the grid (' + shown + ' of ' + want + ')');

console.log('PASS: explore grid, take/drop, and the taken axis reaches generate');
