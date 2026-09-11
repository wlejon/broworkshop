// OmniVoice Lab — entry point. Wire the DOM up and load the model.
// (ES module entry: the lib/ modules import each other by absolute /app/ path;
// see lib/state.js for the map of what lives where.)
import { installSystemMenu } from "/lib/system-menu.js";
import { $ } from "/app/lib/state.js";
import { browseFolder, browseFile, pParent } from "/app/lib/helpers.js";
import { loadModel, defaultModelDir } from "/app/lib/model.js";
import { promptFromClip, transcribeClip, loadOvcp, clearInstruct } from "/app/lib/voice.js";
import { onTextChanged, rebuildSentences } from "/app/lib/text.js";
import { buildSchedule, updateEstimate } from "/app/lib/schedule.js";
import { generate, pipeline, cancel } from "/app/lib/synth.js";
import { play, saveWav, stop } from "/app/lib/audio.js";
import { onDocMouseMove, onDocMouseUp, clearSelection } from "/app/lib/grid.js";

function init() {
  // ── model bar ─────────────────────────────────────────────────────────────
  $('#btn-browse-model').addEventListener('click', () => {
    const d = browseFolder(pParent($('#model-dir').value.trim()));
    if (d) { $('#model-dir').value = d; loadModel(d); }
  });
  $('#model-dir').addEventListener('change', () => loadModel($('#model-dir').value.trim()));
  $('#btn-reload').addEventListener('click', () => loadModel($('#model-dir').value.trim()));

  // ── voice ─────────────────────────────────────────────────────────────────
  $('#btn-browse-wav').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus');
    if (f) { $('#ref-wav').value = f; updateEstimate(); }
  });
  $('#ref-wav').addEventListener('input', updateEstimate);
  $('#ref-text').addEventListener('input', updateEstimate);
  $('#btn-transcribe').addEventListener('click', transcribeClip);
  $('#btn-prompt-clip').addEventListener('click', promptFromClip);
  $('#btn-load-ovcp').addEventListener('click', loadOvcp);
  $('#btn-instruct-clear').addEventListener('click', clearInstruct);

  // ── text ──────────────────────────────────────────────────────────────────
  $('#text').addEventListener('input', onTextChanged);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate(); });
  $('#chain-on').addEventListener('change', rebuildSentences);

  // ── length + schedule ─────────────────────────────────────────────────────
  buildSchedule();

  // ── transport ─────────────────────────────────────────────────────────────
  $('#btn-generate').addEventListener('click', generate);
  $('#btn-pipeline').addEventListener('click', pipeline);
  $('#btn-stop').addEventListener('click', () => { cancel(); stop(); });
  $('#btn-play').addEventListener('click', play);
  $('#btn-save-wav').addEventListener('click', saveWav);

  // keyboard shortcuts (when not typing in inputs/textareas)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      play();
    } else if (e.code === 'Escape') {
      clearSelection();
    }
  });

  // one global mouse pair for the span drag, so re-rendered cards never leak listeners
  window.addEventListener('mousemove', onDocMouseMove);
  window.addEventListener('mouseup', onDocMouseUp);

  // first load
  const dir = defaultModelDir($('#model-dir').value.trim());
  $('#model-dir').value = dir;
  loadModel(dir);
}

installSystemMenu();
init();
