// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro -> speaker.
//
// All heavy inference runs in voice-worker.js on a background thread, so this
// thread stays free to render, capture the mic, run the wake word, and play
// audio. The UI is responsive at all times: model loading shows live progress,
// the reply text streams in token-by-token, and the word being spoken is
// highlighted in sync with playback.
//
// Activation modes:
//   - Wake word: say "computer". Detected by bro.wake (streaming BC-ResNet).
//     Capture auto-stops on end-of-utterance (rolling-peak VAD).
//   - Hold-to-talk: button or Space key. Manual override.
//
// Mic capture (this thread): getUserMedia -> AudioContext -> AnalyserNode.
// We poll the analyser, stitch chunks via a needle-match for overlap, resample
// to 16 kHz mono Float32, and hand the utterance to the worker. The worker
// streams back transcript, reply tokens, and per-sentence audio + word timings.

(function () {
'use strict';

// ─── element refs ──────────────────────────────────────────────────────────
const $status     = document.getElementById('status');
const $transcript = document.getElementById('transcript');
const $talk       = document.getElementById('talk');
const $meter      = document.getElementById('meter');

// ─── worker ──────────────────────────────────────────────────────────────────
let worker = null;
let workerReady = false;

// Engine + audio (this thread owns playback + mic).
let audioCtx = null;
let micStream = null;
let micSource = null;
let analyser  = null;
let analyserBuf = null;
const ANALYSER_FFT = 8192;          // ~186 ms @ 44.1 kHz; max useful tail
const POLL_INTERVAL_MS = 60;        // poll well under the window length
const NEEDLE = 256;                 // samples used to detect overlap

// Recording state.
let recording = false;
let pollTimer = 0;
let prevWindow = null;
let captured = [];               // array of Float32Array chunks at engine rate
let engineRate = 44100;

// Wake / VAD state.
let wakeActive = false;          // listen() has been called and not stopped
let triggeredByWake = false;     // current recording was started by onWake
let recStartMs = 0;
let lastLoudMs = 0;              // last time peak was above SPEECH_THRESH
let speechMs = 0;                // total ms with peak above SPEECH_THRESH
let toneClipId = -1;             // wake cue (rising note)
let receiptClipId = -1;          // "heard you" cue (descending double-blip)
let presynthClipId = -1;         // "about to speak" cue (soft ascending triad)
let wakeMeterTimer = 0;
let loadingAnim = false;         // indeterminate meter while transcribing/thinking

// EoU / VAD params.
const SPEECH_THRESH      = 0.01;   // peak amplitude threshold for "speech present"
const EOU_SILENCE_MS     = 700;    // trailing silence to auto-stop
const MIN_SPEECH_MS      = 300;    // require this much speech before EoU can fire
const NO_SPEECH_ABORT_MS = 1500;   // abort if no speech in this window
const MAX_CAPTURE_MS     = 10000;  // hard cap

// Earcon definitions — three distinct UI cues, each a short note sequence:
//   wake     — single rising note  (you said "computer"; capture is opening)
//   receipt  — descending double-blip (your words were captured; "got it")
//   presynth — soft ascending triad (a reply is on its way; voice incoming)
const WAKE_NOTES     = [{ freq: 880, durMs: 80 }];
const RECEIPT_NOTES  = [{ freq: 660, durMs: 55 }, { freq: 440, durMs: 75 }];
const PRESYNTH_NOTES = [{ freq: 523.25, durMs: 70, gain: 0.7 },
                        { freq: 659.25, durMs: 70, gain: 0.7 },
                        { freq: 783.99, durMs: 95, gain: 0.8 }];

// Wake-tail suspension (extra time after TTS finishes).
const WAKE_TAIL_MS = 250;

// ─── reply rendering state (streaming text + word highlight) ─────────────────
let broSpokenEl = null;   // holds finalized sentences as highlightable word spans
let broPendingEl = null;  // holds the still-streaming, not-yet-spoken tail
let fullText = '';        // full cleaned reply text accumulated from token deltas
let finalizedLen = 0;     // chars of fullText already turned into word spans

// ─── playback queue (sequential, gapless-ish) ────────────────────────────────
const audioQueue = [];    // { samples: Float32Array@engineRate, els: span[], words }
let playing = false;
let pipelineDone = false;
let producedSpeech = false;
let highlightTimer = 0;
let activeClipId = -1;

// ─── UI helpers ────────────────────────────────────────────────────────────
function setStatus(kind, msg) {
    $status.className = 'status ' + kind;
    $status.textContent = msg;
}

function appendTurn(who, text) {
    const hint = $transcript.querySelector('.hint');
    if (hint) hint.remove();
    const row = document.createElement('div');
    row.className = 'turn ' + who;
    const w = document.createElement('span'); w.className = 'who'; w.textContent = who + ':';
    const t = document.createElement('span'); t.textContent = ' ' + text;
    row.appendChild(w); row.appendChild(t);
    $transcript.appendChild(row);
    $transcript.scrollTop = $transcript.scrollHeight;
}

// Start a fresh streaming "bro" turn. Spoken (finalized) words live in
// broSpokenEl; the streaming tail lives in broPendingEl.
function startBroTurn() {
    const hint = $transcript.querySelector('.hint');
    if (hint) hint.remove();
    const row = document.createElement('div');
    row.className = 'turn bro';
    const w = document.createElement('span'); w.className = 'who'; w.textContent = 'bro:';
    broSpokenEl = document.createElement('span');
    broPendingEl = document.createElement('span');
    broPendingEl.className = 'pending';
    row.appendChild(w);
    row.appendChild(document.createTextNode(' '));
    row.appendChild(broSpokenEl);
    row.appendChild(broPendingEl);
    $transcript.appendChild(row);
    $transcript.scrollTop = $transcript.scrollHeight;
    fullText = '';
    finalizedLen = 0;
}

function updatePending() {
    if (broPendingEl) broPendingEl.textContent = fullText.slice(finalizedLen);
    $transcript.scrollTop = $transcript.scrollHeight;
}

// Centralized wake suspend/resume. Safe to call when wake never initialized.
function wakeSuspend() {
    if (!wakeActive) return;
    try { if (!bro.wake.isSuspended()) bro.wake.suspend(); } catch (_) {}
}
function wakeResume() {
    if (!wakeActive) return;
    try { if (bro.wake.isSuspended()) bro.wake.resume(); } catch (_) {}
}

// Idle UI = wake listening + score meter (if available).
function goIdle() {
    if (wakeActive) {
        setStatus('idle', 'listening for "computer"…');
    } else {
        setStatus('idle', 'idle');
    }
    $meter.style.width = '0%';
    wakeResume();
}

// Indeterminate meter for the silent stretch between end-of-capture and the
// first reply token (STT + LLM prefill). Clearing the inline width/opacity lets
// the .thinking CSS rule drive the bar; stopLoadingIndicator restores manual
// control. The wake-score meter loop skips while this is active (see below).
function startLoadingIndicator() {
    loadingAnim = true;
    $meter.style.width = '';
    $meter.style.opacity = '';
    $meter.classList.add('thinking');
}
function stopLoadingIndicator() {
    if (!loadingAnim) return;
    loadingAnim = false;
    $meter.classList.remove('thinking');
    $meter.style.opacity = '1';
    $meter.style.width = '0%';
}

// ─── earcons ────────────────────────────────────────────────────────────────
// Build a short PCM clip from a sequence of notes. Each note is { freq, durMs,
// gain? }, separated by gapMs of silence. A raised-cosine attack and release on
// every note keeps them click-free.
function buildEarcon(notes, sampleRate, opts) {
    opts = opts || {};
    const gapMs     = opts.gapMs     != null ? opts.gapMs     : 18;
    const attackMs  = opts.attackMs  != null ? opts.attackMs  : 5;
    const releaseMs = opts.releaseMs != null ? opts.releaseMs : 20;
    const gap     = Math.floor(sampleRate * gapMs / 1000);
    const attack  = Math.floor(sampleRate * attackMs / 1000);
    const release = Math.floor(sampleRate * releaseMs / 1000);

    const lens = notes.map(n => Math.floor(sampleRate * n.durMs / 1000));
    let total = 0;
    for (let i = 0; i < notes.length; i++) total += lens[i] + (i < notes.length - 1 ? gap : 0);

    const buf = new Float32Array(total);
    let off = 0;
    for (let k = 0; k < notes.length; k++) {
        const len = lens[k];
        const gain = notes[k].gain != null ? notes[k].gain : 1.0;
        const w = 2 * Math.PI * notes[k].freq / sampleRate;
        for (let i = 0; i < len; i++) {
            let env;
            if (i < attack) {
                env = 0.5 - 0.5 * Math.cos(Math.PI * i / attack);
            } else if (i > len - release) {
                const r = (i - (len - release)) / release;
                env = 0.5 + 0.5 * Math.cos(Math.PI * r);
            } else {
                env = 1.0;
            }
            buf[off + i] = gain * env * Math.sin(w * i);
        }
        off += len + gap;
    }
    return buf;
}

function playEarcon(id, gain) {
    if (id < 0 || !audioCtx) return;
    try { audioCtx.playClip(id, gain, false); } catch (_) {}
}
function playCueTone()     { playEarcon(toneClipId, 0.5); }
function playReceiptCue()  { playEarcon(receiptClipId, 0.5); }
function playPresynthCue() { playEarcon(presynthClipId, 0.35); }

// ─── boot ────────────────────────────────────────────────────────────────────
// Bring up the lightweight, this-thread pieces (audio context, cue tone), then
// spawn the worker to load the heavy models. Runs AFTER the first paint so the
// splash UI shows immediately instead of a black screen during model load.
function boot() {
    try {
        audioCtx = new AudioContext();
        engineRate = audioCtx.sampleRate || 44100;
        try {
            toneClipId     = audioCtx.createClip(buildEarcon(WAKE_NOTES, engineRate), 1);
            receiptClipId  = audioCtx.createClip(buildEarcon(RECEIPT_NOTES, engineRate), 1);
            presynthClipId = audioCtx.createClip(
                buildEarcon(PRESYNTH_NOTES, engineRate, { attackMs: 8, releaseMs: 35 }), 1);
        }
        catch (e) { console.warn('cue tone init failed:', e.message); }
    } catch (e) {
        setStatus('error', 'audio init failed: ' + e.message);
        return;
    }

    setStatus('loading', 'loading models…');
    $meter.style.width = '15%';
    $meter.style.opacity = '0.6';

    worker = new Worker('voice-worker.js');
    worker.onmessage = onWorkerMessage;
    worker.postMessage({ type: 'load' });
}

const LOAD_LABELS = {
    whisper: 'loading speech recognition…',
    qwen:    'loading language model…',
    kokoro:  'loading voice…',
};
const LOAD_PROGRESS = { whisper: '25%', qwen: '55%', kokoro: '85%' };

function onWorkerMessage(e) {
    const msg = e.data || {};
    switch (msg.type) {
        case 'progress':
            setStatus('loading', LOAD_LABELS[msg.stage] || 'loading…');
            $meter.style.width = LOAD_PROGRESS[msg.stage] || '50%';
            break;

        case 'ready':
            workerReady = true;
            $meter.style.width = '0%';
            $meter.style.opacity = '1';
            $talk.disabled = false;
            $talk.textContent = 'say "computer" or hold to talk';
            $talk.title = 'Say "computer" to activate, or hold (Space) to talk manually.';
            startWake();
            goIdle();
            break;

        case 'user':
            if (msg.text) {
                appendTurn('you', msg.text);
                startBroTurn();
                setStatus('thinking', 'thinking…');
            } else {
                stopLoadingIndicator();
                setStatus('idle', 'no speech detected — idle');
            }
            break;

        case 'token':
            // First visible text — the LLM is responding, so drop the loader.
            stopLoadingIndicator();
            fullText += msg.delta;
            updatePending();
            break;

        case 'presynth':
            // The worker is about to synthesize the first sentence. Play the
            // soft "about to speak" cue now so it overlaps the synthesis
            // latency instead of delaying the audio that follows.
            playPresynthCue();
            setStatus('thinking', 'responding…');
            break;

        case 'speech':
            producedSpeech = true;
            finalizeSentence(msg);
            enqueueAudio(msg);
            setStatus('speaking', 'speaking…');
            break;

        case 'done':
            pipelineDone = true;
            maybeFinishSpeaking();
            break;

        case 'error':
            stopLoadingIndicator();
            setStatus('error', (msg.stage || 'pipeline') + ': ' + msg.message);
            resetReplyState();
            pipelineDone = true;
            maybeFinishSpeaking();
            break;
    }
}

// Replace the streaming tail for this sentence with highlightable word spans.
function finalizeSentence(msg) {
    if (!broSpokenEl) startBroTurn();
    const els = [];
    for (let i = 0; i < msg.words.length; i++) {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = msg.words[i].text;
        broSpokenEl.appendChild(span);
        broSpokenEl.appendChild(document.createTextNode(' '));
        els.push(span);
    }
    msg._els = els;
    finalizedLen = msg.consumed;
    updatePending();
}

function enqueueAudio(msg) {
    const samples = resampleLinear(msg.samples, msg.sampleRate, engineRate);
    audioQueue.push({ samples, els: msg._els || [], words: msg.words });
    pumpQueue();
}

// Play the next queued clip; drive word highlighting from real playback
// position; advance on clip end.
function pumpQueue() {
    if (playing || audioQueue.length === 0) return;
    const item = audioQueue.shift();
    let clipId, playbackId;
    try {
        clipId = audioCtx.createClip(item.samples, 1);
        playbackId = audioCtx.playClip(clipId, 1.0, false);
    } catch (e) {
        console.warn('playback failed:', e.message);
        pumpQueue();
        return;
    }
    playing = true;
    activeClipId = clipId;

    let lastWord = -1;
    // getPlaybackPosition() returns a normalized [0,1) fraction of the clip, not
    // seconds. Word timings (startSec/endSec) are in seconds, so scale by the
    // clip's duration to compare in the same units — otherwise every clip longer
    // than one second highlights the wrong word and lags behind the audio.
    const clipDurSec = item.samples.length / engineRate;
    const tick = () => {
        let frac = 0;
        try { frac = audioCtx.getPlaybackPosition(playbackId) || 0; } catch (_) {}
        const pos = frac * clipDurSec;
        let active = -1;
        for (let i = 0; i < item.words.length; i++) {
            if (pos >= item.words[i].startSec && pos < item.words[i].endSec) { active = i; break; }
        }
        if (active !== lastWord) {
            if (lastWord >= 0 && item.els[lastWord]) item.els[lastWord].classList.remove('speaking');
            if (active  >= 0 && item.els[active])  item.els[active].classList.add('speaking');
            lastWord = active;
        }
    };
    highlightTimer = setInterval(tick, 30);

    const durMs = (item.samples.length / engineRate) * 1000;
    setTimeout(() => {
        clearInterval(highlightTimer); highlightTimer = 0;
        if (lastWord >= 0 && item.els[lastWord]) item.els[lastWord].classList.remove('speaking');
        try { audioCtx.deleteClip(clipId); } catch (_) {}
        activeClipId = -1;
        playing = false;
        if (audioQueue.length > 0) pumpQueue();
        else maybeFinishSpeaking();
    }, durMs + 40);
}

// Resume wake once the LLM is done AND all queued audio has played out.
function maybeFinishSpeaking() {
    if (!pipelineDone || playing || audioQueue.length > 0) return;
    pipelineDone = false;
    const wasSpeaking = producedSpeech;
    producedSpeech = false;
    setTimeout(() => goIdle(), wasSpeaking ? WAKE_TAIL_MS : 0);
}

function resetReplyState() {
    if (highlightTimer) { clearInterval(highlightTimer); highlightTimer = 0; }
    audioQueue.length = 0;
    playing = false;
}

// ─── wake-score meter (when idle) ─────────────────────────────────────────
function startWake() {
    try {
        bro.wake.listen({
            weights: '../brosoundml/weights/wake/computer.bw',
            threshold: 0.85,
            onFire: onWake,
        });
        wakeActive = true;
        startWakeMeter();
    } catch (e) {
        console.warn('wake init failed:', e.message);
        setStatus('idle', 'idle (wake unavailable — hold to talk)');
    }
}

function startWakeMeter() {
    if (wakeMeterTimer) return;
    wakeMeterTimer = setInterval(() => {
        if (recording || !wakeActive || playing || loadingAnim) return;
        let score = 0;
        try { score = bro.wake.lastScore() || 0; } catch (_) {}
        $meter.style.width = Math.min(100, score * 100) + '%';
        $meter.style.opacity = (0.25 + 0.75 * Math.min(1, score / 0.85)).toFixed(2);
    }, 100);
}

// ─── mic capture ──────────────────────────────────────────────────────────
async function ensureMic() {
    if (micSource) return;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micSource = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT;
    analyser.smoothingTimeConstant = 0;
    analyserBuf = new Float32Array(ANALYSER_FFT);
    micSource.connect(analyser);
}

// Locate where `needle` (last NEEDLE samples of previous window) appears in
// the new window. Returns the index after the match, or -1.
function findOverlap(prev, next) {
    if (!prev || prev.length < NEEDLE) return -1;
    const start = prev.length - NEEDLE;
    outer:
    for (let i = 0; i + NEEDLE <= next.length; i++) {
        for (let j = 0; j < NEEDLE; j++) {
            if (prev[start + j] !== next[i + j]) continue outer;
        }
        return i + NEEDLE;
    }
    return -1;
}

function pollMic() {
    analyser.getFloatTimeDomainData(analyserBuf);
    const snap = new Float32Array(analyserBuf);

    let peak = 0;
    for (let i = 0; i < snap.length; i++) {
        const a = Math.abs(snap[i]);
        if (a > peak) peak = a;
    }
    $meter.style.opacity = '1';
    $meter.style.width = Math.min(100, peak * 200) + '%';

    if (!prevWindow) {
        captured.push(snap);
    } else {
        const newStart = findOverlap(prevWindow, snap);
        if (newStart >= 0 && newStart < snap.length) {
            captured.push(snap.subarray(newStart));
        } else if (newStart < 0) {
            captured.push(snap);
        }
    }
    prevWindow = snap;

    const now = Date.now();
    if (peak >= SPEECH_THRESH) {
        lastLoudMs = now;
        speechMs += POLL_INTERVAL_MS;
    }

    if (triggeredByWake) {
        const elapsed = now - recStartMs;
        if (elapsed >= MAX_CAPTURE_MS) { stopRecordingAndRun(); return; }
        if (speechMs === 0 && elapsed >= NO_SPEECH_ABORT_MS) {
            abortRecording('no speech — idle'); return;
        }
        if (speechMs >= MIN_SPEECH_MS && lastLoudMs > 0 &&
            (now - lastLoudMs) >= EOU_SILENCE_MS) {
            stopRecordingAndRun(); return;
        }
    }
}

function startRecording(fromWake) {
    if (recording) return;
    captured = [];
    prevWindow = null;
    recording = true;
    triggeredByWake = !!fromWake;
    recStartMs = Date.now();
    lastLoudMs = 0;
    speechMs = 0;

    wakeSuspend();

    setStatus('listening', fromWake ? 'recording…' : 'listening…');
    $talk.classList.add('recording');
    $talk.textContent = fromWake ? 'recording (wake)…' : 'release to send';
    pollTimer = setInterval(pollMic, POLL_INTERVAL_MS);
}

function abortRecording(msg) {
    if (!recording) return;
    recording = false;
    triggeredByWake = false;
    clearInterval(pollTimer);
    pollTimer = 0;
    $talk.classList.remove('recording');
    $talk.textContent = 'say "computer" or hold to talk';
    captured = [];
    setStatus('idle', msg || 'idle');
    setTimeout(() => goIdle(), 50);
}

function concatChunks(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Float32Array(n);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
}

// Linear resample to target rate.
function resampleLinear(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const n = Math.floor(samples.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = i * ratio;
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, samples.length - 1);
        const f = x - i0;
        out[i] = samples[i0] * (1 - f) + samples[i1] * f;
    }
    return out;
}

// Hand the captured utterance to the worker. The heavy pipeline (STT, LLM,
// TTS) runs there; this thread keeps rendering and will receive the transcript,
// streamed reply tokens, and per-sentence audio back as messages.
function stopRecordingAndRun() {
    if (!recording) return;
    recording = false;
    triggeredByWake = false;
    clearInterval(pollTimer);
    pollTimer = 0;
    $talk.classList.remove('recording');
    $talk.textContent = 'say "computer" or hold to talk';
    $meter.style.width = '0%';

    // Wake stays suspended until the reply finishes playing (maybeFinishSpeaking).
    wakeSuspend();

    const raw = concatChunks(captured);
    captured = [];
    if (raw.length < engineRate * 0.25) {
        setStatus('idle', 'too short — idle');
        setTimeout(() => goIdle(), 0);
        return;
    }

    // Confirm we captured the utterance ("got it"), then show the loader for the
    // silent STT + LLM-prefill stretch until the first reply token lands.
    playReceiptCue();
    const samples16k = resampleLinear(raw, engineRate, 16000);
    setStatus('transcribing', 'transcribing…');
    startLoadingIndicator();
    pipelineDone = false;
    producedSpeech = false;

    // Transfer the 16 kHz buffer to the worker zero-copy.
    const buf = samples16k.buffer;
    worker.postMessage({ type: 'transcribe', samples: samples16k, sampleRate: 16000 }, [buf]);
}

// ─── wake handler ─────────────────────────────────────────────────────────
function onWake() {
    if (recording || $talk.disabled || playing) return;
    playCueTone();
    (async () => {
        try { await ensureMic(); }
        catch (e) { setStatus('error', 'mic: ' + e.message); goIdle(); return; }
        startRecording(true);
    })();
}

// ─── input wiring (manual hold-to-talk) ───────────────────────────────────
async function onTalkDown() {
    if ($talk.disabled || recording || !workerReady) return;
    try { await ensureMic(); }
    catch (e) { setStatus('error', 'mic: ' + e.message); return; }
    startRecording(false);
}
function onTalkUp() {
    if (recording && !triggeredByWake) stopRecordingAndRun();
}

$talk.addEventListener('mousedown', onTalkDown);
$talk.addEventListener('mouseup', onTalkUp);
$talk.addEventListener('mouseleave', onTalkUp);

window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); onTalkDown(); }
});
window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { e.preventDefault(); onTalkUp(); }
});

// ─── boot after first paint ──────────────────────────────────────────────────
// Two rAFs guarantee the splash UI has painted before we create the worker and
// kick off the (worker-side, but still CPU-heavy) model loads.
requestAnimationFrame(() => requestAnimationFrame(boot));

})();
