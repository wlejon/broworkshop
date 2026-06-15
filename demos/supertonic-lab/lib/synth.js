// ═══ synth — re-synthesise on change · play · cancel ═════════════════════════
// Supertonic runs faster-than-realtime on GPU, so the lab re-synthesises on every
// change (like Kokoro re-renders on a slider drag): touch a seam — voice, language,
// a flow dial, the text — and the new audio plays once it lands. No streaming path
// (synthesize returns one full utterance), so this is render-then-play.
//
// The model is single-owner: one synthesis at a time. Everything is latest-wins —
// a newer change while one is in flight is queued (wantNext) and kicked the moment
// the current run completes, so the freshest seam always wins. Supertonic's
// synthesize has no per-step cancel hook (the flow loop is short), so Stop / a
// queued change takes effect at the next completion rather than mid-flight.

import { $ } from "/app/lib/state.js";
import { supertonic, currentVoice, currentLanguage, setBadge } from "/app/lib/model.js";
import { currentFlow } from "/app/lib/delivery.js";
import { setClip, play } from "/app/lib/audio.js";
import { renderWave } from "/app/lib/render.js";

export let lastResult = null;
export function setLastResult(v) { lastResult = v; }

let inflight = null;       // the current AsyncHandle
let busy = false;          // a synthesis is running
let wantNext = false;      // a change arrived while busy → re-synth on completion
let liveTimer = 0;
const LIVE_DEBOUNCE = 180;  // ms — coalesce a slider drag into one synth

// A control change re-synthesises after a short settle (so a drag fires once you
// pause, not mid-drag).
export function scheduleLive() {
  if (!supertonic) return;
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { liveTimer = 0; requestSynth(); }, LIVE_DEBOUNCE);
}

export function requestSynth() {
  if (!supertonic) return;
  if (busy) { wantNext = true; return; }   // latest-wins: re-synth when the current run lands
  doSynth();
}

// Cancel any queued / in-flight work + stop the busy state. (The in-flight C++
// synth can't be interrupted; this drops the queued re-synth and the handle.)
export function bargeIn() {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
  wantNext = false;
  if (inflight) { try { inflight.cancel(); } catch (e) {} }
  transport(false);
}

function transport(on) {
  busy = on;
  $('#btn-synth').disabled = on || !supertonic;
  $('#btn-stop').disabled  = !on;
}

function doSynth() {
  const voice = currentVoice();
  if (!voice) { setBadge('no voice selected', true); return; }
  const text = $('#text').value;
  const flow = currentFlow();
  const t0 = performance.now();
  transport(true);
  $('#run-meta').textContent = 'synthesising…';
  $('#latency').textContent = '';
  try {
    inflight = bro.tts.synthesize(supertonic, text, {
      voice,
      language:   currentLanguage(),
      steps:      flow.steps,
      speed:      flow.speed,
      guidance:   flow.guidance,
      seed:       flow.seed,
      longForm:   flow.longForm,
      gapSeconds: flow.gapSeconds,
      onDone: (r, info) => {
        inflight = null; transport(false);
        if (info.error) { setBadge('synthesize: ' + info.error, true); kick(); return; }
        if (!info.cancelled) {
          lastResult = r;
          setClip(r.samples, r.sampleRate);
          play();
          renderWave(r.samples, r.sampleRate);
          const ms = (performance.now() - t0).toFixed(0);
          const secs = (r.samples.length / r.sampleRate).toFixed(2);
          $('#run-meta').textContent = secs + 's audio · ' + flow.steps + ' steps · g' +
            flow.guidance.toFixed(1) + ' · seed ' + flow.seed;
          $('#latency').textContent = 'synthesised in ' + ms + ' ms (' +
            (parseFloat(secs) / (ms / 1000)).toFixed(1) + '× realtime)';
          setBadge('ready');
        }
        kick();
      },
    });
  } catch (e) { inflight = null; transport(false); setBadge('synthesize: ' + e.message, true); }
}

// Run the queued re-synth, if any (latest-wins).
function kick() {
  if (wantNext && supertonic) { wantNext = false; doSynth(); }
}
