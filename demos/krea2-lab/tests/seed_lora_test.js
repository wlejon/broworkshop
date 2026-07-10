// Seeding step for tests/test_lora.js — run this in a NEUTRAL app dir first
// (krea2-lab itself would boot and start the 26GB auto-load):
//
//   bro-headless ../broworkshop/demos/example ../broworkshop/demos/krea2-lab/tests/seed_lora_test.js
//
// It writes two things:
//   1. %TEMP%/krea2_e2e_lora.safetensors — a synthetic rank-4 LoRA over four
//      body blocks' attn.to_q / attn.to_v (diffusers `transformer.` keys).
//      Random factors, NOT a trained LoRA: its only job is to visibly and
//      deterministically perturb the output so scale 1 != scale 0.
//   2. demos/krea2-lab/.storage.json — test prefs: fox prompt, fixed seed,
//      256x256 / 2 steps, live OFF, and the synthetic LoRA at scale 1 so the
//      app's restore-on-load path applies it. BACK UP the existing
//      .storage.json before running (test_lora.js's header shows the full
//      recipe) — this overwrites it.

const fs = require('fs');
const os = require('os');

const APP_DIR = 'D:/projects/broworkshop/demos/krea2-lab';
const MODEL_DIR = 'D:/projects/brodiffusion/weights/krea-2-turbo';
const LORA_PATH = (os.tmpdir() + '/krea2_e2e_lora.safetensors').replace(/\\/g, '/');

// ── synthetic LoRA ──────────────────────────────────────────────────────────
// Krea 2 Turbo dims (weights/krea-2-turbo/model_index.json): hidden 6144
// (48 heads x 128), 12 KV heads -> to_v out 1536.
const HIDDEN = 6144, KV_OUT = 1536, RANK = 4;
const BLOCKS = [0, 9, 18, 27];

// Deterministic LCG so reruns produce the identical file.
let seed = 0x12345678;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return ((seed >>> 8) & 0xffff) / 65535 - 0.5;
}
// ~ +/-0.05: rank-4 deltas land near the real weights' RMS (~1/sqrt(6144)),
// a strong, clearly visible perturbation at scale 1.
function factors(n) {
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = rand() * 0.1;
  return v;
}

function writeSafetensors(path, tensors) {
  let offset = 0;
  const meta = {};
  for (const t of tensors) {
    const bytes = t.data.byteLength;
    meta[t.name] = { dtype: 'F32', shape: t.shape, data_offsets: [offset, offset + bytes] };
    offset += bytes;
  }
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(8 + header.length + offset);
  new DataView(out.buffer).setBigUint64(0, BigInt(header.length), true);
  out.set(header, 8);
  let o = 8 + header.length;
  for (const t of tensors) {
    out.set(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength), o);
    o += t.data.byteLength;
  }
  fs.writeFileSync(path, out);
}

const tensors = [];
for (const b of BLOCKS) {
  const p = 'transformer.transformer_blocks.' + b + '.attn.';
  tensors.push({ name: p + 'to_q.lora_A.weight', shape: [RANK, HIDDEN], data: factors(RANK * HIDDEN) });
  tensors.push({ name: p + 'to_q.lora_B.weight', shape: [HIDDEN, RANK], data: factors(HIDDEN * RANK) });
  tensors.push({ name: p + 'to_v.lora_A.weight', shape: [RANK, HIDDEN], data: factors(RANK * HIDDEN) });
  tensors.push({ name: p + 'to_v.lora_B.weight', shape: [KV_OUT, RANK], data: factors(KV_OUT * RANK) });
}
writeSafetensors(LORA_PATH, tensors);
console.log('wrote ' + LORA_PATH + ' (' + tensors.length + ' tensors)');

// ── test prefs ──────────────────────────────────────────────────────────────
const prefs = {
  modelDir: MODEL_DIR,
  prompt: 'a red fox sitting in a snowy forest clearing at dawn',
  negPrompt: '',
  seed: '123', steps: '2', guidance: '1',
  width: '256', height: '256',
  live: false,            // the test drives explicit Generate clicks
  randSeed: false,        // fixed seed — renders must be comparable
  loras: [{ path: LORA_PATH, scale: 1 }],
};
fs.writeFileSync(APP_DIR + '/.storage.json',
                 JSON.stringify({ 'krea2-lab.v1': JSON.stringify(prefs) }, null, 2));
console.log('seeded ' + APP_DIR + '/.storage.json');
console.log('SEED OK');
