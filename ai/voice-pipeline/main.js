// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro/Qwen3-TTS -> speaker.
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
// Mic capture: bro.mic (broaudio's multi-consumer mic tap) in samples mode —
// fixed 10 ms chunks of raw PCM, already resampled to 16 kHz mono by broaudio's
// polyphase resampler. Each chunk carries its own peak, which drives the level
// meter and the end-of-utterance VAD; the chunk samples are concatenated into
// the utterance and handed straight to bro.stt.transcribe (no JS-side
// resampling or window stitching). Because the same tap can be driven offline
// via bro.mic.feed(), the whole pipeline is testable headlessly.
//
// Speech synthesis is streamed for both backends: Qwen3-TTS streams the growing
// codec tail (bro.tts.synthesizeStream with chunkFrames), Kokoro streams
// clause-sized phoneme chunks. Audio chunks are scheduled on the audio clock
// (playClip's sample-accurate `when` arg), so consecutive chunks join gaplessly
// with no main-thread setTimeout jitter.

(function () {
'use strict';

// ─── element refs ──────────────────────────────────────────────────────────
const $status     = document.getElementById('status');
const $transcript = document.getElementById('transcript');
const $talk       = document.getElementById('talk');
const $meter      = document.getElementById('meter');
const $setup      = document.getElementById('setup');
const $convo      = document.getElementById('convo');

// ─── models (loaded on the main context via the async inference API) ──────────
let whisper = null, sttTok = null, sttPrompt = null;
let lm = null, lmTok = null;
let kokoro = null, voice = null, spaceId = 16;
let qwen = null;        // Qwen3-TTS model (active speech backend when present)
let useQwen = false;    // true when a Qwen3-TTS backend is active
let useVoiceDesign = false;   // true when the active Qwen backend is VoiceDesign
// Qwen3-TTS voice selection, set from the setup screen. For CustomVoice
// `qwenSpeaker` picks a preset timbre; for VoiceDesign `qwenInstruct` is a
// natural-language description of the voice. `qwenLanguage` applies to both.
let qwenSpeaker  = 'serena';
let qwenLanguage = 'english';
let qwenInstruct = '';
let wakeEnabled  = true;       // wake word ("computer") loaded + listening
let modelsReady = false;
let speechOn = false;   // true once a speech backend (Qwen or Kokoro) loads; else text-only

// Model file paths, resolved at boot by VoiceModels (models.js) — they point at
// the shared model cache on a downloaded build, or at the dev sibling repos in a
// source checkout. Filled in by startSelected().
let QWEN_GGUF = null;
let WHISPER_DIR = null, WHISPER_VOCAB = null, WHISPER_MERGES = null, WHISPER_ADDED = null;
let WAKE_WEIGHTS = null, KOKORO_DIR = null, KOKORO_VOICE = null, QWEN_TTS_DIR = null;
// The phonemizer's explicit asset paths: the g2p lexicon + POS tagger, and the
// Kokoro config.json it reads the phoneme vocab from. Resolved by VoiceModels
// to the shared cache on a downloaded build or the dev siblings in a source
// checkout, then handed to bro.tts.setAssets() so the phonemizer loads from
// wherever the files actually live — no fixed sibling layout assumed.
let LEXICON_BIN = null, POS_TAGGER_BIN = null, KOKORO_CONFIG = null;

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

// Engine + audio (this thread owns playback; broaudio owns capture).
let audioCtx = null;
let engineRate = 44100;

// Mic capture: bro.mic samples mode. 160 frames @ 16 kHz = one 10 ms chunk per
// onChunk, raw PCM included — concatenating the chunks IS the utterance, at the
// rate Whisper wants.
const MIC_RATE     = 16000;
const CHUNK_FRAMES = 160;
const CHUNK_MS     = 1000 * CHUNK_FRAMES / MIC_RATE;   // 10
let micReady = false;

// Recording state (all timing is chunk-counted: 1 chunk = CHUNK_MS).
let recording = false;
let captured = [];               // Float32Array chunks @ 16 kHz
let recMs = 0;                   // total capture length so far
let speechMs = 0;                // total ms with peak above SPEECH_THRESH
let silenceMs = 0;               // ms since the last loud chunk

// Wake state.
let wakeActive = false;          // listen() has been called and not stopped
let triggeredByWake = false;     // current recording was started by onWake
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

// ─── playback scheduler (sample-accurate, gapless) ───────────────────────────
// Every TTS chunk is scheduled on the audio clock the moment it lands
// (playClip's 4th arg), so consecutive chunks join gaplessly. A 30 ms timer
// drives word highlighting from audioCtx.currentTime, retires finished clips,
// and detects end-of-speech.
const SCHED_LEAD = 0.06;   // lead time when starting from silence
let scheduled = [];        // { clipId, playbackId, startSec, endSec, els?, words?, group?, offsetSec? }
let nextStartSec = 0;      // audio-clock time the next clip should join at
let schedTimer = 0;
let producedSpeech = false;
let litWordEl = null;      // the currently highlighted word span

// ─── pipeline / turn state (barge-in) ────────────────────────────────────────
// Each utterance claims a monotonic turn id. Every async callback captures the
// turn it belongs to and ignores its result if the turn has been superseded —
// a backstop behind the real cancel (sttHandle/lmHandle/ttsHandle.cancel()).
let turnSeq = 0;
let acceptTurn = -1;
let turnBusy = false;     // a turn is in flight (transcribing / thinking / speaking)
let sttHandle = null;     // in-flight bro.stt.transcribe handle
let lmHandle = null;      // in-flight bro.lm.generate handle
let ttsHandle = null;     // in-flight bro.tts synthesize/synthesizeStream handle

// LLM streaming bookkeeping.
let streamed = [];        // raw token ids accumulated this turn
let queuedLen = 0;        // chars of cleaned text already handed to the TTS queue
let llmDone = false;      // the LLM finished producing tokens this turn
let presynthSent = false; // one-shot "about to speak" cue per turn

// Serial TTS queue — one synthesize() in flight at a time per the model's
// single-owner guard. Items: { sentence, consumed, turn, retries }.
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

// Live partial transcript: Whisper streams each decoded token (opts.onToken),
// so we can show the user's words filling in mid-decode instead of a blank wait.
// A provisional "you" row in the .pending style; onTranscribed removes it and
// appends the finalized turn.
let sttPartialEl = null;
function showSttPartial(text) {
    if (!sttPartialEl) {
        const hint = $transcript.querySelector('.hint');
        if (hint) hint.remove();
        const row = document.createElement('div');
        row.className = 'turn you';
        const w = document.createElement('span'); w.className = 'who'; w.textContent = 'you:';
        sttPartialEl = document.createElement('span');
        sttPartialEl.className = 'pending';
        sttPartialEl._row = row;
        row.appendChild(w);
        row.appendChild(document.createTextNode(' '));
        row.appendChild(sttPartialEl);
        $transcript.appendChild(row);
    }
    sttPartialEl.textContent = text;
    $transcript.scrollTop = $transcript.scrollHeight;
}
function clearSttPartial() {
    if (sttPartialEl && sttPartialEl._row) sttPartialEl._row.remove();
    sttPartialEl = null;
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

// Idle UI = wake listening + score meter (if available). A pipeline error
// stays on screen — wake/talk still re-arm, and the next interaction's own
// setStatus clears it. (finishTurn used to stomp errors with the idle message
// within 250 ms, which made every TTS/LLM failure look like silent success.)
function goIdle() {
    if ($status.className.indexOf('error') < 0) {
        const suffix = speechOn ? '' : ' (text-only)';
        if (wakeActive) {
            setStatus('idle', 'listening for "computer"…' + suffix);
        } else {
            setStatus('idle', 'idle' + suffix);
        }
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

// ─── text cleanup + sentence splitting ───────────────────────────────────────
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

// Split a clip's duration across words proportionally to character length —
// the timing model when phoneme/word counts diverge (Kokoro fallback).
function splitWordsByChars(textWords, totalSec) {
    let totalChars = 0;
    for (const w of textWords) totalChars += w.length;
    if (totalChars === 0) totalChars = 1;
    const words = [];
    let acc = 0;
    for (const w of textWords) {
        const dur = totalSec * (w.length / totalChars);
        words.push({ text: w, startSec: acc, endSec: acc + dur });
        acc += dur;
    }
    return words;
}

// Per-word timings from Kokoro's per-phoneme durations. durations[0] is the BOS
// frame count, durations[i+1] corresponds to phonemeIds[i], the last is EOS.
// Words are separated by the space token (spaceId); its frames belong to the
// inter-word gap, not to either word.
function computeWords(sentence, phonemeIds, durations, sampleCount, sampleRate) {
    const textWords = sentence.split(/\s+/).filter(Boolean);
    if (!durations || durations.length === 0)
        return splitWordsByChars(textWords, sampleCount / sampleRate);

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
        return splitWordsByChars(textWords, frameSum * secPerFrame);
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
// show the setup screen. NOTHING heavy loads here: the LLM, Whisper, wake word,
// and the chosen speech backend are megabytes-to-gigabytes each, so the app
// stays inert until the user picks a voice and clicks Start.
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

    showSetup();
}

// ─── setup screen (model selection) ─────────────────────────────────────────
function humanBytes(n) {
    if (!n || n <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

const esc = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Chunk pre-rendered item HTML into fixed-width row divs. We lay grids out as
// explicit single-line flex rows rather than flex-wrap / CSS grid: htmlayout
// under-reserves the cross-axis height of a multi-line wrapped container, so a
// wrapped grid paints over whatever follows it. Stacked single-line rows size
// correctly.
function rowsOf(items, per, lineClass) {
    let html = '';
    for (let i = 0; i < items.length; i += per)
        html += '<div class="' + lineClass + '">' + items.slice(i, i + per).join('') + '</div>';
    return html;
}

// Selection state, applied when the user clicks Start.
const sel = {
    backend: 'qwen',     // 'text' | 'kokoro' | 'qwen' | 'voicedesign'
    speaker: 'serena',
    language: 'english',
    description: VoiceModels.QWEN_VD_EXAMPLES[0],
    wake: true,
};

// Speech backend -> model group key (null for text-only).
function backendKey(b) {
    return b === 'kokoro'      ? 'tts'
         : b === 'qwen'        ? 'ttsq'
         : b === 'voicedesign' ? 'ttsvd'
         : null;
}
function groupReady(key) { const s = VoiceModels.groupStatus(key); return !!(s && s.present); }
// Is a backend choice currently available (its weights are present, or can be
// downloaded)? Non-downloadable Qwen weights that aren't on disk → unavailable.
function backendAvailable(b) {
    if (b === 'text') return true;
    const s = VoiceModels.groupStatus(backendKey(b));
    return !!(s && (s.present || s.downloadable));
}

// The set of model group keys a selection needs (core + wake + speech).
function requiredKeys() {
    const keys = ['llm', 'stt'];
    if (sel.wake) keys.push('wake');
    const bk = backendKey(sel.backend);
    if (bk) keys.push(bk);
    return keys;
}

// Render the whole setup panel, then wire it up.
function showSetup() {
    // Pick a sensible default backend: the richest one whose weights are ready.
    sel.backend = backendAvailable('qwen') && groupReady('ttsq') ? 'qwen'
                : backendAvailable('voicedesign') && groupReady('ttsvd') ? 'voicedesign'
                : groupReady('tts') ? 'kokoro'
                : backendAvailable('qwen') ? 'qwen' : 'text';

    const tag = (key) => {
        const s = VoiceModels.groupStatus(key);
        if (!s) return '';
        if (s.present) return '<span class="tag ready">ready</span>';
        if (s.downloadable) return '<span class="tag dl">download ' + humanBytes(s.bytes) + '</span>';
        return '<span class="tag need">needs weights</span>';
    };

    // Cards/chips are <div>s, not <button>s: htmlayout doesn't grow a button's
    // height to its block children, so a second line (the tag) overflows the
    // border. Divs size to content. Unavailable cards carry a `disabled` class.
    const card = (b, title, sub, key) => {
        const avail = backendAvailable(b);
        const t = key ? tag(key) : '<span class="tag none">no model</span>';
        return '<div class="voice-card' + (avail ? '' : ' disabled') + '" data-backend="' + b + '">' +
               '<span class="vc-title">' + title + '</span>' +
               '<span class="vc-sub">' + sub + '</span>' + t + '</div>';
    };

    $setup.innerHTML =
        '<p class="intro">Pick a voice for the assistant, then start. Only what you ' +
        'choose is loaded — speech recognition (Whisper) and the language model ' +
        '(Qwen3-8B) load alongside it.</p>' +

        '<div class="section-label">Voice</div>' +
        '<div class="voice-cards">' + rowsOf([
            card('text',        'Text only',  'No speech — replies appear as text', null),
            card('kokoro',      'Kokoro',     'Fast 82M, one warm voice', 'tts'),
            card('qwen',        'Qwen3-TTS · CustomVoice', '9 preset speakers, 10 languages', 'ttsq'),
            card('voicedesign', 'Qwen3-TTS · VoiceDesign', 'Describe any voice in words', 'ttsvd'),
        ], 2, 'card-line') + '</div>' +

        '<div id="voiceOpts" class="voice-opts"></div>' +

        '<div class="section-label">Pipeline</div>' +
        '<div class="core-rows">' +
            '<label class="wake-toggle"><input type="checkbox" id="wakeChk"' +
                (sel.wake ? ' checked' : '') + '> Wake word — say &ldquo;computer&rdquo; ' +
                'to talk hands-free ' + tag('wake') + '</label>' +
            '<div class="core-row"><span>Speech recognition · Whisper</span>' + tag('stt') + '</div>' +
            '<div class="core-row"><span>Language model · Qwen3-8B</span>' + tag('llm') + '</div>' +
        '</div>' +

        '<div class="start-bar">' +
            '<button id="startBtn" class="start">Start</button>' +
            '<div class="start-prog" id="startProg" hidden><div class="start-bar-fill" id="startFill"></div></div>' +
            '<div class="start-note" id="startNote"></div>' +
        '</div>';

    $setup.hidden = false;
    $convo.hidden = true;
    setStatus('idle', 'choose a voice');
    renderVoiceOpts();
    wireSetup();
    refreshStart();
}

// The per-backend options sub-panel (speakers / description / language).
function renderVoiceOpts() {
    const el = document.getElementById('voiceOpts');
    // Language as chips (the engine's native <select> popup overlaps surrounding
    // content), laid out in explicit rows of 5 — see rowsOf().
    const langChips = () => {
        const chips = VoiceModels.QWEN_LANGUAGES.map(l =>
            '<div class="lang" data-lang="' + l + '"' +
            (l === sel.language ? ' aria-selected="true"' : '') + '>' +
            l.charAt(0).toUpperCase() + l.slice(1) + '</div>');
        return '<div class="opt-label">Language</div>' +
               '<div class="lang-grid">' + rowsOf(chips, 5, 'lang-line') + '</div>';
    };

    if (sel.backend === 'qwen') {
        const chips = VoiceModels.QWEN_SPEAKERS.map(s =>
            '<div class="spk" data-speaker="' + s.id + '"' +
            (s.id === sel.speaker ? ' aria-selected="true"' : '') + '>' +
            '<span class="spk-name">' + esc(s.name) + '</span>' +
            '<span class="spk-note">' + esc(s.note) +
            (s.dialect ? ' · ' + esc(s.dialect) : '') + '</span></div>');
        el.innerHTML = '<div class="opt-label">Speaker</div>' +
            '<div class="spk-grid">' + rowsOf(chips, 3, 'spk-line') + '</div>' + langChips();
    } else if (sel.backend === 'voicedesign') {
        const examples = VoiceModels.QWEN_VD_EXAMPLES.map(x =>
            '<div class="ex" data-ex="' + esc(x) + '">' + esc(x) + '</div>').join('');
        // A single-line <input> (htmlayout renders <textarea> as 0×0).
        el.innerHTML =
            '<div class="opt-label">Describe the voice</div>' +
            '<input type="text" id="vdDesc" class="vd-desc" value="' + esc(sel.description) + '" ' +
            'placeholder="e.g. a warm, low-pitched elderly storyteller">' +
            '<div class="opt-sub">Or start from an example:</div>' +
            '<div class="ex-list">' + examples + '</div>' + langChips();
    } else if (sel.backend === 'kokoro') {
        el.innerHTML = '<p class="opt-note">Kokoro speaks with a single warm English voice ' +
            '(af_heart). No options to pick — fast and lightweight.</p>';
    } else {
        el.innerHTML = '<p class="opt-note">Replies are shown as text only. You can still ' +
            'talk to the assistant; it just won\'t speak back.</p>';
    }
    wireVoiceOpts();
}

function wireSetup() {
    $setup.querySelectorAll('.voice-card').forEach(c => {
        c.addEventListener('click', () => {
            if (c.classList.contains('disabled')) return;
            sel.backend = c.dataset.backend;
            $setup.querySelectorAll('.voice-card').forEach(x =>
                x.classList.toggle('on', x === c));
            renderVoiceOpts();
            refreshStart();
        });
        c.classList.toggle('on', c.dataset.backend === sel.backend);
    });
    const wk = document.getElementById('wakeChk');
    if (wk) wk.addEventListener('change', () => { sel.wake = wk.checked; refreshStart(); });
    document.getElementById('startBtn').addEventListener('click', startSelected);
}

function wireVoiceOpts() {
    const el = document.getElementById('voiceOpts');
    el.querySelectorAll('.spk').forEach(b => b.addEventListener('click', () => {
        sel.speaker = b.dataset.speaker;
        el.querySelectorAll('.spk').forEach(x =>
            x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    }));
    el.querySelectorAll('.ex').forEach(b => b.addEventListener('click', () => {
        sel.description = b.dataset.ex;
        const ta = document.getElementById('vdDesc');
        if (ta) ta.value = sel.description;
    }));
    const ta = document.getElementById('vdDesc');
    if (ta) ta.addEventListener('input', () => { sel.description = ta.value; });
    el.querySelectorAll('.lang').forEach(b => b.addEventListener('click', () => {
        sel.language = b.dataset.lang;
        el.querySelectorAll('.lang').forEach(x =>
            x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    }));
}

// Update the Start button label / enabled state from the current selection.
function refreshStart() {
    const btn = document.getElementById('startBtn');
    const note = document.getElementById('startNote');
    if (!btn) return;
    let dlBytes = 0, blocked = null;
    for (const k of requiredKeys()) {
        const s = VoiceModels.groupStatus(k);
        if (!s || s.present) continue;
        if (s.downloadable) dlBytes += s.bytes || 0;
        else blocked = s.label;
    }
    if (blocked) {
        btn.disabled = true;
        btn.textContent = 'Start';
        note.textContent = blocked + ' isn\'t on disk and isn\'t auto-downloaded — fetch it ' +
            'with brosoundml\'s download-qwen-tts.sh, or pick another voice.';
    } else {
        btn.disabled = false;
        btn.textContent = dlBytes > 0 ? 'Download & start · ' + humanBytes(dlBytes) : 'Start';
        note.textContent = dlBytes > 0
            ? 'First run downloads ' + humanBytes(dlBytes) + ' into a shared cache.'
            : '';
    }
}

// Apply the selection: download anything missing, then load only what's chosen.
async function startSelected() {
    const btn = document.getElementById('startBtn');
    const prog = document.getElementById('startProg');
    const fill = document.getElementById('startFill');
    const note = document.getElementById('startNote');
    btn.disabled = true;

    // Apply selection to the backend flags + Qwen voice parameters.
    sel.wake = !!sel.wake;
    wakeEnabled = sel.wake;
    qwenSpeaker  = sel.speaker;
    qwenLanguage = sel.language;
    qwenInstruct = (sel.description || '').trim();
    useVoiceDesign = (sel.backend === 'voicedesign');
    useQwen        = (sel.backend === 'qwen' || sel.backend === 'voicedesign');
    speechOn       = (sel.backend !== 'text');

    // Resolve every path once; pick the active Qwen dir by variant.
    const p = VoiceModels.resolved();
    QWEN_GGUF      = p.qwen;
    WHISPER_DIR    = p.whisperDir;
    WHISPER_VOCAB  = p.whisperVocab;
    WHISPER_MERGES = p.whisperMerges;
    WHISPER_ADDED  = p.whisperAdded;
    WAKE_WEIGHTS   = p.wake;
    KOKORO_DIR     = p.kokoroDir;
    KOKORO_VOICE   = p.kokoroVoice;
    KOKORO_CONFIG  = p.kokoroConfig;
    LEXICON_BIN    = p.lexicon;
    POS_TAGGER_BIN = p.posTagger;
    QWEN_TTS_DIR   = useVoiceDesign ? p.qwenVdDir : p.qwenTtsDir;

    // Download any missing (downloadable) weights for the selection.
    const keys = requiredKeys();
    let grandTotal = 0;
    for (const k of keys) {
        const s = VoiceModels.groupStatus(k);
        if (s && !s.present && s.downloadable) grandTotal += s.bytes || 0;
    }
    if (grandTotal > 0) {
        prog.hidden = false;
        let curFile = null, completed = 0, received = 0;
        const onProgress = (q) => {
            if (q.file !== curFile) { if (curFile !== null) completed += received; curFile = q.file; received = 0; }
            received = q.received;
            const frac = Math.min(1, (completed + received) / grandTotal);
            fill.style.width = Math.round(frac * 100) + '%';
            note.textContent = 'downloading ' + q.label + ' — ' + humanBytes(completed + received) +
                ' / ' + humanBytes(grandTotal);
        };
        try {
            await VoiceModels.downloadKeys(keys, onProgress);
        } catch (e) {
            note.textContent = 'download failed: ' + ((e && e.message) || e);
            btn.disabled = false; btn.textContent = 'Retry';
            return;
        }
    }

    // Switch to the conversation view and load the selected models.
    $setup.hidden = true;
    $convo.hidden = false;
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

        if (speechOn && useQwen) {
            // Qwen3-TTS: a single load (text-driven — no voice pack, no g2p).
            bro.tts.loadQwen(QWEN_TTS_DIR, {
                onReady: (q) => { qwen = q; ready(); },
                onError: (m) => fail('speech model', m),
            });
        } else if (speechOn) {
            bro.tts.setAssets({
                lexicon:      LEXICON_BIN,
                posTagger:    POS_TAGGER_BIN,
                kokoroConfig: KOKORO_CONFIG,
            });
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
        if (speechOn && !useQwen) {
            // Kokoro only: warm the phonemizer's lexicon off the critical path.
            try { bro.tts.phonemize('warming up the lexicon'); }
            catch (e) { speechOn = false; console.warn('phonemizer unavailable:', e.message); }
        }
        if (wakeEnabled) startWake();   // skipped when the user opted out of wake
        goIdle();
    }, 0);
}

// ─── pipeline: STT -> streaming LLM -> per-sentence TTS ───────────────────────
// Kicks off transcription of the captured utterance. Each stage chains into the
// next inside its onDone, all on the main thread, all cancellable.
function runPipeline(samples16k) {
    const myTurn = acceptTurn;
    const partialIds = [];   // content tokens streamed so far (no prompt prefix)
    sttHandle = bro.stt.transcribe(
        whisper, { samples: samples16k, sampleRate: MIC_RATE }, sttPrompt, {
            maxNewTokens: 128,
            // Each decoded token, as it lands — detokenize the running prefix and
            // show it filling in. Cheap for an utterance-length transcript.
            onToken: (id) => {
                if (myTurn !== acceptTurn) return;
                partialIds.push(id);
                let t = '';
                try { t = sttTok.decode(partialIds, true).trim(); } catch (_) {}
                if (t) showSttPartial(t);
            },
            onDone: (ids, info) => { clearSttPartial(); onTranscribed(myTurn, ids, info); },
        });
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
    console.error('[voice-pipeline] ' + stage + ': ' + msg);
    setStatus('error', stage + ': ' + msg);
    resetReplyState();
    llmDone = true;
    finishTurn();
}

// ─── serial TTS queue ────────────────────────────────────────────────────────
function enqueueSynth(myTurn, sentence, consumed) {
    if (!speechOn) return;   // text-only: the reply renders as text; no synthesis
    synthQueue.push({ sentence, consumed, turn: myTurn, retries: 0 });
    pumpSynth();
}

// Kokoro streaming threshold: a sentence with at least this many spoken words is
// synthesized in clause-sized chunks (bro.tts.synthesizeStream) so the opening
// words are heard before the whole sentence finishes; shorter sentences keep the
// single-pass synthesize() (precise per-phoneme word highlighting). 24 kHz is
// Kokoro's fixed output rate — the streaming onChunk delivers raw samples only.
const STREAM_MIN_WORDS = 6;
const STREAM_CHUNK_WORDS = 4;
const KOKORO_SR = 24000;

// Qwen3-TTS streaming: the codec emits 12.5 Hz frames of 1920 samples each.
// QWEN_STREAM_FRAMES frames per onChunk; playback begins once PREBUFFER chunks
// are in hand (or the stream ends), so ~realtime synthesis jitter doesn't open
// gaps mid-sentence.
const QWEN_SR = 24000;
const QWEN_STREAM_FRAMES = 8;                                  // ~0.64 s per chunk
const QWEN_CHUNK_SEC = QWEN_STREAM_FRAMES * 1920 / QWEN_SR;
const QWEN_PREBUFFER = 2;

// Split a sentence's phoneme ids into per-word groups at the space token, then
// batch those words into clause-sized chunks. Returns { chunks: number[][],
// ranges: [start,end][] } where each range indexes the sentence's spoken words,
// or null when the phoneme word count doesn't match the text word count (odd
// punctuation tokenisation) or the sentence is short — the caller then falls back
// to a single non-streamed synthesis with precise highlighting.
function buildKokoroChunks(phonemeIds, wordCount) {
    if (wordCount < STREAM_MIN_WORDS) return null;
    const phonWords = [];
    let cur = [];
    for (const id of phonemeIds) {
        if (id === spaceId) { if (cur.length) { phonWords.push(cur); cur = []; } }
        else cur.push(id);
    }
    if (cur.length) phonWords.push(cur);
    if (phonWords.length !== wordCount) return null;   // counts diverged — no stream

    const chunks = [], ranges = [];
    for (let i = 0; i < phonWords.length; i += STREAM_CHUNK_WORDS) {
        const end = Math.min(i + STREAM_CHUNK_WORDS, phonWords.length);
        const ids = [];
        for (let j = i; j < end; j++) {
            if (ids.length) ids.push(spaceId);   // re-insert word-gap tokens
            for (const id of phonWords[j]) ids.push(id);
        }
        chunks.push(ids);
        ranges.push([i, end]);
    }
    return { chunks, ranges };
}

// One synthesize/synthesizeStream in flight at a time (the model is
// single-owner). A synchronous throw here usually means the model hasn't
// finished releasing after a barge-in cancel — retry shortly instead of
// wedging the queue (synthBusy must never be left true with nothing in
// flight; that killed speech for the rest of the session).
function pumpSynth() {
    if (synthBusy || synthQueue.length === 0) return;
    const item = synthQueue.shift();
    if (item.turn !== acceptTurn) { pumpSynth(); return; }  // stale

    try {
        startSentenceSynth(item);
    } catch (e) {
        synthBusy = false;
        if (++item.retries <= 50) {
            synthQueue.unshift(item);
            setTimeout(pumpSynth, 40);
        } else {
            pipelineError('voice', e.message);
        }
    }
}

// Dispatch one sentence to the active backend. Sets synthBusy and ttsHandle on
// success; throws if the model rejects the op (handled by pumpSynth).
function startSentenceSynth(item) {
    // Kokoro needs phoneme ids up front; Qwen3-TTS takes the raw sentence.
    let phonemeIds = null;
    if (!useQwen) {
        // A phonemizer throw (vs. an empty result) means its g2p data went
        // missing after boot — fatal for the reply, so let it surface.
        phonemeIds = bro.tts.phonemize(item.sentence);
        if (!phonemeIds || phonemeIds.length === 0) { pumpSynth(); return; }
    }

    // Play the soft "about to speak" cue once, just before the first synth of
    // the turn, so it overlaps the synthesis latency.
    if (!presynthSent) { presynthSent = true; playPresynthCue(); setStatus('thinking', 'responding…'); }

    synthBusy = true;
    if (useQwen) { startQwenSynth(item); return; }
    startKokoroSynth(item, phonemeIds);
}

// Qwen3-TTS: stream the growing codec tail so the first words are heard while
// the rest of the sentence is still synthesizing. Word highlighting is
// char-proportional (Qwen has no per-phoneme durations); the sentence's total
// duration is only known at onDone, so the highlighter scales char fractions by
// a running estimate (received + one chunk) until the final total lands.
function startQwenSynth(item) {
    const textWords = item.sentence.split(/\s+/).filter(Boolean);
    const els = finalizeSentence(textWords.map(t => ({ text: t })), item.consumed);
    let totalChars = 0;
    for (const w of textWords) totalChars += w.length;
    if (totalChars === 0) totalChars = 1;
    const fracs = [];
    let acc = 0;
    for (const w of textWords) {
        fracs.push({ start: acc / totalChars, end: (acc + w.length) / totalChars });
        acc += w.length;
    }
    const group = { els, fracs, receivedSec: 0, totalSec: 0 };  // totalSec 0 = still streaming
    const pending = [];   // prebuffer: hold the first chunks until enough is banked
    let started = false;
    const flush = () => {
        started = true;
        for (const p of pending) enqueueAudio(p.samples, QWEN_SR, p.meta);
        pending.length = 0;
    };

    const opts = useVoiceDesign
        ? { instruct: qwenInstruct, language: qwenLanguage }
        : { speaker: qwenSpeaker, language: qwenLanguage };
    opts.chunkFrames = QWEN_STREAM_FRAMES;
    opts.onChunk = (samples) => {
        if (item.turn !== acceptTurn || !samples || samples.length === 0) return;
        const meta = { group, offsetSec: group.receivedSec };
        group.receivedSec += samples.length / QWEN_SR;
        if (!producedSpeech) { producedSpeech = true; setStatus('speaking', 'speaking…'); }
        if (started) { enqueueAudio(samples, QWEN_SR, meta); return; }
        pending.push({ samples, meta });
        if (pending.length >= QWEN_PREBUFFER) flush();
    };
    opts.onDone = (res, info) => {
        synthBusy = false;
        ttsHandle = null;
        if (item.turn === acceptTurn && !(info && info.cancelled)) {
            if (info && info.error) { pipelineError('voice', info.error); return; }
            group.totalSec = res && res.samples && res.samples.length > 0
                ? res.samples.length / QWEN_SR
                : group.receivedSec;
            if (!started) flush();   // short sentence: everything fit in the prebuffer
        }
        pumpSynth();
        maybeFinishSpeaking();
    };
    ttsHandle = bro.tts.synthesizeStream(qwen, item.sentence, opts);
}

// Kokoro: stream long sentences in clause-sized phoneme chunks so the first
// clause is heard sooner; short / divergent sentences use a single pass with
// precise per-phoneme highlighting. synthesizeStream hands each chunk its own
// per-phoneme durations, so streamed highlighting stays exact too.
function startKokoroSynth(item, phonemeIds) {
    const textWords = item.sentence.split(/\s+/).filter(Boolean);
    const plan = buildKokoroChunks(phonemeIds, textWords.length);
    if (plan) {
        const els = finalizeSentence(textWords.map(t => ({ text: t })), item.consumed);
        let ci = 0;
        ttsHandle = bro.tts.synthesizeStream(kokoro, plan.chunks, voice, {
            speed: 1.0,
            onChunk: (samples, durations) => {
                if (item.turn !== acceptTurn || !samples || samples.length === 0) return;
                const idx = ci++;
                const r = plan.ranges[idx] || [0, 0];
                const chunkText = textWords.slice(r[0], r[1]).join(' ');
                const words = computeWords(chunkText, plan.chunks[idx], durations,
                                           samples.length, KOKORO_SR);
                if (!producedSpeech) { producedSpeech = true; setStatus('speaking', 'speaking…'); }
                enqueueAudio(samples, KOKORO_SR, { els: els.slice(r[0], r[1]), words });
            },
            onDone: (_res, info) => {
                synthBusy = false;
                ttsHandle = null;
                if (item.turn === acceptTurn && info && info.error && !info.cancelled) {
                    pipelineError('voice', info.error);
                    return;
                }
                pumpSynth();              // chunks already enqueued during the stream
                maybeFinishSpeaking();
            },
        });
        return;
    }

    // Short / divergent sentence — single pass, precise per-phoneme highlighting.
    ttsHandle = bro.tts.synthesize(kokoro, phonemeIds, voice, {
        speed: 1.0,
        onDone: (res, info) => {
            synthBusy = false;
            ttsHandle = null;
            if (item.turn === acceptTurn && !(info && info.cancelled)) {
                if (info && info.error) { pipelineError('voice', info.error); return; }
                if (res && res.samples && res.samples.length > 0) {
                    const words = computeWords(item.sentence, phonemeIds, res.durations,
                                               res.samples.length, res.sampleRate);
                    const els = finalizeSentence(words, item.consumed);
                    if (!producedSpeech) { producedSpeech = true; setStatus('speaking', 'speaking…'); }
                    enqueueAudio(res.samples, res.sampleRate, { els, words });
                }
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

// ─── playback scheduler ──────────────────────────────────────────────────────
// Resample to the engine rate, create a clip, and schedule it on the audio
// clock immediately behind the previous one (playClip's `when` arg) — chunks
// join sample-accurately with no main-thread timing in the loop. meta carries
// the highlight info: { els, words } (Kokoro, per-clip timings) or
// { group, offsetSec } (Qwen stream, char-proportional over the sentence).
function enqueueAudio(samples, sampleRate, meta) {
    const resampled = resampleLinear(samples, sampleRate, engineRate);
    const dur = resampled.length / engineRate;
    const now = audioCtx.currentTime;
    const when = Math.max(now + SCHED_LEAD, nextStartSec);
    let clipId, playbackId;
    try {
        clipId = audioCtx.createClip(resampled, 1);
        playbackId = audioCtx.playClip(clipId, 1.0, false, when);
    } catch (e) {
        console.warn('playback failed:', e.message);
        return;
    }
    nextStartSec = when + dur;
    const it = { clipId, playbackId, startSec: when, endSec: when + dur };
    if (meta) Object.assign(it, meta);
    scheduled.push(it);
    if (!schedTimer) schedTimer = setInterval(schedTick, 30);
}

// Retire finished clips, drive the word highlight from the audio clock, and
// detect end-of-speech.
function schedTick() {
    const now = audioCtx.currentTime;
    while (scheduled.length && scheduled[0].endSec <= now) {
        const it = scheduled.shift();
        try { audioCtx.deleteClip(it.clipId); } catch (_) {}
    }
    if (scheduled.length === 0) {
        clearInterval(schedTimer);
        schedTimer = 0;
        setWordHighlight(null);
        maybeFinishSpeaking();
        return;
    }

    const cur = scheduled[0];
    if (cur.startSec > now) { setWordHighlight(null); return; }   // pre-roll / gap

    let active = null;
    if (cur.words) {
        // Kokoro: exact per-clip word timings.
        const pos = now - cur.startSec;
        for (let i = 0; i < cur.words.length; i++) {
            if (pos >= cur.words[i].startSec && pos < cur.words[i].endSec) {
                active = cur.els[i];
                break;
            }
        }
    } else if (cur.group) {
        // Qwen stream: char fractions × the sentence's evolving duration
        // estimate (exact once the stream has finished).
        const g = cur.group;
        const pos = cur.offsetSec + (now - cur.startSec);
        const est = g.totalSec || (g.receivedSec + QWEN_CHUNK_SEC);
        for (let i = 0; i < g.fracs.length; i++) {
            if (pos >= g.fracs[i].start * est && pos < g.fracs[i].end * est) {
                active = g.els[i];
                break;
            }
        }
    }
    setWordHighlight(active);
}

function setWordHighlight(el) {
    if (el === litWordEl) return;
    if (litWordEl) litWordEl.classList.remove('speaking');
    if (el) el.classList.add('speaking');
    litWordEl = el;
}

// Return to idle once the LLM is done AND all synthesis + scheduled audio is out.
function maybeFinishSpeaking() {
    if (!llmDone || synthBusy || synthQueue.length > 0 || scheduled.length > 0) return;
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

// Clear any lit word highlight, including one whose clip was torn down before
// its tick could clean up. Querying the DOM catches strays no matter which
// sentence lit them.
function clearWordHighlight() {
    litWordEl = null;
    const lit = $transcript.querySelectorAll('.word.speaking');
    for (let i = 0; i < lit.length; i++) lit[i].classList.remove('speaking');
}

// Stop and tear down all scheduled playback (shared by reset + barge-in).
function stopPlayback() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = 0; }
    for (const it of scheduled) {
        try { audioCtx.stopPlayback(it.playbackId); } catch (_) {}
        try { audioCtx.deleteClip(it.clipId); } catch (_) {}
    }
    scheduled = [];
    nextStartSec = 0;
    clearWordHighlight();
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
        if (recording || !wakeActive || scheduled.length > 0 || loadingAnim) return;
        let score = 0;
        try { score = bro.wake.lastScore() || 0; } catch (_) {}
        $meter.style.width = Math.min(100, score * 100) + '%';
        $meter.style.opacity = (0.25 + 0.75 * Math.min(1, score / 0.85)).toFixed(2);
    }, 100);
}

// ─── mic capture (bro.mic, samples mode) ──────────────────────────────────
// One tap, registered on first use, kept for the app's lifetime. broaudio owns
// the device, the resample to 16 kHz, and the 10 ms chunk slicing; onMicChunk
// only accumulates samples and runs the EoU VAD while a recording is open.
// Multiple consumers coexist (bro.wake taps the same capture), and the same
// tap can be driven offline with bro.mic.feed() for headless tests.
function ensureMic() {
    if (micReady) return;
    bro.mic.start({
        chunkFrames: CHUNK_FRAMES,
        targetRate:  MIC_RATE,
        samples:     true,
        agc:         false,
        onChunk:     onMicChunk,
    });
    micReady = true;
}

function onMicChunk(c) {
    if (!recording) return;
    captured.push(c.samples);
    recMs += CHUNK_MS;

    $meter.style.opacity = '1';
    $meter.style.width = Math.min(100, c.peak * 200) + '%';

    if (c.peak >= SPEECH_THRESH) {
        speechMs += CHUNK_MS;
        silenceMs = 0;
    } else {
        silenceMs += CHUNK_MS;
    }

    if (triggeredByWake) {
        if (recMs >= MAX_CAPTURE_MS) { stopRecordingAndRun(); return; }
        if (speechMs === 0 && recMs >= NO_SPEECH_ABORT_MS) {
            abortRecording('no speech — idle'); return;
        }
        if (speechMs >= MIN_SPEECH_MS && silenceMs >= EOU_SILENCE_MS) {
            stopRecordingAndRun(); return;
        }
    }
}

function startRecording(fromWake) {
    if (recording) return;
    captured = [];
    recMs = 0;
    speechMs = 0;
    silenceMs = 0;
    recording = true;
    triggeredByWake = !!fromWake;

    wakeSuspend();

    setStatus('listening', fromWake ? 'recording…' : 'listening…');
    $talk.classList.add('recording');
    $talk.textContent = fromWake ? 'recording (wake)…' : 'release to send';
}

function abortRecording(msg) {
    if (!recording) return;
    recording = false;
    triggeredByWake = false;
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

// Linear resample to target rate (playback side: 24 kHz TTS -> engine rate).
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
    $talk.classList.remove('recording');
    $talk.textContent = 'say "computer" or hold to talk';
    $meter.style.width = '0%';

    const samples16k = concatChunks(captured);
    captured = [];
    if (samples16k.length < MIC_RATE * 0.25) {
        setStatus('idle', 'too short — idle');
        setTimeout(() => goIdle(), 0);
        return;
    }

    // Confirm we captured the utterance ("got it"), then show the loader for the
    // silent STT + LLM-prefill stretch until the first reply token lands.
    playReceiptCue();
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
    try { ensureMic(); }
    catch (e) { setStatus('error', 'mic: ' + e.message); goIdle(); return; }
    startRecording(true);
}

// ─── input wiring (manual hold-to-talk) ───────────────────────────────────
function onTalkDown() {
    if ($talk.disabled || recording || !modelsReady) return;
    if (turnBusy) interruptTurn();   // hold-to-talk also barges in
    try { ensureMic(); }
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
