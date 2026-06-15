// Listen Lab — headless smoke test. Boot arms both tiers on the shared listen
// host; synthetic audio fed through bro.kws.feed() (ONE stream — it advances
// bro.sense too) must light every sensor family and land the right rows in
// the mic tab's fusion feed: [tonal] for a sustained tone, [onset] for a click
// train, [voice]/[arm]/[spot] for a spoken enrolled phrase, and a rhythm gesture
// must self-fire on its own clip. Then the stream TABS: adding a source opens a
// full, identical dashboard with its own history/kws/transcript, concurrent with
// the mic. Finally the i18n tier: a non-English transcript carries its detected
// language, the speaker encoder + online clustering tag who spoke, and bro.lm
// renders an English line — all stubbed so the WIRING is what's tested.
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

// ── boot: both tiers live, mic = tab #0 ──────────────────────────────────────

assert(pumpUntil(() => bro.sense.isActive(), 30000), 'sense live at boot');
assert(pumpUntil(() => bro.kws.isLoaded() && bro.kws.isActive(), 30000), 'kws live at boot');
assert(pumpUntil(() => document.querySelectorAll('.tmpl').length === 1, 5000),
       'seed template row rendered');
assert(pumpUntil(() => document.querySelectorAll('#tabStrip .tab').length === 1, 5000),
       'the mic tab is present');
assert(listenLab.streams().length === 1 && listenLab.active().kind === 'mic',
       'the mic is the only (active) tab at boot');

const rate = bro.kws.sampleRate();

// ── synthesis helpers ────────────────────────────────────────────────────────

function silence(sec) { return new Float32Array(Math.floor(sec * rate)); }

function tone(sec, hz, amp) {
    const n = Math.floor(sec * rate), fade = Math.floor(0.01 * rate);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const g = i >= n - fade ? (n - i) / fade : 1;
        s[i] = g * amp * Math.sin(2 * Math.PI * hz * i / rate);
    }
    return s;
}

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
// only runs while frames pump) observes the INTERMEDIATE states (that's what
// makes the [arm] row reachable mid-phrase). Drives the MIC (bro.kws.feed).
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

// ── 4b. timeline: per-stream history ring, events logged, click-to-inspect ───

const ring = listenLab.ring();             // the ACTIVE (mic) tab's history ring
assert(ring.count > 100, 'stream history ring accumulated frames (' + ring.count + ')');
const gestEv = listenLab.events().find((e) => e.type === 'gesture' && e.name === 'triple-tap');
assert(gestEv, 'gesture fire landed in the timeline event log');
assert(gestEv.frame > 0 && gestEv.conf > 0.9, 'event carries its frame + confidence');
const spotEv = listenLab.events().find((e) => e.type === 'spot' && e.name === 'hello there');
assert(spotEv, 'phrase spot landed in the timeline event log');

assert(gestEv.span && gestEv.span.b > gestEv.span.a && gestEv.span.b === gestEv.frame,
       'gesture event carries an exact matched span ending at the fire frame');
assert(spotEv.span && spotEv.span.b > spotEv.span.a && spotEv.span.b === spotEv.frame,
       'spot event carries an exact matched span (' + JSON.stringify(spotEv.span) + ')');
const heardExact = listenLab.decodedOver(spotEv.span.a, spotEv.span.b);
assert(heardExact.length >= 2,
       'decoded phonemes over the exact spot span (' + JSON.stringify(heardExact) + ')');
console.log('[listen-lab] spans: gesture ' + (gestEv.span.b - gestEv.span.a) +
            'f · spot ' + (spotEv.span.b - spotEv.span.a) + 'f heard ' +
            JSON.stringify(heardExact));

// Stream retention: raw audio that drove a match is replayable by frame range.
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
assert(bro.listen.audio(bro.listen.frame() + 10000, bro.listen.frame() + 20000) === null,
       'audio() returns null outside the retained window');
console.log('[listen-lab] retention: held ' + rInfo.heldSeconds.toFixed(1) + ' s · spot clip ' +
            clip.length + ' samples · energy ' + clipEnergy.toFixed(2));

