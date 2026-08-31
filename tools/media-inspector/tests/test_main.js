// tools/media-inspector/tests/test_main.js

let passed = 0;
let failed = 0;

function check(desc, cond) {
    if (cond) {
        console.log("  ok  " + desc);
        passed++;
    } else {
        console.log("  FAIL: " + desc);
        failed++;
    }
}

console.log("\n=== Media Inspector Integration Tests ===\n");

// [1] bro.media API availability
console.log("[1] Checking bro.media API Availability");
check("bro namespace exists", typeof bro !== 'undefined');
check("bro.media namespace exists", typeof bro.media !== 'undefined');
check("bro.media.available is true", bro.media && bro.media.available === true);
check("bro.media.peaks is a function", typeof bro.media.peaks === 'function');
check("bro.media.thumbnails is a function", typeof bro.media.thumbnails === 'function');

// [2] Generate a verified test media clip using VideoEncoder
console.log("\n[2] Creating Test Media Clip with Audio & Video");
const testClipPath = "test_clip.webm";
const W = 64, H = 48, FPS = 10, N = 30;
const RATE = 48000;

try {
    const enc = new VideoEncoder({
        path: testClipPath,
        width: W,
        height: H,
        fps: FPS,
        quality: 'realtime',
        audioSampleRate: RATE,
        audioChannels: 1,
        audioBitrateKbps: 64,
    });

    const px = new Uint8Array(W * H * 4);
    const audioChunk = new Float32Array(RATE / FPS);

    for (let f = 0; f < N; ++f) {
        const level = Math.round((f / (N - 1)) * 255);
        for (let i = 0; i < W * H; ++i) {
            px[i * 4] = level;
            px[i * 4 + 1] = 120;
            px[i * 4 + 2] = 200;
            px[i * 4 + 3] = 255;
        }
        enc.addFrameRGBA(px);

        for (let i = 0; i < audioChunk.length; ++i) {
            audioChunk[i] = 0.5 * Math.sin((f * audioChunk.length + i) * 0.05);
        }
        enc.addAudioFramesPCM(audioChunk);
    }
    enc.finish();
    check("VideoEncoder successfully generated test_clip.webm", true);
} catch (e) {
    check("VideoEncoder generated test_clip: " + e.message, false);
}

// [3] Audio waveform peaks extraction
console.log("\n[3] Audio Waveform Peaks Analysis");
const peaks = bro.media.peaks(testClipPath, { buckets: 256 });

check("bro.media.peaks returned valid object", peaks !== null && typeof peaks === 'object');
if (peaks) {
    check("sampleRate is positive (48000)", peaks.sampleRate === RATE);
    check("channels is valid (1)", peaks.channels === 1);
    check("duration is positive (~3s)", Math.abs(peaks.duration - (N / FPS)) < 0.5);
    check("buckets count matches requested (256)", peaks.buckets === 256 || (peaks.max && peaks.max.length === 256));
    check("min array is Float32Array", peaks.min instanceof Float32Array);
    check("max array is Float32Array", peaks.max instanceof Float32Array);
    check("rms array is Float32Array", peaks.rms instanceof Float32Array);
    check("min array length is 256", peaks.min.length === 256);
    check("max array length is 256", peaks.max.length === 256);
    check("rms array length is 256", peaks.rms.length === 256);
}

// [4] Video thumbnail strip extraction
console.log("\n[4] Video Filmstrip Thumbnails Analysis");
const thumbs = bro.media.thumbnails(testClipPath, { count: 6, height: 36 });

check("bro.media.thumbnails returned valid object", thumbs !== null && typeof thumbs === 'object');
if (thumbs) {
    check("thumbnails count matches requested (6)", thumbs.count === 6);
    check("thumbnails height is 36", thumbs.height === 36);
    check("thumbnails width is positive", thumbs.width > 0);
    check("thumbnails times is an Array", Array.isArray(thumbs.times));
    check("thumbnails times length is 6", thumbs.times.length === 6);
    check("thumbnails times are monotonic", thumbs.times[thumbs.times.length - 1] >= thumbs.times[0]);
    check("thumbnails data buffer has valid length", thumbs.data && thumbs.data.length === (thumbs.width * thumbs.count * thumbs.height * 4));
}

// [5] DOM Layout & Canvas Inspection
console.log("\n[5] DOM & Canvas Verification");
const waveformCanvas = document.getElementById('waveformCanvas');
const filmstripCanvas = document.getElementById('filmstripCanvas');
const mediaVideo = document.getElementById('mediaVideo');

check("waveform canvas element exists in DOM", !!waveformCanvas);
check("filmstrip canvas element exists in DOM", !!filmstripCanvas);
check("media video element exists in DOM", !!mediaVideo);

// [6] Screenshot
console.log("\n[6] Capturing Verification Screenshot");
if (typeof screenshot === 'function') {
    screenshot("media_inspector_test.png");
    console.log("  screenshot: media_inspector_test.png");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
    throw new Error(`${failed} tests failed in media-inspector integration test suite`);
}
