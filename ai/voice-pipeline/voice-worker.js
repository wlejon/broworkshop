// Voice pipeline inference worker.
//
// Owns the three heavy models — Whisper (STT), Qwen3 (LLM), Kokoro (TTS) — so
// every multi-GB load and every blocking forward runs on this thread, leaving
// the main thread free to render, capture the mic, run the wake word, and play
// audio. This is the diffusion-lab pattern (demos/diffusion-lab).
//
// Protocol:
//   main -> load                         -> progress {stage} ... -> ready
//   main -> transcribe {samples,         -> user {text}
//           sampleRate}                     token {delta}            (per LM token)
//                                           speech {text, samples,   (per sentence)
//                                                   sampleRate, words}
//                                           done
//   errors come back as                  -> error {stage, message}
//
// samples in `speech` are transferred zero-copy. Word timings are derived from
// Kokoro's per-phoneme durations (bro.tts synthesize().durations) split on the
// inter-word separator token, so highlights line up with the actual audio.

'use strict';

// ── model handles ───────────────────────────────────────────────────────────
let whisper = null, sttTok = null, sttPrompt = null;
let lm = null, lmTok = null;
let kokoro = null, voice = null, spaceId = 16;

// Conversation memory (mirrors the previous in-app system prompt).
const history = [
    { role: 'system', content:
        'You are speaking out loud through a text-to-speech system. Reply in 1-2 short ' +
        'conversational sentences. Use contractions. Never use markdown, bullet lists, ' +
        'code blocks, or symbols that do not sound natural when read aloud. Sound like a ' +
        'friend, not a chatbot. /no_think' },
];

function fail(stage, err) {
    self.postMessage({
        type: 'error',
        stage,
        message: (err && err.message) ? err.message : String(err),
    });
}

// ── load: bring up all three models, reporting progress ──────────────────────
function doLoad() {
    try {
        self.postMessage({ type: 'progress', stage: 'whisper' });
        whisper = bro.stt.loadWhisper('../brosoundml/weights/whisper');
        sttTok = bro.stt.loadTokenizer({
            vocabPath:  '../brosoundml/weights/whisper/vocab.json',
            mergesPath: '../brosoundml/weights/whisper/merges.txt',
        });
        sttPrompt = sttTok.buildPrompt('en', 'transcribe', false);

        self.postMessage({ type: 'progress', stage: 'qwen' });
        const r = bro.lm.loadQwen('../brolm/weights/Qwen3-8B-GGUF/Qwen3-8B-Q8_0.gguf');
        lm = r.model;
        lmTok = r.tokenizer;

        self.postMessage({ type: 'progress', stage: 'kokoro' });
        bro.tts.setAssetRoot('../brosoundml');
        kokoro = bro.tts.loadKokoro('../brosoundml/weights/kokoro');
        voice  = kokoro.loadVoice('../brosoundml/weights/kokoro/voices/af_heart.bin');
        try {
            const v = kokoro.vocab();
            if (typeof v[' '] === 'number') spaceId = v[' '];
        } catch (_) {}

        self.postMessage({ type: 'ready' });
    } catch (e) {
        fail('load', e);
    }
}

// ── text cleanup ─────────────────────────────────────────────────────────────
// Strip <think> blocks and control tokens. Not trimmed (keeps offsets stable);
// callers left-trim once content begins. Once the think block closes, the
// cleaned string only grows by appended content, so character offsets into it
// are monotonic.
function clean(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/g, '')
        .replace(/<\|.*?\|>/g, '')
        .replace(/^\s+/, '');
}

// Extract the next complete sentence from `text` starting at `fromLen`.
// A sentence ends at . ! ? or a newline. Returns null when only a partial
// sentence remains. `length` is the raw consumed length (untrimmed) so the
// caller can advance its offset into the cleaned text exactly.
function nextSentence(text, fromLen) {
    const m = text.slice(fromLen).match(/^[\s\S]*?[.!?\n]+/);
    if (!m) return null;
    return { sentence: m[0].trim(), length: m[0].length };
}

