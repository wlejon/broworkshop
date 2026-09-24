// Media Inspector: the bro.media contract the app draws from, then the app
// itself: open a video, lanes + diagnostics filled, scrub / seek sync, zoom,
// region re-analysis, parameters, audio-only files, a missing file.
// Analysis runs in a worker (real threads), so async steps are pumped with
// settle() rather than awaited.
import { check, eq, near, test, done, frames, q, text, clickOn, setValue, press, shot, waitFor } from "/lib/kit/test.js";
import { inspector, SOURCES } from "/app/app.js";
import { stripCanvas } from "/app/filmstrip.js";
import { niceStep } from "/app/waveform.js";
import { peakStats, aspectRatio, timecode } from "/app/analysis.js";
import { appPath } from "/lib/kit/ml.js";

const fs = require('fs');
const path = require('path');
const VIDEO = appPath(SOURCES[0][0]);

// A sound-only WebM (one Opus track, no video) for the audio-only path: the
// workshop's tracked audio is Ogg Vorbis, which bro.media cannot read.
const OUT = path.resolve('tests/out/media-inspector').replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });
const TONE = OUT + '/tone.webm';
{
    const sr = 48000, pcm = new Float32Array(sr * 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr) * (i < sr ? i / sr : 1);
    const enc = new VideoEncoder({ path: TONE, audioSampleRate: sr, audioChannels: 1 });
    enc.addAudioFramesPCM(pcm);
    enc.finish();
}

/** Pump until `p` settles; returns its value or throws its error. */
function settle(p, what, ms) {
    let finished = false, value, error;
    Promise.resolve(p).then((v) => { finished = true; value = v; }, (e) => { finished = true; error = e; });
    waitFor(() => finished, what, ms || 30000);
    if (error) throw error;
    return value;
}

// --- bro.media contract ---------------------------------------------------------------

test('bro.media is available', () => {
    check(globalThis.bro && bro.media && bro.media.available === true);
});

const peaks = bro.media.peaks(VIDEO, { buckets: 256 });

test('peaks: shape and envelope of hello.webm', () => {
    check(peaks, 'peaks for the tracked video');
    check(peaks.sampleRate > 0 && peaks.channels >= 1 && peaks.duration > 0, 'stream facts');
    eq(peaks.buckets, 256);
    eq(peaks.from, 0);
    near(peaks.to, peaks.duration, 1e-4, 'a whole-file read spans the file');
    for (const k of ['min', 'max', 'rms']) {
        check(peaks[k] instanceof Float32Array && peaks[k].length === 256, k + ' is a Float32Array per bucket');
    }
    for (let i = 0; i < 256; i++) check(peaks.min[i] <= peaks.max[i], 'bucket ' + i + ' min <= max');
    const s = peakStats(peaks);
    check(s.max > 0 && s.min < 0 && s.rmsAvg > 0, 'signal in both directions with energy');
});

test('peaks: windows, inverted spans and missing files', () => {
    const half = peaks.duration / 2;
    const w = bro.media.peaks(VIDEO, { buckets: 64, from: 0, to: half });
    eq(w.buckets, 64);
    near(w.to, half, 0.1, 'window end');
    near(w.duration, peaks.duration, 0.1, 'duration is still the file');
    eq(bro.media.peaks(VIDEO, { buckets: 16, from: 5, to: 1 }), null, 'inverted window is null');
    eq(bro.media.peaks('non_existent_file.webm', { buckets: 16 }), null, 'missing file is null');
});

test('thumbnails: one RGBA strip with forward times', () => {
    const strip = bro.media.thumbnails(VIDEO, { count: 8, height: 48 });
    check(strip, 'strip for the tracked video');
    eq(strip.count, 8);
    eq(strip.height, 48);
    check(strip.width > 0 && typeof strip.rotation === 'number', 'tile width + rotation');
    eq(strip.times.length, 8);
    for (let i = 1; i < 8; i++) check(strip.times[i] >= strip.times[i - 1], 'times walk forward');
    // The docs promise a Uint8ClampedArray; the engine returns a Uint8Array
    // (ENGINE-ISSUES.md). The app only needs RGBA bytes, so assert that.
    check(ArrayBuffer.isView(strip.data) && strip.data.BYTES_PER_ELEMENT === 1, 'byte array');
    eq(strip.data.length, strip.width * strip.count * strip.height * 4, 'width*count*height*4 bytes');
    let opaque = 0, energy = 0;
    for (let i = 0; i < strip.data.length; i += 4) {
        energy += strip.data[i] + strip.data[i + 1] + strip.data[i + 2];
        if (strip.data[i + 3] > 0) opaque++;
    }
    check(opaque > (strip.data.length / 4) * 0.9 && energy > 0, 'opaque pixels with content');
    const c = stripCanvas(strip);
    eq(c.width, strip.width * 8, 'strip canvas holds every tile');
});

