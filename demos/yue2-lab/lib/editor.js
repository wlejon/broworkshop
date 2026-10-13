// The Editor: a saved song (its take: tokens, latents, energy, plan) cut,
// regenerated and grown inside the lab, every step a version in its history.
// A song is its semantic tokens plus its latents, one each per frame (25 fps),
// so each move is yue.splice (new tokens between kept ones, best of N scored
// by how well what follows fits) and then yue.inpaint (new latents for the
// frames that changed, solved between the kept ones), decoded by the VAE with
// the take's energy offsets as the stream played them.
//
//   regenerate   the selection, new, the same length; every candidate drawn
//                is rendered, so each can be heard in place and picked
//   cut          the selection out; the gap closed (a seam re-solved) or
//                bridged by a few new seconds
//   new song     the selection kept where it sits in the song's score, new
//   from it      music before and after it (and, without "keep the clip", the
//                selection regenerated once the song around it is built)
//
// The selection keeps its place in the score on purpose: the plan (the ABC
// score) is the song's, so a clip moved to the start of a new song is a clip
// the score does not begin with, and the model loops it rather than finding
// its way back into the score.
//
// The timeline (lib/editor_view.js) holds the selection, the playhead and the
// view; this file the versions and the moves. Save writes the version on screen
// into the radio's save folder, named as the radio names its saves, with its
// take beside it.

import { $, h, clear } from "/lib/kit/dom.js";
import { audioContext } from "/lib/kit/audio.js";
import { interleave } from "./player.js";
import { loadTake, saveTake } from "./takes.js";
import { saveDir, savePathFor } from "./radio.js";
import * as tl from "./editor_view.js";

const { FPS, fmt } = tl;
const D = 64;
const SEAM = 12;   // frames each side of a closed cut re-solved

let deps = null, ed = null, job = null;
// The running move: { label, steps, step, text, frac, span, t0 } (null when idle).
let work = null;

