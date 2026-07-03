// Headless test — field-level widget registry (lab/widgets.js).
//
// Field-level section proves the registry mechanism against the four ported
// widgets (int/float/bool/select) with no behavior change from tensor-lab's
// old inline buildForm() switch. The panel-widget sections below exercise
// multi-curve-painter and basis-slider-map standalone, against synthetic
// ops — no real audio model involved (see plan Milestone 1a step 5).
import { Widgets } from "/app/lab/widgets.js";
import "/app/widgets/curve-painter.js";      // registers 'multi-curve-painter'
import "/app/widgets/basis-slider-map.js";   // registers 'basis-slider-map'

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

// --- text: plain string input, no browse button without f.browse -----------
{
  const node = fakeNode({ dir: '' });
  const field = { key: 'dir', label: 'Dir', type: 'text', def: '' };
  const container = document.createElement('div');
  let committed = null;
  Widgets.getField('text').mount(container, node, field, { commit: (raw) => { committed = raw; } });
  const input = container.querySelector('input');
  assert(input !== null && input.type === 'text', 'text widget mounts a text <input>');
  assert(container.querySelectorAll('.tinybtn').length === 0, 'no browse button when the field has no f.browse');
  input.value = 'D:/some/path';
  input.dispatchEvent(new Event('change'));
  assert(committed === 'D:/some/path', 'text widget commits the typed string');
}

