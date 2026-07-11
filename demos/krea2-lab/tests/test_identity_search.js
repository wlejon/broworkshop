// Identity Search test: build an identity model from a render, shift the
// scene through the AXIS BANK (the real workflow — not just the prompt), and
// search seed space for the character under the shifted conditions — all
// through the real UI. Asserts the scorer loads (DINOv3 + BiRefNet), that
// axis-bank slider values ride the search candidates, that the first search
// scores absolute + stores residuals, that a search after accepting a
// search-born exemplar scores scene-relative, and that a second accept from
// the same batch REPLACES the first (one exemplar per scene). Saves the base
// render and both searches' ranked candidates to the OS temp dir for eyeball
// verification (search-1 candidates must all read aerial; search-2 dramatic).
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_identity_search.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-idsearch-test';
const SEED_A = 12345;
const PROMPT = 'a young prince with golden hair in an ornate dark coat walking a ' +
               'stone path through an autumn forest, storybook illustration';
const CANDIDATES = 4;   // == RESID_MIN_BATCH, so residuals compute

function $(id) { return document.getElementById(id); }

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

function saveView(label) {
  const view = $('view');
  const img = view.getContext('2d').getImageData(0, 0, view.width, view.height);
  bro.image.encodePngFile(OUT_DIR + '/' + label + '.png', img.data, view.width, view.height, 4);
  console.log('saved ' + OUT_DIR + '/' + label + '.png');
}

function setAxis(key, v) {
  const range = document.querySelector('.ctl[data-key="' + key + '"] input[type=range]');
  assert(range, 'axis-bank slider exists for ' + key);
  range.value = String(v);
  range.dispatchEvent(new Event('input'));
  range.dispatchEvent(new Event('change'));
}

function runSearch(label) {
  $('ids-count').value = String(CANDIDATES);
  $('btn-ids-search').click();
  console.log('searching ' + CANDIDATES + ' seeds (' + label + ')…');
  assert(pumpUntil(() => $('ids-status').textContent.indexOf('search done') === 0 ||
                         $('ids-status').classList.contains('err'), 600000),
         label + ' finished within budget (status: ' + $('ids-status').textContent + ')');
  assert(!$('ids-status').classList.contains('err'),
         label + ' ok: ' + $('ids-status').textContent);
  console.log($('ids-status').textContent + ' · ' + $('ids-timing').textContent);

  const cells = document.querySelectorAll('.ids-cell');
  assert(cells.length === CANDIDATES,
         CANDIDATES + ' candidates rendered (got ' + cells.length + ')');
  const scores = [];
  for (let i = 0; i < cells.length; i++) {
    const s = parseFloat(cells[i].querySelector('.ids-score').textContent);
    assert(!isNaN(s) && s >= -1.001 && s <= 1.001, 'score ' + i + ' is a cosine (got ' + s + ')');
    scores.push(s);
  }
  for (let i = 1; i < scores.length; i++) {
    assert(scores[i - 1] >= scores[i], 'candidates ranked descending (' + scores.join(', ') + ')');
  }
  console.log('scores: ' + scores.join(', '));

  // Save the ranked candidates for eyeball verification (click → view → save).
  for (let i = 0; i < cells.length; i++) {
    cells[i].querySelector('canvas').onclick();
    saveView(label + '_candidate_' + (i + 1) + '_score_' + scores[i].toFixed(3).replace('.', 'p'));
  }
  return cells;
}

function acceptCell(cell) {
  const btn = cell.querySelector('.ids-cell-meta button');
  const seed = +cell.querySelector('.ids-cell-meta span').textContent.replace('seed ', '');
  btn.click();
  return seed;
}

require('fs').mkdirSync(OUT_DIR, { recursive: true });

// ── load + neutral state ─────────────────────────────────────────────────────
console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000), 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);
assert(pumpUntil(() => !!document.querySelector('.ctl[data-key="composition.elevation"]'),
                 30000), 'axis bank built');

if ($('live').checked) $('live').click();
assert(!$('live').checked, 'live toggle off via click()');
if (!$('btn-deck-clear').disabled) $('btn-deck-clear').click();
$('rand-seed').checked = false;
$('width').value = '512';
$('height').value = '512';
$('steps').value = '4';
$('guidance').value = '1.0';
$('prompt').value = PROMPT;
$('neg-prompt').value = '';
$('seed').value = String(SEED_A);

// ── base render → first exemplar ─────────────────────────────────────────────
$('status-text').textContent = '';
$('btn-generate').click();
console.log('generating the reference character…');
assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                       $('status-text').classList.contains('err'), 180000),
       'base render finished');
assert(!$('status-text').classList.contains('err'), 'base render ok');
saveView('base_ground');

$('btn-ids-add').click();
console.log('loading scorer + embedding exemplar…');
assert(pumpUntil(() => $('ids-status').textContent.indexOf('exemplar added') === 0 ||
                       $('ids-status').classList.contains('err'), 300000),
       'exemplar added within budget (status: ' + $('ids-status').textContent + ')');
assert(!$('ids-status').classList.contains('err'),
       'exemplar embed ok: ' + $('ids-status').textContent);
assert(document.querySelectorAll('.ids-ex').length === 1, 'one exemplar in the model');

// ── shift 1: ground → aerial through the axis bank, then search ──────────────
// The only exemplar came from "+ current render" (no residual), so this
// search must score absolute — but still store batch residuals so the accept
// seeds scene-relative scoring.
setAxis('composition.elevation', 6);
const cells1 = runSearch('aerial');
assert($('ids-status').textContent.indexOf('residuals stored') >= 0,
       'first search scored absolute with residuals stored: ' + $('ids-status').textContent);

const seed1 = acceptCell(cells1[0]);
assert($('ids-status').textContent.indexOf('accepted seed ' + seed1) === 0,
       'accept confirmed: ' + $('ids-status').textContent);
assert(+$('seed').value === seed1, 'seed field adopted the accepted seed');
assert(!$('rand-seed').checked, 'seed stays pinned');
assert(document.querySelectorAll('.ids-ex').length === 2,
       'identity model grew to two exemplars');

// ── shift 2: back to ground, dramatic — the model now scores scene-relative ──
setAxis('composition.elevation', 0);
setAxis('mood.drama', 6);
const cells2 = runSearch('dramatic');
assert($('ids-status').textContent.indexOf('scene-relative') >= 0,
       'second search scored scene-relative: ' + $('ids-status').textContent);

// ── one exemplar per scene: a second accept from the same batch replaces ─────
const seed2a = acceptCell(cells2[0]);
assert(document.querySelectorAll('.ids-ex').length === 3,
       'accepting in a new scene appends (three exemplars)');
// accept re-renders the grid — re-query for live nodes (order is unchanged)
const seed2b = acceptCell(document.querySelectorAll('.ids-cell')[1]);
assert(seed2b !== seed2a, 'second accept is a different candidate');
assert($('ids-status').textContent.indexOf('replaced') >= 0,
       'second accept replaced, not stacked: ' + $('ids-status').textContent);
assert(document.querySelectorAll('.ids-ex').length === 3,
       'identity model still has three exemplars after the replace');
const cellsAfter = document.querySelectorAll('.ids-cell');
let acceptedCount = 0;
for (let i = 0; i < cellsAfter.length; i++) {
  if (cellsAfter[i].className.indexOf('accepted') >= 0) acceptedCount++;
}
assert(acceptedCount === 1, 'exactly one candidate marked accepted (got ' + acceptedCount + ')');

console.log('PASS — identity search works through the real UI · renders in ' + OUT_DIR);
