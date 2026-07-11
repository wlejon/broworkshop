// Identity Breeding test: render a character, capture two probes (neutral +
// a dramatic axis-bank shift), breed the identity noise for two generations,
// and verify — all through the real UI — that the generations grid fills
// with scored strips, elites are marked, the final identity strip renders at
// every probe, "use identity" makes Generate start from the bred latent
// (timing note), and the per-size guard rejects a mismatched render size.
// Saves the identity strip and identity-on renders for eyeball verification
// (the same character should appear in both the neutral and dramatic cells).
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_identity_search.js

const OUT_DIR = require('os').tmpdir().replace(/\\/g, '/') + '/krea2-idbreed-test';
const SEED_A = 12345;
const PROMPT = 'a young prince with golden hair in an ornate dark coat walking a ' +
               'stone path through an autumn forest, storybook illustration';
const POP = 3, GENS = 2, PROBES = 2;

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

function generateOk(label) {
  $('status-text').textContent = '';
  $('btn-generate').click();
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), 180000),
         label + ' finished');
  assert(!$('status-text').classList.contains('err'),
         label + ' ok: ' + $('status-text').textContent);
}

require('fs').mkdirSync(OUT_DIR, { recursive: true });

// ── load + neutral state ─────────────────────────────────────────────────────
console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled || $('status-text').classList.contains('err'),
                 600000), 'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);