// tier-1: the phoneme ring captured what the model decoded during the phrase.
let phFrames = 0;
for (let i = 0; i < ring.count; i++) {
    if (ring.phCls[ring.slot(i)] > 0) phFrames++;
}
assert(phFrames > 5, 'phoneme ring captured decoded frames (' + phFrames + ')');
const heardSeq = listenLab.decodedOver(spotEv.frame - 80, spotEv.frame);
assert(heardSeq.length >= 1,
       'decodedOver yields the heard phonemes near the spot (' + JSON.stringify(heardSeq) + ')');
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
assert(listenLab.view().selRegion && listenLab.view().selRegion.b === gestEv.frame,
       'selection highlights the matched region ending at the fire frame');
listenLab.closeDetail();
assert(detailEl.classList.contains('hidden'), 'detail panel closes');
console.log('[listen-lab] timeline: ' + ring.count + ' frames · ' +
            listenLab.events().length + ' events · detail inspect ok');

// ── 4c. clip editor: retained clip, offline analysis, tone stability gate ────

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

listenLab.enrollGesture('whistle', whistleClip);
const wv = bro.gesture.inspect('whistle');
assert(wv && wv.kind === 'tone', 'whistle enrolled as a tone gesture');
assert(typeof wv.toneSpread === 'number' && wv.toneSpread < 0.05,
       'a clean whistle enrolls as a steady pitch (spread ' + wv.toneSpread.toFixed(3) + ')');
assert(pumpUntil(() => Array.from(document.querySelectorAll('.gest')).some((r) =>
    r.querySelector('.gname').textContent === 'whistle' &&
    !r.querySelector('.edit').disabled), 5000),
    'whistle row has an enabled edit button (clip retained)');

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

{
    const before = +document.querySelector('#spotCount').textContent;
    feedPumped(concat(silence(0.4), whistleClip, silence(0.4)));
    assert(pumpUntil(() => +document.querySelector('#spotCount').textContent > before, 6000),
           'steady whistle self-fires the tone gesture');
}
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
    for (let i = 0; i < 30; i++) sleep(20);
    assert(+document.querySelector('#spotCount').textContent === before,
           'a swept-pitch cough does NOT fire the whistle (stability gate)');
    console.log('[listen-lab] stability: steady whistle fires, swept cough rejected');
}

{
    const r = Array.from(document.querySelectorAll('.gest')).find((x) =>
        x.querySelector('.gname').textContent === 'whistle');
    if (r) r.querySelector('.rm').click();
}

// ── 4d. volume + scratch-pad ──────────────────────────────────────────────────

{
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
    Array.from(document.querySelectorAll('.gest')).find((r) =>
        r.querySelector('.gname').textContent === 'vol-test').querySelector('.rm').click();
}

{
    const before = bro.listen.frame();
    feedPumped(concat(silence(0.3), tone(0.7, 1400, 0.2), silence(0.3)));
    const after = bro.listen.frame();
    assert(after > before, 'stream advanced for the scratch source (' + before + '→' + after + ')');
    listenLab.view().scratchSel = { a: before + 35, b: after - 35 };
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
    assert(listenLab.view().scratchSel === null, 'scratch selection cleared after promotion');
    assert(pumpUntil(() => {
        const r = Array.from(document.querySelectorAll('.gest')).find((x) =>
            x.querySelector('.gname').textContent === 'from-timeline');
        return r && r.querySelector('.gwave');
    }, 3000), 'the new gesture opened in the clip editor');
    const fv = bro.gesture.inspect('from-timeline');
    console.log('[listen-lab] scratch: clipped ' + (c.length / rate).toFixed(2) +
                ' s off the timeline → gesture (' + (fv ? fv.kind : '?') + ')');
    Array.from(document.querySelectorAll('.gest')).find((r) =>
        r.querySelector('.gname').textContent === 'from-timeline').querySelector('.rm').click();
}

// ── 4e. rhythm sound-shape gate: a voiced "laugh" at the click tempo ──────────

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
    for (let i = 0; i < 25; i++) sleep(20);
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

