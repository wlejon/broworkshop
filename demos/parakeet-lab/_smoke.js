// Headless smoke for Parakeet Lab — drives the app's own globals (the lib/
// modules share one scope) through the mic/file → transcribe → timeline loop.
// Run (GPU) against the app dir from the bro repo root:
//   bro-headless ../broworkshop/demos/parakeet-lab _smoke.js
// Needs the real checkpoint (PARAKEET_DIR env to override) and bro's test
// clip ("Hello there. This is a test of the pipeline.").

function pumpUntil(pred, budgetMs) {
  const start = Date.now();
  while (!pred() && (Date.now() - start) < budgetMs) { sleep(20); }
  return pred();
}

const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
const MODEL_DIR = env.PARAKEET_DIR || defaultModelDir('');
const WAV = env.PARAKEET_WAV ||
  '../brosoundml/weights/qwen-tts-hello-there-this-is-a-test-of-th.wav';

// ── 1. load the model + tokenizer ────────────────────────────────────────────
$('#model-dir').value = MODEL_DIR;
loadModel(MODEL_DIR);
assert(pumpUntil(() => (model && tok) || $('#backend').classList.contains('err'), 300000),
       'model load finished');
assert(!$('#backend').classList.contains('err'),
       'model loaded without error: ' + $('#backend').textContent);
assert(model.loaded && model.sampleRate === 16000, 'parakeet handle is loaded @ 16 kHz');
console.log('model: vocab=' + model.vocabSize + ' frameSeconds=' + model.frameSeconds +
            ' pieces=' + tok.vocabCount);

// ── 2. decode the test clip through the app's file path ─────────────────────
$('#autorun').checked = true;   // setSource should kick off the run itself
$('#src-file').value = WAV;
loadSourceFile();
assert(srcSamples && srcSamples.length > 16000, 'file decoded to > 1 s of 16 kHz audio');
assert(srcClipId >= 0, 'source clip published');

// ── 3. autorun transcribed it; transcript + timeline + table rendered ────────
assert(pumpUntil(() => lastResult !== null, 300000), 'transcription finished');
const text = $('#transcript').textContent;
assert(/hello/i.test(text) && /test/i.test(text),
       'transcript contains the spoken words (got "' + text + '")');
assert(lastResult.tokenIds.length === lastResult.tokenFrames.length,
       'one frame per token');
assert($('#timeline').querySelector('canvas'), 'timeline canvas rendered');
assert($('#tokens').querySelectorAll('tr').length === lastResult.tokenIds.length,
       'token table has one row per emission');
assert($('#run-meta').textContent.indexOf('realtime') >= 0, 'run meta shows RTF');
console.log('transcript: "' + text + '" (' + lastResult.tokenIds.length + ' tokens)');

// ── 4. mic record path via the offline feed (no device in headless) ─────────
// startRecording({live:false}) installs the same samples:true tap the windowed
// app uses; bro.mic.feed pushes the clip through resample → chunk → onChunk.
$('#autorun').checked = false;
const engineRate = bro.mic.engineRate();
startRecording({ live: false });
assert(recording, 'recording state set');
// Re-rate the 16 kHz source to the engine mic rate so feed accepts it.
const fed = resample(srcSamples, TARGET_RATE, engineRate);
bro.mic.feed(fed, engineRate);
sleep(100);                      // tick the engine so onChunk drains
const n = stopRecording();
assert(n > 16000, 'mic path captured > 1 s of audio (' + n + ' samples)');
assert(Math.abs(n - srcSamples.length) / srcSamples.length < 0.05,
       'captured length within 5% of the fed clip');
console.log('mic capture: ' + n + ' samples via feed');

// ── 5. transcribe the mic-captured audio — same words ────────────────────────
lastResult = null;
runTranscribe();
assert(pumpUntil(() => lastResult !== null, 300000), 'mic transcription finished');
const micText = $('#transcript').textContent;
assert(/hello/i.test(micText) && /test/i.test(micText),
       'mic-path transcript contains the spoken words (got "' + micText + '")');
console.log('mic transcript: "' + micText + '"');

console.log('parakeet-lab smoke: PASS');
