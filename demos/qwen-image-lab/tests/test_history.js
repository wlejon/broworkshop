// Save-all with a manifest, and loading one back into the controls.
//
//   CUDA_VISIBLE_DEVICES=0 bro-headless ../broworkshop/demos/qwen-image-lab tests/test_history.js
//
// A render here is the sum of nine surfaces and a PNG carries none of them, so
// the manifest is the only record of what made a picture. The test holds it to
// the strongest form of that claim: clear the whole rack, load the manifest
// back, press Generate, and the render has to come back to the pixel — not
// approximately, not "close enough to see", identical. Anything the manifest
// forgot to write down would show up there.
//
// It also checks the two things a manifest has to get right to be readable at
// all: the message the WORKER was sent is recorded verbatim beside the control
// values (the two disagreeing is exactly the bug this is worth having for),
// and the megabyte-scale payloads — painted cells, condition-image pixels —
// are summarised rather than dumped.

function $(id) { return document.getElementById(id); }
function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) sleep(20);
  return pred();
}
function mse(a, b) {
  let acc = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; acc += d * d; n++; }
  }
  return acc / n;
}

console.log('waiting for the model to load…');
assert(pumpUntil(() => !$('btn-generate').disabled ||
                       $('status-text').classList.contains('err'), 600000),
       'model load finished within budget');
assert(!$('status-text').classList.contains('err'),
       'model loaded without error: ' + $('status-text').textContent);

const ctx = window.__ctx;
const fs = require('fs');
const TMP = ((typeof process !== 'undefined' && process.env &&
              (process.env.TEMP || process.env.TMP)) || 'C:/Windows/Temp')
              .replace(/\\/g, '/');
const OUT = TMP + '/qwen-image-lab-history-test';

$('live').checked = false; $('live').dispatchEvent(new Event('change'));
$('btn-deck-clear').click();
$('btn-cond-clear').click();
$('btn-hist-clear').click();
$('width').value = '256'; $('height').value = '256';
$('steps').value = '4'; $('seed').value = '7'; $('guidance').value = '1.0';
$('rand-seed').checked = false;
$('prompt').value = 'a stone cottage beside a mountain lake';
flush();

