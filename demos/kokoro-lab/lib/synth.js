import { $, dirty, kokoro, pinnedEdit, putDirty, putLastTrace, putRenderTimer, putSynthBusy, renderTimer, synthBusy, voice } from "/app/lib/state.js";
import { rebuildVoice } from "/app/lib/designer.js";
import { setBadge } from "/app/lib/model.js";
import { renderStages } from "/app/lib/render.js";
import { reapplyPinnedEdit, snapshotPredicted } from "/app/lib/edit.js";
import { applyEmotion, emotionActive } from "/app/lib/emotion.js";
import { play, setClip } from "/app/lib/helpers.js";

// ═══ run ═══════════════════════════════════════════════════════════════════
// (Re)render the current voice. We synthesize it TWICE on the background thread:
// first audio-only so it plays as fast as possible (no trace host-copies, no
// stage drawing in the way), then again WITH the trace to draw the pipeline a
// beat later. The model runs one synth at a time, so the two passes are
// sequential; if the voice changes mid-flight we drop back to audio-first for
// the newest one (latest-wins) — hear it now, see it once it settles.
export function run() {
  if (!kokoro) return;
  if (renderTimer) { clearTimeout(renderTimer); putRenderTimer(0); }
  if (!rebuildVoice()) return;            // render exactly what the sliders define now
  putDirty(true);
  pump();
}

// Start the next pass if one isn't already running and the voice is dirty.
export function pump() {
  if (synthBusy || !dirty || !kokoro || !voice) return;
  let ids;
  try { ids = bro.tts.phonemize($('#text').value); }
  catch (e) { setBadge('phonemize: ' + e.message, true); putDirty(false); return; }
  if (!ids || !ids.length) { setBadge('no phonemes for that text', true); putDirty(false); return; }
  putDirty(false);
  // with a pinned edit the unedited audio is never heard (the trace pass
  // re-decodes & plays the edited version), so skip the fast audio-only pass.
  if (pinnedEdit) synthTrace(ids); else synthAudio(ids);
}

// Kick off a background synth, marking the model busy. A synchronous throw
// (e.g. the model momentarily in flight) clears the flag and re-pumps instead
// of wedging the state machine.
export function safeSynth(ids, opts) {
  putSynthBusy(true);
  try {
    bro.tts.synthesize(kokoro, ids, voice, opts);
  } catch (e) {
    putSynthBusy(false);
    setBadge('synthesize: ' + e.message, true);
    if (dirty) setTimeout(pump, 0);
  }
}

// Pass 1 — fast: audio only, play it the moment it lands.
export function synthAudio(ids) {
  $('#run-meta').textContent = 'synthesizing…';
  safeSynth(ids, {
    onDone: (r, info) => {
      putSynthBusy(false);
      if (info.error) { setBadge('synthesize: ' + info.error, true); return; }
      if (!info.cancelled) {
        setClip(r.samples, r.sampleRate);
        $('#btn-play').disabled = false;
        if (!pinnedEdit) setTimeout(play, 40);   // pinned: trace pass re-decodes & plays the edited audio
      }
      if (dirty) pump();              // a newer voice arrived — hear it next
      else synthTrace(ids);           // audio is current → now gather the trace
    },
  });
}

// Pass 2 — gather + draw the pipeline trace for the (now playing) voice.
export function synthTrace(ids) {
  const t0 = performance.now();
  safeSynth(ids, {
    trace: true,
    onDone: (r, info) => {
      putSynthBusy(false);
      if (!info.error && !info.cancelled) {
        putLastTrace(r);
        snapshotPredicted(r);          // baseline for the prosody-edit reset
        const stages = r.stages || [];
        const ms = (performance.now() - t0).toFixed(0);
        $('#run-meta').textContent =
          ids.length + ' phonemes · ' + stages.length + ' stages · ' +
          (r.samples.length / r.sampleRate).toFixed(2) + 's audio · +' + ms + ' ms trace';
        const sc = $('#stages').scrollTop;
        renderStages(stages);
        $('#stages').scrollTop = sc;   // keep your place while exploring
        // ride the retained prosody onto this fresh prediction; if the text no
        // longer fits, the pin is dropped and we present the prediction as-is.
        // (When pinned, this pass is the *only* one — see pump — so on a miss we
        // publish this pass's own audio before playing it.)
        if (pinnedEdit && !reapplyPinnedEdit()) { setClip(r.samples, r.sampleRate); play(); }
        else if (!pinnedEdit && emotionActive()) applyEmotion();   // derive emotion onto this fresh prediction
      }
      if (dirty) pump();
    },
  });
}

