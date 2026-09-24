// clip/panel.js — the clip editor view: toolbar, process panels, transport
// and keyboard shortcuts over a clip doc.
//
// Keys (editor view only): Space play/stop, Delete/Backspace delete,
// Ctrl+X/C/V/A cut/copy/paste/select all, Ctrl+Z/Y undo/redo (kit
// documentCommands), Home/End, arrows move the cursor (Ctrl x10, Shift
// extends the selection), + - 0 zoom, L loop, Escape clears the selection.

import { $, $$ } from "/lib/kit/dom.js";
import { segmented } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { transport } from "/lib/kit/audio-ui.js";
import { documentCommands } from "/lib/kit/editor.js";
import { clipView } from "./view.js";
import { fmtTime } from "./doc.js";

const msFmt = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 's' : v + 'ms');

export function clipPanel(doc, { active }) {
    const view = clipView($('#ed-canvas'), doc, { onHover: (i) => { $('#ed-cursor').textContent = fmtTime(i / doc.rate); } });
    const s = doc.state;
    const click = (id, fn) => $(id).addEventListener('click', fn);

    const commands = documentCommands({
        history: doc.history, canRun: active,
        undoButton: '#ed-undo', redoButton: '#ed-redo',
    });

    // transport: play/pause + seek + time over the clip
    const deck = transport({ toggle: '#ed-toggle', seek: '#ed-seek', time: '#ed-time' }, {
        duration: () => doc.length / doc.rate,
        position: () => s.cursor / doc.rate,
        seek: (sec) => doc.setCursor(sec * doc.rate),
        setPlaying: (on) => { if (on) doc.play(); else doc.stop(); },
        playing: () => doc.playing,
    });
    const loop = $('#ed-loop');
    const toggleLoop = () => loop.classList.toggle('active', doc.toggleLoop());
    click('#ed-loop', toggleLoop);

    const rec = $('#ed-record');
    const paintRec = () => {
        rec.textContent = doc.recording ? 'stop rec' : 'rec';
        rec.classList.toggle('danger', doc.recording);
        rec.classList.toggle('active', doc.recording);
    };
    click('#ed-record', () => { if (doc.recording) doc.stopRecording(); else doc.record(); paintRec(); });
    click('#ed-load', () => {
        const files = typeof showOpenFileDialog === 'function' ? showOpenFileDialog('Audio Files|wav;flac;mp3;ogg;opus') : null;
        if (files && files.length) doc.loadFile(files[0]);
    });
    click('#ed-save', () => doc.saveFile());

    click('#ed-cut', doc.cut);
    click('#ed-copy', doc.copy);
    click('#ed-paste', doc.paste);
    click('#ed-delete', doc.deleteSelection);
    click('#ed-silence', doc.silence);
    click('#ed-trim', doc.trim);
    click('#ed-select-all', doc.selectAll);
    click('#ed-zoom-in', doc.zoomIn);
    click('#ed-zoom-out', doc.zoomOut);
    click('#ed-zoom-fit', doc.zoomFit);
    click('#ed-zoom-sel', doc.zoomSelection);

    click('#ed-normalize', doc.normalize);
    click('#ed-reverse', doc.reverse);
    click('#ed-fade-in', doc.fadeIn);
    click('#ed-fade-out', doc.fadeOut);

    // "set a value, then apply" controls reset to neutral after applying
    const applier = (input, out, fmt, neutral, apply) => {
        const c = bindControl(input, { out, fmt });
        return () => { apply(c.value); c.value = neutral; };
    };
    click('#ed-gain-apply', applier('#ed-gain', '#ed-gain-val', (v) => (v > 0 ? '+' : '') + v + 'dB', 0, (v) => doc.gain(v)));
    click('#ed-pitch-apply', applier('#ed-pitch', '#ed-pitch-val', (v) => (v > 0 ? '+' : '') + v, 0, (v) => doc.pitch(v)));
    click('#ed-speed-apply', applier('#ed-speed', '#ed-speed-val', (v) => v + '%', 100, (v) => doc.speed(v)));
    for (const b of $$('[data-semi]')) b.addEventListener('click', () => doc.pitch(+b.dataset.semi));
    for (const b of $$('[data-speed]')) b.addEventListener('click', () => doc.speed(+b.dataset.speed));

    const silenceDur = bindControl('#ed-silence-dur', { out: '#ed-silence-dur-val', fmt: msFmt });
    click('#ed-insert-silence', () => doc.insertSilence(silenceDur.value));

    const genFreq = bindControl('#ed-gen-freq', { out: '#ed-gen-freq-val', fmt: (v) => v + 'Hz' });
    const genDur = bindControl('#ed-gen-dur', { out: '#ed-gen-dur-val', fmt: msFmt });
    const genWave = segmented('#ed-gen-wave', { sine: 'Sin', square: 'Sqr', sawtooth: 'Saw', triangle: 'Tri' }, { value: 'sine' });
    click('#ed-generate', () => doc.generateTone(genFreq.value, genDur.value, genWave.value));
    click('#ed-gen-noise', () => doc.generateNoise(genDur.value));

    const useBtn = $('#ed-use-clip');
    click('#ed-use-clip', () => doc.useAsInstrument());
    click('#ed-clear-clip', () => doc.clearInstrument());

    /** Editor shortcuts; true when the key was one (the piano then ignores it). */
    function handleKey(e) {
        if (!active()) return false;
        const k = e.key, ctrl = e.ctrlKey || e.metaKey;
        if (ctrl) {
            const c = k.toLowerCase();
            if (c === 'x') return doc.cut(), true;
            if (c === 'c') return doc.copy(), true;
            if (c === 'v') return doc.paste(), true;
            if (c === 'a') return doc.selectAll(), true;
            return false;
        }
        if (!s.pcm) return false;
        if (k === 'Delete' || k === 'Backspace') return doc.deleteSelection(), true;
        if (k === ' ') return (doc.playing ? doc.stop() : doc.play()), true;
        if (k === 'Home') return doc.setCursor(0), true;
        if (k === 'End') return doc.setCursor(doc.length), true;
        if (k === '+' || k === '=') return doc.zoomIn(), true;
        if (k === '-') return doc.zoomOut(), true;
        if (k === '0') return doc.zoomFit(), true;
        if (k === 'Escape') return doc.clearSelection(), true;
        if (k === 'l' || k === 'L') return toggleLoop(), true;
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
            const step = Math.max(1, Math.round((s.view.b - s.view.a) / 100)) * (ctrl ? 10 : 1);
            const from = s.cursor;
            const to = Math.max(0, Math.min(doc.length, from + (k === 'ArrowLeft' ? -step : step)));
            if (e.shiftKey) {
                const anchor = s.sel ? (from === s.sel.a ? s.sel.b : s.sel.a) : from;
                doc.select(anchor, to);
            }
            doc.setCursor(to);
            if (to < s.view.a || to > s.view.b) {
                const span = s.view.b - s.view.a;
                doc.setView(to - span * 0.1, to - span * 0.1 + span);
            }
            return true;
        }
        return false;
    }
    // Ctrl combos arrive here; plain keys come through the piano's handler
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && handleKey(e)) e.preventDefault(); });

    let dirty = true;
    doc.on((what) => { if (what === 'change') dirty = true; });

    return {
        handleKey,
        commands,
        view,
        /** Once a frame while the editor is visible. */
        update() {
            doc.tick();
            deck.update();
            paintRec();
            useBtn.classList.toggle('active', !!s.instrument);
            loop.classList.toggle('active', s.looping);
            if (dirty) {
                dirty = false;
                view.draw();
                $('#ed-zoom').textContent = doc.zoomPercent + '%';
            }
        },
        /** Redraw on the next update (the view was hidden or resized). */
        invalidate() { dirty = true; },
        /** One-line clip summary for the status bar. */
        summary() {
            if (!s.pcm) return 'none';
            let t = fmtTime(doc.length / doc.rate);
            if (s.sel) t += ', sel ' + fmtTime((s.sel.b - s.sel.a) / doc.rate);
            return t;
        },
    };
}
