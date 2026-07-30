// Walk section + /lib/sweep-runner.js — NO model load, no weights needed.
//
//   bro-headless ../broworkshop/demos/krea2-lab \
//                ../broworkshop/demos/krea2-lab/tests/test_walk.js
//
// The renders are stubbed: what is under test is the machinery around them —
// the value grid, the content-addressed cache that must never render the same
// settings twice, the manifest that survives a cancelled run, and the animation
// encode. A real walk needs 13 model renders per axis and belongs in the app.

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';   // blank before the worker's ready message can pump

flush();
advanceTime(300);
flush();

const fs = require('fs');
const path = require('path');

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); flush(); }
  return pred();
}

// ── the section is wired into the rail ────────────────────────────────────
const btn = document.querySelector('.secbtn[data-sec="walk"]');
assert(btn, 'walk section tab exists');
btn.click(); flush();
assert($('sec-walk').classList.contains('active'), 'walk section shows');
assert(!$('sec-tune').classList.contains('active'), 'tune section hidden');

const ctx = window.__ctx;
assert(ctx && ctx.walkInternals, 'walk internals exposed');
const W = ctx.walkInternals;

// The catalogue builds when axes_meta.json lands.
assert(pumpUntil(() => document.querySelectorAll('#walk-list .walk-row').length > 0, 10000),
       'axis picker built rows');
const rowCount = document.querySelectorAll('#walk-list .walk-row').length;
const bankCount = Object.keys(ctx.axesMeta).length;
assert(rowCount >= bankCount,
       'picker lists at least every bank axis (' + rowCount + ' rows, ' + bankCount + ' bank axes)');

// ── the value grid ────────────────────────────────────────────────────────
$('walk-from').value = '-6'; $('walk-to').value = '6'; $('walk-steps').value = '13';
let vals = W.walkValues();
assert(vals.length === 13, '13 frames requested gives 13 values (got ' + vals.length + ')');
assert(vals[0] === -6 && vals[12] === 6, 'grid spans both ends inclusive');
assert(vals[6] === 0, 'odd frame count puts a frame exactly at neutral (got ' + vals[6] + ')');

// Names are derived from the VALUE on the slider's own 0.01 grid, not from the
// index in this particular run — that is what lets a 25-step re-run reuse the
// 13-step run's frames.
assert(W.frameName(-6) === '0000_m6.00', 'frameName(-6) = ' + W.frameName(-6));
assert(W.frameName(0) === '0600_p0.00', 'frameName(0) = ' + W.frameName(0));
assert(W.frameName(6) === '1200_p6.00', 'frameName(6) = ' + W.frameName(6));
assert(W.frameName(1.5) === '0750_p1.50', 'frameName(1.5) = ' + W.frameName(1.5));
// Sortable: lexicographic order of the names is walk order.
const names = vals.map(W.frameName);
assert(names.join(',') === names.slice().sort().join(','), 'frame names sort into walk order');

// A finer walk over the same span must land on the coarser walk's values.
$('walk-steps').value = '25';
const fine = W.walkValues();
assert(fine.length === 25, '25-step grid (got ' + fine.length + ')');
const fineNames = fine.map(W.frameName);
const shared = names.filter((n) => fineNames.indexOf(n) >= 0);
assert(shared.length === 13,
       'every frame of the 13-step walk recurs in the 25-step walk (got ' + shared.length + ')');
$('walk-steps').value = '13';

// ── the sweep runner ──────────────────────────────────────────────────────
const OUT = path.join(bro.appDir, 'tests', 'out', 'walk');
fs.rmSync(OUT, { recursive: true, force: true });

let mod = null, importErr = null;
import('/lib/sweep-runner.js').then((m) => { mod = m; }).catch((e) => { importErr = e; });
assert(pumpUntil(() => mod || importErr, 8000), 'sweep-runner imported');
assert(!importErr, 'import error: ' + (importErr && importErr.message));

const SIZE = 64;
// A distinct flat colour per value, so a decoded frame proves WHICH value made it.
function stubRender(value) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const v = Math.round((value + 6) / 12 * 255);
  for (let i = 0; i < SIZE * SIZE; i++) {
    px[i * 4] = v; px[i * 4 + 1] = 255 - v; px[i * 4 + 2] = 128; px[i * 4 + 3] = 255;
  }
  return { pixels: px, width: SIZE, height: SIZE };
}

// Drive the async runner from this synchronous script: kick it off, pump the
// event loop until it settles, then assert on what it recorded.
function runNow(fn) {
  const box = { done: false, value: null, err: null };
  Promise.resolve().then(fn).then((v) => { box.value = v; box.done = true; },
                                   (e) => { box.err = e; box.done = true; });
  assert(pumpUntil(() => box.done, 60000), 'runner settled');
  if (box.err) throw box.err;
  return box.value;
}

