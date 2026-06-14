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

// n voiced bursts (short pitched tones with a sharp attack), gapSec apart — a
// "laugh" performed at a click rhythm's tempo: same onset timing, voiced timbre.
function voicedBursts(n, gapSec, hz, amp) {
    const parts = [];
    for (let k = 0; k < n; k++) {
        parts.push(tone(0.12, hz, amp), silence(Math.max(0, gapSec - 0.12)));
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

// ── 4c. clip editor: retained clip, offline analysis, tone stability gate ────
// Each enrolled gesture keeps its raw clip and is editable. bro.sense.analyze
// gives the per-frame tier-0 timeline the editor overlays; the tone stability
// gate — a held whistle fires, a swept "cough" pitch does not — is the library
// fix that motivated the editor.

// (a) offline analysis of a clip mirrors what the matcher enrolls from.
const whistleClip = concat(silence(0.3), tone(0.6, 1200, 0.2), silence(0.3));
const an = bro.sense.analyze(whistleClip);
assert(an.frames > 50 && an.flags.length === an.frames, 'analyze returns a per-frame timeline');
let tonalFrames = 0, pitchSum = 0, pitchN = 0;
for (let f = 0; f < an.frames; f++) {
    if (an.flags[f] & 2) { tonalFrames++; pitchSum += an.dominantHz[f]; pitchN++; }
}
assert(tonalFrames > 30, 'analyze marks the sustained tone as tonal (' + tonalFrames + ' frames)');
assert(pitchN > 0 && Math.abs(pitchSum / pitchN - 1200) < 80,
       'analyze pitch tracks the 1200 Hz tone (' + (pitchSum / pitchN).toFixed(0) + ' Hz)');
console.log('[listen-lab] analyze: ' + an.frames + ' frames · ' + tonalFrames +
            ' tonal · ~' + (pitchSum / pitchN).toFixed(0) + ' Hz');

// (b) enroll the whistle as a tone gesture; its row is editable (clip retained).
listenLab.enrollGesture('whistle', whistleClip);
const wv = bro.gesture.inspect('whistle');
assert(wv && wv.kind === 'tone', 'whistle enrolled as a tone gesture');
assert(typeof wv.toneSpread === 'number' && wv.toneSpread < 0.05,
       'a clean whistle enrolls as a steady pitch (spread ' + wv.toneSpread.toFixed(3) + ')');
assert(pumpUntil(() => Array.from(document.querySelectorAll('.gest')).some((r) =>
    r.querySelector('.gname').textContent === 'whistle' &&
    !r.querySelector('.edit').disabled), 5000),
    'whistle row has an enabled edit button (clip retained)');

// (c) open the editor → waveform canvas + the two tone sliders render.
const wrow = Array.from(document.querySelectorAll('.gest')).find((r) =>
    r.querySelector('.gname').textContent === 'whistle');
wrow.querySelector('.edit').click();
assert(pumpUntil(() => wrow.querySelector('.gwave'), 3000), 'editor waveform canvas rendered');
assert(wrow.querySelectorAll('.gslider').length === 3,
       'tone editor exposes volume + pitch + steadiness sliders');
assert(/peak .* dB/.test(wrow.querySelector('.ginfo').textContent),
       'editor info surfaces the selection peak level (' + wrow.querySelector('.ginfo').textContent + ')');
console.log('[listen-lab] editor: opened whistle clip editor (' +
            wrow.querySelectorAll('.gslider').length + ' sliders)');

// (d) the stability gate end-to-end: the steady whistle self-fires…
{
    const before = +document.querySelector('#spotCount').textContent;
    feedPumped(concat(silence(0.4), whistleClip, silence(0.4)));
    assert(pumpUntil(() => +document.querySelector('#spotCount').textContent > before, 6000),
           'steady whistle self-fires the tone gesture');
}
// …but a swept-pitch "cough" (same mean, wandering) does NOT — the failure the
// user reported. Continuous-phase 1000→1500 Hz sweep: tonal every frame, mean
// in-band, but never a held pitch.
{
    const n = Math.floor(0.6 * rate), sweep = new Float32Array(n), fade = Math.floor(0.01 * rate);
    let ph = 0;
    for (let i = 0; i < n; i++) {
        const hz = 1000 + 500 * (i / (n - 1));
        ph += 2 * Math.PI * hz / rate;
        const g = i >= n - fade ? (n - i) / fade : 1;
        sweep[i] = 0.2 * g * Math.sin(ph);
    }
    const before = +document.querySelector('#spotCount').textContent;
    feedPumped(concat(silence(0.5), sweep, silence(0.4)));
    for (let i = 0; i < 30; i++) sleep(20);   // give any (non-)fire time to deliver
    assert(+document.querySelector('#spotCount').textContent === before,
           'a swept-pitch cough does NOT fire the whistle (stability gate)');
    console.log('[listen-lab] stability: steady whistle fires, swept cough rejected');
}

// clean up the whistle so the next section starts from the seeded state.
{
    const r = Array.from(document.querySelectorAll('.gest')).find((x) =>
        x.querySelector('.gname').textContent === 'whistle');
    if (r) r.querySelector('.rm').click();
}

// ── 4d. volume + scratch-pad (the new edits) ─────────────────────────────────
// (1) The volume slider scales a clip and bakes the gain into the stored clip
// on release (re-enroll). (2) A region grabbed off the live timeline (the
// retained stream) can be promoted to a new gesture, which opens in the editor.

// (1) volume: gainedSlice is the transform; the slider bakes it into clipStore.
{
    // gainedSlice scales amplitude exactly.
    const src = concat(silence(0.2), tone(0.5, 900, 0.15), silence(0.2));
    const louder = listenLab.gainedSlice(src, 3, 0, src.length);
    let ps = 0, pl = 0;
    for (let i = 0; i < src.length; i++) ps = Math.max(ps, Math.abs(src[i]));
    for (let i = 0; i < louder.length; i++) pl = Math.max(pl, Math.abs(louder[i]));
    assert(Math.abs(pl - ps * 3) < 1e-4, 'gainedSlice scales amplitude by the gain (' +
           ps.toFixed(3) + '→' + pl.toFixed(3) + ')');

    listenLab.enrollGesture('vol-test', src);
    const vrow = Array.from(document.querySelectorAll('.gest')).find((r) =>
        r.querySelector('.gname').textContent === 'vol-test');
    vrow.querySelector('.edit').click();
    assert(pumpUntil(() => vrow.querySelector('.gwave'), 3000), 'vol-test editor opened');
    const volInput = vrow.querySelector('.gtol .gslider input[type="range"]');
    assert(volInput && +volInput.max === 4, 'volume slider is the first editor slider (×0–4)');
    const peak0 = listenLab.clipStore['vol-test'].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // Drive the slider: set value, fire input (live preview) then change (bake).
    volInput.value = '2.5';
    volInput.dispatchEvent({ type: 'input' });
    volInput.dispatchEvent({ type: 'change' });
    assert(pumpUntil(() => {
        const c = listenLab.clipStore['vol-test'];
        const pk = c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        return Math.abs(pk - peak0 * 2.5) < 1e-3;
    }, 5000), 'volume change baked the 2.5× gain into the stored clip');
    console.log('[listen-lab] volume: vol-test peak ' + peak0.toFixed(3) + ' → ' +
                listenLab.clipStore['vol-test'].reduce((m, v) => Math.max(m, Math.abs(v)), 0).toFixed(3));
    // tidy up
    Array.from(document.querySelectorAll('.gest')).find((r) =>
        r.querySelector('.gname').textContent === 'vol-test').querySelector('.rm').click();
}

// (2) scratch-pad: clip a retained region of the timeline into a new gesture.
// Feed a fresh whistle so it sits at the live edge, then select that span on
// the stream axis (the same frames bro.listen.audio + the timeline use) and
// promote it. The new gesture must enroll from the retained audio and open in
// the editor.
{
    const before = bro.listen.frame();
    feedPumped(concat(silence(0.3), tone(0.7, 1400, 0.2), silence(0.3)));
    const after = bro.listen.frame();
    assert(after > before, 'stream advanced for the scratch source (' + before + '→' + after + ')');
    // Select the whistle's span (skip the leading/trailing silence padding).
    listenLab.View.scratchSel = { a: before + 35, b: after - 35 };
    const sp = listenLab.scratchSpan();
    assert(sp && sp.b > sp.a, 'scratchSpan clamps to the retained window (' + JSON.stringify(sp) + ')');
    const gBefore = bro.gesture.templates().length;
    document.querySelector('#phrase').value = 'from-timeline';
    listenLab.scratchToGesture();
    assert(bro.gesture.templates().indexOf('from-timeline') >= 0,
           'scratch selection enrolled a new gesture');
    assert(bro.gesture.templates().length === gBefore + 1, 'exactly one new gesture added');
    assert(listenLab.clipStore['from-timeline'] &&
           listenLab.clipStore['from-timeline'].length > 0,
           'the new gesture retained its clip from the timeline audio');
    let e = 0;
    const c = listenLab.clipStore['from-timeline'];
    for (let i = 0; i < c.length; i++) e += c[i] * c[i];
    assert(e > 0, 'clipped timeline region carries real audio (energy ' + e.toFixed(2) + ')');
    assert(listenLab.View.scratchSel === null, 'scratch selection cleared after promotion');
    // It opened straight into the editor.
    assert(pumpUntil(() => {
        const r = Array.from(document.querySelectorAll('.gest')).find((x) =>
            x.querySelector('.gname').textContent === 'from-timeline');
        return r && r.querySelector('.gwave');
    }, 3000), 'the new gesture opened in the clip editor');
    const fv = bro.gesture.inspect('from-timeline');
    console.log('[listen-lab] scratch: clipped ' + (c.length / rate).toFixed(2) +
                ' s off the timeline → gesture (' + (fv ? fv.kind : '?') + ')');
    // tidy up
    Array.from(document.querySelectorAll('.gest')).find((r) =>
        r.querySelector('.gname').textContent === 'from-timeline').querySelector('.rm').click();
}

// ── 4e. rhythm sound-shape gate (new): a voiced "laugh" at the click tempo
// must NOT fire the click rhythm ─────────────────────────────────────────────
// The reported failure: a tongue-click rhythm fired on any sound at that pace
// (a laugh). Each beat now carries an acoustic signature; the click beats are
// unvoiced, so voiced bursts at the same tempo are rejected on sound shape.
{
    const tv = bro.gesture.inspect('triple-tap');
    assert(tv && tv.onsets && tv.onsets.length === 3,
           'rhythm exposes a per-beat signature (onsets)');
    assert(tv.onsets.every((o) => o.voiced < 0.5),
           'click beats enrolled as unvoiced (' +
           tv.onsets.map((o) => o.voiced.toFixed(2)).join(',') + ')');

    const onsets0 = bro.sense.snapshot().onsets;
    const spots0  = +document.querySelector('#spotCount').textContent;
    feedPumped(concat(silence(0.4), voicedBursts(3, 0.25, 220, 0.4), silence(0.4)));
    for (let i = 0; i < 25; i++) sleep(20);   // let any (non-)fire deliver
    const onsetsDelta = bro.sense.snapshot().onsets - onsets0;
    assert(onsetsDelta >= 3,
           'the laugh really did produce beats at the tempo (' + onsetsDelta +
           ' onsets) — so the rejection is from sound shape, not a timing miss');
    assert(+document.querySelector('#spotCount').textContent === spots0,
           'a voiced laugh at the click tempo does NOT fire the click rhythm');
    console.log('[listen-lab] shape-gate: ' + onsetsDelta +
                ' onsets at tempo, rhythm not fired (beats voiced ' +
                tv.onsets.map((o) => o.voiced.toFixed(2)).join('/') + ')');
}

// ── 4f. tier-3 transcript: voice-gated Parakeet, rolling realtime ────────────
// bro.sense's voice VAD arms the transcriber; the utterance is pulled from the
// retained shared stream (bro.listen.audio) and committed on voice-end. The
// 2.4 GB model isn't loaded in headless — a synchronous stub runner stands in
// for bro.stt so the VAD-gated LIFECYCLE (arm → pull PCM → commit) is what's
// under test here; the real model path is exercised by the app + parakeet-lab.
{
    let txCalls = 0, lastPcmLen = 0;
    listenLab.installTranscriber((pcm, cb) => {
        txCalls++; lastPcmLen = pcm.length;
        cb.onToken('hello');
        cb.onToken('hello there');
        cb.onDone('hello there', {});
        return { cancel() {} };
    });
    assert(listenLab.Transcribe.ready, 'stub transcriber installed (tier-3 ready)');
    assert(document.querySelector('#transcript'), 'transcript panel present');

    const linesBefore = listenLab.Transcribe.lines.length;
    const heardBefore = feedRows('heard').length;
    // A voiced utterance: VAD rises then (over the trailing silence) falls — that
    // edge arms the tier, rolls partial passes, and commits the final line.
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.5)));
    assert(pumpUntil(() => listenLab.Transcribe.lines.length > linesBefore, 8000),
           'voice-gated transcript committed a line on voice-end');
    assert(txCalls > 0 && lastPcmLen > 0,
           'transcriber was handed real PCM from the retained stream (' + lastPcmLen + ' samples)');
    const line = listenLab.Transcribe.lines[0];
    assert(line.text === 'hello there', 'committed line carries the transcript ("' + line.text + '")');
    assert(line.b > line.a, 'committed line spans the utterance frames (' + line.a + '–' + line.b + ')');
    assert(feedRows('heard').length > heardBefore, '[heard] fusion row rendered for the utterance');

    // The committed line shows in the transcript panel, timestamped.
    assert(pumpUntil(() => document.querySelectorAll('#txLines .txline').length >= 1, 3000),
           'transcript panel rendered the committed line');
    assert(/hello there/.test(document.querySelector('#txLines .txline .tx').textContent),
           'transcript row shows the words');

    // It also dropped a speech marker on the timeline (clickable to inspect; the
    // detail cross-checks what the phoneme model decoded over the SAME span).
    const spEv = listenLab.events.find((e) => e.type === 'speech' && e.name === 'hello there');
    assert(spEv && spEv.span && spEv.span.b > spEv.span.a,
           'speech event landed on the timeline with a matched span');
    listenLab.selectEvent(spEv);
    assert(/model heard here/.test(document.querySelector('#detail').textContent),
           'selecting the speech marker opens its detail panel');
    listenLab.closeDetail();

    // Clicking the committed line binds it to the timeline: scrub there + play +
    // a swept playhead, with the row highlighted as playing.
    document.querySelector('#txLines .txline').click();
    assert(listenLab.Playback.active, 'clicking a transcript line started playback (playhead)');
    assert(listenLab.Playback.key === (line.a + '-' + line.b),
           'playhead bound to the clicked utterance (' + listenLab.Playback.key + ')');
    assert(listenLab.playFrac() >= 0, 'playhead fraction is live');
    assert(!listenLab.View.follow, 'timeline left follow mode to focus the utterance');
    assert(document.querySelector('#txLines .txline.playing'),
           'the clicked line is highlighted as playing');
    listenLab.View.follow = true;     // re-pin live for the remaining sections
    console.log('[listen-lab] transcript: voice-gated commit "' + line.text + '" · ' +
                txCalls + ' passes · ' + lastPcmLen + ' samples · span ' +
                (spEv.span.b - spEv.span.a) + 'f · click→playhead @ ' + listenLab.Playback.key);
}

