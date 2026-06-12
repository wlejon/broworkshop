// Listen Lab — headless smoke test. Boot arms both tiers on the shared listen
// host; synthetic audio fed through bro.kws.feed() (ONE stream — it advances
// bro.sense too) must light every sensor family and land the right rows in
// the fusion feed: [tonal] for a sustained tone, [onset] for a click train,
// [voice]/[arm]/[spot] for a spoken enrolled phrase, and a rhythm template
// (enrollGaps, via the listenLab seam — no live mic to record from) must
// self-fire on its own clip.
//
//   bro-headless ../broworkshop/demos/listen-lab ../broworkshop/demos/listen-lab/test.js

function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }
function pumpUntil(pred, budgetMs) {
    const start = Date.now();
    while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
    return pred();
}

const KOKORO_DIR = 'D:/projects/brosoundml/weights/kokoro';
const VOICE_PATH = KOKORO_DIR + '/voices/af_bella.bin';

// ── boot: both tiers live ────────────────────────────────────────────────────

assert(pumpUntil(() => bro.sense.isActive(), 30000), 'sense live at boot');
assert(pumpUntil(() => bro.kws.isLoaded() && bro.kws.isActive(), 30000), 'kws live at boot');
assert(pumpUntil(() => document.querySelectorAll('.tmpl').length === 1, 5000),
       'seed template row rendered');

const rate = bro.kws.sampleRate();

// ── synthesis helpers ────────────────────────────────────────────────────────

function silence(sec) { return new Float32Array(Math.floor(sec * rate)); }

// 10 ms fade-out — a hard mid-cycle cutoff is a real broadband transient.
function tone(sec, hz, amp) {
    const n = Math.floor(sec * rate), fade = Math.floor(0.01 * rate);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const g = i >= n - fade ? (n - i) / fade : 1;
        s[i] = g * amp * Math.sin(2 * Math.PI * hz * i / rate);
    }
    return s;
}

// n damped 5 ms noise bursts, gapSec apart (deterministic LCG noise).
function clicks(n, gapSec, amp) {
    const parts = [];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let k = 0; k < n; k++) {
        const burst = new Float32Array(Math.floor(0.005 * rate));
        for (let i = 0; i < burst.length; i++) burst[i] = amp * rnd() * (1 - i / burst.length);
        parts.push(burst, silence(gapSec));
    }
    return concat(...parts);
}

function concat(...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

const kokoro = bro.tts.loadKokoro(KOKORO_DIR);
const voice  = kokoro.loadVoice(VOICE_PATH);

function speak(text) {
    const res = kokoro.synthesize(bro.tts.phonemize(text), voice);
    if (res.sampleRate === rate) return res.samples;
    const ratio = rate / res.sampleRate, m = Math.floor(res.samples.length * ratio);
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) {
        const t = i / ratio, j = t | 0, f = t - j;
        const a = res.samples[j], b = res.samples[j + 1] !== undefined ? res.samples[j + 1] : a;
        out[i] = a * (1 - f) + b * f;
    }
    return out;
}

// Feed in 50 ms chunks with a pump after each, so the app's poll loop (RAF —
// only runs while frames pump) observes the INTERMEDIATE states: that's what
// makes the [arm] row reachable mid-phrase. Returns the events feed() itself
// reported.
function feedPumped(all) {
    const events = [];
    const CHUNK = Math.floor(rate / 40);
    for (let off = 0; off < all.length; off += CHUNK) {
        const got = bro.kws.feed(all.subarray(off, Math.min(off + CHUNK, all.length)));
        if (Array.isArray(got)) events.push(...got);
        sleep(15);
    }
    return events;
}

function feedRows(kind) {
    return Array.from(document.querySelectorAll('#feed .row'))
        .filter((r) => r.querySelector('.kind').textContent === kind)
        .map((r) => r.querySelector('.txt').textContent);
}

// ── 1. sustained tone → tonality sensor + [tonal] fusion row ────────────────

feedPumped(concat(silence(0.3), tone(1.0, 1200, 0.15), silence(0.3)));
const s1 = bro.sense.snapshot();
assert(s1.tonalEvents >= 1, 'tonality sensor counted the tone (events ' + s1.tonalEvents + ')');
assert(pumpUntil(() => feedRows('tonal').length >= 1, 5000),
       '[tonal] fusion row rendered');
assert(feedRows('tonal').some((t) => /~1[12]\d\d Hz/.test(t)),
       '[tonal] row names a frequency near 1200 Hz (' + JSON.stringify(feedRows('tonal')) + ')');
console.log('[listen-lab] tonality: ' + feedRows('tonal')[0]);

// ── 2. click train → onset sensor + [onset] fusion row ──────────────────────

const onsets0 = bro.sense.snapshot().onsets;
feedPumped(concat(silence(0.3), clicks(5, 0.2, 0.5), silence(0.3)));
const onsetDelta = bro.sense.snapshot().onsets - onsets0;
assert(onsetDelta >= 3, 'onset sensor caught the clicks (' + onsetDelta + '/5)');
assert(pumpUntil(() => feedRows('onset').length >= 1, 5000), '[onset] fusion row rendered');
assert(pumpUntil(() => +document.querySelector('#onsetTxt').textContent >= onsets0 + 3, 5000),
       'onset card counter updated');
console.log('[listen-lab] onsets: ' + onsetDelta + '/5 clicks');

// ── 3. spoken phrase → VAD + mid-phrase [arm] + [spot] + progress row ────────

