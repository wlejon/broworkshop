// Supertonic Lab — entry point. Wire the DOM up and load the first model.
// (ES module entry: the lib/ modules import each other; this file just wires
// the chrome and kicks off the initial load.)
import { $ } from "/app/lib/state.js";
import { browseFolder, pParent } from "/app/lib/helpers.js";
import { loadModel, defaultModelDir } from "/app/lib/model.js";
import { buildFlow } from "/app/lib/delivery.js";
import { buildDesign } from "/app/lib/design.js";
import { play, saveWav } from "/app/lib/audio.js";
import { requestSynth, bargeIn } from "/app/lib/synth.js";

function init() {
  // ── model bar ──
  $('#btn-browse-model').addEventListener('click', () => {
    const d = browseFolder(pParent($('#model-dir').value.trim()));
    if (d) { $('#model-dir').value = d; loadModel(d); }
  });
  $('#model-dir').addEventListener('change', () => loadModel($('#model-dir').value.trim()));
  $('#btn-reload').addEventListener('click', () => loadModel($('#model-dir').value.trim()));

  // ── flow dials + voice designer ──
  buildFlow();
  buildDesign();

  // ── transport ──
  $('#btn-synth').addEventListener('click', requestSynth);
  $('#btn-stop').addEventListener('click', bargeIn);
  $('#btn-play').addEventListener('click', play);
  $('#btn-save-wav').addEventListener('click', saveWav);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestSynth(); });
  $('#text').addEventListener('change', () => { if ($('#btn-synth').disabled === false) requestSynth(); });

  // first load
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  loadModel(dir);
}
init();
