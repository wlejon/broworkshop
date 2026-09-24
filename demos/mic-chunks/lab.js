// Mic Chunks — a worked consumer of broaudio's chunkFrames feature via bro.mic.
//
// bro.mic.start({ chunkFrames, targetRate, agc, onChunk }) registers a broaudio
// mic tap. broaudio owns the resampler + AGC + fixed-size chunk slicing; we get
// exactly one onChunk per chunkFrames samples at targetRate. At 16 kHz / 160
// frames that is one chunk every 10 ms, a steady 100 chunks/sec. Each chunk's
// peak draws one column of the scrolling scope, so the cadence is visible.
//
// Headless: with no audio device, start({ live: false }) opens no device and a
// script drives the same tap with bro.mic.feed() (tests/test_main.js).

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { stats } from "/lib/kit/ui.js";
import { peakScope } from "/lib/kit/audio-ui.js";

export const CHUNK_FRAMES = 160;     // 10 ms at 16 kHz
export const TARGET_RATE = 16000;

const { status } = boot();
const el = ids('toggle', 'agc', 'cfg');
const readouts = stats('.k-stats');
const scope = peakScope('#scope');

el.cfg.textContent = (TARGET_RATE / 1000) + ' kHz · ' + CHUNK_FRAMES + ' frames/chunk · ' +
    (CHUNK_FRAMES / TARGET_RATE * 1000) + ' ms cadence';

/** Live state, read by the test. */
export const mic = {
    running: false,
    live: true,
    chunks: 0,          // onChunk calls since the last start
    lastPeak: 0,
    scope,

    /** Open the tap. live: false opens no device (feed it with bro.mic.feed). */
    start(opts) {
        if (mic.running) mic.stop();
        mic.live = !(opts && opts.live === false);
        mic.chunks = 0;
        try {
            bro.mic.start({
                chunkFrames: CHUNK_FRAMES, targetRate: TARGET_RATE, agc: el.agc.checked, live: mic.live,
                onChunk: (c) => { mic.chunks++; mic.lastPeak = c.peak; scope.push(c.peak); },
            });
        } catch (e) {
            status.error('mic: ' + (e.message || e));
            return false;
        }
        mic.running = true;
        el.toggle.textContent = 'Stop';
        el.toggle.classList.add('active');
        status.ok(mic.live ? 'capturing' : 'tap open (fed, no device)');
        return true;
    },

    stop() {
        if (!mic.running) return;
        bro.mic.stop();
        mic.running = false;
        el.toggle.textContent = 'Start';
        el.toggle.classList.remove('active');
        status.set('stopped');
    },
};

el.toggle.addEventListener('click', () => (mic.running ? mic.stop() : mic.start({ live: mic.live })));
// AGC is a start option: reopen the tap with the new setting.
el.agc.addEventListener('change', () => { if (mic.running) mic.start({ live: mic.live }); });

function draw() {
    scope.draw();
    if (mic.running) {
        const s = bro.mic.stats();
        if (s) {
            readouts.set({
                chunkCount: s.chunkCount, chunkFrames: s.chunkFrames,
                rollingPeak: s.rollingPeak.toFixed(3), dropped: s.dropped,
            });
        }
    }
    requestAnimationFrame(draw);
}

// Autostart so the scope is live on launch.
mic.start();
requestAnimationFrame(draw);
