// E2E test for krea2-lab's LoRA panel: restore-on-load, live strength
// rescale, and removal — driven through the ACTUAL UI against the real
// Krea 2 Turbo checkpoint, with a synthetic (random rank-4) LoRA whose only
// job is to visibly, deterministically perturb the output.
//
// Self-seeds the synthetic LoRA file and form state before the worker's
// `ready` message triggers `doLoad()`, and restores `.storage.json` on exit.
//
// Checks:
//   1. the seeded LoRA is re-applied on model load and shows one panel row
//   2. render at scale 1 differs from render at scale 0 (slider drag)
//   3. render after removing the LoRA (x) is identical to the scale-0 render
//      (an attached-but-zeroed adapter must be a true no-op)

const fs = require('fs');
const os = require('os');

function $(id) { return document.getElementById(id); }

const STORAGE_PATH = String(bro.appDir).replace(/\\/g, '/').replace(/\/+$/, '') + '/.storage.json';
const savedStorage = fs.existsSync(STORAGE_PATH) ? fs.readFileSync(STORAGE_PATH, 'utf8') : null;

// ── self-seed synthetic LoRA + deterministic test form state before load ─────
const LORA_PATH = (os.tmpdir() + '/krea2_e2e_lora.safetensors').replace(/\\/g, '/');
{
  const HIDDEN = 6144, KV_OUT = 1536, RANK = 4;
  const BLOCKS = [0, 9, 18, 27];
  let seed = 0x12345678;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return ((seed >>> 8) & 0xffff) / 65535 - 0.5;
  }
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

  $('prompt').value = 'a red fox sitting in a snowy forest clearing at dawn';
  $('neg-prompt').value = '';
  $('seed').value = '123';
  $('steps').value = '2';
  $('guidance').value = '1';
  $('width').value = '256';
  $('height').value = '256';
  $('rand-seed').checked = false;
  $('live').checked = false;
  $('live').dispatchEvent(new Event('change'));
  if (window.__ctx && window.__ctx.setPersistedLoras) {
    window.__ctx.setPersistedLoras([{ path: LORA_PATH, scale: 1 }]);
  }
}

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}

function statusIs(s) { return $('status-text').textContent === s; }
function statusErr() { return $('status-text').classList.contains('err'); }

function grabCanvas() {
  const c = $('view');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}
function diffCount(a, b, tol) {
  assert(a.length === b.length, 'comparable frames');
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) n++;
  return n;
}
function generateAndGrab(label) {
  $('btn-generate').click();
  assert(pumpUntil(() => !statusIs('done') || statusErr(), 10000),
         label + ': generation started');
  assert(pumpUntil(() => statusIs('done') || statusErr(), 180000),
         label + ': generation finished within budget');
  assert(!statusErr(), label + ': no error — ' + $('status-text').textContent);
  return grabCanvas();
}

// ── model load + LoRA restore ────────────────────────────────────────────────
assert($('lora-list'), 'LoRA panel exists');
assert($('btn-lora-add'), 'Add LoRA button exists');

console.log('waiting for the model to load — this reads ~26GB of weights…');
assert(pumpUntil(() => !$('btn-generate').disabled || statusErr(), 600000),
       'model load finished within budget');
assert(!statusErr(), 'model loaded without error: ' + $('status-text').textContent);

console.log('waiting for the seeded LoRA to re-apply…');
assert(pumpUntil(() => $('lora-status').textContent.indexOf('re-applied') >= 0 ||
                       $('lora-status').classList.contains('err'), 120000),
       'LoRA restore finished');
assert(!$('lora-status').classList.contains('err'),
       'LoRA restored without error: ' + $('lora-status').textContent);
assert($('lora-list').children.length === 1,
       'one LoRA row in the panel (got ' + $('lora-list').children.length + ')');
const row = $('lora-list').children[0];
const slider = row.querySelector('input[type=range]');
assert(slider && +slider.value === 1, 'restored at scale 1 (got ' + (slider && slider.value) + ')');
console.log('restored: ' + $('lora-status').textContent);

// ── scale 1 vs scale 0 must differ ──────────────────────────────────────────
const withLora = generateAndGrab('scale-1 render');

slider.value = '0';
slider.dispatchEvent(new Event('input'));
slider.dispatchEvent(new Event('change'));   // live is off — no auto render
const zeroed = generateAndGrab('scale-0 render');

const dOn = diffCount(withLora, zeroed, 2);
console.log('scale 1 vs scale 0: ' + dOn + ' differing bytes');
assert(dOn > withLora.length / 100, 'the LoRA visibly changes the render');

// ── removing the LoRA must equal the zeroed render ──────────────────────────
row.querySelector('.axis-mine-del').click();
assert(pumpUntil(() => !$('btn-generate').disabled &&
                       $('lora-list').children.length === 0, 60000),
       'LoRA removed (panel row gone)');
console.log('removed: ' + $('lora-status').textContent);

const removed = generateAndGrab('post-remove render');
const dOff = diffCount(zeroed, removed, 1);
console.log('scale 0 vs removed: ' + dOff + ' differing bytes');
assert(dOff === 0, 'a zeroed adapter is a true no-op (' + dOff + ' bytes differ)');

if (savedStorage !== null) {
  fs.writeFileSync(STORAGE_PATH, savedStorage);
}

console.log('PASS — krea2-lab LoRA panel: restore, rescale, and removal all work');
