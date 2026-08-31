// test_main.js — Headless test suite for tools/media-inspector
//
// Exercises bro.media.peaks, bro.media.thumbnails, windowed analysis,
// UI visualizer synchronization, and takes a headless verification screenshot.

function resolveSamplePath(samplePath) {
    if (typeof bro !== 'undefined' && bro.media && bro.media.peaks(samplePath, { buckets: 4 })) {
        return samplePath;
    }
    if (typeof bro !== 'undefined' && bro.media && bro.media.peaks(`tools/media-inspector/${samplePath}`, { buckets: 4 })) {
        return `tools/media-inspector/${samplePath}`;
    }
    if (samplePath.includes('hello.webm')) {
        return 'demos/video_demo/hello.webm';
    }
    return samplePath;
}

const path = resolveSamplePath('samples/hello.webm');
const audioOnlyPath = resolveSamplePath('samples/ambience-bed.ogg');

console.log('=== Running Media Inspector Headless Tests ===');

// ── 1. Assert bro.media availability ─────────────────────────────────────────

assert(typeof bro !== 'undefined', 'global bro object exists');
assert(bro.media, 'bro.media namespace exists');
assert(bro.media.available === true, 'bro.media.available is true');
console.log('✔ bro.media API is available');

// ── 2. Validate bro.media.peaks structure ────────────────────────────────────

const BUCKETS = 256;
const peaks = bro.media.peaks(path, { buckets: BUCKETS });
assert(peaks !== null, 'peaks() returned valid object for hello.webm');
assert(typeof peaks.sampleRate === 'number' && peaks.sampleRate > 0,
       `peaks.sampleRate (${peaks.sampleRate}) is a positive number`);
assert(typeof peaks.channels === 'number' && peaks.channels >= 1,
       `peaks.channels (${peaks.channels}) >= 1`);
assert(typeof peaks.duration === 'number' && peaks.duration > 0,
       `peaks.duration (${peaks.duration.toFixed(3)}s) > 0`);
assert(peaks.buckets === BUCKETS,
       `peaks.buckets (${peaks.buckets}) === ${BUCKETS}`);
assert(peaks.from === 0, 'peaks.from starts at 0');
assert(Math.abs(peaks.to - peaks.duration) < 1e-4, 'peaks.to spans the file duration');

// Check TypedArray outputs
assert(peaks.min instanceof Float32Array, 'peaks.min is Float32Array');
assert(peaks.max instanceof Float32Array, 'peaks.max is Float32Array');
assert(peaks.rms instanceof Float32Array, 'peaks.rms is Float32Array');
assert(peaks.min.length === BUCKETS, `peaks.min length is ${BUCKETS}`);
assert(peaks.max.length === BUCKETS, `peaks.max length is ${BUCKETS}`);
assert(peaks.rms.length === BUCKETS, `peaks.rms length is ${BUCKETS}`);

// Check amplitude bounds
let minVal = 0, maxVal = 0, rmsSum = 0;
for (let i = 0; i < BUCKETS; i++) {
    minVal = Math.min(minVal, peaks.min[i]);
    maxVal = Math.max(maxVal, peaks.max[i]);
    rmsSum += peaks.rms[i];
    assert(peaks.min[i] <= peaks.max[i], `bucket ${i}: min (${peaks.min[i]}) <= max (${peaks.max[i]})`);
}
assert(maxVal > 0, `waveform has positive peaks (${maxVal.toFixed(3)})`);
assert(minVal < 0, `waveform has negative troughs (${minVal.toFixed(3)})`);
assert(rmsSum > 0, 'waveform has non-zero RMS energy');
console.log(`✔ bro.media.peaks validated (sr: ${peaks.sampleRate}Hz, ch: ${peaks.channels}, dur: ${peaks.duration.toFixed(2)}s, max: ${maxVal.toFixed(3)}, min: ${minVal.toFixed(3)})`);

// ── 3. Validate windowed bro.media.peaks ─────────────────────────────────────

const halfDur = peaks.duration / 2;
const windowedPeaks = bro.media.peaks(path, { buckets: 64, from: 0, to: halfDur });
assert(windowedPeaks !== null, 'windowed peaks() succeeded');
assert(windowedPeaks.buckets === 64, 'windowed buckets === 64');
assert(Math.abs(windowedPeaks.from - 0) < 0.01, 'windowed from === 0');
assert(Math.abs(windowedPeaks.to - halfDur) < 0.1, `windowed to ≈ ${halfDur.toFixed(2)}`);
assert(Math.abs(windowedPeaks.duration - peaks.duration) < 0.1, 'windowed duration reflects total file');

// Invalid window checks
assert(bro.media.peaks(path, { buckets: 16, from: 5, to: 1 }) === null,
       'inverted window returns null');
assert(bro.media.peaks('non_existent_file.webm', { buckets: 16 }) === null,
       'missing file returns null');
console.log('✔ windowed & invalid peaks handling verified');

// ── 4. Validate bro.media.thumbnails structure ───────────────────────────────

