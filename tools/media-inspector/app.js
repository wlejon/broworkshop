// app.js — Media Inspector: open a media file, play it in <video>, and lay
// what is inside it (bro.media.peaks, bro.media.thumbnails) under the
// player as a waveform and a filmstrip that follow the playhead.
//
//   analysis.js / analysis-worker.js   bro.media decodes in a worker
//   waveform.js   the peaks lane (scrub, select, zoom)
//   filmstrip.js  the thumbnails lane
//   player.js     the <video> transport
//
// main.js imports this module; tests import it and drive `inspector`.

import { boot } from "/lib/kit/app.js";
import { $, h, fmtBytes } from "/lib/kit/dom.js";
import { readout, toggleButton } from "/lib/kit/ui.js";
import { params, bindControl } from "/lib/kit/params.js";
import { appPath, baseName, pickFile } from "/lib/kit/ml.js";
import { createAnalyzer, peakStats, aspectRatio, timecode, DEFAULT_OPTS } from "./analysis.js";
import { createWaveform } from "./waveform.js";
import { createFilmstrip } from "./filmstrip.js";
import { createPlayer } from "./player.js";

/**
 * Bundled sources: tracked media elsewhere in the workshop, relative to this
 * app. bro.media and <video> read WebM (VP9/VP8 + Opus) only, so the
 * workshop's Ogg Vorbis clips are not offered (ENGINE-ISSUES.md).
 */
export const SOURCES = [
    ['../../demos/video_demo/hello.webm', 'hello.webm (video + audio)'],
    ['custom', 'Custom path…'],
];
const fs = require('fs');

const app = boot({ menu: { file: [{ id: 'file.open', label: 'Open Media...', accel: 'Ctrl+O' }],
    handlers: { 'file.open': () => browse() } } });
const mediaOn = !!(globalThis.bro && bro.media && bro.media.available);

// --- state + parts ----------------------------------------------------------------

const opts = Object.assign({}, DEFAULT_OPTS);
const doc = { path: '', duration: 0, info: null, peaks: null, strip: null, span: { from: 0, to: 0 }, error: null };
const analyzer = createAnalyzer();

const waveform = createWaveform($('#waveform'), {
    onSeek: (t) => player.seek(t),
    onView: () => paintZoom(),
    onSelect: (sel) => app.status.set('selected ' + sel.from.toFixed(2) + 's – ' + sel.to.toFixed(2) + 's: Zoom region re-analyses it'),
});
const filmstrip = createFilmstrip($('#filmstrip'), { onSeek: (t) => player.seek(t) });
const player = createPlayer($('#video'), {
    onTime: (t, d) => {
        waveform.setPlayhead(t);
        filmstrip.setPlayhead(t);
        $('#time-now').textContent = timecode(t);
        $('#time-total').textContent = timecode(d || doc.duration);
    },
    onState: (st) => {
        $('#play').textContent = st === 'playing' ? 'Pause' : 'Play';
        if (st === 'error') app.status.error('playback failed');
        else if (st !== 'paused' || doc.path) app.status.set(st);
    },
});

// --- inspecting ---------------------------------------------------------------------

/**
 * Open `path` (app-relative or absolute): load it into the player and
 * analyse the whole file. Resolves true when anything could be read.
 */
async function inspect(path) {
    if (!path) return false;
    const abs = appPath(path);
    Object.assign(doc, { path: abs, error: null, info: null, duration: 0, peaks: null, strip: null });
    if (!fs.existsSync(abs)) {
        doc.error = 'file not found';
        showStage(false);
        app.status.error('cannot read ' + baseName(abs) + ': file not found');
        return false;
    }
    app.status.busy('opening ' + baseName(abs));
    let info = null;
    try { info = await player.load(abs); } catch (e) { doc.error = e.message; }
    if (doc.path !== abs) return false;                 // another file was opened meanwhile
    doc.info = info;
    doc.duration = info ? info.duration : 0;
    const ok = await runAnalysis({});
    // The strip says whether there is a picture; the element's own
    // videoWidth is not reliable for sound-only files.
    showStage(mediaOn ? !!doc.strip : !!(info && info.hasVideo));
    if (!ok && !info) { app.status.error('cannot read ' + baseName(abs) + (doc.error ? ': ' + doc.error : '')); return false; }
    return true;
}

function showStage(picture) {
    $('#video').hidden = !picture;
    $('#audio-stage').hidden = picture;
    $('#audio-name').textContent = baseName(doc.path);
}

