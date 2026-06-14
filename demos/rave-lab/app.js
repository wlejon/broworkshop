// RAVE Lab — entry point. Encode a sound into RAVE's latent curves, reshape the
// curves, and hear the decode morph in real time. See lib/state.js for the
// module map and the encode → edit → decode loop this app is built around.

import { $ } from "/app/lib/state.js";
import { rave, setBadge, browseFolder, loadModel, browseFile, defaultModelDir, fileExists } from "/app/lib/model.js";
import { genTone, decodeFileToSource, playClipId } from "/app/lib/audio.js";
import { setSource, srcClipId, outClipId, runDecode, enc } from "/app/lib/render.js";
import { resetAll, activePaint, paintAt, onPaintUp } from "/app/lib/curves.js";

function makeTone() {
  if (!rave) { setBadge('load a model first', true); return; }
  const freq = parseFloat($('#tone-freq').value) || 220;
  const secs = parseFloat($('#tone-secs').value) || 1.5;
  const kind = $('#tone-kind').value;
  setSource(genTone(kind, freq, secs), `${kind} ${freq}Hz`);
}

function loadSourceFile() {
  if (!rave) { setBadge('load a model first', true); return; }
  const path = $('#src-file').value.trim();
  if (!path) { setBadge('pick an audio file', true); return; }
  setBadge('decoding file…');
  try {
    const mono = decodeFileToSource(path);
    if (!mono) { setBadge('could not decode ' + path, true); return; }
    const name = path.split(/[\\\/]/).pop();
    setSource(mono, name);
  } catch (e) { setBadge('file error: ' + e.message, true); }
}

function init() {
  // model
  $('#btn-browse-model').addEventListener('click', () => {
    const d = browseFolder($('#model-dir').value.trim()); if (d) $('#model-dir').value = d;
  });
  $('#btn-load').addEventListener('click', () => loadModel($('#model-dir').value));

  // source
  $('#btn-tone').addEventListener('click', makeTone);
  $('#btn-browse-file').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus'); if (f) $('#src-file').value = f;
  });
  $('#btn-loadfile').addEventListener('click', loadSourceFile);
  $('#src-file').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSourceFile(); });

  // transport
  $('#btn-play-src').addEventListener('click', () => playClipId(srcClipId));
  $('#btn-play-out').addEventListener('click', () => playClipId(outClipId));
  $('#btn-decode').addEventListener('click', () => runDecode($('#autoplay').checked));
  $('#btn-reset').addEventListener('click', resetAll);
  $('#noise').addEventListener('change', () => { if (enc) runDecode($('#autoplay').checked); });
  $('#stereo').addEventListener('change', () => { if (enc) runDecode($('#autoplay').checked); });
  $('#width').addEventListener('change', () => { if (enc && $('#stereo').checked) runDecode($('#autoplay').checked); });

  // one global drag pair so re-rendered curves never leak listeners
  window.addEventListener('mousemove', (e) => { if (activePaint) paintAt(e); });
  window.addEventListener('mouseup', () => { if (activePaint) onPaintUp(); });

  // pre-fill the model dir and load if we found one on disk
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  if (fileExists(dir + '/config.json')) loadModel(dir);
  else setBadge('pick a RAVE model directory, then Load');
}
init();
