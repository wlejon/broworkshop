// tts.js — one sentence through either engine on the async synthesis path.
// Playback prefetch, the voice preview and the WAV export all synthesize
// through synth(); each model runs one op at a time, so callers keep at most
// one handle in flight (player.js owns that gate).

import { engines } from "./engine.js";

/**
 * Synthesize `text` with engine `name`. opts: { speed, voice, speaker,
 * timings, onDone(result, info, wordTimings) }. Kokoro takes speed natively
 * (baked into the PCM); Qwen ignores it (callers apply it as playback rate).
 * Returns the cancel handle, or null when the text has nothing to say
 * (Kokoro phonemized it to nothing); onDone is not called then.
 * Throws when the engine rejects the call.
 */
export function synth(name, text, opts) {
    const e = engines[name];
    if (name === 'kokoro') {
        const ids = bro.tts.phonemize(text);
        if (!ids || !ids.length) return null;
        return bro.tts.synthesize(e.model, ids, opts.voice || e.voice, {
            speed: opts.speed || 1,
            onDone: (r, info) => {
                let tm = null;
                if (opts.timings && !info.cancelled && !info.error) { try { tm = kokoroWordTimings(text, ids, r); } catch (ex) {} }
                opts.onDone(r, info, tm);
            },
        });
    }
    return bro.tts.synthesize(e.model, text, {
        speaker: opts.speaker, language: 'english',
        onDone: (r, info) => opts.onDone(r, info, null),
    });
}

/**
 * Word timing from Kokoro durations: per-phoneme frame counts, wrapped
 * BOS + ids + EOS. Output samples are a fixed multiple of the summed frames;
 * words are the id runs between space tokens. Returns [{ s, e }] seconds per
 * whitespace word of `text` (mapped proportionally when the model's word
 * count disagrees with the text's), or null.
 */
export function kokoroWordTimings(text, ids, r) {
    let space = -1;
    try { space = engines.kokoro.model.vocab()[' ']; } catch (e) { return null; }
    const dur = r.durations;
    if (!dur || dur.length !== ids.length + 2) return null;
    let total = 0;
    for (let k = 0; k < dur.length; k++) total += dur[k];
    if (!total) return null;
    const spf = r.samples.length / total / r.sampleRate;   // seconds per frame
    const groups = [];
    let f = dur[0], g = null;                              // skip BOS frames
    for (let k = 0; k < ids.length; k++) {
        const frames = dur[k + 1];
        if (ids[k] === space) g = null;
        else {
            if (!g) { g = { s: f * spf, e: 0 }; groups.push(g); }
            g.e = (f + frames) * spf;
        }
        f += frames;
    }
    return mapWordTimings(groups, text.split(/\s+/).filter(Boolean).length);
}

/** Spread `groups` ([{s, e}] from the model) over `nWords` text words. */
export function mapWordTimings(groups, nWords) {
    if (!groups.length || !nWords) return null;
    const t = new Array(nWords).fill(null);
    for (let gi = 0; gi < groups.length; gi++) {
        const wi = Math.min(nWords - 1, Math.floor(gi * nWords / groups.length));
        if (!t[wi]) t[wi] = { s: groups[gi].s, e: groups[gi].e };
        else t[wi].e = groups[gi].e;
    }
    for (let wi = 0; wi < nWords; wi++) {
        if (!t[wi]) t[wi] = t[wi - 1] ? { s: t[wi - 1].e, e: t[wi - 1].e } : { s: 0, e: 0 };
    }
    return t;
}
