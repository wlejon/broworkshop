// Reader playback on the real async TTS path (GPU): Kokoro load, audible
// playback with sentence + word highlight, prefetch, click-to-read, position
// persistence, sleep timer, WAV export, and Qwen3-TTS when its checkpoint is
// present. Synthesis runs in wall time, so waits pump with waitFor.
// Run: scripts/validate.sh --ml tools/reader

import { check, eq, test, done, frames, waitFor, clickOn, setValue, text, q, shot, skip } from "/lib/kit/test.js";
import { gpuAvailable } from "/lib/kit/ml.js";
import { library, loadLibrary, addDocument, LIBRARY_KEY } from "/app/lib/docs.js";
import { prefs, settings, saveSettings } from "/app/lib/state.js";
import { engines, paths } from "/app/lib/engine.js";
import * as player from "/app/lib/player.js";
import { ps } from "/app/lib/player.js";
import { openDocument } from "/app/lib/reader.js";
import { renderLibrary } from "/app/lib/library.js";
import { exportToPath } from "/app/lib/exporter.js";

const fs = require('fs');
if (!bro.tts || bro.tts.available === false || !gpuAvailable()) skip('needs bro.tts and a GPU');
if (!fs.existsSync(paths().kokoro + '/config.json')) skip('no Kokoro weights at ' + paths().kokoro);

const savedLibrary = localStorage.getItem(LIBRARY_KEY);
const savedPrefs = prefs.snapshot();
const tmp = require('os').tmpdir().replace(/\\/g, '/') + '/bro-reader-test';
const sn = (i) => document.querySelectorAll('#reader-text .sn')[i];
const active = () => document.querySelector('.sn.active');

const SAMPLE = [
    'The lighthouse keeper woke before dawn. Fog had settled over the harbor during the night. He climbed the spiral stairs slowly, counting each step.',
    'At the top, the great lamp waited in silence. He struck a match and lit the wick. Light swept across the dark water for the first time that day.',
    'Far below, a fishing boat answered with a single horn blast. The day had begun.',
].join('\n\n');

