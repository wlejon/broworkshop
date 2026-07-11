// Identity Search test: build an identity model from a render, shift the
// scene hard (prompt-level), and search seed space for the character under
// the new conditions — all through the real UI. Asserts the scorer loads
// (DINOv3 + BiRefNet), candidates land ranked, and accepting a candidate
// adopts its seed and grows the identity model. Saves the base render and
// the ranked candidates to the OS temp dir for eyeball verification.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_identity_search.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-idsearch-test';
const SEED_A = 12345;
const PROMPT = 'a young prince with golden hair in an ornate dark coat walking a ' +
               'stone path through an autumn forest, storybook illustration';
const SHIFTED = 'overhead aerial view, seen from high above: ' + PROMPT;
const CANDIDATES = 4;

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

require('fs').mkdirSync(OUT_DIR, { recursive: true });

// ── load + neutral state ─────────────────────────────────────────────────────
console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000), 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

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

// ── shift the scene hard, then search seed space for the character ──────────
$('prompt').value = SHIFTED;
$('ids-count').value = String(CANDIDATES);
$('btn-ids-search').click();
console.log('searching ' + CANDIDATES + ' seeds under the shifted scene…');
assert(pumpUntil(() => $('ids-status').textContent.indexOf('search done') === 0 ||
                       $('ids-status').classList.contains('err'), 600000),
       'search finished within budget (status: ' + $('ids-status').textContent + ')');
assert(!$('ids-status').classList.contains('err'),
       'search ok: ' + $('ids-status').textContent);
console.log($('ids-status').textContent + ' · ' + $('ids-timing').textContent);

// ── ranked candidates ────────────────────────────────────────────────────────
const cells = document.querySelectorAll('.ids-cell');
assert(cells.length === CANDIDATES, CANDIDATES + ' candidates rendered (got ' + cells.length + ')');
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
  saveView('candidate_' + (i + 1) + '_score_' + scores[i].toFixed(3).replace('.', 'p'));
}

// ── accept the best ──────────────────────────────────────────────────────────
const acceptBtn = cells[0].querySelector('.ids-cell-meta button');
const seedText = cells[0].querySelector('.ids-cell-meta span').textContent;
const bestSeed = +seedText.replace('seed ', '');
acceptBtn.click();
assert($('ids-status').textContent.indexOf('accepted seed ' + bestSeed) === 0,
       'accept confirmed: ' + $('ids-status').textContent);
assert(+$('seed').value === bestSeed, 'seed field adopted the accepted seed');
assert(!$('rand-seed').checked, 'seed stays pinned');
assert(document.querySelectorAll('.ids-ex').length === 2,
       'identity model grew to two exemplars');

console.log('PASS — identity search works through the real UI · renders in ' + OUT_DIR);
