// UI-machinery test — NO model load, no weights needed. Exercises the
// sectioned rail, the expression word picker's exclusivity, the deck
// (active-control chips + reset all), and the per-section count badges.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_ui.js
//
// The first line blanks the model directory BEFORE the worker's ready
// message can pump (message delivery needs an event-loop turn, and this
// script runs to its first flush()/sleep() without one), so the app's
// auto-load never fires.

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';

flush();
advanceTime(300);
flush();

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
// the axis bank builds when the axes_meta.json fetch lands
assert(pumpUntil(() => document.querySelectorAll('#axis-categories .ctl').length === 18, 10000),
       'axis bank built');

// Neutralize persisted control state — the lab shares its prefs with real
// use. One click: the deck's "reset all" returns every registered control
// to neutral (which is itself under test here).
document.getElementById('btn-deck-clear').click();
flush();
assert(document.querySelectorAll('.deck-chip').length === 0, 'deck empty after reset all');

// ── sections ──────────────────────────────────────────────────────────────
function sec(name) { return document.querySelector('.secbtn[data-sec="' + name + '"]'); }
['scene', 'character', 'face', 'look', 'mint', 'tune'].forEach((s) => assert(sec(s), 'section tab ' + s));
sec('face').click(); flush();
assert(document.getElementById('sec-face').classList.contains('active'), 'face section shows');
assert(!document.getElementById('sec-scene').classList.contains('active'), 'scene section hidden');

// ── expression picker: radio chips + one strength slider ─────────────────
const chips = $('expr-words').querySelectorAll('.word-chip');
assert(chips.length === 10, 'ten word chips');
const strength = $('expr-strength-row').querySelector('input[type=range]');
assert(strength, 'strength slider exists');
function chip(label) {
  for (let i = 0; i < chips.length; i++) if (chips[i].textContent === label) return chips[i];
  return null;
}
chip('anger').click(); flush();
assert(chip('anger').classList.contains('sel'), 'anger selected');
assert(+strength.value === 1, 'picking a word arms strength at 1 (got ' + strength.value + ')');
chip('happiness').click(); flush();
assert(!chip('anger').classList.contains('sel'), 'happiness deselected anger (exclusive)');
assert(chip('happiness').classList.contains('sel'), 'happiness selected');
strength.value = '2.5'; strength.dispatchEvent(new Event('input')); flush();

// custom word: typing IS selecting
$('expr-custom-adj').value = 'mischievous';
$('expr-custom-adj').dispatchEvent(new Event('input')); flush();
assert(!chip('happiness').classList.contains('sel'), 'custom word deselected happiness');

// ── spectrum + bank rows land in the deck with section counts ────────────
const val = $('spec-rows').querySelector('.ctl[data-key="valence"] input[type=range]');
val.value = '2'; val.dispatchEvent(new Event('input')); flush();

sec('look').click(); flush();
const bank = document.querySelectorAll('#axis-categories .ctl input[type=range]');
assert(bank.length === 18, '18 bank axes (got ' + bank.length + ')');
bank[0].value = '4.5'; bank[0].dispatchEvent(new Event('input')); flush();

const deckChips = () => document.querySelectorAll('.deck-chip');
assert(deckChips().length === 3, 'deck: expression + valence + bank axis (got ' + deckChips().length + ')');
assert($('dot-face').classList.contains('show') && $('dot-face').textContent === '2',
       'face badge counts 2 (got "' + $('dot-face').textContent + '")');
assert($('dot-look').textContent === '1', 'look badge counts 1');

// pole naming: composition.proximity at +4.5 chips as its positive pole
let chipTexts = [];
deckChips().forEach((c) => chipTexts.push(c.textContent));
assert(chipTexts.join('|').indexOf('closeup') >= 0,
       'bank chip named by its + pole: ' + chipTexts.join(' | '));

// ── chip × returns one control to neutral ─────────────────────────────────
let target = null;
deckChips().forEach((c) => { if (c.textContent.indexOf('closeup') >= 0) target = c; });
target.querySelector('.chip-x').click(); flush();
assert(+bank[0].value === 0, 'chip × zeroed the bank axis');
assert(deckChips().length === 2, 'chip removed from the deck');

// ── chip click reveals the control's section ──────────────────────────────
sec('scene').click(); flush();
let specChip = null;
deckChips().forEach((c) => { if (c.textContent.indexOf('valence') >= 0) specChip = c; });
specChip.click(); flush();
assert(document.getElementById('sec-face').classList.contains('active'),
       'valence chip jumped to the face section');

// ── reset all ─────────────────────────────────────────────────────────────
$('btn-deck-clear').click(); flush();
assert(deckChips().length === 0, 'reset all cleared every chip');
assert(+val.value === 0, 'valence back to neutral');
assert(+strength.value === 0, 'expression strength back to neutral');
assert(document.querySelectorAll('.word-chip.sel').length === 0, 'no word selected');

// ── tune dials keep their historical ids and join the deck ───────────────
sec('tune').click(); flush();
const band = $('band');
assert(band && band.type === 'range', '#band exists in the tune section');
band.value = '1.7'; band.dispatchEvent(new Event('input')); flush();
assert(deckChips().length === 1, 'band joined the deck');
assert($('dot-tune').textContent === '1', 'tune badge counts 1');
band.value = '1.0'; band.dispatchEvent(new Event('input')); flush();
assert(deckChips().length === 0, 'band at neutral left the deck');

// ── model panel summary ───────────────────────────────────────────────────
sec('scene').click(); flush();
assert($('model-sum-status').textContent.length > 0, 'model summary carries a status');

console.log('PASS: sectioned rail, word picker, deck, and badges all behave');
