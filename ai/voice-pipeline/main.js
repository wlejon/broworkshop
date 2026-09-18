// Voice pipeline: mic -> Whisper -> Qwen3 -> Kokoro/Qwen3-TTS -> speaker.
// Orchestrates speech recognition, language model streaming, and speech synthesis.

import * as VoiceModels from "/app/models.js";
import { installSystemMenu } from "/lib/system-menu.js";
import { initSetupScreen } from "/app/setup_ui.js";
import { createAudioPlayer } from "/app/audio_playback.js";

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
let qwen = null;
let useQwen = false;
let useVoiceDesign = false;
let qwenSpeaker  = 'serena';
let qwenLanguage = 'english';
let qwenInstruct = '';
let wakeEnabled  = true;
let modelsReady = false;
let speechOn = false;

// Model file paths resolved by VoiceModels.
let QWEN_GGUF = null;
let WHISPER_DIR = null, WHISPER_VOCAB = null, WHISPER_MERGES = null, WHISPER_ADDED = null;
let WAKE_WEIGHTS = null, KOKORO_DIR = null, KOKORO_VOICE = null, QWEN_TTS_DIR = null;
let LEXICON_BIN = null, POS_TAGGER_BIN = null, KOKORO_CONFIG = null;

// Conversation memory.
const history = [
    { role: 'system', content:
        'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
        'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
        'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
        'friend, not a chatbot. /no_think' },
];

const STOP_WORDS = new Set([
    'stop', 'stop it', 'stop talking', 'stop please', 'please stop',
    'cancel', 'never mind', 'nevermind', 'forget it', 'be quiet', 'quiet',
    'shut up', 'shush', 'enough', "that's enough", 'thats enough',
]);

// Engine & Audio.
let audioCtx = null;
let engineRate = 44100;
let audioPlayer = null;

// Mic capture constants.
const MIC_RATE            = 16000;
const CHUNK_FRAMES        = 160;
const CHUNK_MS            = 10;
const SPEECH_THRESH       = 0.015;
const MIN_SPEECH_MS       = 250;
const EOU_SILENCE_MS      = 800;
const NO_SPEECH_ABORT_MS  = 3000;
const MAX_CAPTURE_MS      = 10000;
const WAKE_TAIL_MS        = 250;

// Reply rendering state.
let broSpokenEl = null;
let broPendingEl = null;
let fullText = '';
let finalizedLen = 0;

// Turn / pipeline state.
let turnSeq = 0;
let acceptTurn = -1;
let turnBusy = false;
let sttHandle = null;
let lmHandle = null;
let ttsHandle = null;

let streamed = [];
let queuedLen = 0;
let llmDone = false;
let presynthSent = false;
let producedSpeech = false;

const synthQueue = [];
let synthBusy = false;

// Native SoundML VoiceAgent instance (when supported).
let nativeVoiceAgent = null;

// Mic & Wake state.
let micReady = false;
let recording = false;
let triggeredByWake = false;
let captured = [];
let recMs = 0, speechMs = 0, silenceMs = 0;
let wakeActive = false;
let wakeMeterTimer = 0;
let loadingAnim = false;

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

function wakeSuspend() {
    if (!wakeActive) return;
    try { if (!bro.wake.isSuspended()) bro.wake.suspend(); } catch (_) {}
}

function wakeResume() {
    if (!wakeActive) return;
    try { if (bro.wake.isSuspended()) bro.wake.resume(); } catch (_) {}
}

function goIdle() {
    if ($status.className.indexOf('error') < 0) {
        const suffix = speechOn ? '' : ' (text-only)';
        if (wakeActive) setStatus('idle', 'listening for "computer"…' + suffix);
        else setStatus('idle', 'idle' + suffix);
    }
    $meter.style.width = '0%';
    wakeResume();
}

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
function clean(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/g, '')
        .replace(/<\|.*?\|>/g, '')
        .replace(/^\s+/, '');
}

function nextSentence(text, fromLen) {
    const m = text.slice(fromLen).match(/^[\s\S]*?[.!?\n]+/);
    if (!m) return null;
    return { sentence: m[0].trim(), length: m[0].length };
}

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

