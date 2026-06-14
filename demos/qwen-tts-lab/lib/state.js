// Qwen TTS Lab — comprehensive, near-realtime control of Qwen3-TTS.
//
// Qwen3-TTS is autoregressive over discrete RVQ codes: there is NO editable
// prosody contour to drag (that was Kokoro's seam). Its real control seams are
// the ones this lab exposes, each mapped to one panel:
//
//   VOICE      identity — preset speaker (CustomVoice) · a natural-language
//              description (VoiceDesign) · or an x-vector designed in continuous
//              speaker space from enrolled real clips (Base). The panel that
//              shows follows the loaded checkpoint's variant.
//   DELIVERY   sampling — temperature / top-k / top-p / seed. Greedy (temp 0) is
//              the deterministic default; turn it up for varied takes.
//   RENDER     off-thread synthesis + the AR trace: the 16xF RVQ code raster and
//              the per-frame confidence strip (where the model was unsure — the
//              same places sampling diversifies).
//   STREAM     the audio delivered in chunks as the loop generates it, queued
//              gaplessly for the lowest-latency path. Stop = real barge-in.
//
// Every panel STREAMS LIVE on change (synth.js scheduleLive): touch a seam and the
// new audio plays as it generates, then a second pass draws the trace for exactly
// what you heard. The Render / Stream buttons remain for explicit one-shot takes.
//
// Modules share one global scope, loaded in order by index.html:
//   state.js     this file — shared state + stage metadata
//   helpers.js   el / mkCanvas / small dom + math helpers, fs/os bridges
//   model.js     setBadge, checkpoint load, variant adaptation, dialogs
//   voice.js     the three voice panels + currentVoice()
//   delivery.js  the sampling dials + currentSampling()
//   audio.js     clip publish/play + the gapless streaming queue
//   synth.js     scheduleLive (stream-on-change) + render/stream/barge-in, latest-wins
//   render.js    the trace cards: code raster, confidence strip, waveform
//   app.js       wire the DOM up and kick off the first load

export const $ = (s) => document.querySelector(s);

// The shared mutable state that used to live here now lives with its writer:
//   qwen / variant            → lib/model.js
//   lastResult                → lib/synth.js   (model.js clears it via setLastResult)
//   audioCtx                  → lib/audio.js   (designer/app set it via setAudioCtx)
//   inflight / streaming / streamFrames / streamAccum → lib/synth.js
//   clipId / wavSamples / wavRate → lib/audio.js
//   designedXvec / identitySource / coords → lib/designer.js
//   cvSource                  → lib/voice.js
//   seedLocked                → lib/delivery.js

// ─── trace stages ────────────────────────────────────────────────────────────
// The Qwen AR trace (opts.trace) emits two grids, both row-major (h x w) over the
// 12.5 Hz frame axis. `kind` = how to draw it.
//   codes         16 x F   the multi-codebook RVQ stream — codebook 0 (semantic,
//                          from the Talker) over 1..15 (acoustic, from the Code
//                          Predictor). Each row is one codebook; color = code id.
//   c0_confidence  1 x F   the Talker's top-1 softmax prob per frame — low where
//                          the model hedged (and where sampling has room to roam).
export const STAGE_INFO = {
  codes:         { kind: 'codes', desc: 'RVQ code stream — 16 codebooks x F frames (row 0 semantic, 1..15 acoustic)' },
  c0_confidence: { kind: 'conf',  desc: "Talker top-1 confidence per frame — low = the model hedged (sampling's playground)" },
};
export const STAGE_ORDER = ['codes', 'c0_confidence'];
