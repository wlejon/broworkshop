// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro -> speaker.
//
// All inference is local. Models are loaded from sibling repos:
//   ../brosoundml/weights/whisper
//   ../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf
//   ../brosoundml/weights/kokoro
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

    setStatus('idle', 'idle');
    $talk.disabled = false;
    $talk.textContent = 'hold to talk';
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
    // Scan from beginning of next; require an exact float match (engine
    // doesn't mutate ring-buffer samples between reads).
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
    // Copy — analyserBuf is reused next tick.
    const snap = new Float32Array(analyserBuf);

    // Update meter (peak amplitude).
    let peak = 0;
    for (let i = 0; i < snap.length; i++) {
        const a = Math.abs(snap[i]);
        if (a > peak) peak = a;
    }
    $meter.style.width = Math.min(100, peak * 200) + '%';

    if (!prevWindow) {
        captured.push(snap);
    } else {
        const newStart = findOverlap(prevWindow, snap);
        if (newStart >= 0 && newStart < snap.length) {
            captured.push(snap.subarray(newStart));
        } else if (newStart < 0) {
            // No overlap found — likely dropped frames. Append whole window.
            captured.push(snap);
        }
        // newStart === snap.length means no new audio this tick.
    }
    prevWindow = snap;
}

function startRecording() {
    if (recording) return;
    captured = [];
    prevWindow = null;
    recording = true;
    setStatus('listening', 'listening…');
    $talk.classList.add('recording');
    $talk.textContent = 'release to send';
    pollTimer = setInterval(pollMic, POLL_INTERVAL_MS);
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
    clearInterval(pollTimer);
    pollTimer = 0;
    $talk.classList.remove('recording');
    $talk.textContent = 'hold to talk';
    $meter.style.width = '0%';

    const raw = concatChunks(captured);
    captured = [];
    if (raw.length < engineRate * 0.25) {
        setStatus('idle', 'too short — idle');
        return;
    }

    // Resample to 16 kHz for Whisper.
    const samples16k = resampleLinear(raw, engineRate, 16000);

    // ─── STT ──────────────────────────────────────────────────────────
    setStatus('transcribing', 'transcribing…');
    await new Promise(r => setTimeout(r, 0));   // let UI paint
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
        return;
    }
    if (!userText) {
        setStatus('idle', 'no speech detected — idle');
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
        // Strip Qwen3 thinking blocks and any stray special tokens.
        reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '')
                     .replace(/<think>[\s\S]*$/g, '')
                     .replace(/<\|.*?\|>/g, '')
                     .trim();
    } catch (e) {
        setStatus('error', 'llm: ' + e.message);
        return;
    }
    if (!reply) {
        setStatus('idle', 'no reply — idle');
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
            return;
        }
        const out = kokoro.synthesize(phonemeIds, voice, { speed: 1.0 });
        // Resample 24 kHz -> engine rate so createClip plays at correct pitch.
        const playSamples = resampleLinear(out.samples, out.sampleRate, engineRate);
        const clipId = audioCtx.createClip(playSamples, 1);
        audioCtx.playClip(clipId, 1.0, false);
        // Best-effort: leave clip resident; engine cleans up on shutdown.
        const durMs = (playSamples.length / engineRate) * 1000;
        setTimeout(() => setStatus('idle', 'idle'), durMs + 100);
    } catch (e) {
        setStatus('error', 'tts: ' + e.message);
        return;
    }
}

// ─── input wiring ─────────────────────────────────────────────────────────
async function onTalkDown() {
    if ($talk.disabled) return;
    try { await ensureMic(); }
    catch (e) { setStatus('error', 'mic: ' + e.message); return; }
    startRecording();
}
function onTalkUp() { if (recording) stopRecordingAndRun(); }

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