// ── 4f. tier-3 transcript: voice-gated Qwen3-ASR, rolling realtime (mic tab) ──
// A synchronous stub stands in for the GPU model so the VAD-gated LIFECYCLE
// (arm → pull PCM → commit) is what's under test; the real model path is
// exercised by the app + _e2e_i18n.js.
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

    const micSt = listenLab.active();
    const linesBefore = micSt.txLines.length;
    const heardBefore = feedRows('heard').length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.5)));
    assert(pumpUntil(() => micSt.txLines.length > linesBefore, 8000),
           'voice-gated transcript committed a line on voice-end');
    assert(txCalls > 0 && lastPcmLen > 0,
           'transcriber was handed real PCM from the retained stream (' + lastPcmLen + ' samples)');
    const line = micSt.txLines[0];
    assert(line.text === 'hello there', 'committed line carries the transcript ("' + line.text + '")');
    assert(line.b > line.a, 'committed line spans the utterance frames (' + line.a + '–' + line.b + ')');
    assert(feedRows('heard').length > heardBefore, '[heard] fusion row rendered for the utterance');

    assert(pumpUntil(() => document.querySelectorAll('#txLines .txline').length >= 1, 3000),
           'transcript panel rendered the committed line');
    assert(/hello there/.test(document.querySelector('#txLines .txline .tx').textContent),
           'transcript row shows the words');

    const spEv = listenLab.events().find((e) => e.type === 'speech' && e.name === 'hello there');
    assert(spEv && spEv.span && spEv.span.b > spEv.span.a,
           'speech event landed on the timeline with a matched span');
    listenLab.selectEvent(spEv);
    assert(/model heard here/.test(document.querySelector('#detail').textContent),
           'selecting the speech marker opens its detail panel');
    listenLab.closeDetail();

    document.querySelector('#txLines .txline').click();
    assert(listenLab.playback().active, 'clicking a transcript line started playback (playhead)');
    assert(listenLab.playback().key === (line.a + '-' + line.b),
           'playhead bound to the clicked utterance (' + listenLab.playback().key + ')');
    assert(listenLab.playFrac() >= 0, 'playhead fraction is live');
    assert(!listenLab.view().follow, 'timeline left follow mode to focus the utterance');
    assert(document.querySelector('#txLines .txline.playing'),
           'the clicked line is highlighted as playing');
    listenLab.view().follow = true;
    console.log('[listen-lab] transcript: voice-gated commit "' + line.text + '" · ' +
                txCalls + ' passes · ' + lastPcmLen + ' samples · span ' +
                (spEv.span.b - spEv.span.a) + 'f · click→playhead @ ' + listenLab.playback().key);
}

