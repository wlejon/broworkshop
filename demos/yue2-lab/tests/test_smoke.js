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

shot('yue2-lab');
done('yue2-lab smoke');