try {
    localStorage.setItem(LIBRARY_KEY, '[]');
    Object.assign(settings, { engine: 'kokoro', kokoroVoice: 'af_heart', speed: 1, theme: 'dark' });
    saveSettings();
    loadLibrary();
    const doc = addDocument('The Lighthouse', SAMPLE);
    renderLibrary();
    frames(2);

    test('Read opens the document in the reader', () => {
        clickOn('.card .open');
        check(!q('#reader-view').hidden && q('#library-view').hidden, 'reader view shown');
        eq(text('#doc-title'), 'The Lighthouse', 'title');
        eq(document.querySelectorAll('#reader-text .sn').length, 8, 'sentence spans');
        eq(document.querySelectorAll('#reader-text p').length, 3, 'paragraphs');
        eq(q('#engine-sel').value, 'kokoro', 'engine picker');
    });

    test('Kokoro loads and lists voices', () => {
        waitFor(() => engines.kokoro.status !== 'loading' && engines.kokoro.status !== 'idle', 'kokoro load', 120000);
        eq(engines.kokoro.status, 'ready', 'status (' + engines.kokoro.error + ')');
        check(engines.kokoro.voices.length > 0 && engines.kokoro.voice, 'voices + one loaded');
        frames(1);
        check(q('#backend').classList.contains('ok') && /Kokoro ready/.test(text('#backend')), 'badge: ' + text('#backend'));
        check(q('#voice-sel').options.length === engines.kokoro.voices.length, 'voice picker filled');
        console.log('  kokoro ready in ' + (engines.kokoro.loadMs / 1000).toFixed(1) + 's, ' + engines.kokoro.voices.length + ' voices');
    });

    const actx = player.audioCtx();
    test('Play speaks with sentence and word highlight', () => {
        clickOn('#btn-play');
        waitFor(() => ps.playing && !ps.buffering, 'sentence 0 playing', 120000);
        eq(active().dataset.i, '0', 'sentence 0 highlighted');
        eq(text('#btn-play'), '▮▮', 'pause glyph');
        waitFor(() => actx.getBusPeakL(0) > 0.02, 'audible output', 30000);
        waitFor(() => document.querySelector('.sn.active .w.wcur'), 'word highlight', 30000);
        check(document.querySelectorAll('.sn.active .w').length >= 5, 'active sentence split into words');
        check(/sentence 1 \/ 8/.test(text('#progress')), 'progress: ' + text('#progress'));
        shot('reading');
    });

    test('playback advances with the next sentence prefetched', () => {
        waitFor(() => ps.cur >= 1 && !ps.buffering, 'advance to sentence 2', 180000);
        eq(parseInt(active().dataset.i, 10), ps.cur, 'highlight follows playback');
        waitFor(() => player.peekCache(ps.cur + 1) || ps.cur >= 7, 'prefetch ahead', 120000);
    });

    test('clicking a sentence reads from there', () => {
        // index 6 starts paragraph 3, so its first line starts the span
        const r = sn(6).getBoundingClientRect();
        click(r.x + 10, r.y + 10);
        waitFor(() => ps.cur === 6, 'jump', 60000);
        eq(active().dataset.i, '6', 'clicked sentence active');
    });

    test('pausing persists the reading position', () => {
        clickOn('#btn-play');
        check(!ps.playing, 'paused');
        const rec = JSON.parse(localStorage.getItem(LIBRARY_KEY)).find((d) => d.id === doc.id);
        eq(rec.pos, 6, 'persisted pos');
    });

    test('the sleep timer stops playback', () => {
        player.jumpTo(0, true);
        waitFor(() => ps.playing && !ps.buffering, 'replaying', 120000);
        player.setSleep('min', 0.05);                 // 3 s on the audio clock
        check(/sleep in 0.05 min/.test(text('#sleep-meta')), 'sleep readout: ' + text('#sleep-meta'));
        waitFor(() => !ps.playing, 'sleep stop', 60000);
        eq(ps.sleep.mode, 'off', 'timer cleared');
        setValue('#sleep-sel', 'para');
        eq(ps.sleep.mode, 'paragraph', 'end-of-paragraph mode from the picker');
        setValue('#sleep-sel', 'off');
    });

    test('WAV export writes three sentences', () => {
        fs.mkdirSync(tmp, { recursive: true });
        const wav = tmp + '/_export.wav';
        try { fs.unlinkSync(wav); } catch (e) {}
        let finished = false, err = 'pending';
        exportToPath(wav, { from: 0, to: 2, onDone: (e) => { err = e; finished = true; } });
        check(!q('#export-modal').hidden, 'progress dialog shown');
        waitFor(() => finished, 'export', 300000);
        eq(err, null, 'export error');
        const size = fs.statSync(wav).size;
        check(size > 24000, 'wav size ' + size);
        check(/saved/.test(text('#export-status')), 'status: ' + text('#export-status'));
        fs.unlinkSync(wav);
    });

    const qdir = paths().qwen;
    test('Qwen3-TTS reads with sentence-level highlight (or reports missing weights)', () => {
        setValue('#engine-sel', 'qwen');
        eq(doc.engine, 'qwen', 'per-document engine');
        if (!fs.existsSync(qdir + '/config.json')) {
            waitFor(() => engines.qwen.status === 'error', 'qwen error state', 60000);
            check(engines.qwen.error.indexOf(qdir) >= 0, 'error names the path: ' + engines.qwen.error);
            frames(1);
            check(q('#backend').classList.contains('err'), 'badge shows the error');
            return;
        }
        waitFor(() => engines.qwen.status === 'ready' || engines.qwen.status === 'error', 'qwen load', 600000);
        eq(engines.qwen.status, 'ready', 'qwen (' + engines.qwen.error + ')');
        check(engines.qwen.speakers.length > 0, 'speakers listed');
        player.jumpTo(7, true);                       // the last sentence is short
        waitFor(() => ps.playing && !ps.buffering, 'qwen playing', 600000);
        waitFor(() => actx.getBusPeakL(0) > 0.02, 'qwen audible', 60000);
        eq(active().dataset.i, '7', 'sentence highlighted');
        check(!document.querySelector('.sn.active .w'), 'no word spans without timings');
        shot('reading-qwen');
        player.pause();
    });

    test('back to the library keeps progress', () => {
        clickOn('#btn-back');
        check(!q('#library-view').hidden, 'library shown');
        check(/Continue/.test(text('.card .open')), 'resume button: ' + text('.card .open'));
        eq(library.length, 1, 'one document');
    });
} finally {
    player.pause();
    if (savedLibrary == null) localStorage.removeItem(LIBRARY_KEY); else localStorage.setItem(LIBRARY_KEY, savedLibrary);
    prefs.restore(savedPrefs);
}
done('reader tts');
