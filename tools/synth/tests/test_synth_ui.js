// The synth view driven through its UI: the piano, the step grid, layers,
// the sidebar's effect racks (read back from the engine's bus getters),
// presets, undo, the sequencer, arpeggios, automation, MIDI input, and a
// project saved and reopened. Asserts DOM and engine state, never sound.
// Run: scripts/validate.sh tools/synth

import { check, eq, near, test, done, frames, clickOn, setValue, press, q, text, shot } from "/lib/kit/test.js";
import { synth } from "/app/app.js";
import { renderLoop } from "/app/audio/render.js";
import { FACTORY } from "/app/model/presets.js";

const PREFS_KEY = 'synth-presets';
const savedPrefs = localStorage.getItem(PREFS_KEY);

frames(10);
const { ctx, song, player, sequencer } = synth;
check(ctx, 'an AudioContext opened');

const KEY_A = 97, KEY_S = 115, KMOD_SHIFT = 0x0001;
const row = (i) => '.lane-row[data-layer="' + i + '"]';
const step = (i, s) => row(i) + ' .step[data-step="' + s + '"]';
/** The kit params input labelled `label` inside `panel`. */
function param(panel, label) {
    for (const f of q(panel).querySelectorAll('label.k-field')) {
        const span = f.querySelector('span');
        if (span && span.textContent.trim() === label) return f.querySelector('input, select');
    }
    throw new Error('no param "' + label + '" in ' + panel);
}
const busPeak = (rt) => Math.max(ctx.getBusPeakL(rt.bus), ctx.getBusPeakR(rt.bus));

test('boots with one layer, a piano and 120 bpm', () => {
    eq(document.querySelectorAll('.lane-row[data-layer]').length, 1, 'layer rows');
    eq(document.querySelectorAll('#piano .key').length, 17, 'piano keys');
    eq(document.querySelectorAll(row(0) + ' .step').length, 16, 'steps');
    eq(song.bpm, 120, 'song bpm');
    eq(text('#bpm-val'), '120', 'bpm readout');
    eq(text('#octave-name'), 'C3', 'octave label');
    check(document.querySelectorAll('.scope-row').length >= 2, 'a layer scope and the combined scope');
});

test('computer keys play notes and light the piano', () => {
    keyDown(KEY_A, 0, 0);
    frames(4);
    check(player.isHeld(48), 'A holds C3');
    check(q('.key[data-midi="48"]').classList.contains('pressed'), 'C3 key lit');
    eq(text('[data-stat="note"]'), 'C3', 'status note');
    check(busPeak(song.layers[0].rt) > 0, 'the layer bus carries signal');
    keyUp(KEY_A, 0, 0);
    frames(2);
    check(!player.isHeld(48), 'released');
    check(!q('.key[data-midi="48"]').classList.contains('pressed'), 'C3 key unlit');
});

test('Tab and Shift+Tab move the keyboard an octave', () => {
    press('Tab');
    eq(text('#octave-name'), 'C4', 'up an octave');
    eq(q('#piano .key').dataset.midi, '60', 'first key is C4');
    keyDown(KEY_S, 0, 0); frames(2);
    check(player.isHeld(62), 'S plays D4 now');
    keyUp(KEY_S, 0, 0); frames(1);
    press('Tab', KMOD_SHIFT);
    eq(text('#octave-name'), 'C3', 'back down');
});

test('the piano plays with the mouse', () => {
    const r = q('.key[data-midi="52"]').getBoundingClientRect();
    mouseMove(r.left + r.width / 2, r.bottom - 10);
    mouseDown(r.left + r.width / 2, r.bottom - 10, 0);
    frames(2);
    check(player.isHeld(52), 'E3 held while the button is down');
    mouseUp(r.left + r.width / 2, r.bottom - 10, 0);
    frames(2);
    check(!player.isHeld(52), 'released on mouseup');
});

test('clicking steps writes and clears the last note', () => {
    eq(player.lastNote, 52, 'last played note');
    clickOn(step(0, 0));
    eq(song.layers[0].steps[0], 52, 'step 0 = E3');
    check(q(step(0, 0)).classList.contains('on'), 'step lit');
    eq(text(step(0, 0)), 'E3', 'step label');
    clickOn(step(0, 0));
    eq(song.layers[0].steps[0], null, 'cleared');
    clickOn(step(0, 0));
    clickOn(step(0, 4));
    eq(song.layers[0].steps.filter((n) => n != null).length, 2, 'two notes');
});

test('layers: add, duplicate, mute, delete', () => {
    clickOn('#layer-add');
    eq(song.layers.length, 2, 'added');
    eq(song.activeIndex, 1, 'the new layer is selected');
    check(q(row(1)).classList.contains('selected'), 'row selected');
    eq(text('#editing-name'), song.layers[1].name, 'sidebar edits it');
    clickOn(row(0) + ' .dup');
    eq(song.layers.length, 3, 'duplicated');
    eq(song.layers[2].steps, song.layers[0].steps, 'the copy has the steps');
    check(song.layers[2].rt.bus !== song.layers[0].rt.bus, 'on its own bus');
    clickOn(row(2) + ' .mute');
    check(song.layers[2].muted, 'muted');
    check(q(row(2) + ' .mute').classList.contains('active'), 'mute lit');
    clickOn(row(2) + ' .del');
    clickOn(row(1) + ' .del');
    eq(song.layers.length, 1, 'back to one');
    check(!document.querySelector(row(0) + ' .del'), 'the last layer cannot be deleted');
    clickOn(row(0) + ' .lane-name');
    eq(song.activeIndex, 0, 'layer 0 selected');
});

