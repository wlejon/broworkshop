// Parakeet Lab — entry point. Speak into the mic (or open a clip), watch
// Parakeet-TDT stream the transcript in live, and see every token pinned to
// the encoder frame it was decoded from. See lib/state.js for the module map
// and the mic/file → transcribe → timeline loop this app is built around.

import { installSystemMenu } from "/lib/system-menu.js";
import { $ } from "/app/lib/state.js";
import { setBadge, browseFolder, loadModel, browseFile, defaultModelDir, fileExists } from "/app/lib/model.js";
import { decodeFileToSource, recording, startRecording, stopRecording, playClipId } from "/app/lib/audio.js";
import { setSource, transcribing, srcClipId, runTranscribe, cancelTranscribe } from "/app/lib/transcribe.js";

function loadSourceFile() {
  const path = $('#src-file').value.trim();
  if (!path) { setBadge('pick an audio file', true); return; }
  setBadge('decoding file…');
  try {
    const mono = decodeFileToSource(path);
    if (!mono) { setBadge('could not decode ' + path, true); return; }
    const name = path.split(/[\\\/]/).pop();
    setSource(mono, name);
    if (!transcribing) setBadge('ready');
  } catch (e) { setBadge('file error: ' + e.message, true); }
}

function init() {
  // model
  $('#btn-browse-model').addEventListener('click', () => {
    const d = browseFolder($('#model-dir').value.trim()); if (d) $('#model-dir').value = d;
  });
  $('#btn-load').addEventListener('click', () => loadModel($('#model-dir').value));
  $('#model-dir').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadModel($('#model-dir').value); });

  // source
  $('#btn-record').addEventListener('click', () => {
    if (recording) stopRecording();   // → setSource → auto-transcribe
    else startRecording();
  });
  $('#btn-browse-file').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus'); if (f) $('#src-file').value = f;
  });
  $('#btn-loadfile').addEventListener('click', loadSourceFile);
  $('#src-file').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSourceFile(); });

  // transport
  $('#btn-play-src').addEventListener('click', () => playClipId(srcClipId));
  $('#btn-transcribe').addEventListener('click', runTranscribe);
  $('#btn-cancel').addEventListener('click', cancelTranscribe);

  // pre-fill the model dir and load if we found one on disk
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  if (fileExists(dir + '/config.json')) loadModel(dir);
  else setBadge('pick a Parakeet checkpoint directory, then Load');
}
installSystemMenu();
init();
