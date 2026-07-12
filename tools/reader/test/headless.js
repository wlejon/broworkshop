// Headless verification for the Reader app. Drives the REAL app modules (the
// absolute /app/ mount resolves to the same instances the app loaded) through
// the real async TTS pipeline on GPU.
//
// Run:  D:/projects/bro/build/Release/bro-headless.exe \
//         D:/projects/broworkshop/tools/reader \
//         D:/projects/broworkshop/tools/reader/test/headless.js
//
// Documents are injected programmatically (native dialogs are real blocking OS
// dialogs even headless — never triggered here). Async synthesis completes on a
// background thread in WALL time, so waits are pump loops: advanceTime() ticks
// virtual time + delivers JS-thread callbacks while the wall clock runs.
import { segment, splitSentences, stripMarkdown, stripHtml } from "/app/lib/text.js";
import { library, loadLibrary } from "/app/lib/docs.js";
import { engines, paths, gpuBackend } from "/app/lib/engine.js";
import { settings, saveSettings } from "/app/lib/state.js";
import * as player from "/app/lib/player.js";
import { exportToPath } from "/app/lib/exporter.js";

const _fs = require('fs');
const OUT = 'D:/projects/broworkshop/tools/reader/test';

function pumpUntil(label, cond, timeoutMs) {
  const t0 = Date.now();
  while (!cond()) {
    advanceTime(50);
    if (Date.now() - t0 > (timeoutMs || 30000)) throw new Error('timeout waiting for: ' + label);
  }
}

// ── 0 · segmentation + strippers (pure, fast) ─────────────────────────────────
let ss = splitSentences('He arrived at 3 p.m. yesterday. Dr. Smith met J. R. Tolkien. Done!');
assert(ss.length === 3, 'abbreviation-aware split: ' + JSON.stringify(ss));
ss = splitSentences('Is it real? Yes… absolutely. "Fine." she said.');
assert(ss.length === 3, 'terminator variety: ' + JSON.stringify(ss));
const md = stripMarkdown('# Title\n\nSome *emphasized* text with [a link](http://x.y).\n\n- item one\n- item two\n\n```js\ncode();\n```\n\nThe end.');
assert(md.indexOf('#') < 0 && md.indexOf('*') < 0 && md.indexOf('code()') < 0 && md.indexOf('a link') >= 0, 'markdown stripped');
const ht = stripHtml('<html><head><style>b{}</style></head><body><h1>Hi</h1><p>One &amp; two.</p><script>x()</script></body></html>');
assert(ht.indexOf('One & two.') >= 0 && ht.indexOf('x()') < 0 && ht.indexOf('<') < 0, 'html stripped');
console.log('segmentation + strippers OK');

// ── 1 · inject a document via the test seam ───────────────────────────────────
// Repeatable runs: reset the persisted library AND the live settings (a prior
// run's step 9 leaves settings.engine = 'qwen' persisted — by design for users,
// not for this test).
localStorage.setItem('reader:library', '[]');
Object.assign(settings, { engine: 'kokoro', kokoroVoice: 'af_heart', speed: 1, theme: 'dark' });
saveSettings();
loadLibrary();
globalThis.__reader.renderLibrary();

const SAMPLE = [
  'The lighthouse keeper woke before dawn. Fog had settled over the harbor during the night. He climbed the spiral stairs slowly, counting each step.',
  'At the top, the great lamp waited in silence. He struck a match and lit the wick. Light swept across the dark water for the first time that day.',
  'Far below, a fishing boat answered with a single horn blast. The day had begun.',
].join('\n\n');

const doc = globalThis.__reader.addDocument('The Lighthouse', SAMPLE);
const seg = segment(SAMPLE);
assert(seg.paragraphs.length === 3, '3 paragraphs, got ' + seg.paragraphs.length);
assert(seg.sentences.length === 8, '8 sentences, got ' + seg.sentences.length);
assert(library.length === 1 && library[0].title === 'The Lighthouse', 'library has the doc');

// drag-drop import of a markdown file (engine drop pipeline, no dialogs)
const mdPath = OUT + '/_sample.md';
_fs.writeFileSync(mdPath, '# Dropped Note\n\nThis arrived by *drag and drop*. It has a second sentence.\n');
dropFiles(600, 400, [mdPath]);
flush();
assert(library.length === 2 && library[0].title === 'Dropped Note', 'drag-drop imported the .md file');
assert(library[0].text.indexOf('*') < 0 && library[0].text.indexOf('#') < 0, 'markdown stripped on import');

flush();
assert(document.querySelectorAll('#doc-grid .card').length === 2, 'library cards rendered');
screenshot(OUT + '/_library.png');
console.log('library view + drag-drop import OK → test/_library.png');

// ── 2 · GPU + Kokoro load (real async path) ───────────────────────────────────
assert(typeof bro !== 'undefined' && bro.gpu && bro.gpu.available,
  'GPU backend required (bro.gpu.backend = ' + gpuBackend() + ')');
console.log('gpu backend:', gpuBackend());

globalThis.__reader.openDocument(doc);
flush();
assert(document.querySelectorAll('#reader-text .sn').length === 8, 'sentence spans rendered');
assert(document.querySelectorAll('#reader-text p').length === 3, 'paragraph structure rendered');

pumpUntil('kokoro load', () => engines.kokoro.status === 'ready' || engines.kokoro.status === 'error', 120000);
assert(engines.kokoro.status === 'ready', 'kokoro: ' + engines.kokoro.error);
assert(engines.kokoro.voices.length > 0 && engines.kokoro.voice, 'kokoro voices listed + one loaded');
console.log('kokoro ready in', (engines.kokoro.loadMs / 1000).toFixed(1) + 's ·',
  engines.kokoro.voices.length, 'voices · dir', engines.kokoro.dir);