const THUMB_COUNT = 8;
const THUMB_HEIGHT = 48;
const strip = bro.media.thumbnails(path, { count: THUMB_COUNT, height: THUMB_HEIGHT });
assert(strip !== null, 'thumbnails() returned valid object for hello.webm');
assert(strip.count === THUMB_COUNT, `strip.count (${strip.count}) === ${THUMB_COUNT}`);
assert(strip.height === THUMB_HEIGHT, `strip.height (${strip.height}) === ${THUMB_HEIGHT}`);
assert(typeof strip.width === 'number' && strip.width > 0, `strip.width (${strip.width}) > 0`);
assert(typeof strip.rotation === 'number', `strip.rotation (${strip.rotation}) is number`);

// Check times array
assert(Array.isArray(strip.times), 'strip.times is an array');
assert(strip.times.length === THUMB_COUNT, `strip.times length === ${THUMB_COUNT}`);
for (let i = 1; i < strip.times.length; i++) {
    assert(strip.times[i] >= strip.times[i - 1],
           `strip timestamps walk forward (${strip.times[i - 1].toFixed(3)} -> ${strip.times[i].toFixed(3)})`);
}

// Check pixel buffer data
assert(strip.data instanceof Uint8ClampedArray, 'strip.data is Uint8ClampedArray');
const expectedLen = strip.width * strip.count * strip.height * 4;
assert(strip.data.length === expectedLen,
       `strip.data length (${strip.data.length}) matches width*count*height*4 (${expectedLen})`);

// Ensure frames contain actual image pixels (non-zero alpha & rgb)
let nonZeroAlpha = 0;
let rgbEnergy = 0;
for (let i = 0; i < strip.data.length; i += 4) {
    rgbEnergy += strip.data[i] + strip.data[i + 1] + strip.data[i + 2];
    if (strip.data[i + 3] > 0) nonZeroAlpha++;
}
assert(nonZeroAlpha > (strip.data.length / 4) * 0.9, 'thumbnails have full alpha opacity');
assert(rgbEnergy > 0, 'thumbnails have color content');
console.log(`✔ bro.media.thumbnails validated (${strip.count} frames, ${strip.width}x${strip.height}px, ${strip.data.length} bytes)`);

// ── 5. Validate windowed bro.media.thumbnails ────────────────────────────────

const winStrip = bro.media.thumbnails(path, { count: 4, height: 32, from: halfDur });
assert(winStrip !== null, 'windowed thumbnails() succeeded');
assert(winStrip.count === 4, 'windowed count === 4');
for (const t of winStrip.times) {
    assert(t >= halfDur - 0.25, `thumbnail timestamp ${t.toFixed(3)} >= window start ${halfDur.toFixed(3)}`);
}
console.log('✔ windowed thumbnails verified');

// ── 6. Test Audio-Only Peak Extraction ───────────────────────────────────────

const audioPeaks = bro.media.peaks(audioOnlyPath, { buckets: 128 });
if (audioPeaks) {
    assert(audioPeaks.sampleRate > 0, 'audio-only sampleRate > 0');
    assert(audioPeaks.min.length === 128, 'audio-only min length === 128');
    console.log(`✔ audio-only peaks verified (${audioOnlyPath}, ${audioPeaks.duration.toFixed(2)}s)`);
}

// ── 7. Validate DOM App & UI Visualizers ─────────────────────────────────────

flush();

// Check DOM elements exist
const videoEl = document.getElementById('mediaVideo');
const waveCanvas = document.getElementById('waveformCanvas');
const stripCanvas = document.getElementById('filmstripCanvas');
const playBtn = document.getElementById('playBtn');
const currentTimeEl = document.getElementById('currentTime');

assert(videoEl, '<video> element exists in DOM');
assert(waveCanvas, 'waveform canvas exists in DOM');
assert(stripCanvas, 'filmstrip canvas exists in DOM');
assert(playBtn, 'playBtn exists');

// Check app instance
const app = window.mediaInspectorApp;
assert(app, 'mediaInspectorApp instance attached to window');
assert(app.waveform, 'waveform visualizer instance initialized');
assert(app.filmstrip, 'filmstrip visualizer instance initialized');
assert(app.player, 'player instance initialized');
assert(app.metadata, 'metadata inspector instance initialized');

// Test seeking and player clock updates
app.player.seek(0.5);
flush();
assert(Math.abs(app.player.currentTime - 0.5) < 0.1, `player seek landed at ${app.player.currentTime}`);
assert(Math.abs(app.waveform.playheadTime - 0.5) < 0.1, 'waveform playhead updated on seek');
assert(Math.abs(app.filmstrip.playheadTime - 0.5) < 0.1, 'filmstrip playhead updated on seek');

// Test zoom actions
app.waveform.zoom(2.0);
flush();
assert(app.waveform.windowTo < app.waveform.duration, 'waveform zoomed in');
app.waveform.fit();
flush();
assert(Math.abs(app.waveform.windowTo - app.waveform.duration) < 0.05, 'waveform fit reset zoom');

console.log('✔ UI visualizers & synchronization verified');

// ── 8. Render & Headless Screenshot ──────────────────────────────────────────

// Force layout and paint
flush();
sleep(100);
screenshot('tests/media_inspector_screenshot.png');
console.log('✔ Headless screenshot saved: tests/media_inspector_screenshot.png');

console.log('PASS');
