// Node Forge — nodes/kokoro-node.js: mount, model+basis load, async live
// synth (voice slider, duration-cell edit with pinned-edit retention), exec()
// sync path, collapse/delete. Gated on the real Kokoro data root being
// present on this machine (D:/projects/brosoundml-data); GPU headless only.
advanceTime(50);
flush();

const app = window.LabApp;
assert(app, 'LabApp handle missing');

const node = app.graph.addNode('kokoro');
node.params.dataRoot = 'D:/projects/brosoundml-data';
app.editor.placeNew(node);
app.editor.draw(0);
advanceTime(16);
flush();

let card = document.querySelector('.node-card');
assert(card, 'no .node-card rendered');
console.log('card built, waiting for load+first synth...');

// the model load + first async synth/trace pass happens off-thread; poll
// virtual time in small 16ms ticks (matches kokoro-lab's own async tests —
// each tick gives the background thread a real scheduling opportunity, a
// handful of large ticks does not).
let _w = 0;
while (!(node._out && node._out[0]) && !node.error && _w++ < 60000) advanceTime(16);
assert(!node.error, 'node reported an error: ' + node.error);
assert(node._out && node._out[0] && node._out[0].samples.length > 0, 'no audio produced after waiting');
console.log('OK: first synth landed, samples=' + node._out[0].samples.length);
assert(node._basis, 'voice basis not loaded');
assert(node._lastTrace, 'no trace captured');
console.log('basis k=' + node._basis.k + ', trace stages=' + node._lastTrace.stages.length +
  ', emotionBasis=' + !!node._emotionBasis + ', mascFemBasis=' + !!node._mascFemBasis);

// exec() sync path determinism against the same voice/text (greedy — Kokoro
// has no sampling temperature, so this should be bit-identical every Run).
const first = node._out[0].samples;
app.runner.reset();
const n = app.runner.run();
assert(n === 1, 'expected 1 node to run');
assert(node._out[0].samples.length === first.length, 'exec() produced a different-length buffer');
let same = true;
for (let i = 0; i < first.length; i += 97) if (Math.abs(node._out[0].samples[i] - first[i]) > 1e-5) { same = false; break; }
assert(same, 'exec() sync path is not deterministic against the live-path result');
console.log('OK: exec() sync path matches the live-path result (Run/save-load determinism)');

// drag a voice slider (via its DOM input) and confirm a re-synth eventually lands
const voiceDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Voice design') !== -1);
assert(voiceDetails, 'Voice design details missing');
voiceDetails.open = true;
const firstSlider = voiceDetails.querySelector('.pc input[type=range]');
assert(firstSlider, 'no voice sliders rendered');
const prevSamples = node._out[0].samples;
firstSlider.value = String(+firstSlider.max * 0.6);
firstSlider.dispatchEvent(new Event('input'));
_w = 0;
while ((!node._out || node._out[0].samples === prevSamples) && _w++ < 60000) advanceTime(16);
assert(node._out && node._out[0].samples !== prevSamples, 'voice slider drag did not trigger a re-synth');
console.log('OK: voice slider drag re-synthesized');

// duration-cell edit (Prosody & alignment) — pins a prosody edit that
// should ride across the change (capturePin/reapplyPin).
const prosodyDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Prosody') !== -1);
prosodyDetails.open = true;
const cell = prosodyDetails.querySelector('.acell');
assert(cell, 'no duration cells rendered');
const beforeDurSamples = node._out[0].samples;
const numInput = cell.querySelector('.acell-num');
numInput.value = String(+numInput.value + 5);
numInput.dispatchEvent(new Event('change'));
_w = 0;
while ((!node._out || node._out[0].samples === beforeDurSamples) && _w++ < 60000) advanceTime(16);
assert(node._out && node._out[0].samples !== beforeDurSamples, 'duration-cell edit did not trigger a re-decode');
assert(node._pinnedEdit, 'duration-cell edit should capture a pinned prosody edit');
console.log('OK: duration-cell edit re-decoded, pinned=' + !!node._pinnedEdit);

// collapse / delete
const collapseBtn = card.querySelector('.node-collapse');
collapseBtn.click();
assert(node.collapsed === true, 'collapse failed');
collapseBtn.click();

const delBtn = card.querySelector('.node-del');
delBtn.click();
assert(app.graph.nodes.length === 0, 'node not removed');
assert(document.querySelectorAll('.node-card').length === 0, 'card DOM not removed');

console.log('ALL KOKORO NODE CHECKS PASSED');
