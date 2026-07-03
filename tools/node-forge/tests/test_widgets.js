// Headless test — field-level widget registry (lab/widgets.js).
//
// Milestone 1a scope: only the four ported field widgets (int/float/bool/
// select) exist yet — this proves the registry mechanism against them with
// no behavior change from tensor-lab's old inline buildForm() switch. The
// panel-widget half of this file (multi-curve-painter, basis-slider-map)
// gets exercised once those widgets land (see plan Milestone 1a step 5 /
// 1b) — extend this file at that point rather than adding a new one.
import { Widgets } from "/app/lab/widgets.js";

flush();
advanceTime(50);
flush();

function fakeNode(params) { return { params: params }; }

// --- int / float: numeric input, commits parsed + clamped value ------------
{
  const node = fakeNode({ out: 5 });
  const field = { key: 'out', label: 'Out', type: 'int', def: 5, min: 1, max: 10 };
  const container = document.createElement('div');
  let committed = null;
  Widgets.getField('int').mount(container, node, field, { commit: (raw) => { committed = raw; } });
  const input = container.querySelector('input');
  assert(input !== null, 'int widget mounts a number <input>');
  assert(input.type === 'number', 'int widget input type is number');
  assert(Number(input.value) === 5, 'int widget seeded with node.params value');
  input.value = '9';
  input.dispatchEvent(new Event('change'));
  assert(committed === '9', 'int widget fires ctx.commit(raw) on change');
}

// --- bool: checkbox ----------------------------------------------------------
{
  const node = fakeNode({ bias: true });
  const field = { key: 'bias', label: 'Bias', type: 'bool', def: true };
  const container = document.createElement('div');
  let committed = null;
  Widgets.getField('bool').mount(container, node, field, { commit: (raw) => { committed = raw; } });
  const input = container.querySelector('input');
  assert(input !== null && input.type === 'checkbox', 'bool widget mounts a checkbox');
  assert(input.checked === true, 'bool widget seeded with node.params value');
  input.checked = false;
  input.dispatchEvent(new Event('change'));
  assert(committed === false, 'bool widget commits the checked boolean, not a string');
}

// --- select: <select> populated from field.options --------------------------
{
  const node = fakeNode({ fill: 'gauss' });
  const field = { key: 'fill', label: 'Fill', type: 'select', def: 'gauss', options: ['gauss', 'uniform', 'ramp'] };
  const container = document.createElement('div');
  document.body.appendChild(container);   // select/option value-matching needs a live tree
  let committed = null;
  Widgets.getField('select').mount(container, node, field, { commit: (raw) => { committed = raw; } });
  const input = container.querySelector('select');
  assert(input !== null, 'select widget mounts a <select>');
  assert(container.querySelectorAll('option').length === 3, 'select widget populates all options');
  assert(input.value === 'gauss', 'select widget seeded with node.params value');
  input.value = 'ramp';
  input.dispatchEvent(new Event('change'));
  assert(committed === 'ramp', 'select widget commits the chosen option');
  document.body.removeChild(container);
}

// --- unknown field type falls back to the numeric widget --------------------
{
  const node = fakeNode({ x: 1 });
  const field = { key: 'x', label: 'X', type: 'some-future-type', def: 1 };
  const container = document.createElement('div');
  Widgets.getField('some-future-type').mount(container, node, field, { commit: () => {} });
  assert(container.querySelector('input[type="number"]') !== null,
    'unregistered field type falls back to the default numeric widget, matching the old switch\'s implicit fallback');
}

flush();
console.log('TEST_WIDGETS DONE');
