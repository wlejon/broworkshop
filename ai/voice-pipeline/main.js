// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro -> speaker.
//
// Everything runs on the MAIN thread. The three heavy models load and run via
// the engine's async inference API (bro.lm/bro.stt/bro.tts), which dispatches
// every blocking forward onto a background native thread and streams results
// back on the event-loop tick — so this thread stays free to render, capture the
// mic, run the wake word, and play audio. No JS Worker is involved.
//
// Because generation is genuinely async + cancellable, barge-in is a true
// cancel: saying "computer" mid-reply calls .cancel() on the in-flight handles,
// which stops the LLM decode within ~1 token and drops any pending STT/TTS — no
// background drain. A per-turn id is kept as a backstop so a late callback from a
// superseded turn is ignored.
//
// Activation modes:
//   - Wake word: say "computer" (bro.wake, streaming BC-ResNet). Capture
//     auto-stops on end-of-utterance (rolling-peak VAD).
//   - Hold-to-talk: button or Space key.
//
// Mic capture: getUserMedia -> AudioContext -> AnalyserNode. We poll the
// analyser, stitch chunks via a needle-match for overlap, resample to 16 kHz
// mono Float32, and feed the utterance to bro.stt.transcribe.

(function () {
'use strict';

// ─── element refs ──────────────────────────────────────────────────────────
const $status     = document.getElementById('status');
const $transcript = document.getElementById('transcript');
const $talk       = document.getElementById('talk');
const $meter      = document.getElementById('meter');
const $gate       = document.getElementById('gate');

// ─── models (loaded on the main context via the async inference API) ──────────
let whisper = null, sttTok = null, sttPrompt = null;
let lm = null, lmTok = null;
let kokoro = null, voice = null, spaceId = 16;
let modelsReady = false;
let speechOn = false;   // true once Kokoro + voice load; otherwise text-only

// Model file paths, resolved at boot by VoiceModels (models.js) — they point at
// the shared model cache on a downloaded build, or at the dev sibling repos in a
// source checkout. Filled in by startLoad().
let QWEN_GGUF = null;
let WHISPER_DIR = null, WHISPER_VOCAB = null, WHISPER_MERGES = null, WHISPER_ADDED = null;
let WAKE_WEIGHTS = null, KOKORO_DIR = null, KOKORO_VOICE = null;
// The phonemizer's g2p + Kokoro-vocab root. Speech runs from this dev layout
// for now (its data isn't part of the on-demand download set yet).
const SOUNDML_ROOT = '../brosoundml';

// Conversation memory (system prompt + rolling turns).
const history = [
    { role: 'system', content:
        'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
        'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
        'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
        'friend, not a chatbot. /no_think' },
];

// Utterances that mean "stop / cancel" short-circuit before the LLM: they exist
// to halt the previous reply (via barge-in), not to start a new one.
const STOP_WORDS = new Set([
    'stop', 'stop it', 'stop talking', 'stop please', 'please stop',
    'cancel', 'never mind', 'nevermind', 'forget it', 'be quiet', 'quiet',
    'shut up', 'shush', 'enough', "that's enough", 'thats enough',
]);

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
let producedSpeech = false;
let highlightTimer = 0;
let activeClipId = -1;
let activePlaybackId = -1; // handle to stop the in-progress speech clip (barge-in)
let clipEndTimer = 0;      // setTimeout that advances the queue on clip end

// ─── pipeline / turn state (barge-in) ────────────────────────────────────────
// Each utterance claims a monotonic turn id. Every async callback captures the
// turn it belongs to and ignores its result if the turn has been superseded —
// a backstop behind the real cancel (sttHandle/lmHandle/ttsHandle.cancel()).
let turnSeq = 0;
let acceptTurn = -1;
let turnBusy = false;     // a turn is in flight (transcribing / thinking / speaking)
let sttHandle = null;     // in-flight bro.stt.transcribe handle
let lmHandle = null;      // in-flight bro.lm.generate handle
let ttsHandle = null;     // in-flight bro.tts.synthesize handle

// LLM streaming bookkeeping (mirrors the old worker).
let streamed = [];        // raw token ids accumulated this turn
let queuedLen = 0;        // chars of cleaned text already handed to the TTS queue
let llmDone = false;      // the LLM finished producing tokens this turn
let presynthSent = false; // one-shot "about to speak" cue per turn

// Serial TTS queue — one synthesize() in flight at a time per the model's
// single-owner guard. Items: { sentence, consumed, turn }.
const synthQueue = [];
let synthBusy = false;

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
    const suffix = speechOn ? '' : ' (text-only)';
    if (wakeActive) {
        setStatus('idle', 'listening for "computer"…' + suffix);
    } else {
        setStatus('idle', 'idle' + suffix);
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

// ─── text cleanup + sentence splitting (was worker-side) ─────────────────────
// Strip <think> blocks and control tokens. Not trimmed (keeps offsets stable);
// callers left-trim once content begins.
function clean(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/g, '')
        .replace(/<\|.*?\|>/g, '')
        .replace(/^\s+/, '');
}

// Extract the next complete sentence from `text` starting at `fromLen`. Ends at
// . ! ? or a newline. Returns null when only a partial sentence remains.
function nextSentence(text, fromLen) {
    const m = text.slice(fromLen).match(/^[\s\S]*?[.!?\n]+/);
    if (!m) return null;
    return { sentence: m[0].trim(), length: m[0].length };
}

// Per-word timings from Kokoro's per-phoneme durations. durations[0] is the BOS
// frame count, durations[i+1] corresponds to phonemeIds[i], the last is EOS.
// Words are separated by the space token (spaceId); its frames belong to the
// inter-word gap, not to either word.
function computeWords(sentence, phonemeIds, durations, sampleCount, sampleRate) {
    let frameSum = 0;
    for (let i = 0; i < durations.length; i++) frameSum += durations[i];
    const secPerFrame = frameSum > 0 ? (sampleCount / frameSum) / sampleRate : 0;

    const groups = [];            // { startFrame, endFrame } per spoken word
    let cursor = durations.length > 0 ? durations[0] : 0;   // skip BOS
    let curStart = cursor, hasPhon = false;
    for (let i = 0; i < phonemeIds.length; i++) {
        const d = durations[i + 1] || 0;
        if (phonemeIds[i] === spaceId) {
            if (hasPhon) { groups.push({ startFrame: curStart, endFrame: cursor }); hasPhon = false; }
            cursor += d;          // pause between words
            curStart = cursor;
        } else {
            if (!hasPhon) { curStart = cursor; hasPhon = true; }
            cursor += d;
        }
    }
    if (hasPhon) groups.push({ startFrame: curStart, endFrame: cursor });

    const textWords = sentence.split(/\s+/).filter(Boolean);
    const words = [];
    if (groups.length === textWords.length && groups.length > 0) {
        for (let i = 0; i < groups.length; i++) {
            words.push({
                text: textWords[i],
                startSec: groups[i].startFrame * secPerFrame,
                endSec:   groups[i].endFrame   * secPerFrame,
            });
        }
    } else {
        // Counts diverged (punctuation tokenised oddly) — fall back to a
        // proportional split by character length over the clip duration.
        const totalSec = frameSum * secPerFrame;
        let totalChars = 0;
        for (const w of textWords) totalChars += w.length;
        if (totalChars === 0) totalChars = 1;
        let acc = 0;
        for (const w of textWords) {
            const dur = totalSec * (w.length / totalChars);
            words.push({ text: w, startSec: acc, endSec: acc + dur });
            acc += dur;
        }
    }
    return words;
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
// Bring up the lightweight, this-thread pieces (audio context, cue tones), then
// kick off the (background-thread) model loads. Runs AFTER the first paint so
// the splash UI shows immediately instead of a black screen during model load.
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

    // Gate: only the heavy, downloadable weights (wake, LLM, Whisper) block
    // boot. If any are missing, show a download panel instead of pulling
    // gigabytes automatically; otherwise load straight away.
    const missing = VoiceModels.missingDownloadable();
    if (missing.length) { showGate(missing); return; }
    startLoad();
}

// ─── download gate ────────────────────────────────────────────────────────────
function humanBytes(n) {
    if (!n || n <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

// Show the gate: a per-model list with sizes and one button that downloads
// everything missing, then loads. Nothing downloads until the user clicks.
function showGate(missing) {
    let total = 0;
    for (const g of missing) total += g.bytes || 0;

    const rows = VoiceModels.status()
        .filter(s => s.downloadable)
        .map(s => '<div class="row ' + (s.present ? 'have' : 'need') + '">' +
                    '<span class="name">' + s.label + '</span>' +
                    '<span class="size">' +
                      (s.present ? 'ready' : (humanBytes(s.bytes) || 'download')) +
                    '</span></div>')
        .join('');

    const speech = VoiceModels.status().find(s => s.key === 'tts');
    const speechNote = speech && !speech.present
        ? '<p class="note">Speech output runs from local Kokoro + voice data, which isn\'t ' +
          'part of this download yet — replies will be text-only until it\'s provided.</p>'
        : '';

    $gate.innerHTML =
        '<h2>Download models</h2>' +
        '<p class="blurb">This app needs the model weights below. They aren\'t bundled — ' +
        'download them once (about ' + humanBytes(total) + ') into a shared cache.</p>' +
        '<div class="rows">' + rows + '</div>' +
        speechNote +
        '<div class="actions"><button id="gate-go">Download (' + humanBytes(total) + ')</button></div>';
    $gate.hidden = false;
    setStatus('idle', 'models needed');
    $talk.textContent = 'download models to begin';

    document.getElementById('gate-go').addEventListener('click', () => runDownload(missing));
}

// Button handler: download every missing required file, streaming progress to
// the meter + status, then load.
async function runDownload(missing) {
    const btn = document.getElementById('gate-go');
    if (btn) { btn.disabled = true; btn.textContent = 'downloading…'; }

    let grandTotal = 0;
    for (const g of missing) grandTotal += g.bytes || 0;

    // Aggregate per-file progress into one bar: completed files contribute their
    // full size; the in-flight file contributes its running received count.
    let curFile = null, completedBytes = 0, curReceived = 0;
    const onProgress = (p) => {
        if (p.file !== curFile) {
            if (curFile !== null) completedBytes += curReceived;
            curFile = p.file; curReceived = 0;
        }
        curReceived = p.received;
        const done = completedBytes + curReceived;
        const frac = grandTotal > 0 ? Math.min(1, done / grandTotal) : 0;
        $meter.style.opacity = '1';
        $meter.style.width = Math.round(frac * 100) + '%';
        setStatus('loading', 'downloading ' + p.label + ' — ' + humanBytes(curReceived) +
                  (p.total ? ' / ' + humanBytes(p.total) : ''));
    };

    try {
        await VoiceModels.download(missing, onProgress);
    } catch (e) {
        setStatus('error', 'download failed: ' + ((e && e.message) || e));
        if (btn) { btn.disabled = false; btn.textContent = 'retry download'; }
        return;
    }
    $gate.hidden = true;
    $gate.innerHTML = '';
    $meter.style.width = '0%';
    startLoad();
}

// Resolve every model path and start the loads.
function startLoad() {
    const p = VoiceModels.resolved();
    QWEN_GGUF      = p.qwen;
    WHISPER_DIR    = p.whisperDir;
    WHISPER_VOCAB  = p.whisperVocab;
    WHISPER_MERGES = p.whisperMerges;
    WHISPER_ADDED  = p.whisperAdded;
    WAKE_WEIGHTS   = p.wake;
    KOKORO_DIR     = p.kokoroDir;
    KOKORO_VOICE   = p.kokoroVoice;
    speechOn       = p.speechReady;

    setStatus('loading', 'loading models…');
    $meter.style.opacity = '0.6';
    loadModels();
}

// ─── model loading (parallel, async, non-blocking) ───────────────────────────
// All four load units run concurrently on their own background threads; the
// main thread stays responsive and the meter ticks up as each lands. bro.stt /
// bro.lm / bro.tts loaders take an { onReady, onError } callback to run async.
function loadModels() {
    const units = speechOn ? 4 : 3;   // lm, whisper, sttTok (+ voice when speech is on)
    let pending = units;
    let failed = false;
    const bump = () => {
        const done = units - pending;
        $meter.style.width = Math.round((done / units) * 100) + '%';
    };
    const fail = (stage, msg) => {
        if (failed) return;
        failed = true;
        setStatus('error', stage + ': ' + msg);
    };
    const ready = () => {
        bump();
        if (--pending === 0 && !failed) onModelsReady();
    };

    try {
        bro.lm.loadQwen(QWEN_GGUF, {
            onReady: (r) => { lm = r.model; lmTok = r.tokenizer; ready(); },
            onError: (m) => fail('language model', m),
        });

        bro.stt.loadWhisper(WHISPER_DIR, {
            onReady: (w) => { whisper = w; ready(); },
            onError: (m) => fail('speech recognition', m),
        });
        const tokOpts = {
            vocabPath: WHISPER_VOCAB,
            mergesPath: WHISPER_MERGES,
            onReady: (t) => {
                sttTok = t;
                try { sttPrompt = sttTok.buildPrompt('en', 'transcribe', false); } catch (_) {}
                ready();
            },
            onError: (m) => fail('speech tokenizer', m),
        };
        // Upstream Whisper keeps the "<|...|>" specials in a separate
        // added_tokens.json; pass it when resolved so the tokenizer merges them.
        if (WHISPER_ADDED) tokOpts.addedTokensPath = WHISPER_ADDED;
        bro.stt.loadTokenizer(tokOpts);

        if (speechOn) {
            bro.tts.setAssetRoot(SOUNDML_ROOT);
            bro.tts.loadKokoro(KOKORO_DIR, {
                onReady: (k) => {
                    kokoro = k;
                    try {
                        const v = k.vocab();
                        if (typeof v[' '] === 'number') spaceId = v[' '];
                    } catch (_) {}
                    k.loadVoice(KOKORO_VOICE, {
                        onReady: (vc) => { voice = vc; ready(); },
                        onError: (m) => fail('voice', m),
                    });
                },
                onError: (m) => fail('voice model', m),
            });
        }
    } catch (e) {
        fail('load', e.message);
    }
}

function onModelsReady() {
    modelsReady = true;
    $meter.style.width = '0%';
    $meter.style.opacity = '1';
    $talk.disabled = false;
    $talk.textContent = 'say "computer" or hold to talk';
    $talk.title = 'Say "computer" to activate, or hold (Space) to talk manually.';
    // Warm the phonemizer's lexicon off the critical path so the first reply
    // doesn't pay the one-time load cost mid-turn. A throw means its g2p data
    // (lexicon / POS tagger) is missing or unreadable — but speech is optional,
    // so drop to text-only instead of disabling the app; STT + LLM + wake still
    // work. (Run scripts/download-brosoundml-data.sh to fetch the g2p data.)
    setTimeout(() => {
        if (speechOn) {
            try { bro.tts.phonemize('warming up the lexicon'); }
            catch (e) { speechOn = false; console.warn('phonemizer unavailable:', e.message); }
        }
        startWake();
        goIdle();
    }, 0);
}

// ─── pipeline: STT -> streaming LLM -> per-sentence TTS ───────────────────────
// Kicks off transcription of the captured utterance. Each stage chains into the
// next inside its onDone, all on the main thread, all cancellable.
function runPipeline(samples16k) {
    const myTurn = acceptTurn;
    sttHandle = bro.stt.transcribe(
        whisper, { samples: samples16k, sampleRate: 16000 }, sttPrompt,
        { maxNewTokens: 128, onDone: (ids, info) => onTranscribed(myTurn, ids, info) });
}

function onTranscribed(myTurn, ids, info) {
    sttHandle = null;
    if (myTurn !== acceptTurn) return;          // superseded by a barge-in
    if (info && info.error) { pipelineError('stt', info.error); return; }

    let userText = '';
    try { userText = sttTok.decode(ids, true).trim(); } catch (_) {}
    stopLoadingIndicator();

    // A bare stop/cancel utterance just returns to idle — the barge-in already
    // halted the previous reply; don't answer "stop" as a question.
    const norm = userText.toLowerCase().replace(/[^a-z' ]+/g, '').replace(/\s+/g, ' ').trim();
    if (STOP_WORDS.has(norm)) {
        appendTurn('you', userText);
        setStatus('idle', 'stopped');
        finishTurn();
        return;
    }
    if (!userText) {
        setStatus('idle', 'no speech detected — idle');
        finishTurn();
        return;
    }

    appendTurn('you', userText);
    startBroTurn();
    setStatus('thinking', 'thinking…');
    startLLM(myTurn, userText);
}

function startLLM(myTurn, userText) {
    history.push({ role: 'user', content: userText });

    streamed = [];
    queuedLen = 0;
    llmDone = false;
    presynthSent = false;

    let promptIds;
    try {
        const prompt = lmTok.applyChatTemplate(history, true);
        promptIds = lmTok.encode(prompt);
    } catch (e) { pipelineError('llm', e.message); return; }

    lmHandle = bro.lm.generate(lm, promptIds, {
        maxNewTokens: 80,
        eosId: lmTok.imEndId,
        sampling: { temperature: 0.7, topK: 40, topP: 0.95,
                    seed: (promptIds.length * 2654435761) & 0x7fffffff },
        onToken: (id) => onLLMToken(myTurn, id),
        onDone:  (ids, info) => onLLMDone(myTurn, info),
    });
}

function onLLMToken(myTurn, id) {
    if (myTurn !== acceptTurn) return;
    streamed.push(id);
    let cleaned;
    try { cleaned = clean(lmTok.decode(streamed)); } catch (_) { return; }
    fullText = cleaned;
    updatePending();

    // Queue each newly completed sentence for synthesis.
    let s;
    while ((s = nextSentence(fullText, queuedLen)) !== null) {
        queuedLen += s.length;
        if (s.sentence) enqueueSynth(myTurn, s.sentence, queuedLen);
    }
}

function onLLMDone(myTurn, info) {
    lmHandle = null;
    if (myTurn !== acceptTurn) return;
    if (info && info.error) { pipelineError('llm', info.error); return; }

    // Flush any trailing partial sentence.
    const tail = fullText.slice(queuedLen).trim();
    if (tail) { enqueueSynth(myTurn, tail, fullText.length); queuedLen = fullText.length; }

    if (fullText.trim()) history.push({ role: 'assistant', content: fullText.trim() });
    llmDone = true;
    maybeFinishSpeaking();
}

function pipelineError(stage, msg) {
    setStatus('error', stage + ': ' + msg);
    resetReplyState();
    llmDone = true;
    finishTurn();
}

// ─── serial TTS queue ────────────────────────────────────────────────────────
function enqueueSynth(myTurn, sentence, consumed) {
    if (!speechOn) return;   // text-only: the reply renders as text; no synthesis
    synthQueue.push({ sentence, consumed, turn: myTurn });
    pumpSynth();
}

function pumpSynth() {
    if (synthBusy || synthQueue.length === 0) return;
    const item = synthQueue.shift();
    if (item.turn !== acceptTurn) { pumpSynth(); return; }  // stale

    let phonemeIds;
    try {
        phonemeIds = bro.tts.phonemize(item.sentence);
    } catch (e) {
        // A throw (vs. an empty result) means the phonemizer itself failed —
        // its g2p data went missing after boot. That's fatal for the whole
        // reply, not a per-sentence quirk, so surface it instead of muting.
        pipelineError('voice', e.message);
        return;
    }
    if (!phonemeIds || phonemeIds.length === 0) { pumpSynth(); return; }

    // Play the soft "about to speak" cue once, just before the first synth of
    // the turn, so it overlaps the synthesis latency.
    if (!presynthSent) { presynthSent = true; playPresynthCue(); setStatus('thinking', 'responding…'); }

    synthBusy = true;
    ttsHandle = bro.tts.synthesize(kokoro, phonemeIds, voice, {
        speed: 1.0,
        onDone: (res, info) => {
            synthBusy = false;
            ttsHandle = null;
            if (item.turn === acceptTurn && !(info && info.cancelled) && res &&
                res.samples && res.samples.length > 0) {
                const words = computeWords(item.sentence, phonemeIds, res.durations,
                                           res.samples.length, res.sampleRate);
                const els = finalizeSentence(words, item.consumed);
                enqueueAudio(res.samples, res.sampleRate, els, words);
                producedSpeech = true;
                setStatus('speaking', 'speaking…');
            }
            pumpSynth();
            maybeFinishSpeaking();
        },
    });
}

// Replace the streaming tail for this sentence with highlightable word spans.
// Returns the span elements (for the playback highlighter).
function finalizeSentence(words, consumed) {
    if (!broSpokenEl) startBroTurn();
    const els = [];
    for (let i = 0; i < words.length; i++) {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = words[i].text;
        broSpokenEl.appendChild(span);
        broSpokenEl.appendChild(document.createTextNode(' '));
        els.push(span);
    }
    finalizedLen = consumed;
    updatePending();
    return els;
}

function enqueueAudio(samples, sampleRate, els, words) {
    const resampled = resampleLinear(samples, sampleRate, engineRate);
    audioQueue.push({ samples: resampled, els: els || [], words });
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
    activePlaybackId = playbackId;

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
    clipEndTimer = setTimeout(() => {
        clipEndTimer = 0;
        clearInterval(highlightTimer); highlightTimer = 0;
        if (lastWord >= 0 && item.els[lastWord]) item.els[lastWord].classList.remove('speaking');
        try { audioCtx.deleteClip(clipId); } catch (_) {}
        activeClipId = -1;
        activePlaybackId = -1;
        playing = false;
        if (audioQueue.length > 0) pumpQueue();
        else maybeFinishSpeaking();
    }, durMs + 40);
}

// Return to idle once the LLM is done AND all synthesis + queued audio is out.
function maybeFinishSpeaking() {
    if (!llmDone || synthBusy || synthQueue.length > 0 || playing ||
        audioQueue.length > 0) return;
    finishTurn();
}

// End the current turn: clear in-flight state, suspend back to idle (with a wake
// tail after real speech so a trailing word isn't clipped by an immediate wake).
function finishTurn() {
    const wasSpeaking = producedSpeech;
    turnBusy = false;
    llmDone = false;
    producedSpeech = false;
    setTimeout(() => goIdle(), wasSpeaking ? WAKE_TAIL_MS : 0);
}

// Clear any lit word highlight. The highlight tick removes the `speaking` class
// in its own cleanup, but stopPlayback cancels that tick before it can run, so
// the currently-lit word would otherwise linger into the next turn. Querying the
// DOM catches it no matter which clip's closure lit it.
function clearWordHighlight() {
    const lit = $transcript.querySelectorAll('.word.speaking');
    for (let i = 0; i < lit.length; i++) lit[i].classList.remove('speaking');
}

// Stop and tear down all in-progress playback (shared by reset + barge-in).
function stopPlayback() {
    if (clipEndTimer) { clearTimeout(clipEndTimer); clipEndTimer = 0; }
    if (highlightTimer) { clearInterval(highlightTimer); highlightTimer = 0; }
    if (activePlaybackId >= 0) { try { audioCtx.stopPlayback(activePlaybackId); } catch (_) {} activePlaybackId = -1; }
    if (activeClipId >= 0) { try { audioCtx.deleteClip(activeClipId); } catch (_) {} activeClipId = -1; }
    clearWordHighlight();
    audioQueue.length = 0;
    playing = false;
}

function resetReplyState() {
    stopPlayback();
    synthQueue.length = 0;
}

// Barge-in: the user said "computer" (or held to talk) while a turn was in
// flight. Cancel every in-flight stage — this is a true cancel: the LLM decode
// stops within ~1 token and any pending STT/TTS result is dropped. Bumping
// acceptTurn makes any late callback a no-op as a backstop.
function interruptTurn() {
    acceptTurn = -1;
    turnBusy = false;
    llmDone = false;
    producedSpeech = false;
    synthBusy = false;
    try { if (sttHandle) sttHandle.cancel(); } catch (_) {}
    try { if (lmHandle)  lmHandle.cancel(); } catch (_) {}
    try { if (ttsHandle) ttsHandle.cancel(); } catch (_) {}
    sttHandle = lmHandle = ttsHandle = null;
    stopLoadingIndicator();
    stopPlayback();
    synthQueue.length = 0;
    if (broPendingEl) broPendingEl.textContent = '';
}

// ─── wake-score meter (when idle) ─────────────────────────────────────────
function startWake() {
    try {
        bro.wake.listen({
            weights: WAKE_WEIGHTS,
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

// Hand the captured utterance to the pipeline. STT, LLM, and TTS all run on
// background native threads; this thread keeps rendering and receives the
// transcript, streamed tokens, and per-sentence audio via async callbacks.
function stopRecordingAndRun() {
    if (!recording) return;
    recording = false;
    triggeredByWake = false;
    clearInterval(pollTimer);
    pollTimer = 0;
    $talk.classList.remove('recording');
    $talk.textContent = 'say "computer" or hold to talk';
    $meter.style.width = '0%';

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

    // Claim a turn id and arm barge-in: keep the wake word live through the
    // think + speak phases so the user can say "computer" to interrupt.
    turnSeq += 1;
    acceptTurn = turnSeq;
    turnBusy = true;
    wakeResume();

    runPipeline(samples16k);
}

// ─── wake handler ─────────────────────────────────────────────────────────
function onWake() {
    if (recording || $talk.disabled) return;
    // Barge-in: if a reply is being thought up or spoken, cut it off first.
    if (turnBusy) interruptTurn();
    playCueTone();
    (async () => {
        try { await ensureMic(); }
        catch (e) { setStatus('error', 'mic: ' + e.message); goIdle(); return; }
        startRecording(true);
    })();
}

// ─── input wiring (manual hold-to-talk) ───────────────────────────────────
async function onTalkDown() {
    if ($talk.disabled || recording || !modelsReady) return;
    if (turnBusy) interruptTurn();   // hold-to-talk also barges in
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
// Two rAFs guarantee the splash UI has painted before we kick off the
// (background-thread, but still CPU/GPU-heavy) model loads.
requestAnimationFrame(() => requestAnimationFrame(boot));

})();
