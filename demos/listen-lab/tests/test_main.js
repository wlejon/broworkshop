// Listen Lab headless test. Boot arms both tiers on the shared listen host;
// synthetic audio fed through bro.kws.feed() (ONE stream: it advances
// bro.sense too) must light every sensor family and land the right rows in the
// mic tab's fusion feed: [tonal] for a sustained tone, [onset] for a click
// train, [voice]/[arm]/[spot] for a spoken enrolled phrase, and a rhythm
// gesture must self-fire on its own clip. Then the stream TABS: adding a
// source opens a full, identical dashboard with its own history/kws/transcript,
// concurrent with the mic. Finally the i18n tier: a non-English transcript
// carries its detected language, the speaker encoder + online clustering tag
// who spoke, and bro.lm renders an English line, all stubbed so the WIRING is
// what's tested.
// Run: scripts/validate.sh --ml demos/listen-lab
import { check, pumpUntil, test, done, shot } from "/lib/kit/test.js";
import { signal, resample } from "/lib/kit/audio.js";
import { requireWeights } from "/lib/kit/weights.js";
import { lab } from "/app/lab.js";

const KOKORO_DIR = requireWeights('Kokoro', ['brosoundml/weights/kokoro'], { probe: 'config.json' });

// ── boot: both tiers live, mic = tab #0 ─────────────────────────────────────

check(pumpUntil(() => bro.sense.isActive(), 30000), 'sense live at boot');
check(pumpUntil(() => bro.kws.isLoaded() && bro.kws.isActive(), 30000), 'kws live at boot');
check(pumpUntil(() => document.querySelectorAll('.tmpl').length === 1, 5000), 'seed template row rendered');
check(pumpUntil(() => document.querySelectorAll('#tabStrip .tab').length === 1, 5000), 'the mic tab is present');
check(lab.streams().length === 1 && lab.active().kind === 'mic', 'the mic is the only (active) tab at boot');

const rate = bro.kws.sampleRate();
const silence = (sec) => signal.silence(sec, rate);
const tone = (sec, hz, amp) => signal.tone(sec, hz, amp, rate);
const clicks = (n, gapSec, amp) => signal.clicks(n, gapSec, amp, rate);
const concat = signal.concat;
const voicedBursts = (n, gapSec, hz, amp) => {
    const parts = [];
    for (let k = 0; k < n; k++) parts.push(tone(0.12, hz, amp), silence(Math.max(0, gapSec - 0.12)));
    return concat(...parts);
};

const kokoro = bro.tts.loadKokoro(KOKORO_DIR);
const voice = kokoro.loadVoice(KOKORO_DIR + '/voices/af_bella.bin');
function speak(text) {
    const res = kokoro.synthesize(bro.tts.phonemize(text), voice);
    return resample(res.samples, res.sampleRate, rate);
}

// Feed in 50 ms chunks with a pump after each, so the app's poll loop (RAF,
// which only runs while frames pump) observes the INTERMEDIATE states: that is
// what makes the [arm] row reachable mid-phrase. Drives the MIC (bro.kws.feed).
function feedPumped(all) {
    const CHUNK = Math.floor(rate / 40);
    for (let off = 0; off < all.length; off += CHUNK) {
        bro.kws.feed(all.subarray(off, Math.min(off + CHUNK, all.length)));
        sleep(15);
    }
}

function feedRows(kind) {
    return Array.from(document.querySelectorAll('#feed .row'))
        .filter((r) => r.querySelector('.kind').textContent === kind)
        .map((r) => r.querySelector('.txt').textContent);
}
const spotCount = () => +document.querySelector('#spotCount').textContent;
const gestRow = (name) => Array.from(document.querySelectorAll('.gest'))
    .find((r) => r.querySelector('.gname').textContent === name);
const settle = (n) => { for (let i = 0; i < n; i++) sleep(20); };

// ── 1-3. tier-0 sensors and the seeded phrase, on the mic ───────────────────

test('sustained tone -> tonality sensor + [tonal] row', () => {
    feedPumped(concat(silence(0.3), tone(1.0, 1200, 0.15), silence(0.3)));
    const s1 = bro.sense.snapshot();
    check(s1.tonalEvents >= 1, 'tonality sensor counted the tone (events ' + s1.tonalEvents + ')');
    check(pumpUntil(() => feedRows('tonal').length >= 1, 5000), '[tonal] fusion row rendered');
    check(feedRows('tonal').some((t) => /~1[12]\d\d Hz/.test(t)),
        '[tonal] row names a frequency near 1200 Hz (' + JSON.stringify(feedRows('tonal')) + ')');
});