/**
 * Analyse `span` ({} = whole file, { from, to } = a region) of the open file
 * with the current parameters. Resolves true when peaks or a strip came back.
 */
async function runAnalysis(span) {
    if (!doc.path) return false;
    if (!mediaOn) { app.status.warn('bro.media is not in this build: playback only'); return false; }
    const from = span.from || 0, to = span.to || 0;
    app.status.busy('analysing ' + (to ? from.toFixed(2) + 's – ' + to.toFixed(2) + 's' : 'the whole file'));
    let r;
    try {
        r = await analyzer.analyze(doc.path, Object.assign({}, opts, { from, to }));
    } catch (e) {
        if (e.abandoned) return false;                 // a newer analysis took over
        app.status.error('analysis failed: ' + e.message);
        return false;
    }
    doc.peaks = r.peaks;
    doc.strip = r.strip;
    if (r.peaks && r.peaks.duration) doc.duration = Math.max(doc.duration, r.peaks.duration);
    doc.span = { from, to: to || doc.duration };
    waveform.setData(r.peaks, doc.duration);
    filmstrip.setData(r.strip, doc.span, doc.duration);
    waveform.setPlayhead(player.time);
    filmstrip.setPlayhead(player.time);
    renderMeta();
    $('#time-total').textContent = timecode(doc.duration);
    const got = [r.peaks && 'peaks', r.strip && r.strip.count + ' frames'].filter(Boolean).join(' + ') || 'nothing';
    app.status.ok(baseName(doc.path) + ': ' + got + ' · ' + r.ms + ' ms');
    return !!(r.peaks || r.strip);
}

// --- diagnostics ----------------------------------------------------------------------

const audioMeta = readout('#audio-meta', {
    rate: 'sample rate', ch: 'channels', dur: 'duration', buckets: 'buckets',
    max: 'peak max', min: 'peak min', rms: 'RMS mean', span: 'span',
});
const videoMeta = readout('#video-meta', {
    size: 'picture', aspect: 'aspect', fps: 'frame rate', rot: 'rotation',
    frames: 'thumbnails', bytes: 'strip bytes', times: 'times',
});

function renderMeta() {
    const p = doc.peaks, ps = peakStats(p);
    const pct = (v) => (v * 100).toFixed(1) + '%';
    audioMeta.set(p ? {
        rate: p.sampleRate.toLocaleString() + ' Hz',
        ch: p.channels === 1 ? '1 (mono)' : p.channels === 2 ? '2 (stereo)' : p.channels,
        dur: p.duration.toFixed(3) + 's', buckets: p.buckets.toLocaleString(),
        max: '+' + ps.max.toFixed(3) + ' (' + pct(ps.max) + ')', min: ps.min.toFixed(3) + ' (' + pct(ps.min) + ')',
        rms: ps.rmsAvg.toFixed(4) + ' (' + pct(ps.rmsAvg) + ')',
        span: p.from.toFixed(2) + 's – ' + p.to.toFixed(2) + 's',
    } : { rate: '—', ch: '—', dur: doc.duration ? doc.duration.toFixed(3) + 's' : '—', buckets: '—',
          max: '—', min: '—', rms: '—', span: 'no audio track' });

    const info = doc.info, s = doc.strip;
    // Picture size from the element when a strip proves there is a picture.
    const vw = s ? (info && info.width) || s.width : 0, vh = s ? (info && info.height) || s.height : 0;
    videoMeta.set({
        size: vw && vh ? vw + ' x ' + vh : 'no picture',
        aspect: vw && vh ? aspectRatio(vw, vh) + ' (' + (vw / vh).toFixed(2) + ':1)' : '—',
        fps: info && info.frameRate ? info.frameRate.toFixed(2) + ' fps' : '—',
        rot: (info ? info.rotation : s ? s.rotation : 0) + '°',
        frames: s ? s.count + ' at ' + s.width + ' x ' + s.height : '—',
        bytes: s ? fmtBytes(s.data.length) : '—',
        times: s ? s.times.slice(0, 4).map((t) => t.toFixed(2) + 's').join(', ') + (s.count > 4 ? ' … +' + (s.count - 4) : '') : '—',
    });
    $('#strip-info').textContent = s ? s.count + ' frames over ' + doc.span.from.toFixed(2) + 's – ' + doc.span.to.toFixed(2) + 's · click a frame to seek'
        : 'no video track';

    $('#badge-res').textContent = vw && vh ? vw + 'x' + vh : 'audio only';
    $('#badge-dur').textContent = doc.duration.toFixed(2) + 's';
    $('#badge-rate').textContent = p ? p.sampleRate + ' Hz' : '— Hz';
    $('#badge-ch').textContent = p ? p.channels + ' ch' : '— ch';
}

