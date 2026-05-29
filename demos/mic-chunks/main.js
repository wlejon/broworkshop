// Mic Chunks — a worked consumer of broaudio's chunkFrames feature via bro.mic.
//
// bro.mic.start({ chunkFrames, targetRate, agc, onChunk }) registers a broaudio
// mic tap. broaudio owns the resampler + AGC + fixed-size chunk slicing; we get
// exactly one onChunk per chunkFrames samples at targetRate. At 16 kHz / 160
// frames that's one chunk every 10 ms — a steady 100 chunks/sec. Each chunk's
// peak draws one column of the scrolling meter, so the cadence is visible.
//
// Headless note: with no audio device, bro.mic.start() can't capture, so a
// script drives the same tap via bro.mic.feed() instead (see test.js).

const CHUNK_FRAMES = 160;     // 10 ms at 16 kHz
const TARGET_RATE  = 16000;

const canvas = document.querySelector('#meter');
const ctx2d  = canvas.getContext('2d');

const toggleBtn = document.querySelector('#toggle');
const agcBox    = document.querySelector('#agc');
const elChunkCount  = document.querySelector('#chunkCount');
const elChunkFrames = document.querySelector('#chunkFrames');
const elRollingPeak = document.querySelector('#rollingPeak');
const elDropped     = document.querySelector('#dropped');

// Scrolling ring of recent chunk peaks, one entry per chunk (newest at the end).
const HISTORY = 1200;
const peaks = new Float32Array(HISTORY);
let head = 0;          // next write index
let filled = 0;        // how many entries are valid
let running = false;

function pushPeak(p) {
  peaks[head] = p;
  head = (head + 1) % HISTORY;
  if (filled < HISTORY) filled++;
}

function start() {
  bro.mic.start({
    chunkFrames: CHUNK_FRAMES,
    targetRate:  TARGET_RATE,
    agc:         agcBox.checked,
    onChunk:     (c) => pushPeak(c.peak),
  });
  running = true;
  toggleBtn.textContent = 'Stop';
  toggleBtn.classList.add('active');
}

function stop() {
  bro.mic.stop();
  running = false;
  toggleBtn.textContent = 'Start';
  toggleBtn.classList.remove('active');
}

toggleBtn.addEventListener('click', () => (running ? stop() : start()));
// Restart with the new AGC setting if already running.
agcBox.addEventListener('change', () => { if (running) { stop(); start(); } });

function resize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx2d.fillStyle = '#0c0e12';
  ctx2d.fillRect(0, 0, w, h);

  // Midline.
  ctx2d.strokeStyle = '#1d2330';
  ctx2d.beginPath(); ctx2d.moveTo(0, h / 2); ctx2d.lineTo(w, h / 2); ctx2d.stroke();

  // One column per recent chunk, scrolling right-to-left (newest at right edge).
  const cols = Math.min(filled, w);
  for (let i = 0; i < cols; i++) {
    // Walk back from newest.
    const idx = (head - 1 - i + HISTORY * 2) % HISTORY;
    const p = peaks[idx];
    const x = w - 1 - i;
    const barH = Math.min(1, p) * (h / 2 - 6);
    const g = Math.floor(120 + 135 * Math.min(1, p));
    ctx2d.fillStyle = `rgb(${60},${g},${120})`;
    ctx2d.fillRect(x, h / 2 - barH, 1, barH * 2);
  }

  if (running) {
    const s = bro.mic.stats();
    if (s) {
      elChunkCount.textContent  = s.chunkCount;
      elChunkFrames.textContent = s.chunkFrames;
      elRollingPeak.textContent = s.rollingPeak.toFixed(3);
      elDropped.textContent     = s.dropped;
    }
  }
  requestAnimationFrame(draw);
}
// Measure the canvas and start only after layout is complete. Reading
// clientWidth inline (during readyState "loading", before the engine's initial
// layout pass) returns the 300x150 replaced-element default, leaving a
// stretched/zoomed bitmap until the first window resize. The load event fires
// after layout, so the backing store matches the box on first paint.
function init() {
  resize();
  requestAnimationFrame(draw);
  start();   // autostart so the meter is live on launch (windowed)
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}