const runner = mod.createSweepRunner({ root: OUT });
const BASE = { prompt: 'a red fox', seed: 7, opts: { width: SIZE, height: SIZE, steps: 8 },
               axisControls: { 'color.key': 1.5 } };
const V5 = [-6, -3, 0, 3, 6];
let calls = [];

function sweep(spec) {
  calls = [];
  return runNow(() => runner.runSweep(Object.assign({
    name: 'composition.proximity',
    baseKey: BASE,
    values: V5,
    frameName: W.frameName,
    animations: [{ msPerFrame: 200, name: 'walk_5f_200ms' }],
    render: (v) => { calls.push(v); return Promise.resolve(stubRender(v)); },
  }, spec || {})));
}

// ── first run: everything is new ──────────────────────────────────────────
let r1 = sweep();
assert(r1.rendered === 5, 'first run rendered 5 frames (got ' + r1.rendered + ')');
assert(r1.reused === 0, 'first run reused nothing (got ' + r1.reused + ')');
assert(calls.length === 5, 'render called once per value (got ' + calls.length + ')');
assert(!r1.cancelled, 'first run was not cancelled');

const pngs = fs.readdirSync(r1.dir).filter((f) => f.endsWith('.png')).sort();
assert(pngs.length === 5, '5 stills on disk (got ' + pngs.length + ': ' + pngs.join(',') + ')');
assert(pngs[0] === 'v_0000_m6.00.png', 'stills carry the value-derived name (got ' + pngs[0] + ')');
assert(fs.existsSync(path.join(r1.dir, 'manifest.json')), 'manifest written');
assert(r1.animations.length === 1 && !r1.animations[0].reused, 'one animation, freshly encoded');
const webm = path.join(r1.dir, 'walk_5f_200ms.webm');
assert(fs.existsSync(webm), 'webm written at ' + webm);
const webmSize = fs.statSync(webm).size;
assert(webmSize > 0, 'webm is non-empty (' + webmSize + ' bytes)');

// The animation is the compact deliverable: one clip smaller than the stills it
// was made from. (Both are lossless-ish here; the point is that the clip does not
// cost a multiple of the set.)
const pngTotal = pngs.reduce((a, f) => a + fs.statSync(path.join(r1.dir, f)).size, 0);
assert(webmSize < pngTotal,
       'webm (' + webmSize + 'B) is smaller than the ' + pngs.length +
       ' stills (' + pngTotal + 'B)');

// The frames really are the pictures the values made.
const decoded = mod ? bro.image.decodeOriented(new Uint8Array(fs.readFileSync(path.join(r1.dir, 'v_0000_m6.00.png')))) : null;
assert(decoded.width === SIZE && decoded.height === SIZE, 'still is full size');
assert(decoded.pixels[0] === 0 && decoded.pixels[1] === 255,
       'still at -6 holds the -6 colour (got rgb(' + decoded.pixels[0] + ',' + decoded.pixels[1] + '))');

// ── second run, identical: nothing is rendered again ──────────────────────
let r2 = sweep();
assert(r2.rendered === 0, 'identical re-run rendered nothing (got ' + r2.rendered + ')');
assert(r2.reused === 5, 'identical re-run reused all 5 (got ' + r2.reused + ')');
assert(calls.length === 0, 'render was never called on the re-run (got ' + calls.length + ')');
assert(r2.dir === r1.dir, 're-run landed in the same folder');
assert(r2.animations[0].reused, 'animation kept rather than re-encoded');

// ── more steps: only the new values render ────────────────────────────────
const V9 = [-6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6];
let r3 = sweep({ values: V9, animations: [{ msPerFrame: 200, name: 'walk_9f_200ms' }] });
assert(r3.rendered === 4, 'finer walk rendered only the 4 new values (got ' + r3.rendered + ')');
assert(r3.reused === 5, 'finer walk reused the original 5 (got ' + r3.reused + ')');
assert(calls.length === 4 && calls.indexOf(-6) < 0, 'render skipped the values already on disk');
assert(r3.dir === r1.dir, 'a step-count change does NOT start a new folder');
assert(fs.existsSync(path.join(r1.dir, 'walk_9f_200ms.webm')), 'the 9-frame clip is its own file');
assert(fs.existsSync(webm), 'the 5-frame clip still exists alongside it');

// ── different settings: a new folder, the old walk untouched ──────────────
let r4 = sweep({ baseKey: Object.assign({}, BASE, { prompt: 'a blue heron' }) });
assert(r4.dir !== r1.dir, 'a changed prompt starts a new folder');
assert(r4.rendered === 5, 'the new folder rendered all 5 (got ' + r4.rendered + ')');
assert(fs.readdirSync(r1.dir).filter((f) => f.endsWith('.png')).length === 9,
       'the original folder still holds all 9 of its stills');

