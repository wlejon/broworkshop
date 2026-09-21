// The prompt-conditioned desk — round 3's `prompt` block of controller.json.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_conditioned.js
//
// Round 2's conclusion was that a fader's per-image inconsistency is a
// shortfall of scene knowledge and that no per-image gain fixes it: the
// forward model has no scene input and structurally cannot know which picture
// it is standing in front of. Round 3 gives it one — the prompt's own
// conditioning rows, pooled to 4099 numbers, projected to an 8-dimensional p
// that indexes a Jacobian the fader directions are re-derived from. One
// encode and one matrix product, no render.
//
// Three things have to hold for that to be worth a toggle, and each is
// asserted here:
//
//   1. the faders MOVE — the conditioned direction is not the global one, and
//      the panel prints how far it moved without rendering anything;
//   2. they move DIFFERENTLY for different prompts — p is a function of the
//      scene, so two prompts must not produce the same desk;
//   3. the toggle changes nothing else — at a fader of zero the render is the
//      untouched one to the pixel, and switching back reproduces the global
//      render exactly.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function mse(a, b) {
  let acc = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; acc += d * d; n++; }
  }
  return acc / n;
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

const ctx = window.__ctx;
const PROMPT_A = 'a stone cottage beside a mountain lake';
const PROMPT_B = 'a crowded night market under neon signs';

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = '6'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
flush();

function setPrompt(p) {
  $('prompt').value = p;
  $('prompt').dispatchEvent(new Event('change'));
  flush();
  assert(waitIdle(), 'the prompt change settled');
}
function render(what) {
  const t0 = Date.now();
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), 180000);
  assert(ok && !$('status-text').classList.contains('err'),
         what + ' rendered ok: ' + $('status-text').textContent);
  const c = $('view');
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}
function waitIdle(budget) { return pumpUntil(() => !ctx.busy, budget || 300000); }

// ── the file has a prompt block ───────────────────────────────────────────
document.querySelector('.secbtn[data-sec="desk"]').click();
setPrompt(PROMPT_A);
assert($('desk-cond-row').style.display !== 'none',
       'the toggle is offered, so this controller.json carries a prompt block');
assert(!ctx.deskConditioned(), 'and starts off — global');
assert($('desk-cond-state').textContent === 'global',
       'the panel says which desk is in force: ' + $('desk-cond-state').textContent);
const faders = ctx.faderNames();
console.log('faders: ' + faders.join(', '));
assert(faders.length > 0, 'the desk has faders');
const FADER = faders[0];

// ── the global render, and the global fader ───────────────────────────────
const zero = render('baseline · every fader at zero');
ctx.setFader(FADER, 1.5);
flush();
let msg = ctx.buildGenerateMsg();
assert(msg.desk[FADER] === 1.5, 'the fader rides in the message');
assert(!msg.conditioned, 'and asks for the global desk');
const globalFrame = render('global desk · ' + FADER + ' 1.5');
const dGlobal = mse(zero, globalFrame);
console.log(FADER + ' 1.5, global: mse ' + dGlobal.toFixed(1) + ' from the baseline');
assert(dGlobal > 5, 'the fader does something (' + dGlobal.toFixed(1) + ')');

// ── conditioning on this prompt ───────────────────────────────────────────
console.log('conditioning the desk on: ' + PROMPT_A);
const tCond = Date.now();
ctx.setDeskConditioned(true);
assert(waitIdle(), 'the conditioning finished');
console.log('conditioned in ' + (Date.now() - tCond) + ' ms · ' + $('desk-cond-state').textContent);
assert($('desk-cond-state').textContent.indexOf('conditioned') === 0,
       'the panel reports it: ' + $('desk-cond-state').textContent);
