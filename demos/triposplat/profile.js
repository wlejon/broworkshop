// TripoSplat stage-time profile (GPU headless).
//
// Drives bro.triposplat.generate at lab-default settings with the per-stage
// timing in the binding enabled. Run:
//   BRO_TRIPOSPLAT_PROFILE=1 bro-headless ../broworkshop/demos/example \
//       ../broworkshop/demos/triposplat/profile.js
//
// Two generates: the first includes one-time warmup (CUDA graph capture,
// cuBLAS workspaces); the second is the steady-state number that matters.

const WEIGHTS = {
  dinov3:  'D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors',
  vae:     'D:/projects/brodiffusion/weights/triposplat/vae/flux2-vae.safetensors',
  flow:    'D:/projects/brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors',
  decoder: 'D:/projects/brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors',
};

function syntheticImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.32;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const fg = Math.hypot(x - cx, y - cy) < r;
      data[i] = fg ? 200 : 0; data[i + 1] = fg ? 140 : 0;
      data[i + 2] = fg ? 90 : 0; data[i + 3] = fg ? 255 : 0;
    }
  }
  return { data, width: W, height: H };
}

const FS = require('fs');
for (const k in WEIGHTS) assert(FS.existsSync(WEIGHTS[k]), `missing weights: ${WEIGHTS[k]}`);

let t = Date.now();
const ts = bro.triposplat.load(WEIGHTS);
console.log(`load: ${Date.now() - t} ms · device: ${ts.device}`);
assert(ts.device === 'CUDA', 'expected CUDA device');

const img = syntheticImage(512, 512);
const opts = { seed: 42, steps: 20, numGaussians: 131072 };  // lab defaults

console.log('— run 1 (includes warmup / graph capture) —');
t = Date.now();
ts.generate(img, opts);
console.log(`run 1: ${Date.now() - t} ms`);

console.log('— run 2 (steady state) —');
t = Date.now();
const cloud = ts.generate(img, opts);
console.log(`run 2: ${Date.now() - t} ms · ${cloud.count} gaussians`);