test('click train -> onset sensor + [onset] row + card', () => {
    const onsets0 = bro.sense.snapshot().onsets;
    feedPumped(concat(silence(0.3), clicks(5, 0.2, 0.5), silence(0.3)));
    const delta = bro.sense.snapshot().onsets - onsets0;
    check(delta >= 3, 'onset sensor caught the clicks (' + delta + '/5)');
    check(pumpUntil(() => feedRows('onset').length >= 1, 5000), '[onset] fusion row rendered');
    check(pumpUntil(() => +document.querySelector('#onsetTxt').textContent >= onsets0 + 3, 5000), 'onset card counter updated');
});

test('spoken phrase -> [voice], mid-phrase [arm], [spot], progress', () => {
    feedPumped(concat(silence(0.5), speak('hello there'), silence(0.4)));
    check(pumpUntil(() => feedRows('spot').some((t) => t.indexOf('hello there') >= 0), 10000),
        '[spot] fusion row for the seeded phrase');
    check(feedRows('voice').length >= 1, '[voice] fusion rows from the utterance');
    check(feedRows('arm').some((t) => t.indexOf('hello there') >= 0),
        '[arm] row fired mid-phrase, before the spot (' + JSON.stringify(feedRows('arm')) + ')');
    const pt = bro.kws.progress().templates.find((t) => t.name === 'hello there');
    check(pt && pt.completions >= 1, 'progress() counted the completion');
    check(pumpUntil(() => spotCount() >= 1, 5000), 'statusbar spot count updated');
});

test('token panel: inspect + edit the seeded phrase', () => {
    const seedRow = Array.from(document.querySelectorAll('.tmpl'))
        .find((r) => r.querySelector('.tname').textContent === 'hello there');
    check(seedRow, 'seed row present for token inspect');
    seedRow.querySelector('.tok').click();
    const chips = seedRow.querySelectorAll('.tokens .chip');
    check(chips.length >= 3, 'token panel shows the decoded phonemes (' + chips.length + ')');
    check(Array.from(chips).every((c) => c.textContent.replace('×', '').trim().length), 'every chip carries a phoneme label');
    const before = bro.kws.inspect('hello there').states.length;
    seedRow.querySelector('.tokens .chip .x').click();
    seedRow.querySelector('.tokens .tokedit button').click();   // "apply edit"
    check(pumpUntil(() => {
        const v = bro.kws.inspect('hello there');
        return v && v.states.length === before - 1;
    }, 5000), 'apply edit re-enrolled the trimmed token sequence');
    check(bro.kws.isActive(), 'listening resumed after the token edit');
});

// ── 4. tier-0 gestures ──────────────────────────────────────────────────────

const clickTrain = concat(silence(0.3), clicks(3, 0.25, 0.6), silence(0.3));

test('a click rhythm enrolls and self-fires', () => {
    lab.enrollGesture('triple-tap', clickTrain);
    check(bro.gesture.templates().indexOf('triple-tap') >= 0, 'gesture enrolled');
    const gv = bro.gesture.inspect('triple-tap');
    check(gv && gv.kind === 'rhythm', 'gesture classified as a rhythm');
    check(gv.intervalsMs.length === 2, 'rhythm has two inter-onset intervals');
    check(pumpUntil(() => !!gestRow('triple-tap'), 5000), 'gesture row rendered');
    const before = spotCount();
    feedPumped(concat(silence(0.5), clickTrain, silence(0.4)));
    check(pumpUntil(() => feedRows('spot').some((t) => t.indexOf('triple-tap') >= 0), 8000),
        'gesture self-fired (onGesture -> fusion spot row)');
    check(pumpUntil(() => spotCount() > before, 3000), 'spot count advanced on the gesture fire');
});

