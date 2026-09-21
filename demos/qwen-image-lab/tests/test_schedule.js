// The schedule editor, through the real UI: a curve per armed control, and
// the three kinds of lane that curve can mean.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_schedule.js
//
// What the editor is for is that WHEN a control lands matters, and the test
// measures how much, per lane kind, rather than assuming it. Measured here at
// 8 steps, 512², seed 7:
//
//   a bank axis at +2, unscheduled           mse 542.9 from the baseline
//     ... armed over the first third only        528.8  — nearly all of it
//     ... armed over the last third only           4.2  — almost nothing
//   the attn · img gate multiplier at 0.80
//     ... over the first half                    388.5  }  a ratio of 0.34,
//     ... over the second half                   132.1  }  against the axis's 0.008
//
// So a conditioning axis is an EARLY instrument: once the composition has
// settled there is almost nothing left for it to aim — the last third is worth
// under 1% of the first. A gate multiplier leans early too, but only by three
// to one: it is a per-token dial on the residual rather than an instruction
// about what to draw, and it still has authority at the tail. That asymmetry
// is the thing the timeline exists to show, and it is what the assertions
// below pin down.
//
// At the same time an all-zero curve has to come back to the untouched render
// to the pixel, for every lane kind: a scheduled axis is taken out of the
// prime-time stack so a zero alpha is the only thing left driving it, and a
// zeroed hook lane returns its control to its own neutral.
//
// Three lane kinds are exercised, because they reach the model by three
// different routes:
//
//   axis lane  -> qwenImage21AddControlSchedule, per-step alpha
//   hook lane  -> the gate multipliers re-issued per step in the step loop
//   desk lane  -> the fader scaled per step BEFORE the parameter vector is
//                 built, which is not the same as scaling one knob late

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
const STEPS = 8;

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('width').value = '512'; $('height').value = '512';
$('steps').value = String(STEPS); $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
$('steps').dispatchEvent(new Event('change'));
flush();

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
function setAxis(name, v) {
  const row = document.querySelector('#axis-categories .ctl[data-key="' + name + '"]');
  assert(row, 'the bank has an axis row for ' + name);
  const r = row.querySelector('input[type=range]');
  r.value = String(v); r.dispatchEvent(new Event('input'));
  flush();
}
function laneKeys() { return ctx.schedLanes().map((l) => l.key); }

// ── an empty editor ───────────────────────────────────────────────────────
document.querySelector('.tabbtn[data-tab="sched"]').click();
flush();
assert($('tab-sched').classList.contains('active'), 'the schedule tab shows');
assert(ctx.schedLanes().length === 0, 'nothing armed means no lanes');
assert($('sched-hint').style.display !== 'none', 'the empty-state hint is up');
assert($('sched-lanes').textContent.indexOf('nothing armed') >= 0,
       'and the rail says so: ' + $('sched-lanes').textContent);

const base = render('baseline · nothing armed');

// ── arming an axis builds a lane ──────────────────────────────────────────
const AXIS = 'light.key';
setAxis(AXIS, 2);
assert(laneKeys().indexOf('axis:' + AXIS) >= 0,
       'the armed axis got a lane (' + laneKeys().join(', ') + ')');
assert($('sched-hint').style.display === 'none', 'the hint stood down');
const lane = ctx.schedLanes().filter((l) => l.key === 'axis:' + AXIS)[0];
assert(lane.kind === 'axis', 'it is an axis lane');
assert($('sched-steps-note').textContent.indexOf(STEPS + ' steps') === 0,
       'the toolbar counts the steps: ' + $('sched-steps-note').textContent);

// flat is the default, and a flat lane sends no schedule at all
let msg = ctx.buildGenerateMsg();
assert(!msg.schedule, 'a flat lane sends no schedule — it is just the axis');
assert(msg.axes[AXIS] === 2, 'the axis rides in the ordinary axis map');
const flat = render(AXIS + ' +2, unscheduled');
const dFlat = mse(base, flat);
console.log(AXIS + ' +2 vs baseline: mse ' + dFlat.toFixed(1));
assert(dFlat > 50, 'the axis moved the render at all (mse ' + dFlat.toFixed(1) + ')');

