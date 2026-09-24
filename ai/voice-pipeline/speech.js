// Speech helpers: reply text cleanup, sentence splitting, stop phrases, word
// timing, and the two streaming TTS voices (Kokoro, Qwen3-TTS).
//
// A voice is { rate, speak(sentence, sink) -> handle | null }. speak() drives
// one sentence through bro.tts and reports into `sink`:
//   sink.finalize(textWords) -> word elements (the sentence becomes "spoken" text)
//   sink.audio(samples, rate, meta)   meta = { els, words } (exact word timings)
//                                     or { group, offsetSec } (estimated, Qwen)
//   sink.alive() -> false once the turn was interrupted (drop late chunks)
//   sink.done(err?)                   the sentence finished (or failed)
// It returns null (after calling done) when there is nothing to say.

export const STOP_WORDS = new Set([
    'stop', 'stop it', 'stop talking', 'stop please', 'please stop',
    'cancel', 'never mind', 'nevermind', 'forget it', 'be quiet', 'quiet',
    'shut up', 'shush', 'enough', "that's enough", 'thats enough',
]);

/** True when an utterance is a stop phrase ("stop", "never mind", ...). */
export function isStopPhrase(text) {
    const norm = String(text || '').toLowerCase().replace(/[^a-z' ]+/g, '').replace(/\s+/g, ' ').trim();
    return STOP_WORDS.has(norm);
}

/** Strip Qwen3 <think> blocks (closed or still open) and special tokens from streamed LM text. */
export function clean(raw) {
    return raw
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/g, '')
        .replace(/<\|.*?\|>/g, '')
        .replace(/^\s+/, '');
}

/** The next complete sentence in text[fromLen..]: { sentence, length } or null. */
export function nextSentence(text, fromLen) {
    const m = text.slice(fromLen).match(/^[\s\S]*?[.!?\n]+/);
    return m ? { sentence: m[0].trim(), length: m[0].length } : null;
}

export const words = (sentence) => sentence.split(/\s+/).filter(Boolean);

/** Word timings spread over totalSec by character count (the fallback). */
export function splitWordsByChars(textWords, totalSec) {
    const total = textWords.reduce((n, w) => n + w.length, 0) || 1;
    let acc = 0;
    return textWords.map((w) => {
        const dur = totalSec * (w.length / total);
        const out = { text: w, startSec: acc, endSec: acc + dur };
        acc += dur;
        return out;
    });
}

/**
 * Word timings from Kokoro's per-phoneme frame durations (BOS/EOS-wrapped:
 * durations[0] is BOS, durations[i + 1] belongs to phonemeIds[i]). Words are
 * the phoneme runs between `spaceId`s; falls back to character spreading when
 * the counts disagree.
 */
export function computeWords(sentence, phonemeIds, durations, sampleCount, sampleRate, spaceId) {
    const textWords = words(sentence);
    if (!durations || !durations.length) return splitWordsByChars(textWords, sampleCount / sampleRate);
    let frameSum = 0;
    for (let i = 0; i < durations.length; i++) frameSum += durations[i];
    const secPerFrame = frameSum > 0 ? sampleCount / frameSum / sampleRate : 0;

    const groups = [];
    let cursor = durations[0], start = cursor, inWord = false;
    for (let i = 0; i < phonemeIds.length; i++) {
        const d = durations[i + 1] || 0;
        if (phonemeIds[i] === spaceId) {
            if (inWord) { groups.push([start, cursor]); inWord = false; }
            cursor += d;
        } else {
            if (!inWord) { start = cursor; inWord = true; }
            cursor += d;
        }
    }
    if (inWord) groups.push([start, cursor]);
    if (!groups.length || groups.length !== textWords.length) return splitWordsByChars(textWords, frameSum * secPerFrame);
    return groups.map(([a, b], i) => ({ text: textWords[i], startSec: a * secPerFrame, endSec: b * secPerFrame }));
}

export const STREAM_MIN_WORDS = 6;     // shorter sentences synthesize in one piece
export const STREAM_CHUNK_WORDS = 4;

/**
 * Split a sentence's phonemes into STREAM_CHUNK_WORDS-word chunks so the
 * first words play while the rest synthesize. Returns { chunks, ranges }
 * (ranges = [firstWord, endWord) per chunk) or null when the sentence is short
 * or the phoneme words do not line up with the text words.
 */
export function buildKokoroChunks(phonemeIds, wordCount, spaceId) {
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

const KOKORO_SR = 24000;

/** Kokoro through bro.tts: chunked streaming for long sentences, one shot for short ones. */
export function kokoroVoice(kokoro, pack, spaceId) {
    return {
        rate: KOKORO_SR,
        speak(sentence, sink) {
            const phonemeIds = bro.tts.phonemize(sentence);
            if (!phonemeIds || !phonemeIds.length) { sink.done(); return null; }
            const textWords = words(sentence);
            const plan = buildKokoroChunks(phonemeIds, textWords.length, spaceId);
            if (plan) {
                const els = sink.finalize(textWords);
                let ci = 0;
                return bro.tts.synthesizeStream(kokoro, plan.chunks, pack, {
                    speed: 1.0,
                    onChunk: (samples, durations) => {
                        if (!sink.alive() || !samples || !samples.length) return;
                        const idx = ci++, r = plan.ranges[idx] || [0, 0];
                        const w = computeWords(textWords.slice(r[0], r[1]).join(' '), plan.chunks[idx], durations,
                                               samples.length, KOKORO_SR, spaceId);
                        sink.audio(samples, KOKORO_SR, { els: els.slice(r[0], r[1]), words: w });
                    },
                    onDone: (_res, info) => sink.done(info && !info.cancelled ? info.error : null),
                });
            }
            return bro.tts.synthesize(kokoro, phonemeIds, pack, {
                speed: 1.0,
                onDone: (res, info) => {
                    if (info && info.cancelled) { sink.done(); return; }
                    if (info && info.error) { sink.done(info.error); return; }
                    if (sink.alive() && res && res.samples && res.samples.length) {
                        const w = computeWords(sentence, phonemeIds, res.durations, res.samples.length, res.sampleRate, spaceId);
                        const els = sink.finalize(w.map((x) => x.text));
                        sink.audio(res.samples, res.sampleRate, { els, words: w });
                    }
                    sink.done();
                },
            });
        },
    };
}

const QWEN_SR = 24000;
const QWEN_STREAM_FRAMES = 8;
const QWEN_PREBUFFER = 2;          // chunks held back before playback starts (absorbs decode jitter)

/**
 * Qwen3-TTS through bro.tts.synthesizeStream. opts: { speaker, language } for
 * CustomVoice, or { instruct, language } for VoiceDesign. Word timings are
 * estimated by character share of the (still growing) sentence duration.
 */
export function qwenVoice(qwen, opts) {
    return {
        rate: QWEN_SR,
        speak(sentence, sink) {
            const textWords = words(sentence);
            const els = sink.finalize(textWords);
            const total = textWords.reduce((n, w) => n + w.length, 0) || 1;
            let acc = 0;
            const fracs = textWords.map((w) => { const f = { start: acc / total, end: (acc + w.length) / total }; acc += w.length; return f; });
            const group = { els, fracs, receivedSec: 0, totalSec: 0 };
            const pending = [];
            let started = false;
            const flush = () => { started = true; for (const p of pending) sink.audio(p.samples, QWEN_SR, p.meta); pending.length = 0; };
            const o = Object.assign({}, opts, {
                chunkFrames: QWEN_STREAM_FRAMES,
                onChunk: (samples) => {
                    if (!sink.alive() || !samples || !samples.length) return;
                    const meta = { group, offsetSec: group.receivedSec };
                    group.receivedSec += samples.length / QWEN_SR;
                    if (started) { sink.audio(samples, QWEN_SR, meta); return; }
                    pending.push({ samples, meta });
                    if (pending.length >= QWEN_PREBUFFER) flush();
                },
                onDone: (res, info) => {
                    if (info && info.cancelled) { sink.done(); return; }
                    if (info && info.error) { sink.done(info.error); return; }
                    group.totalSec = res && res.samples && res.samples.length ? res.samples.length / QWEN_SR : group.receivedSec;
                    if (!started && sink.alive()) flush();
                    sink.done();
                },
            });
            return bro.tts.synthesizeStream(qwen, sentence, o);
        },
    };
}
