// YuE2 Lab without weights: the page builds every control surface, the song
// helpers edit the text they should, and nothing runs before a model loads.
import { check, eq, frames, clickOn, setValue, text, q, test, done, shot } from "/lib/kit/test.js";

frames(10);

test('layout: toolbar, side panel, pipeline, views', () => {
    for (const sel of ['#modelbar', '#transport', '.k-side', '#stages', '#abc', '#sem-view', '#lat-view',
                       '#wave-l', '#wave-r', '#timing'])
        check(q(sel), sel + ' present');
    eq(document.querySelectorAll('#stages .stage').length, 4, 'four pipeline stages');
    check(q('#model-dir').value.length > 0 && q('#vae-dir').value.length > 0, 'model paths prefilled');
    eq([...q('#ar-weights').options].map((o) => o.value).join(), 'bf16,int8,fp8', 'AR weight choices');
    eq(q('#ar-weights').value, 'int8', 'int8 by default');
});

test('nothing runs before load', () => {
    for (const id of ['btn-generate', 'btn-plan', 'btn-semantic', 'btn-synth', 'btn-decode', 'btn-stop'])
        check(q('#' + id).disabled, id + ' disabled before load');
});

test('style chips toggle phrases in the style text', () => {
    setValue('#style', 'pop');
    const chip = q('#style-tags .k-chip[data-tag="piano"]');
    clickOn(chip);
    eq(q('#style').value, 'pop, piano');
    check(chip.classList.contains('on'), 'chip lit');
    clickOn(chip);
    eq(q('#style').value, 'pop');
    check(q('#style-tags .k-chip[data-tag="pop"]').classList.contains('on'), 'typed tag lights its chip');
});

test('section buttons insert tags on a fresh line', () => {
    setValue('#lyrics', 'hello');
    q('#lyrics').setSelectionRange(5, 5);
    clickOn(q('#section-tags button'));
    check(/^hello\n\n\[Intro\]\n$/.test(q('#lyrics').value), 'inserted: ' + JSON.stringify(q('#lyrics').value));
    check(/sections/.test(text('#lyrics-meta')), 'lyrics summary updates');
});

test('sampling panels carry every knob, defaults restore', () => {
    clickOn('[data-tab=sampling]');
    eq(document.querySelectorAll('#abc-sampling .k-field').length, 8, 'score sampling rows (7 + draft tokens)');
    eq(document.querySelectorAll('#sem-sampling .k-field').length, 7, 'semantic sampling rows');
    check(document.querySelectorAll('#synth-params .k-field').length >= 4, 'synthesis rows');
    const temp = q('#abc-sampling input[type=range]');
    setValue(temp, 1.5);
    clickOn('#btn-defaults');
    eq(Number(q('#abc-sampling input[type=range]').value), 0.7, 'temperature back to 0.7');
    clickOn('[data-tab=song]');
});

test('score segmented control', () => {
    q('#cot').scrollIntoView();
    frames(2);
    clickOn('#cot button[data-value="melody"]');
    check(q('#cot button[data-value="melody"]').classList.contains('active'), 'melody selected');
    clickOn('#cot button[data-value="full"]');
});

test('expression panel builds', () => {
    clickOn('[data-tab=expression]');
    check(/no steer/.test(text('#steer-list')), 'empty steer list');
    clickOn('[data-tab=song]');
});

test('radio surface: controls, knob ranges, nothing runs before load', () => {
    check(q('#radio-view').hidden, 'radio panels hidden off the Radio tab');
    q('#tabs').scrollIntoView();
    frames(2);
    clickOn('[data-tab=radio]');
    frames(2);
    check(q('[data-tab=radio]').classList.contains('active'), 'Radio tab selected');
    check(!q('#radio-view').hidden && !q('#radio-plan-panel').hidden, 'radio panels shown on the Radio tab');
    for (const sel of ['#radio-start', '#radio-enqueue', '#radio-skip', '#radio-stop', '#radio-continue', '#radio-tag',
                       '#radio-energetic', '#radio-calm', '#radio-plan', '#radio-plan-apply', '#radio-songs',
                       '#radio-norm', '#radio-break', '#radio-int1', '#radio-int2', '#radio-firstAudio', '#radio-lead',
                       '#radio-playhead'])
        check(q(sel), sel + ' present');
    // bro.music.knobRanges, before any stream: the documented clamps
    // (docs/music-api.js YuE2Knobs), and the sliders take them.
    const want = { energy: [-2, 1], texture: [-2, 2], percussion: [-6, 6], arrangement: [-2, 1] };
    const engine = bro.music ? bro.music.knobRanges : null;
    if (engine) eq(Object.fromEntries(Object.entries(engine).map(([k, r]) => [k, [r.min, r.max]])), want,
                   'bro.music.knobRanges is the documented clamps');
    else console.log('no bro.music in this build: no knob sliders');
    for (const [k, [lo, hi]] of engine ? Object.entries(want) : []) {
        const s = q('#knob-' + k);
        eq([Number(s.min), Number(s.max), Number(s.value)], [lo, hi, 0], k + ' slider range and value');
        eq(text('#knob-' + k + '-val'), '0.00', k + ' shows 0');
    }
    if (engine) {
        setValue('#knob-texture', 1.5);
        eq(text('#knob-texture-val'), '1.50', 'a knob moved before a stream shows its requested value');
        setValue('#knob-texture', 0);
    }
    check(q('#radio-continue').checked, 'radio continue on by default');
    eq(document.querySelectorAll('#radio-start-params .k-field').length, 6, 'stream start options');
    eq(document.querySelectorAll('#radio-song-params .k-field').length, 1, 'per-song options (ODE steps)');
    eq(q('#radio-start-params input[type=text]').value, '250, 500', 'NAR windows default');
    for (const id of ['radio-start', 'radio-enqueue', 'radio-skip', 'radio-stop', 'radio-energetic', 'radio-calm', 'radio-plan-apply'])
        check(q('#' + id).disabled, id + ' disabled before load');
    check(/nothing queued/.test(text('#radio-songs')), 'empty queue');
    eq(text('#radio-int1'), '—', 'no interrupt yet');
    eq(text('#radio-break'), 'no break warning', 'no break warning');
    clickOn('[data-tab=song]');
    frames(1);
    check(q('#radio-view').hidden, 'radio panels hide again');
});

shot('yue2-lab');
done('yue2-lab smoke');
