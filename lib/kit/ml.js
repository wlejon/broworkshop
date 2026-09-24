// lib/kit/ml.js — plumbing every ML lab repeats: the device badge, the
// model-directory row (weights resolution + browse + Load), native file
// dialogs, and image files -> ImageData.
//
//   import { deviceBadge, modelRow, imageDataFromFile } from "/lib/kit/ml.js";
//   const badge = deviceBadge('#device');
//   const row = modelRow('#model-bar', {
//       fields: [{ id: 'model-dir', label: 'model', what: 'Parakeet-TDT 0.6B',
//                  candidates: ['brosoundml/weights/parakeet/0.6b-v3'], probe: 'config.json' }],
//       onLoad: ([dir]) => load(dir),
//       onMissing: (msg) => status.error(msg),
//   });
//   row.autoLoad();          // loads when the weights are on disk, else reports them missing
//
// Weight lookup is lib/kit/weights.js (BRO_WEIGHTS aware, never D:/projects).

import { h } from "./dom.js";
import { findWeights, missingWeights, weightPath } from "./weights.js";

const fs = require('fs');
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch (_) { return false; } };
const el = (x) => {
    if (typeof x !== 'string') return x;
    const found = document.querySelector(x);
    if (!found) throw new Error('kit: no element matches ' + x);
    return found;
};

// --- device ------------------------------------------------------------------

/** 'CUDA' / 'METAL' / ... when bro.gpu has a device, else 'CPU'. */
export function deviceLabel() {
    const g = globalThis.bro && bro.gpu;
    return g && g.available ? String(g.backend || 'gpu').toUpperCase() : 'CPU';
}

/** True when bro.gpu reports a usable device. */
export function gpuAvailable() {
    const g = globalThis.bro && bro.gpu;
    return !!(g && g.available);
}

/**
 * A .k-chip showing the compute device: green (.on) on a GPU, amber text on
 * CPU. Handle: set(label, onGpu?) (a loaded model's own device string),
 * reset() (back to the bro.gpu probe).
 */
export function deviceBadge(target) {
    const node = el(target);
    node.classList.add('k-chip');
    const api = {
        set(label, onGpu) {
            const s = String(label || 'cpu').toUpperCase();
            const gpu = onGpu != null ? !!onGpu : !/^CPU/.test(s);
            node.textContent = s;
            node.classList.toggle('on', gpu);
            node.classList.toggle('warn', !gpu);
            return api;
        },
        reset() { return api.set(deviceLabel(), gpuAvailable()); },
        el: node,
    };
    return api.reset();
}

// --- dialogs -------------------------------------------------------------------
// Native dialogs block (never call them from a headless test); each returns
// null when the build has no dialog support.

/** A folder chosen in the native dialog, or null. */
export function pickFolder(start) {
    if (typeof showOpenFolderDialog !== 'function') return null;
    const r = showOpenFolderDialog(start || null);
    return (Array.isArray(r) ? r[0] : r) || null;
}

/** A file chosen in the native open dialog ('Audio|wav;flac'), or null. */
export function pickFile(filter) {
    if (typeof showOpenFileDialog !== 'function') return null;
    const r = showOpenFileDialog(filter || '');
    return (Array.isArray(r) ? r[0] : r) || null;
}

/** A path chosen in the native save dialog, or null. */
export function pickSaveFile(filter, defaultName) {
    if (typeof showSaveFileDialog !== 'function') return null;
    return showSaveFileDialog(filter || '', defaultName || '') || null;
}

// --- files ---------------------------------------------------------------------

/** Last path component. */
export function baseName(p) {
    const parts = String(p || '').split(/[\\/]/);
    return parts[parts.length - 1] || String(p || '');
}

/**
 * Absolute path for an app-relative one (absolute input passes through).
 * `new Image().src` and native loaders resolve relative paths against
 * different bases, so anchor app assets to bro.appDir explicitly.
 */
export function appPath(p) {
    if (!p || /^([a-zA-Z]:)?[\\/]/.test(p)) return p;
    const dir = String((globalThis.bro && bro.appDir) || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return dir ? dir + '/' + p.replace(/^\.\//, '') : p;
}

/**
 * Decode an image file to ImageData { data, width, height } (synchronous:
 * the engine decodes Image.src inline). Throws when it cannot decode.
 */
export function imageDataFromFile(path) {
    const img = new Image();
    img.src = appPath(path);
    const w = img.naturalWidth, hh = img.naturalHeight;
    if (!w || !hh) throw new Error('could not decode image: ' + path);
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, w, hh);
}

// --- the model row -------------------------------------------------------------

/**
 * The "model directory + Load" row, built into `host` (a .k-toolbar).
 * opts:
 *   fields: [{ id, label, what, candidates, probe = 'config.json', width }]
 *     one path input + a folder button each; prefilled with the first
 *     candidate on disk (findWeights), else the first candidate's path.
 *   loadId = 'btn-load', loadLabel = 'Load'
 *   onLoad(paths)       Load / Enter with every path present
 *   onMissing(message)  Load with a path missing (says which, and how to fix)
 * Handle: paths(), path (first), found (every field resolved on disk),
 * check() -> '' or the missing-weights message, load() -> bool (true when
 * onLoad ran), autoLoad() (load() when found, else onMissing), meta(text),
 * busy(on), button, inputs, metaEl.
 */
export function modelRow(host, opts) {
    const node = el(host);
    const o = Object.assign({ loadId: 'btn-load', loadLabel: 'Load' }, opts);
    const fields = o.fields.map((f) => Object.assign({ probe: 'config.json' }, f));
    const inputs = [];
    for (const f of fields) {
        const found = findWeights(f.candidates, { probe: f.probe });
        const input = h('input', { type: 'text', id: f.id, value: found || weightPath(f.candidates[0]),
                                   spellcheck: false, style: { width: (f.width || 420) + 'px' },
                                   title: (f.what || f.label) + ' directory' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') api.load(); });
        const browse = h('button.small', {
            title: 'Choose the ' + (f.what || f.label) + ' directory',
            onclick: () => { const d = pickFolder(input.value.trim()); if (d) input.value = d; },
        }, '…');
        node.appendChild(h('label.k-field', null, h('span', null, f.label), input));
        node.appendChild(browse);
        inputs.push(input);
    }
    const button = h('button#' + o.loadId, { onclick: () => api.load() }, o.loadLabel);
    const metaEl = h('span.dim');
    node.appendChild(button);
    node.appendChild(metaEl);

    const probeOk = (f, p) => exists(f.probe ? p + '/' + f.probe : p);
    const api = {
        paths: () => inputs.map((i) => i.value.trim().replace(/[\\/]+$/, '')),
        get path() { return api.paths()[0]; },
        get found() { return !api.check(); },
        check() {
            const ps = api.paths();
            for (let i = 0; i < fields.length; i++) {
                const f = fields[i], p = ps[i];
                if (probeOk(f, p)) continue;
                const isDefault = p === weightPath(f.candidates[0]);
                return isDefault ? missingWeights(f.what || f.label, f.candidates)
                                 : (f.what || f.label) + ': no ' + (f.probe || 'weights') + ' in ' + (p || '(empty path)');
            }
            return '';
        },
        load() {
            const miss = api.check();
            if (miss) { if (o.onMissing) o.onMissing(miss); return false; }
            if (o.onLoad) o.onLoad(api.paths());
            return true;
        },
        autoLoad() { return api.load(); },
        meta(t) { metaEl.textContent = t || ''; },
        busy(on) { button.disabled = !!on; },
        button, inputs, metaEl,
    };
    return api;
}
