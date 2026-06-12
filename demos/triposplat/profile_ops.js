// TripoSplat flow-DiT per-op profile: 2 sampler steps, eager, with
// BRODIFFUSION_FLOW_PROFILE=1 printing a per-forward op breakdown.
// Run via profile_ops.sh.

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

const ts = bro.triposplat.load(WEIGHTS);
console.log('device:', ts.device);
const img = syntheticImage(512, 512);
const t = Date.now();
ts.generate(img, { seed: 42, steps: 2, numGaussians: 32768 });
console.log(`done in ${Date.now() - t} ms`);