function render(what) {
  const t0 = Date.now();
  $('btn-generate').click();
  const ok = pumpUntil(() => $('status-text').textContent === 'done' ||
                             $('status-text').classList.contains('err'), 180000);
  assert(ok && !$('status-text').classList.contains('err'),
         what + ' rendered ok: ' + $('status-text').textContent);
  const c = $('view');
  console.log(what + ' · ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}
function setKey(key, v) {
  const c = ctx.controlByKey(key);
  assert(c, 'there is a control keyed ' + key);
  c.set(v);
  flush();
  return c;
}

// ── three renders, each with a different rack ─────────────────────────────
assert(ctx.history.length === 0, 'the history starts empty');
const plain = render('1 · nothing armed');

setKey('light.key', 2);
const axed = render('2 · light.key +2');

setKey('gate-attn-img', 0.8);
ctx.setCurve('gateRows', [1, 1, 0, 0]);
$('seed').value = '11';
flush();
const last = render('3 · light.key +2 · attn img gate 0.8, first half only, seed 11');

assert(ctx.history.length === 3, 'three renders in the history (' + ctx.history.length + ')');
assert(document.querySelectorAll('#hist-list .hist-item').length === 3,
       'and three thumbnails in the rail');
assert(ctx.history[0].seed === 11, 'newest first (' + ctx.history[0].seed + ')');

// ── the manifest ──────────────────────────────────────────────────────────
const man = ctx.buildManifest();
assert(man.app === 'qwen-image-lab' && man.version === 2, 'the manifest identifies itself');
assert(man.renders.length === 3, 'one entry a render, oldest first');
assert(man.renders[0].seed === 7 && man.renders[2].seed === 11,
       'in the order the files are numbered (' + man.renders.map((r) => r.seed).join(', ') + ')');
const entry = man.renders[2];
console.log('last entry · ' + entry.file + ' · ' + entry.width + '×' + entry.height +
            ' · steps ' + entry.steps);
assert(entry.file.indexOf('_11_256x256.png') > 0,
       'the file name carries seed and size (' + entry.file + ')');
assert(man.renders.every((r, i) => r.file !== man.renders[(i + 1) % 3].file),
       'and the names are unique even though two renders share a seed');
assert(entry.prompt === $('prompt').value, 'the prompt is recorded');
assert(entry.controls['light.key'] === 2 && entry.controls['gate-attn-img'] === 0.8,
       'every control is recorded by the key it is driven by');
assert(Object.keys(entry.controls).length > 80,
       'including the ones at neutral — a rack is what was NOT armed too (' +
       Object.keys(entry.controls).length + ' controls)');
assert(entry.message && entry.message.axes && entry.message.axes['light.key'] === 2,
       'and the message the worker was actually sent is recorded beside it');
assert(entry.message.lanes && entry.message.lanes.gateRows.join(',') === '1,1,0,0',
       'curves included — they are not controls, they are the shape a control rides on');

// ── writing it out ────────────────────────────────────────────────────────
try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(OUT, { recursive: true });
const out = ctx.saveAllTo(OUT);
console.log('saved · ' + $('status-text').textContent);
assert(out.failed === 0, 'nothing failed to write (' + out.failed + ')');
assert(out.images === 3, 'three images written (' + out.images + ')');
const files = fs.readdirSync(OUT).map((f) => (typeof f === 'string' ? f : f.name)).sort();
console.log('files: ' + files.join(', '));
assert(files.length === 4, 'three PNGs and a manifest (' + files.join(', ') + ')');
assert(files.indexOf('manifest.json') >= 0, 'the manifest is there by name');
assert(files.filter((f) => /\.png$/.test(f)).length === 3, 'and three PNGs');

const raw = fs.readFileSync(OUT + '/manifest.json', 'utf8');
const parsed = JSON.parse(raw);
console.log('manifest.json is ' + raw.length + ' bytes for 3 renders');
assert(parsed.renders.length === 3, 'it round-trips through JSON');
assert(raw.length < 200000,
       'and stays small — the painted cells and condition pixels are summarised, not dumped (' +
       raw.length + ' bytes)');

// ── clear the rack, load it back ──────────────────────────────────────────
$('btn-deck-clear').click();
$('btn-sched-clear').click();
$('seed').value = '1';
$('width').value = '512'; $('height').value = '512';
flush();
assert(document.querySelectorAll('.deck-chip').length === 0, 'the rack is empty');
assert(ctx.controlByKey('light.key').value() === 0, 'the axis is back at zero');

const loaded = ctx.loadManifest(OUT + '/manifest.json');
flush();
console.log('load · ' + $('status-text').textContent);
assert(loaded, 'the manifest loaded');
assert(loaded.entry.index === 3, 'the last render is the one restored (' +
       loaded.entry.index + ')');
assert(loaded.applied.missing.length === 0,
       'every key in it is a control this build knows (' +
       loaded.applied.missing.join(', ') + ')');
assert(ctx.controlByKey('light.key').value() === 2, 'the axis came back');
assert(ctx.controlByKey('gate-attn-img').value() === 0.8, 'the gate multiplier came back');
assert(+$('seed').value === 11, 'the seed came back');
assert(+$('width').value === 256, 'the size came back');
assert(ctx.curveFor('gateRows').join(',') === '1,1,0,0',
       'and the curve came back (' + ctx.curveFor('gateRows').join(',') + ')');
assert(document.querySelectorAll('.deck-chip').length === 2,
       'the deck shows what was restored');

// ── and it reproduces the render ──────────────────────────────────────────
const again = render('the restored rack');
console.log('restored render vs the one the manifest describes: mse ' +
            mse(last, again).toFixed(6));
assert(again.width === last.width, 'at the size the manifest asked for');
assert(mse(last, again) < 1e-6,
       'a manifest is enough to get the picture back, to the pixel (mse ' +
       mse(last, again).toFixed(6) + ')');

// ── a manifest from somewhere else is refused ─────────────────────────────
fs.writeFileSync(OUT + '/not-ours.json', JSON.stringify({ app: 'something-else', renders: [] }));
const bad = ctx.loadManifest(OUT + '/not-ours.json');
assert(bad === null, 'a manifest from another app is refused');
assert($('status-text').classList.contains('err'),
       'with a message saying so: ' + $('status-text').textContent);
const missing = ctx.loadManifest(OUT + '/no-such-file.json');
assert(missing === null, 'and so is a path that is not there');

// ── history thumbnails still work ─────────────────────────────────────────
const items = document.querySelectorAll('#hist-list .hist-item');
assert(items.length === 4, 'the restored render joined the history (' + items.length + ')');
items[3].querySelector('canvas.hist-thumb').click();
flush();
assert($('status-text').textContent.indexOf('viewing history') === 0,
       'clicking a thumbnail shows that render: ' + $('status-text').textContent);
$('btn-hist-clear').click();
flush();
assert(ctx.history.length === 0, 'and the history clears');

try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) {}
$('btn-deck-clear').click();
$('btn-sched-clear').click();
flush();

console.log('PASS — every control written down, and enough of them to get the picture back');
