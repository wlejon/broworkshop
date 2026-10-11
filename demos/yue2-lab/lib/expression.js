// Residual-stream capture and steering — the seam the expression map is
// built on. A take run with capture returns result.hidden: blocks of
// [rows x 2048] per (stage, layer, NAR eval). Means of two takes that differ
// in one attribute give a direction (B - A); a steer row adds a direction
// back into the residual stream at a layer, scaled.

import { $, h, clear } from "/lib/kit/dom.js";
import { pickFile, pickFolder } from "/lib/kit/ml.js";

const HIDDEN = 2048;
let last = null;             // result.hidden of the last captured take
let groupA = null, groupB = null;   // Map layer -> { stage, mean: Float32Array, rows }
const steers = [];           // { layer, nar, scale, plan, semantic, delta, label, on }
let onChange = null;

function intList(text) {
    return String(text || '').split(/[\s,]+/).filter(Boolean).map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n >= 0);
}

/** opts.capture from the panel, or undefined when no layers are named. */
export function captureOptions() {
    const layers = intList($('#cap-layers').value).filter((l) => l < 28);
    if (!layers.length) return undefined;
    return { layers, plan: $('#cap-plan').checked, semantic: $('#cap-sem').checked,
             narEvals: intList($('#cap-nar').value) };
}

/** opts.steer from the enabled rows, or undefined. */
export function steerOptions() {
    const on = steers.filter((s) => s.on && s.scale !== 0);
    if (!on.length) return undefined;
    return on.map((s) => ({ layer: s.layer, nar: s.nar, scale: s.scale, plan: s.plan, semantic: s.semantic,
                            delta: s.delta }));
}

export function steerSummary() {
    return steers.filter((s) => s.on && s.scale !== 0).map((s) => (s.nar ? 'NAR' : 'AR') + s.layer + '×' + s.scale.toFixed(2) + ' ' + s.label);
}

// Mean over rows, per layer (the first block's stage per layer; AR blocks
// preferred over NAR ones).
function layerMeans(hidden) {
    const acc = new Map();
    for (const b of hidden) {
        const key = b.layer + (b.stage === 'synthesize' ? 'n' : 'a');
        let a = acc.get(key);
        if (!a) { a = { layer: b.layer, stage: b.stage, nar: b.stage === 'synthesize', sum: new Float64Array(b.hidden), rows: 0 }; acc.set(key, a); }
        for (let r = 0; r < b.rows; r++)
            for (let c = 0; c < b.hidden; c++) a.sum[c] += b.data[r * b.hidden + c];
        a.rows += b.rows;
    }
    const out = new Map();
    for (const [key, a] of acc) {
        const mean = new Float32Array(a.sum.length);
        for (let c = 0; c < mean.length; c++) mean[c] = a.sum[c] / Math.max(1, a.rows);
        out.set(key, { layer: a.layer, stage: a.stage, nar: a.nar, mean, rows: a.rows });
    }
    return out;
}

function norm(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); }

/** Take a finished result's captures (or none). */
export function setCapture(hidden) {
    last = hidden && hidden.length ? hidden : null;
    const box = $('#cap-summary');
    if (!last) { box.textContent = 'no capture in the last take'; return; }
    const by = {};
    let floats = 0;
    for (const b of last) {
        const k = b.stage + ' L' + b.layer + (b.narEval >= 0 ? ' e' + b.narEval : '');
        by[k] = (by[k] || 0) + b.rows;
        floats += b.data.length;
    }
    box.textContent = Object.entries(by).map(([k, n]) => k + ': ' + n + ' rows').join(' · ') +
        '  (' + (floats * 4 / 1048576).toFixed(1) + ' MB)';
}

function addSteer(s) {
    steers.push(Object.assign({ scale: 1, plan: true, semantic: true, nar: false, on: true }, s));
    renderSteers();
    if (onChange) onChange();
}

