// Diffusion Lab word-axis seam test (loads weights). Builds the pipeline the
// way lab/diffusion-worker.js does (createPipeline + loadWeights + the
// LCM-LoRA), builds an "age" axis with the kit's recipe (imagegen-worker.js
// wordAxis: CLIP diff of means, no sink dims), and checks the
// conditioning-control seam through that path:
//   - encodeConditioning is CLIP-width (768)
//   - a steered render differs from the baseline at the same seed
//   - strength 0 reproduces the baseline (a true no-op)
// It measures pixel differences only. It does not judge image quality.
//
//   scripts/validate.sh --ml demos/diffusion-lab

import { check, eq, test, done, needWeights, skip } from "/lib/kit/test.js";
import { findWeights } from "/lib/kit/weights.js";
import { wordAxis } from "/lib/kit/imagegen-worker.js";
import { Profiles } from "/app/lab/profiles.js";

if (typeof bro === 'undefined' || !bro.diffusion) skip('bro.diffusion unavailable');
const modelDir = needWeights('SD1.5', ['brodiffusion/weights/sd15'], { probe: 'tokenizer/vocab.json' });
const lcmLora = findWeights(['brodiffusion/weights/lcm-lora-sdv1-5/pytorch_lora_weights.safetensors']);

bro.diffusion.init();
const det = Profiles.detect(modelDir);
const spec = det.profile.buildSpec(det, 'lcm', false);
const pipe = bro.diffusion.createPipeline(spec.pipeline);
pipe.loadWeights(spec.weights.text, spec.weights.unet, spec.weights.vae);
if (lcmLora) pipe.applyLora(lcmLora, 1.0);
console.log('pipeline ready (' + (pipe.config().modelClass || '?') + ', lcm' + (lcmLora ? ' + LCM-LoRA' : '') + ')');

test('encodeConditioning is CLIP width', () => eq(pipe.encodeConditioning('a person').cols, 768, 'cols'));

const axis = wordAxis(pipe, ['a young person', 'a child', 'a youthful face'],
                      ['an old person', 'an elderly man', 'a wrinkled aged face']);
console.log('age axis separation = ' + axis.sep.toFixed(2));
test('axis has separation', () => check(axis.sep > 0, 'sep ' + axis.sep));
pipe.setControlVector('age', axis.unit, 0.0, 1.0);

const opts = { width: 512, height: 512, steps: 6, guidanceScale: 1.0, seed: 1234, negativePrompt: '' };
function render(controls) {
    pipe.clearControl();
    if (controls) pipe.setControl(controls);
    const st = pipe.prime('a portrait photo of a person', opts);
    while (!st.done) st.stepOnce();
    return st.decode();
}
function meanAbsDiff(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / n;
}

const base = render(null);
const dSteer = meanAbsDiff(base.data, render({ age: 30.0 }).data);
const dZero = meanAbsDiff(base.data, render({ age: 0.0 }).data);
console.log('mean |Δpixel| baseline vs steered(+30) = ' + dSteer.toFixed(2) + ', vs strength 0 = ' + dZero.toFixed(3));
test('the axis steers the render', () => check(dSteer > 2.0, 'Δ ' + dSteer.toFixed(2)));
test('strength 0 is a true no-op', () => check(dZero < 0.01, 'Δ ' + dZero.toFixed(3)));
pipe.dispose();
done('diffusion-lab word axis');