test('timeline: history ring, event log, retention, click-to-inspect', () => {
    const ring = lab.ring();
    check(ring.count > 100, 'stream history ring accumulated frames (' + ring.count + ')');
    const gestEv = lab.events().find((e) => e.type === 'gesture' && e.name === 'triple-tap');
    check(gestEv, 'gesture fire landed in the timeline event log');
    check(gestEv.frame > 0 && gestEv.conf > 0.9, 'event carries its frame + confidence');
    const spotEv = lab.events().find((e) => e.type === 'spot' && e.name === 'hello there');
    check(spotEv, 'phrase spot landed in the timeline event log');
    check(gestEv.span && gestEv.span.b > gestEv.span.a && gestEv.span.b === gestEv.frame,
        'gesture event carries an exact matched span ending at the fire frame');
    check(spotEv.span && spotEv.span.b > spotEv.span.a && spotEv.span.b === spotEv.frame,
        'spot event carries an exact matched span (' + JSON.stringify(spotEv.span) + ')');
    const heardExact = lab.decodedOver(spotEv.span.a, spotEv.span.b);
    check(heardExact.length >= 2, 'decoded phonemes over the exact spot span (' + JSON.stringify(heardExact) + ')');

    // Stream retention: raw audio that drove a match is replayable by frame range.
    const rInfo = bro.listen.info();
    check(rInfo.active && rInfo.seconds === 600, 'retention enabled at boot (' + JSON.stringify(rInfo) + ')');
    check(bro.listen.frame() > 100, 'stream frame advanced with the fed audio (' + bro.listen.frame() + ')');
    const clip = bro.listen.audio(spotEv.span.a, spotEv.span.b);
    check(clip && clip.length > 0, 'bro.listen.audio returns the retained clip for the spot region');
    let energy = 0;
    for (let i = 0; i < clip.length; i++) energy += clip[i] * clip[i];
    check(energy > 0, 'retained clip carries real audio, not silence (energy ' + energy.toFixed(3) + ')');
    check(bro.listen.audio(bro.listen.frame() + 10000, bro.listen.frame() + 20000) === null,
        'audio() returns null outside the retained window');

    // Tier-1: the phoneme ring captured what the model decoded during the phrase.
    let phFrames = 0;
    for (let i = 0; i < ring.count; i++) if (ring.phCls[ring.slot(i)] > 0) phFrames++;
    check(phFrames > 5, 'phoneme ring captured decoded frames (' + phFrames + ')');
    const heardSeq = lab.decodedOver(spotEv.frame - 80, spotEv.frame);
    check(heardSeq.length >= 1, 'decodedOver yields the heard phonemes near the spot (' + JSON.stringify(heardSeq) + ')');
    lab.selectEvent(spotEv);
    const detail = document.querySelector('#detail');
    check(/model heard here/.test(detail.textContent), 'detail shows what the model decoded over the matched region');
    lab.closeDetail();

    lab.selectEvent(gestEv);
    check(!detail.classList.contains('hidden'), 'detail panel opened on select');
    check(detail.querySelector('.dkind').textContent === 'gesture', 'detail names the event kind');
    check(/rhythm template/.test(detail.textContent) && /taps/.test(detail.textContent),
        'detail shows the matched rhythm clip (' + detail.textContent + ')');
    check(lab.view().selRegion && lab.view().selRegion.b === gestEv.frame,
        'selection highlights the matched region ending at the fire frame');
    shot('detail');
    lab.closeDetail();
    check(detail.classList.contains('hidden'), 'detail panel closes');
});

test('clip editor: offline analysis, tone stability gate', () => {
    const whistleClip = concat(silence(0.3), tone(0.6, 1200, 0.2), silence(0.3));
    const an = bro.sense.analyze(whistleClip);
    check(an.frames > 50 && an.flags.length === an.frames, 'analyze returns a per-frame timeline');
    let tonalFrames = 0, pitchSum = 0, pitchN = 0;
    for (let f = 0; f < an.frames; f++) {
        if (an.flags[f] & 2) { tonalFrames++; pitchSum += an.dominantHz[f]; pitchN++; }
    }
    check(tonalFrames > 30, 'analyze marks the sustained tone as tonal (' + tonalFrames + ' frames)');
    check(pitchN > 0 && Math.abs(pitchSum / pitchN - 1200) < 80,
        'analyze pitch tracks the 1200 Hz tone (' + (pitchSum / pitchN).toFixed(0) + ' Hz)');

    lab.enrollGesture('whistle', whistleClip);
    const wv = bro.gesture.inspect('whistle');
    check(wv && wv.kind === 'tone', 'whistle enrolled as a tone gesture');
    check(typeof wv.toneSpread === 'number' && wv.toneSpread < 0.05,
        'a clean whistle enrolls as a steady pitch (spread ' + wv.toneSpread.toFixed(3) + ')');
    check(pumpUntil(() => gestRow('whistle') && !gestRow('whistle').querySelector('.edit').disabled, 5000),
        'whistle row has an enabled edit button (clip retained)');

    const wrow = gestRow('whistle');
    wrow.querySelector('.edit').click();
    check(pumpUntil(() => wrow.querySelector('.gwave'), 3000), 'editor waveform canvas rendered');
    check(wrow.querySelectorAll('.gslider').length === 3, 'tone editor exposes volume + pitch + steadiness sliders');
    check(/peak .* dB/.test(wrow.querySelector('.ginfo').textContent),
        'editor info surfaces the selection peak level (' + wrow.querySelector('.ginfo').textContent + ')');
    shot('editor');

    let before = spotCount();
    feedPumped(concat(silence(0.4), whistleClip, silence(0.4)));
    check(pumpUntil(() => spotCount() > before, 6000), 'steady whistle self-fires the tone gesture');

    before = spotCount();
    feedPumped(concat(silence(0.5), signal.sweep(0.6, 1000, 1500, 0.2, rate), silence(0.4)));
    settle(30);
    check(spotCount() === before, 'a swept-pitch cough does NOT fire the whistle (stability gate)');
    const r = gestRow('whistle');
    if (r) r.querySelector('.rm').click();
});