// ── takes on disk ────────────────────────────────────────────────────────────
/** Takes in the save folder, newest first: { dir, title, when, frames }. */
export function savedTakes() {
    const fs = require('node:fs'), path = require('node:path');
    const root = path.join(saveDir(), 'takes');
    let names = [];
    try { names = fs.readdirSync(root); } catch (e) { return []; }
    const out = [];
    for (const n of names) {
        try {
            const m = JSON.parse(fs.readFileSync(path.join(root, n, 'take.json'), 'utf8'));
            out.push({ dir: path.join(root, n), name: n, title: m.title || n, when: m.when || '', frames: m.frames || 0 });
        } catch (e) { /* not a take */ }
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

function renderList() {
    const host = clear($('#edit-takes'));
    const list = savedTakes();
    if (!list.length) { host.appendChild(h('span.dim', null, 'no saved songs in ' + saveDir() + ' yet: Save one on the radio')); return; }
    for (const t of list)
        host.appendChild(h('div.take' + (ed && ed.dir === t.dir ? '.current' : ''), { title: 'open ' + t.title, onclick: () => openDir(t.dir) },
            h('div.k-row', null, h('b', null, t.title), h('span.dim', null, fmt(t.frames))),
            h('div.dim', null, t.name.slice(0, 19).replace('_', ' '))));
}

// ── versions ─────────────────────────────────────────────────────────────────
// ed: { dir, title, tags, req (style, lyrics, cot, cfgScale), seed, plan,
//       versions: [{ label, semantic, latents, energy, audio, span?, cands? }], at }
// A regenerate's cands: [{ semantic, latents, audio, score }], chosen.
const cur = () => (ed ? ed.versions[ed.at] : null);

function openDir(dir) {
    if (ed && ed.dir === dir) return;
    if (busy()) return;
    let t;
    try { t = loadTake(dir); } catch (e) { deps.status.error('open: ' + e.message); return; }
    if (!t.plan || !t.semantic.length || t.latents.length !== t.semantic.length * D) {
        deps.status.error('open: ' + dir + ' has no whole take (tokens, latents and plan)'); return;
    }
    openTake(t, dir);
}

/** Edit a take object (lib/takes.js shape). */
export function openTake(t, dir) {
    tl.clearSong();   // the song that was playing stops now, not when the new one is clicked
    const energy = t.energy && t.energy.length === t.semantic.length ? t.energy : new Float32Array(t.semantic.length);
    ed = {
        dir: dir || '', title: t.title || 'song', tags: t.tags || '',
        req: { style: t.style || '', lyrics: t.lyrics || '', cot: t.cot || 'full', cfgScale: t.cfgScale },
        seed: t.seed >>> 0, plan: t.plan, versions: [], at: 0,
    };
    renderList();
    deps.log.add('editing ' + ed.title + ' (' + fmt(t.semantic.length) + ')');
    addVersion({ label: 'as saved', semantic: t.semantic, latents: t.latents, energy }, false);
}

function addVersion(v, keepView) {
    ed.versions.length = Math.min(ed.versions.length, ed.at + 1);   // a move after an undo drops what was undone
    ed.versions.push(v);
    ed.at = ed.versions.length - 1;
    goTo(ed.at, keepView);
}

function goTo(i, keepView) {
    if (!ed || i < 0 || i >= ed.versions.length) return;
    ed.at = i;
    const v = ed.versions[i];
    tl.showVersion(v, keepView);
    if (!v.audio) decodeShown(v);
    show();
}
const undo = () => { if (!job && ed && ed.at > 0) goTo(ed.at - 1, true); };
const redo = () => { if (!job && ed && ed.at < ed.versions.length - 1) goTo(ed.at + 1, true); };

// The version's audio: its latents + energy along the energy direction.
function withEnergy(latents, energy) {
    const dir = bro.music.energyDirection, T = energy.length;
    const lat = new Float32Array(latents.length);
    for (let f = 0; f < T; f++)
        for (let d = 0; d < D; d++) lat[f * D + d] = latents[f * D + d] + energy[f] * dir[d];
    return lat;
}
function decodeShown(v) {
    if (!deps.models().vae) { deps.status.warn('load the models to hear it'); return; }
    begin('decoding', 1, null);
    decode(v.latents, v.energy).then((audio) => {
        v.audio = audio; end();
        if (cur() === v) tl.showVersion(v, true);
        show();
    }, (e) => { end(); fail('decode', e); });
}

// ── jobs ─────────────────────────────────────────────────────────────────────
function busy() {
    if (job || work) { deps.status.warn('the editor is ' + (work ? work.text : 'busy') + '…'); return true; }
    return false;
}
function ready() {
    const { yue, vae } = deps.models();
    if (!yue || !vae) { deps.status.warn('load the models first'); return false; }
    if (!deps.canRun()) { deps.status.warn('the radio or a lab job holds the model: stop it first'); return false; }
    if (!ed) { deps.status.warn('open a saved song first'); return false; }
    return !busy();
}

// A move's progress: its steps, the one running, how far it is.
function begin(label, steps, span) {
    work = { label, steps, step: 0, text: label, frac: 0, span, t0: performance.now() };
    deps.status.busy(label + '…');
    show();
}
function stage(text) {
    if (!work) return;
    work.step++; work.text = text; work.frac = 0;
    deps.status.busy(text + '…');
    show();
}
function end() { work = null; job = null; deps.progress(0); show(); }
function fail(what, e) {
    const m = e && e.message ? e.message : String(e);
    if (m === 'stopped') { deps.status.warn(what + ' stopped'); deps.log.add(what + ' stopped'); }
    else { deps.status.error(what + ': ' + m); deps.log.add(what + ': ' + m, 'err'); }
}

// One promise per async step (splice, inpaint, decode).
function step(start) {
    return new Promise((resolve, reject) => {
        try {
            job = start((r, info) => {
                job = null;
                if (info && info.error) reject(new Error(info.error));
                else if (!r || (info && info.cancelled)) reject(new Error('stopped'));
                else resolve(r);
            });
        } catch (e) { job = null; reject(e); }
    });
}

function request(extra) {
    const o = Object.assign({}, ed.req, { seed: (ed.seed + 7919 * ed.versions.length) >>> 0 }, deps.sampling(), extra);
    if (o.cfgScale == null) delete o.cfgScale;
    return o;
}
const yue = () => deps.models().yue;
// Token progress: a known total as a fraction, an open-ended one as seconds sampled.
const tokenProgress = (text) => (p) => {
    if (!work) return;
    const open = !p.total || p.done >= p.total;
    work.frac = open ? 0 : p.done / p.total;
    work.text = open ? text + ' · ' + fmt(p.done) + ' sampled' : text;
    deps.progress(work.frac);
};
const narProgress = (p) => { if (work) { work.frac = p.total ? p.done / p.total : 0; deps.progress(work.frac); } };
const splice = (text, o) => { stage(text); return step((done) => yue().splice(ed.plan, Object.assign(request(o), { onProgress: tokenProgress(text), onDone: done }))); };
const inpaint = (text, sem, lat, a, b) => { stage(text); return step((done) =>
    yue().inpaint(ed.plan, sem, lat, a, b, Object.assign(request({}), { onProgress: narProgress, onDone: done }))); };
const decode = (latents, energy, text) => {
    if (text) stage(text);
    return step((done) => deps.models().vae.decode(withEnergy(latents, energy), { onDone: (r, info) => done(r, info || {}) }));
};

function cat(...parts) {
    const T = parts[0].constructor;
    const out = new T(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

// steps: how many stages the move runs (for "step i of n"); span: what the
// timeline marks as being worked on (null: the whole song).
async function move(label, steps, span, body) {
    if (!ready()) return;
    begin(label, steps, span);
    try {
        const v = await body(cur());
        v.label = label;
        const secs = (performance.now() - work.t0) / 1000;
        end();
        addVersion(v, v.semantic.length === cur().semantic.length);
        const mark = v.span || v.from;
        if (mark) tl.setSelection(mark[0], mark[1]);
        deps.status.ok(label + ' done');
        deps.log.add(label + ' in ' + secs.toFixed(1) + ' s', 'ok');
    } catch (e) {
        end();
        fail(label, e);
    }
}

function selection() {
    const s = tl.selection();
    if (!s || s[1] - s[0] < 2) { deps.status.warn('select a stretch of the song first (drag on the waveform)'); return null; }
    return s;
}
const candidatesWanted = () => Math.max(1, Math.min(8, Number($('#edit-cands-n').value) || 3));
const letter = (k) => String.fromCharCode(65 + k);

function regenerate() {
    const s = selection(); if (!s) return;
    const [a, b] = s;
    const K = b < cur().semantic.length ? candidatesWanted() : 1;   // with nothing after it there is nothing to score
    move('regenerated ' + fmt(a) + '–' + fmt(b), 1 + 2 * K, [a, b], async (v) => {
        const r = await splice('sampling ' + (K > 1 ? K + ' candidates' : 'tokens'), {
            before: v.semantic.subarray(0, a), after: v.semantic.subarray(b), middleFrames: b - a, candidates: K });
        // Every candidate rendered, the best-scored first.
        const order = r.middles.map((m, k) => k).sort((x, y) => r.scores[x] - r.scores[y]);
        const cands = [];
        for (const k of order) {
            const sem = cat(v.semantic.subarray(0, a), r.middles[k], v.semantic.subarray(b));
            const tag = r.middles.length > 1 ? ' ' + letter(cands.length) + ' (' + (cands.length + 1) + '/' + r.middles.length + ')' : '';
            const ip = await inpaint('solving latents' + tag, sem, Float32Array.from(v.latents), a, b);
            const audio = await decode(ip.latents, v.energy, 'decoding' + tag);
            cands.push({ semantic: sem, latents: ip.latents, audio, score: r.scores[k] });
        }
        const c = cands[0];
        return { semantic: c.semantic, latents: c.latents, energy: v.energy, audio: c.audio, span: [a, b],
                 cands: cands.length > 1 ? cands : null, chosen: 0 };
    });
}

// Another of a regenerate's candidates in place of the one shown: already
// rendered, so it plays at once from just before the change.
function pickCandidate(k, listen) {
    const v = cur();
    if (!v || !v.cands || job) return;
    const c = v.cands[k];
    v.chosen = k; v.semantic = c.semantic; v.latents = c.latents; v.audio = c.audio;
    tl.showVersion(v, true);
    if (listen) tl.playSpan(Math.max(0, v.span[0] - 2 * FPS), Math.min(v.semantic.length, v.span[1] + 2 * FPS));
    show();
}

function cut() {
    const s = selection(); if (!s) return;
    const [a, b] = s;
    const bridge = Math.max(0, Math.round((Number($('#edit-bridge').value) || 0) * FPS));
    move('cut ' + fmt(a) + '–' + fmt(b) + (bridge ? ', ' + (bridge / FPS) + ' s bridge' : ''), bridge ? 3 : 2, [a, b], async (v) => {
        const A = v.semantic.subarray(0, a), B = v.semantic.subarray(b);
        let sem = cat(A, B), mid = new Int32Array(0);
        if (bridge) {
            const r = await splice('sampling the bridge', { before: A, after: B, middleFrames: bridge, candidates: candidatesWanted() });
            sem = r.semantic; mid = r.middles[r.chosen];
        }
        const n = mid.length;
        const lat = cat(v.latents.subarray(0, a * D), new Float32Array(n * D), v.latents.subarray(b * D));
        const en = cat(v.energy.subarray(0, a), new Float32Array(n).fill(a > 0 ? v.energy[a - 1] : 0), v.energy.subarray(b));
        const lo = n ? a : Math.max(0, a - SEAM), hi = n ? a + n : Math.min(sem.length, a + SEAM);
        const ip = await inpaint(n ? 'solving the bridge' : 'joining the two sides', sem, lat, lo, hi);
        const audio = await decode(ip.latents, en, 'decoding');
        return { semantic: sem, latents: ip.latents, energy: en, audio, span: [lo, hi] };
    });
}

// A new song with the selection where it sits in the score: what leads to it
// is sampled (best of N scored by how the clip follows), what follows
// continues it until the song ends.
function grow() {
    const s = selection(); if (!s) return;
    const [a, b] = s;
    const keep = $('#edit-keep-clip').checked;
    // Where it is steered to end: the field, else the song open now; never
    // before the clip and ten seconds after it. Past that the end token gains
    // +1 a second, and the song is cut at 1.5x.
    const want = Math.round((Number($('#edit-grow-len').value) || cur().semantic.length / FPS) * FPS);
    const target = Math.max(b + 10 * FPS, want);
    const lengthSteer = { semanticSampling: Object.assign({}, deps.sampling().semanticSampling,
        { endBiasAfter: target, endBiasPerToken: 1 / FPS, maxTokens: Math.round(Math.max(1.5 * target, target + 20 * FPS)) }) };
    move('a new song from ' + fmt(a) + '–' + fmt(b) + (keep ? '' : ', the clip redone'), keep ? 4 : 6, null, async (v) => {
        const clip = v.semantic.subarray(a, b);
        const r = await splice(a ? 'sampling what leads in, then on to the end' : 'sampling on to the end', {
            before: new Int32Array(0), after: clip, middleFrames: a, candidates: a ? Math.min(2, candidatesWanted()) : 1, continue: true,
            ...lengthSteer });
        let sem = r.semantic;
        const n = sem.length;
        let lat = new Float32Array(n * D);
        lat.set(v.latents.subarray(a * D, b * D), a * D);
        if (a > 0) lat = (await inpaint('solving what leads in', sem, lat, 0, a)).latents;
        else stage('nothing leads in');
        if (n > b) lat = (await inpaint('solving what follows', sem, lat, b, n)).latents;
        else stage('the song ends with the clip');
        const en = new Float32Array(n);
        en.set(v.energy.subarray(a, b), a);
        if (!keep) {
            // The clip has placed the song; now it is regenerated too.
            const r2 = await splice('sampling a new clip', { before: sem.subarray(0, a), after: sem.subarray(b), middleFrames: b - a,
                                                            candidates: n > b ? candidatesWanted() : 1 });
            sem = r2.semantic;
            lat = (await inpaint('solving the new clip', sem, lat, a, b)).latents;
        }
        const audio = await decode(lat, en, 'decoding');
        return { semantic: sem, latents: lat, energy: en, audio, span: keep ? null : [a, b], from: [a, b], truncated: r.truncated };
    });
}

function saveVersion() {
    const v = cur();
    if (!v || !v.audio) { deps.status.warn('nothing rendered to save yet'); return; }
    const fs = require('node:fs'), path = require('node:path');
    const dir = saveDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { deps.status.error('save: ' + e.message); return; }
    const title = ed.title + (ed.at ? ' (edit ' + ed.at + ')' : '');
    const { stem, wav } = savePathFor(dir, title);
    const a = v.audio;
    audioContext().saveWav(wav, interleave(a.samples.subarray(0, a.frames), a.samples.subarray(a.frames)), 2, a.sampleRate);
    try { fs.writeFileSync(wav.replace(/\.wav$/i, '.txt'), title + '\n' + ed.tags + '\n\n' + (ed.req.lyrics || '').trim() + '\n'); } catch (e) { /* lyrics only */ }
    const tdir = path.join(dir, 'takes', stem);
    saveTake(tdir, {
        kind: 'edit', seed: ed.seed, style: ed.req.style, lyrics: ed.req.lyrics, cot: ed.req.cot, cfgScale: ed.req.cfgScale,
        settings: { edits: ed.versions.slice(1, ed.at + 1).map((x) => x.label) }, abc: ed.plan.abc, plan: ed.plan,
        frames: v.semantic.length, semantic: v.semantic, latents: v.latents, energy: v.energy,
        title, tags: ed.tags, wav: path.relative(tdir, wav).replace(/\\/g, '/'), when: new Date(),
    });
    deps.log.add('saved ' + title + ' → ' + wav, 'ok');
    deps.status.ok('saved ' + path.basename(wav));
    renderList();
}

// ── view ─────────────────────────────────────────────────────────────────────
// What changes as the selection, playhead or a step's progress moves.
function showLive() {
    const v = cur();
    $('#edit-meta').textContent = ed ? ed.title + (v ? '  ·  ' + fmt(v.semantic.length) + '  ·  v' + ed.at + ' ' + v.label : '') : 'no song open';
    // the job chip and the timeline's mark of what is being worked on
    $('#edit-job').classList.toggle('off', !work);
    if (work) {
        $('#edit-job-text').textContent = (work.steps > 1 ? (Math.max(1, work.step) + '/' + work.steps + '  ') : '') + work.text + '…';
        $('#edit-job-fill').style.width = Math.round(work.frac * 100) + '%';
    }
    tl.setPending(work ? { span: work.span, text: work.text, frac: work.frac } : null);
    $('#edit-stop').disabled = !job;
    const sel = tl.selection(), off = !ed || !!work;
    $('#edit-sel').textContent = sel ? 'selection ' + fmt(sel[0]) + ' – ' + fmt(sel[1]) + '  (' + ((sel[1] - sel[0]) / FPS).toFixed(1) + ' s)'
                                     : ed ? 'no selection: drag on the waveform, or [ and ] at the playhead' : '';
    for (const b of document.querySelectorAll('#edit-panel .sel-act')) b.disabled = off || !sel;
    $('#edit-save').disabled = off || !v || !v.audio;
    $('#edit-grow-len').placeholder = v ? String(Math.round(v.semantic.length / FPS)) : '';
}

function show() {
    showLive();
    const v = cur();
    // history
    const vh = clear($('#edit-versions'));
    if (ed) ed.versions.forEach((x, i) => vh.appendChild(h('button.small' + (i === ed.at ? '.primary' : ''), {
        title: x.label, onclick: () => { if (!work) goTo(i, true); },
    }, 'v' + i + ' ' + x.label)));
    // a regenerate's candidates, each heard in place
    const ch = $('#edit-candidates');
    clear(ch);
    ch.classList.toggle('off', !(v && v.cands));
    if (v && v.cands) {
        ch.appendChild(h('div.k-row', null, h('span.ed-label', null, 'Candidates'),
            h('span.dim', null, 'each new music for ' + fmt(v.span[0]) + '–' + fmt(v.span[1]) + '; fit = how well what follows fits (lower is better)')));
        const row = h('div.ed-cand-row');
        v.cands.forEach((c, k) => row.appendChild(h('div.ed-cand' + (k === v.chosen ? '.chosen' : ''), null,
            h('b', null, letter(k)),
            h('span.dim', null, 'fit ' + c.score.toFixed(2) + (k === 0 ? ' (best)' : '')),
            h('button.small', { title: 'hear it in place, from 2 s before', disabled: !!work, onclick: () => pickCandidate(k, true) }, '▶ hear'),
            k === v.chosen ? h('span.dim', null, 'in use') : h('button.small', { disabled: !!work, onclick: () => pickCandidate(k, false) }, 'use'))));
        ch.appendChild(row);
    }
}

/** Select [a, b) frames (tests). */
export function setSelection(a, b) { tl.setSelection(a, b); }
export function editorState() { return ed; }
export function editorBusy() { return !!job || !!work; }

/**
 * deps: { models() -> { yue, vae }, sampling() -> the Sampling panel's AR
 * options, canRun() -> no radio / lab job, progress(frac), log, status }.
 */
export function buildEditor(d) {
    deps = d;
    tl.buildTimeline({ undo, redo });
    tl.onTimelineChange(showLive);
    $('#edit-refresh').addEventListener('click', renderList);
    $('#edit-regen').addEventListener('click', regenerate);
    $('#edit-cut').addEventListener('click', cut);
    $('#edit-grow').addEventListener('click', grow);
    $('#edit-save').addEventListener('click', saveVersion);
    $('#edit-stop').addEventListener('click', () => { if (job) { job.cancel(); deps.log.add('editor: cancel requested'); } });
    renderList();
    show();
}

/** On the Edit tab the main area is the editor alone; leaving it stops what the editor plays. */
export function revealEditor(on) {
    document.body.classList.toggle('editing', !!on);
    if (on) renderList();
    else tl.stop();
}

let lastShow = 0;
export function tickEditor() {
    if (!document.body.classList.contains('editing')) return;
    tl.tickTimeline();
    // the job chip's progress moves with the step, a few times a second
    if (work && performance.now() - lastShow > 150) { lastShow = performance.now(); showLive(); }
}