function computeWords(sentence, phonemeIds, durations, sampleCount, sampleRate) {
    const textWords = sentence.split(/\s+/).filter(Boolean);
    if (!durations || durations.length === 0)
        return splitWordsByChars(textWords, sampleCount / sampleRate);

    let frameSum = 0;
    for (let i = 0; i < durations.length; i++) frameSum += durations[i];
    const secPerFrame = frameSum > 0 ? (sampleCount / frameSum) / sampleRate : 0;

    const groups = [];
    let cursor = durations.length > 0 ? durations[0] : 0;
    let curStart = cursor, hasPhon = false;
    for (let i = 0; i < phonemeIds.length; i++) {
        const d = durations[i + 1] || 0;
        if (phonemeIds[i] === spaceId) {
            if (hasPhon) { groups.push({ startFrame: curStart, endFrame: cursor }); hasPhon = false; }
            cursor += d;
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
        return splitWordsByChars(textWords, frameSum * secPerFrame);
    }
    return words;
}

// ─── model loading ───────────────────────────────────────────────────────────
function loadModels() {
    const units = speechOn ? 4 : 3;
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
        if (WHISPER_ADDED) tokOpts.addedTokensPath = WHISPER_ADDED;
        bro.stt.loadTokenizer(tokOpts);

        if (speechOn && useQwen) {
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

    initNativeVoiceAgent();

    setTimeout(() => {
        if (speechOn && !useQwen) {
            try { bro.tts.phonemize('warming up the lexicon'); }
            catch (e) { speechOn = false; console.warn('phonemizer unavailable:', e.message); }
        }
        if (wakeEnabled) startWake();
        goIdle();
    }, 0);
}

// ─── native VoiceAgent wiring ────────────────────────────────────────────────
function initNativeVoiceAgent() {
    const factory = (typeof bro.createVoiceAgent === 'function')
        ? bro.createVoiceAgent
        : ((typeof bro.soundml !== 'undefined' && bro.soundml.VoiceAgent)
            ? (cfg) => new bro.soundml.VoiceAgent(cfg)
            : null);

    if (!factory) return;

    try {
        nativeVoiceAgent = factory({
            sampleRate: MIC_RATE,
            vadEnergyThreshold: SPEECH_THRESH,
            enableBargeIn: true,
        });

        nativeVoiceAgent.onSpeechStart(() => {
            if (recording && triggeredByWake) {
                speechMs = Math.max(speechMs, MIN_SPEECH_MS);
            }
        });

        nativeVoiceAgent.onSpeechEnd((samples) => {
            if (recording && triggeredByWake) {
                stopRecordingAndRun();
            }
        });

        nativeVoiceAgent.onBargeIn(() => {
            interruptTurn();
        });

        nativeVoiceAgent.onStateChanged((oldSt, newSt) => {
            if (newSt === 'listening' && !recording && wakeActive) {
                onWake();
            }
        });
    } catch (e) {
        console.warn('Native VoiceAgent init error:', e.message);
        nativeVoiceAgent = null;
    }
}

// ─── pipeline: STT -> streaming LLM -> per-sentence TTS ───────────────────────
function runPipeline(samples16k) {
    const myTurn = acceptTurn;
    const partialIds = [];
    sttHandle = bro.stt.transcribe(
        whisper, { samples: samples16k, sampleRate: MIC_RATE }, sttPrompt, {
            maxNewTokens: 128,
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
    if (myTurn !== acceptTurn) return;
    if (info && info.error) { pipelineError('stt', info.error); return; }

    let userText = '';
    try { userText = sttTok.decode(ids, true).trim(); } catch (_) {}
    stopLoadingIndicator();

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
const STREAM_MIN_WORDS = 6;
const STREAM_CHUNK_WORDS = 4;
const KOKORO_SR = 24000;
const QWEN_SR = 24000;
const QWEN_STREAM_FRAMES = 8;
const QWEN_PREBUFFER = 2;

function buildKokoroChunks(phonemeIds, wordCount) {
    if (wordCount < STREAM_MIN_WORDS) return null;
    const phonWords = [];
    let cur = [];
    for (const id of phonemeIds) {
        if (id === spaceId) { if (cur.length) { phonWords.push(cur); cur = []; } }
        else cur.push(id);
    }
    if (cur.length) phonWords.push(cur);
    if (phonWords.length !== wordCount) return null;

    const chunks = [], ranges = [];
    for (let i = 0; i < phonWords.length; i += STREAM_CHUNK_WORDS) {
        const end = Math.min(i + STREAM_CHUNK_WORDS, phonWords.length);
        const ids = [];
        for (let j = i; j < end; j++) {
            if (ids.length) ids.push(spaceId);
            for (const id of phonWords[j]) ids.push(id);
        }
        chunks.push(ids);
        ranges.push([i, end]);
    }
    return { chunks, ranges };
}

function enqueueSynth(myTurn, sentence, consumed) {
    if (!speechOn) return;
    synthQueue.push({ sentence, consumed, turn: myTurn, retries: 0 });
    pumpSynth();
}

function pumpSynth() {
    if (synthBusy || synthQueue.length === 0) return;
    const item = synthQueue.shift();
    if (item.turn !== acceptTurn) { pumpSynth(); return; }

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

function startSentenceSynth(item) {
    let phonemeIds = null;
    if (!useQwen) {
        phonemeIds = bro.tts.phonemize(item.sentence);
        if (!phonemeIds || phonemeIds.length === 0) { pumpSynth(); return; }
    }

    if (!presynthSent) {
        presynthSent = true;
        if (audioPlayer) audioPlayer.playPresynthCue();
        setStatus('thinking', 'responding…');
    }

    synthBusy = true;
    if (useQwen) { startQwenSynth(item); return; }
    startKokoroSynth(item, phonemeIds);
}

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
    const group = { els, fracs, receivedSec: 0, totalSec: 0 };
    const pending = [];
    let started = false;
    const flush = () => {
        started = true;
        for (const p of pending) if (audioPlayer) audioPlayer.enqueueAudio(p.samples, QWEN_SR, p.meta);
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
        if (started) { if (audioPlayer) audioPlayer.enqueueAudio(samples, QWEN_SR, meta); return; }
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
            if (!started) flush();
        }
        pumpSynth();
        maybeFinishSpeaking();
    };
    ttsHandle = bro.tts.synthesizeStream(qwen, item.sentence, opts);
}

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
                if (audioPlayer) audioPlayer.enqueueAudio(samples, KOKORO_SR, { els: els.slice(r[0], r[1]), words });
            },
            onDone: (_res, info) => {
                synthBusy = false;
                ttsHandle = null;
                if (item.turn === acceptTurn && info && info.error && !info.cancelled) {
                    pipelineError('voice', info.error);
                    return;
                }
                pumpSynth();
                maybeFinishSpeaking();
            },
        });
        return;
    }

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
                    if (audioPlayer) audioPlayer.enqueueAudio(res.samples, res.sampleRate, { els, words });
                }
            }
            pumpSynth();
            maybeFinishSpeaking();
        },
    });
}

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

