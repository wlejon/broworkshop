// Mic Chunks headless test: the tap slices fed audio into exactly one chunk
// per 160 samples at 16 kHz, each chunk's peak reaches the scope, the stats
// readouts follow bro.mic.stats(), and Stop / AGC toggles reopen the tap.
// Run: scripts/validate.sh demos/mic-chunks
import { check, eq, near, frames, clickOn, setValue, text, test, done, shot } from "/lib/kit/test.js";
import { signal } from "/lib/kit/audio.js";
import { mic, CHUNK_FRAMES, TARGET_RATE } from "/app/lab.js";

frames(5);
check(mic.running, 'the tap autostarts on boot');

// Reopen without a device and feed one second of a 0.5-amplitude tone.
mic.start({ live: false });
const er = bro.mic.engineRate();
bro.mic.feed(signal.tone(1.0, 440, 0.5, er), er);
frames(20);

test('one chunk per 10 ms of fed audio', () => {
    near(mic.chunks, TARGET_RATE / CHUNK_FRAMES, 2, 'chunks for 1 s');
});
test('chunk peaks carry the signal level', () => near(mic.lastPeak, 0.5, 0.08, 'peak'));
test('every chunk drew a scope column', () => eq(mic.scope.count, mic.chunks));
test('stats readouts follow bro.mic.stats()', () => {
    const s = bro.mic.stats();
    eq(text('#chunkFrames'), String(CHUNK_FRAMES));
    eq(text('#chunkCount'), String(s.chunkCount));
    check(+text('#rollingPeak') > 0.3, 'rolling peak ' + text('#rollingPeak'));
    eq(text('#dropped'), '0');
});
shot('fed');

test('AGC toggle reopens the tap', () => {
    setValue('#agc', true);
    check(mic.running && bro.mic.isActive(), 'running after AGC change');
    eq(mic.chunks, 0, 'fresh tap');
});
test('Stop closes the tap', () => {
    clickOn('#toggle');
    check(!mic.running && !bro.mic.isActive(), 'stopped');
    eq(text('#toggle'), 'Start');
});
done('mic-chunks');
