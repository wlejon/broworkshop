// ═══ transcription ═══════════════════════════════════════════════════════════
// The async bro.stt.transcribe(model, audio, opts) path: the TDT decode runs
// on a background native thread, each emitted token id streams back to this
// thread via onToken (the transcript grows live), and onDone delivers the
// full { tokenIds, tokenFrames } pair for the timeline. handle.cancel() is
// real — the decode loop polls the flag once per encoder frame.

import { $, TARGET_RATE } from "/app/lib/state.js";
import { model, tok, setBadge } from "/app/lib/model.js";
import { publishClip } from "/app/lib/audio.js";
import { drawTimeline, renderTokenTable } from "/app/lib/render.js";

export let srcSamples = null;       // Float32Array — source audio @ 16 kHz mono
let srcLabel = '';                  // short description for the src meta line
export let srcClipId = -1;          // published audio clip for the source
export let transcribing = false;    // an async transcribe is in flight
let runHandle = null;               // AsyncHandle of the in-flight transcribe
let streamIds = [];                 // token ids streamed so far (live partial)
export let lastResult = null;       // { tokenIds, tokenFrames } of the last finished run

// Install a new source clip and (optionally) kick off a run.
export function setSource(samples, label) {
  srcSamples = samples;
  srcLabel = label;
  srcClipId = publishClip(srcClipId, samples);
  $('#src-meta').textContent =
    label + ' · ' + (samples.length / TARGET_RATE).toFixed(2) + ' s @ 16 kHz';
  $('#btn-play-src').disabled = (srcClipId < 0);
  $('#btn-transcribe').disabled = !(model && tok) || transcribing;
  drawTimeline(samples, null);
  if ($('#autorun').checked && model && tok && !transcribing) runTranscribe();
}

function setTranscript(text, streaming) {
  const el = $('#transcript');
  el.classList.toggle('streaming', !!streaming);
  if (!text) {
    el.innerHTML = '<span class="placeholder">…</span>';
    return;
  }
  el.textContent = text;
  if (streaming) {
    const c = document.createElement('span');
    c.className = 'cursor';
    c.textContent = ' ▌';
    el.appendChild(c);
  }
}

export function runTranscribe() {
  if (!model || !tok) { setBadge('load a model first', true); return; }
  if (!srcSamples)    { setBadge('record or load audio first', true); return; }
  if (transcribing) return;
  transcribing = true;
  streamIds = [];
  lastResult = null;
  setTranscript('', true);
  $('#btn-transcribe').disabled = true;
  $('#btn-cancel').disabled = false;
  $('#run-meta').textContent = '';
  setBadge('transcribing…');
  const t0 = Date.now();

  runHandle = bro.stt.transcribe(model, srcSamples, {
    // Live partial: re-decode the running id list each token. SentencePiece
    // detokenization is context-dependent at the boundary, so re-decoding the
    // whole prefix (cheap — a few hundred ids) beats appending pieces.
    onToken: (id) => {
      streamIds.push(id);
      setTranscript(tok.decode(streamIds), true);
    },
    onDone: (result, info) => {
      transcribing = false;
      runHandle = null;
      $('#btn-transcribe').disabled = false;
      $('#btn-cancel').disabled = true;
      if (info.error)     { setBadge('transcribe error: ' + info.error, true); return; }
      if (info.cancelled) { setBadge('cancelled'); setTranscript(tok.decode(streamIds)); return; }
      lastResult = result;
      const secs = (Date.now() - t0) / 1000;
      const audioSecs = srcSamples.length / TARGET_RATE;
      setTranscript(tok.decode(result.tokenIds).trim() || '(no speech)');
      $('#run-meta').textContent =
        `${result.tokenIds.length} tokens · ${secs.toFixed(2)} s · ` +
        `${(audioSecs / secs).toFixed(1)}× realtime`;
      drawTimeline(srcSamples, result);
      renderTokenTable(result);
      setBadge('ready');
    },
  });
}

export function cancelTranscribe() {
  if (runHandle) { try { runHandle.cancel(); } catch (e) {} }
}
