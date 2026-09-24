// Qwen3-TTS voice state with no DOM: checkpoint loading and variant
// detection, the x-vector basis math (designed voice, learned emotion and
// masc/fem directions), and the synthesize() options a card's params map to.
// Ported from qwen-tts-lab (designer.js, emotion.js, mascfem.js, synth.js).

import { findWeights } from "/lib/kit/weights.js";
import { exists, parentDir, readJSON, trimSlash } from "../common.js";

export const QWEN_CANDIDATES = ['brosoundml/weights/qwen-tts/0.6B-customvoice'];

/** The default checkpoint (CustomVoice 0.6B), or ''. */
export function defaultModelDir() {
    return findWeights(QWEN_CANDIDATES, { probe: 'config.json' }) || '';
}

/** Quick-switch chips: variant id -> sibling checkpoint dir name. */
export const VARIANT_DIRS = { cv: '0.6B-customvoice', vd: '1.7B-voicedesign', base: '0.6B-Base' };

export const INSTRUCT_PRESETS = [
    'a warm, low-pitched elderly storyteller',
    'a bright, energetic young woman, fast and upbeat',
    'a calm late-night radio host, deep and smooth',
    'a crisp British newsreader, measured and clear',
    'a breathy, soft-spoken whisper',
    'an excited sports announcer at full tilt',
];
export const INSTRUCT_GROUPS = [
    { name: 'character', kind: 'noun', tags: ['young woman', 'young man', 'elderly storyteller', 'narrator', 'radio host', 'newsreader', 'sports announcer', 'child'] },
    { name: 'tone', kind: 'adj', tags: ['warm', 'bright', 'dark', 'breathy', 'smooth', 'gravelly', 'nasal', 'husky'] },
    { name: 'pitch', kind: 'adj', tags: ['low-pitched', 'high-pitched', 'deep'] },
    { name: 'pace', kind: 'adj', tags: ['fast', 'measured', 'slow'] },
    { name: 'mood', kind: 'adj', tags: ['cheerful', 'calm', 'excited', 'somber', 'gentle', 'tense'] },
];
export const STEER_DEFAULT = -3;
export const GREEDY = { temperature: 0, topK: 0, topP: 1, adaptive: 0 };

export function seedDefaults(p) {
    if (p.modelDir === undefined) p.modelDir = defaultModelDir();
    if (p.text === undefined) p.text = 'Hello there. This is a test of the pipeline.';
    if (p.speaker === undefined) p.speaker = '';
    if (p.language === undefined) p.language = 'english';
    if (p.instruct === undefined) p.instruct = INSTRUCT_PRESETS[0];
    if (p.coords === undefined) p.coords = [];
    if (p.cvSource === undefined) p.cvSource = 'preset';
    if (p.refWav === undefined) p.refWav = '';
    if (p.emoAlpha === undefined) p.emoAlpha = {};
    if (p.mfAlpha === undefined) p.mfAlpha = 0;
    if (p.steer === undefined) p.steer = {};
    if (p.sampling === undefined) p.sampling = { temperature: 0, topK: 0, topP: 1, seed: 0, repetitionPenalty: 1.05, adaptive: 0, seedLocked: false };
    if (p.autoplay === undefined) p.autoplay = true;
}

// A basis json sits beside the Base checkpoint; CustomVoice / VoiceDesign
// dirs find it through the sibling 0.6B-Base or the shared parent.
function readBasisJson(modelDir, name) {
    const parent = parentDir(modelDir);
    for (const d of [modelDir, parent + '/0.6B-Base', parent]) {
        const b = readJSON(d + '/' + name);
        if (b) return b;
    }
    return null;
}

/** After a checkpoint loads: variant + whichever bases apply to it. */
export function afterLoad(node, dir) {
    const p = node.params;
    node._modelDirSig = dir;
    node._variant = node._qwen.variant;
    node._voiceBasis = node._emotionBasis = node._mascFemBasis = null;
    if (node._variant !== 'base' && node._variant !== 'customvoice') return;
    const b = readBasisJson(dir, 'qwen_voice_basis.json');
    if (b && b.comps && b.mean && b.std && b.k) {
        node._voiceBasis = b;
        if (!p.coords || p.coords.length !== b.k) p.coords = new Array(b.k).fill(0);
    }
    const eb = readBasisJson(dir, 'emotion_basis.json');
    if (eb && eb.full && eb.emotions && eb.emotions.length) node._emotionBasis = eb;
    const mb = readBasisJson(dir, 'masc_fem_basis.json');
    if (mb && mb.full && mb.full.M) node._mascFemBasis = mb;
}

