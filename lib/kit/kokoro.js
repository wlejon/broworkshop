// lib/kit/kokoro.js — find and load Kokoro-82M (bro.tts) without hardcoded paths.
//
//   import { loadKokoro, kokoroVoicePath } from "/lib/kit/kokoro.js";
//   const dir = loadKokoro({
//       onReady: (kokoro) => { const v = kokoro.loadVoice(kokoroVoicePath(dir, 'af_heart')); ... },
//       onError: (msg) => status.warn(msg),
//   });
//   if (!dir) ...   // no weights / no bro.tts: onError already fired
//
// Weights resolve through kit weights.js ('brosoundml/weights/kokoro',
// BRO_WEIGHTS aware). The English G2P assets (lexicon + POS tagger) come from
// the brosoundml-data sibling when it is there, else the brosoundml repo root
// holding the weights.

import { findWeights, missingWeights, weightPath } from "/lib/kit/weights.js";

const fs = require('fs');
const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };

export const KOKORO_CANDIDATES = ['brosoundml/weights/kokoro'];

/** Absolute Kokoro weights dir (holds config.json + voices/), or null. */
export function kokoroDir() {
    return findWeights(KOKORO_CANDIDATES, { probe: 'config.json' });
}

/** Path of a voice pack (`af_heart`, `am_adam`, ...) inside a Kokoro dir. */
export function kokoroVoicePath(dir, name) {
    return dir + '/voices/' + name + '.bin';
}

/** Point bro.tts.phonemize at the G2P assets that go with the weights in `dir`. */
export function useKokoroAssets(dir) {
    const data = weightPath('brosoundml-data');
    if (exists(data + '/g2p/lexicon_en_us.bin')) {
        bro.tts.setAssets({
            lexicon: data + '/g2p/lexicon_en_us.bin',
            posTagger: data + '/pos_tagger/model.bin',
            kokoroConfig: dir + '/config.json',
        });
    } else {
        bro.tts.setAssetRoot(dir.replace(/\/weights\/kokoro\/?$/, ''));
    }
}

/**
 * Start loading Kokoro in the background. opts: { onReady(kokoro), onError(msg) }.
 * Returns the weights dir, or null (after calling onError) when bro.tts or
 * the weights are missing.
 */
export function loadKokoro(opts) {
    const o = opts || {};
    const fail = (msg) => { if (o.onError) o.onError(msg); return null; };
    if (typeof bro === 'undefined' || !bro.tts || typeof bro.tts.loadKokoro !== 'function') {
        return fail('bro.tts unavailable');
    }
    const dir = kokoroDir();
    if (!dir) return fail(missingWeights('Kokoro', KOKORO_CANDIDATES));
    try { useKokoroAssets(dir); } catch (e) { /* phonemize() reports a real problem per line */ }
    try {
        bro.tts.loadKokoro(dir, {
            onReady: (k) => { if (o.onReady) o.onReady(k); },
            onError: (m) => fail('Kokoro load failed: ' + m),
        });
    } catch (e) {
        return fail('Kokoro load threw: ' + (e && e.message || e));
    }
    return dir;
}