// ── an all-zero curve is the axis switched off, to the pixel ──────────────
// A scheduled axis leaves the prime-time stack, so with every alpha at zero
// there is nothing left driving it and the render has to be the baseline.
ctx.selectLane('axis:' + AXIS);
$('sched-preset').value = 'off';
$('btn-sched-apply').click();
flush();
msg = ctx.buildGenerateMsg();
assert(msg.schedule && msg.schedule.length === 1, 'the off curve sends a schedule');
assert(msg.schedule[0].axis === AXIS, 'for the right axis');
assert(msg.schedule[0].curve.length === STEPS,
       'one coefficient a step (got ' + msg.schedule[0].curve.length + ')');
assert(msg.schedule[0].curve.every((v) => v === 0), 'all zero');
assert(msg.schedule[0].value === 2, 'carrying the slider setting to multiply by');
const off = render(AXIS + ' scheduled off at every step');
console.log('off-curve vs baseline: mse ' + mse(base, off).toFixed(4));
assert(mse(base, off) < 1e-6,
       'an all-zero curve is the untouched render, to the pixel (mse ' +
       mse(base, off).toFixed(4) + ')');

// ── early vs late ─────────────────────────────────────────────────────────
$('sched-preset').value = 'early';
$('btn-sched-apply').click();
flush();
let curve = ctx.curveFor('axis:' + AXIS);
console.log('early curve: ' + curve.join(' '));
assert(curve[0] === 1 && curve[STEPS - 1] === 0, 'early is on at the head and off at the tail');
const nOn = curve.filter((v) => v > 0).length;
assert(nOn === Math.max(1, Math.round(STEPS / 3)),
       'early covers the first third (' + nOn + ' of ' + STEPS + ')');
const early = render(AXIS + ' +2, early only');

$('sched-preset').value = 'late';
$('btn-sched-apply').click();
flush();
curve = ctx.curveFor('axis:' + AXIS);
console.log('late curve:  ' + curve.join(' '));
assert(curve[0] === 0 && curve[STEPS - 1] === 1, 'late is off at the head and on at the tail');
const late = render(AXIS + ' +2, late only');

const dEarly = mse(base, early), dLate = mse(base, late), dEL = mse(early, late);
console.log('early vs baseline ' + dEarly.toFixed(1) + ' · late vs baseline ' + dLate.toFixed(1) +
            ' · early vs late ' + dEL.toFixed(1) + ' · unscheduled vs baseline ' + dFlat.toFixed(1));
assert(dEarly > 20, 'the early window moved the render (' + dEarly.toFixed(1) + ')');
assert(dEarly > 0.7 * dFlat,
       'and carried most of what the unscheduled axis was worth — the first third of the ' +
       'schedule is where a conditioning axis spends (' + dEarly.toFixed(1) + ' of ' +
       dFlat.toFixed(1) + ')');
assert(dLate > 0.5,
       'the late window still moved something, against a floor of exactly zero (' +
       dLate.toFixed(1) + ')');
assert(dLate < 0.2 * dEarly,
       'but barely: an axis is an EARLY instrument. Once the composition has settled there ' +
       'is little left for the conditioning to aim, so the last third is worth a fraction of ' +
       'the first (' + dLate.toFixed(1) + ' vs ' + dEarly.toFixed(1) + ')');
assert(dEL > 20, 'the two windows are different pictures (' + dEL.toFixed(1) + ')');

// ── per-step numeric entry, and the shape readout ─────────────────────────
$('sched-step').value = '3';
$('sched-value').value = '0.5';
$('btn-sched-set').click();
flush();
curve = ctx.curveFor('axis:' + AXIS);
assert(Math.abs(curve[3] - 0.5) < 1e-9, 'setting one step by hand moved that step only (' +
       curve.join(' ') + ')');