// ── 4g. stream tabs: every source is a full, identical dashboard ──────────────
// The mic is tab #0; adding a source opens a new tab with the SAME full stack
// (tier-0 + kws + gestures + transcript) over its own unmixed stream. Headless
// has no live mic / loopback, so we drive an added MIC stream via stream.feed().
{
    listenLab.buildSourceOptions();
    const opts = Array.from(document.querySelectorAll('#srcSel option')).map((o) => o.value);
    assert(opts.indexOf('mic') >= 0, 'source picker offers a mic source (' + JSON.stringify(opts) + ')');
    console.log('[listen-lab] picker: ' + opts.length + ' source option(s) · supported=' +
                bro.listen.supported());

    const micSt = listenLab.active();
    const micLinesBefore = micSt.txLines.length;
    assert(listenLab.streams().length === 1, 'one tab (the mic) before adding');
    assert(bro.sense.isActive() && bro.kws.isActive(), 'mic dashboard live before adding a stream');

    // (a) add a second mic stream → a new tab, switched to, with the full stack.
    const st = listenLab.addStream({ kind: 'mic' });
    assert(st && st.source.handle.valid && st.kind === 'mic', 'added mic stream opened a valid handle');
    assert(listenLab.streams().length === 2, 'two tabs now');
    assert(listenLab.active() === st, 'adding a stream switches to its tab');
    const tabs = Array.from(document.querySelectorAll('#tabStrip .tab'));
    assert(tabs.length === 2 && tabs[1].classList.contains('active'),
           'the tab strip shows both streams, the new one active');
    assert(st.source.sense.isActive(), 'the stream runs its own tier-0 sensors');
    assert(bro.sense.isActive() && bro.kws.isActive(), 'mic stream untouched by the add');
    st.source.handle.retain(60);

    function feedStream(all) {
        const CHUNK = Math.floor(rate / 40);
        for (let off = 0; off < all.length; off += CHUNK) {
            st.source.handle.feed(all.subarray(off, Math.min(off + CHUNK, all.length)));
            sleep(15);
        }
    }

    // (b) tier-0 on the stream's OWN dashboard: a tone lights its sensor + ring.
    feedStream(concat(silence(0.3), tone(0.8, 1300, 0.18), silence(0.3)));
    const ss = st.source.sense.snapshot();
    assert(ss && ss.tonalEvents >= 1, "the stream's own tier-0 sensor counted the tone");
    assert(listenLab.ring() === st.ring && st.ring.count > 40,
           "the active timeline shows the stream's own history (" + st.ring.count + ' frames)');
    assert(feedRows('tonal').length >= 1, "the stream's feed shows its own tonal event");
    console.log('[listen-lab] stream tier-0: ring ' + st.ring.count + ' frames · tonalEvents=' + ss.tonalEvents);

    // (c) kws: the mic's vocabulary was mirrored; a spoken phrase self-spots here.
    assert(st.source.kws.templates().indexOf('hello there') >= 0,
           'mic phrase mirrored onto the stream session');
    const stSpots0 = st.spots;
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.4)));
    assert(pumpUntil(() => st.spots > stSpots0, 8000), 'the stream self-spotted the mirrored phrase');
    assert(feedRows('spot').some((t) => t.indexOf('hello there') >= 0),
           "the spot landed on the stream's own feed");
    console.log('[listen-lab] stream kws: ' + feedRows('spot').find((t) => t.indexOf('hello there') >= 0));

    // (d) transcript runs CONCURRENTLY: the stream transcribes its own audio AND
    // the mic still transcribes — no stealing (the 4f stub stands in for the model).
    const stTxBefore = st.txLines.length;
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => st.txLines.length > stTxBefore, 8000),
           "the stream's own voice-gated transcript committed a line");
    assert(/hello there/.test(document.querySelector('#txLines .txline .tx').textContent),
           "the active (stream) transcript panel shows the line");
    listenLab.switchTab(0);
    assert(listenLab.active() === micSt, 'switched back to the mic tab');
    assert(listenLab.ring() === micSt.ring && micSt.ring !== st.ring,
           'each stream keeps its own independent history ring');
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => micSt.txLines.length > micLinesBefore, 8000),
           'the mic transcript still commits while a stream also transcribes (no steal)');
    console.log('[listen-lab] concurrent transcript: stream + mic both committed (no steal)');

    // (e) WAV export: the stream's retained buffer writes a real RIFF/WAVE file.
    {
        const fs2 = require('fs');
        const tmp = require('os').tmpdir() + '/listen-lab-stream-' + st.id + '.wav';
        listenLab.exportTo(tmp);
        listenLab.saveStreamWav(st);
        listenLab.exportTo(null);
        assert(fs2.existsSync(tmp), 'stream WAV written to disk (' + tmp + ')');
        const buf = fs2.readFileSync(tmp);            // Uint8Array (no encoding)
        const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
        assert(tag(0) === 'RIFF' && tag(8) === 'WAVE',
               'exported file is a RIFF/WAVE container (' + tag(0) + '/' + tag(8) + ')');
        assert(buf.length > 44, 'WAV carries audio past the header (' + buf.length + ' bytes)');
        console.log('[listen-lab] stream wav: ' + buf.length + ' bytes → ' + tmp);
    }

    // (f) primary WAV export from a retained timeline region (mic active).
    {
        const tmp = require('os').tmpdir() + '/listen-lab-primary.wav';
        const b = bro.listen.frame(), a = Math.max(bro.listen.frame() - 200, 0);
        listenLab.exportTo(tmp);
        const path = listenLab.exportWav(bro.listen.audio(a, b), bro.listen.info().rate, 'x.wav');
        listenLab.exportTo(null);
        assert(path === tmp && require('fs').existsSync(tmp), 'primary region exported to a .wav');
        console.log('[listen-lab] primary wav: exported region → ' + tmp);
    }

    // (g) close the stream tab → back to one tab, mic dashboard intact.
    listenLab.removeStream(st);
    assert(listenLab.streams().length === 1, 'stream tab closed');
    assert(listenLab.active() === micSt, 'closing the active stream falls back to the mic tab');
    assert(document.querySelectorAll('#tabStrip .tab').length === 1, 'tab strip back to one tab');
    assert(bro.sense.isActive() && bro.kws.isActive(),
           'closing the stream left the mic dashboard live (independent streams)');
    console.log('[listen-lab] tabs: add → own dashboard (tier-0/kws/transcript) → export → close · mic intact');
}