test('filter rack drives the bus filter slot', () => {
    const rt = song.layers[0].rt;
    check(!ctx.getBusFilterEnabled(rt.bus, rt.slot), 'off by default');
    setValue('[data-fx=filter] > h2 input', true);
    check(ctx.getBusFilterEnabled(rt.bus, rt.slot), 'enabled on the engine');
    check(!q('[data-fx=filter]').classList.contains('folded'), 'ticking unfolds the rack');
    const cutoff = param('[data-fx=filter]', 'cutoff');
    eq(cutoff.max, '1000', 'log slider');
    setValue(cutoff, 0);
    near(ctx.getBusFilterFrequency(rt.bus, rt.slot), 20, 0.5, 'bottom of the log range');
    setValue(cutoff, 1000);
    near(ctx.getBusFilterFrequency(rt.bus, rt.slot), 20000, 1, 'top');
    clickOn('[data-fx=filter] [data-value=highpass]');
    eq(ctx.getBusFilterType(rt.bus, rt.slot), 'highpass', 'type');
    eq(song.layers[0].sound.filter.type, 'highpass', 'model');
});

test('compressor threshold goes to the engine as linear amplitude', () => {
    const rt = song.layers[0].rt;
    setValue('[data-fx=compressor] > h2 input', true);
    check(ctx.getBusCompressorEnabled(rt.bus), 'enabled');
    near(ctx.getBusCompressorThreshold(rt.bus), Math.pow(10, -12 / 20), 1e-3, '-12 dB');
    setValue(param('[data-fx=compressor]', 'thresh'), -24);
    near(ctx.getBusCompressorThreshold(rt.bus), Math.pow(10, -24 / 20), 1e-3, '-24 dB');
    setValue(param('[data-fx=compressor]', 'attack'), 5);
    near(ctx.getBusCompressorAttack(rt.bus), 5, 1e-3, 'attack in ms');
});

test('undo and redo restore the engine state', () => {
    const rt = song.layers[0].rt;
    clickOn('#undo');                               // attack
    near(ctx.getBusCompressorAttack(rt.bus), 10, 1e-3, 'attack undone');
    clickOn('#undo');                               // threshold
    near(ctx.getBusCompressorThreshold(rt.bus), Math.pow(10, -12 / 20), 1e-3, 'threshold undone');
    eq(param('[data-fx=compressor]', 'thresh').value, '-12', 'the slider follows');
    clickOn('#redo');
    near(ctx.getBusCompressorThreshold(rt.bus), Math.pow(10, -24 / 20), 1e-3, 'redone');
    check(!q('#redo').disabled, 'more to redo');
});

test('a preset changes the sound but keeps the pattern and the layers', () => {
    clickOn('#layer-add');
    const steps = song.layers[0].steps.slice();
    clickOn(row(0) + ' .lane-name');
    setValue('#preset', 'Bass');
    eq(song.layers.length, 2, 'layers kept');
    eq(song.layers[0].steps, steps, 'steps kept');
    eq(song.layers[0].sound.waveform, FACTORY.Bass.sound.waveform, 'waveform');
    const rt = song.layers[0].rt;
    near(ctx.getBusFilterFrequency(rt.bus, rt.slot), FACTORY.Bass.sound.filter.frequency, 0.5, 'filter from the preset');
    near(ctx.getBusCompressorThreshold(rt.bus), Math.pow(10, FACTORY.Bass.sound.compressor.threshold / 20), 1e-3, 'compressor');
    check(q('#waveform [data-value=square]').classList.contains('active'), 'sidebar rebuilt');
    eq(song.layers[1].sound.waveform, 'sine', 'the other layer untouched');
    clickOn(row(1) + ' .del');
});

test('a user preset saves, lists and deletes', () => {
    clickOn('#preset-save');
    const name = q('#preset').value;
    eq(name, 'My Bass', 'factory names get a prefix');
    check(synth.presets.names().includes('My Bass'), 'stored');
    check(!q('#preset-del').disabled, 'deletable');
    clickOn('#preset-del');
    check(!synth.presets.names().includes('My Bass'), 'deleted');
    eq(q('#preset').value, 'Init', 'back to Init');
});

test('bpm slider sets the tempo', () => {
    setValue('#bpm', 140);
    eq(song.bpm, 140, 'song');
    eq(text('#bpm-val'), '140', 'readout');
});