assert(curve[STEPS - 1] === 1, 'and left the rest of the late curve alone');
const shape = $('sched-lanes').textContent;
assert(shape.indexOf('▄') >= 0 && shape.indexOf('█') >= 0,
       'the rail draws the shape as a sparkline: ' + shape);

// ── drawing on the canvas ─────────────────────────────────────────────────
// The lane is a strip of the timeline; a drag across it writes the curve the
// same way the numeric entry does.
const rect = $('sched-canvas').getBoundingClientRect();
const y = rect.y + (18 + 23) * (rect.height / $('sched-canvas').height);
const x0 = rect.x + 140 * (rect.width / $('sched-canvas').width);
mouseDown(x0, y);
for (let i = 1; i <= 6; i++) {
  mouseMove(x0 + i * 8 * (rect.width / $('sched-canvas').width), y);
}
mouseUp(x0 + 48 * (rect.width / $('sched-canvas').width), y);
flush();
const drawn = ctx.curveFor('axis:' + AXIS);
console.log('after the drag: ' + drawn.join(' '));
assert(drawn.some((v, i) => Math.abs(v - curve[i]) > 1e-6),
       'dragging on a lane wrote the curve');

// ── a hook lane ───────────────────────────────────────────────────────────
// The gate multipliers do not go through AddControlSchedule at all: the step
// loop re-issues them, scaled away from their own neutral of 1.0, so a curve
// at 0 means "no multiplier at this step" rather than "multiply by zero".
$('btn-sched-clear').click();
setAxis(AXIS, 0);
flush();
assert(ctx.schedLanes().length === 0, 'clearing the axis cleared its lane');

document.querySelector('.secbtn[data-sec="gate"]').click();
const gateRow = document.querySelector('#gate-rows .ctl[data-key="gate-attn-img"] input[type=range]');
assert(gateRow, 'the attn · img multiplier has a row');
gateRow.value = '0.8'; gateRow.dispatchEvent(new Event('input'));
flush();
document.querySelector('.tabbtn[data-tab="sched"]').click();
flush();
assert(laneKeys().indexOf('gateRows') >= 0,
       'the gate multipliers got a lane (' + laneKeys().join(', ') + ')');
assert(ctx.schedLanes().filter((l) => l.key === 'gateRows')[0].kind === 'hook',
       'as a hook lane');

const gateFlat = render('attn · img gate 0.80, every step');
assert(mse(base, gateFlat) > 5, 'the gate multiplier moved the render at all');

ctx.selectLane('gateRows');
$('sched-preset').value = 'off';
$('btn-sched-apply').click();
flush();
msg = ctx.buildGenerateMsg();
assert(msg.lanes && msg.lanes.gateRows, 'a hook lane rides in msg.lanes, not msg.schedule');
assert(!msg.schedule, 'and builds no control schedule');
const gateOff = render('the same gate, scheduled off at every step');
console.log('gate scheduled off vs baseline: mse ' + mse(base, gateOff).toFixed(4));
assert(mse(base, gateOff) < 1e-6,
       'a zero curve returns a hook to its own neutral, to the pixel (mse ' +
       mse(base, gateOff).toFixed(4) + ')');

ctx.setCurve('gateRows', [1, 1, 1, 1, 0, 0, 0, 0]);
flush();
const gateEarly = render('the gate, first half only');
ctx.setCurve('gateRows', [0, 0, 0, 0, 1, 1, 1, 1]);
flush();
const gateLate = render('the gate, second half only');
const gEL = mse(gateEarly, gateLate);
const gE = mse(base, gateEarly), gL = mse(base, gateLate);
console.log('gate early vs late: mse ' + gEL.toFixed(1) + ' · early vs baseline ' +
            gE.toFixed(1) + ' · late vs baseline ' + gL.toFixed(1) +
            ' · early vs flat ' + mse(gateEarly, gateFlat).toFixed(1) + ' · late vs flat ' +
            mse(gateLate, gateFlat).toFixed(1));
