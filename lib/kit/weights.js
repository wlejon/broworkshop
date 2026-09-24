// lib/kit/weights.js — find model weights without hardcoding D:/projects.
//
// Weights live in the sibling repos next to this checkout
// (<root>/brolm/weights/..., <root>/brosoundml/weights/..., <root>/brosoundml-data/...).
// <root> resolves, in order:
//   1. $BRO_WEIGHTS                  (the directory holding the siblings)
//   2. the nearest ancestor of the app dir that holds a bro* sibling
//      (brolm, brosoundml, brodiffusion, brovisionml, brosoundml-data)
//   3. the parent of the broworkshop checkout
// A relative candidate is also tried under the per-user model cache
// ($BRO_MODELS_DIR, else <user data>/bro/models), where downloaded files land.
//
//   import { findWeights, weightPath } from "/lib/kit/weights.js";
//   const dir = findWeights(['brolm/weights/Qwen3.5-0.8B'], { probe: 'config.json' });
//   if (!dir) status.error(missingWeights('Qwen3.5-0.8B', ['brolm/weights/Qwen3.5-0.8B']));
//
// Every path returned is absolute with forward slashes: brokit's fs resolves
// relative paths against the app dir, but native loaders resolve against the
// process CWD, so a relative path would work in one and not the other.
// Works in apps, workers and headless test scripts (no DOM use).

const fs = require('fs');

const SIBLINGS = ['brolm', 'brosoundml', 'brodiffusion', 'brovisionml', 'brosoundml-data'];

function env(k) {
    try { const p = globalThis.process; return (p && p.env && p.env[k]) || ''; }
    catch (_) { return ''; }
}
function exists(p) { try { return !!p && fs.existsSync(p); } catch (_) { return false; } }
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const isAbs = (p) => /^([a-zA-Z]:)?\//.test(norm(p));

function appDir() {
    let d = '';
    try { d = (globalThis.bro && globalThis.bro.appDir) || ''; } catch (_) {}
    return norm(d || env('BRO_APP_DIR'));
}

let cachedRoot = null;

/** The directory holding the weight-bearing sibling repos (absolute, no trailing slash). */
export function weightsRoot() {
    if (cachedRoot) return cachedRoot;
    const override = env('BRO_WEIGHTS');
    if (override) return (cachedRoot = norm(override));
    let workshop = '';
    for (let d = appDir(); d; ) {
        if (SIBLINGS.some((s) => exists(d + '/' + s))) return (cachedRoot = d);
        if (!workshop && exists(d + '/launcher/apps.json')) workshop = d;
        const i = d.lastIndexOf('/');
        if (i <= 0) break;
        d = d.slice(0, i);
    }
    const base = workshop || norm(env('BRO_PROJECT_ROOT'));
    const i = base.lastIndexOf('/');
    return (cachedRoot = i > 0 ? base.slice(0, i) : '..');
}

/** Per-user model cache ($BRO_MODELS_DIR, else <user data>/bro/models). */
export function modelCacheDir() {
    const o = env('BRO_MODELS_DIR');
    if (o) return norm(o);
    const appData = env('APPDATA'), home = env('HOME') || env('USERPROFILE');
    if (appData) return norm(appData) + '/bro/models';
    if (env('XDG_DATA_HOME')) return norm(env('XDG_DATA_HOME')) + '/bro/models';
    return home ? norm(home) + '/.local/share/bro/models' : '';
}

/** Absolute path of `rel` under weightsRoot() (no existence check). Absolute input passes through. */
export function weightPath(rel) {
    return isAbs(rel) ? norm(rel) : weightsRoot() + '/' + norm(rel).replace(/^\.\//, '');
}

/** Every absolute location a candidate is tried at, in order. */
export function candidatePaths(candidates) {
    const out = [];
    const cache = modelCacheDir();
    for (const c of [].concat(candidates)) {
        if (!c) continue;
        out.push(weightPath(c));
        if (!isAbs(c) && cache) out.push(cache + '/' + norm(c));
    }
    return out;
}

/**
 * First existing candidate, as an absolute path, or null.
 * candidates: string or array; relative ones resolve under weightsRoot()
 *   and then the model cache.
 * opts.probe: a file that must exist inside the candidate ('config.json'),
 *   or a function(absPath) -> bool. Default: the path itself exists.
 */
export function findWeights(candidates, opts) {
    const probe = opts && opts.probe;
    for (const p of candidatePaths(candidates)) {
        let ok;
        if (typeof probe === 'function') { try { ok = probe(p); } catch (_) { ok = false; } }
        else ok = exists(probe ? p + '/' + probe : p);
        if (ok) return p;
    }
    return null;
}

/** A one-line "not found" message naming what was tried and how to fix it. */
export function missingWeights(what, candidates) {
    return what + ' not found (tried ' + candidatePaths(candidates).join(', ') +
           '); set BRO_WEIGHTS to the directory holding the bro* sibling repos';
}

/** findWeights that throws missingWeights() on a miss. */
export function requireWeights(what, candidates, opts) {
    const p = findWeights(candidates, opts);
    if (!p) throw new Error(missingWeights(what, candidates));
    return p;
}
