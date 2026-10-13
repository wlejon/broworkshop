// YuE2 Lab's Editor on the GPU, on two saved takes copied into a scratch save
// folder (YUE2_EDIT_TAKES: a radio save folder's takes/; skipped without it):
// open one (its decode shows as a step), the timeline (zoom, the selection, the
// playhead stepped by keys), opening another stops what plays, Regenerate with
// three candidates renders all three and each can be put in use, "New song from
// it" keeps the clip where it sits and ends on its own (not the clip looped to
// the token budget), undo and redo walk the history, Save writes a take.
// Asserts on the DOM and the editor's state; it does not grade the music.
import { check, eq, frames, clickOn, setValue, text, q, test, done, needWeights, waitFor, press } from "/lib/kit/test.js";
import { setSaveDir, saveDir } from "/app/lib/radio.js";
import { editorState, editorBusy } from "/app/lib/editor.js";
import * as tl from "/app/lib/editor_view.js";

needWeights('YuE2-3B', ['YuE2-3B'], { probe: 'qwen.tiktoken' });
needWeights('YuE2-Vae', ['brosoundml/weights/yue2-vae'], { probe: 'model.safetensors' });
if (!bro.music || bro.music.available === false) { console.log('SKIP: bro.music not in this build'); process.exit(0); }
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const src = process.env.YUE2_EDIT_TAKES || '';
const names = src && fs.existsSync(src) ? fs.readdirSync(src).filter((n) => fs.existsSync(path.join(src, n, 'take.json'))) : [];
if (names.length < 2) { console.log('SKIP: set YUE2_EDIT_TAKES to a takes/ folder holding two saved songs'); process.exit(0); }

// The two shortest, copied so nothing here writes into the real save folder.
const by = names.map((n) => ({ n, f: JSON.parse(fs.readFileSync(path.join(src, n, 'take.json'), 'utf8')).frames || 1e9 }))
    .sort((a, b) => a.f - b.f).slice(0, 2);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yue2-edit-'));
for (const { n } of by) fs.cpSync(path.join(src, n), path.join(scratch, 'takes', n), { recursive: true });
const prevDir = saveDir();
setSaveDir(scratch);

frames(5);
const FPS = 25;
const idle = () => !editorBusy();
const cur = () => { const e = editorState(); return e.versions[e.at]; };

test('load both models', () => {
    clickOn('#btn-load');
    waitFor(() => !q('#btn-generate').disabled || /failed/.test(text('#device')), 'models loaded', 300000, 50);
    check(!q('#btn-generate').disabled, 'generate enabled after load: ' + text('#status'));
});

test('open a saved song: its decode is shown as a step', () => {
    q('#tabs').scrollIntoView(); frames(2);
    clickOn('[data-tab=edit]'); frames(3);
    const cards = document.querySelectorAll('#edit-takes .take');
    eq(cards.length, 2, 'both copied songs listed');
    cards[0].scrollIntoView(); frames(1);
    clickOn('#edit-takes .take');
    frames(2);
    check(editorBusy() && !q('#edit-job').classList.contains('off'), 'a decoding step is showing: ' + text('#edit-job'));
    check(/decoding/.test(text('#edit-job-text')), 'the step names itself: ' + text('#edit-job-text'));
    waitFor(() => idle() && cur().audio, 'decoded', 120000, 20);
    frames(2);
    check(q('#edit-job').classList.contains('off'), 'the step chip goes away when done');
    check(/v0 as saved/.test(text('#edit-meta')), 'meta names the version: ' + text('#edit-meta'));
    check(q('#edit-regen').disabled, 'moves wait for a selection');
});

test('the timeline: zoom, select, step the playhead', () => {
    const T = cur().semantic.length;
    eq(tl.viewWindow(), [0, T], 'opens fitted');
    clickOn('#edit-zoom-in'); frames(1);
    const w = tl.viewWindow();
    check(w[1] - w[0] < T, 'zoom in narrows the view: ' + w);
    clickOn('#edit-zoom-fit'); frames(1);
    eq(tl.viewWindow(), [0, T], 'fit shows the whole song');
    tl.seek(10 * FPS);
    press('ArrowRight'); frames(1);
    eq(Math.round(tl.playhead()), 11 * FPS, '→ steps a second');
    press('ArrowLeft', 0x0001); frames(1);   // shift: a tenth
    check(Math.abs(tl.playhead() - (11 * FPS - 2.5)) < 0.01, 'shift+← steps a tenth: ' + tl.playhead());
    tl.seek(12 * FPS); press('['); tl.seek(16 * FPS); press(']'); frames(1);
    eq(tl.selection(), [12 * FPS, 16 * FPS], '[ and ] mark the selection at the playhead');
    check(/0:12\.0 – 0:16\.0/.test(text('#edit-sel')), 'selection shown: ' + text('#edit-sel'));
    check(!q('#edit-regen').disabled, 'moves enabled with a selection');
    clickOn('#edit-zoom-sel'); frames(1);
    const z = tl.viewWindow();
    check(z[0] < 12 * FPS && z[1] > 16 * FPS && z[1] - z[0] < T, 'zoom to the selection frames it: ' + z);
    press('Escape'); frames(1);
    eq(tl.selection(), null, 'Esc clears the selection');
});