assert(gEL > 1, 'when the gate multiplier lands changes the picture (' + gEL.toFixed(1) + ')');
assert(gE > 0.5 && gL > 0.5,
       'and unlike a conditioning axis, a gate multiplier is worth something at BOTH ends of ' +
       'the schedule — it is a per-token dial on the residual, not an instruction about what ' +
       'to draw (early ' + gE.toFixed(1) + ' · late ' + gL.toFixed(1) + ')');

// ── a desk lane ───────────────────────────────────────────────────────────
// A fader is a direction through the knob space, so a curve here scales the
// DIRECTION per step and the parameter vector is rebuilt each time.
$('btn-sched-clear').click();
gateRow.value = '1'; gateRow.dispatchEvent(new Event('input'));
flush();
const faders = ctx.faderNames();
assert(faders.length > 0, 'the controller file brought faders (' + faders.length + ')');
const FADER = faders[0];
ctx.setFader(FADER, 1.5);
flush();
assert(laneKeys().indexOf('desk:' + FADER) >= 0,
       'the armed fader got a lane (' + laneKeys().join(', ') + ')');
assert(ctx.schedLanes().filter((l) => l.key === 'desk:' + FADER)[0].kind === 'desk',
       'as a desk lane');
const deskFlat = render('desk · ' + FADER + ' 1.5');
assert(mse(base, deskFlat) > 5, 'the fader moved the render (' +
       mse(base, deskFlat).toFixed(1) + ')');

ctx.selectLane('desk:' + FADER);
ctx.setCurve('desk:' + FADER, [1, 1, 1, 1, 0, 0, 0, 0]);
flush();
msg = ctx.buildGenerateMsg();
assert(msg.lanes && msg.lanes.desk && msg.lanes.desk[FADER],
       'a desk lane rides under msg.lanes.desk');
assert(msg.desk[FADER] === 1.5, 'with the fader still at its own setting');
const deskEarly = render('desk · ' + FADER + ' 1.5, first half only');
ctx.setCurve('desk:' + FADER, [0, 0, 0, 0, 1, 1, 1, 1]);
flush();
const deskLate = render('desk · ' + FADER + ' 1.5, second half only');
const dDEL = mse(deskEarly, deskLate);
console.log('desk early vs late: mse ' + dDEL.toFixed(1) + ' · early vs flat ' +
            mse(deskEarly, deskFlat).toFixed(1));
assert(dDEL > 1, 'a fader armed in the second half is a different edit (' + dDEL.toFixed(1) + ')');

ctx.setCurve('desk:' + FADER, [0, 0, 0, 0, 0, 0, 0, 0]);
flush();
const deskOff = render('desk · ' + FADER + ' scheduled off');
console.log('desk scheduled off vs baseline: mse ' + mse(base, deskOff).toFixed(4));
assert(mse(base, deskOff) < 1e-6, 'a zero curve is the untouched render, to the pixel');

// ── a curve is a shape, not a step count ──────────────────────────────────
// Authored at 8 steps and read back at 16, it resamples rather than truncates.
ctx.setCurve('desk:' + FADER, [1, 1, 1, 1, 0, 0, 0, 0]);
$('steps').value = '16'; $('steps').dispatchEvent(new Event('change'));
flush();
const re = ctx.curveFor('desk:' + FADER);
console.log('the 8-step curve read at 16 steps: ' + re.map((v) => v.toFixed(2)).join(' '));
assert(re.length === 16, 'read back at the new step count');
assert(re[0] === 1 && re[15] === 0, 'with the same ends');
assert(re.slice(0, 6).every((v) => v > 0.5) && re.slice(10).every((v) => v < 0.5),
       'and the same shape — the first half on, the second off');
$('steps').value = String(STEPS); $('steps').dispatchEvent(new Event('change'));

// ── flatten ───────────────────────────────────────────────────────────────
$('btn-sched-clear').click();
ctx.setFader(FADER, 0);
flush();
assert(ctx.schedLanes().length === 0, 'every lane is gone');
const after = render('after flattening');
assert(mse(base, after) < 1e-6, 'and the render is the baseline again');

console.log('PASS — a curve per lane, three routes to the model, and when a knob lands matters');
