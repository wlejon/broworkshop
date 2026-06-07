// ═══ synth — Render (off-thread + trace) / Stream (realtime) / barge-in ═══════
// One synthesis runs at a time (the model is single-owner). Both buttons are
// latest-wins: pressing either while one is in flight cancels it and runs the new
// request from the previous run's completion — never tripping the in-flight guard.

const CHUNK_FRAMES = 8;        // ≈0.64 s per streamed chunk (low first-audio latency)
let wantNext = null;           // a queued { mode } to run once the model frees

function requestRender() { wantNext = { mode: 'render' }; kick(); }
function requestStream() { wantNext = { mode: 'stream' }; kick(); }

function kick() {
  if (inflight) { try { inflight.cancel(); } catch (e) {} return; }   // onDone will re-kick
  if (!wantNext) return;
  const w = wantNext; wantNext = null;
  if (w.mode === 'render') doRender(); else doStream();
}

// Stop generation + playback now (barge-in). Drops any queued request too.
function bargeIn() {
  wantNext = null;
  if (inflight) { try { inflight.cancel(); } catch (e) {} }
  streamStop(); streaming = false;
  transport(false);
}

// Toggle the transport buttons for the active/idle state.
function transport(busy) {
  $('#btn-render').disabled = busy || !qwen;
  $('#btn-stream').disabled = busy || !qwen || variant === 'base';
  $('#btn-stop').disabled   = !busy;
}

function gatherOpts() {
  const voice = currentVoice();
  if (variant === 'base' && !voice) { setBadge('design a voice first (enroll or 🎲 random)', true); return null; }
  const s = currentSampling();
  return Object.assign({}, voice, {
    language: currentLanguage(),
    temperature: s.temperature, topK: s.topK, topP: s.topP, seed: s.seed,
  });
}

// ── Render: synthesize off-thread, draw the trace, play the buffer ──────────
function doRender() {
  const text = $('#text').value;
  const opts = gatherOpts(); if (!opts) return;
  opts.trace = true;
  const t0 = performance.now();
  transport(true);
  $('#run-meta').textContent = 'rendering…'; $('#latency').textContent = '';
  try {
    opts.onDone = (r, info) => {
      inflight = null; transport(false);
      if (info.error) { setBadge('render: ' + info.error, true); kick(); return; }
      if (!info.cancelled) {
        lastResult = r;
        setClip(r.samples, r.sampleRate); play();
        renderStages(r);
        const frames = Math.round(r.samples.length / 1920);
        const ms = (performance.now() - t0).toFixed(0);
        $('#run-meta').textContent =
          frames + ' frames · ' + (r.samples.length / r.sampleRate).toFixed(2) + 's · ' +
          (opts.temperature > 0 ? 'sampled (seed ' + opts.seed + ')' : 'greedy');
        $('#latency').textContent = 'rendered in ' + ms + ' ms';
        setBadge('ready · ' + variantHint());
      }
      kick();
    };
    inflight = bro.tts.synthesize(qwen, text, opts);
  } catch (e) { inflight = null; transport(false); setBadge('render: ' + e.message, true); kick(); }
}

// ── Stream: gapless playback as the loop generates (speaker/instruct only) ──
function doStream() {
  const text = $('#text').value;
  const opts = gatherOpts(); if (!opts) return;
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
        renderStages(r);                           // waveform (streaming has no trace stages)
        const ms = (performance.now() - t0).toFixed(0);
        $('#run-meta').textContent = streamFrames + ' chunks · ' +
          (r.samples.length / r.sampleRate).toFixed(2) + 's · generated in ' + ms + ' ms';
        setBadge('ready · ' + variantHint());
      } else {
        $('#run-meta').textContent = 'stopped';
      }
      kick();
    };
    inflight = bro.tts.synthesizeStream(qwen, text, opts);
  } catch (e) { inflight = null; streaming = false; transport(false); setBadge('stream: ' + e.message, true); kick(); }
}