test('the sequencer plays the grid and marks the playing step', () => {
    clickOn('#seq-play');
    check(sequencer.playing, 'playing');
    eq(text('#seq-play'), 'stop', 'button flips');
    let peak = 0, marked = 0;
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
        frames(1);
        peak = Math.max(peak, busPeak(song.layers[0].rt));
        if (document.querySelector(row(0) + ' .step.playing')) marked++;
        seen.add(sequencer.step);
    }
    check(peak > 0, 'the layer sounded');
    check(marked > 50, 'a step is marked while playing');
    check(seen.size >= 4, 'the playhead moves (' + seen.size + ' steps seen)');
    clickOn('#seq-play');
    check(!sequencer.playing, 'stopped');
    check(!document.querySelector('.step.playing'), 'no step marked');
});

test('arpeggiator mode switches per layer', () => {
    clickOn('#seq-mode [data-value=arpeggiator]');
    eq(song.layers[0].mode, 'arpeggiator', 'mode');
    eq(text(row(0) + ' .mode'), 'A', 'lane badge');
    check(!q('#arp-pattern [data-value=down]').disabled, 'patterns enabled');
    clickOn('#arp-pattern [data-value=down]');
    eq(song.layers[0].arpPattern, 'down', 'pattern');
    clickOn(row(0) + ' .mode');
    eq(song.layers[0].mode, 'sequencer', 'back via the lane button');
    check(q('#arp-pattern [data-value=down]').disabled, 'patterns disabled');
});

test('automation lane adds, retargets and cycles interpolation', () => {
    clickOn('.auto-row[data-layer="0"] .auto');
    eq(song.layers[0].automation.length, 1, 'lane added');
    check(q('.auto-row[data-layer="0"] canvas.auto-canvas'), 'lane canvas');
    setValue('.auto-row[data-layer="0"] .auto-target', 'filter-freq');
    eq(song.layers[0].automation[0].target, 'filter-freq', 'target');
    const mode0 = song.layers[0].automation[0].interpMode;
    clickOn('.auto-row[data-layer="0"] .interp');
    check(song.layers[0].automation[0].interpMode !== mode0, 'interp cycled');
    clickOn('.auto-row[data-layer="0"] .auto');
    eq(song.layers[0].automation.length, 0, 'lane removed');
});

test('MIDI note messages play through the player', () => {
    if (!synth.midi.supported) { console.log('  (no MIDI input in this build)'); return; }
    synth.midi.inject([0x90, 64, 100]);
    frames(2);
    check(player.isHeld(64), 'note on');
    check(q('.key[data-midi="64"]').classList.contains('pressed'), 'key lit');
    synth.midi.inject([0x80, 64, 0]);
    frames(2);
    check(!player.isHeld(64), 'note off');
    check(synth.midi.received >= 2, 'counted');
});

test('the loop renders offline through the layer effects', () => {
    const out = renderLoop(ctx, song);
    check(out && out.pcm.length > 0, 'rendered');
    const loopSec = 16 * 60 / song.bpm / 4;
    check(out.pcm.length >= Math.floor(loopSec * out.rate) - 1, 'at least one loop long');
    let pk = 0;
    for (const v of out.pcm) pk = Math.max(pk, Math.abs(v));
    check(pk > 0.01 && pk <= 1, 'audible and clipped to 1 (' + pk + ')');
});

test('a project saves and reopens', () => {
    const dir = 'tests/out/synth-roundtrip.synth';
    const before = JSON.stringify(song.serialize());
    synth.project.saveTo(dir);
    check(!synth.project.isDirty(), 'clean after save');
    clickOn(step(0, 8));
    setValue('#bpm', 90);
    clickOn('#layer-add');
    check(synth.project.isDirty(), 'dirty after edits');
    synth.project.openPath(dir);
    eq(JSON.stringify(song.serialize()), before, 'same song back');
    eq(document.querySelectorAll('.lane-row[data-layer]').length, 1, 'grid rebuilt');
    eq(text('#bpm-val'), '140', 'bpm readout');
    check(q('#undo').disabled, 'history cleared by open');
    synth.project.new();
    eq(song.layers.length, 1, 'new: one layer');
    eq(song.layers[0].steps.filter((n) => n != null).length, 0, 'new: empty grid');
    eq(song.bpm, 120, 'new: 120 bpm');
});

// a busy frame for the layout check: two layers with patterns, playing
keyDown(KEY_A, 0, 0); keyUp(KEY_A, 0, 0);
for (const s of [0, 3, 6, 10, 12]) clickOn(step(0, s));
clickOn('#layer-add');
press('Tab');
keyDown(KEY_S, 0, 0); keyUp(KEY_S, 0, 0);
for (const s of [2, 8, 14]) clickOn(step(1, s));
clickOn('.auto-row[data-layer="1"] .auto');
setValue('[data-fx=delay] > h2 input', true);
clickOn('#seq-play');
frames(40);
shot('synth');
clickOn('#seq-play');
press('Tab', KMOD_SHIFT);

if (savedPrefs == null) localStorage.removeItem(PREFS_KEY); else localStorage.setItem(PREFS_KEY, savedPrefs);
done('synth ui');
