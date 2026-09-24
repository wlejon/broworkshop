// Sortformer Lab: boot loads the model; a real speech clip fed window by
// window through the live session path fills the timeline and speaker
// cards; the same clip opened through the input bar diarizes offline; the
// threshold slider and Clear drive the view. Skips without the checkpoint
// or the test clip.
//
//   scripts/validate.sh --ml demos/sortformer-lab

import { check, test, done, waitFor, q, text, clickOn, typeInto, setValue, shot, needWeights } from "/lib/kit/test.js";
import { readWav } from "/lib/kit/audio.js";
import { lab, SORTFORMER } from "/app/lab.js";

needWeights('Sortformer 4spk-v2.1', SORTFORMER, { probe: 'config.json' });
const WAV = needWeights('speech test clip', ['brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav']);

waitFor(() => lab.model || lab.error, 'model load', 300000);
check(!lab.error, 'model loaded: ' + lab.error);
test('handle loaded at 16 kHz with 4 speakers', () =>
    check(lab.model.loaded && lab.model.sampleRate === 16000 && lab.model.numSpeakers === 4));
test('four speaker cards', () => check(document.querySelectorAll('#speakers .k-speaker').length === 4));
test('listen enabled once loaded', () => check(!q('#btn-listen').disabled));

// 1. the live path, driven without a device: 1 s windows through the session
const clip = readWav(WAV, 16000).pcm;
lab.clear();
let emitted = 0, maxProb = 0, inRange = true;
for (let off = 0; off < clip.length; off += 16000) {
    const d = lab.feedWindow(clip.subarray(off, Math.min(off + 16000, clip.length)));
    check(d && d.numSpeakers === 4, 'feed returned a 4-speaker result');
    for (const p of d.probs) { if (!(p >= 0 && p <= 1)) inRange = false; if (p > maxProb) maxProb = p; }
    emitted += d.numFrames;
}
test('streaming feed emitted frames', () => check(emitted > 0 && lab.totalFrames === emitted));
test('probabilities in [0, 1]', () => check(inRange));
test('speech lights a speaker (max ' + maxProb.toFixed(3) + ')', () => check(maxProb > 0.3));
test('a card counts speaking time', () => check(lab.ui.speakers.totals().some((t) => t > 0)));
test('stats show the frame count', () => check(text('#stats').indexOf(String(emitted)) >= 0, text('#stats')));
shot('live');

// 2. threshold: raising it to the top idles the cards
setValue('#thresh', 0.9);
test('threshold reaches the view', () => check(lab.ui.speakers.threshold === 0.9 && text('#thresh-val') === '0.90'));
setValue('#thresh', 0.5);

// 3. clear
clickOn('#btn-clear');
test('clear empties the timeline', () => check(lab.frames.length === 0 && lab.totalFrames === 0));

// 4. offline: open the clip through the input bar (autorun diarizes it)
typeInto('#src-file', WAV);
clickOn('#btn-open-file');
waitFor(() => lab.result || /diarize:/.test(text('#status')), 'offline diarize', 300000);
check(lab.result, 'offline diarize finished: ' + text('#status'));
test('offline result fills the timeline', () => check(lab.frames.length === lab.result.numFrames && lab.result.numFrames > 0));
test('offline result lights a speaker', () => check(lab.ui.speakers.totals().some((t) => t > 0)));
test('diarize button re-enabled', () => check(!q('#btn-diarize').disabled));
shot('offline');

done('sortformer-lab');