// ── 3 · playback: audio produced, sentence + word highlight ───────────────────
player.play();
pumpUntil('sentence 0 playing', () => player.playing && !player.buffering, 120000);
const active0 = document.querySelector('.sn.active');
assert(active0 && active0.dataset.i === '0', 'sentence 0 highlighted');

const actx = player.audioCtx();
pumpUntil('audible output on master bus', () => actx.getBusPeakL(0) > 0.02, 30000);
console.log('bus peak while speaking:', actx.getBusPeakL(0).toFixed(3));

pumpUntil('word highlight', () => document.querySelector('.sn.active .w.wcur'), 30000);
const words = document.querySelectorAll('.sn.active .w');
assert(words.length >= 5, 'active sentence exploded into word spans (' + words.length + ')');
screenshot(OUT + '/_reader.png');
console.log('word highlight OK → test/_reader.png');

// ── 4 · prefetch advances the highlight across sentences ──────────────────────
// (virtual time outruns wall-clock synthesis, so wait for the pipeline to catch
// up rather than sampling the cache at the instant the index ticks over)
pumpUntil('advance to sentence 2', () => player.cur >= 1 && !player.buffering, 180000);
const activeN = document.querySelector('.sn.active');
assert(activeN && parseInt(activeN.dataset.i, 10) === player.cur && player.cur >= 1,
  'highlight advanced with playback (cur=' + player.cur + ')');
pumpUntil('prefetch ahead of playback', () => player.peekCache(player.cur + 1) || player.cur >= 7, 120000);
console.log('highlight advanced to sentence', player.cur + 1, '· next sentence prefetched');

// ── 5 · click-to-read: full input pipeline ────────────────────────────────────
// index 6 opens paragraph 3, so its span starts at a line start (safe to click).
const target = document.querySelectorAll('#reader-text .sn')[6];
const r = target.getBoundingClientRect();
click(r.x + 10, r.y + 10);
pumpUntil('click jump', () => player.cur === 6, 60000);
assert(document.querySelector('.sn.active').dataset.i === '6', 'clicked sentence became active');
console.log('click-to-read OK');

// ── 6 · position persistence ──────────────────────────────────────────────────
player.pause();
assert(!player.playing, 'paused');
const persisted = JSON.parse(localStorage.getItem('reader:library'));
const pdoc = persisted.find((d) => d.title === 'The Lighthouse');
assert(pdoc && pdoc.pos === 6, 'reading position persisted (pos=' + (pdoc && pdoc.pos) + ')');
console.log('position persistence OK');

// ── 7 · sleep timer (virtual clock) ───────────────────────────────────────────
player.jumpTo(0, true);
pumpUntil('replaying', () => player.playing && !player.buffering, 120000);
player.setSleep('min', 0.05);                     // 3 s on the audio clock
pumpUntil('sleep stop', () => !player.playing, 60000);
assert(player.sleep.mode === 'off', 'sleep timer fired and cleared');
console.log('sleep timer OK');

// ── 8 · WAV export (background job, from the top, 3 sentences) ────────────────
const wavPath = OUT + '/_export.wav';
try { _fs.unlinkSync(wavPath); } catch (e) {}
let expDone = false, expErr = 'pending';
exportToPath(wavPath, { from: 0, to: 2, onDone: (err) => { expErr = err; expDone = true; } });
pumpUntil('export finished', () => expDone, 300000);
assert(expErr === null, 'export failed: ' + expErr);
assert(_fs.existsSync(wavPath) && _fs.statSync(wavPath).size > 24000, 'WAV written (' + _fs.statSync(wavPath).size + ' bytes)');
console.log('WAV export OK →', wavPath, _fs.statSync(wavPath).size, 'bytes');

// ── 9 · Qwen3-TTS engine (if the checkpoint exists on this machine) ───────────
const qdir = paths().qwen;
if (_fs.existsSync(qdir + '/config.json')) {
  console.log('qwen checkpoint found — smoke testing:', qdir);
  player.setEngine('qwen');
  pumpUntil('qwen load', () => engines.qwen.status === 'ready' || engines.qwen.status === 'error', 600000);
  assert(engines.qwen.status === 'ready', 'qwen: ' + engines.qwen.error);
  assert(engines.qwen.speakers.length > 0, 'qwen speakers listed');
  console.log('qwen ready in', (engines.qwen.loadMs / 1000).toFixed(1) + 's · speakers:', engines.qwen.speakers.join(', '));
  player.jumpTo(7, true);                          // last sentence — short
  pumpUntil('qwen sentence playing', () => player.playing && !player.buffering, 600000);
  pumpUntil('qwen audible', () => actx.getBusPeakL(0) > 0.02, 60000);
  assert(document.querySelector('.sn.active').dataset.i === '7', 'qwen sentence highlighted');
  assert(!document.querySelector('.sn.active .w'), 'qwen: sentence-level highlight (no fake word timing)');
  screenshot(OUT + '/_reader_qwen.png');
  player.pause();
  console.log('qwen smoke OK → test/_reader_qwen.png');
} else {
  console.log('qwen checkpoint absent — verifying the missing-weights error state instead');
  player.setEngine('qwen');
  pumpUntil('qwen error state', () => engines.qwen.status === 'error', 60000);
  assert(engines.qwen.error.indexOf(qdir) >= 0, 'error names the expected path: ' + engines.qwen.error);
  flush();
  assert(document.querySelector('#backend').classList.contains('err'), 'badge shows the error state');
  screenshot(OUT + '/_missing_weights.png');
}

console.log('ALL READER CHECKS PASSED');
