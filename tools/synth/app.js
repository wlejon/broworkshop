// app.js — builds the synth: the engine side (song, player, sequencer, mic,
// MIDI, recorder), the two views, the undo history and the project file.
//
// Layout of the code:
//   audio/   broaudio glue, no DOM: sounds on buses + allocators, the global
//            LFO, sequencing + arpeggios, offline loop render, mic, MIDI
//   model/   the song document (layers, steps, automation) and presets
//   ui/      synth view: sidebar sound editor, scopes, layer grid,
//            automation lanes, piano, header + sequencer bar
//   clip/    clip editor: sample ops, the clip document, its canvas, its panel
//
// Undo: every song edit (song.onEdit) records a before/after snapshot in a
// History; consecutive edits of one control within a second merge, so a
// slider drag is one step. Files: File > New / Open / Save (lib/project.js
// bundles, `<name>.synth/project.json`) through the kit's documentCommands.
// The clip editor keeps its own history (its undo/redo act in that view).

import { History } from "/lib/kit/history.js";
import { Project } from "/lib/kit/project.js";
import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { stats as statsLine, tabs, frameLoop, fpsMeter } from "/lib/kit/ui.js";
import { audioContext } from "/lib/kit/audio.js";
import { documentCommands } from "/lib/kit/editor.js";
import { Song } from "./model/song.js";
import { presetStore } from "./model/presets.js";
import { createPlayer } from "./audio/player.js";
import { createSequencer } from "./audio/sequencer.js";
import { createRecorder } from "./audio/recorder.js";
import { createMic } from "./audio/mic.js";
import { createMidi } from "./audio/midi.js";
import { midiToHz, noteName } from "./audio/notes.js";
import { sidebar } from "./ui/sidebar.js";
import { scopes as scopeStack } from "./ui/scopes.js";
import { grid as layerGrid } from "./ui/grid.js";
import { piano as pianoKeys } from "./ui/piano.js";
import { presetControls, headerControls, seqControls } from "./ui/controls.js";
import { createClipDoc } from "./clip/doc.js";
import { clipPanel } from "./clip/panel.js";

/** Live handles (tests read state through this object). */
export const synth = {};

function openContext() {
    try {
        const ctx = audioContext();
        // the master bus stays clean: effects live on the layer buses
        ctx.setBusCompressorEnabled(0, false);
        ctx.setBusDelayEnabled(0, false);
        ctx.setBusReverbEnabled(0, false);
        ctx.setBusChorusEnabled(0, false);
        ctx.setBusEqEnabled(0, false);
        return ctx;
    } catch (e) {
        console.warn('AudioContext unavailable: ' + e.message);
        return null;
    }
}

/** Snapshot undo over song.serialize(), merged per control while it is dragged. */
function songHistory(song, sequencer) {
    const history = new History({ limit: 200 });
    history.coalesce((a, b) => !!(a.meta && b.meta) && a.meta.key === b.meta.key && b.time - a.time < 1000);
    let snap = song.serialize(), text = JSON.stringify(snap);
    const restore = (d) => {
        song.load(d);
        snap = d; text = JSON.stringify(d);
        sequencer.invalidate();
    };
    song.onEdit = (label, key) => {
        sequencer.invalidate();
        const next = song.serialize(), nextText = JSON.stringify(next);
        if (nextText === text) return;
        const prev = snap;
        snap = next; text = nextText;
        history.record(label, () => restore(next), () => restore(prev), { key });
    };
    return { history, resync() { snap = song.serialize(); text = JSON.stringify(snap); } };
}

export function start() {
    const ctx = openContext();
    const song = new Song(ctx);
    const player = createPlayer(ctx, song);
    const sequencer = createSequencer(ctx, song);
    const recorder = createRecorder(ctx);
    const mic = createMic(ctx);
    const midi = createMidi(ctx, player);
    const presets = presetStore();
    const undo = songHistory(song, sequencer);
    song.on((what) => { if (what === 'tempo') sequencer.tempoChanged(); });

    const project = new Project({
        app: 'synth', schema: 1, fileExt: 'synth', history: undo.history,
        serialize: () => song.serialize(),
        deserialize: (d) => { sequencer.stop(); song.load(d); undo.resync(); },
        onNew: () => { sequencer.stop(); song.reset(); undo.resync(); },
    });

    let view = 'synth';
    const docCommands = documentCommands({
        history: undo.history, project,
        canRun: () => view === 'synth',
        undoButton: '#undo', redoButton: '#redo',
    });
    const { status } = boot({ menu: docCommands.menu });
    const docName = () => project.name + (project.isDirty() ? ' *' : '');
    project.on('change', () => { document.title = 'Synth - ' + docName(); });

    // --- views ------------------------------------------------------------------
    const clip = createClipDoc({ ctx, player, recorder });
    const clipUi = clipPanel(clip, { active: () => view === 'editor' });
    clip.on((what, text) => { if (what === 'status') status.set(text); });

    const scopes = scopeStack($('#scopes'), { song, mic, ctx });
    const side = sidebar($('#sidebar'), { song });
    const grid = layerGrid($('#grid'), { song, player, sequencer, ctx });
    const presetUi = presetControls({ song, presets, status });
    const header = headerControls({ ctx, song, mic, midi, scopes, status });
    const seqBar = seqControls({ ctx, song, sequencer, recorder, status });
    const piano = pianoKeys($('#piano'), { player, octaveLabel: $('#octave-name'), handleKey: clipUi.handleKey });

    const viewTabs = tabs('#views', {
        onChange: (name) => {
            view = name;
            if (name === 'editor') clipUi.invalidate();
        },
    });

    // --- status line -----------------------------------------------------------------
    const stats = statsLine('#stats', { note: 'note', freq: 'freq', mic: 'mic', clip: 'clip', fps: 'fps' });
    stats.set({ note: '--', freq: '--', mic: '--', clip: 'none', fps: '--' });
    player.on(() => {
        const held = player.heldNotes;
        const m = held.length ? held[held.length - 1] : null;
        stats.set({ note: m == null ? '--' : noteName(m), freq: m == null ? '--' : midiToHz(m).toFixed(1) + ' Hz' });
    });
    clip.on((what) => { if (what === 'change') stats.set('clip', clipUi.summary()); });
    status.set(ctx ? 'ready: play the keys A-; (Tab shifts the octave), click steps to write notes'
                   : 'no audio device: the synth is silent');

    // --- frame loop --------------------------------------------------------------------
    const fps = fpsMeter();
    let frame = 0;
    const loop = frameLoop(() => {
        frame++;
        midi.pump();
        sequencer.update();
        header.update();
        grid.update();
        if (view === 'synth') scopes.draw();
        else clipUi.update();
        if (frame % 6 === 0) {
            const p = mic.pitch();
            stats.set('mic', p ? p.name + ' ' + (p.cents >= 0 ? '+' : '') + p.cents + 'c, ' + p.hz.toFixed(1) + ' Hz' : '--');
        }
        if (frame % 30 === 0) stats.set('fps', Math.round(fps.tick()));
        else fps.tick();
    });

    Object.assign(synth, {
        ctx, song, player, sequencer, recorder, mic, midi, presets, project,
        history: undo.history, docCommands, clip, clipUi, scopes, sidebar: side, grid,
        presetUi, header, seqBar, piano, viewTabs, status, loop,
    });
    // (a getter: Object.assign would copy its value once)
    Object.defineProperty(synth, 'view', { get: () => view, enumerable: true });
    return synth;
}