// --- text with f.browse: 'folder' — mounts a Browse button ------------------
// showOpenFolderDialog/showOpenFileDialog are REAL SDL3 native dialogs, not
// stubs, and exist even in GPU-headless mode (unlike --no-gpu) — clicking
// this button opens an actual blocking OS dialog with nobody to dismiss it.
// NEVER click it in an automated test; only assert it mounts and is wired.
{
  const node = fakeNode({ dir: '' });
  const field = { key: 'dir', label: 'Dir', type: 'text', def: '', browse: 'folder' };
  const container = document.createElement('div');
  Widgets.getField('text').mount(container, node, field, { commit: () => {} });
  const btn = container.querySelector('.tinybtn');
  assert(btn !== null, 'f.browse: "folder" mounts a Browse button');
  assert(btn.title === 'Browse…', 'browse button is titled for discoverability');
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

// --- multi-curve-painter: panel widget, against a synthetic 2-curve op -----
{
  const widget = Widgets.getPanel('multi-curve-painter');
  assert(widget !== null, 'multi-curve-painter registers as a panel widget');

  const original0 = [0, 1, 2, 3, 4, 5, 6, 7];
  const node = fakeNode({
    curveA: original0.slice(),
    curveB: [10, 10, 10, 10],
  });
  const cfg = {
    count: () => 2,
    label: (n, i) => 'curve ' + i,
    get: (n, i) => i === 0 ? n.params.curveA : n.params.curveB,
    original: (n, i) => i === 0 ? original0 : null,   // curveB has no ghost baseline
    clamp: (n, i, v) => i === 1 ? Math.max(0, v) : v, // curveB can't go negative
  };
  let edits = 0, commits = 0;
  const ctx = { onEdit: () => edits++, onCommit: () => commits++ };
  const root = widget.mount(node, {}, cfg, ctx);
  document.body.appendChild(root);

  assert(root.querySelectorAll('.curve-cell').length === 2, 'mounts one cell per curve');
  assert(root.querySelectorAll('.curve-canvas').length === 2, 'one canvas per curve');
  const buttonsPerCell = root.querySelectorAll('.curve-cell')[0].querySelectorAll('.tinybtn').length;
  assert(buttonsPerCell === 6, 'each cell gets the 6 op buttons (reset/smooth/flatten/invert/nudge x2)');

  // flatten curveA to its mean, in place
  const cellA = root.querySelectorAll('.curve-cell')[0];
  const flattenBtn = Array.prototype.filter.call(cellA.querySelectorAll('.tinybtn'), (b) => b.title === 'flatten to mean')[0];
  assert(flattenBtn !== undefined, 'flatten button is findable by title');
  flattenBtn.click();
  const meanA = original0.reduce((a, b) => a + b, 0) / original0.length;
  assert(node.params.curveA.every((v) => Math.abs(v - meanA) < 1e-9),
    'flatten mutates node.params.curveA in place to its mean: ' + JSON.stringify(node.params.curveA));
  assert(edits === 1, 'flatten fires exactly one ctx.onEdit() tick, not onCommit()');
  assert(commits === 0, 'panel widget never calls ctx.onCommit() — only onEdit(), by design (see file header)');

  // reset curveA back to its original ghost baseline
  const resetBtn = Array.prototype.filter.call(cellA.querySelectorAll('.tinybtn'), (b) => b.title === 'reset to original')[0];
  resetBtn.click();
  assert(JSON.stringify(node.params.curveA) === JSON.stringify(original0),
    'reset restores node.params.curveA from the original(node,i) ghost baseline');
  assert(edits === 2, 'reset also ticks onEdit()');

  // nudge curveB down past 0 — per-curve clamp must hold it at 0, not go negative
  const cellB = root.querySelectorAll('.curve-cell')[1];
  const nudgeDownBtn = Array.prototype.filter.call(cellB.querySelectorAll('.tinybtn'), (b) => b.title.indexOf('nudge down') === 0)[0];
  nudgeDownBtn.click();  // 10 -> 9.5
  nudgeDownBtn.click();  // 9.5 -> 9
  assert(node.params.curveB.every((v) => v === 9), 'unclamped nudge-down applies normally while positive');
  for (let k = 0; k < 30; k++) nudgeDownBtn.click();   // drive well past zero
  assert(node.params.curveB.every((v) => v === 0),
    'per-curve clamp(node,i,v) holds curveB at its floor instead of going negative: ' + JSON.stringify(node.params.curveB));

  // a curve with no original(node,i) baseline must not throw when reset is clicked
  const resetBBtn = Array.prototype.filter.call(cellB.querySelectorAll('.tinybtn'), (b) => b.title === 'reset to original')[0];
  resetBBtn.click();   // original(node,1) returns null — must no-op, not throw
  console.log('TEST: reset-with-no-baseline did not throw; curveB still', JSON.stringify(node.params.curveB));

  document.body.removeChild(root);
}

// --- multi-curve-painter: real mouse-driven paint drag ----------------------
// (the button-op tests above exercise the same mutate+redraw+onEdit tail via
// applyOp(); this closes the loop on the primary interaction, freehand
// painting via paintAt(), which needs a real layout pass for
// getBoundingClientRect() to return non-zero canvas geometry.)
{
  const node = fakeNode({ c: [0, 0, 0, 0, 0, 0, 0, 0] });
  const cfg = { count: () => 1, label: () => 'c', get: (n, i) => n.params.c, range: () => [-2, 2] };
  let edits = 0;
  const ctx = { onEdit: () => edits++, onCommit: () => {} };
  const root = Widgets.getPanel('multi-curve-painter').mount(node, {}, cfg, ctx);
  document.body.appendChild(root);
  flush(); advanceTime(50); flush();   // force a layout so the canvas has real geometry

  const cv = root.querySelector('.curve-canvas');
  const rect = cv.getBoundingClientRect();
  assert(rect.width > 0 && rect.height > 0, 'canvas has real layout geometry after flush()');
  cv.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 10, clientY: rect.top + 10 }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + 50, clientY: rect.top + 80 }));
  window.dispatchEvent(new MouseEvent('mouseup', {}));

  assert(edits > 0, 'a real mouse drag fires ctx.onEdit() at least once per tick');
  assert(node.params.c.some((v) => v !== 0), 'the drag actually mutated node.params.c in place');
  document.body.removeChild(root);
}