test('thumbnails: a tail window starts at its from', () => {
    const half = peaks.duration / 2;
    const w = bro.media.thumbnails(VIDEO, { count: 4, height: 32, from: half });
    eq(w.count, 4);
    for (const t of w.times) check(t >= half - 0.25, 'tail thumbnail at ' + t.toFixed(3));
});

test('helpers: niceStep, aspectRatio, timecode', () => {
    eq(niceStep(0.37), 0.5);
    eq(niceStep(1.2), 1);
    eq(aspectRatio(640, 360), '16:9');
    eq(aspectRatio(1919, 1080), '16:9');
    eq(timecode(61.25), '01:01.250');
});

// --- the app ----------------------------------------------------------------------------

test('boots on the tracked video and fills both lanes', () => {
    check(settle(inspector.ready, 'first inspect'), 'inspect succeeded');
    const d = inspector.doc;
    eq(d.path, VIDEO);
    check(d.peaks && d.strip, 'peaks and strip');
    eq(d.peaks.buckets, 1024, 'default buckets');
    eq(d.strip.count, 16, 'default thumbnails');
    check(!q('#video').hidden && q('#audio-stage').hidden, 'video stage shown');
    eq(q('#source').options.length, SOURCES.length);
    check(/hello\.webm: peaks \+ 16 frames/.test(text('#status')), 'status: ' + text('#status'));
    check(q('#badge-media').classList.contains('ok'), 'bro.media badge on');
});

test('diagnostics panels describe the streams', () => {
    check(/Hz/.test(inspector.audioMeta.get('rate')), 'sample rate');
    eq(inspector.audioMeta.get('buckets'), '1,024');
    check(/x/.test(inspector.videoMeta.get('size')), 'picture size: ' + inspector.videoMeta.get('size'));
    check(/^16 at /.test(inspector.videoMeta.get('frames')), 'thumbnail count');
    check(/Hz/.test(text('#badge-rate')) && /x/.test(text('#badge-res')), 'header badges');
    eq(text('#time-total'), timecode(inspector.doc.duration));
});

test('clicking the waveform seeks the player and both playheads', () => {
    const r = q('#waveform').getBoundingClientRect();
    click(r.left + r.width * 0.5, r.top + r.height * 0.6, 0);
    frames(3);
    const want = inspector.doc.duration * 0.5;
    near(inspector.player.time, want, 0.15, 'player time');
    near(inspector.waveform.playhead, inspector.player.time, 0.05, 'waveform playhead');
    eq(text('#time-now'), timecode(inspector.player.time));
    const active = inspector.filmstrip.activeIndex();
    check(active >= 6 && active <= 9, 'filmstrip highlights a middle frame: ' + active);
});

test('clicking a filmstrip frame seeks to its time', () => {
    const r = q('#filmstrip').getBoundingClientRect();
    const i = 3, cell = r.width / inspector.doc.strip.count;
    click(r.left + cell * (i + 0.5), r.top + r.height / 2, 0);
    frames(3);
    near(inspector.player.time, inspector.doc.strip.times[i], 0.1, 'seeked to frame ' + i);
    eq(inspector.filmstrip.activeIndex(), i);
});

test('keys: arrows step a second, Home rewinds', () => {
    inspector.player.seek(1);
    press('ArrowRight');
    near(inspector.player.time, 2, 0.1);
    press('ArrowLeft');
    near(inspector.player.time, 1, 0.1);
    press('Home');
    near(inspector.player.time, 0, 0.05);
});

