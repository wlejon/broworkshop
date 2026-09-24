// The clip editor driven through its UI: generate, select on the waveform,
// edit (reverse, gain, pitch, speed, trim, cut/paste, silence), undo/redo,
// zoom, playback, and the clip as a keyboard instrument. Asserts on the
// clip samples, the DOM and the engine clip, never on how it sounds.
// Run: scripts/validate.sh tools/synth

import { check, eq, near, test, done, frames, clickOn, setValue, press, q, text, shot } from "/lib/kit/test.js";
import { synth } from "/app/app.js";

frames(5);
const { clip, player, ctx } = synth;
const rate = clip.rate;
const KMOD_CTRL = 0x0040, KEY_K = 107;

const peakOf = (a, b) => {
    let p = 0;
    const pcm = clip.samples;
    for (let i = a || 0; i < (b == null ? pcm.length : b); i++) p = Math.max(p, Math.abs(pcm[i]));
    return p;
};
/** Drag across the waveform from fraction f0 to f1 of its width. */
function dragSelect(f0, f1) {
    const r = q('#ed-canvas').getBoundingClientRect();
    const y = r.top + r.height / 2;
    mouseMove(r.left + r.width * f0, y);
    mouseDown(r.left + r.width * f0, y, 0);
    for (let i = 1; i <= 4; i++) mouseMove(r.left + r.width * (f0 + (f1 - f0) * i / 4), y);
    mouseUp(r.left + r.width * f1, y, 0);
    frames(1);
}

test('the editor tab shows the editor and hides the synth', () => {
    clickOn('[data-tab=editor]');
    eq(synth.view, 'editor', 'view');
    check(q('[data-pane=editor]').hidden === false, 'editor pane shown');
    check(q('[data-pane=synth]').hidden === true, 'synth pane hidden');
    eq(text('[data-stat="clip"]'), 'none', 'no clip yet');
    check(q('#ed-undo').disabled, 'nothing to undo');
});

test('generate a tone', () => {
    setValue('#ed-gen-freq', 441);
    setValue('#ed-gen-dur', 1000);
    clickOn('#ed-gen-wave [data-value=square]');
    clickOn('#ed-generate');
    frames(2);
    eq(clip.length, rate, 'one second');
    check(clip.clipId >= 0, 'an engine clip');
    near(peakOf(), 1, 0.2, 'full-scale square');
    eq(text('#ed-time'), '0.00 / 1.00 s', 'transport time');
    eq(text('#ed-zoom'), '100%', 'fit');
    check(/generated 441Hz square/.test(text('#status')), 'status');
    eq(text('[data-stat="clip"]'), '1.00s', 'status bar clip');
});

test('drag on the waveform selects a region', () => {
    dragSelect(0.25, 0.5);
    const sel = clip.selection;
    check(sel, 'selected');
    near(sel.a / rate, 0.25, 0.02, 'from a quarter');
    near(sel.b / rate, 0.5, 0.02, 'to half');
    check(/sel/.test(text('[data-stat="clip"]')), 'status bar shows the selection');
});

test('gain applies to the selection only, and undoes', () => {
    const { a, b } = clip.selection;
    const p0 = peakOf(a, b), down = p0 * Math.pow(10, -12 / 20);
    setValue('#ed-gain', -12);
    eq(text('#ed-gain-val'), '-12dB', 'readout');
    clickOn('#ed-gain-apply');
    near(peakOf(a, b), down, 1e-3, 'selection 12 dB down');
    near(peakOf(0, a), p0, 1e-6, 'outside untouched');
    eq(q('#ed-gain').value, '0', 'the slider resets after applying');
    check(!q('#ed-undo').disabled, 'undo enabled');
    clickOn('#ed-undo');
    near(peakOf(a, b), p0, 1e-6, 'undone');
    clickOn('#ed-redo');
    near(peakOf(a, b), down, 1e-3, 'redone');
    clickOn('#ed-undo');
});

test('reverse flips the selection', () => {
    const { a, b } = clip.selection;
    const pcm = clip.samples;
    const first = pcm[a + 10], last = pcm[b - 11];
    clickOn('#ed-reverse');
    eq(clip.samples[b - 11], first, 'first sample now last');
    eq(clip.samples[a + 10], last, 'last sample now first');
    eq(clip.length, rate, 'length unchanged');
});

test('pitch and speed change the selection length', () => {
    const { a, b } = clip.selection;
    const n = b - a;
    clickOn('[data-speed="200"]');
    near(clip.length, rate - n / 2, 2, 'twice as fast halves the region');
    clickOn('#ed-undo');
    eq(clip.length, rate, 'undone');
    clickOn('[data-semi="12"]');
    near(clip.length, rate - n / 2, 2, 'an octave up halves it too');
    clickOn('#ed-undo');
    setValue('#ed-speed', 50);
    clickOn('#ed-speed-apply');
    near(clip.length, rate + n, 2, 'half speed doubles it');
    eq(q('#ed-speed').value, '100', 'the slider resets');
    clickOn('#ed-undo');
});

