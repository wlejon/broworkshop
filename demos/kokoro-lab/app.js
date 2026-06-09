// Kokoro Lab — entry point. Steer a voice through Kokoro's style space, then
// watch and hear it take shape stage by stage. The app is split across lib/
// modules (all sharing one global scope, loaded in order by index.html):
//
//   state.js     shared state, stage metadata (STAGE_INFO / STAGE_ORDER)
//   source.js    data-source detection, paths, voice_basis load
//   designer.js  the slider basis + voice-space math, seed / random
//   clone.js     ECAPA -> style clone of a reference clip, save voice
//   model.js     setBadge, Kokoro model load, switchSource, file dialogs
//   synth.js     run / pump / the audio-then-trace background passes
//   render.js    persistent stage cards, the phoneme data-flow highlight
//   align.js     pred_dur alignment (the editable timing row)
//   curves.js    F0 / energy contour editing
//   edit.js      decodeFrom commit, re-timing, retained ("pinned") prosody
//   emotion.js   the valence/arousal/dominance prosody panel
//   heat.js      heatmap / waveform drawing, channel ordering
//   helpers.js   audio clip publish/play, el / mkCanvas / stats
//   app.js       (this file) wire the DOM up and kick off the first load
//
// ═══ wire up ═══════════════════════════════════════════════════════════════
function init() {
  // data source: browse a folder, or edit the path + Reload. Both re-detect the
  // layout and reload everything derived from it. (The seed dropdown, sliders and
  // clone adapters all come from the source, so picking one rebuilds them.)
  $('#btn-browse-data').addEventListener('click', () => {
    const d = browseFolder(paths.root); if (!d) return;
    $('#data-root').value = d; switchSource(d);
  });
  $('#data-root').addEventListener('change', () => setSource($('#data-root').value.trim()));
  $('#btn-reload').addEventListener('click', () => switchSource($('#data-root').value.trim()));
  $('#btn-browse-wav').addEventListener('click', () => {
    const f = browseFile('Audio|wav;flac;mp3;ogg;opus'); if (f) $('#ref-wav').value = f;
  });
  $('#btn-browse-qwen').addEventListener('click', () => {
    const d = browseFolder($('#qwen-dir').value.trim() || paths.spkenc); if (d) $('#qwen-dir').value = d;
  });

  // voice designer — handlers no-op until a basis is loaded, so wire them once.
  $('#source').addEventListener('change', () => seedFrom($('#source').value, true));
  $('#btn-random').addEventListener('click', randomVoice);
  $('#btn-neutral').addEventListener('click', () => { $('#source').value = '__neutral__'; seedFrom('__neutral__', true); });
  $('#btn-clone').addEventListener('click', clone);
  $('#btn-save').addEventListener('click', saveVoice);
  $('#btn-run').addEventListener('click', run);
  $('#btn-play').addEventListener('click', play);
  $('#btn-save-wav').addEventListener('click', saveWav);
  buildEmotion();
  $('#btn-emo-neutral').addEventListener('click', resetEmotion);
  buildTimbre();
  $('#btn-timbre-neutral').addEventListener('click', resetTimbre);
  buildMascFem();
  $('#btn-mf-neutral').addEventListener('click', resetMascFem);
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  // prosody-edit drag: one global pair so re-rendered cards never leak listeners
  window.addEventListener('mousemove', (e) => { if (activePaint) paintAt(e); else if (activeDrag) dragDurAt(e); });
  window.addEventListener('mouseup', () => { if (activePaint) onPaintUp(); else if (activeDrag) onDurUp(); });

  // Point at real data on this machine before the first load: the HTML default
  // is a Windows dev path, so probe the usual spots (and any remembered choice).
  const root = defaultRoot($('#data-root').value.trim());
  $('#data-root').value = root;
  switchSource(root);
}
init();