test('volume slider bakes its gain into the stored clip', () => {
    const src = concat(silence(0.2), tone(0.5, 900, 0.15), silence(0.2));
    const louder = lab.gainedSlice(src, 3, 0, src.length);
    let ps = 0, pl = 0;
    for (let i = 0; i < src.length; i++) ps = Math.max(ps, Math.abs(src[i]));
    for (let i = 0; i < louder.length; i++) pl = Math.max(pl, Math.abs(louder[i]));
    check(Math.abs(pl - ps * 3) < 1e-4, 'gainedSlice scales amplitude by the gain (' + ps.toFixed(3) + '→' + pl.toFixed(3) + ')');

    lab.enrollGesture('vol-test', src);
    const vrow = gestRow('vol-test');
    vrow.querySelector('.edit').click();
    check(pumpUntil(() => vrow.querySelector('.gwave'), 3000), 'vol-test editor opened');
    const volInput = vrow.querySelector('.gtol .gslider input[type="range"]');
    check(volInput && +volInput.max === 4, 'volume slider is the first editor slider (×0–4)');
    const peakOf = (c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const peak0 = peakOf(lab.clipStore['vol-test']);
    volInput.value = '2.5';
    volInput.dispatchEvent({ type: 'input' });
    volInput.dispatchEvent({ type: 'change' });
    check(pumpUntil(() => Math.abs(peakOf(lab.clipStore['vol-test']) - peak0 * 2.5) < 1e-3, 5000),
        'volume change baked the 2.5× gain into the stored clip');
    gestRow('vol-test').querySelector('.rm').click();
});

test('scratch pad: a timeline region becomes a gesture', () => {
    const before = bro.listen.frame();
    feedPumped(concat(silence(0.3), tone(0.7, 1400, 0.2), silence(0.3)));
    const after = bro.listen.frame();
    check(after > before, 'stream advanced for the scratch source (' + before + '→' + after + ')');
    lab.view().scratchSel = { a: before + 35, b: after - 35 };
    const sp = lab.scratchSpan();
    check(sp && sp.b > sp.a, 'scratchSpan clamps to the retained window (' + JSON.stringify(sp) + ')');
    lab.renderScratchBar();
    check(!document.querySelector('#scratch').classList.contains('hidden'), 'the scratch bar shows the selection');
    const gBefore = bro.gesture.templates().length;
    document.querySelector('#phrase').value = 'from-timeline';
    lab.scratchToGesture();
    check(bro.gesture.templates().indexOf('from-timeline') >= 0, 'scratch selection enrolled a new gesture');
    check(bro.gesture.templates().length === gBefore + 1, 'exactly one new gesture added');
    const c = lab.clipStore['from-timeline'];
    check(c && c.length > 0, 'the new gesture retained its clip from the timeline audio');
    let e = 0;
    for (let i = 0; i < c.length; i++) e += c[i] * c[i];
    check(e > 0, 'clipped timeline region carries real audio (energy ' + e.toFixed(2) + ')');
    check(lab.view().scratchSel === null, 'scratch selection cleared after promotion');
    check(pumpUntil(() => gestRow('from-timeline') && gestRow('from-timeline').querySelector('.gwave'), 3000),
        'the new gesture opened in the clip editor');
    gestRow('from-timeline').querySelector('.rm').click();
});

test('rhythm sound-shape gate: a voiced "laugh" at the click tempo', () => {
    const tv = bro.gesture.inspect('triple-tap');
    check(tv && tv.onsets && tv.onsets.length === 3, 'rhythm exposes a per-beat signature (onsets)');
    check(tv.onsets.every((o) => o.voiced < 0.5),
        'click beats enrolled as unvoiced (' + tv.onsets.map((o) => o.voiced.toFixed(2)).join(',') + ')');
    const onsets0 = bro.sense.snapshot().onsets, spots0 = spotCount();
    feedPumped(concat(silence(0.4), voicedBursts(3, 0.25, 220, 0.4), silence(0.4)));
    settle(25);
    const delta = bro.sense.snapshot().onsets - onsets0;
    check(delta >= 3, 'the laugh really did produce beats at the tempo (' + delta +
        ' onsets), so the rejection is from sound shape, not a timing miss');
    check(spotCount() === spots0, 'a voiced laugh at the click tempo does NOT fire the click rhythm');
});

// ── 4f. tier-3 transcript: voice-gated, rolling realtime (mic tab) ──────────
// A synchronous stub stands in for the GPU model so the VAD-gated LIFECYCLE
// (arm -> pull PCM -> commit) is what's under test.

test('voice-gated transcript commits a replayable line', () => {
    let txCalls = 0, lastPcmLen = 0;
    lab.installTranscriber((pcm, cb) => {
        txCalls++; lastPcmLen = pcm.length;
        cb.onToken('hello');
        cb.onToken('hello there');
        cb.onDone('hello there', {});
        return { cancel() {} };
    });
    check(lab.Transcribe.ready, 'stub transcriber installed (tier-3 ready)');
    const micSt = lab.active();
    const linesBefore = micSt.txLines.length, heardBefore = feedRows('heard').length;
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.5)));
    check(pumpUntil(() => micSt.txLines.length > linesBefore, 8000), 'voice-gated transcript committed a line on voice-end');
    check(txCalls > 0 && lastPcmLen > 0, 'transcriber was handed real PCM from the retained stream (' + lastPcmLen + ' samples)');
    const line = micSt.txLines[0];
    check(line.text === 'hello there', 'committed line carries the transcript ("' + line.text + '")');
    check(line.b > line.a, 'committed line spans the utterance frames (' + line.a + '–' + line.b + ')');
    check(feedRows('heard').length > heardBefore, '[heard] fusion row rendered for the utterance');
    check(pumpUntil(() => document.querySelectorAll('#txLines .txline').length >= 1, 3000), 'transcript panel rendered the committed line');
    check(/hello there/.test(document.querySelector('#txLines .txline .tx').textContent), 'transcript row shows the words');

    const spEv = lab.events().find((e) => e.type === 'speech' && e.name === 'hello there');
    check(spEv && spEv.span && spEv.span.b > spEv.span.a, 'speech event landed on the timeline with a matched span');
    lab.selectEvent(spEv);
    check(/model heard here/.test(document.querySelector('#detail').textContent), 'selecting the speech marker opens its detail panel');
    lab.closeDetail();

    document.querySelector('#txLines .txline').click();
    check(lab.playback().active, 'clicking a transcript line started playback (playhead)');
    check(lab.playback().key === (line.a + '-' + line.b), 'playhead bound to the clicked utterance (' + lab.playback().key + ')');
    check(lab.playFrac() >= 0, 'playhead fraction is live');
    check(!lab.view().follow, 'timeline left follow mode to focus the utterance');
    check(document.querySelector('#txLines .txline.playing'), 'the clicked line is highlighted as playing');
    shot('transcript');
    lab.view().follow = true;
});