assert(pumpUntil(() => !!document.querySelector('.ctl[data-key="mood.drama"]'),
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

// ── base render → exemplar ───────────────────────────────────────────────────
console.log('generating the reference character…');
generateOk('base render');
saveView('base');

$('btn-ids-add').click();
console.log('loading scorer + embedding exemplar…');
assert(pumpUntil(() => $('ids-status').textContent.indexOf('exemplar added') === 0 ||
                       $('ids-status').classList.contains('err'), 300000),
       'exemplar added within budget (status: ' + $('ids-status').textContent + ')');
assert(!$('ids-status').classList.contains('err'),
       'exemplar embed ok: ' + $('ids-status').textContent);
assert(document.querySelectorAll('.ids-ex').length === 1, 'one exemplar in the model');

// ── probes: neutral + a hard dramatic shift through the axis bank ────────────
$('btn-ids-probe').click();
assert(document.querySelectorAll('.ids-probe').length === 1, 'neutral probe captured');
setAxis('mood.drama', 6);
$('btn-ids-probe').click();
assert(document.querySelectorAll('.ids-probe').length === 2, 'dramatic probe captured');
setAxis('mood.drama', 0);

// ── breed ────────────────────────────────────────────────────────────────────
$('ids-pop').value = String(POP);
$('ids-gens').value = String(GENS);
$('ids-drift').value = '0.3';
$('btn-ids-breed').click();
console.log('breeding ' + GENS + ' generations of ' + POP + ' children over ' +
            PROBES + ' probes…');
assert(pumpUntil(() => $('ids-status').textContent.indexOf('breed done') === 0 ||
                       $('ids-status').classList.contains('err'), 600000),
       'breed finished within budget (status: ' + $('ids-status').textContent + ')');
assert(!$('ids-status').classList.contains('err'),
       'breed ok: ' + $('ids-status').textContent);
console.log($('ids-status').textContent + ' · ' + $('ids-timing').textContent);

// ── the generations grid ─────────────────────────────────────────────────────
const gens = document.querySelectorAll('#ids-grid .ids-gen');
assert(gens.length === GENS, GENS + ' generation blocks (got ' + gens.length + ')');
for (let g = 0; g < gens.length; g++) {
  const strips = gens[g].querySelectorAll('.ids-strip');
  assert(strips.length === POP + 1,
         'generation has keeper + ' + POP + ' children (got ' + strips.length + ')');
  for (let s = 0; s < strips.length; s++) {
    const cells = strips[s].querySelectorAll('canvas');
    assert(cells.length === PROBES,
           'strip rendered at every probe (got ' + cells.length + ')');
    const sc = parseFloat(strips[s].querySelector('.ids-strip-score').textContent);
    assert(!isNaN(sc) && sc >= -1.001 && sc <= 1.001,
           'strip score is a cosine (got ' + sc + ')');
  }
  const elites = gens[g].querySelectorAll('.ids-strip.elite');
  assert(elites.length === 2, 'two elites marked per generation (got ' + elites.length + ')');
}

// ── the bred identity ────────────────────────────────────────────────────────
assert($('ids-ident-meta').textContent.indexOf(GENS + ' generations bred') >= 0,
       'identity meta reports the breed: ' + $('ids-ident-meta').textContent);
assert($('ids-ident-meta').textContent.indexOf('512×512') >= 0,
       'identity meta reports the size: ' + $('ids-ident-meta').textContent);
const identStrip = document.querySelectorAll('#ids-identity .ids-strip');
assert(identStrip.length === 1, 'one pinned identity strip');
const identCells = identStrip[0].querySelectorAll('canvas');
assert(identCells.length === PROBES, 'identity strip rendered at every probe');
const identScore = parseFloat(identStrip[0].querySelector('.ids-strip-score').textContent);
assert(!isNaN(identScore) && identScore > 0,
       'identity strip scored (got ' + identScore + ')');
for (let i = 0; i < identCells.length; i++) {
  identCells[i].onclick();
  saveView('identity_probe_' + (i + 1));
}

// ── "use identity": Generate starts from the bred latent ────────────────────
assert(!$('ids-use').disabled, 'use-identity toggle enabled after breeding');
assert($('ids-use').checked, 'use identity AUTO-enabled by the breed');
assert($('ids-plan').textContent.indexOf('renders') >= 0,
       'planned render count shown: ' + $('ids-plan').textContent);
let chipFound = false;
const chips = document.querySelectorAll('.deck-chip');
for (let i = 0; i < chips.length; i++) {
  if (chips[i].textContent.indexOf('bred identity') >= 0) chipFound = true;
}
assert(chipFound, 'active-controls deck shows the bred-identity chip');
console.log('rendering with the bred identity…');
generateOk('identity render (neutral)');
assert($('timing').textContent.indexOf('bred identity latent') >= 0,
       'timing notes the bred latent: ' + $('timing').textContent);
saveView('identity_on_neutral');

setAxis('mood.drama', 6);
generateOk('identity render (dramatic)');
assert($('timing').textContent.indexOf('bred identity latent') >= 0,
       'dramatic render used the bred latent too');
saveView('identity_on_dramatic');
setAxis('mood.drama', 0);

// ── per-size guard: noise is bred at 512×512 ─────────────────────────────────
$('width').value = '768';
$('status-text').textContent = '';
$('btn-generate').click();
assert(pumpUntil(() => $('status-text').classList.contains('err'), 60000),
       'mismatched size rejected');
assert($('status-text').textContent.indexOf('bred at') >= 0,
       'guard names the bred size: ' + $('status-text').textContent);
$('width').value = '512';

// ── the one-button flow: clear everything, just press Breed ──────────────────
// Exemplar comes from the current render, probes from the default set; the
// scorer reloads after its post-breed dispose. Tiny run: 1 gen × 3 rows ×
// 3 auto probes + 3 = 12 renders.
$('btn-ids-clear').click();
assert(document.querySelectorAll('.ids-ex').length === 0, 'model cleared');
assert(document.querySelectorAll('.ids-probe').length === 0, 'probes cleared');
assert(!$('ids-use').checked, 'use identity off after clear');
$('ids-pop').value = '2';
$('ids-gens').value = '1';
$('btn-ids-breed').click();
console.log('one-button breed (auto exemplar + auto probes)…');
assert(pumpUntil(() => $('ids-status').textContent.indexOf('breed done') === 0 ||
                       $('ids-status').classList.contains('err'), 600000),
       'auto breed finished (status: ' + $('ids-status').textContent + ')');
assert(!$('ids-status').classList.contains('err'),
       'auto breed ok: ' + $('ids-status').textContent);
assert(document.querySelectorAll('.ids-ex').length === 1,
       'exemplar auto-added from the current render');
const autoProbes = document.querySelectorAll('.ids-probe');
assert(autoProbes.length === 3, 'default probe set built (got ' + autoProbes.length + ')');
let autoLabeled = 0;
for (let i = 0; i < autoProbes.length; i++) {
  if (autoProbes[i].textContent.indexOf('auto') >= 0) autoLabeled++;
}
assert(autoLabeled === 3, 'auto probes labelled as such');
assert($('ids-use').checked, 'use identity auto-enabled again');
const autoCells = document.querySelectorAll('#ids-identity .ids-strip canvas');
assert(autoCells.length === 3, 'identity strip covers all three auto probes');
for (let i = 0; i < autoCells.length; i++) {
  autoCells[i].onclick();
  saveView('auto_probe_' + (i + 1));
}

// ── history "exemplar" action feeds the model directly ──────────────────────
const histBtns = document.querySelectorAll('.hist-actions button');
let exBtn = null;
for (let i = 0; i < histBtns.length; i++) {
  if (histBtns[i].textContent === 'exemplar') { exBtn = histBtns[i]; break; }
}
assert(exBtn, 'history cards offer an exemplar action');
exBtn.click();
assert(pumpUntil(() => $('ids-status').textContent.indexOf('exemplar added') === 0 ||
                       $('ids-status').classList.contains('err'), 300000),
       'history exemplar embedded (status: ' + $('ids-status').textContent + ')');
assert(document.querySelectorAll('.ids-ex').length === 2,
       'model grew from the history card');

console.log('PASS — identity breeding works through the real UI · renders in ' + OUT_DIR);
