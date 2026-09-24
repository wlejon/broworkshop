// Kokoro math with no node state: where the data lives, the voice-space
// basis (PCA coords <-> style vector, learned timbre and masc/fem
// directions, the x-vector bridge for cloning), and the prosody helpers
// (duration resampling, length regulation, the VAD emotion transform).
// Ported from kokoro-lab (source.js, designer.js, clone.js, edit.js).

import { findWeights } from "/lib/kit/weights.js";
import { kokoroDir } from "/lib/kit/kokoro.js";
import { exists, parentDir, trimSlash } from "../common.js";

const fs = require('fs');

// --- data source -------------------------------------------------------------------

/**
 * The default data root: the brosoundml-data sibling (kokoro/ with the
 * voice / emotion / masc-fem bases + g2p assets), else the brosoundml
 * weights dir, else ''.
 */
export function defaultDataRoot() {
    return findWeights(['brosoundml-data'], { probe: 'kokoro/config.json' }) || kokoroDir() || '';
}

/**
 * Work out what `root` is: a data root (root/kokoro), a brosoundml repo
 * (root/weights/kokoro), or a model dir itself. Returns { kind, root, model,
 * spkenc } (spkenc: the Qwen speaker encoder used for cloning), or null.
 */
export function detectSource(root) {
    root = trimSlash(root);
    if (exists(root + '/kokoro/config.json')) {
        return { kind: 'data', root, model: root + '/kokoro', spkenc: root + '/qwen-tts/speaker-encoder' };
    }
    if (exists(root + '/weights/kokoro/config.json')) {
        return { kind: 'sibling', root, model: root + '/weights/kokoro', spkenc: parentDir(root) + '/brosoundml-data/qwen-tts/speaker-encoder' };
    }
    if (exists(root + '/config.json')) {
        const parent = parentDir(root);
        if (exists(parent + '/g2p/lexicon_en_us.bin')) {
            return { kind: 'data', root: parent, model: root, spkenc: parent + '/qwen-tts/speaker-encoder' };
        }
        const repo = parentDir(parent);
        if (exists(repo + '/weights/kokoro/config.json')) {
            return { kind: 'sibling', root: repo, model: root, spkenc: parentDir(repo) + '/brosoundml-data/qwen-tts/speaker-encoder' };
        }
        return { kind: 'model', root, model: root, spkenc: parent + '/qwen-tts/speaker-encoder' };
    }
    return null;
}

export function resolvePaths(root) {
    return detectSource(root) || { kind: 'data', root: trimSlash(root), model: trimSlash(root) + '/kokoro', spkenc: trimSlash(root) + '/qwen-tts/speaker-encoder' };
}

/** Point bro.tts's phonemizer at the assets that go with `paths`. */
export function configureAssets(paths) {
    if (paths.kind === 'sibling') bro.tts.setAssetRoot(paths.root);
    else if (paths.kind === 'data') {
        bro.tts.setAssets({
            lexicon: paths.root + '/g2p/lexicon_en_us.bin',
            posTagger: paths.root + '/pos_tagger/model.bin',
            kokoroConfig: paths.root + '/kokoro/config.json',
        });
    } else bro.tts.setAssets({ kokoroConfig: paths.model + '/config.json' });
}

/** voice_bridge.bin: a linear map from a speaker x-vector to a Kokoro style vector. */
export function loadBridge(model) {
    try {
        const ab = fs.readFileSync(model + '/voice_bridge.bin');
        const buf = ab instanceof ArrayBuffer ? ab : ab.buffer;
        const iv = new Int32Array(buf, 0, 2), D = iv[0], M = iv[1];
        let off = 8;
        const xm = new Float32Array(buf, off, D); off += 4 * D;
        const ym = new Float32Array(buf, off, M); off += 4 * M;
        return { D, M, xm, ym, B: new Float32Array(buf, off, D * M) };
    } catch (e) { return null; }
}

// --- voice space -----------------------------------------------------------------------

export function styleFromCoords(basis, coords) {
    const { dim, k, mean, comps, std } = basis;
    const s = new Float32Array(dim);
    for (let d = 0; d < dim; d++) s[d] = mean[d];
    for (let i = 0; i < k; i++) {
        const c = (coords[i] || 0) * std[i];
        if (!c) continue;
        const v = comps[i];
        for (let d = 0; d < dim; d++) s[d] += c * v[d];
    }
    return s;
}

export function coordsFromStyle(basis, style) {
    const { dim, k, mean, comps, std } = basis;
    const c = new Float64Array(k);
    for (let i = 0; i < k; i++) {
        let s = 0;
        for (let d = 0; d < dim; d++) s += (style[d] - mean[d]) * comps[i][d];
        c[i] = s / (std[i] || 1);
    }
    return c;
}

