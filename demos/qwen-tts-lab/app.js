// Qwen TTS Lab — entry point. Wire the DOM up and load the first checkpoint.
// (ES module entry: imports the lib/ modules in the original index.html order.)
import { installSystemMenu } from "/lib/system-menu.js";
import { $ } from "/app/lib/state.js";
import { browseFolder, browseFile, pParent, pName, toMono } from "/app/lib/helpers.js";
import { loadModel, defaultModelDir, setBadge, qwen, variant } from "/app/lib/model.js";
import { markDesigned, updateDesignerMeta } from "/app/lib/voice.js";
import {
  enrollRef, randomDesigned, coordsFromXvec, syncSliders, drawMap,
  voiceBasis, designedXvec, setDesignedXvec, setIdentitySource, setCoords,
} from "/app/lib/designer.js";
import { resetEmotion } from "/app/lib/emotion.js";
import { resetMascFem } from "/app/lib/mascfem.js";
import { buildDelivery } from "/app/lib/delivery.js";
import { buildSteer } from "/app/lib/steer.js";
import { play, saveWav, audioCtx, setAudioCtx } from "/app/lib/audio.js";
import { requestRender, requestStream, scheduleLive, bargeIn } from "/app/lib/synth.js";

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
  // Controls stream live on change (scheduleLive, wired per panel); the buttons
  // stay for explicit takes — Render draws the trace + plays, Stream restreams.
  $('#btn-render').addEventListener('click', requestRender);
  $('#btn-stream').addEventListener('click', () => requestStream(true));
  $('#btn-stop').addEventListener('click', bargeIn);
  $('#btn-play').addEventListener('click', play);
  $('#btn-save-wav').addEventListener('click', saveWav);
  // Text streams when you commit it (Enter / blur), not on every keystroke.
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestStream(true); });
  $('#text').addEventListener('change', scheduleLive);
  $('#instruct').addEventListener('change', scheduleLive);   // free-typed VoiceDesign text

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
    setAudioCtx(audioCtx || new AudioContext());
    const dec = audioCtx.decodeAudioFile(path);
    if (!dec || !dec.samples || !dec.samples.length) { setBadge('could not decode ' + path, true); return; }
    setDesignedXvec(qwen.embedSpeaker(toMono(dec.samples, dec.channels), { sampleRate: dec.sampleRate }));
    setIdentitySource('clone');
    // faithful clip identity (the full x-vector, not a basis projection); reflect
    // its projection onto the map/sliders so the panel shows where it landed.
    if (voiceBasis) { setCoords(coordsFromXvec(designedXvec)); syncSliders(); drawMap(); }
    if (variant === 'customvoice') markDesigned();   // render this clone via the slot override
    updateDesignerMeta();
    setBadge('cloned ' + pName(path) + ' · streaming…');
    requestStream(true);
  } catch (e) { setBadge('clone: ' + e.message, true); }
}

installSystemMenu();
init();
