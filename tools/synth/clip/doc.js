// clip/doc.js — the clip editor's document: one mono clip at the engine
// rate, a selection, a view window, a cursor, a clipboard, and the engine
// clip that plays it. No DOM.
//
// Every edit goes through edit(): the sample ops (ops.js) return a new
// array, so an undo step is just the before/after references (lib/history.js
// History). Loading a new clip (file, recording, generator) starts a fresh
// history, as opening a document does.

import "/lib/history.js";
import { decodeAudioFile, saveWav } from "/lib/kit/audio.js";
import * as ops from "./ops.js";

const MIN_VIEW = 200;          // samples visible at full zoom

export function fmtTime(sec) {
    if (!(sec > 0)) sec = 0;
    const m = Math.floor(sec / 60), s = sec - m * 60;
    if (m > 0) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    if (sec >= 1) return s.toFixed(2) + 's';
    return (sec * 1000).toFixed(1) + 'ms';
}

const baseName = (p) => String(p).split(/[\\/]/).pop();

export function createClipDoc({ ctx, player, recorder }) {
    const rate = ctx ? ctx.sampleRate : 44100;
    const history = new History({ limit: 30 });
    const s = {
        pcm: null, sel: null, view: { a: 0, b: 0 }, cursor: 0,
        clipboard: null, looping: false, instrument: false,
    };
    let clipId = -1, pb = -1, playA = 0, playB = 0, playStarted = 0;
    const listeners = [];
    const emit = (what, text) => { for (const fn of listeners) fn(what, text); };
    const status = (text) => emit('status', text);
    const changed = () => emit('change');

    const len = () => (s.pcm ? s.pcm.length : 0);
    const range = () => (s.sel ? [s.sel.a, s.sel.b] : [0, len()]);

    function clamp() {
        const n = len();
        if (s.sel) {
            s.sel.a = Math.max(0, Math.min(n, s.sel.a));
            s.sel.b = Math.max(0, Math.min(n, s.sel.b));
            if (s.sel.b - s.sel.a < 2) s.sel = null;
        }
        let { a, b } = s.view;
        b = Math.min(b, n);
        const minW = Math.min(MIN_VIEW, n);
        if (b - a < minW) { a = Math.max(0, b - minW); b = Math.min(n, a + minW); }
        s.view = { a: Math.max(0, a), b };
        s.cursor = Math.max(0, Math.min(n, s.cursor));
    }

    // ---- the engine clip -----------------------------------------------------

    function rebuildClip() {
        const wasPlaying = pb >= 0;
        stopPlayback();
        if (clipId >= 0 && ctx) ctx.deleteClip(clipId);
        clipId = -1;
        if (ctx && len() > 0) clipId = ctx.createClip(s.pcm);
        if (s.instrument) player.setClipInstrument(clipId);
        if (wasPlaying) api.play();
    }

    function stopPlayback() {
        if (pb >= 0 && ctx) ctx.stopPlayback(pb);
        pb = -1;
    }

    // ---- history -------------------------------------------------------------

    const snapshot = () => ({ pcm: s.pcm, sel: s.sel && { a: s.sel.a, b: s.sel.b }, view: { a: s.view.a, b: s.view.b } });
    function restore(st) {
        s.pcm = st.pcm;
        s.sel = st.sel && { a: st.sel.a, b: st.sel.b };
        s.view = { a: st.view.a, b: st.view.b };
        clamp();
        rebuildClip();
        changed();
    }

    /** Run an edit (fn mutates s, returns false to abort) as one undo step. */
    function edit(label, fn) {
        if (!s.pcm) return false;
        const before = snapshot();
        if (fn() === false) return false;
        clamp();
        const after = snapshot();
        history.record(label, () => restore(after), () => restore(before));
        rebuildClip();
        changed();
        status(label);
        return true;
    }

    /** Replace the region [a, b) with the op's result; select the result. */
    function regionEdit(label, op) {
        return edit(label, () => {
            const [a, b] = range();
            const r = op(s.pcm, a, b);
            if (r.pcm) {
                s.pcm = r.pcm;
                if (s.sel) s.sel = { a, b: a + r.len };
            } else {
                s.pcm = r;
            }
        });
    }

    const needSel = (fn) => () => (s.sel ? fn() : (status('select a region first'), false));

    const api = {
        history,
        state: s,
        rate,
        on(fn) { listeners.push(fn); },
        get samples() { return s.pcm; },
        get length() { return len(); },
        get clipId() { return clipId; },
        get playing() { return pb >= 0; },
        get selection() { return s.sel ? { a: s.sel.a, b: s.sel.b } : null; },

        /** A new clip: fresh view, selection and history. */
        load(pcm, label) {
            stopPlayback();
            s.pcm = pcm && pcm.length ? new Float32Array(pcm) : null;
            s.sel = null;
            s.view = { a: 0, b: len() };
            s.cursor = 0;
            history.clear();
            rebuildClip();
            changed();
            status(label || (s.pcm ? 'loaded ' + fmtTime(len() / rate) : 'no clip'));
        },

        loadFile(path) {
            const dec = ctx ? decodeAudioFile(path, rate) : null;
            if (!dec) { status('could not decode ' + baseName(path)); return false; }
            api.load(dec.pcm, 'loaded ' + baseName(path));
            return true;
        },

        /** Write the selection (or everything) as WAV; no path opens a save dialog. */
        saveFile(path) {
            if (!s.pcm) return null;
            const [a, b] = range();
            const out = saveWav(s.pcm.slice(a, b), rate, { path, defaultName: 'clip.wav' });
            if (out) status('saved ' + baseName(out));
            return out;
        },

        // ---- recording the output mix -------------------------------------------
        get recording() { return recorder.owner === 'clip'; },
        record() {
            if (!recorder.start('clip')) { status('the sequencer is recording'); return false; }
            status('recording: play something');
            return true;
        },
        stopRecording() {
            if (recorder.owner !== 'clip') return false;
            const pcm = recorder.stop();
            if (pcm) api.load(pcm, 'recorded ' + fmtTime(pcm.length / rate));
            else status('nothing was recorded');
            return !!pcm;
        },

        generateTone(hz, ms, waveform) {
            api.load(ops.tone(hz, ms / 1000, waveform, rate), 'generated ' + hz + 'Hz ' + waveform + ' (' + ms + 'ms)');
        },
        generateNoise(ms) { api.load(ops.noise(ms / 1000, rate), 'generated white noise (' + ms + 'ms)'); },

        // ---- edits ----------------------------------------------------------------
        trim: needSel(() => edit('trim to selection', () => {
            s.pcm = ops.trim(s.pcm, s.sel.a, s.sel.b);
            s.sel = null; s.view = { a: 0, b: s.pcm.length }; s.cursor = 0;
        })),
        deleteSelection: needSel(() => edit('delete selection', () => {
            s.pcm = ops.cut(s.pcm, s.sel.a, s.sel.b);
            s.cursor = s.sel.a; s.sel = null;
        })),
        copy: needSel(() => {
            s.clipboard = s.pcm.slice(s.sel.a, s.sel.b);
            status('copied ' + fmtTime(s.clipboard.length / rate));
            return true;
        }),
        cut: needSel(() => {
            s.clipboard = s.pcm.slice(s.sel.a, s.sel.b);
            return api.deleteSelection();
        }),
        /** Paste over the selection, or at the cursor; the pasted audio ends up selected. */
        paste() {
            if (!s.clipboard) { status('nothing to paste'); return false; }
            const clip = s.clipboard;
            return edit('paste ' + fmtTime(clip.length / rate), () => {
                const [a, b] = s.sel ? [s.sel.a, s.sel.b] : [s.cursor, s.cursor];
                s.pcm = ops.splice(s.pcm, a, b, clip);
                s.sel = { a, b: a + clip.length };
                s.view.b = Math.max(s.view.b, Math.min(s.pcm.length, s.sel.b));
            });
        },
        silence: needSel(() => edit('silence selection', () => { s.pcm = ops.silence(s.pcm, s.sel.a, s.sel.b); })),
        reverse: () => regionEdit('reverse', ops.reverse),
        normalize: () => regionEdit('normalize', ops.normalize),
        fadeIn: () => regionEdit('fade in', ops.fadeIn),
        fadeOut: () => regionEdit('fade out', ops.fadeOut),
        gain: (dB) => regionEdit('gain ' + (dB >= 0 ? '+' : '') + dB + 'dB', (p, a, b) => ops.gain(p, a, b, dB)),
        pitch: (semi) => (semi ? regionEdit('pitch ' + (semi > 0 ? '+' : '') + semi + ' st', (p, a, b) => ops.pitchShift(p, a, b, semi)) : false),
        /** Speed in percent (200 = twice as fast, half as long). */
        speed: (percent) => (percent !== 100 ? regionEdit('speed ' + percent + '%', (p, a, b) => ops.resampleRegion(p, a, b, 100 / percent)) : false),
        insertSilence(ms) {
            const n = Math.round(ms / 1000 * rate);
            return edit('insert ' + ms + 'ms silence', () => {
                const at = s.sel ? s.sel.a : s.cursor;
                s.pcm = ops.splice(s.pcm, at, at, new Float32Array(n));
                s.sel = { a: at, b: at + n };
            });
        },

        // ---- selection, cursor, view -------------------------------------------------
        select(a, b) {
            if (!s.pcm) return;
            const lo = Math.max(0, Math.min(a, b)), hi = Math.min(len(), Math.max(a, b));
            s.sel = hi - lo > 10 ? { a: lo, b: hi } : null;
            changed();
        },
        selectAll() { if (s.pcm) { s.sel = { a: 0, b: len() }; changed(); } },
        clearSelection() { s.sel = null; changed(); },
        setCursor(x) {
            s.cursor = Math.max(0, Math.min(len(), Math.round(x)));
            if (pb >= 0) api.play(true);
            changed();
        },
        setView(a, b) {
            const n = len();
            let w = Math.max(Math.min(MIN_VIEW, n), Math.min(n, Math.round(b - a)));
            a = Math.max(0, Math.min(n - w, Math.round(a)));
            s.view = { a, b: a + w };
            changed();
        },
        zoom(factor, anchor) {
            if (!s.pcm) return;
            const { a, b } = s.view, w = b - a;
            const at = anchor == null ? (a + b) / 2 : anchor;
            const nw = Math.max(MIN_VIEW, Math.min(len(), Math.round(w * factor)));
            api.setView(at - (at - a) * (nw / w), at - (at - a) * (nw / w) + nw);
        },
        zoomIn() { api.zoom(0.5); },
        zoomOut() { api.zoom(2); },
        zoomFit() { if (s.pcm) api.setView(0, len()); },
        zoomSelection() {
            if (!s.sel) return;
            const pad = Math.max(1, Math.floor((s.sel.b - s.sel.a) * 0.05));
            api.setView(s.sel.a - pad, s.sel.b + pad);
        },
        get zoomPercent() { return s.pcm ? Math.round(len() / Math.max(1, s.view.b - s.view.a) * 100) : 100; },

        // ---- playback ----------------------------------------------------------------
        /** Play the selection, else from the cursor to the end. */
        play(fromCursor) {
            if (clipId < 0 || !ctx) return false;
            stopPlayback();
            let [a, b] = s.sel && !fromCursor ? [s.sel.a, s.sel.b] : [s.cursor, len()];
            if (s.sel && fromCursor) b = s.sel.b > s.cursor ? s.sel.b : len();
            if (a >= b - 1) { a = 0; b = len(); }
            pb = ctx.playClip(clipId, 1, s.looping);
            if (pb < 0) return false;
            ctx.setPlaybackRegion(pb, a, b);
            playA = a; playB = b; playStarted = ctx.currentTime;
            changed();
            return true;
        },
        stop() { stopPlayback(); changed(); },
        toggleLoop() {
            s.looping = !s.looping;
            if (pb >= 0) ctx.setPlaybackLoop(pb, s.looping);
            changed();
            return s.looping;
        },
        /** Once a frame: follow the playhead, notice the end. */
        tick() {
            if (pb < 0) return;
            const pos = ctx.getPlaybackPositionSeconds(pb) * rate;
            const span = playB - playA;
            s.cursor = playA + Math.floor(s.looping ? pos % span : Math.min(pos, span));
            if (!s.looping && !ctx.isClipPlaying(pb) && ctx.currentTime - playStarted > 0.05) {
                pb = -1;
                s.cursor = playA;
            }
            changed();
        },

        // ---- keyboard instrument -------------------------------------------------------
        useAsInstrument() {
            if (clipId < 0) { status('no clip to play'); return false; }
            s.instrument = true;
            player.setClipInstrument(clipId);
            status('the keyboard plays the clip (C4 = original pitch)');
            return true;
        },
        clearInstrument() {
            s.instrument = false;
            player.setClipInstrument(-1);
            status('the keyboard plays the oscillators');
        },
    };
    return api;
}
