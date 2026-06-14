// KWS Lab — headless smoke test. Verifies the app's UI wiring end-to-end:
// boot loads the spotter and seeds a template, Enroll adds a chip, Listen
// arms the mic path, and a Kokoro-synthesized utterance fed through
// bro.kws.feed() lands in the spot log (the binding's own coverage lives in
// bro's tests/_kws_smoke.js).
//
//   bro-headless ../broworkshop/demos/kws-lab ../broworkshop/demos/kws-lab/test.js

function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }
function pumpUntil(pred, budgetMs) {
    const start = Date.now();
    while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
    return pred();
}

const WROOT = (typeof process !== 'undefined' && process.env && process.env.BRO_WEIGHTS) || 'D:/projects';
const KOKORO_DIR = WROOT + '/brosoundml/weights/kokoro';
const VOICE_PATH = KOKORO_DIR + '/voices/af_bella.bin';

// Boot seeds 'hello there'.
assert(pumpUntil(() => bro.kws.isLoaded(), 30000), 'spotter loaded at boot');
assert(bro.kws.templates().indexOf('hello there') >= 0, 'boot seeded a template');
assert(document.querySelectorAll('.chip').length === 1, 'seed chip rendered');

// Enroll via the UI.
document.querySelector('#phrase').value = 'open the pod bay doors';
document.querySelector('#enroll').click();
assert(bro.kws.templates().length === 2, 'enroll added a template');
assert(document.querySelectorAll('.chip').length === 2, 'chip rendered');

// Listen.
document.querySelector('#listen').click();
assert(bro.kws.isActive(), 'listening after click');

// Synthesize the seeded phrase and feed it (no live mic headless).
const kokoro = bro.tts.loadKokoro(KOKORO_DIR);
const voice  = kokoro.loadVoice(VOICE_PATH);
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
let fired = [];
const CHUNK = rate / 10;
for (let off = 0; off < clip.length; off += CHUNK) {
    const got = bro.kws.feed(clip.subarray(off, Math.min(off + CHUNK, clip.length)));
    if (Array.isArray(got)) fired.push(...got);
}
bro.kws.feed(silence);
assert(fired.some((e) => e.name === 'hello there'),
       'spotter fired on the synthesized phrase (' + JSON.stringify(fired) + ')');

// onSpot delivery reaches the app log on the next ticks. (Open-vocab spotting
// can fire more than once / cross-fire other templates — that's a tuning
// property; the app contract is that the spotted name lands in the log.)
assert(pumpUntil(() => document.querySelectorAll('#log .row').length > 0, 10000),
       'spot row rendered');
const names = Array.from(document.querySelectorAll('#log .row .name'))
    .map((n) => n.textContent);
assert(names.indexOf('hello there') >= 0,
       'spot log names the template (rows: ' + JSON.stringify(names) + ')');

// Stop tears down cleanly.
document.querySelector('#listen').click();
assert(!bro.kws.isActive(), 'stopped');

console.log('[kws-lab] PASS');