/** style += sum_e alpha_e * direction_e over a learned-direction basis. */
export function addDirections(style, basis, alphas) {
    if (!basis || !basis.full) return;
    for (const e of basis.emotions) {
        const a = alphas[e] || 0, r = basis.full[e];
        if (!a || !r) continue;
        for (let d = 0; d < style.length; d++) style[d] += a * r[d];
    }
}

export function addMascFem(style, basis, alpha) {
    if (!basis || !alpha) return;
    const f = basis.full.M;
    for (let d = 0; d < style.length; d++) style[d] += alpha * f[d];
}

export function bridgeApply(bridge, x) {
    const { D, M, xm, ym, B } = bridge;
    const s = new Float64Array(M);
    for (let m = 0; m < M; m++) s[m] = ym[m];
    for (let j = 0; j < D; j++) {
        const xc = x[j] - xm[j];
        if (!xc) continue;
        for (let m = 0; m < M; m++) s[m] += xc * B[j * M + m];
    }
    return s;
}

// --- prosody -----------------------------------------------------------------------------

/** Resample per-phoneme contours (2 samples per frame) from srcDur spans to dstDur spans. */
export function resampleByDur(src, srcDur, dstDur) {
    let total = 0;
    for (const d of dstDur) total += d;
    const dst = new Float32Array(2 * total);
    let sOff = 0, dOff = 0;
    for (let l = 0; l < srcDur.length; l++) {
        const sLen = 2 * srcDur[l], dLen = 2 * dstDur[l], s0 = 2 * sOff, d0 = 2 * dOff;
        for (let k = 0; k < dLen; k++) {
            if (sLen === 0) { dst[d0 + k] = 0; continue; }
            const sp = dLen <= 1 ? 0 : (k / (dLen - 1)) * (sLen - 1);
            const i0 = Math.floor(sp), i1 = Math.min(sLen - 1, i0 + 1), f = sp - i0;
            dst[d0 + k] = src[s0 + i0] * (1 - f) + src[s0 + i1] * f;
        }
        sOff += srcDur[l]; dOff += dstDur[l];
    }
    return dst;
}

/** Repeat each phoneme's text-encoder column durations[l] times: { asrP, totalP }. */
export function lengthRegulate(ten, H, L, durations) {
    const totalP = durations.reduce((a, b) => a + b, 0);
    const asrP = new Float32Array(H * totalP);
    let t = 0;
    for (let l = 0; l < L; l++) {
        for (let r = 0; r < (durations[l] | 0); r++, t++) {
            for (let c = 0; c < H; c++) asrP[c * totalP + t] = ten[c * L + l];
        }
    }
    return { asrP, totalP };
}

const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Valence / arousal / dominance -> pitch, range, energy and rate changes (Tier 0). */
export const EMO_FN = {
    pitchSemis: (v, a, d) => 2.5 * a + 1.0 * v - 1.5 * d,
    rangeScale: (v, a, d) => clampf(1 + 0.45 * a + 0.20 * v - 0.15 * d, 0.5, 1.8),
    energyScale: (v, a, d) => clampf(1 + 0.35 * a + 0.20 * d, 0.5, 1.7),
    rateScale: (v, a, d) => clampf(1 + 0.30 * a - 0.12 * d, 0.6, 1.7),
};

export function emotionActive(emo) { return emo.v !== 0 || emo.a !== 0 || emo.d !== 0; }

/** Apply a VAD emotion to predicted F0 / energy contours. */
export function emoTransformContours(F0src, Nsrc, emo) {
    const shift = Math.pow(2, EMO_FN.pitchSemis(emo.v, emo.a, emo.d) / 12);
    const rng = EMO_FN.rangeScale(emo.v, emo.a, emo.d);
    const eScale = EMO_FN.energyScale(emo.v, emo.a, emo.d);
    let sumLog = 0, nv = 0;
    for (let i = 0; i < F0src.length; i++) if (F0src[i] > 1e-3) { sumLog += Math.log(F0src[i]); nv++; }
    const meanLog = nv ? sumLog / nv : 0;
    const F0 = new Float32Array(F0src.length);
    for (let i = 0; i < F0src.length; i++) {
        const f = F0src[i];
        F0[i] = f <= 1e-3 ? f : clampf(Math.exp(meanLog + (Math.log(f) - meanLog) * rng) * shift, 0, 1000);
    }
    const N = new Float32Array(Nsrc.length);
    for (let i = 0; i < Nsrc.length; i++) N[i] = Math.max(0, Nsrc[i] * eScale);
    return { F0, N };
}