// ── 4g. stream tabs: every source is a full, identical dashboard ─────────────
// Headless has no live mic / loopback, so an added MIC stream is driven via
// stream.feed().

test('stream tabs: add, own dashboard, concurrent transcript, export, close', () => {
    lab.buildSourceOptions();
    const opts = Array.from(document.querySelectorAll('#srcSel option')).map((o) => o.value);
    check(opts.indexOf('mic') >= 0, 'source picker offers a mic source (' + JSON.stringify(opts) + ')');
    check(lab.specFromSelect() && lab.specFromSelect().kind === 'mic', 'the picker reads back a mic spec');

    const micSt = lab.active();
    const micLinesBefore = micSt.txLines.length;
    check(lab.streams().length === 1, 'one tab (the mic) before adding');
    check(bro.sense.isActive() && bro.kws.isActive(), 'mic dashboard live before adding a stream');

    // (a) add a second mic stream -> a new tab, switched to, with the full stack.
    const st = lab.addStream({ kind: 'mic' });
    check(st && st.source.handle.valid && st.kind === 'mic', 'added mic stream opened a valid handle');
    check(lab.streams().length === 2, 'two tabs now');
    check(lab.active() === st, 'adding a stream switches to its tab');
    const tabs = Array.from(document.querySelectorAll('#tabStrip .tab'));
    check(tabs.length === 2 && tabs[1].classList.contains('active'), 'the tab strip shows both streams, the new one active');
    check(st.source.sense.isActive(), 'the stream runs its own tier-0 sensors');
    check(bro.sense.isActive() && bro.kws.isActive(), 'mic stream untouched by the add');
    st.source.handle.retain(60);

    function feedStream(all) {
        const CHUNK = Math.floor(rate / 40);
        for (let off = 0; off < all.length; off += CHUNK) {
            st.source.handle.feed(all.subarray(off, Math.min(off + CHUNK, all.length)));
            sleep(15);
        }
    }

    // (b) tier-0 on the stream's OWN dashboard.
    feedStream(concat(silence(0.3), tone(0.8, 1300, 0.18), silence(0.3)));
    const ss = st.source.sense.snapshot();
    check(ss && ss.tonalEvents >= 1, "the stream's own tier-0 sensor counted the tone");
    check(lab.ring() === st.ring && st.ring.count > 40, "the active timeline shows the stream's own history (" + st.ring.count + ' frames)');
    check(feedRows('tonal').length >= 1, "the stream's feed shows its own tonal event");

    // (c) kws: the mic's vocabulary was mirrored; a spoken phrase self-spots here.
    check(st.source.kws.templates().indexOf('hello there') >= 0, 'mic phrase mirrored onto the stream session');
    const stSpots0 = st.spots;
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.4)));
    check(pumpUntil(() => st.spots > stSpots0, 8000), 'the stream self-spotted the mirrored phrase');
    check(feedRows('spot').some((t) => t.indexOf('hello there') >= 0), "the spot landed on the stream's own feed");

    // (d) transcript runs CONCURRENTLY on the stream and the mic (no stealing).
    const stTxBefore = st.txLines.length;
    feedStream(concat(silence(0.4), speak('hello there'), silence(0.6)));
    check(pumpUntil(() => st.txLines.length > stTxBefore, 8000), "the stream's own voice-gated transcript committed a line");
    check(/hello there/.test(document.querySelector('#txLines .txline .tx').textContent), 'the active (stream) transcript panel shows the line');
    shot('stream-tab');
    lab.switchTab(0);
    check(lab.active() === micSt, 'switched back to the mic tab');
    check(lab.ring() === micSt.ring && micSt.ring !== st.ring, 'each stream keeps its own independent history ring');
    feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
    check(pumpUntil(() => micSt.txLines.length > micLinesBefore, 8000), 'the mic transcript still commits while a stream also transcribes (no steal)');

    // (e) WAV export: the stream's retained buffer writes a real RIFF/WAVE file.
    const fs = require('fs'), tmpdir = require('os').tmpdir();
    const tmp = tmpdir + '/listen-lab-stream-' + st.id + '.wav';
    lab.exportTo(tmp);
    lab.saveStreamWav(st);
    lab.exportTo(null);
    check(fs.existsSync(tmp), 'stream WAV written to disk (' + tmp + ')');
    const buf = fs.readFileSync(tmp);
    const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    check(tag(0) === 'RIFF' && tag(8) === 'WAVE', 'exported file is a RIFF/WAVE container (' + tag(0) + '/' + tag(8) + ')');
    check(buf.length > 44, 'WAV carries audio past the header (' + buf.length + ' bytes)');

    // (f) primary WAV export from a retained timeline region (mic active).
    const tmp2 = tmpdir + '/listen-lab-primary.wav';
    const b = bro.listen.frame(), a = Math.max(bro.listen.frame() - 200, 0);
    lab.exportTo(tmp2);
    const path = lab.exportWav(bro.listen.audio(a, b), bro.listen.info().rate, 'x.wav');
    lab.exportTo(null);
    check(path === tmp2 && fs.existsSync(tmp2), 'primary region exported to a .wav');

    // (g) close the stream tab -> back to one tab, mic dashboard intact.
    lab.removeStream(st);
    check(lab.streams().length === 1, 'stream tab closed');
    check(lab.active() === micSt, 'closing the active stream falls back to the mic tab');
    check(document.querySelectorAll('#tabStrip .tab').length === 1, 'tab strip back to one tab');
    check(bro.sense.isActive() && bro.kws.isActive(), 'closing the stream left the mic dashboard live (independent streams)');
});

