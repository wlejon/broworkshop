// Node Forge — nodes/qwen-node.js: mount across all three checkpoint
// variants, async live synth (voice-design slider + cvSource flip, delivery
// dial, steer), exec() sync determinism, collapse/delete. Gated on the real
// bundled checkpoints being present on this machine
// (D:/projects/brosoundml/weights/qwen-tts/{0.6B-customvoice,1.7B-voicedesign,
// 0.6B-Base}); GPU headless only.
advanceTime(50);
flush();

const app = window.LabApp;
assert(app, 'LabApp handle missing');

// ── CustomVoice: the primary interactive path ──────────────────────────────
const node = app.graph.addNode('qwen');
node.params.modelDir = 'D:/projects/brosoundml/weights/qwen-tts/0.6B-customvoice';
app.editor.placeNew(node);
app.editor.draw(0);
advanceTime(16);
flush();

let card = document.querySelector('.node-card');
assert(card, 'no .node-card rendered');
console.log('card built, waiting for checkpoint load + first synth...');

let _w = 0;
while (!(node._out && node._out[0]) && !node.error && _w++ < 60000) advanceTime(16);
assert(!node.error, 'node reported an error: ' + node.error);
assert(node._out && node._out[0] && node._out[0].samples.length > 0, 'no audio produced after waiting');
assert(node._variant === 'customvoice', 'expected customvoice variant, got ' + node._variant);
assert(node._voiceBasis, 'voice basis not loaded (expected sibling 0.6B-Base resolution)');
assert(node._lastTrace && node._lastTrace.stages, 'no trace captured');
console.log('OK: first synth landed, samples=' + node._out[0].samples.length +
  ', trace stages=' + node._lastTrace.stages.map((s) => s.name).join(','));

// exec() sync path determinism at greedy (temperature=0) sampling
const first = node._out[0].samples;
app.runner.reset();
const n = app.runner.run();
assert(n === 1, 'expected 1 node to run');
assert(node._out[0].samples.length === first.length, 'exec() produced a different-length buffer');
let same = true;
for (let i = 0; i < first.length; i += 97) if (Math.abs(node._out[0].samples[i] - first[i]) > 1e-5) { same = false; break; }
assert(same, 'exec() sync path is not deterministic at greedy sampling');
console.log('OK: exec() sync path matches the live-path result at greedy sampling');

// voice-design slider drag flips cvSource to 'designed' and re-synthesizes
const designerDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Voice design') !== -1);
assert(designerDetails, 'Voice design details missing');
designerDetails.open = true;
const slider = designerDetails.querySelector('.basis-sliders input[type=range]');
assert(slider, 'no voice-design sliders rendered');
const prevSamples = node._out[0].samples;
slider.value = String(+slider.max * 0.6);
slider.dispatchEvent(new Event('input'));
_w = 0;
while ((!node._out || node._out[0].samples === prevSamples) && _w++ < 60000) advanceTime(16);
assert(node._out && node._out[0].samples !== prevSamples, 'voice-design slider drag did not trigger a re-synth');
assert(node.params.cvSource === 'designed', 'slider drag did not switch cvSource to designed (still ' + node.params.cvSource + ')');
console.log('OK: voice-design slider drag re-synthesized and switched to the designed-slot override');

// delivery dial: crank temperature, confirm sampling actually applies
const deliveryDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Delivery') !== -1);
deliveryDetails.open = true;
const tempSlider = deliveryDetails.querySelectorAll('.dial input[type=range]')[0];
assert(tempSlider, 'no delivery dials rendered');
tempSlider.value = '0.8';
tempSlider.dispatchEvent(new Event('input'));
const beforeDeliverySamples = node._out[0].samples;
_w = 0;
while ((!node._out || node._out[0].samples === beforeDeliverySamples) && _w++ < 60000) advanceTime(16);
assert(node._out && node._out[0].samples !== beforeDeliverySamples, 'temperature change did not trigger a re-synth');
assert(node.params.sampling.temperature === 0.8, 'temperature param not applied');
console.log('OK: delivery dial re-synthesized at temperature=' + node.params.sampling.temperature);

// steer: stage a code bias directly (deterministic — not a raster click) and confirm re-synth
const steerDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Steer') !== -1);
steerDetails.open = true;
const steerIdInput = steerDetails.querySelector('input[type=number]');
const steerAddBtn = [...steerDetails.querySelectorAll('button')].find((b) => b.textContent.indexOf('bias') !== -1);
assert(steerIdInput && steerAddBtn, 'steer controls missing');
steerIdInput.value = '5';
const beforeSteerSamples = node._out[0].samples;
steerAddBtn.click();
_w = 0;
while ((!node._out || node._out[0].samples === beforeSteerSamples) && _w++ < 60000) advanceTime(16);
assert(node._out && node._out[0].samples !== beforeSteerSamples, 'steer bias did not trigger a re-synth');
assert(Object.keys(node.params.steer).length === 1, 'steer bias not recorded in params');
console.log('OK: steer bias re-synthesized, steer=' + JSON.stringify(node.params.steer));

// pipeline trace: code raster + confidence + waveform cards landed
const traceDetails = [...card.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent.indexOf('Pipeline trace') !== -1);
traceDetails.open = true;
const traceCards = traceDetails.querySelectorAll('.trace-card');
assert(traceCards.length >= 2, 'expected at least codes+audio trace cards, got ' + traceCards.length);
console.log('OK: ' + traceCards.length + ' trace cards rendered');

// collapse / delete
const collapseBtn = card.querySelector('.node-collapse');
collapseBtn.click();
assert(node.collapsed === true, 'collapse failed');
collapseBtn.click();
const delBtn = card.querySelector('.node-del');
delBtn.click();
assert(app.graph.nodes.length === 0, 'node not removed');
assert(document.querySelectorAll('.node-card').length === 0, 'card DOM not removed');
console.log('OK: collapse/expand + delete');

// ── VoiceDesign + Base: confirm the other two variants mount cleanly ───────
function mountVariant(dir, expectVariant, expectBasis) {
  const n2 = app.graph.addNode('qwen');
  n2.params.modelDir = dir;
  app.editor.placeNew(n2);
  app.editor.draw(0);
  advanceTime(16);
  flush();
  let iw = 0;
  while (!(n2._out && n2._out[0]) && !n2.error && iw++ < 60000) advanceTime(16);
  assert(!n2.error, dir + ' errored: ' + n2.error);
  assert(n2._variant === expectVariant, 'expected ' + expectVariant + ', got ' + n2._variant);
  assert(!!n2._voiceBasis === expectBasis, 'basis presence mismatch for ' + dir);
  return n2;
}
const vd = mountVariant('D:/projects/brosoundml/weights/qwen-tts/1.7B-voicedesign', 'voicedesign', false);
console.log('OK: VoiceDesign mounted, no crash on a basis-less variant');
const base = mountVariant('D:/projects/brosoundml/weights/qwen-tts/0.6B-Base', 'base', true);
assert(base.params.coords.length === base._voiceBasis.k, 'coords not sized to basis k');
console.log('OK: Base mounted, designer basis loaded (k=' + base._voiceBasis.k + ')');

console.log('ALL QWEN NODE CHECKS PASSED');