// ── 4g. streams rack: N independent sources, each configured live ────────────
// The multi-stream payoff generalized: the user adds streams (mic / system /
// a specific app via bro.listen.apps()) and toggles WHICH sensors/actions run on
// each — all concurrent with, and independent of, the mic dashboard above.
//
// Headless has no live mic and (null backend) no loopback, so we drive an added
// MIC stream through stream.feed() — the same one-stream path the host uses, so
// the stream's own sense + kws + transcript see the fed audio.
{
    // (a) the source picker is populated from bro.listen — mic is always offered.
    listenLab.buildSourceOptions();
    const opts = Array.from(document.querySelectorAll('#srcSel option')).map((o) => o.value);
    assert(opts.indexOf('mic') >= 0, 'source picker offers a mic source (' + JSON.stringify(opts) + ')');
    console.log('[listen-lab] picker: ' + opts.length + ' source option(s) · supported=' +
                bro.listen.supported());

    // The mic dashboard (stream #0) is live going in — it must stay untouched.
    assert(bro.sense.isActive() && bro.kws.isActive(), 'mic dashboard live before adding a stream');

    // (b) add a second mic stream and confirm it rendered a card + opened a handle.
    const p = listenLab.addStream({ kind: 'mic' });
    assert(p && p.handle.valid && p.handle.kind === 'mic', 'added mic stream opened a valid handle');
    assert(listenLab.panels.length === 1, 'one stream in the rack');
    const card = Array.from(document.querySelectorAll('.sc')).find((c) =>
        c.querySelector('.scName').textContent.indexOf('#' + p.handle.id) >= 0);
    assert(card, 'stream card rendered for the new stream');
    assert(card.querySelectorAll('.scToggles button').length === 4,
           'card exposes the four action toggles (tier-0 / kws / gestures / transcript)');
    assert(p.handle.sense.isActive(), 'tier-0 sensors on by default for the new stream');
    // The mic side survived the add.
    assert(bro.sense.isActive() && bro.kws.isActive(), 'mic dashboard untouched by the add');
    p.handle.retain(30);                       // capture so we can feed + export

    // helper: feed audio into THIS stream (advances its own sense + kws).
    function feedStream(all) {
        const CHUNK = Math.floor(rate / 40);
        for (let off = 0; off < all.length; off += CHUNK) {
            p.handle.feed(all.subarray(off, Math.min(off + CHUNK, all.length)));
            sleep(15);
        }
    }

    // (c) tier-0: a tone fed into the stream lights its OWN tonality sensor,
    // independent of the mic's bro.sense above.
    feedStream(concat(silence(0.3), tone(0.8, 1300, 0.18), silence(0.3)));
    const ss = p.handle.sense.snapshot();
    assert(ss && ss.tonalEvents >= 1,
           "the stream's own tier-0 sensor counted the tone (events " + (ss ? ss.tonalEvents : 'n/a') + ')');
    console.log('[listen-lab] stream tier-0: tonalEvents=' + ss.tonalEvents + ' onsets=' + ss.onsets);

    // (d) kws action: turning it on mirrors the mic's phrase vocabulary onto the
    // stream's own session over the shared net; a spoken phrase then self-spots.
    listenLab.setPanelAction(p, 'kws', true);
    assert(p.actions.kws && p.handle.kws.templates().indexOf('hello there') >= 0,
           'kws on → mic phrase mirrored onto the stream (' +
           JSON.stringify(p.handle.kws.templates()) + ')');
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.4)));
    assert(pumpUntil(() => feedRows('sys').some((t) =>
        t.indexOf('hello there') >= 0 && t.indexOf('kws') >= 0), 8000),
        'the stream self-spotted the mirrored phrase (tagged [sys] fusion row)');
    console.log('[listen-lab] stream kws: ' +
                feedRows('sys').find((t) => t.indexOf('hello there') >= 0));

    // (e) transcript is single-op: turning it on for the stream TAKES the one
    // transcriber from the primary (the stub installed in 4f still stands in).
    listenLab.setPanelAction(p, 'transcript', true);
    assert(listenLab.Transcribe.source === p.txSource,
           'transcript handed to the stream (it owns the single transcriber)');
    assert(document.querySelector('#txToggle').disabled,
           'primary transcript toggle disabled while a stream owns it');
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => feedRows('sys').some((t) => t.indexOf('transcript') >= 0), 8000),
           'voice-gated transcript on the stream committed (tagged [sys] row)');
    // Hand it back: the primary owns transcript again.
    listenLab.setPanelAction(p, 'transcript', false);
    assert(listenLab.Transcribe.source === listenLab.PrimarySource,
           'turning the stream transcript off returns the transcriber to the primary');
    assert(!document.querySelector('#txToggle').disabled,
           'primary transcript toggle re-enabled after hand-back');
    console.log('[listen-lab] stream transcript: took + returned the single-op transcriber');

    // (f) WAV export: the stream's retained buffer writes a real .wav. The
    // headless seam forces the output path (no native dialog).
    {
        const fs2 = require('fs');
        const tmp = require('os').tmpdir() + '/listen-lab-stream-' + p.handle.id + '.wav';
        listenLab.exportTo(tmp);
        listenLab.saveStreamWav(p);
        listenLab.exportTo(null);
        assert(fs2.existsSync(tmp), 'stream WAV written to disk (' + tmp + ')');
        const buf = fs2.readFileSync(tmp);            // Uint8Array (no encoding)
        const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
        assert(tag(0) === 'RIFF' && tag(8) === 'WAVE',
               'exported file is a RIFF/WAVE container (' + tag(0) + '/' + tag(8) + ')');
        assert(buf.length > 44, 'WAV carries audio past the header (' + buf.length + ' bytes)');
        console.log('[listen-lab] stream wav: ' + buf.length + ' bytes → ' + tmp);
    }

    // (g) primary WAV export from a retained timeline region.
    {
        const tmp = require('os').tmpdir() + '/listen-lab-primary.wav';
        const b = bro.listen.frame(), a = Math.max(bro.listen.frame() - 200, 0);
        listenLab.exportTo(tmp);
        const path = listenLab.exportWav(bro.listen.audio(a, b), bro.listen.info().rate, 'x.wav');
        listenLab.exportTo(null);
        assert(path === tmp && require('fs').existsSync(tmp), 'primary region exported to a .wav');
        console.log('[listen-lab] primary wav: exported region → ' + tmp);
    }

    // (h) remove the stream: its card + handle go, the mic dashboard is unaffected.
    listenLab.removeStream(p);
    assert(listenLab.panels.length === 0, 'stream removed from the rack');
    assert(!Array.from(document.querySelectorAll('.sc')).some((c) =>
        c.querySelector('.scName').textContent.indexOf('#' + p.handle.id) >= 0),
        'stream card removed');
    assert(bro.sense.isActive() && bro.kws.isActive(),
           'removing the stream left the mic dashboard live (independent streams)');
    console.log('[listen-lab] rack: add → configure (tier-0/kws/transcript) → export → remove · mic untouched');
}

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