function paintZoom() {
    const v = waveform.view, span = v.to - v.from;
    $('#zoom').textContent = (span > 0 && doc.duration > 0 ? Math.max(1, doc.duration / span) : 1).toFixed(1) + 'x';
}

// --- controls ---------------------------------------------------------------------------

const source = $('#source');
for (const [value, label] of SOURCES) source.appendChild(h('option', { value }, label));
const custom = $('#custom-path');
function currentSource() { return source.value === 'custom' ? custom.value.trim() : source.value; }
source.addEventListener('change', () => {
    custom.hidden = source.value !== 'custom';
    if (source.value !== 'custom') inspect(source.value);
});
custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') inspect(currentSource()); });
$('#inspect').addEventListener('click', () => inspect(currentSource()));

/** Open a file chosen in the native dialog as the custom source. */
function browse() {
    const f = pickFile('Media|webm;mp4;mkv;mov;ogg;opus;mp3;wav;flac;m4a');
    if (f) openCustom(f.replace(/\\/g, '/'));
}
$('#browse').addEventListener('click', browse);
function openCustom(p) {
    source.value = 'custom';
    custom.hidden = false;
    custom.value = p;
    return inspect(p);
}

$('#play').addEventListener('click', () => player.toggle());
$('#stop').addEventListener('click', () => player.stop());
$('#step-back').addEventListener('click', () => player.step(-1));
$('#step-fwd').addEventListener('click', () => player.step(1));
const loop = toggleButton('#loop', { onChange: (on) => { player.loop = on; } });
$('#rate').addEventListener('change', () => { player.rate = parseFloat($('#rate').value) || 1; });
const mute = toggleButton('#mute', { labels: ['Mute', 'Unmute'], onChange: (on) => { player.muted = on; } });
bindControl('#volume', { onChange: (v) => { player.volume = v; if (v > 0) mute.on = false; } });

$('#zoom-in').addEventListener('click', () => waveform.zoom(1.5));
$('#zoom-out').addEventListener('click', () => waveform.zoom(1 / 1.5));
$('#zoom-fit').addEventListener('click', () => waveform.fit());
/** Re-analyse the selected region: full bucket and thumbnail resolution over just that span. */
function zoomRegion() {
    const sel = waveform.selection;
    if (!sel) { app.status.warn('shift-drag on the waveform to select a region first'); return Promise.resolve(false); }
    return runAnalysis(sel);
}
$('#zoom-region').addEventListener('click', zoomRegion);

params('#analysis-params', opts, {
    buckets: { type: 'number', min: 64, max: 8192, step: 64, label: 'peak buckets' },
    count: { type: 'number', min: 4, max: 64, step: 4, label: 'thumbnails' },
    height: { type: 'number', min: 24, max: 240, step: 8, label: 'thumb height' },
});
$('#reanalyze').addEventListener('click', () => runAnalysis(doc.span.to < doc.duration || doc.span.from > 0 ? doc.span : {}));
$('#reset-span').addEventListener('click', () => runAnalysis({}));

window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(player.time - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(player.time + 1); }
    else if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
    else if (e.key === 'Escape') waveform.fit();
});

const zone = $('#drop-zone'), dropOverlay = $('#drop-overlay');
zone.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('show'); });
zone.addEventListener('dragleave', (e) => { e.preventDefault(); dropOverlay.classList.remove('show'); });
zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('show');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    const p = f ? (f.path || f.name || '').replace(/\\/g, '/') : '';
    if (p) openCustom(p); else app.status.warn('the drop carried no path');
});
window.addEventListener('resize', () => { waveform.render(); filmstrip.render(); });

// --- go ------------------------------------------------------------------------------------

const badge = $('#badge-media');
badge.textContent = 'bro.media: ' + (mediaOn ? 'on' : 'off');
badge.classList.add(mediaOn ? 'ok' : 'err');
const ready = inspect(source.value);

/** Handles for tests. */
export const inspector = {
    waveform, filmstrip, player, analyzer, doc, opts, loop, mute, ready,
    inspect, runAnalysis, zoomRegion, openCustom, audioMeta, videoMeta,
    get status() { return app.status; },
};
