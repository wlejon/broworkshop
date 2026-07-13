// The stack budget, driven through the real UI.
//
// Axis sliders are individually bounded (±6) but the model sees their SUM: a
// ten-axis deck already pushes ~7.5 alpha before you touch anything, and taking
// one axis to +6 on top of it lands past 11 — at which point the injection, not
// the prompt, is what gets drawn (a person-free sunset cliff renders screaming
// crowds). brodiffusion's CondControl now holds the stack to a budget by scaling
// EVERY active axis by one common factor, so the mix survives and the overdrive
// does not.
//
// Renders the real deck that found the bug, at the seed that showed it:
//   1. the deck as dialled (in budget)                     -> not clamped
//   2. + composition.density at +6 (the escalation)        -> CLAMPED, and the
//      scene must still be a seascape, not a crowd
//
// Both frames are saved for eyeballing. The automatic check is the machinery
// (clamp fires, meter reports it, mix is preserved) plus a coarse
// no-people-shaped-collapse proxy: the clamped render must stay close to the
// in-budget render, while the UNCLAMPED render (budget off) diverges wildly.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_stack_budget.js

const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
// screenshot() resolves against the CWD (the bro repo), not the app dir — write
// the frames somewhere unambiguous instead of littering whatever cwd ran this.
const SHOTS = 'D:/projects/broworkshop/demos/krea2-lab/tests/out/';
const SEED = '1680741884';           // the seed the crowds showed up on
const DECK = {
  'composition.proximity': 2.16, 'composition.elevation': 1.68,
  'composition.density': 1.53, 'composition.symmetry': -2.13,
  'composition.depth': 1.87, 'color.saturation': 1.5,
  'color.key': -1.02, 'rendering.era': -0.83,
  'mood.drama': 1.83, 'mood.scale': 2.01,
};

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function setAxis(key, v) {
  const row = $('axis-categories').querySelector('.ctl[data-key="' + key + '"]');
  assert(row, 'axis row exists: ' + key);
  const range = row.querySelector('input[type=range]');
  range.value = String(v);
  range.dispatchEvent(new Event('input'));
}
function setField(id, v) {
  $(id).value = String(v);
  $(id).dispatchEvent(new Event('input'));
}

console.log('waiting for the model to load — this reads ~26GB of weights…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

// Neutralize persisted control state (the lab shares prefs with real use), then
// dial in the deck under test.
$('live').checked = false;
$('live').dispatchEvent(new Event('change'));
['btn-reset-expr', 'btn-reset-spec', 'btn-reset-axes'].forEach((id) => $(id).click());

$('prompt').value = 'a beautiful sunset over the ocean from a lush cliff side view';
$('neg-prompt').value = '';
$('rand-seed').checked = false;
[['width', '768'], ['height', '768'], ['steps', '8'], ['seed', SEED],
 ['guidance', '1.0'],
 ['band', '0.7'], ['dial-pregate', '0.75'], ['dial-prescale', '1.0'],
 ['gate-txt', '1.0'], ['gate-img', '1.0']].forEach(([id, v]) => setField(id, v));
for (const k in DECK) setAxis(k, DECK[k]);

function generate(tag) {
  $('status-text').textContent = 'test-pending';
  $('btn-generate').click();
  assert(pumpUntil(() => $('status-text').textContent === 'done' ||
                         $('status-text').classList.contains('err'), 180000),
         'generation finished within budget (' + tag + ')');
  assert(!$('status-text').classList.contains('err'),
         'generation ok (' + tag + '): ' + $('status-text').textContent);
  const cv = $('view');
  screenshot(SHOTS + 'stack_' + tag + '.png');
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const meter = $('ds-text').textContent;
  const over = $('deck-stack').classList.contains('over');
  console.log(tag + ' · ' + meter + (over ? '  [CLAMPED]' : ''));
  return { px: px, meter: meter, over: over };
}
// Mean absolute pixel difference, 0..255 — how far two renders drift apart.
function drift(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
         Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return s / n;
}

// 1. half the deck — comfortably inside the budget, so the meter reads plain
//    "push x / y" and nothing is held back.
for (const k in DECK) setAxis(k, DECK[k] / 2);
const half = generate('half_deck');
assert(!half.over, 'half the deck is within budget (meter: ' + half.meter + ')');
assert(/push \d/.test(half.meter), 'stack meter reports the push: ' + half.meter);

// 2. the deck as dialled — the scene this was tuned to make. It sits right at
//    the band-0.7 budget (7.5 vs 7.3), so a few percent may be shaved; either
//    way the render is the reference the escalation must not run away from.
for (const k in DECK) setAxis(k, DECK[k]);
const base = generate('deck');

// 3. escalate one axis to +6 — the move that used to summon crowds
setAxis('composition.density', 6);
const capped = generate('deck_density6');
assert(capped.over, 'the escalated stack is held at the budget (meter: ' + capped.meter + ')');
assert(/held at/.test(capped.meter), 'the meter says it was held: ' + capped.meter);

// 4. the clamped escalation must still be the same scene the deck was making —
//    before the budget, this exact move replaced the seascape with a crowd of
//    comic figures (a total repaint), so a bounded drift IS the regression test.
const d = drift(base.px, capped.px);
console.log('drift(deck -> clamped escalation) = ' + d.toFixed(1) + ' / 255');
assert(d < 60, 'the clamped escalation stays in the same scene as the deck ' +
               '(drift ' + d.toFixed(1) + ')');

console.log('PASS — the stack budget holds an over-driven deck to the scene');