const driftA = ctx.deskDriftText();
console.log('drift · ' + driftA.replace(/\s+/g, ' ').slice(0, 220));
assert(driftA.indexOf('cos') >= 0, 'the panel prints the per-fader drift without rendering');
assert(driftA.indexOf('p') >= 0, 'and the p vector it was derived from');
const cosines = driftA.match(/cos (-?\d+\.\d+)/g).map((s) => parseFloat(s.slice(4)));
console.log('per-fader cos(conditioned, global): ' + cosines.map((c) => c.toFixed(3)).join(' '));
assert(cosines.length === faders.length, 'one drift line a fader (' + cosines.length + ')');
assert(cosines.some((c) => Math.abs(c) < 0.999),
       'at least one fader is genuinely re-aimed for this prompt (' +
       cosines.map((c) => c.toFixed(3)).join(' ') + ')');

msg = ctx.buildGenerateMsg();
assert(msg.conditioned, 'the render asks for the conditioned desk');
const condFrame = render('conditioned desk · ' + FADER + ' 1.5');
const dCond = mse(globalFrame, condFrame);
console.log('conditioned vs global, same fader setting: mse ' + dCond.toFixed(1));
assert(dCond > 1,
       'the same slider position is a different edit once the desk knows the scene (' +
       dCond.toFixed(1) + ')');

// ── the toggle changes nothing at zero ────────────────────────────────────
// A conditioned desk re-aims the faders; it does not re-aim the render.
ctx.setFader(FADER, 0);
flush();
const condZero = render('conditioned desk · every fader at zero');
console.log('conditioned-at-zero vs baseline: mse ' + mse(zero, condZero).toFixed(4));
assert(mse(zero, condZero) < 1e-6,
       'conditioning is a change of direction, not of picture (mse ' +
       mse(zero, condZero).toFixed(4) + ')');

// ── a different prompt is a different desk ────────────────────────────────
console.log('re-conditioning on: ' + PROMPT_B);
setPrompt(PROMPT_B);
assert(waitIdle(), 'the re-conditioning finished');
const driftB = ctx.deskDriftText();
console.log('drift · ' + driftB.replace(/\s+/g, ' ').slice(0, 220));
assert(driftB !== driftA,
       'a different prompt gives a different desk — p is a function of the scene');
const pA = (driftA.match(/p(-?\d+\.\d+.*)$/) || [])[0];
const pB = (driftB.match(/p(-?\d+\.\d+.*)$/) || [])[0];
console.log('p(A) ' + pA + '\np(B) ' + pB);
assert(pA && pB && pA !== pB, 'and the printed p vectors differ');

// re-conditioning on the SAME prompt is stable
setPrompt(PROMPT_A);
assert(waitIdle(), 'back on prompt A');
assert(ctx.deskDriftText() === driftA,
       'the same prompt gives back the same desk — no render, no randomness');

// ── and it is reproducible ────────────────────────────────────────────────
ctx.setFader(FADER, 1.5);
flush();
const condAgain = render('conditioned desk · ' + FADER + ' 1.5, again');
console.log('the conditioned render, repeated: mse ' + mse(condFrame, condAgain).toFixed(4));
assert(mse(condFrame, condAgain) < 1e-6, 'a conditioned render repeats to the pixel');

// ── switching back ────────────────────────────────────────────────────────
ctx.setDeskConditioned(false);
assert(waitIdle(), 'the switch back settled');
assert($('desk-cond-state').textContent === 'global', 'the panel says global again');
assert(ctx.deskDriftText() === '', 'and the drift readout cleared');
msg = ctx.buildGenerateMsg();
assert(!msg.conditioned, 'the message stopped asking for it');
const backToGlobal = render('global desk again · ' + FADER + ' 1.5');
console.log('back to global vs the original global render: mse ' +
            mse(globalFrame, backToGlobal).toFixed(4));
assert(mse(globalFrame, backToGlobal) < 1e-6,
       'switching back reproduces the global render exactly');

ctx.setFader(FADER, 0);
flush();
console.log('PASS — the desk re-aims per prompt, says by how much before rendering, and ' +
            'leaves everything else alone');
