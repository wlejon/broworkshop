// engine.js — the two TTS engines: weight discovery, loading, voices.
//   Kokoro    82M phoneme pipeline. phonemize() -> synthesize(ids, voice) with
//             per-phoneme durations (word-accurate highlight) and a native
//             speaking-rate opt (speed baked into the PCM).
//   Qwen3-TTS 0.6B CustomVoice. Text in, preset speakers, no durations and no
//             rate param (speed rides the playback rate instead).
// Models load once (async, background thread) and stay resident.

import { weightPath } from "/lib/kit/weights.js";
import { gpuAvailable, deviceLabel } from "/lib/kit/ml.js";
import { settings } from "./state.js";

const fs = require('fs');
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };

export const engines = {
    kokoro: { model: null, voice: null, voiceName: '', voiceCache: {}, voices: [], status: 'idle', error: '', dir: '', loadMs: 0 },
    qwen:   { model: null, speakers: [], status: 'idle', error: '', dir: '', loadMs: 0 },
};
export const ENGINE_LABEL = { kokoro: 'Kokoro', qwen: 'Qwen3-TTS' };

const listeners = [];
export function onEngineChange(cb) { listeners.push(cb); }
function emit() { for (const cb of listeners) { try { cb(); } catch (e) {} } }

// ── weight discovery ─────────────────────────────────────────────────────────
// The brosoundml sibling repo (<root>/weights/...) or the published
// brosoundml-data layout (<root>/...). Settings can point anywhere else.

export function layoutOf(root) {
    if (!root) return null;
    if (exists(root + '/weights/kokoro/config.json') || exists(root + '/weights/qwen-tts')) return 'sibling';
    if (exists(root + '/kokoro/config.json') || exists(root + '/qwen-tts')) return 'data';
    return null;
}

export function detectRoot() {
    const cands = [settings.dataRoot, weightPath('brosoundml'), weightPath('brosoundml-data')].filter(Boolean);
    for (const c of cands) if (layoutOf(c)) return c;
    return settings.dataRoot || weightPath('brosoundml');
}

export function paths() {
    const root = detectRoot();
    const kind = layoutOf(root) || 'sibling';
    const w = kind === 'sibling' ? root + '/weights' : root;
    return { root, kind, kokoro: w + '/kokoro', qwen: w + '/qwen-tts/0.6B-customvoice' };
}

function configureAssets(p) {
    // Point the phonemizer at this source's g2p / POS / config assets.
    if (p.kind === 'sibling') bro.tts.setAssetRoot(p.root);
    else bro.tts.setAssets({
        lexicon: p.root + '/g2p/lexicon_en_us.bin',
        posTagger: p.root + '/pos_tagger/model.bin',
        kokoroConfig: p.root + '/kokoro/config.json',
    });
}

export function listKokoroVoices(dir) {
    try {
        return fs.readdirSync(dir + '/voices').filter((f) => /\.bin$/i.test(f)).map((f) => f.replace(/\.bin$/i, '')).sort();
    } catch (e) { return []; }
}

// ── load (async, once) ───────────────────────────────────────────────────────
// done(err) fires when this call's load resolves; concurrent callers queue.

const pendingDone = { kokoro: [], qwen: [] };

export function loadEngine(name, done) {
    const e = engines[name];
    if (!e) { if (done) done('unknown engine ' + name); return; }
    if (e.status === 'ready') { if (done) done(null); return; }
    if (done) pendingDone[name].push(done);
    if (e.status === 'loading') return;
    const finish = (err) => { for (const cb of pendingDone[name].splice(0)) { try { cb(err); } catch (ex) {} } };
    const fail = (msg) => { e.status = 'error'; e.error = String(msg); emit(); finish(e.error); };

    if (typeof bro === 'undefined' || !bro.tts || bro.tts.available === false) return fail('bro.tts is not in this build');
    if (!gpuAvailable()) return fail('no GPU backend (' + deviceLabel() + '); TTS inference needs a GPU');
    const p = paths();
    const dir = name === 'kokoro' ? p.kokoro : p.qwen;
    if (!exists(dir + '/config.json')) return fail(ENGINE_LABEL[name] + ' weights not found, expected ' + dir);

    e.status = 'loading'; e.error = ''; e.dir = dir;
    emit();
    const t0 = Date.now();   // wall clock: performance.now() is virtual in headless
    const ready = (fill) => (m) => {
        e.model = m;
        fill(m);
        e.loadMs = Date.now() - t0;
        e.status = 'ready';
        if (name === 'kokoro') setKokoroVoice(settings.kokoroVoice);
        emit(); finish(null);
    };
    try {
        if (name === 'kokoro') {
            configureAssets(p);
            bro.tts.loadKokoro(dir, { onReady: ready(() => { e.voices = listKokoroVoices(dir); }), onError: fail });
        } else {
            bro.tts.loadQwen(dir, {
                onReady: ready((q) => {
                    try { e.speakers = q.speakers() || []; } catch (ex) { e.speakers = []; }
                    if (!settings.qwenSpeaker && e.speakers.length) settings.qwenSpeaker = e.speakers[0];
                }),
                onError: fail,
            });
        }
    } catch (err) { fail(err.message); }
}

// Voice embeddings are tiny; keep every one loaded so far.
export function setKokoroVoice(name) {
    const e = engines.kokoro;
    if (!e.model) return false;
    if (!name || e.voices.indexOf(name) < 0) name = e.voices.indexOf('af_heart') >= 0 ? 'af_heart' : e.voices[0];
    if (!name) { e.error = 'no voices found in ' + e.dir + '/voices'; emit(); return false; }
    if (e.voiceName === name && e.voice) return true;
    try {
        if (!e.voiceCache[name]) e.voiceCache[name] = e.model.loadVoice(e.dir + '/voices/' + name + '.bin');
        e.voice = e.voiceCache[name];
        e.voiceName = name;
        emit();
        return true;
    } catch (err) { e.error = 'voice ' + name + ': ' + err.message; emit(); return false; }
}

/** One-line status for the header badge. */
export function statusText(name) {
    const e = engines[name];
    if (e.status === 'idle') return ENGINE_LABEL[name] + ' · not loaded';
    if (e.status === 'loading') return 'loading ' + ENGINE_LABEL[name] + '…';
    if (e.status === 'error') return e.error;
    const extra = name === 'kokoro' ? e.voices.length + ' voices' : e.speakers.length + ' speakers';
    return ENGINE_LABEL[name] + ' ready · ' + extra + ' · ' + (e.loadMs / 1000).toFixed(1) + 's load · ' + deviceLabel();
}