// ── 4h. non-English transcription + diarization + translation ─────────────────
// Qwen3-ASR yields a SOURCE-language transcript + a detected language; the speaker
// encoder + online cosine clustering tag who spoke; bro.lm renders an English line
// for non-English speech. Stubs stand in for all three GPU models so the WIRING
// (language badge, speaker chips, translation row, per-stream speaker sets) is
// what's under test — the real model path is exercised by the app.
{
    const micSt = listenLab.active();
    assert(micSt.kind === 'mic', 'mic tab active for the i18n test');

    // (a) transcriber stub → a Spanish line carrying its detected language.
    let asrText = 'hola mundo', asrLang = 'Spanish';
    listenLab.installTranscriber((pcm, cb) => {
        cb.onToken(asrText);
        cb.onDone(asrText, { lang: asrLang });
        return { cancel() {} };
    });
    // (b) diarizer stub → a controllable 1024-D x-vector per utterance.
    const DIM = 1024;
    const basis = (k) => { const v = new Float32Array(DIM); v[k] = 1; return v; };
    let spkVec = basis(0);
    listenLab.installDiarizer((pcm) => spkVec);
    // (c) translator stub → deterministic English for the Spanish line.
    listenLab.installTranslator((text, lang) => 'hello world');

    // Utterance 1 — speaker A, Spanish.
    spkVec = basis(0);
    const n0 = micSt.txLines.length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => micSt.txLines.length > n0, 8000), 'foreign line committed');
    const l1 = micSt.txLines[0];
    assert(l1.lang.toLowerCase() === 'spanish', 'line carries the detected language ("' + l1.lang + '")');
    assert(l1.text === 'hola mundo', 'line carries the source-language transcript');
    assert(pumpUntil(() => l1.speaker > 0, 3000), 'utterance assigned a speaker (' + l1.speaker + ')');
    const spkA = l1.speaker;
    assert(pumpUntil(() => l1.en === 'hello world', 3000), 'non-English line got an English translation');

    // UI: language badge, speaker chip, and the English sub-line all render.
    assert(pumpUntil(() => document.querySelector('#txLines .txline .lang'), 3000),
           'transcript row shows the language badge');
    assert(document.querySelector('#txLines .txline .lang').textContent.toLowerCase() === 'spanish',
           'badge names the language');
    assert(document.querySelector('#txLines .txline .spk'), 'transcript row shows a speaker chip');
    assert(/hello world/.test(document.querySelector('#txLines .txline .txen').textContent),
           'transcript row shows the English translation line');
    assert(feedRows('xlate').some((t) => /hello world/.test(t)), '[xlate] fusion row rendered');
    assert(feedRows('spk').length >= 1, '[spk] fusion row rendered');

    // Utterance 2 — a DIFFERENT voice → a second speaker discovered.
    spkVec = basis(7);
    const n1 = micSt.txLines.length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => micSt.txLines.length > n1, 8000), 'second foreign line committed');
    const l2 = micSt.txLines[0];
    assert(pumpUntil(() => l2.speaker > 0, 3000), 'second utterance assigned a speaker');
    assert(l2.speaker !== spkA,
           'a distinct voice clustered to a NEW speaker (' + spkA + ' vs ' + l2.speaker + ')');

    // Utterance 3 — speaker A returns → SAME id (clustering, not a new speaker).
    spkVec = basis(0);
    const n2 = micSt.txLines.length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => micSt.txLines.length > n2, 8000), 'third line committed');
    const l3 = micSt.txLines[0];
    assert(pumpUntil(() => l3.speaker > 0, 3000), 'third utterance assigned a speaker');
    assert(l3.speaker === spkA, 'the returning voice re-used speaker ' + spkA + ' (online clustering)');
    assert(micSt.speakers.length === 2,
           'exactly two speakers discovered on this stream (' + micSt.speakers.length + ')');

    // (d) an English line skips BOTH the language badge and translation.
    asrText = 'hello there'; asrLang = 'English';
    const n3 = micSt.txLines.length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    assert(pumpUntil(() => micSt.txLines.length > n3, 8000), 'English line committed');
    assert(micSt.txLines[0].en === null, 'an English line is not translated');

    console.log('[listen-lab] i18n: "' + l1.text + '" [' + l1.lang + '] → "' + l1.en +
                '" · speakers A=' + spkA + ' B=' + l2.speaker + ' (A reused) · ' +
                micSt.speakers.length + ' voices on the stream');
}