// --- basis-slider-map: panel widget, against a synthetic 3-axis basis -----
{
  const widget = Widgets.getPanel('basis-slider-map');
  assert(widget !== null, 'basis-slider-map registers as a panel widget');

  const node = fakeNode({ coords: [0, 0, 0] });
  const cfg = {
    dim: () => 3,
    axisName: (n, i) => 'axis ' + i,
    axisRange: () => [-3, 3],
    coords: (n) => n.params.coords,
    presets: () => [{ name: 'A', coords: [1, 2, 0] }, { name: 'B', coords: [-1, -2, 0.5] }],
    mapAxes: () => [0, 1],
  };
  let edits = 0, commits = 0;
  const ctx = { onEdit: () => edits++, onCommit: () => commits++ };
  const root = widget.mount(node, {}, cfg, ctx);
  document.body.appendChild(root);
  flush(); advanceTime(50); flush();   // force a layout for the map canvas geometry

  assert(root.querySelectorAll('.basis-map').length === 1, 'mounts exactly one map canvas');
  assert(root.querySelectorAll('.pc').length === 3, 'mounts one slider row per axis');
  assert(root.querySelectorAll('.pc input[type="range"]').length === 3, 'each row has a range input');
  const presetSel = root.querySelector('select.basis-preset');
  assert(presetSel !== null, 'preset picker mounts when presets() is non-empty');
  assert(root.querySelectorAll('option').length === 3, 'blank option + 2 presets');

  // slider drag: dragging axis 2 (not on the map) only touches coords[2]
  const sliders = root.querySelectorAll('.pc input[type="range"]');
  sliders[2].value = '1.5';
  sliders[2].dispatchEvent(new Event('input'));
  assert(node.params.coords[2] === 1.5, 'slider 2 updates coords[2] directly: ' + JSON.stringify(node.params.coords));
  assert(node.params.coords[0] === 0 && node.params.coords[1] === 0, 'slider 2 does not touch coords[0]/[1]');
  assert(edits === 1, 'slider drag fires ctx.onEdit()');

  // preset pick: sets ALL k coords from the preset, not just the mapped two
  presetSel.value = 'A';
  presetSel.dispatchEvent(new Event('change'));
  assert(JSON.stringify(node.params.coords) === JSON.stringify([1, 2, 0]),
    'picking preset A sets every coord from the preset: ' + JSON.stringify(node.params.coords));
  assert(edits === 2, 'preset pick fires ctx.onEdit()');
  // the slider readouts must resync to the picked preset, not just node.params
  assert(sliders[0].value === '1' && sliders[1].value === '2' && sliders[2].value === '0',
    'slider positions resync after a preset pick');

  // map drag: only touches the two mapped axes (0 and 1), never axis 2
  const cv = root.querySelector('.basis-map');
  const rect = cv.getBoundingClientRect();
  assert(rect.width > 0 && rect.height > 0, 'map canvas has real layout geometry after flush()');
  cv.dispatchEvent(new MouseEvent('mousedown', { clientX: rect.left + 10, clientY: rect.top + 10 }));
  window.dispatchEvent(new MouseEvent('mouseup', {}));
  assert(node.params.coords[2] === 0, 'map drag never touches the unmapped axis (coords[2] stays put after preset A zeroed it)');
  assert(edits === 3, 'map drag fires ctx.onEdit()');
  // dragging toward the top-left corner should move axis 0 down and axis 1 up
  // from wherever preset A left them (1, 2) — exact pixel math isn't asserted,
  // just that the drag actually repositioned the crosshair.
  assert(node.params.coords[0] !== 1 || node.params.coords[1] !== 2,
    'map drag repositions the crosshair away from the preset it started at');

  assert(commits === 0, 'basis-slider-map never calls ctx.onCommit() — only onEdit(), matching multi-curve-painter');

  document.body.removeChild(root);
}

flush();
console.log('TEST_WIDGETS DONE');
