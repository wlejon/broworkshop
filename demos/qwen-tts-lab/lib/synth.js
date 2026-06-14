// ═══ synth — live streaming on change · Render (trace) · barge-in ═════════════
// Now that Qwen3-TTS generates well above realtime, the lab STREAMS on every
// change (like Kokoro re-renders on a slider drag): touch any seam — voice,
// emotion, masc/fem, a sampling dial, a logit bias — and the new audio starts
// playing as the loop generates it, no button press. scheduleLive() is the
// change-driven entry; the panels call it.
//
// Two passes, the Kokoro pattern adapted for streaming:
//   1. STREAM   audio plays as it generates (lowest first-audio latency).
//   2. TRACE    once GENERATION finishes (not playback — streamed audio is still
//               flowing out), re-run the SAME opts+seed off-thread WITH the trace
//               to draw the 16×F code raster + confidence strip. Same seed ⇒ the
//               trace matches the streamed audio sample-for-sample; no replay.
//
// One synthesis runs at a time (the model is single-owner). Everything is
// latest-wins: a newer change cancels whatever's in flight (stream or trace) and
// restreams from the previous run's completion — never tripping the busy guard.
// The streaming path drives EVERY voice (speaker · instruct · designed x-vector ·
// speakerVector slot · voiceSteer · logitBias) — they all ride opts/sampling,
// which synthesizeStream reads, so there is no speaker-only restriction.

import { $ } from "/app/lib/state.js";
import { setBadge, qwen, variant, variantHint, currentLanguage } from "/app/lib/model.js";
import { currentVoice } from "/app/lib/voice.js";
import { currentSampling } from "/app/lib/delivery.js";
import { steerOpts } from "/app/lib/steer.js";
import { emotionActive, emotionBasis, applyEmotion } from "/app/lib/emotion.js";
import { mascFemActive, mascFemBasis, applyMascFem } from "/app/lib/mascfem.js";
import { setClip, streamReset, streamPush, streamStop } from "/app/lib/audio.js";
import { renderStages, renderStreamMeter } from "/app/lib/render.js";

// owned shared state
export let lastResult = null;  // { samples, sampleRate, stages? } of the last synthesis
export function setLastResult(v) { lastResult = v; }
let inflight = null;           // the current AsyncHandle (render or stream), for barge-in
let streaming = false;         // a stream is currently in flight
export let streamFrames = 0;   // frames (chunks) received so far this stream (read by render.js)
export let streamAccum = [];   // accumulated streamed chunks (read by render.js)

export const CHUNK_FRAMES = 8; // ≈0.64 s per streamed chunk (low first-audio latency)
const LIVE_DEBOUNCE = 160;     // ms — coalesce a slider drag into one stream, fire on pause
let wantNext = null;           // a queued { mode, trace, opts, noPlay } to run once the model frees
let liveTimer = 0;             // debounce timer for change-driven streaming

// A control change streams the new audio after a short settle (so a drag fires
// once you pause, never mid-drag), then draws the trace once it lands.
export function scheduleLive() {
  if (!qwen) return;
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { liveTimer = 0; requestStream(true); }, LIVE_DEBOUNCE);
}

export function requestRender() { wantNext = { mode: 'render' }; kick(); }
// trace !== false ⇒ chain a trace pass after the stream (the live + button default;
// a bare requestStream() or a button-click event arg both keep it on).
export function requestStream(trace) { wantNext = { mode: 'stream', trace: trace !== false }; kick(); }

function kick() {
  if (inflight) { try { inflight.cancel(); } catch (e) {} return; }   // onDone will re-kick
  if (!wantNext) return;
  const w = wantNext; wantNext = null;
  if (w.mode === 'render') doRender(w); else doStream(w);
}

// Stop generation + playback now (barge-in). Drops any queued / debounced request.
export function bargeIn() {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
  wantNext = null;
  if (inflight) { try { inflight.cancel(); } catch (e) {} }
  streamStop(); streaming = false;
  transport(false);
}

// Toggle the transport buttons for the active/idle state.
function transport(busy) {
  $('#btn-render').disabled = busy || !qwen;
  $('#btn-stream').disabled = busy || !qwen;
  $('#btn-stop').disabled   = !busy;
}

// The pure additive steering direction (Σ α·emotion + α·masc-fem) in x-vector
// space, sized to the basis dim — for variants with no base x-vector to fold it
// into. C++ adds it to the prefill speaker slot via opts.voiceSteer. Null when
// nothing is dialed in (or no basis loaded). Base folds the same offsets into the
// designed x-vector through currentVoice(), so this is the CustomVoice path.
function voiceSteerVector() {
  if (!emotionActive() && !mascFemActive()) return null;
  let dim = (emotionBasis && emotionBasis.dim) || (mascFemBasis && mascFemBasis.dim) || 0;
  if (!dim && emotionBasis) for (const e of emotionBasis.emotions) { if (emotionBasis.full[e]) { dim = emotionBasis.full[e].length; break; } }
  if (!dim && mascFemBasis && mascFemBasis.full.M) dim = mascFemBasis.full.M.length;
  if (!dim) return null;
  return applyMascFem(applyEmotion(new Float32Array(dim)));
}

