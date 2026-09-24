// The real models behind pipeline.js's engine interface: Whisper (bro.stt)
// with streamed partials, Qwen3-8B (bro.lm) over the chat history, and the
// chosen voice (Kokoro or Qwen3-TTS, speech.js). All load concurrently
// through the async inference API.
//
//   loadEngines({ backend, speaker, language, description }, resolved(), {
//       onProgress(done, total), onReady(engines), onError(stage, msg) });
//
// backend: 'text' | 'kokoro' | 'qwen' | 'voicedesign'.

import { kokoroVoice, qwenVoice } from "/app/speech.js";

const MIC_RATE = 16000;

function sttEngine(whisper, tok) {
    let prompt = null;
    try { prompt = tok.buildPrompt('en', 'transcribe', false); } catch (_) {}
    const decode = (ids) => { try { return tok.decode(ids, true).trim(); } catch (_) { return ''; } };
    return {
        transcribe(samples, cb) {
            const ids = [];
            return bro.stt.transcribe(whisper, { samples, sampleRate: MIC_RATE }, prompt, {
                maxNewTokens: 128,
                onToken: (id) => { ids.push(id); cb.onPartial(decode(ids)); },
                onDone: (out, info) => cb.onDone(decode(out), info && info.error),
            });
        },
    };
}

function lmEngine(model, tok) {
    return {
        generate(history, cb) {
            const promptIds = tok.encode(tok.applyChatTemplate(history, true));
            const out = [];
            return bro.lm.generate(model, promptIds, {
                maxNewTokens: 80,
                eosId: tok.imEndId,
                sampling: { temperature: 0.7, topK: 40, topP: 0.95, seed: (promptIds.length * 2654435761) & 0x7fffffff },
                onToken: (id) => { out.push(id); let t; try { t = tok.decode(out); } catch (_) { return; } cb.onText(t); },
                onDone: (_ids, info) => cb.onDone(info && info.error),
            });
        },
    };
}

export function loadEngines(cfg, paths, { onProgress, onReady, onError }) {
    const speech = cfg.backend !== 'text';
    const qwenTts = cfg.backend === 'qwen' || cfg.backend === 'voicedesign';
    const parts = {};
    const units = speech ? 4 : 3;
    let pending = units, failed = false;

    const fail = (stage, msg) => { if (!failed) { failed = true; onError(stage, msg); } };
    const ready = () => {
        if (onProgress) onProgress(units - pending + 1, units);
        if (--pending || failed) return;
        let voice = null;
        if (qwenTts) {
            voice = qwenVoice(parts.qwen, cfg.backend === 'voicedesign'
                ? { instruct: cfg.description, language: cfg.language }
                : { speaker: cfg.speaker, language: cfg.language });
        } else if (speech) {
            voice = kokoroVoice(parts.kokoro, parts.pack, parts.spaceId);
            // First phonemize loads the lexicon; do it now, not mid-reply.
            try { bro.tts.phonemize('warming up the lexicon'); }
            catch (e) { console.warn('phonemizer unavailable, replies are text-only: ' + e.message); voice = null; }
        }
        onReady({ stt: sttEngine(parts.whisper, parts.sttTok), lm: lmEngine(parts.lm, parts.lmTok), voice });
    };

    try {
        bro.lm.loadQwen(paths.qwen, {
            onReady: (r) => { parts.lm = r.model; parts.lmTok = r.tokenizer; ready(); },
            onError: (m) => fail('language model', m),
        });
        bro.stt.loadWhisper(paths.whisperDir, {
            onReady: (w) => { parts.whisper = w; ready(); },
            onError: (m) => fail('speech recognition', m),
        });
        const tokOpts = {
            vocabPath: paths.whisperVocab, mergesPath: paths.whisperMerges,
            onReady: (t) => { parts.sttTok = t; ready(); },
            onError: (m) => fail('speech tokenizer', m),
        };
        if (paths.whisperAdded) tokOpts.addedTokensPath = paths.whisperAdded;
        bro.stt.loadTokenizer(tokOpts);

        if (qwenTts) {
            bro.tts.loadQwen(cfg.backend === 'voicedesign' ? paths.qwenVdDir : paths.qwenTtsDir, {
                onReady: (q) => { parts.qwen = q; ready(); },
                onError: (m) => fail('speech model', m),
            });
        } else if (speech) {
            bro.tts.setAssets({ lexicon: paths.lexicon, posTagger: paths.posTagger, kokoroConfig: paths.kokoroConfig });
            bro.tts.loadKokoro(paths.kokoroDir, {
                onReady: (k) => {
                    parts.kokoro = k;
                    parts.spaceId = 16;
                    try { const v = k.vocab(); if (typeof v[' '] === 'number') parts.spaceId = v[' ']; } catch (_) {}
                    k.loadVoice(paths.kokoroVoice, {
                        onReady: (pack) => { parts.pack = pack; ready(); },
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