test('cut, paste, silence and delete', () => {
    const { a, b } = clip.selection;
    const n = b - a;
    clickOn('#ed-cut');
    eq(clip.length, rate - n, 'cut removes it');
    eq(clip.selection, null, 'no selection after cut');
    clip.setCursor(0);
    clickOn('#ed-paste');
    eq(clip.length, rate, 'paste puts it back');
    eq(clip.selection, { a: 0, b: n }, 'pasted audio selected');
    clickOn('#ed-silence');
    eq(peakOf(0, n), 0, 'silenced');
    press('Delete');
    eq(clip.length, rate - n, 'Delete key removes the selection');
    press('z', KMOD_CTRL);
    eq(clip.length, rate, 'Ctrl+Z undoes in the editor');
    clickOn('#ed-undo');
    clickOn('#ed-undo');
    clickOn('#ed-undo');
    eq(clip.length, rate, 'back to the tone');
    near(peakOf(0, n), 1, 0.2, 'the start is not silent any more');
});

test('Ctrl+Z in the editor leaves the song history alone', () => {
    synth.song.setBpm(150);          // a song edit, undoable in the synth view
    check(synth.history.canUndo(), 'song history has it');
    const n = clip.length;
    press('z', KMOD_CTRL);
    eq(synth.song.bpm, 150, 'the song edit stays');
    eq(clip.length, n, 'no clip history left to undo either');
    clickOn('[data-tab=synth]');
    press('z', KMOD_CTRL);
    eq(synth.song.bpm, 120, 'Ctrl+Z in the synth view undoes the song');
    clickOn('[data-tab=editor]');
});

test('insert silence and trim', () => {
    clip.clearSelection();
    clip.setCursor(0);
    setValue('#ed-silence-dur', 500);
    clickOn('#ed-insert-silence');
    eq(clip.length, rate * 1.5, 'half a second inserted');
    eq(peakOf(0, rate / 2), 0, 'at the start');
    dragSelect(0.5, 0.9);
    const { a, b } = clip.selection;
    clickOn('#ed-trim');
    eq(clip.length, b - a, 'trimmed to the selection');
    eq(clip.selection, null, 'selection cleared');
});

test('zoom in, out, to the selection and back to fit', () => {
    clickOn('#ed-select-all');
    clickOn('#ed-zoom-in');
    frames(1);
    eq(text('#ed-zoom'), '200%', 'zoom in doubles');
    clickOn('#ed-zoom-in');
    frames(1);
    eq(text('#ed-zoom'), '400%', 'again');
    clickOn('#ed-zoom-out');
    frames(1);
    eq(text('#ed-zoom'), '200%', 'zoom out');
    clickOn('#ed-zoom-fit');
    frames(1);
    eq(text('#ed-zoom'), '100%', 'fit');
    dragSelect(0.1, 0.2);
    clickOn('#ed-zoom-sel');
    frames(1);
    const z = parseInt(text('#ed-zoom'), 10);
    check(z > 700 && z < 1000, 'zoomed to the selection (' + z + '%)');
    press('0');
    frames(1);
    eq(text('#ed-zoom'), '100%', '0 key fits');
});

test('play runs the engine clip and moves the cursor', () => {
    clip.clearSelection();
    clip.setCursor(0);
    clickOn('#ed-toggle');
    check(clip.playing, 'playing');
    check(ctx.isClipPlaying !== undefined, 'engine clip api');
    frames(15);
    check(clip.state.cursor > 0, 'the cursor follows the playhead');
    frames(1);
    const seek = +q('#ed-seek').value;
    check(seek > 0, 'the seek bar follows (' + seek + ')');
    clickOn('#ed-toggle');
    check(!clip.playing, 'stopped');
    clickOn('#ed-loop');
    check(clip.state.looping, 'loop on');
    check(q('#ed-loop').classList.contains('active'), 'loop lit');
    clickOn('#ed-loop');
});

test('the clip plays from the keyboard as an instrument', () => {
    clickOn('#ed-use-clip');
    frames(1);
    eq(player.clipInstrument, clip.clipId, 'player uses the clip');
    check(q('#ed-use-clip').classList.contains('active'), 'button lit');
    keyDown(KEY_K, 0, 0);            // K = C4, the clip's own pitch
    frames(2);
    check(player.isHeld(60), 'C4 held');
    keyUp(KEY_K, 0, 0);
    frames(1);
    setValue('#ed-gen-dur', 300);
    clickOn('#ed-generate');
    eq(player.clipInstrument, clip.clipId, 'a new clip re-points the instrument');
    clickOn('#ed-clear-clip');
    eq(player.clipInstrument, -1, 'back to the oscillators');
});

// a busy frame for the layout check
setValue('#ed-gen-freq', 220);
setValue('#ed-gen-dur', 2000);
clickOn('#ed-gen-wave [data-value=sine]');
clickOn('#ed-generate');
clickOn('#ed-fade-out');
dragSelect(0.3, 0.55);
frames(3);
shot('clip-editor');

clickOn('[data-tab=synth]');
eq(synth.view, 'synth', 'back on the synth');
done('clip editor');