test('opening another song stops what plays', () => {
    tl.seek(0);
    clickOn('#edit-play'); frames(3);
    check(tl.playing(), 'playing');
    const cards = document.querySelectorAll('#edit-takes .take');
    clickOn(cards[1]); frames(1);
    check(!tl.playing(), 'the first song stopped at once');
    waitFor(() => idle() && cur().audio, 'second song decoded', 120000, 20);
});

test('regenerate: three candidates, all rendered, each put in use', () => {
    tl.setSelection(8 * FPS, 12 * FPS);
    setValue('#edit-cands-n', 3);
    const before = cur();
    clickOn('#edit-regen'); frames(2);
    check(!q('#edit-job').classList.contains('off'), 'the move shows its steps: ' + text('#edit-job'));
    check(/^1\/7/.test(text('#edit-job-text')), 'step 1 of 7 (sample, then solve + decode three): ' + text('#edit-job-text'));
    waitFor(idle, 'regenerated', 600000, 50);
    frames(2);
    const v = cur();
    check(v !== before && v.cands && v.cands.length === 3, 'three candidates kept: ' + (v.cands && v.cands.length));
    eq(document.querySelectorAll('#edit-candidates .ed-cand').length, 3, 'three candidates shown');
    check(v.cands.every((c) => c.audio && c.semantic.length === before.semantic.length), 'every candidate rendered, the same length');
    check(v.cands[0].score <= v.cands[1].score && v.cands[1].score <= v.cands[2].score, 'best fit first');
    eq(tl.selection(), [8 * FPS, 12 * FPS], 'the changed span stays selected');
    const a0 = v.audio;
    const useB = [...document.querySelectorAll('#edit-candidates .ed-cand')][1].querySelectorAll('button')[1];
    clickOn(useB); frames(2);
    check(v.chosen === 1 && v.audio === v.cands[1].audio && v.audio !== a0, 'B in use');
});

test('new song from it: the clip stays put, the song ends on its own', () => {
    const v = cur(), a = 6 * FPS, b = 10 * FPS;
    tl.setSelection(a, b);
    setValue('#edit-keep-clip', true);
    clickOn('#edit-grow'); frames(2);
    waitFor(idle, 'a new song grown', 900000, 50);
    frames(2);
    const n = cur();
    check(n !== v, 'a new version: ' + text('#status'));
    const clip = v.semantic.subarray(a, b);
    check(n.semantic.subarray(a, b).every((t, i) => t === clip[i]), 'the clip where it sat');
    // Steered to the open song's length (the field left empty): it ends on
    // its own near there, not at 1.5x, however long the score runs.
    const T0 = v.semantic.length;
    check(!n.truncated && n.semantic.length < 1.5 * Math.max(b + 10 * FPS, T0),
          'the song ended on its own near ' + (T0 / FPS).toFixed(0) + ' s: ' + (n.semantic.length / FPS).toFixed(1) + ' s');
    // The clip looped: what follows it repeats it token for token.
    let same = 0;
    const c = b - a, rest = n.semantic.length - b;
    for (let i = 0; i < rest; i++) if (n.semantic[b + i] === clip[i % c]) same++;
    check(rest === 0 || same / rest < 0.3, 'what follows is not the clip on repeat: ' + (rest ? (same / rest).toFixed(2) : '-'));
    eq(tl.selection(), [a, b], 'the clip is selected in the new song');
});

test('history: undo, redo, save', () => {
    const e = editorState(), top = e.at;
    press('z', 0x0040); frames(2);   // ctrl
    eq(e.at, top - 1, 'ctrl+z steps back');
    press('y', 0x0040); frames(2);
    eq(e.at, top, 'ctrl+y steps forward');
    clickOn('#edit-save'); frames(2);
    const saved = fs.readdirSync(path.join(scratch, 'takes'));
    eq(saved.length, 3, 'a third take in the save folder');
    check(fs.readdirSync(scratch).some((f) => /\(edit \d+\)\.wav$/.test(f)), 'the version saved as a WAV');
});

setSaveDir(prevDir === path.join(os.homedir(), 'Music', 'YuE2') ? '' : prevDir);
done('yue2-lab editor');