function maybeFinishSpeaking() {
    if (!llmDone || synthBusy || synthQueue.length > 0 || (audioPlayer && audioPlayer.isBusy())) return;
    finishTurn();
}

function finishTurn() {
    const wasSpeaking = producedSpeech;
    turnBusy = false;
    llmDone = false;
    producedSpeech = false;
    setTimeout(() => goIdle(), wasSpeaking ? WAKE_TAIL_MS : 0);
}

function resetReplyState() {
    if (audioPlayer) audioPlayer.stopPlayback();
    synthQueue.length = 0;
}

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
    if (audioPlayer) audioPlayer.stopPlayback();
    synthQueue.length = 0;
    if (broPendingEl) broPendingEl.textContent = '';
}

// ─── wake & mic capture ──────────────────────────────────────────────────
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
        if (recording || !wakeActive || (audioPlayer && audioPlayer.isBusy()) || loadingAnim) return;
        let score = 0;
        try { score = bro.wake.lastScore() || 0; } catch (_) {}
        $meter.style.width = Math.min(100, score * 100) + '%';
        $meter.style.opacity = (0.25 + 0.75 * Math.min(1, score / 0.85)).toFixed(2);
    }, 100);
}

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
    if (nativeVoiceAgent) {
        try { nativeVoiceAgent.feed(c.samples); } catch (_) {}
    }

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

    if (audioPlayer) audioPlayer.playReceiptCue();
    setStatus('transcribing', 'transcribing…');
    startLoadingIndicator();

    turnSeq += 1;
    acceptTurn = turnSeq;
    turnBusy = true;
    wakeResume();

    runPipeline(samples16k);
}

function onWake() {
    if (recording || $talk.disabled) return;
    if (turnBusy) interruptTurn();
    if (audioPlayer) audioPlayer.playCueTone();
    try { ensureMic(); }
    catch (e) { setStatus('error', 'mic: ' + e.message); goIdle(); return; }
    startRecording(true);
}

function onTalkDown() {
    if ($talk.disabled || recording || !modelsReady) return;
    if (turnBusy) interruptTurn();
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

installSystemMenu();

// ─── boot ────────────────────────────────────────────────────────────────────
function boot() {
    try {
        audioCtx = new AudioContext();
        engineRate = audioCtx.sampleRate || 44100;
        audioPlayer = createAudioPlayer({
            audioCtx,
            engineRate,
            transcriptEl: $transcript,
            onPlaybackComplete: maybeFinishSpeaking,
        });
    } catch (e) {
        setStatus('error', 'audio init failed: ' + e.message);
        return;
    }

    const setupUI = initSetupScreen({
        $setup,
        $convo,
        $status,
        setStatus,
        onStart: (cfg) => {
            wakeEnabled = cfg.wake;
            qwenSpeaker  = cfg.speaker;
            qwenLanguage = cfg.language;
            qwenInstruct = cfg.description;
            useVoiceDesign = (cfg.backend === 'voicedesign');
            useQwen        = (cfg.backend === 'qwen' || cfg.backend === 'voicedesign');
            speechOn       = (cfg.backend !== 'text');

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

            setStatus('loading', 'loading models…');
            $meter.style.opacity = '0.6';
            loadModels();
        },
    });

    setupUI.showSetup();
}

requestAnimationFrame(() => requestAnimationFrame(boot));