// A float that only differs by fp noise is the SAME settings, not new ones.
let r5 = sweep({ baseKey: Object.assign({}, BASE,
                   { axisControls: { 'color.key': 1.5 + 1e-12 } }) });
assert(r5.dir === r1.dir, 'fp noise in a slider value does not fork the folder');
assert(r5.rendered === 0, 'fp noise rendered nothing (got ' + r5.rendered + ')');

// ── ping-pong reuses frames rather than rendering the way back ────────────
let r6 = sweep({ animations: [{ msPerFrame: 200, pingPong: true, name: 'pp' }] });
assert(r6.rendered === 0, 'ping-pong rendered no extra frames (got ' + r6.rendered + ')');
assert(r6.animations[0].frames === 8,
       'ping-pong over 5 frames writes 8 (out and back, no repeated ends), got ' +
       r6.animations[0].frames);
assert(fs.existsSync(path.join(r1.dir, 'pp.webm')), 'ping-pong clip written');

// ── cancellation stops between frames and keeps what it got ───────────────
fs.rmSync(path.join(OUT, 'cancelme'), { recursive: true, force: true });
const sig = { cancelled: false };
let seen = 0;
let r7 = runNow(() => runner.runSweep({
  name: 'cancelme', baseKey: BASE, values: V5, frameName: W.frameName,
  animations: [{ msPerFrame: 200, name: 'part' }],
  signal: sig,
  render: (v) => { seen++; if (seen === 2) sig.cancelled = true; return Promise.resolve(stubRender(v)); },
}));
assert(r7.cancelled, 'run reports itself cancelled');
assert(seen === 2, 'the frame in flight finished, then it stopped (rendered ' + seen + ')');
assert(r7.rendered === 2, 'two frames kept (got ' + r7.rendered + ')');
const partial = fs.readdirSync(r7.dir).filter((f) => f.endsWith('.png'));
assert(partial.length === 2, 'both finished frames are on disk (got ' + partial.length + ')');

// Resuming picks up exactly where it stopped — the manifest was flushed per
// frame, so a cancelled hour of rendering is never thrown away.
let resumeCalls = 0;
let r8 = runNow(() => runner.runSweep({
  name: 'cancelme', baseKey: BASE, values: V5, frameName: W.frameName,
  animations: [{ msPerFrame: 200, name: 'part' }],
  render: (v) => { resumeCalls++; return Promise.resolve(stubRender(v)); },
}));
assert(resumeCalls === 3, 'resume rendered only the 3 missing frames (got ' + resumeCalls + ')');
assert(r8.reused === 2, 'resume reused the 2 from the cancelled run (got ' + r8.reused + ')');
assert(!r8.cancelled, 'resume ran to completion');

// ── a corrupted/absent still is re-rendered, not trusted ──────────────────
fs.unlinkSync(path.join(r8.dir, 'v_0600_p0.00.png'));
let missingCalls = 0;
let r9 = runNow(() => runner.runSweep({
  name: 'cancelme', baseKey: BASE, values: V5, frameName: W.frameName,
  animations: [],
  render: (v) => { missingCalls++; return Promise.resolve(stubRender(v)); },
}));
assert(missingCalls === 1, 'a deleted still is rendered again (got ' + missingCalls + ')');
assert(r9.reused === 4, 'the other 4 were still reused (got ' + r9.reused + ')');

// ── gif is available as the compatibility copy ────────────────────────────
let r10 = sweep({ animations: [{ msPerFrame: 200, format: 'gif', name: 'walk_gif' }] });
const gif = path.join(r1.dir, 'walk_gif.gif');
assert(fs.existsSync(gif), 'gif written');
assert(fs.statSync(gif).size > 0, 'gif is non-empty');
assert(r10.rendered === 0, 'the gif reused the existing stills (got ' + r10.rendered + ')');

// ── the manifest is readable and honest about what it made ────────────────
const man = JSON.parse(fs.readFileSync(path.join(r1.dir, 'manifest.json'), 'utf8'));
assert(man.version === 1, 'manifest carries a version');
assert(man.name === 'composition.proximity', 'manifest names the axis');
assert(Object.keys(man.frames).length === 9, 'manifest lists 9 frames (got ' +
       Object.keys(man.frames).length + ')');
assert(man.frames['v_0000_m6.00.png'].value === -6, 'manifest records each frame\'s value');
assert(man.frames['v_0000_m6.00.png'].hash, 'manifest records each frame\'s settings hash');
assert(Object.keys(man.animations).length >= 3, 'manifest lists the animations it wrote');

fs.rmSync(OUT, { recursive: true, force: true });
console.log('PASS: walk grid, content-addressed cache, cancel/resume, and encodes');
