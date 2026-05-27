// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro -> speaker.
//
// All inference is local. Models are loaded from sibling repos:
//   ../brosoundml/weights/whisper
//   ../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf
//   ../brosoundml/weights/kokoro
//   ../brosoundml/weights/wake/computer.bw
//
// Activation modes:
//   - Wake word: say "computer". Detected by bro.wake (streaming BC-ResNet).
//     Capture auto-stops on end-of-utterance (rolling-peak VAD).
//   - Hold-to-talk: button or Space key. Manual override.
//
// Mic capture path: navigator.mediaDevices.getUserMedia -> AudioContext ->
// MediaStreamAudioSourceNode -> AnalyserNode. The engine exposes only the
// latest fftSize samples of the mic ring buffer, so we poll the analyser on
// a fast interval and stitch chunks together using a small needle-match for
// overlap detection. Sample rate is whatever the engine runs at (44.1 kHz on
// Windows by default); we resample to 16 kHz mono Float32 before Whisper.

(function () {
'use strict';

const FS = require('node:fs');

// ─── element refs ──────────────────────────────────────────────────────────
const $status     = document.getElementById('status');
const $transcript = document.getElementById('transcript');
const $talk       = document.getElementById('talk');
const $meter      = document.getElementById('meter');

// ─── model handles (filled by loadAll) ─────────────────────────────────────
let whisper = null, sttTok = null, sttPrompt = null;
let lm = null, lmTok = null;
let kokoro = null, voice = null;

// Engine + audio.
let audioCtx = null;
let micStream = null;
let micSource = null;
let analyser  = null;
let analyserBuf = null;
const ANALYSER_FFT = 8192;          // ~186 ms @ 44.1 kHz; max useful tail
const POLL_INTERVAL_MS = 60;        // poll well under the window length
const NEEDLE = 256;                 // samples used to detect overlap

// Conversation memory.
const history = [
    { role: 'system', content:
        'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
        'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
        'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
        'friend, not a chatbot. /no_think' },
];

// Recording state.
let recording = false;
let pollTimer = 0;
let prevWindow = null;
let captured = [];               // array of Float32Array chunks at engine rate
let engineRate = 44100;

// Wake / VAD state.
let wakeReady = false;
let wakeActive = false;          // listen() has been called and not stopped
let triggeredByWake = false;     // current recording was started by onWake
let recStartMs = 0;
let lastLoudMs = 0;              // last time peak was above SPEECH_THRESH
let speechMs = 0;                // total ms with peak above SPEECH_THRESH
let toneClipId = -1;
let wakeMeterTimer = 0;

// EoU / VAD params.
const SPEECH_THRESH      = 0.01;   // peak amplitude threshold for "speech present"
const EOU_SILENCE_MS     = 700;    // trailing silence to auto-stop
const MIN_SPEECH_MS      = 300;    // require this much speech before EoU can fire
const NO_SPEECH_ABORT_MS = 1500;   // abort if no speech in this window
const MAX_CAPTURE_MS     = 10000;  // hard cap

// Cue tone params.
const CUE_FREQ_HZ  = 880;
const CUE_DUR_MS   = 80;
const CUE_ATTACK_MS = 5;
const CUE_RELEASE_MS = 20;

// Wake-tail suspension (extra time after TTS finishes).
const WAKE_TAIL_MS = 250;

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

// ─── cue tone ─────────────────────────────────────────────────────────────
function buildCueTone(sampleRate) {
    const total = Math.floor(sampleRate * CUE_DUR_MS / 1000);
    const attack = Math.floor(sampleRate * CUE_ATTACK_MS / 1000);
    const release = Math.floor(sampleRate * CUE_RELEASE_MS / 1000);
    const buf = new Float32Array(total);
    const w = 2 * Math.PI * CUE_FREQ_HZ / sampleRate;
    for (let i = 0; i < total; i++) {
        let env;
        if (i < attack) {
            // Cosine attack: 0 -> 1
            env = 0.5 - 0.5 * Math.cos(Math.PI * i / attack);
        } else if (i > total - release) {
            // Cosine release: 1 -> 0
            const r = (i - (total - release)) / release;
            env = 0.5 + 0.5 * Math.cos(Math.PI * r);
        } else {
            env = 1.0;
        }
        buf[i] = env * Math.sin(w * i);
    }
    return buf;
}

function playCueTone() {
    if (toneClipId < 0 || !audioCtx) return;
    try { audioCtx.playClip(toneClipId, 0.5, false); } catch (_) {}
}

// ─── model loading ────────────────────────────────────────────────────────
async function loadAll() {
    setStatus('loading', 'loading models…');

    // STT
    try {
        whisper = bro.stt.loadWhisper('../brosoundml/weights/whisper');
        sttTok = bro.stt.loadTokenizer({
            vocabPath:  '../brosoundml/weights/whisper/vocab.json',
            mergesPath: '../brosoundml/weights/whisper/merges.txt',
        });
        sttPrompt = sttTok.buildPrompt('en', 'transcribe', false);
    } catch (e) {
        setStatus('error', 'whisper load failed: ' + e.message);
        throw e;
    }

    // LM
    try {
        const r = bro.lm.loadQwen('../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf');
        lm = r.model;
        lmTok = r.tokenizer;
    } catch (e) {
        setStatus('error', 'qwen load failed: ' + e.message);
        throw e;
    }

    // TTS
    try {
        bro.tts.setAssetRoot('../brosoundml');
        kokoro = bro.tts.loadKokoro('../brosoundml/weights/kokoro');
        voice  = kokoro.loadVoice('../brosoundml/weights/kokoro/voices/af_heart.bin');
    } catch (e) {
        setStatus('error', 'kokoro load failed: ' + e.message);
        throw e;
    }

    // Audio context for playback + mic.
    audioCtx = new AudioContext();
    engineRate = audioCtx.sampleRate || 44100;

    // Build + cache cue tone once.
    try {
        const samples = buildCueTone(engineRate);
        toneClipId = audioCtx.createClip(samples, 1);
    } catch (e) {
        console.warn('cue tone init failed:', e.message);
    }

    $talk.disabled = false;
    $talk.textContent = 'say "computer" or hold to talk';
    $talk.title = 'Say "computer" to activate, or hold (Space) to talk manually.';

    // Start wake detector. Failure is non-fatal — manual mode still works.
    try {
        bro.wake.listen({
            weights: '../brosoundml/weights/wake/computer.bw',
            threshold: 0.85,
            onFire: onWake,
        });
        wakeActive = true;
        wakeReady = true;
        startWakeMeter();
        setStatus('idle', 'listening for "computer"…');
    } catch (e) {
        console.warn('wake init failed:', e.message);
        setStatus('idle', 'idle (wake unavailable — hold to talk)');
    }
}

// ─── wake-score meter (when idle) ─────────────────────────────────────────
function startWakeMeter() {
    if (wakeMeterTimer) return;
    wakeMeterTimer = setInterval(() => {
        if (recording || !wakeActive) return;
        let score = 0;
        try { score = bro.wake.lastScore() || 0; } catch (_) {}
        // Show a dim bar that brightens as score approaches threshold.
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

    // Update meter (peak amplitude).
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

    // VAD bookkeeping (only meaningful when wake-triggered, but harmless otherwise).
    const now = Date.now();
    if (peak >= SPEECH_THRESH) {
        lastLoudMs = now;
        speechMs += POLL_INTERVAL_MS;
    }

    if (triggeredByWake) {
        const elapsed = now - recStartMs;
        // Hard cap.
        if (elapsed >= MAX_CAPTURE_MS) {
            stopRecordingAndRun();
            return;
        }
        // No speech at all within the abort window -> bail cleanly.
        if (speechMs === 0 && elapsed >= NO_SPEECH_ABORT_MS) {
            abortRecording('no speech — idle');
            return;
        }
        // EoU: enough speech captured AND trailing silence long enough.
        if (speechMs >= MIN_SPEECH_MS && lastLoudMs > 0 &&
            (now - lastLoudMs) >= EOU_SILENCE_MS) {
            stopRecordingAndRun();
            return;
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

    // Suspend wake while we record either way (predictable behavior).
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
    // Brief delay before resuming wake to let mic settle.
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

async function stopRecordingAndRun() {
    if (!recording) return;
    recording = false;
    const wasWakeTriggered = triggeredByWake;
    triggeredByWake = false;
    clearInterval(pollTimer);
    pollTimer = 0;
    $talk.classList.remove('recording');
    $talk.textContent = 'say "computer" or hold to talk';
    $meter.style.width = '0%';

    // Make sure wake stays suspended through the heavy pipeline; we only
    // resume after TTS playback + tail.
    wakeSuspend();

    let resumed = false;
    const resumeOnce = (delay) => {
        if (resumed) return;
        resumed = true;
        setTimeout(() => goIdle(), delay || 0);
    };

    try {
        const raw = concatChunks(captured);
        captured = [];
        if (raw.length < engineRate * 0.25) {
            setStatus('idle', 'too short — idle');
            resumeOnce(0);
            return;
        }

        const samples16k = resampleLinear(raw, engineRate, 16000);

        // ─── STT ──────────────────────────────────────────────────────────
        setStatus('transcribing', 'transcribing…');
        await new Promise(r => setTimeout(r, 0));
        let userText = '';
        try {
            const ids = whisper.transcribe(
                { samples: samples16k, sampleRate: 16000 },
                sttPrompt,
                { maxNewTokens: 128 }
            );
            userText = sttTok.decode(ids, true).trim();
        } catch (e) {
            setStatus('error', 'stt: ' + e.message);
            resumeOnce(0);
            return;
        }
        if (!userText) {
            setStatus('idle', 'no speech detected — idle');
            resumeOnce(0);
            return;
        }
        appendTurn('you', userText);
        history.push({ role: 'user', content: userText });

        // ─── LLM ──────────────────────────────────────────────────────────
        setStatus('thinking', 'thinking…');
        await new Promise(r => setTimeout(r, 0));
        let reply = '';
        try {
            const prompt = lmTok.applyChatTemplate(history, true);
            const promptIds = lmTok.encode(prompt);
            lm.allocateCache(promptIds.length + 96);
            const newIds = lm.generate(promptIds, {
                maxNewTokens: 80,
                eosId: lmTok.imEndId,
                sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: Date.now() & 0x7fffffff },
            });
            reply = lmTok.decode(newIds);
            reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '')
                         .replace(/<think>[\s\S]*$/g, '')
                         .replace(/<\|.*?\|>/g, '')
                         .trim();
        } catch (e) {
            setStatus('error', 'llm: ' + e.message);
            resumeOnce(0);
            return;
        }
        if (!reply) {
            setStatus('idle', 'no reply — idle');
            resumeOnce(0);
            return;
        }
        appendTurn('bro', reply);
        history.push({ role: 'assistant', content: reply });

        // ─── TTS ──────────────────────────────────────────────────────────
        setStatus('speaking', 'speaking…');
        await new Promise(r => setTimeout(r, 0));
        try {
            const phonemeIds = bro.tts.phonemize(reply);
            if (!phonemeIds || phonemeIds.length === 0) {
                setStatus('idle', 'idle');
                resumeOnce(0);
                return;
            }
            const out = kokoro.synthesize(phonemeIds, voice, { speed: 1.0 });
            const playSamples = resampleLinear(out.samples, out.sampleRate, engineRate);
            const clipId = audioCtx.createClip(playSamples, 1);
            audioCtx.playClip(clipId, 1.0, false);
            const durMs = (playSamples.length / engineRate) * 1000;
            // Resume wake AFTER playback + tail (covers speaker→mic bleed).
            resumeOnce(durMs + WAKE_TAIL_MS);
        } catch (e) {
            setStatus('error', 'tts: ' + e.message);
            resumeOnce(0);
            return;
        }
    } catch (e) {
        setStatus('error', 'pipeline: ' + e.message);
        resumeOnce(0);
    } finally {
        // Belt-and-suspenders: if nothing scheduled a resume, do it now.
        if (!resumed) resumeOnce(0);
    }
}

// ─── wake handler ─────────────────────────────────────────────────────────
function onWake() {
    if (recording || $talk.disabled) return;
    playCueTone();
    (async () => {
        try { await ensureMic(); }
        catch (e) { setStatus('error', 'mic: ' + e.message); goIdle(); return; }
        startRecording(true);
    })();
}

// ─── input wiring (manual hold-to-talk) ───────────────────────────────────
async function onTalkDown() {
    if ($talk.disabled || recording) return;
    try { await ensureMic(); }
    catch (e) { setStatus('error', 'mic: ' + e.message); return; }
    startRecording(false);
}
function onTalkUp() {
    // Only manual recordings stop on release; wake-triggered uses VAD.
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

// ─── boot ─────────────────────────────────────────────────────────────────
loadAll().catch(e => {
    console.error('load failed:', e);
});

})();
