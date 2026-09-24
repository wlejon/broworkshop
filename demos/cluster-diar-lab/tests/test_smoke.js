// Cluster Diarization Lab: boot loads both models; a clean two-female clip
// (Kokoro Bella + Emma, alternating turns) handed to the input bar is
// diarized into 2 speakers (the case Sortformer's 4-slot head collapses to
// 1); moving the cosine knob re-diarizes; Clear empties the view. Skips
// without the weights or the Kokoro sample clips.
//
//   scripts/validate.sh --ml demos/cluster-diar-lab

import { check, test, done, waitFor, q, text, clickOn, setValue, shot, needWeights } from "/lib/kit/test.js";
import { readWav, concatPcm, signal } from "/lib/kit/audio.js";
import { lab, SORTFORMER, ENCODER } from "/app/lab.js";

needWeights('Sortformer 4spk-v2.1', SORTFORMER, { probe: 'config.json' });
needWeights('ECAPA speaker encoder', ENCODER, { probe: 'model.safetensors' });
const KOKORO = needWeights('Kokoro sample clips', ['brosoundml/weights/kokoro/out'], { probe: 'af_bella/synth_0.wav' });

waitFor(() => lab.model || lab.error, 'model load', 300000);
check(!lab.error, 'models loaded: ' + lab.error);
test('cluster diarizer loaded', () => check(lab.model.loaded));

// two similar female voices, alternating
const gap = signal.silence(0.4, 16000);
const parts = [];
for (const k of [0, 2]) {
    parts.push(readWav(KOKORO + '/af_bella/synth_' + k + '.wav', 16000).pcm, gap);
    parts.push(readWav(KOKORO + '/bf_emma/synth_' + k + '.wav', 16000).pcm, gap);
}
const clip = concatPcm(parts);
console.log('clip ' + (clip.length / 16000).toFixed(2) + ' s, two female voices');

// sync API: the binding itself separates them
const d = lab.model.diarize({ samples: clip, sampleRate: 16000 }, { clusterThreshold: 0.40 });
test('sync diarize: 2 speakers (got ' + d.numSpeakers + ')', () => check(d.numSpeakers === 2));

// the app path: the clip lands in the input bar and autorun diarizes it
lab.ui.input.set(clip, 'bella + emma');
waitFor(() => lab.result && !lab.busy, 'app diarize', 120000);
test('app path: 2 speakers (got ' + lab.result.numSpeakers + ')', () => check(lab.result.numSpeakers === 2));
test('two speaker cards', () => check(document.querySelectorAll('#speakers .k-speaker').length === 2));
test('both speakers have speaking time', () => check(lab.ui.speakers.totals().every((t) => t > 0)));
test('stats show the count', () => check(/speakers\s*2/.test(text('#stats')), text('#stats')));
shot('two-voices');

// the cosine knob re-diarizes with the new threshold
const before = lab.result;
setValue('#cos', 0.7);
waitFor(() => lab.result !== before && !lab.busy, 're-diarize after the knob', 120000);
test('knob value reached the run', () => check(/cosine\s*0\.70/.test(text('#stats')), text('#stats')));

// clear
clickOn('#btn-clear');
test('clear empties the view', () => check(!lab.result && lab.ui.speakers.numSpeakers === 0));
test('diarize button still armed for the clip', () => check(!q('#btn-diarize').disabled));

done('cluster-diar-lab');