feedPumped(concat(silence(0.5), speak('hello there'), silence(0.4)));
assert(pumpUntil(() => feedRows('spot').some((t) => t.indexOf('hello there') >= 0), 10000),
       '[spot] fusion row for the seeded phrase');
assert(feedRows('voice').length >= 1, '[voice] fusion rows from the utterance');
assert(feedRows('arm').some((t) => t.indexOf('hello there') >= 0),
       '[arm] row fired mid-phrase, before the spot (' + JSON.stringify(feedRows('arm')) + ')');
const pt = bro.kws.progress().templates.find((t) => t.name === 'hello there');
assert(pt && pt.completions >= 1, 'progress() counted the completion');
assert(pumpUntil(() => +document.querySelector('#spotCount').textContent >= 1, 5000),
       'statusbar spot count updated');
console.log('[listen-lab] phrase: arm="' + feedRows('arm')[feedRows('arm').length - 1] +
            '" spot="' + feedRows('spot')[0] + '"');

// ── 3b. token panel: inspect + edit the seeded phrase ───────────────────────
// The ⋯ button opens the decoded phoneme sequence (bro.kws.inspect); for a
// plain phrase the chips are editable and "apply edit" re-enrolls the trimmed
// class ids (enrollFromClasses).

{
    const seedRow = Array.from(document.querySelectorAll('.tmpl'))
        .find((r) => r.querySelector('.tname').textContent === 'hello there');
    assert(seedRow, 'seed row present for token inspect');
    seedRow.querySelector('.tok').click();
    const chips = seedRow.querySelectorAll('.tokens .chip');
    assert(chips.length >= 3, 'token panel shows the decoded phonemes (' + chips.length + ')');
    assert(Array.from(chips).every((c) => c.textContent.replace('×', '').trim().length),
           'every chip carries a phoneme label');
    const before = bro.kws.inspect('hello there').states.length;
    // Drop the first token and apply the edit.
    seedRow.querySelector('.tokens .chip .x').click();
    seedRow.querySelector('.tokens .tokedit button').click();   // "apply edit"
    assert(pumpUntil(() => {
        const v = bro.kws.inspect('hello there');
        return v && v.states.length === before - 1;
    }, 5000), 'apply edit re-enrolled the trimmed token sequence');
    assert(bro.kws.isActive(), 'listening resumed after the token edit');
    console.log('[listen-lab] tokens: hello there ' + before + ' → ' +
                bro.kws.inspect('hello there').states.length + ' tokens after edit');
}

// ── 4. rhythm template via the enrollGaps seam, self-fires on its clip ──────
// enrollFromAudio runs a FRESH offline forward, while the live front-end has
// adapted to everything this test already fed it. PCEN's smoother converges
// back to ambient in well under a second in any real room, but this stream's
// silence is digital zeros, which it decays toward for ~10 s (measured) — so
// give the shared front-end a long quiet stretch first to put the live
// context back where enrollment ran. (The matcher itself grants kMaxFloorRun
// frames of onset-drift slack per transition; context convergence on real
// mics is the Record button's natural state.)

bro.kws.feed(silence(12));
const pod = speak('open the pod bay doors');
listenLab.enrollRhythm('pod-bay-rhythm', pod);
assert(bro.kws.templates().indexOf('pod-bay-rhythm') >= 0, 'rhythm template enrolled');
assert(pumpUntil(() => Array.from(document.querySelectorAll('.tmpl .badge'))
                       .some((b) => b.textContent === 'rhythm'), 5000),
       'rhythm badge rendered on the new template row');
const fired = feedPumped(concat(silence(0.5), pod, silence(0.4)));
assert(fired.some((e) => e.name === 'pod-bay-rhythm'),
       'gap-enrolled rhythm template self-fired (' + JSON.stringify(fired) + ')');
console.log('[listen-lab] rhythm: pod-bay-rhythm fired @ conf ' +
            fired.find((e) => e.name === 'pod-bay-rhythm').confidence.toFixed(3));

// ── 5. remove a template via its × button while live ────────────────────────
// withMutableSpotter bounces the session (stop → remove → listen): afterwards
// the row is gone, the seed template survives, and listening has resumed.
// (Windowed, this same path crossed the inference worker mid-feed — the
// AudioInference::removeTask barrier is what makes the bounce safe.)

{
    const rows = Array.from(document.querySelectorAll('.tmpl'));
    const podRow = rows.find((r) => r.querySelector('.tname').textContent === 'pod-bay-rhythm');
    assert(podRow, 'pod-bay-rhythm row present before remove');
    podRow.querySelector('.rm').click();
    assert(bro.kws.templates().indexOf('pod-bay-rhythm') < 0, 'rhythm template removed');
    assert(bro.kws.templates().indexOf('hello there') >= 0, 'seed template survived the remove');
    assert(bro.kws.isActive(), 'listening resumed after the remove bounce');
    assert(pumpUntil(() => document.querySelectorAll('.tmpl').length === 1, 5000),
           'template row rebuilt down to 1 after remove');
    console.log('[listen-lab] remove: pod-bay-rhythm removed live, listening resumed');
}

// ── 6. teardown: kws leaves, tier-0 keeps rolling ────────────────────────────

document.querySelector('#listen').click();
assert(!bro.kws.isActive(), 'kws stopped via UI');
assert(bro.sense.isActive(), 'sense still live after kws left');

console.log('[listen-lab] PASS');