// ── 4h. non-English transcription + diarization + translation (stubbed) ─────

test('i18n: language badge, speaker clustering, English line', () => {
    const micSt = lab.active();
    check(micSt.kind === 'mic', 'mic tab active for the i18n test');
    let asrText = 'hola mundo', asrLang = 'Spanish';
    lab.installTranscriber((pcm, cb) => {
        cb.onToken(asrText);
        cb.onDone(asrText, { lang: asrLang });
        return { cancel() {} };
    });
    const DIM = 1024;
    const basis = (k) => { const v = new Float32Array(DIM); v[k] = 1; return v; };
    let spkVec = basis(0);
    lab.installDiarizer(() => spkVec);
    lab.installTranslator(() => 'hello world');

    const utter = () => {
        const n = micSt.txLines.length;
        feedPumped(concat(silence(0.4), speak('hello there'), silence(0.6)));
        check(pumpUntil(() => micSt.txLines.length > n, 8000), 'a line committed');
        return micSt.txLines[0];
    };

    // Utterance 1: speaker A, Spanish.
    spkVec = basis(0);
    const l1 = utter();
    check(l1.lang.toLowerCase() === 'spanish', 'line carries the detected language ("' + l1.lang + '")');
    check(l1.text === 'hola mundo', 'line carries the source-language transcript');
    check(pumpUntil(() => l1.speaker > 0, 3000), 'utterance assigned a speaker (' + l1.speaker + ')');
    const spkA = l1.speaker;
    check(pumpUntil(() => l1.en === 'hello world', 3000), 'non-English line got an English translation');
    check(pumpUntil(() => document.querySelector('#txLines .txline .lang'), 3000), 'transcript row shows the language badge');
    check(document.querySelector('#txLines .txline .lang').textContent.toLowerCase() === 'spanish', 'badge names the language');
    check(document.querySelector('#txLines .txline .spk'), 'transcript row shows a speaker chip');
    check(/hello world/.test(document.querySelector('#txLines .txline .txen').textContent), 'transcript row shows the English translation line');
    check(feedRows('xlate').some((t) => /hello world/.test(t)), '[xlate] fusion row rendered');
    check(feedRows('spk').length >= 1, '[spk] fusion row rendered');

    // Utterance 2: a DIFFERENT voice -> a second speaker.
    spkVec = basis(7);
    const l2 = utter();
    check(pumpUntil(() => l2.speaker > 0, 3000), 'second utterance assigned a speaker');
    check(l2.speaker !== spkA, 'a distinct voice clustered to a NEW speaker (' + spkA + ' vs ' + l2.speaker + ')');

    // Utterance 3: speaker A returns -> SAME id.
    spkVec = basis(0);
    const l3 = utter();
    check(pumpUntil(() => l3.speaker > 0, 3000), 'third utterance assigned a speaker');
    check(l3.speaker === spkA, 'the returning voice re-used speaker ' + spkA + ' (online clustering)');
    check(micSt.speakers.length === 2, 'exactly two speakers discovered on this stream (' + micSt.speakers.length + ')');

    // An English line skips both the language badge and translation.
    asrText = 'hello there'; asrLang = 'English';
    check(utter().en === null, 'an English line is not translated');
});

