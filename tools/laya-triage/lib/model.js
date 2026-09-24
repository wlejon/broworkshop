// model.js — Laya checkpoint discovery and loading, and the page's session.
// No simulator: when the model cannot load, the app says why and stays inert.

import { findWeights } from "/lib/kit/weights.js";
import { prefStore } from "/lib/kit/prefs.js";

const fs = require('fs');

/** What the page has done so far. Read by app.js, render.js and the tests. */
export const session = {
    model: null,             // the loaded bro.lm LayaModel
    modelDir: '',
    loading: false,
    loadError: '',
    loadMs: 0,
    checkpoint: '',          // config().checkpoint of the loaded model
    lastResult: null,        // last single-request result
    lastObservedMs: 0,
    singleError: '',
};

/** The last directory that loaded. */
export const prefs = prefStore('laya-triage.v1', { modelDir: '' });

export function isCheckpoint(dir) {
    try { return !!dir && fs.existsSync(dir + '/model.safetensors') && fs.existsSync(dir + '/rl_agent_config.json'); }
    catch (e) { return false; }
}

// The Laya family: the English checkpoint at the root of a checkout, the
// other two in subfolders. The loader only takes a directory; which model it
// is comes back from config().checkpoint.
export const CHECKPOINTS = [
    { id: 'english', sub: '', label: 'English · ModernBERT-large · 512' },
    { id: 'multilingual', sub: 'multilingual', label: 'Multilingual · mmBERT-base · 1024' },
    { id: 'typed-decisions', sub: 'typed-decisions', label: 'Typed decisions · ModernBERT-large · 1024' },
];

const norm = (d) => (d || '').replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The directory to pre-fill: the last one that loaded, $LAYA_MODEL_DIR, or a
 * `laya/` checkout beside the sibling repos (weights.js root).
 */
export function defaultModelDir() {
    const env = (typeof process !== 'undefined' && process.env) || {};
    for (const c of [prefs.data.modelDir, env.LAYA_MODEL_DIR]) if (isCheckpoint(norm(c))) return norm(c);
    return findWeights(['laya'], { probe: 'rl_agent_config.json' }) || '';
}

/** The family root a checkpoint directory belongs to ('' for a lone checkpoint). */
export function familyRoot(dir) {
    dir = norm(dir);
    if (!dir) return '';
    const hasSubs = (d) => CHECKPOINTS.some((c) => c.sub && isCheckpoint(d + '/' + c.sub));
    if (isCheckpoint(dir) && hasSubs(dir)) return dir;
    const slash = dir.lastIndexOf('/');
    const parent = slash > 0 ? dir.slice(0, slash) : '';
    if (parent && CHECKPOINTS.some((c) => c.sub === dir.slice(slash + 1)) && hasSubs(parent)) return parent;
    return '';
}

/** { id, label, dir } for every family member present under `root`. */
export function familyCheckpoints(root) {
    if (!root) return [];
    return CHECKPOINTS.map((c) => ({ id: c.id, label: c.label, dir: c.sub ? root + '/' + c.sub : root }))
        .filter((c) => isCheckpoint(c.dir));
}

/** The checkpoint picker's options for `dir`: its family, plus `dir` itself when outside one. */
export function checkpointOptions(dir) {
    const d = norm(dir);
    const members = familyCheckpoints(familyRoot(d));
    const opts = members.map((c) => ({ value: c.dir, label: c.label, selected: norm(c.dir) === d }));
    if (!members.some((c) => norm(c.dir) === d)) opts.push({ value: d, label: d ? 'custom folder' : 'none found', selected: true });
    return { options: opts, family: members.length > 1 };
}

/** Why the model cannot be used in this build, or ''. */
export function unavailableReason() {
    if (typeof bro === 'undefined' || !bro.lm || bro.lm.available === false) {
        return 'bro.lm is not compiled into this build (needs the AI tower: -DBRO_PROFILE=full).';
    }
    if (typeof bro.lm.loadLayaAsync !== 'function') return 'this bro build has no bro.lm.loadLayaAsync; rebuild bro.';
    return '';
}

/**
 * Load (async, one replica per GPU) into session.model. Resolves to the
 * model; rejects with a plain-language Error. The previous model is disposed.
 */
export function loadModel(dir) {
    dir = norm((dir || '').trim());
    const why = unavailableReason();
    if (why) return Promise.reject(new Error(why));
    if (!dir) return Promise.reject(new Error('No checkpoint directory. Point this at a Laya checkout (the folder holding model.safetensors).'));
    if (!isCheckpoint(dir)) return Promise.reject(new Error('No Laya checkpoint in ' + dir + ' (expected model.safetensors and rl_agent_config.json).'));
    if (session.model) { try { session.model.dispose(); } catch (e) {} session.model = null; }
    return bro.lm.loadLayaAsync(dir, { devices: 'all' }).then((m) => {
        session.model = m;
        session.modelDir = dir;
        prefs.set({ modelDir: dir });
        return m;
    });
}
