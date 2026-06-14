// Headless end-to-end check for the TripoSplat Lab capabilities.
//
// Exercises the engine bits the lab leans on, with no worker / DOM-app boot:
//   1. bro.triposplat.load (incl. the optional BiRefNet matte model)
//   2. generate() with opts.removeBackground both off and on
//   3. the in-memory cloud → scene.createGaussianSplat → node.savePly → reload
//      round-trip (the .ply export path)
//
// A synthetic foreground-on-black image is enough to drive the full pipeline.
// Run against a minimal app dir (GPU headless):
//   bro-headless ../broworkshop/demos/example ../broworkshop/demos/triposplat/test_smoke.js

const WROOT = (typeof process !== 'undefined' && process.env.BRO_WEIGHTS) || 'D:/projects';
const WEIGHTS = {
  dinov3:   WROOT + '/brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors',
  vae:      WROOT + '/brodiffusion/weights/triposplat/vae/flux2-vae.safetensors',
  flow:     WROOT + '/brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors',
  decoder:  WROOT + '/brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors',
  birefnet: WROOT + '/brovisionml/weights/triposplat/background_removal/birefnet.safetensors',
};

function syntheticImage(W, H) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.32;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const fg = Math.hypot(x - cx, y - cy) < r;   // centered disc on black
      data[i] = fg ? 200 : 0; data[i + 1] = fg ? 140 : 0;
      data[i + 2] = fg ? 90 : 0; data[i + 3] = fg ? 255 : 0;   // alpha = matte
    }
  }
  return { data, width: W, height: H };
}

function validateCloud(c, numGaussians, tag) {
  const expect = Math.floor(numGaussians / 32) * 32;
  assert(c.count === expect, `${tag}: count ${c.count} != ${expect}`);
  assert(c.positions.length === c.count * 3, `${tag}: positions stride`);
  assert(c.scales.length === c.count * 3, `${tag}: scales stride`);
  assert(c.rotations.length === c.count * 4, `${tag}: rotations stride`);
  assert(c.opacities.length === c.count, `${tag}: opacities stride`);
  assert(c.sh.length === c.count * 3, `${tag}: sh stride (deg 0)`);
  let lo = 1e9, hi = -1e9, badq = 0, badop = 0;
  for (let i = 0; i < c.positions.length; i++) {
    const v = c.positions[i];
    assert(Number.isFinite(v), `${tag}: non-finite position`);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  for (let i = 0; i < c.count; i++) {
    const x = c.rotations[i * 4], y = c.rotations[i * 4 + 1],
          z = c.rotations[i * 4 + 2], w = c.rotations[i * 4 + 3];
    if (Math.abs(Math.hypot(x, y, z, w) - 1) > 1e-2) badq++;
    const o = c.opacities[i];
    if (!(o >= 0 && o <= 1)) badop++;
  }
  assert(lo >= -0.8 && hi <= 0.8, `${tag}: positions out of range [${lo}, ${hi}]`);
  assert(badq === 0, `${tag}: ${badq} non-unit quaternions`);
  assert(badop === 0, `${tag}: ${badop} opacities outside [0,1]`);
  console.log(`  ${tag}: ${c.count} gaussians, pos in [${lo.toFixed(3)}, ${hi.toFixed(3)}], ` +
              `sh deg ${c.shDegree}, quats unit, opacity in [0,1]`);
}

// ── 1. load ───────────────────────────────────────────────────────────────
const FS = require('fs');
const weights = {};
for (const k in WEIGHTS) if (FS.existsSync(WEIGHTS[k])) weights[k] = WEIGHTS[k];
assert(weights.dinov3 && weights.vae && weights.flow && weights.decoder,
       'required TripoSplat weights missing — run scripts/download-triposplat.sh');

const ts = bro.triposplat.load(weights);
console.log('device:', ts.device, '· backgroundRemoval:', ts.backgroundRemoval);
assert(ts.backgroundRemoval === !!weights.birefnet,
       'backgroundRemoval getter should reflect whether birefnet was loaded');

// ── 2. generate, both background-removal modes ──────────────────────────────
const numGaussians = 32768, steps = 4;
const img = syntheticImage(512, 512);

console.log(`generating ${numGaussians} gaussians, ${steps} steps (removeBackground=false)…`);
const cNoBg = ts.generate(img, { seed: 42, steps, numGaussians, removeBackground: false });
validateCloud(cNoBg, numGaussians, 'no-bg');

if (ts.backgroundRemoval) {
  console.log(`generating (removeBackground=true) — exercises BiRefNet…`);
  const cBg = ts.generate(img, { seed: 42, steps, numGaussians, removeBackground: true });
  validateCloud(cBg, numGaussians, 'bg-removed');
}

// ── 3. createGaussianSplat → savePly → reload round-trip ────────────────────
const canvas = document.createElement('canvas');
canvas.setAttribute('width', '256');
canvas.setAttribute('height', '256');
document.body.appendChild(canvas);
flush();

const scene = canvas.getContext('scene');
if (!scene) {
  console.log('scene context not available (no GPU) — skipping savePly round-trip');
} else {
  const node = scene.createGaussianSplat({ cloud: cNoBg, scale: 1 });
  assert(node, 'createGaussianSplat returns a node');
  assert(node.type === 'gaussianSplat', `node.type ${node.type} != gaussianSplat`);
  assert(node.splatCount === cNoBg.count, `splatCount ${node.splatCount} != ${cNoBg.count}`);

  const out = require('os').tmpdir().replace(/\\/g, '/') + '/triposplat_smoke.ply';
  const ok = node.savePly(out);
  assert(ok === true, 'savePly returns true');
  assert(FS.existsSync(out), 'savePly wrote a file');
  assert(FS.statSync(out).size > 0, 'savePly file is non-empty');

  // Reopen the .ply through the path loader and confirm the count survives.
  const reloaded = scene.createGaussianSplat({ path: out });
  assert(reloaded.splatCount === cNoBg.count,
         `reloaded splatCount ${reloaded.splatCount} != ${cNoBg.count}`);
  console.log(`  savePly: wrote + reloaded ${reloaded.splatCount} splats from ${out}`);

  // An empty/non-splat node must reject savePly.
  const mesh = scene.createMesh({ mesh: 'box' });
  let threw = false;
  try { mesh.savePly(out); } catch (e) { threw = true; }
  assert(threw, 'savePly on a non-splat node should throw');

  FS.unlinkSync(out);
}

console.log('OK — TripoSplat load + generate (bg modes) + savePly round-trip all pass');
