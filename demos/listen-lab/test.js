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

// ── 4. tier-0 gesture: a click rhythm enrolls (bro.gesture) and self-fires ───
// The non-speech path. A click train is matched on SensorHub onsets, not the
// speech model — feeding via bro.kws.feed advances the ONE shared stream, so
// the gesture spotter (a host member once we listen) sees the same clicks.

const clickTrain = concat(silence(0.3), clicks(3, 0.25, 0.6), silence(0.3));
listenLab.enrollGesture('triple-tap', clickTrain);
assert(bro.gesture.templates().indexOf('triple-tap') >= 0, 'gesture enrolled');
const gv = bro.gesture.inspect('triple-tap');
assert(gv && gv.kind === 'rhythm', 'gesture classified as a rhythm');
assert(gv.intervalsMs.length === 2, 'rhythm has two inter-onset intervals');
assert(pumpUntil(() => Array.from(document.querySelectorAll('.gest .gname'))
                       .some((g) => g.textContent === 'triple-tap'), 5000),
       'gesture row rendered');
console.log('[listen-lab] gesture: enrolled ' + gv.kind + ' · ' +
            gv.intervalsMs.map((m) => Math.round(m)).join('/') + ' ms');

const spotsBefore = +document.querySelector('#spotCount').textContent;
feedPumped(concat(silence(0.5), clickTrain, silence(0.4)));
assert(pumpUntil(() => feedRows('spot').some((t) => t.indexOf('triple-tap') >= 0), 8000),
       'gesture self-fired (onGesture → fusion spot row)');
assert(pumpUntil(() => +document.querySelector('#spotCount').textContent > spotsBefore, 3000),
       'spot count advanced on the gesture fire');
console.log('[listen-lab] gesture: ' +
            feedRows('spot').find((t) => t.indexOf('triple-tap') >= 0));

// ── 4b. timeline: history ring filled, events logged, click-to-inspect ───────
// The scrollable stream history (Stream ring) accumulated frames across the
// whole run, the notable fires landed in the event log as markers, and
// selecting a marker opens the detail panel with the matched clip.

assert(listenLab.Stream.count > 100,
       'stream history ring accumulated frames (' + listenLab.Stream.count + ')');
const gestEv = listenLab.events.find((e) => e.type === 'gesture' && e.name === 'triple-tap');
assert(gestEv, 'gesture fire landed in the timeline event log');
assert(gestEv.frame > 0 && gestEv.conf > 0.9, 'event carries its frame + confidence');
const spotEv = listenLab.events.find((e) => e.type === 'spot' && e.name === 'hello there');
assert(spotEv, 'phrase spot landed in the timeline event log');

// Exact matched spans now flow from the matchers through the event callbacks.
assert(gestEv.span && gestEv.span.b > gestEv.span.a && gestEv.span.b === gestEv.frame,
       'gesture event carries an exact matched span ending at the fire frame');
assert(spotEv.span && spotEv.span.b > spotEv.span.a && spotEv.span.b === spotEv.frame,
       'spot event carries an exact matched span (' +
       JSON.stringify(spotEv.span) + ')');
// The decoded phonemes over the EXACT spot span spell the phrase.
const heardExact = listenLab.decodedOver(spotEv.span.a, spotEv.span.b);
assert(heardExact.length >= 2,
       'decoded phonemes over the exact spot span (' + JSON.stringify(heardExact) + ')');
console.log('[listen-lab] spans: gesture ' + (gestEv.span.b - gestEv.span.a) +
            'f · spot ' + (spotEv.span.b - spotEv.span.a) + 'f heard ' +
            JSON.stringify(heardExact));

// Stream retention: the raw audio that drove a match is replayable by frame
// range (bro.listen). Enabled at boot; the headless feed() path is captured too.
const rInfo = bro.listen.info();
assert(rInfo.active && rInfo.seconds === 600,
       'retention enabled at boot (' + JSON.stringify(rInfo) + ')');