function renderSteers() {
    const host = clear($('#steer-list'));
    if (!steers.length) { host.appendChild(h('span.dim', null, 'no steer vectors')); return; }
    steers.forEach((s, i) => {
        const val = h('span.k-val', null, s.scale.toFixed(2));
        const scale = h('input', { type: 'range', min: -8, max: 8, step: 0.05, value: s.scale,
            oninput: (e) => { s.scale = parseFloat(e.target.value); val.textContent = s.scale.toFixed(2); },
            onchange: () => { if (onChange) onChange(); },
            title: 'scale (right-click: 0)' });
        scale.addEventListener('contextmenu', (e) => { e.preventDefault(); s.scale = 0; scale.value = 0; val.textContent = '0.00'; });
        const layer = h('input', { type: 'number', min: 0, max: 27, value: s.layer, style: { width: '52px' },
            onchange: (e) => { s.layer = Math.max(0, Math.min(27, parseInt(e.target.value, 10) || 0)); } });
        const box = (key, label, title) => h('label.k-field', { title },
            h('input', { type: 'checkbox', checked: s[key], onchange: (e) => { s[key] = e.target.checked; } }), label);
        host.appendChild(h('div.steer-row', null,
            h('div.k-col', null,
                h('div.k-row', null, box('on', '', 'enabled'), h('b', null, s.label),
                  h('span.dim', null, '|v| ' + norm(s.delta).toFixed(2))),
                h('div.k-row', null, h('label.k-field', null, 'layer', layer),
                  box('nar', 'NAR', 'apply on the NAR path (synthesis) instead of the AR path'),
                  box('plan', 'plan', 'AR: apply while planning'), box('semantic', 'semantic', 'AR: apply while sampling semantic tokens')),
                h('label.k-field', null, 'scale', scale, val)),
            h('button.small.danger', { title: 'remove', onclick: () => { steers.splice(i, 1); renderSteers(); } }, '✕')));
    });
}

export function buildExpression(changed) {
    onChange = changed;
    renderSteers();
    $('#btn-cap-mark-a').addEventListener('click', () => {
        if (!last) return;
        groupA = layerMeans(last);
        $('#cap-summary').textContent = 'group A set: ' + [...groupA.values()].map((g) => g.stage + ' L' + g.layer).join(', ');
    });
    $('#btn-cap-mark-b').addEventListener('click', () => {
        if (!last) return;
        groupB = layerMeans(last);
        $('#cap-summary').textContent = 'group B set: ' + [...groupB.values()].map((g) => g.stage + ' L' + g.layer).join(', ');
    });
    $('#btn-cap-diff').addEventListener('click', () => {
        if (!groupA || !groupB) { $('#cap-summary').textContent = 'set group A and group B first'; return; }
        for (const [key, b] of groupB) {
            const a = groupA.get(key);
            if (!a) continue;
            const d = new Float32Array(HIDDEN);
            for (let c = 0; c < HIDDEN; c++) d[c] = b.mean[c] - a.mean[c];
            addSteer({ layer: b.layer, nar: b.nar, delta: d, label: 'B−A ' + (b.nar ? 'NAR' : 'AR') + ' L' + b.layer });
        }
    });
    $('#btn-steer-file').addEventListener('click', () => {
        const f = pickFile('Float32 vector|f32;bin');
        if (!f) return;
        try {
            const buf = require('node:fs').readFileSync(f);
            const v = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)).slice();
            if (v.length % HIDDEN) throw new Error('expected a multiple of ' + HIDDEN + ' floats, got ' + v.length);
            addSteer({ layer: 14, delta: v.subarray(0, HIDDEN).slice(), label: f.split(/[\\/]/).pop() });
        } catch (e) { $('#cap-summary').textContent = 'steer file: ' + e.message; }
    });
    $('#btn-steer-clear').addEventListener('click', () => { steers.length = 0; renderSteers(); if (onChange) onChange(); });
    $('#btn-cap-save').addEventListener('click', () => {
        if (!last) return;
        const dir = pickFolder();
        if (dir) saveCapture(dir, last);
    });
}

/** Write captured blocks as <dir>/<stage>_L<layer>[_e<eval>].f32 + index.json. */
export function saveCapture(dir, hidden, meta) {
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    const index = [];
    hidden.forEach((b, i) => {
        const name = b.stage + '_L' + b.layer + (b.narEval >= 0 ? '_e' + b.narEval : '') + '_' + i + '.f32';
        fs.writeFileSync(dir + '/' + name, new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength));
        index.push({ file: name, stage: b.stage, layer: b.layer, pos0: b.pos0, rows: b.rows, hidden: b.hidden, narEval: b.narEval });
    });
    fs.writeFileSync(dir + '/index.json', JSON.stringify({ meta: meta || {}, blocks: index }, null, 2));
    return index.length;
}

export function steerRows() { return steers; }