/** Blocking load for exec(). */
export function ensureLoadedSync(node) {
    const dir = trimSlash(node.params.modelDir);
    if (node._modelDirSig === dir && node._qwen) return node._qwen;
    if (!exists(dir + '/config.json')) throw new Error('no config.json in ' + dir);
    node._qwen = bro.tts.loadQwen(dir);
    afterLoad(node, dir);
    return node._qwen;
}

// --- x-vector space -------------------------------------------------------------------

export function xvecFromCoords(basis, coords) {
    const { dim, k, mean, comps, std } = basis;
    const x = new Float32Array(dim);
    for (let d = 0; d < dim; d++) x[d] = mean[d];
    for (let i = 0; i < k; i++) {
        const c = (coords[i] || 0) * std[i];
        if (!c) continue;
        for (let d = 0; d < dim; d++) x[d] += c * comps[i][d];
    }
    return x;
}

export function coordsFromXvec(basis, x) {
    const { dim, k, mean, comps, std } = basis;
    const c = new Float64Array(k);
    for (let i = 0; i < k; i++) {
        let s = 0;
        for (let d = 0; d < dim; d++) s += (x[d] - mean[d]) * comps[i][d];
        c[i] = s / (std[i] || 1);
    }
    return c;
}

export function emotionActive(node) {
    const eb = node._emotionBasis;
    return !!eb && eb.emotions.some((e) => node.params.emoAlpha[e]);
}
const mascFemActive = (node) => !!(node._mascFemBasis && node.params.mfAlpha);

function applyEmotion(x, node) {
    if (!x || !emotionActive(node)) return x;
    const eb = node._emotionBasis, out = Float32Array.from(x);
    for (const e of eb.emotions) {
        const a = node.params.emoAlpha[e] || 0, f = eb.full[e];
        if (!a || !f) continue;
        for (let d = 0; d < out.length; d++) out[d] += a * f[d];
    }
    return out;
}
function applyMascFem(x, node) {
    if (!x || !mascFemActive(node)) return x;
    const out = Float32Array.from(x), f = node._mascFemBasis.full.M;
    for (let d = 0; d < out.length; d++) out[d] += node.params.mfAlpha * f[d];
    return out;
}

export const designedXvec = (node) => (node._voiceBasis ? xvecFromCoords(node._voiceBasis, node.params.coords) : null);

// CustomVoice has no base x-vector to fold directions into, so they go in as
// a pure additive steer sized to whichever basis is loaded.
function voiceSteerVector(node) {
    if (!emotionActive(node) && !mascFemActive(node)) return null;
    const eb = node._emotionBasis, mb = node._mascFemBasis;
    let dim = (eb && eb.dim) || (mb && mb.dim) || 0;
    if (!dim && eb) for (const e of eb.emotions) if (eb.full[e]) { dim = eb.full[e].length; break; }
    if (!dim && mb && mb.full.M) dim = mb.full.M.length;
    return dim ? applyMascFem(applyEmotion(new Float32Array(dim), node), node) : null;
}

function voiceOpts(node) {
    const p = node.params;
    if (node._variant === 'customvoice') {
        if (p.cvSource === 'designed') { const x = designedXvec(node); if (x) return { speakerVector: x }; }
        return { speaker: p.speaker };
    }
    if (node._variant === 'voicedesign') return { instruct: p.instruct };
    const x = designedXvec(node);
    return x ? { xvector: applyMascFem(applyEmotion(x, node), node) } : null;
}

/** synthesize() options for the card's params, or null when Base has no voice yet. */
export function buildOpts(node) {
    const p = node.params, s = p.sampling;
    const voice = voiceOpts(node);
    if (node._variant === 'base' && !voice) return null;
    const opts = Object.assign({}, voice, {
        language: p.language,
        temperature: s.temperature, topK: s.topK, topP: s.topP, seed: s.seed,
        repetitionPenalty: s.repetitionPenalty, adaptive: s.adaptive,
    });
    if (Object.keys(p.steer).length) opts.logitBias = Object.assign({}, p.steer);
    if (node._variant === 'customvoice') { const vs = voiceSteerVector(node); if (vs) opts.voiceSteer = vs; }
    return opts;
}