// ── word timing from per-phoneme durations ───────────────────────────────────
// durations is indexed over Kokoro's BOS/EOS-wrapped tokens: durations[0] is
// the BOS frame count, durations[i+1] corresponds to phonemeIds[i], and the
// last entry is EOS. Words are separated by the space token (spaceId); the
// space's frames belong to the inter-word gap, not to either word.
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

// Synthesize one sentence and post it (audio + word timings) to the main
// thread. `consumed` is the offset into the cleaned reply text up to and
// including this sentence, so the main thread can split finalized (spoken)
// text from the still-streaming tail.
function speak(sentence, consumed) {
    const phonemeIds = bro.tts.phonemize(sentence);
    if (!phonemeIds || phonemeIds.length === 0) return;
    const out = kokoro.synthesize(phonemeIds, voice, { speed: 1.0 });
    const words = computeWords(sentence, phonemeIds, out.durations,
                               out.samples.length, out.sampleRate);
    self.postMessage({
        type: 'speech',
        text: sentence,
        samples: out.samples,
        sampleRate: out.sampleRate,
        words,
        consumed,
    }, [out.samples.buffer]);
}

// ── full pipeline: STT -> streaming LLM -> per-sentence TTS ───────────────────
function runPipeline(samples16k, sampleRate) {
    // STT.
    let userText = '';
    try {
        const ids = whisper.transcribe(
            { samples: samples16k, sampleRate: sampleRate || 16000 },
            sttPrompt, { maxNewTokens: 128 });
        userText = sttTok.decode(ids, true).trim();
    } catch (e) { fail('stt', e); return; }

    self.postMessage({ type: 'user', text: userText });
    if (!userText) { self.postMessage({ type: 'done' }); return; }
    history.push({ role: 'user', content: userText });

    // LLM (streaming) + TTS (per sentence). The onToken callback runs inside
    // the native decode loop; emitting deltas and synthesizing completed
    // sentences here pipelines audio so speech starts on sentence 1 while
    // later sentences are still being generated.
    let emittedLen = 0;   // chars of cleaned text already sent as token deltas
    let spokenLen = 0;    // chars already handed to TTS
    const streamed = [];
    let assistantText = '';

    try {
        const prompt = lmTok.applyChatTemplate(history, true);
        const promptIds = lmTok.encode(prompt);
        lm.allocateCache(promptIds.length + 96);

        lm.generateStream(promptIds, {
            maxNewTokens: 80,
            eosId: lmTok.imEndId,
            sampling: { temperature: 0.7, topK: 40, topP: 0.95,
                        seed: (promptIds.length * 2654435761) & 0x7fffffff },
        }, (id) => {
            streamed.push(id);
            const cleaned = clean(lmTok.decode(streamed));
            assistantText = cleaned;

            const delta = cleaned.slice(emittedLen);
            if (delta) {
                self.postMessage({ type: 'token', delta });
                emittedLen = cleaned.length;
            }

            // Speak each newly-completed sentence; report the cleaned-text
            // offset so the main thread knows how much is finalized.
            let s;
            while ((s = nextSentence(cleaned, spokenLen)) !== null) {
                spokenLen += s.length;
                if (s.sentence) speak(s.sentence, spokenLen);
            }
            return true;
        });

        // Flush any trailing partial sentence.
        const tail = assistantText.slice(spokenLen).trim();
        if (tail) speak(tail, assistantText.length);

        if (assistantText.trim()) {
            history.push({ role: 'assistant', content: assistantText.trim() });
        }
    } catch (e) { fail('llm', e); return; }

    self.postMessage({ type: 'done' });
}

self.onmessage = (e) => {
    const msg = e.data || {};
    switch (msg.type) {
        case 'load':       doLoad(); break;
        case 'transcribe': runPipeline(msg.samples, msg.sampleRate); break;
        default: fail('dispatch', new Error('unknown message: ' + msg.type));
    }
};