// ── 4i. streaming sentence chunker: seal sentences mid-utterance ──────────────
// Continuous speech never falls silent, so the transcript seals COMPLETE sentences
// out of the rolling partial and advances the window past them (bounded re-decode)
// instead of waiting for voice-end. Drive the chunker directly over a real retained
// window so the seal logic is deterministic (no dependence on VAD timing): a
// sentence seals only once it's stable across two passes and has trailing text.
{
    const micSt = listenLab.active();
    assert(micSt.kind === 'mic', 'mic tab active for the chunker test');
    listenLab.installTranslator((text, lang) => '[en] ' + text);   // deterministic English

    const ctx = micSt.txCtx;
    const b = bro.listen.frame(), a = Math.max(ctx.oldest() + 5, b - 400);
    assert(b - a > 60, 'a real retained window to anchor sentence cuts in (' + (b - a) + ' frames)');

    // Open an utterance window with no seals yet.
    ctx.tx.active = true; ctx.tx.lang = 'Spanish';
    ctx.tx.startFrame = a; ctx.tx.sealedFrame = a; ctx.tx.prevPartial = '';

    const n0 = micSt.txLines.length;
    listenLab.sealSentences(ctx, 'Uno dos tres. palabra', a, b);   // first sighting — not yet stable
    assert(micSt.txLines.length === n0,
           'a sentence seen for the first time does NOT seal (needs 2 stable passes)');
    listenLab.sealSentences(ctx, 'Uno dos tres. palabra', a, b);   // stable + trailing text → seal
    assert(micSt.txLines.length === n0 + 1, 'a stable complete sentence sealed mid-utterance');
    const sealed = micSt.txLines[0];
    assert(sealed.text === 'Uno dos tres.', 'sealed line carries the sentence ("' + sealed.text + '")');
    assert(sealed.lang.toLowerCase() === 'spanish', 'sealed line carries the detected language');
    assert(sealed.b > sealed.a && sealed.a === a, 'sealed line spans from the utterance start to the cut');
    assert(ctx.tx.startFrame > a && ctx.tx.startFrame === ctx.tx.sealedFrame,
           'the re-transcribe window advanced past the sealed audio (now bounded)');
    assert(pumpUntil(() => sealed.en === '[en] Uno dos tres.', 3000),
           'the sealed sentence got an English translation');

    // A second sentence seals from the ADVANCED window — proving the stream keeps
    // moving without a pause, each sentence its own line.
    const aa = ctx.tx.startFrame, n1 = micSt.txLines.length;
    listenLab.sealSentences(ctx, 'Cuatro cinco. palabra', aa, b);
    listenLab.sealSentences(ctx, 'Cuatro cinco. palabra', aa, b);
    assert(micSt.txLines.length === n1 + 1, 'a second sentence sealed from the advanced window');
    assert(micSt.txLines[0].text === 'Cuatro cinco.', 'second sealed sentence committed');
    assert(ctx.tx.startFrame > aa, 'the window advanced again past the second cut');
    console.log('[listen-lab] chunker: sealed 2 sentences mid-utterance · window ' +
                a + '→' + ctx.tx.startFrame + ' (bounded, never waited for voice-end)');

    ctx.tx.active = false; ctx.tx.prevPartial = '';   // don't leak utterance state into teardown
}

