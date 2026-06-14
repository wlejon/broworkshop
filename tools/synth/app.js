// ---------------------------------------------------------------------------
// Synth App — thin module entry. Boots the engine + shared widgets, mounts the
// view modules, then wires view switching + the clip editor.
// ---------------------------------------------------------------------------

import { $, $$, on } from "/std/dom.js";
import { engine } from "/app/lib/synth-engine.js";
import { Keyboard } from "/app/lib/keyboard.js";
import { Visualizer } from "/app/lib/visualizer.js";
import { Layers } from "/app/lib/layers.js";
import { Presets } from "/app/lib/presets.js";
import { ClipEditor } from "/app/lib/clip-editor.js";
import { showVal } from "/app/views/shared.js";
import { refreshActive } from "/app/views/state.js";
import { initSidebar } from "/app/views/sidebar.js";
import { initLayersGrid, rebuild } from "/app/views/layers-grid.js";
import { initPresetsUI } from "/app/views/presets-ui.js";
import { initMic } from "/app/views/mic.js";

// Init audio engine
engine.init();

// Init keyboard
Keyboard.init($('#keyboard'), $('#octave-display'));

// Init visualizer
Visualizer.init($('#viz-stack'));
Visualizer.rebuild();
Visualizer.draw();

// Init layers — create first layer, then apply preset to it
Layers.init();
Presets.load('Init');

// Mount view modules (sidebar installs the activeVersion -> syncUIToSignal seam)
initSidebar();
initLayersGrid();
initPresetsUI();
initMic();

// Respond to layer selection changes: bump the reactive seam + rebuild the grid
Layers.onSelect(function() {
    refreshActive();
    rebuild();
});

// -----------------------------------------------------------------------
// View switching
// -----------------------------------------------------------------------
var currentView = 'synth';

$$('#view-tabs .btn').forEach(function(btn) {
    on(btn, 'click', function() {
        var view = btn.getAttribute('data-view');
        if (view === currentView) return;
        currentView = view;
        $$('#view-tabs .btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');

        $('#synth-view').style.display = view === 'synth' ? 'flex' : 'none';
        $('#editor-view').style.display = view === 'editor' ? 'flex' : 'none';

        if (view === 'editor') {
            Visualizer.pause();
            ClipEditor.draw();
        } else {
            ClipEditor.clear();
            Visualizer.resume();
        }
    });
});

// -----------------------------------------------------------------------
// Clip Editor init & wiring
// -----------------------------------------------------------------------
ClipEditor.init($('#editor-canvas'));

var isRecording = false;

// Transport
on($('#ed-play'), 'click', function() { ClipEditor.play(); });
on($('#ed-stop'), 'click', function() { ClipEditor.stop(); });
on($('#ed-loop'), 'click', function() {
    var onState = ClipEditor.toggleLoop();
    $('#ed-loop').classList.toggle('active', onState);
});

// Record
on($('#ed-record'), 'click', function() {
    var btn = $('#ed-record');
    if (!isRecording) {
        ClipEditor.record();
        isRecording = true;
        btn.classList.add('recording');
        btn.textContent = 'Stop';
    } else {
        ClipEditor.stopRecording();
        isRecording = false;
        btn.classList.remove('recording');
        btn.textContent = 'Rec';
    }
});

// File I/O
on($('#ed-load'), 'click', function() {
    var files = showOpenFileDialog('Audio Files|wav;flac;mp3;ogg;opus');
    if (files && files.length > 0) {
        try { ClipEditor.loadFromFile(files[0]); }
        catch (e) { console.error('Load failed:', e.message); }
    }
});

on($('#ed-save'), 'click', function() {
    var path = showSaveFileDialog('WAV Files|wav', 'clip.wav');
    if (path) {
        if (path.indexOf('.wav') < 0 && path.indexOf('.WAV') < 0) path += '.wav';
        try { ClipEditor.saveToFile(path); }
        catch (e) { console.error('Save failed:', e.message); }
    }
});

// Edit operations
on($('#ed-undo'), 'click', function() { ClipEditor.undo(); });
on($('#ed-redo'), 'click', function() { ClipEditor.redo(); });
on($('#ed-cut'), 'click', function() { ClipEditor.cut(); });
on($('#ed-copy'), 'click', function() { ClipEditor.copy(); });
on($('#ed-paste'), 'click', function() { ClipEditor.paste(); });
on($('#ed-delete'), 'click', function() { ClipEditor.deleteSelection(); });
on($('#ed-silence'), 'click', function() { ClipEditor.silenceSelection(); });
on($('#ed-trim'), 'click', function() { ClipEditor.trimToSelection(); });
on($('#ed-select-all'), 'click', function() { ClipEditor.selectAll(); });