function gatherOpts() {
  const voice = currentVoice();
  if (variant === 'base' && !voice) { setBadge('design a voice first (enroll or 🎲 random)', true); return null; }
  const s = currentSampling();
  const opts = Object.assign({}, voice, {
    language: currentLanguage(),
    temperature: s.temperature, topK: s.topK, topP: s.topP, seed: s.seed,
    repetitionPenalty: s.repetitionPenalty, adaptive: s.adaptive,
  });
  const lb = steerOpts();
  if (lb) opts.logitBias = lb;
  // CustomVoice: the emotion / masc-fem axes can't fold into a base x-vector (there
  // isn't one), so pass them as an additive prefill-slot steer that nudges the
  // preset speaker's codec-embedding row. Base already folds them into the x-vector.
  if (variant === 'customvoice') {
    const vs = voiceSteerVector();
    if (vs) opts.voiceSteer = vs;
  }
  return opts;
}

// ── Render: synthesize off-thread, draw the trace ───────────────────────────
// Two callers: the Render button (req.opts unset → fresh opts, plays the buffer)
// and the live trace pass (req.opts = the stream's resolved opts, req.noPlay set →
// same seed, draw the trace beside the still-playing streamed audio, no replay).
function doRender(req) {
  const text = $('#text').value;
  const opts = req.opts || gatherOpts(); if (!opts) return;
  opts.trace = true;
  const noPlay = !!req.noPlay;
  const t0 = performance.now();
  transport(true);
  if (!noPlay) { $('#run-meta').textContent = 'rendering…'; $('#latency').textContent = ''; }
  try {
    opts.onDone = (r, info) => {
      inflight = null; transport(false);
      if (info.error) { setBadge('render: ' + info.error, true); kick(); return; }
      if (!info.cancelled) {
        lastResult = r;
        renderStages(r);
        if (noPlay) {
          // the streamed audio already published its (identical) buffer & is
          // still playing — just fill in the trace cards a beat later.
          const ms = (performance.now() - t0).toFixed(0);
          $('#latency').textContent += ' · trace +' + ms + ' ms';
        } else {
          setClip(r.samples, r.sampleRate); play();
          const frames = Math.round(r.samples.length / 1920);
          const ms = (performance.now() - t0).toFixed(0);
          $('#run-meta').textContent =
            frames + ' frames · ' + (r.samples.length / r.sampleRate).toFixed(2) + 's · ' +
            (opts.temperature > 0 ? 'sampled (seed ' + opts.seed + ')' : 'greedy');
          $('#latency').textContent = 'rendered in ' + ms + ' ms';
          setBadge('ready · ' + variantHint());
        }
      }
      kick();
    };
    inflight = bro.tts.synthesize(qwen, text, opts);
  } catch (e) { inflight = null; transport(false); setBadge('render: ' + e.message, true); kick(); }
}

// ── Stream: gapless playback as the loop generates (every voice path) ────────
// On completion, chain a trace pass (req.trace) that re-renders the SAME opts —
// seed pinned by gatherOpts/currentSampling, captured before the stream-only
// fields are added — so the drawn trace is exactly the audio you just heard.
function doStream(req) {
  const text = $('#text').value;
  const opts = gatherOpts(); if (!opts) return;
  const traceOpts = req.trace ? Object.assign({}, opts) : null;   // same seed ⇒ trace matches
  opts.chunkFrames = CHUNK_FRAMES;
  const t0 = performance.now();
  let firstAt = 0;
  streaming = true; streamFrames = 0; streamAccum = []; streamReset();
  transport(true);
  $('#run-meta').textContent = 'streaming…'; $('#latency').textContent = '';
  try {
    opts.onChunk = (samples) => {
      if (!firstAt) { firstAt = performance.now(); $('#latency').textContent = 'first audio +' + (firstAt - t0).toFixed(0) + ' ms'; }
      streamFrames++; streamAccum.push(samples); streamPush(samples);
      renderStreamMeter();
    };
    opts.onDone = (r, info) => {
      inflight = null; streaming = false; transport(false);
      if (info.error) { setBadge('stream: ' + info.error, true); kick(); return; }
      if (!info.cancelled) {
        lastResult = r;
        setClip(r.samples, r.sampleRate);          // publish full buffer for ♪ replay
        renderStages(r);                           // waveform now; the trace pass adds codes/conf
        const ms = (performance.now() - t0).toFixed(0);
        $('#run-meta').textContent = streamFrames + ' chunks · ' +
          (r.samples.length / r.sampleRate).toFixed(2) + 's · generated in ' + ms + ' ms';
        setBadge('ready · ' + variantHint());
        // Pass 2 — draw the AR trace for exactly what we just streamed, without
        // replaying. Skip it if a newer change is already queued (latest-wins:
        // hear the new voice rather than trace the old one).
        if (traceOpts && !wantNext) wantNext = { mode: 'render', opts: traceOpts, noPlay: true };
      } else {
        $('#run-meta').textContent = 'stopped';
      }
      kick();
    };
    inflight = bro.tts.synthesizeStream(qwen, text, opts);
  } catch (e) { inflight = null; streaming = false; transport(false); setBadge('stream: ' + e.message, true); kick(); }
}