assert(bro.listen.frame() > 100,
       'stream frame advanced with the fed audio (' + bro.listen.frame() + ')');
const clip = bro.listen.audio(spotEv.span.a, spotEv.span.b);
assert(clip && clip.length > 0,
       'bro.listen.audio returns the retained clip for the spot region');
let clipEnergy = 0;
for (let i = 0; i < clip.length; i++) clipEnergy += clip[i] * clip[i];
assert(clipEnergy > 0,
       'retained clip carries real audio, not silence (energy ' + clipEnergy.toFixed(3) + ')');
// A region far in the future / before the held window returns null.
assert(bro.listen.audio(bro.listen.frame() + 10000, bro.listen.frame() + 20000) === null,
       'audio() returns null outside the retained window');
console.log('[listen-lab] retention: held ' + rInfo.heldSeconds.toFixed(1) + ' s · spot clip ' +
            clip.length + ' samples · energy ' + clipEnergy.toFixed(2));

// tier-1: the phoneme ring captured what the model decoded during the phrase.
let phFrames = 0;
for (let i = 0; i < listenLab.Stream.count; i++) {
    if (listenLab.Stream.phCls[listenLab.Stream.slot(i)] > 0) phFrames++;
}
assert(phFrames > 5, 'phoneme ring captured decoded frames (' + phFrames + ')');
const heardSeq = listenLab.decodedOver(spotEv.frame - 80, spotEv.frame);
assert(heardSeq.length >= 1,
       'decodedOver yields the heard phonemes near the spot (' + JSON.stringify(heardSeq) + ')');
// The detail panel surfaces that decoded sequence for the spot.
listenLab.selectEvent(spotEv);
const detailSpot = document.querySelector('#detail');
assert(/model heard here/.test(detailSpot.textContent),
       'detail shows what the model decoded over the matched region');
listenLab.closeDetail();
console.log('[listen-lab] phonemes: ' + phFrames + ' decoded frames · spot region heard ' +
            JSON.stringify(heardSeq));

// Select the gesture marker → detail panel shows the rhythm template it matched.
listenLab.selectEvent(gestEv);
const detailEl = document.querySelector('#detail');
assert(!detailEl.classList.contains('hidden'), 'detail panel opened on select');
assert(detailEl.querySelector('.dkind').textContent === 'gesture', 'detail names the event kind');
assert(/rhythm template/.test(detailEl.textContent) && /taps/.test(detailEl.textContent),
       'detail shows the matched rhythm clip (' +
       detailEl.querySelector('.drow').textContent + ')');
assert(listenLab.View.selRegion && listenLab.View.selRegion.b === gestEv.frame,
       'selection highlights the matched region ending at the fire frame');
listenLab.closeDetail();
assert(detailEl.classList.contains('hidden'), 'detail panel closes');
console.log('[listen-lab] timeline: ' + listenLab.Stream.count + ' frames · ' +
            listenLab.events.length + ' events · detail inspect ok');

// ── 5. remove the gesture via its × button while live ────────────────────────
// withMutableGesture bounces the gesture session (stop → remove → listen);
// afterwards the row is gone and kws listening is untouched (separate member).

{
    const rows = Array.from(document.querySelectorAll('.gest'));
    const row = rows.find((r) => r.querySelector('.gname').textContent === 'triple-tap');
    assert(row, 'triple-tap gesture row present before remove');
    row.querySelector('.rm').click();
    assert(bro.gesture.templates().indexOf('triple-tap') < 0, 'gesture removed');
    assert(bro.kws.templates().indexOf('hello there') >= 0, 'kws seed untouched by gesture remove');
    assert(bro.kws.isActive(), 'kws still listening after the gesture remove');
    console.log('[listen-lab] remove: triple-tap gesture removed live');
}

// ── 6. teardown: kws leaves, tier-0 keeps rolling ────────────────────────────

document.querySelector('#listen').click();
assert(!bro.kws.isActive(), 'kws stopped via UI');
assert(bro.sense.isActive(), 'sense still live after kws left');

console.log('[listen-lab] PASS');