// Zoom
on($('#ed-zoom-in'), 'click', function() { ClipEditor.zoomIn(); });
on($('#ed-zoom-out'), 'click', function() { ClipEditor.zoomOut(); });
on($('#ed-zoom-fit'), 'click', function() { ClipEditor.zoomToFit(); });
on($('#ed-zoom-sel'), 'click', function() { ClipEditor.zoomToSelection(); });

// Process
on($('#ed-normalize'), 'click', function() { ClipEditor.normalize(); });
on($('#ed-reverse'), 'click', function() { ClipEditor.reverse(); });
on($('#ed-fade-in'), 'click', function() { ClipEditor.fadeIn(); });
on($('#ed-fade-out'), 'click', function() { ClipEditor.fadeOut(); });

on($('#ed-gain'), 'input', function(e) {
    showVal('ed-gain-val', e.target.value + 'dB');
});
on($('#ed-gain-apply'), 'click', function() {
    ClipEditor.adjustGain(parseInt($('#ed-gain').value));
    $('#ed-gain').value = 0;
    showVal('ed-gain-val', '0dB');
});

// Pitch
on($('#ed-pitch'), 'input', function(e) {
    var v = parseInt(e.target.value);
    showVal('ed-pitch-val', (v >= 0 ? '+' : '') + v);
});
on($('#ed-pitch-apply'), 'click', function() {
    var semi = parseInt($('#ed-pitch').value);
    if (semi !== 0) ClipEditor.pitchShift(semi);
    $('#ed-pitch').value = 0;
    showVal('ed-pitch-val', '0');
});
$$('.ed-pitch-btn').forEach(function(btn) {
    on(btn, 'click', function() {
        ClipEditor.pitchShift(parseInt(btn.getAttribute('data-semi')));
    });
});

// Speed / Time stretch
on($('#ed-speed'), 'input', function(e) {
    showVal('ed-speed-val', e.target.value + '%');
});
on($('#ed-speed-apply'), 'click', function() {
    var pct = parseInt($('#ed-speed').value);
    if (pct !== 100) ClipEditor.timeStretch(100 / pct);
    $('#ed-speed').value = 100;
    showVal('ed-speed-val', '100%');
});
$$('.ed-speed-btn').forEach(function(btn) {
    on(btn, 'click', function() {
        var pct = parseInt(btn.getAttribute('data-speed'));
        ClipEditor.timeStretch(100 / pct);
    });
});

// Insert silence
on($('#ed-silence-dur'), 'input', function(e) {
    var ms = parseInt(e.target.value);
    showVal('ed-silence-dur-val', ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
});
on($('#ed-insert-silence'), 'click', function() {
    ClipEditor.insertSilence(parseInt($('#ed-silence-dur').value));
});

// Generate
var genWaveform = 'sine';
on($('#ed-gen-freq'), 'input', function(e) {
    showVal('ed-gen-freq-val', e.target.value + 'Hz');
});
on($('#ed-gen-dur'), 'input', function(e) {
    var ms = parseInt(e.target.value);
    showVal('ed-gen-dur-val', ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms');
});
$$('#ed-gen-wave-btns .btn').forEach(function(btn) {
    on(btn, 'click', function() {
        $$('#ed-gen-wave-btns .btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        genWaveform = btn.getAttribute('data-wave');
    });
});
on($('#ed-generate'), 'click', function() {
    ClipEditor.generateTone(
        parseInt($('#ed-gen-freq').value),
        parseInt($('#ed-gen-dur').value),
        genWaveform
    );
});
on($('#ed-gen-noise'), 'click', function() {
    ClipEditor.generateNoise(parseInt($('#ed-gen-dur').value));
});

// Synth integration
on($('#ed-use-clip'), 'click', function() {
    ClipEditor.useAsInstrument();
    $('#ed-use-clip').classList.add('active');
});
on($('#ed-clear-clip'), 'click', function() {
    ClipEditor.clearInstrument();
    $('#ed-use-clip').classList.remove('active');
});

// Keyboard shortcuts for editor view
on(document.documentElement, 'keydown', function(e) {
    if (currentView === 'editor') {
        if (ClipEditor.handleKey(e)) {
            e.preventDefault();
        }
    }
});
