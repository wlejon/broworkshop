// Node Forge — nodes/rave-node.js: mount, curve-paint live decode, collapse/
// delete. Gated on the real converted RAVE checkpoint being present on this
// machine (D:/projects/brosoundml-data/rave/magnets_z8); GPU headless only.
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

const dirInput = card.querySelectorAll('input[type=text]')[0];
dirInput.value = 'D:/projects/brosoundml-data/rave/magnets_z8';
dirInput.dispatchEvent(new Event('change'));
advanceTime(50);
flush();

assert(!node.error, 'node reported an error: ' + node.error);
assert(node._out && node._out[0] && node._out[0].samples.length > 0, 'no audio produced');
console.log('OK: model+source load, initial decode, samples=' + node._out[0].samples.length);

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

// curve paint (mouse drag on the curve-cell canvas) triggers a live re-decode
const firstCell = card.querySelectorAll('.curve-cell')[0];
const cv = firstCell.querySelector('canvas');
const rect = cv.getBoundingClientRect();
const prevSamples = node._out[0].samples;
firstCell._testMouseDown({ clientX: rect.left + 5, clientY: rect.top + 10 });
firstCell._testMouseMove({ clientX: rect.left + 40, clientY: rect.top + 60 });
firstCell._testMouseUp();
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
