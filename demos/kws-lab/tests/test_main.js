// KWS Lab — headless smoke test. Verifies the app's UI wiring end-to-end:
// boot loads the spotter and seeds a template, Enroll adds a chip, Listen
// arms the mic path, and a Kokoro-synthesized utterance fed through
// bro.kws.feed() lands in the spot log (the binding's own coverage lives in
// bro's tests/_kws_smoke.js).
//
//   scripts/validate.sh --ml demos/kws-lab

import { check, waitFor, q } from "/lib/kit/test.js";
import { requireWeights } from "/lib/kit/weights.js";

const KOKORO_DIR = requireWeights('Kokoro', ['brosoundml/weights/kokoro']);

// Boot seeds 'hello there'.
waitFor(() => bro.kws.isLoaded(), 'spotter loaded at boot', 30000);
check(bro.kws.templates().indexOf('hello there') >= 0, 'boot seeded a template');
check(document.querySelectorAll('.k-chip').length === 1, 'seed chip rendered');

// Enroll via the UI.
q('#phrase').value = 'open the pod bay doors';
q('#enroll').click();
check(bro.kws.templates().length === 2, 'enroll added a template');
check(document.querySelectorAll('.k-chip').length === 2, 'chip rendered');

// Listen.
q('#listen').click();
check(bro.kws.isActive(), 'listening after click');

// Synthesize the seeded phrase and feed it (no live mic headless).
const kokoro = bro.tts.loadKokoro(KOKORO_DIR);
const voice  = kokoro.loadVoice(KOKORO_DIR + '/voices/af_bella.bin');
const res    = kokoro.synthesize(bro.tts.phonemize('hello there'), voice);
const rate   = bro.kws.sampleRate();
const ratio  = rate / res.sampleRate;
const clip   = new Float32Array(Math.floor(res.samples.length * ratio));
for (let i = 0; i < clip.length; i++) {
    const t = i / ratio, j = t | 0, f = t - j;
    const a = res.samples[j], b = res.samples[j + 1] !== undefined ? res.samples[j + 1] : a;
    clip[i] = a * (1 - f) + b * f;
}
const silence = new Float32Array(Math.floor(rate * 0.3));
bro.kws.feed(silence);
const fired = [];
const CHUNK = rate / 10;
for (let off = 0; off < clip.length; off += CHUNK) {
    const got = bro.kws.feed(clip.subarray(off, Math.min(off + CHUNK, clip.length)));
    if (Array.isArray(got)) fired.push(...got);
}
bro.kws.feed(silence);
check(fired.some((e) => e.name === 'hello there'),
      'spotter fired on the synthesized phrase (' + JSON.stringify(fired) + ')');

// onSpot delivery reaches the app log on the next ticks. (Open-vocab spotting
// can fire more than once / cross-fire other templates — that's a tuning
// property; the app contract is that the spotted name lands in the log.)
waitFor(() => document.querySelectorAll('#log .name').length > 0, 'spot row rendered', 10000);
const names = Array.from(document.querySelectorAll('#log .name')).map((n) => n.textContent);
check(names.indexOf('hello there') >= 0, 'spot log names the template (rows: ' + JSON.stringify(names) + ')');

// Stop tears down cleanly.
q('#listen').click();
check(!bro.kws.isActive(), 'stopped');

console.log('[kws-lab] PASS');
