// Parakeet Lab: boot autoloads the model, a file load through the input bar
// auto-transcribes (streamed transcript, timeline pins, token table), the
// offline mic path (bro.mic.feed) records the same clip, and cancel settles.
// Skips when the checkpoint or the test clip is not on this machine.
//
//   scripts/validate.sh --ml demos/parakeet-lab

import { check, test, done, waitFor, frames, q, text, clickOn, typeInto, shot, needWeights } from "/lib/kit/test.js";
import { resample } from "/lib/kit/audio.js";
import { lab, PARAKEET } from "/app/lab.js";

needWeights('Parakeet-TDT 0.6B', PARAKEET, { probe: 'config.json' });
const WAV = needWeights('speech test clip', ['brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav']);

// 1. boot loaded model + tokenizer
waitFor(() => (lab.model && lab.tok) || lab.error, 'model load', 300000);
check(!lab.error, 'model loaded: ' + lab.error);
test('parakeet handle is loaded at 16 kHz', () => check(lab.model.loaded && lab.model.sampleRate === 16000));
test('model meta shown', () => check(/vocab/.test(lab.ui.row.metaEl.textContent)));

// 2. load the clip through the input bar; autorun transcribes it
check(q('#autorun').checked, 'autorun on by default');
typeInto('#src-file', WAV);
clickOn('#btn-open-file');
check(lab.ui.input.clip && lab.ui.input.clip.length > 16000, 'file decoded to > 1 s of 16 kHz audio');
check(!q('#btn-play-src').disabled, 'play enabled for the clip');
waitFor(() => lab.result || /error/.test(text('#status')), 'transcription', 300000);
check(lab.result, 'transcription finished: ' + text('#status'));
const words = text('#transcript');
test('transcript has the spoken words', () => check(/hello/i.test(words) && /test/i.test(words), words));
test('transcript marked final', () => check(!q('#transcript').classList.contains('streaming')));
test('one frame per token', () => check(lab.result.tokenIds.length === lab.result.tokenFrames.length));
test('token table: one row per emission', () =>
    check(document.querySelectorAll('#tokens tr').length === lab.result.tokenIds.length));
test('timeline pins every token', () => check(lab.ui.timeline.tokens.length === lab.result.tokenIds.length));
test('run meta shows the realtime factor', () => check(/realtime/.test(text('#run-meta'))));
shot('transcribed');

// 3. mic path, fed offline (no audio device headless): same tap the live record uses
q('#autorun').checked = false;
const clip = lab.ui.input.clip;
lab.ui.input.startRecording({ live: false });
check(lab.ui.input.recording && /stop/.test(text('#btn-record')), 'recording state shown');
const rate = bro.mic.engineRate();
bro.mic.feed(resample(clip, 16000, rate), rate);
frames(8);
const n = lab.ui.input.stopRecording();
test('mic path captured the fed clip (within 5%)', () => check(Math.abs(n - clip.length) / clip.length < 0.05, n + ' vs ' + clip.length));
test('recorded take became the source', () => check(/^mic/.test(lab.ui.input.label)));

// 4. transcribe the take via the button, then cancel a run
clickOn('#btn-transcribe');
waitFor(() => !lab.running, 'mic transcription', 300000);
test('mic take transcribes to the same words', () => check(/hello/i.test(text('#transcript')), text('#transcript')));
clickOn('#btn-transcribe');
check(lab.running && !q('#btn-cancel').disabled, 'cancel armed while running');
clickOn('#btn-cancel');
waitFor(() => !lab.running, 'cancelled run settles', 300000);
test('buttons reset after cancel', () => check(!q('#btn-transcribe').disabled && q('#btn-cancel').disabled));

done('parakeet-lab');
