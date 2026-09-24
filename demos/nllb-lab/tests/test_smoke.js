// NLLB-200 Lab: boot loads the model; Translate runs en→fr through the UI and
// the text lands in the output pane; swap flips the pair and carries the
// translation back for a round trip; cancel settles. Skips without weights.
//
//   scripts/validate.sh --ml demos/nllb-lab

import { check, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { lab, NLLB, LANGS } from "/app/lab.js";

needWeights('NLLB-200 (distilled 600M)', NLLB, { probe: 'config.json' });

waitFor(() => lab.model || lab.error, 'model load', 300000);
check(!lab.error, 'model loaded: ' + lab.error);
test('model meta shown', () => check(/languages/.test(lab.ui.row.metaEl.textContent)));
test('translate enabled', () => check(!q('#btn-translate').disabled && q('#btn-cancel').disabled));
test('every curated language is known to the model', () => {
    for (const [code] of LANGS) check(lab.model.hasLanguage(code), code);
});

// 1. en → fr
q('#input').value = 'Hello, how are you?';
setValue('#src-lang', 'eng_Latn');
setValue('#tgt-lang', 'fra_Latn');
test('pane captions follow the selects', () => check(text('#src-name') === 'English' && text('#tgt-name') === 'French'));
let n = lab.runs;
clickOn('#btn-translate');
test('run in flight', () => check(lab.running && !q('#btn-cancel').disabled && q('#output').classList.contains('partial')));
waitFor(() => lab.runs > n, 'translation', 300000);
check(!lab.error, lab.error);
const out = text('#output');
console.log('en→fr: "' + out + '"');
test('translation in the output pane', () => check(out.length > 0 && out === lab.result.trim()));
test('output final', () => check(!q('#output').classList.contains('partial') && !q('#output').classList.contains('empty')));
test('status + run meta', () => check(/done/.test(text('#status')) && /beams/.test(text('#run-meta'))));
shot('translated');

// 2. swap carries the output back; round trip fr → en
clickOn('#btn-swap');
test('swap flipped the pair', () => check(q('#src-lang').value === 'fra_Latn' && q('#tgt-lang').value === 'eng_Latn'));
test('swap carried the translation into the source', () => check(q('#input').value.trim() === out));
n = lab.runs;
clickOn('#btn-translate');
waitFor(() => lab.runs > n, 'round trip', 300000);
check(!lab.error, lab.error);
test('round trip produced text', () => check(text('#output').length > 0));

// 3. cancel settles immediately and re-arms Translate
q('#input').value = 'This is a longer sentence to translate so that we can cancel it.';
n = lab.runs;
clickOn('#btn-translate');
clickOn('#btn-cancel');
test('cancel settles', () => check(lab.runs > n && !lab.running && /cancelled/.test(text('#status'))));
test('translate re-armed', () => check(!q('#btn-translate').disabled && q('#btn-cancel').disabled));

done('nllb-lab');
