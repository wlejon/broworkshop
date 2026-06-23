// Smoke test for pixart-lab: load PixArt-Sigma and run one generation through the
// same bro.diffusion path the worker uses. Run headless (GPU):
//
//   CUDA_VISIBLE_DEVICES=1 bro-headless ../broworkshop/demos/pixart-lab \
//       tests/test_generate.js
//
// Writes pixart_smoke.png on success.

const MODEL_DIR = 'D:/projects/brodiffusion/weights/pixart-sigma';

assert(typeof bro !== 'undefined' && bro.diffusion, 'bro.diffusion missing');

console.log('loading ' + MODEL_DIR + ' …');
const pipe = bro.diffusion.loadModel(MODEL_DIR);
const cfg = pipe.config();
console.log('config: ' + JSON.stringify(cfg));
assert(cfg.modelClass === 'PixArt', 'expected PixArt, got ' + cfg.modelClass);

console.log('generating …');
const t0 = Date.now();
const img = pipe.generate('a photo of a small bird perched on a branch', {
  width: 512, height: 512,
  steps: 8,
  guidanceScale: 4.5,
  seed: 0,
  negativePrompt: 'blurry, low quality',
});
console.log('generated ' + img.width + 'x' + img.height + ' in ' + (Date.now() - t0) + ' ms');
assert(img.width === 512 && img.height === 512, 'unexpected image size');
assert(img.data && img.data.length === 512 * 512 * 4, 'unexpected pixel buffer');

// sanity: the frame must not be uniformly black (the KL-VAE upcast bug symptom)
let nonzero = 0;
for (let i = 0; i < img.data.length; i += 4) {
  if (img.data[i] | img.data[i + 1] | img.data[i + 2]) { nonzero++; }
}
console.log('non-black pixels: ' + nonzero + ' / ' + (512 * 512));
assert(nonzero > 512 * 512 / 100, 'image is (nearly) all black');

const data = new ImageData(img.data, img.width, img.height);
createImageBitmap(data).then((bm) => {
  console.log('PASS — pixart-lab generate path works');
});