// ── 4j. correctness tier: context-aware, scene-segmented re-translation ───────
// The fast tier (NLLB stub) translates each sentence in isolation; the slow
// correctness tier (Qwen3-1.7B in the app) re-translates it with the running,
// speaker-tagged dialogue as CONTEXT, replacing the line when it improves. Stub
// the correctness model with a function that ECHOES the dialogue it was handed,
// so the test can prove (a) it fires and marks the line refined, (b) it is given
// MORE information than the fast tier — speaker labels + neighbouring lines, the
// target marked ► — (c) a line is re-refined once its successor lands (the
// following context can only sharpen it), and (d) a scene cut (long silence gap)
// bounds the context so dialogue never bleeds across it.
{
    const micSt = listenLab.active();
    let lastDialogue = '';
    listenLab.installRefiner((text, lang, dialogue) => {
        lastDialogue = dialogue;
        return 'CTX(' + dialogue.split('\n').length + '): ' + text;   // # of context lines fed
    });
    listenLab.installTranslator((text, lang) => '[en] ' + text);      // fast tier (NLLB stub)

    const ctx = micSt.txCtx;
    const b = bro.listen.frame(), a = Math.max(ctx.oldest() + 5, b - 400);
    assert(b - a > 60, 'a real retained window for the correctness test (' + (b - a) + ' frames)');
    ctx.tx.active = true; ctx.tx.lang = 'Japanese';
    ctx.tx.startFrame = a; ctx.tx.sealedFrame = a; ctx.tx.prevPartial = '';
    micSt._lastB = a - (350 + 50);      // open a FRESH scene (gap > SCENE_GAP) — no prior-section bleed

    // Sentence 1 (two stable passes → seal), pretend-diarized to speaker 1.
    listenLab.sealSentences(ctx, 'Sentence uno. mas', a, b);
    listenLab.sealSentences(ctx, 'Sentence uno. mas', a, b);
    const ln1 = micSt.txLines[0];
    assert(ln1.text === 'Sentence uno.', 'line 1 sealed for the correctness test');
    ln1.speaker = 1;
    assert(pumpUntil(() => ln1.refined && /^CTX\(/.test(ln1.en || ''), 3000),
           'line 1 was re-translated by the correctness tier ("' + ln1.en + '")');
    assert(ln1.en === 'CTX(1): Sentence uno.',
           'line 1, alone in its scene, got 1 line of context ("' + ln1.en + '")');

    // Sentence 2 from the ADVANCED window → same scene (contiguous), speaker 2.
    const aa = ctx.tx.startFrame;
    listenLab.sealSentences(ctx, 'Sentence dos. mas', aa, b);
    listenLab.sealSentences(ctx, 'Sentence dos. mas', aa, b);
    const ln2 = micSt.txLines[0];
    assert(ln2.text === 'Sentence dos.', 'line 2 sealed');
    ln2.speaker = 2;
    assert(ln2.scene === ln1.scene, 'contiguous sentences share a scene (no gap)');
    // ln2 refines WITH ln1 as prior context; ln1 re-refines WITH ln2 as following
    // context — both now see 2 lines. (Progressive: ln1 went 1→2 lines of context.)
    assert(pumpUntil(() => ln2.en === 'CTX(2): Sentence dos.', 3000),
           'line 2 refined with its neighbour as context ("' + ln2.en + '")');
    assert(pumpUntil(() => ln1.en === 'CTX(2): Sentence uno.', 3000),
           'line 1 was RE-refined once line 2 arrived (progressive, "' + ln1.en + '")');

    // Re-run the context pass now BOTH turns are diarized, to inspect the
    // speaker-tagged dialogue the model is handed (the stub captures it).
    listenLab.refine(micSt, ln2);
    assert(pumpUntil(() => /S1:/.test(lastDialogue) && /S2:/.test(lastDialogue), 3000),
           'dialogue not refreshed with both speakers');
    // The dialogue handed to the model is speaker-tagged with the target marked ►.
    assert(/►/.test(lastDialogue), 'the correctness model is told which line to translate (►)');
    assert(/S1:/.test(lastDialogue) && /S2:/.test(lastDialogue),
           'the dialogue carries speaker labels for both turns:\n' + lastDialogue);

    // Scene cut: a long silence gap before the next line starts a NEW scene, so
    // the prior conversation is NOT fed as context (it bounds the window).
    const cutLineB = micSt.txLines[0].b;
    micSt._lastB = cutLineB - (350 + 50);            // force gap > SCENE_GAP at the next seal
    const aac = ctx.tx.startFrame;
    listenLab.sealSentences(ctx, 'Sentence tres. mas', aac, b);
    listenLab.sealSentences(ctx, 'Sentence tres. mas', aac, b);
    const ln3 = micSt.txLines[0];
    assert(ln3.text === 'Sentence tres.', 'post-cut line sealed');
    assert(ln3.scene !== ln2.scene, 'a long gap started a new scene (' + ln2.scene + '→' + ln3.scene + ')');
    assert(pumpUntil(() => ln3.en === 'CTX(1): Sentence tres.', 3000),
           'the post-cut line is translated alone — context did not bleed across the cut ("' + ln3.en + '")');

    console.log('[listen-lab] correctness: NLLB fast → Qwen-style context refine · ' +
                'ln1 ctx grew 1→2 lines (progressive) · scene cut at gap > SCENE_GAP isolated ln3');

    ctx.tx.active = false; ctx.tx.prevPartial = '';
    listenLab.Refine.ready = false;                   // stop the correctness tier for later sections
}

// ── 5. remove the gesture via its × button while live ────────────────────────

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
