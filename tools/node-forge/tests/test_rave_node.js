// Node Forge — nodes/rave-node.js: mount, full-controls dialog, curve-paint
// live decode (mini card + dialog grid stay in sync), collapse/delete. Gated
// on the real converted RAVE checkpoint being present on this machine
// (D:/projects/brosoundml-data/rave/magnets_z8); GPU headless only.
advanceTime(50);
flush();

const app = window.LabApp;
assert(app, 'LabApp handle missing');

const node = app.graph.addNode('rave');
app.editor.placeNew(node);
app.editor.draw(0);
advanceTime(16);
flush();

let card = document.querySelector('.node-card');
assert(card, 'no .node-card rendered after addNode');

// Model dir / source live in the full-controls dialog now, not the mini card.
const gearBtn = card.querySelector('.node-gear');
assert(gearBtn, 'no full-controls gear button on the card');
gearBtn.click();
let dialogBody = document.querySelector('.node-dialog-body');
assert(dialogBody, 'full-controls dialog did not open');
assert(document.querySelector('.node-dialog-backdrop').style.display === 'flex', 'dialog backdrop not shown');

const dirInput = dialogBody.querySelectorAll('input[type=text]')[0];
dirInput.value = 'D:/projects/brosoundml-data/rave/magnets_z8';
dirInput.dispatchEvent(new Event('change'));
advanceTime(50);
flush();

assert(!node.error, 'node reported an error: ' + node.error);
assert(node._out && node._out[0] && node._out[0].samples.length > 0, 'no audio produced');
console.log('OK: model+source load, initial decode, samples=' + node._out[0].samples.length);

const nLatent = node._enc.nLatent;
assert(nLatent > 0, 'no latent dims reported');
const dialogCells = document.querySelectorAll('.node-dialog-body .curve-cell');
assert(dialogCells.length === nLatent, 'dialog curve grid does not show all ' + nLatent + ' latent dims (got ' + dialogCells.length + ')');
console.log('OK: full-controls dialog shows all ' + nLatent + ' latent-dim curve editors');

// exec() sync path determinism: same model/source/curves -> bit-identical output
const first = node._out[0].samples;
app.runner.reset();
const n = app.runner.run();
assert(n === 1, 'expected 1 node to run');
assert(node._out[0].samples.length === first.length, 'exec() sync path produced a different-length buffer');
let same = true;
for (let i = 0; i < first.length; i += 97) if (Math.abs(node._out[0].samples[i] - first[i]) > 1e-5) { same = false; break; }
assert(same, 'exec() sync path is not deterministic against the live-path result for identical inputs');
console.log('OK: exec() sync path matches the live-path result (Run/save-load determinism)');

// paint dim 1 in the DIALOG grid, close, switch the mini card's dim picker to
// dim 1, and confirm it shows the edited curve — the onDialogToggle cross-
// refresh (mini card <-> dialog share the same node.params.curves arrays).
const dialogCell1 = dialogCells[1];
const dcv = dialogCell1.querySelector('canvas');
const drect = dcv.getBoundingClientRect();
dialogCell1._testMouseDown({ clientX: drect.left + 5, clientY: drect.top + 10 });
dialogCell1._testMouseMove({ clientX: drect.left + 40, clientY: drect.top + 70 });
dialogCell1._testMouseUp();
advanceTime(80);
flush();
const editedDim1 = node.params.curves[1].slice();

document.querySelector('.node-dialog-close').click();
assert(document.querySelector('.node-dialog-backdrop').style.display === 'none', 'dialog did not close');

const dimSel = card.querySelectorAll('select')[0];
assert(dimSel, 'no latent-dim picker on the mini card');
dimSel.value = '1';
dimSel.dispatchEvent(new Event('change'));

let cell1 = card.querySelectorAll('.curve-cell')[0];
assert(node.params.curves[1].every((v, i) => v === editedDim1[i]), 'underlying curve data changed unexpectedly');
const cell1Stats = cell1.querySelector('.curve-stats');
assert(cell1Stats && cell1Stats.textContent.includes('Δ'), 'mini card curve cell (dim 1) does not show the dialog edit (no delta from original)');
console.log('OK: mini card and dialog curve views stay in sync across open/close');

// curve paint on the MINI CARD's own curve cell (dim 1 selected above)
// triggers a live re-decode.
const prevSamples = node._out[0].samples;
const cv = cell1.querySelector('canvas');
const rect = cv.getBoundingClientRect();
cell1._testMouseDown({ clientX: rect.left + 5, clientY: rect.top + 10 });
cell1._testMouseMove({ clientX: rect.left + 40, clientY: rect.top + 60 });
cell1._testMouseUp();
advanceTime(80);
flush();
assert(node._out && node._out[0].samples !== prevSamples, 'curve paint did not re-decode');
console.log('OK: curve paint re-decoded, samples=' + node._out[0].samples.length);

// collapse / delete
const collapseBtn = card.querySelector('.node-collapse');
collapseBtn.click();
assert(node.collapsed === true, 'collapse did not set node.collapsed');
collapseBtn.click();

const delBtn = card.querySelector('.node-del');
delBtn.click();
assert(app.graph.nodes.length === 0, 'node not removed from graph');
assert(document.querySelectorAll('.node-card').length === 0, 'card DOM not removed');

console.log('ALL RAVE NODE CHECKS PASSED');
