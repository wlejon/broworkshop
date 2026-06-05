// Headless end-to-end check for bro.triposplat. Self-contained: a synthetic
// foreground-on-black image (no file decode / DOM needed) is enough to exercise
// the full DINOv3 + VAE -> flow sampler -> octree decoder path and assert the
// returned Gaussian cloud is well-formed. Run against any minimal app dir:
//   bro-headless ../broworkshop/demos/example ../broworkshop/demos/triposplat/test.js

const WEIGHTS = {
  dinov3:  "D:/projects/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors",
  vae:     "D:/projects/brodiffusion/weights/triposplat/vae/flux2-vae.safetensors",
  flow:    "D:/projects/brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors",
  decoder: "D:/projects/brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors",
};

function syntheticImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.32;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      const fg = d < r;                       // a centered disc foreground on black
      data[i]   = fg ? 200 : 0;
      data[i+1] = fg ? 140 : 0;
      data[i+2] = fg ? 90  : 0;
      data[i+3] = fg ? 255 : 0;               // alpha = matte
    }
  }
  return { data, width: W, height: H };
}

const ts = bro.triposplat.load(WEIGHTS);
console.log("device:", ts.device);

const numGaussians = 32768, steps = 4;
console.log(`generating ${numGaussians} gaussians, ${steps} steps…`);
const c = ts.generate(syntheticImage(512, 512), { seed: 42, steps, guidanceScale: 3.0, numGaussians });

const expect = Math.floor(numGaussians / 32) * 32;
assert(c.count === expect, `count ${c.count} != ${expect}`);
assert(c.positions.length === c.count * 3, "positions stride");
assert(c.scales.length === c.count * 3, "scales stride");
assert(c.rotations.length === c.count * 4, "rotations stride");
assert(c.opacities.length === c.count, "opacities stride");
assert(c.sh.length === c.count * 3, "sh stride (deg 0)");

let lo = 1e9, hi = -1e9, badq = 0, badop = 0;
for (let i = 0; i < c.positions.length; i++) {
  const v = c.positions[i];
  assert(Number.isFinite(v), "non-finite position");
  lo = Math.min(lo, v); hi = Math.max(hi, v);
}
for (let i = 0; i < c.count; i++) {
  const x = c.rotations[i*4], y = c.rotations[i*4+1], z = c.rotations[i*4+2], w = c.rotations[i*4+3];
  if (Math.abs(Math.hypot(x, y, z, w) - 1) > 1e-2) badq++;
  const o = c.opacities[i];
  if (!(o >= 0 && o <= 1)) badop++;
}
// Centers map _xyz in [0,1] to [-0.5,0.5]; the elastic per-Gaussian offsets
// (tanh * 0.5 * perturbe_size * offset_scale) legitimately push a little past
// the cube, so the bound is generous — it only guards against gross divergence.
assert(lo >= -0.8 && hi <= 0.8, `positions out of range: [${lo}, ${hi}]`);
assert(badq === 0, `${badq} non-unit quaternions`);
assert(badop === 0, `${badop} opacities outside [0,1]`);

console.log(`OK — ${c.count} gaussians, pos in [${lo.toFixed(3)}, ${hi.toFixed(3)}], ` +
            `sh deg ${c.shDegree}, all quats unit, opacity in [0,1]`);
