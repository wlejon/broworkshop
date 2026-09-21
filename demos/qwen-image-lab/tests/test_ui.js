// UI-machinery test — NO model load, no weights needed. Exercises the
// sectioned rail, every panel's controls, the deck (active-control chips,
// section badges, reset) and the scene panel's size presets.
//
//   bro-headless ../broworkshop/demos/qwen-image-lab tests/test_ui.js
//
// The first line blanks the model directory BEFORE the worker's ready message
// can pump (delivery needs an event-loop turn, and this script runs to its
// first flush() without one), so the app's auto-load never fires.

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';

flush();
advanceTime(300);
flush();

function sec(name) { return document.querySelector('.secbtn[data-sec="' + name + '"]'); }
function deckChips() { return document.querySelectorAll('.deck-chip'); }
function setRange(el, v) {
  el.value = String(v);
  el.dispatchEvent(new Event('input'));
  flush();
}

// ── the rail's five sections ──────────────────────────────────────────────
['scene', 'axes', 'desk', 'gate', 'tune'].forEach((s) => assert(sec(s), 'section tab ' + s));
sec('gate').click(); flush();
assert($('sec-gate').classList.contains('active'), 'gate section shows');
assert(!$('sec-scene').classList.contains('active'), 'scene section hidden');

// Neutralize whatever a real session left in localStorage — the lab shares its
// prefs with real use, and "reset all" is itself under test here.
$('btn-deck-clear').click(); flush();
assert(deckChips().length === 0, 'deck empty after reset all');

// ── every panel mounted its controls ──────────────────────────────────────
const gateRows = $('gate-rows').querySelectorAll('.ctl');
assert(gateRows.length === 4, 'four gate multipliers (got ' + gateRows.length + ')');
assert($('gate-attn-img'), 'the attn/img multiplier has its id');
assert(+$('gate-attn-img').value === 1, 'gate multipliers are neutral at 1.00');
assert($('gate-band-rows').querySelectorAll('.ctl').length === 2, 'gate block band lo + hi');
assert($('gate-delta-rows').querySelectorAll('.ctl').length === 2, 'two post-tanh gate deltas');
assert($('gate-mask-rows').querySelectorAll('.ctl').length === 2, 'mask block band lo + hi');
assert(+$('mask-lo').value === 16,
       'the mask band defaults to the screened [16, 32) (got ' + $('mask-lo').value + ')');

sec('tune').click(); flush();
assert($('mod-rows').querySelectorAll('.ctl').length === 4, 'four modulation chunks');
assert($('normout-rows').querySelectorAll('.ctl').length === 1, 'one norm_out scale');
assert($('pkv-rows').querySelectorAll('.ctl').length === 4, 'prefix K/V: k, v, and a layer band');
assert($('mod-target').value === 'target', 'the mod delta defaults to the free target rows');

sec('axes').click(); flush();
assert($('axis-count').textContent.indexOf('load a model') >= 0,
       'the bank says it needs a model: "' + $('axis-count').textContent + '"');
assert($('budget-rows').querySelectorAll('.ctl').length === 1, 'the stack budget slider exists');

sec('desk').click(); flush();
assert($('desk-rows').textContent.indexOf('no controller') >= 0,
       'the desk says it has no controller.json yet');
assert($('ret-text').textContent.indexOf('baseline') >= 0, 'the retention meter explains itself');

sec('scene').click(); flush();
assert($('prompt').value.length > 0, 'the prompt field carries a default scene');
assert($('cond-list').textContent.indexOf('Text only') >= 0, 'no condition images yet');
assert($('btn-cond-clear').disabled, 'clear is disabled with no condition images');
assert($('model-sum-status').textContent.length > 0, 'the model summary carries a status');

// ── the two research presets drive size AND steps ─────────────────────────
const presets = $('preset-chips').querySelectorAll('button');
assert(presets.length === 3, 'three size presets');
presets[1].click(); flush();       // final · 1024² / 40
assert(+$('width').value === 1024 && +$('height').value === 1024 && +$('steps').value === 40,
       'the final preset set 1024²/40 (got ' + $('width').value + '×' + $('height').value +
       ' / ' + $('steps').value + ')');
presets[0].click(); flush();       // explore · 512² / 8
assert(+$('width').value === 512 && +$('steps').value === 8, 'the explore preset set 512²/8');
assert(presets[0].classList.contains('active'), 'the active preset is marked');

// ── the deck: a non-neutral control chips in, with its section badge ───────
sec('gate').click(); flush();
setRange($('gate-attn-img'), 1.25);
assert(deckChips().length === 1, 'the gate multiplier joined the deck');
assert($('dot-gate').textContent === '1' && $('dot-gate').classList.contains('show'),
       'the gate badge counts 1 (got "' + $('dot-gate').textContent + '")');

sec('tune').click(); flush();
setRange($('mod-gate2'), 0.2);
assert(deckChips().length === 2, 'the mod chunk joined the deck too');
assert($('dot-tune').textContent === '1', 'the tune badge counts 1');
let names = [];
deckChips().forEach((c) => names.push(c.textContent));
assert(names.join('|').indexOf('mod.gate2') >= 0,
       'the mod chip is named by its chunk: ' + names.join(' | '));

// what the worker would be told
const msg = window.__ctx.buildGenerateMsg();
assert(msg.gateRows && msg.gateRows.attnImg === 1.25,
       'the gate multiplier reaches the generate message');
assert(msg.mod && msg.mod.fracs[3] === 0.2 && msg.mod.target === 'target',
       'the mod chunk reaches the generate message as a fraction on the target rows');
assert(msg.opts.width === 512 && msg.opts.steps === 8, 'the message carries the explore preset');
assert(!msg.conditionImages, 'no condition images means a text-only message');

// ── a chip's × returns one control to neutral, and reset-all the rest ──────
let target = null;
deckChips().forEach((c) => { if (c.textContent.indexOf('mod.gate2') >= 0) target = c; });
target.querySelector('.chip-x').click(); flush();
assert(+$('mod-gate2').value === 0, 'chip × zeroed the mod chunk');
assert(deckChips().length === 1, 'the chip left the deck');

// a chip click reveals its own section
sec('scene').click(); flush();
deckChips()[0].click(); flush();
assert($('sec-gate').classList.contains('active'), 'the chip jumped to the gate section');

$('btn-deck-clear').click(); flush();
assert(deckChips().length === 0, 'reset all cleared every chip');
assert(+$('gate-attn-img').value === 1, 'the gate multiplier is neutral again');
assert(!$('dot-gate').classList.contains('show'), 'the section badge went away');

// ── the axis filter survives an empty bank ────────────────────────────────
sec('axes').click(); flush();
$('axis-search').value = 'light';
$('axis-search').dispatchEvent(new Event('input')); flush();
assert($('axis-shown').textContent === '', 'no bank, nothing to count');
$('axis-search').value = '';
$('axis-search').dispatchEvent(new Event('input')); flush();

console.log('PASS: rail, panels, presets, deck chips and section badges all behave');