// ── 4i. streaming sentence chunker: seal sentences mid-utterance ────────────
// Driven directly over a real retained window so the seal logic is
// deterministic: a sentence seals only once it is stable across two passes and
// has trailing text.

test('sentence chunker seals stable sentences and advances the window', () => {
    const micSt = lab.active();
    lab.installTranslator((text) => '[en] ' + text);
    const ctx = micSt.txCtx;
    const b = bro.listen.frame(), a = Math.max(ctx.oldest() + 5, b - 400);
    check(b - a > 60, 'a real retained window to anchor sentence cuts in (' + (b - a) + ' frames)');
    ctx.tx.active = true; ctx.tx.lang = 'Spanish';
    ctx.tx.startFrame = a; ctx.tx.sealedFrame = a; ctx.tx.prevPartial = '';

    const n0 = micSt.txLines.length;
    lab.sealSentences(ctx, 'Uno dos tres. palabra', a, b);
    check(micSt.txLines.length === n0, 'a sentence seen for the first time does NOT seal (needs 2 stable passes)');
    lab.sealSentences(ctx, 'Uno dos tres. palabra', a, b);
    check(micSt.txLines.length === n0 + 1, 'a stable complete sentence sealed mid-utterance');
    const sealed = micSt.txLines[0];
    check(sealed.text === 'Uno dos tres.', 'sealed line carries the sentence ("' + sealed.text + '")');
    check(sealed.lang.toLowerCase() === 'spanish', 'sealed line carries the detected language');
    check(sealed.b > sealed.a && sealed.a === a, 'sealed line spans from the utterance start to the cut');
    check(ctx.tx.startFrame > a && ctx.tx.startFrame === ctx.tx.sealedFrame, 'the re-transcribe window advanced past the sealed audio');
    check(pumpUntil(() => sealed.en === '[en] Uno dos tres.', 3000), 'the sealed sentence got an English translation');

    const aa = ctx.tx.startFrame, n1 = micSt.txLines.length;
    lab.sealSentences(ctx, 'Cuatro cinco. palabra', aa, b);
    lab.sealSentences(ctx, 'Cuatro cinco. palabra', aa, b);
    check(micSt.txLines.length === n1 + 1, 'a second sentence sealed from the advanced window');
    check(micSt.txLines[0].text === 'Cuatro cinco.', 'second sealed sentence committed');
    check(ctx.tx.startFrame > aa, 'the window advanced again past the second cut');
    ctx.tx.active = false; ctx.tx.prevPartial = '';
});

