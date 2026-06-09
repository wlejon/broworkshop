// Qwen TTS Lab — entry point. Wire the DOM up and load the first checkpoint.
// (All lib/ modules share this global scope, loaded in order by index.html.)

function init() {
  // ── checkpoint bar ────────────────────────────────────────────────────────
  $('#btn-browse-model').addEventListener('click', () => {
    const d = browseFolder(pParent($('#model-dir').value.trim()));
    if (d) { $('#model-dir').value = d; loadModel(d); }
  });
  $('#model-dir').addEventListener('change', () => loadModel($('#model-dir').value.trim()));
  $('#btn-reload').addEventListener('click', () => loadModel($('#model-dir').value.trim()));

  // ── voice designer (Base) buttons ────────────────────────────────────────
  $('#btn-browse-wav').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus'); if (f) $('#ref-wav').value = f;
  });
  $('#btn-enroll').addEventListener('click', enrollRef);
  $('#btn-rand-xv').addEventListener('click', randomDesigned);
  $('#btn-clone').addEventListener('click', cloneOnce);
  $('#btn-emo-reset').addEventListener('click', resetEmotion);
  $('#btn-mf-reset').addEventListener('click', resetMascFem);

  // ── delivery dials + logit-bias steering ──────────────────────────────────
  buildDelivery();
  buildSteer();

  // ── transport ─────────────────────────────────────────────────────────────
  $('#btn-render').addEventListener('click', requestRender);
  $('#btn-stream').addEventListener('click', requestStream);
  $('#btn-stop').addEventListener('click', bargeIn);
  $('#btn-play').addEventListener('click', play);
  $('#btn-save-wav').addEventListener('click', saveWav);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestRender(); });

  // first load
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  loadModel(dir);
}

// Clone a reference clip in one shot: encode it to an x-vector and render that
// point immediately (transient — not added to the anchor blend).
function cloneOnce() {
  const path = $('#ref-wav').value.trim();
  if (!path) { setBadge('enter or browse a reference .wav first', true); return; }
  try {
    audioCtx = audioCtx || new AudioContext();
    const dec = audioCtx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.samples.length) { setBadge('could not decode ' + path, true); return; }
    designedXvec = qwen.embedSpeaker(toMono(dec.samples, dec.channels), { sampleRate: dec.sampleRate });
    // faithful clip identity (the full x-vector, not a basis projection); reflect
    // its projection onto the sliders so the panel shows where it landed.
    if (voiceBasis) { coords = coordsFromXvec(designedXvec); syncSliders(); }
    updateDesignerMeta();
    setBadge('cloned ' + pName(path) + ' · rendering…');
    requestRender();
  } catch (e) { setBadge('clone: ' + e.message, true); }
}

init();
