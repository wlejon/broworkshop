// Qwen3-ASR Lab: boot loads the model, a clip opened through the input bar
// auto-transcribes (language line + streamed transcript), context biasing
// and cancel stay wired. Skips without the checkpoint or the test clip.
//
//   scripts/validate.sh --ml demos/qwen-asr-lab

import { check, test, done, waitFor, q, text, clickOn, typeInto, shot, needWeights } from "/lib/kit/test.js";
import { lab, QWEN_ASR } from "/app/lab.js";

needWeights('Qwen3-ASR 0.6B', QWEN_ASR, { probe: 'config.json' });
const WAV = needWeights('speech test clip', ['brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav']);

waitFor(() => lab.model || lab.error, 'model load', 300000);
check(!lab.error, 'model loaded: ' + lab.error);
check(!q('#btn-record').disabled, 'record available');

// open a clip: autorun transcribes it
typeInto('#src-file', WAV);
clickOn('#btn-open-file');
waitFor(() => lab.ids || /error/.test(text('#status')), 'transcription', 300000);
check(lab.ids, 'transcription finished: ' + text('#status'));
console.log('[qwen-asr-lab] language="' + text('#lang') + '" transcript="' + text('#transcript') + '"');
test('language line says English', () => check(/english/i.test(text('#lang')), text('#lang')));
test('transcript has the spoken words', () => check(/hello/i.test(text('#transcript')) && /test/i.test(text('#transcript'))));
test('transcript marked final', () => check(!q('#transcript').classList.contains('streaming')));
test('run meta shows the realtime factor', () => check(/realtime/.test(text('#run-meta'))));
shot('transcribed');

// context biasing: re-run with a context phrase
typeInto('#context', 'pipeline test');
clickOn('#btn-transcribe');
waitFor(() => !lab.running, 'context-biased run', 300000);
test('biased transcript still has the words', () => check(lab.ids && /hello/i.test(text('#transcript'))));

// cancel
clickOn('#btn-transcribe');
check(lab.running && !q('#btn-cancel').disabled, 'cancel armed while running');
clickOn('#btn-cancel');
waitFor(() => !lab.running, 'cancelled run settles', 300000);
test('buttons reset after cancel', () => check(!q('#btn-transcribe').disabled && q('#btn-cancel').disabled));

done('qwen-asr-lab');
