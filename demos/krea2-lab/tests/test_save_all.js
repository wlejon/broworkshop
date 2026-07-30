// Save-all test — NO model load, no weights needed. Drives the history rail's
// "save all" against a stubbed folder dialog (the native one blocks headless)
// and asserts every history entry lands on disk as its OWN file.
//
//   bro-headless ../broworkshop/demos/krea2-lab tests/test_save_all.js
//
// The regression this pins: control-driven re-renders deliberately reuse the
// seed, so seed+size is not unique across the history. Naming saved files by
// seed+size alone wrote all N images to one path and left only the newest.

const $ = (id) => document.getElementById(id);
$('model-dir').value = '';   // blank before the worker's ready message can pump

flush();
advanceTime(300);
flush();

const ctx = window.__ctx;
assert(ctx && typeof ctx.addHistoryEntry === 'function', 'ctx.addHistoryEntry exposed');

const fs = require('fs');
const path = require('path');
const OUT = path.join(bro.appDir, 'tests', 'out', 'saveall');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Three renders that all share one seed and one size — exactly what a slider
// sweep produces. Distinct fill colors so we can tell them apart on disk.
const SEED = 4242, W = 64, H = 64;
const COLORS = ['#ff0000', '#00ff00', '#0000ff'];
COLORS.forEach((color) => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  ctx.addHistoryEntry(c, W, H, { seed: SEED, steps: 8, width: W, height: H });
});
flush();

assert(ctx.history.length === 3, 'three history entries (got ' + ctx.history.length + ')');
assert(!$('btn-hist-save-all').disabled, 'save all enabled with a non-empty history');

// Stub the native folder dialog — showOpenFolderDialog would block headless.
window.showOpenFolderDialog = () => OUT;
$('btn-hist-save-all').click();
flush();

const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
assert(files.length === 3,
       'save all wrote one file per history entry, got ' + files.length + ': ' + files.join(', '));

// Names must be unique AND still carry the seed + size they were rendered at.
files.forEach((f) => {
  assert(f.indexOf(String(SEED)) >= 0, 'name keeps the seed: ' + f);
  assert(f.indexOf(W + 'x' + H) >= 0, 'name keeps the size: ' + f);
});

// Oldest first, natural order: file 1 is red (the first entry pushed), 3 is blue.
COLORS.forEach((color, i) => {
  const img = bro.image.decodeOriented(new Uint8Array(fs.readFileSync(path.join(OUT, files[i]))));
  assert(img.width === W && img.height === H,
         files[i] + ' is full resolution (' + img.width + '×' + img.height + ')');
  const r = img.pixels[0], g = img.pixels[1], b = img.pixels[2];
  const want = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16),
                parseInt(color.slice(5, 7), 16)];
  assert(r === want[0] && g === want[1] && b === want[2],
         files[i] + ' holds history entry ' + (i + 1) + ' (' + color + '), got rgb(' +
         r + ',' + g + ',' + b + ')');
});

assert($('status-text').textContent.indexOf('saved 3 images') >= 0,
       'status reports 3 saved, got: ' + $('status-text').textContent);

console.log('PASS: save all wrote ' + files.length + ' distinct files, oldest first');
