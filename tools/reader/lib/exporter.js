// exporter.js — narrate the document (or from the current sentence) to a WAV.
// A background job on the same async synthesis path as playback: one sentence
// in flight, progress + cancel in a dialog, natural pauses between sentences
// (longer at paragraph breaks), exact cache hits reused. exportToPath() is
// the dialog-free entry point tests drive.

import { $ } from "/lib/kit/dom.js";
import { progressBar } from "/lib/kit/ui.js";
import { pickSaveFile } from "/lib/kit/ml.js";
import * as player from "./player.js";
import { ps } from "./player.js";

const RATE = 24000;               // both engines emit 24 kHz mono
const SENTENCE_GAP_S = 0.25;
const PARAGRAPH_GAP_S = 0.6;

let job = null;                   // { path, from, to, i, chunks, cancel, handle, done }
let bar = null;

export function initExporter() {
    bar = progressBar('#export-bar');
    $('#btn-export').addEventListener('click', exportViaDialog);
    $('#btn-export-cancel').addEventListener('click', cancelExport);
}

export function exporting() { return !!job; }

/** The native save dialog, then export from the current sentence. Never in tests. */
function exportViaDialog() {
    if (!ps.doc || !ps.seg || job) return;
    const name = ps.doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'narration';
    const p = pickSaveFile('WAV Files|wav', name + '.wav');
    if (!p) return;
    exportToPath(/\.wav$/i.test(p) ? p : p + '.wav', { from: Math.max(ps.cur, 0) });
}

/** opts: { from?, to?, onDone?(err, path) }. */
export function exportToPath(path, opts) {
    const o = opts || {};
    const fail = (msg) => { if (o.onDone) o.onDone(msg, path); };
    if (!ps.doc || !ps.seg) return fail('no document open');
    if (job) return fail('an export is already running');
    const n = ps.seg.sentences.length, from = Math.max(0, o.from || 0);
    job = { path, from, to: Math.min(n - 1, o.to === undefined ? n - 1 : o.to), i: from,
            chunks: [], cancel: false, handle: null, done: o.onDone || null };
    $('#export-modal').hidden = false;
    setStatus('starting…');
    player.acquireModel(step);       // waits out any in-flight prefetch
}

export function cancelExport() {
    if (!job) return;
    job.cancel = true;
    if (job.handle) { try { job.handle.cancel(); } catch (e) {} }
    else finish('cancelled');
}

function step() {
    if (!job) return;
    if (job.cancel) return finish('cancelled');
    if (job.i > job.to) return writeWav();
    const i = job.i, total = job.to - job.from + 1;
    setStatus('sentence ' + (i - job.from + 1) + ' / ' + total);
    bar.set((i - job.from) / total);

    const advance = () => { job.i++; setTimeout(step, 0); };
    const cached = player.peekCache(i);
    if (cached) { push(cached.samples, cached.sampleRate, i); return advance(); }

    const onDone = (r, info) => {
        if (!job) return;
        job.handle = null;
        if (job.cancel || info.cancelled) return finish('cancelled');
        if (info.error) return finish('synthesize: ' + info.error);
        push(r.samples, r.sampleRate, i);
        job.i++;
        step();
    };
    try {
        job.handle = player.synthCurrent(ps.seg.sentences[i].text, onDone, false);
        if (!job.handle) advance();                  // nothing pronounceable
    } catch (err) { finish('synthesize: ' + err.message); }
}

/** Linear resample to RATE (both engines are 24 kHz today; this is a guard). */
function toRate(samples, sampleRate) {
    if (Math.abs(sampleRate - RATE) <= 1) return samples;
    const ratio = RATE / sampleRate, n = Math.floor(samples.length * ratio);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const t = k / ratio, j = t | 0, f = t - j;
        out[k] = samples[j] * (1 - f) + (samples[j + 1] !== undefined ? samples[j + 1] : samples[j]) * f;
    }
    return out;
}

function push(samples, sampleRate, i) {
    job.chunks.push(toRate(samples, sampleRate));
    if (i < job.to) {
        const s = ps.seg.sentences, paraBreak = s[i + 1].para !== s[i].para;
        job.chunks.push(new Float32Array(Math.round(RATE * (paraBreak ? PARAGRAPH_GAP_S : SENTENCE_GAP_S))));
    }
}

function writeWav() {
    let total = 0;
    for (const c of job.chunks) total += c.length;
    const all = new Float32Array(total);
    let off = 0;
    for (const c of job.chunks) { all.set(c, off); off += c.length; }
    let err = null;
    try { if (!player.audioCtx().saveWav(job.path, all, 1, RATE)) err = 'saveWav failed for ' + job.path; }
    catch (e) { err = e.message; }
    bar.set(1);
    finish(err, (total / RATE).toFixed(1) + 's written');
}

function finish(err, okMsg) {
    const done = job && job.done, path = job && job.path;
    job = null;
    player.releaseModel();
    if (err) setStatus(err === 'cancelled' ? 'cancelled' : 'export failed: ' + err);
    else setStatus('saved ' + (okMsg || '') + ' to ' + path);
    setTimeout(() => { $('#export-modal').hidden = true; }, err === 'cancelled' ? 400 : 1600);
    if (done) { try { done(err || null, path); } catch (e) {} }
}

function setStatus(t) { $('#export-status').textContent = t; }