// ── 4j. correctness tier: context-aware, scene-segmented re-translation ─────
// The refiner stub ECHOES the number of dialogue lines it was handed, so the
// test proves it fires and marks the line refined, is given speaker labels +
// neighbouring lines with the target marked ►, re-refines a line once its
// successor lands, and that a scene cut bounds the context.

test('correctness tier: scene context, progressive refine, scene cut', () => {
    const micSt = lab.active();
    let lastDialogue = '';
    lab.installRefiner((text, lang, dialogue) => {
        lastDialogue = dialogue;
        return 'CTX(' + dialogue.split('\n').length + '): ' + text;
    });
    lab.installTranslator((text) => '[en] ' + text);

    const ctx = micSt.txCtx;
    const b = bro.listen.frame(), a = Math.max(ctx.oldest() + 5, b - 400);
    check(b - a > 60, 'a real retained window for the correctness test (' + (b - a) + ' frames)');
    ctx.tx.active = true; ctx.tx.lang = 'Japanese';
    ctx.tx.startFrame = a; ctx.tx.sealedFrame = a; ctx.tx.prevPartial = '';
    micSt._lastB = a - (350 + 50);      // open a FRESH scene (gap > SCENE_GAP)
    const seal = (text, from) => { lab.sealSentences(ctx, text, from, b); lab.sealSentences(ctx, text, from, b); return micSt.txLines[0]; };

    const ln1 = seal('Sentence uno. mas', a);
    check(ln1.text === 'Sentence uno.', 'line 1 sealed for the correctness test');
    ln1.speaker = 1;
    check(pumpUntil(() => ln1.refined && /^CTX\(/.test(ln1.en || ''), 3000), 'line 1 was re-translated by the correctness tier ("' + ln1.en + '")');
    check(ln1.en === 'CTX(1): Sentence uno.', 'line 1, alone in its scene, got 1 line of context ("' + ln1.en + '")');

    const ln2 = seal('Sentence dos. mas', ctx.tx.startFrame);
    check(ln2.text === 'Sentence dos.', 'line 2 sealed');
    ln2.speaker = 2;
    check(ln2.scene === ln1.scene, 'contiguous sentences share a scene (no gap)');
    check(pumpUntil(() => ln2.en === 'CTX(2): Sentence dos.', 3000), 'line 2 refined with its neighbour as context ("' + ln2.en + '")');
    check(pumpUntil(() => ln1.en === 'CTX(2): Sentence uno.', 3000), 'line 1 was RE-refined once line 2 arrived ("' + ln1.en + '")');

    lab.refine(micSt, ln2);
    check(pumpUntil(() => /S1:/.test(lastDialogue) && /S2:/.test(lastDialogue), 3000), 'dialogue refreshed with both speakers');
    check(/►/.test(lastDialogue), 'the correctness model is told which line to translate (►)');

    micSt._lastB = micSt.txLines[0].b - (350 + 50);   // force a gap > SCENE_GAP at the next seal
    const ln3 = seal('Sentence tres. mas', ctx.tx.startFrame);
    check(ln3.text === 'Sentence tres.', 'post-cut line sealed');
    check(ln3.scene !== ln2.scene, 'a long gap started a new scene (' + ln2.scene + '→' + ln3.scene + ')');
    check(pumpUntil(() => ln3.en === 'CTX(1): Sentence tres.', 3000),
        'the post-cut line is translated alone: context did not bleed across the cut ("' + ln3.en + '")');
    ctx.tx.active = false; ctx.tx.prevPartial = '';
    lab.Refine.ready = false;                        // stop the correctness tier for later sections
});

// ── 5-6. remove a gesture live; stop kws from the UI ────────────────────────

test('remove the gesture via its × while live', () => {
    const row = gestRow('triple-tap');
    check(row, 'triple-tap gesture row present before remove');
    row.querySelector('.rm').click();
    check(bro.gesture.templates().indexOf('triple-tap') < 0, 'gesture removed');
    check(bro.kws.templates().indexOf('hello there') >= 0, 'kws seed untouched by gesture remove');
    check(bro.kws.isActive(), 'kws still listening after the gesture remove');
});

test('teardown: kws stops from the UI, tier-0 keeps rolling', () => {
    document.querySelector('#listen').click();
    check(!bro.kws.isActive(), 'kws stopped via UI');
    check(bro.sense.isActive(), 'sense still live after kws left');
    check(document.querySelector('#listen').textContent === 'Listen', 'the button reads Listen again');
});

shot('final');
done('listen-lab');