test('zoom buttons change the view and the label; Fit restores it', () => {
    clickOn('#zoom-in');
    const v = inspector.waveform.view;
    check(v.to - v.from < inspector.doc.duration * 0.7, 'zoomed in');
    eq(text('#zoom'), (inspector.doc.duration / (v.to - v.from)).toFixed(1) + 'x');
    clickOn('#zoom-fit');
    near(inspector.waveform.view.to - inspector.waveform.view.from, inspector.doc.duration, 0.01, 'whole span');
    eq(text('#zoom'), '1.0x');
});

test('shift-drag region, Zoom region re-analyses just that span', () => {
    const d = inspector.doc.duration;
    inspector.waveform.selection = { from: d * 0.25, to: d * 0.5 };
    check(settle(inspector.zoomRegion(), 'region analysis'), 'region analysed');
    const p = inspector.doc.peaks;
    near(p.from, d * 0.25, 0.05, 'peaks start at the region');
    near(p.to, d * 0.5, 0.05, 'peaks end at the region');
    eq(p.buckets, 1024, 'full resolution over the region');
    for (const t of inspector.doc.strip.times) check(t >= d * 0.25 - 0.25 && t <= d * 0.5 + 0.25, 'thumbnail in region: ' + t);
    near(inspector.waveform.view.from, d * 0.25, 0.05, 'view follows the region');
    check(/region|–/.test(text('#strip-info')), 'strip info shows the span');
    clickOn('#reset-span');
    waitFor(() => inspector.doc.span.from === 0 && inspector.doc.peaks.from === 0, 'whole-file analysis');
});

test('Zoom region without a selection only warns', () => {
    inspector.waveform.selection = null;
    clickOn('#zoom-region');
    check(/select a region/.test(text('#status')), 'status: ' + text('#status'));
});

test('analysis parameters apply on Re-analyse', () => {
    setValue('#analysis-params input', 256);              // peak buckets
    const inputs = q('#analysis-params').querySelectorAll('input');
    setValue(inputs[1], 8);
    clickOn('#reanalyze');
    waitFor(() => inspector.doc.peaks.buckets === 256 && inspector.doc.strip.count === 8, 're-analysis');
    eq(inspector.audioMeta.get('buckets'), '256');
});

test('transport: loop, mute and rate reach the element', () => {
    clickOn('#loop');
    check(inspector.player.loop && q('#loop').classList.contains('active'), 'loop on');
    clickOn('#loop');
    clickOn('#mute');
    check(inspector.player.muted && text('#mute') === 'Unmute', 'muted');
    clickOn('#mute');
    setValue('#rate', '0.5');
    near(inspector.player.rate, 0.5, 1e-6);
    setValue('#rate', '1');
});

test('a sound-only file shows the audio stage and an empty filmstrip', () => {
    check(settle(inspector.openCustom(TONE), 'audio inspect'), 'inspected');
    const d = inspector.doc;
    check(d.peaks && !d.strip, 'peaks, no strip');
    near(d.peaks.duration, 2, 0.1, 'two seconds of tone');
    check(peakStats(d.peaks).max > 0.2, 'the tone shows in the envelope');
    check(q('#video').hidden && !q('#audio-stage').hidden, 'audio stage shown');
    eq(text('#audio-name'), 'tone.webm');
    eq(inspector.videoMeta.get('size'), 'no picture');
    eq(inspector.audioMeta.get('ch'), '1 (mono)');
    eq(text('#badge-res'), 'audio only');
    check(/no video track/.test(text('#strip-info')), 'strip info');
});

test('a missing custom path reports an error', () => {
    const ok = settle(inspector.openCustom('does/not/exist.webm'), 'missing file');
    check(!ok, 'inspect fails');
    check(!q('#custom-path').hidden, 'custom path field shown');
    check(/cannot read exist\.webm: file not found/.test(text('#status')), 'status: ' + text('#status'));
});

test('an unreadable file (Ogg Vorbis) reports instead of hanging', () => {
    const ok = settle(inspector.openCustom('../../demos/scene-audio/assets/pad-chime.ogg'), 'ogg file');
    check(!ok, 'inspect fails');
    check(/cannot read pad-chime\.ogg/.test(text('#status')), 'status: ' + text('#status'));
});

setValue('#source', SOURCES[0][0]);
waitFor(() => inspector.doc.path === VIDEO && inspector.doc.strip && /frames/.test(text('#status')), 'back to the video');
inspector.player.seek(inspector.doc.duration * 0.4);
frames(10);
shot('main');
done('media-inspector');
