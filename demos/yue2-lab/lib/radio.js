// The Radio: yue.stream (YuE2Stream, bro docs/music-api.js) driven from the
// lab. A stream plays songs as they are built and steers them live:
//
//   queue      songs from the Song panel's current style / lyrics / score
//              mode / seed / sampling; with radio continue on, an empty queue
//              continues with the last request and the next seed
//   player     the program audio (crossfades mixed in by the stream) through
//              one engine stream; its playhead paces the stream
//   interrupt  "energetic now" / "calm now": a latent offset (stage 1), then
//              an arrangement-steered continuation (stage 2)
//   knobs      energy / texture / percussion / arrangement, applied live
//   plan       the next song's ABC score, editable, applied with setNextPlan
//
// A stream holds the model and the VAE until onDone, so the lab's other jobs
// are disabled while it runs (main.js asks `running`).

import { $ } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { frameLoop } from "/lib/kit/ui.js";
import { programPlayer } from "./radio_player.js";
import { knobSliders, normMeter, programReadout, interruptReadout, songMeters, songState,
         knobRanges, PROGRAM_RATE } from "./radio_view.js";

// Start options (read once, by yue.stream) and per-song options (read by
// each enqueue). The defaults are the stream's own (docs/music-api.js).
export const START_DEFAULTS = { crossfadeSeconds: 3, windows: '250, 500', left: 25, right: 25,
                                emitLeadSeconds: 0.75, decodeLeadSeconds: 6 };
export const SONG_DEFAULTS = { odeSteps: 32 };
export const startOpts = Object.assign({}, START_DEFAULTS);
export const songOpts = Object.assign({}, SONG_DEFAULTS);

let st = null, stopping = false, deps = null;
let knobs = null, norm = null, meters = null, prog = null, intr = null, startPanel = null, songPanel = null;
const player = programPlayer();

// What the radio has seen, for the view and for tests.
const state = {
    events: [],               // every YuE2StreamEvent but 'window', in order
    plans: new Map(),         // song index -> ABC text
    known: new Map(),         // song index -> its last stats row (kept after it leaves stats)
    playhead: 0, emitted: 0,
    onAir: -1, next: -1,
    interrupt: { 1: -1, 2: -1 },
    queued: 0,                // songs this radio enqueued (the first included)
    planFor: -1, planDirty: false, planApplied: false,
    lastDone: null,
};

export function radioStream() { return st; }
export function radioState() { return state; }
export function radioPlayer() { return player; }

const fmtSec = (samples) => (samples / PROGRAM_RATE).toFixed(1) + ' s';

/** "250, 500" -> [250, 500], or null when it is not a list of positive frame counts. */
export function parseWindows(text) {
    const parts = String(text || '').split(/[\s,]+/).filter(Boolean);
    const out = parts.map((p) => parseInt(p, 10));
    if (!out.length || out.some((n) => !Number.isFinite(n) || n <= 0) || parts.some((p) => !/^\d+$/.test(p))) return null;
    return out;
}

function autoTag(style, n) {
    const first = String(style || '').split(',')[0].trim();
    return (first || 'song') + ' ' + n;
}

/** One queue entry from the Song panel (deps.request) plus the radio's song options. */
function song() {
    const base = deps.request();
    state.queued++;
    const typed = $('#radio-tag').value.trim();
    return Object.assign(base, { odeSteps: songOpts.odeSteps, tag: typed || autoTag(base.style, state.queued) });
}

function resetState() {
    state.events = []; state.plans = new Map(); state.known = new Map();
    state.playhead = 0; state.emitted = 0; state.onAir = -1; state.next = -1;
    state.interrupt = { 1: -1, 2: -1 }; state.queued = 0;
    state.planFor = -1; state.planDirty = false; state.planApplied = false;
    state.lastDone = null;
    norm.reset(); meters.reset();
    for (const k of intr.keys) intr.set(k, '—', false);
    for (const k of prog.keys) prog.set(k, '—');
    $('#radio-knobs-heard').textContent = '';
    $('#radio-plan').value = '';
    $('#radio-plan-meta').textContent = '';
}

// ── controls ─────────────────────────────────────────────────────────────────
function start() {
    const { yue, vae } = deps.models();
    if (!yue || !vae) { deps.status.warn('load the models first'); return; }
    if (st) { deps.status.warn('the radio is already on'); return; }
    if (!deps.canStart()) { deps.status.warn('a job is running: Stop it first'); return; }
    const windows = parseWindows(startOpts.windows);
    if (!windows) { deps.status.warn('NAR windows: frame counts, e.g. 250, 500'); return; }
    resetState();
    player.reset(startOpts.emitLeadSeconds + 3);
    try {
        st = yue.stream({
            vae, songs: [song()],
            radio: $('#radio-continue').checked,
            crossfadeSeconds: startOpts.crossfadeSeconds,
            windows, left: startOpts.left, right: startOpts.right,
            emitLeadSeconds: startOpts.emitLeadSeconds, decodeLeadSeconds: startOpts.decodeLeadSeconds,
            knobs: knobs.values(),
            onAudio, onEvent, onDone,
        });
    } catch (e) {
        st = null;
        deps.status.error('radio: ' + e.message);
        deps.log.add('radio: ' + e.message, 'err');
        return;
    }
    stopping = false;
    knobs.setRanges(st.knobRanges);
    knobs.setApplied(st.knobs);
    deps.status.busy('radio on');
    deps.log.add('radio on: ' + windows.join('/') + ' frame windows, ' + startOpts.crossfadeSeconds.toFixed(1) +
                 ' s crossfade, radio continue ' + ($('#radio-continue').checked ? 'on' : 'off'), 'ok');
    reveal();
    deps.onRunning(true);
}

function enqueue() {
    if (!st) return;
    const s = song();
    try { st.enqueue(s); } catch (e) { deps.status.error('enqueue: ' + e.message); return; }
    deps.log.add('queued "' + s.tag + '" (seed ' + s.seed + ', score ' + s.cot + ')');
}

function stop() {
    if (!st || stopping) return;
    stopping = true;
    st.stop();
    deps.log.add('radio stop requested');
    deps.onRunning(true);
}

function interrupt(amount) {
    if (!st) return;
    st.interrupt(amount);
    state.interrupt = { 1: -1, 2: -1 };
    intr.set('int1', 'waiting…', false); intr.set('int2', 'waiting…', false);
    deps.log.add(amount > 0 ? 'interrupt: energetic now' : 'interrupt: calm now');
}

function knobInput(name, v) {
    if (!st) { knobs.setApplied(null); return; }
    knobs.setApplied(st.setKnobs({ [name]: v }));
}

function applyPlan() {
    if (!st || state.planFor < 0) return;
    const abc = $('#radio-plan').value;
    try { st.setNextPlan(abc); } catch (e) { deps.status.error('setNextPlan: ' + e.message); return; }
    state.planDirty = false; state.planApplied = true;
    $('#radio-plan-meta').textContent = '#' + state.planFor + ' · your score applied: rebuilding from the plan';
    deps.log.add('next song #' + state.planFor + ': edited score applied', 'ok');
}

// ── stream callbacks ─────────────────────────────────────────────────────────
function onAudio(c) {
    try { player.push(c); } catch (e) { deps.log.add('radio player: ' + e.message, 'err'); }
}

function onEvent(e) {
    if (e.kind !== 'window') {
        state.events.push({ kind: e.kind, song: e.song, tag: e.tag, sample: e.sample, frames: e.frames,
                            seconds: e.seconds, value: e.value, text: e.kind === 'plan' ? '' : e.text });
        if (state.events.length > 4000) state.events.splice(0, 1000);
    }
    const who = '#' + e.song + ' ' + (e.tag || '');
    switch (e.kind) {
        case 'plan':
            state.plans.set(e.song, e.text || '');
            deps.log.add('plan ' + who + ': ' + (e.text ? e.text.split('\n').length + ' lines of score' : 'no score'));
            if (e.song === state.planFor && !state.planDirty) { state.planApplied = false; showPlan(e.song); }
            break;
        case 'songStart': deps.log.add('song ' + who + ' placed on the program at ' + fmtSec(e.sample)); break;
        case 'semanticDone': deps.log.add('semantic ' + who + ': ' + e.frames + ' frames (' + (e.frames / 25).toFixed(1) + ' s)'); break;
        case 'window': norm.set(e.value); break;
        case 'interrupt':
            state.interrupt[e.value] = e.seconds;
            intr.set('int' + e.value, e.seconds.toFixed(2) + ' s', true);
            deps.log.add('interrupt stage ' + e.value + ' audible ' + e.seconds.toFixed(2) + ' s after the press', 'ok');
            break;
        case 'knobs':
            $('#radio-knobs-heard').textContent = 'heard: ' + e.text + ' from ' + fmtSec(e.sample);
            break;
        case 'breakWarning':
            norm.warn(e.value, performance.now());
            deps.log.add('break warning ' + who + ': latent norm ' + e.value.toFixed(2), 'warn');
            break;
        case 'songEnd': deps.log.add('song ' + who + ' ends at ' + fmtSec(e.sample)); break;
        case 'firstAudio': deps.log.add('first audio ' + who + ': ' + e.seconds.toFixed(2) + ' s', 'ok'); break;
        case 'error': deps.log.add('radio ' + who + ': ' + e.text, 'err'); deps.status.warn('radio: ' + e.text); break;
        case 'idle': deps.log.add('radio idle: the queue is played out'); deps.status.set('radio idle: queue a song'); break;
    }
}

function onDone(info) {
    state.lastDone = info;
    st = null; stopping = false;
    player.stop();
    knobs.setApplied(null);
    if (info && info.error) { deps.status.error('radio: ' + info.error); deps.log.add('radio: ' + info.error, 'err'); }
    else { deps.status.ok('radio off'); deps.log.add('radio off', 'ok'); }
    reveal();
    deps.onRunning(false);
}

// ── per frame ────────────────────────────────────────────────────────────────
function setText(sel, s) { const n = $(sel); if (n.textContent !== s) n.textContent = s; }

// The box shows the next song's score until you edit it; an applied edit
// stays until that song's plan comes back from the stream.
function showPlan(index) {
    const box = $('#radio-plan');
    const has = state.plans.has(index);
    const text = has ? state.plans.get(index) : '';
    if (box.value !== text) box.value = text;
    const k = state.known.get(index);
    setText('#radio-plan-meta', '#' + index + ' ' + (k ? k.tag : '') + ' · ' +
        (!has ? 'waiting for its plan' : text ? text.split('\n').length + ' lines' : 'no score (score off): type one to give it one'));
}

function updatePlan() {
    const next = state.next;
    if (next !== state.planFor) {
        state.planFor = next;
        state.planDirty = false; state.planApplied = false;
        if (next < 0) {
            $('#radio-plan').value = '';
            setText('#radio-plan-meta', 'no next song: queue one, or turn radio continue on');
        } else showPlan(next);
    } else if (next >= 0 && !state.planDirty && !state.planApplied) showPlan(next);
}

function tick() {
    norm.tick(performance.now());
    if (!st) return;
    const ph = player.tick();
    st.setPlayhead(ph);
    const s = st.stats;
    state.playhead = s.playhead; state.emitted = s.emitted;
    const live = new Set();
    for (const row of s.songs) { state.known.set(row.index, row); live.add(row.index); }
    for (const [i, row] of state.known) if (!live.has(i) && !row.gone) { row.gone = true; if (row.end < 0) row.dropped = true; }
    const songs = [...state.known.values()].sort((a, b) => a.index - b.index).slice(-8);
    // On air: the latest song whose program start the playhead has passed.
    let onAir = -1;
    for (const r of songs) if (r.start >= 0 && r.start <= s.playhead && (r.end < 0 || s.playhead < r.end)) onAir = r.index;
    state.onAir = onAir;
    const cur = onAir >= 0 ? onAir : (s.songs.length ? s.songs[0].index : -1);
    const nxt = songs.find((r) => r.index > cur && !r.dropped);
    state.next = nxt && cur >= 0 ? nxt.index : -1;
    meters.render(songs, s.playhead);
    updatePlan();
    const air = state.known.get(onAir);
    const ps = player.stats();
    prog.set({
        onair: air ? '#' + air.index + ' ' + air.tag + ' (' + songState(air, s.playhead) + ')' : 'nothing yet',
        playhead: fmtSec(s.playhead),
        emitted: fmtSec(s.emitted),
        lead: ((s.emitted - s.playhead) / PROGRAM_RATE).toFixed(2) + ' s',
        firstAudio: s.firstAudioSeconds > 0 ? s.firstAudioSeconds.toFixed(2) + ' s' : '—',
        ring: ps.bufferedSec.toFixed(2) + ' s',
        underrun: ps.underrunSec.toFixed(2) + ' s',
    });
    setText('#radio-meta', (stopping ? 'stopping… · ' : '') + songs.filter((r) => !r.gone).length + ' in the queue');
}

// ── buttons ──────────────────────────────────────────────────────────────────
export function radioRunning() { return !!st; }

/** Enable the radio's controls for the lab's state (main.js updateButtons). */
export function syncRadio(loaded, jobBusy) {
    const on = !!st && !stopping;
    $('#radio-start').disabled = !loaded || jobBusy || !!st;
    for (const id of ['radio-enqueue', 'radio-skip', 'radio-stop', 'radio-energetic', 'radio-calm']) $('#' + id).disabled = !on;
    $('#radio-plan-apply').disabled = !on;
    $('#radio-continue').disabled = !!st;
    for (const inp of document.querySelectorAll('#radio-start-params input')) inp.disabled = !!st;
}

let tabActive = false;
/** The main-area radio panels show on the Radio tab, and whenever a stream runs. */
export function reveal(onTab) {
    if (onTab !== undefined) tabActive = onTab;
    const show = tabActive || !!st;
    for (const p of document.querySelectorAll('.radio-main')) p.hidden = !show;
}

/**
 * deps: { models() -> {yue, vae}, request() -> song request from the Song
 * panel, canStart() -> no lab job running, onRunning(bool), log, status }.
 */
export function buildRadio(d) {
    deps = d;
    knobs = knobSliders('#radio-knobs', knobInput);
    norm = normMeter('#radio-norm-row');
    meters = songMeters('#radio-songs');
    prog = programReadout('#radio-program');
    intr = interruptReadout('#radio-interrupt');
    startPanel = params('#radio-start-params', startOpts, {
        crossfadeSeconds:  { min: 2, max: 4, step: 0.1, label: 'crossfade', fmt: (v) => v.toFixed(1) + ' s',
                             hint: 'song to song, equal power' },
        windows:           { label: 'NAR windows', hint: 'frames: the first window, then the size that repeats (250, 500)' },
        left:              { min: 0, max: 100, step: 1, label: 'left context', fmt: (v) => v + ' fr', hint: 'inpainted frames left of each window' },
        right:             { min: 0, max: 100, step: 1, label: 'lookahead', fmt: (v) => v + ' fr', hint: 'frames solved past each window' },
        emitLeadSeconds:   { min: 0.25, max: 3, step: 0.05, label: 'emit lead', fmt: (v) => v.toFixed(2) + ' s',
                             hint: 'audio handed out ahead of the playhead; a knob can still change what is not handed out' },
        decodeLeadSeconds: { min: 1, max: 20, step: 0.5, label: 'decode lead', fmt: (v) => v.toFixed(1) + ' s',
                             hint: 'audio decoded ahead of the playhead' },
    });
    songPanel = params('#radio-song-params', songOpts, {
        odeSteps: { min: 1, max: 64, step: 1, label: 'ODE steps', hint: 'midpoint steps per NAR window (each song you queue from now)' },
    });
    $('#radio-start').addEventListener('click', start);
    $('#radio-enqueue').addEventListener('click', enqueue);
    $('#radio-skip').addEventListener('click', () => { if (st) { st.skip(); deps.log.add('skip'); } });
    $('#radio-stop').addEventListener('click', stop);
    $('#radio-energetic').addEventListener('click', () => interrupt(1));
    $('#radio-calm').addEventListener('click', () => interrupt(-1));
    $('#radio-plan-apply').addEventListener('click', applyPlan);
    $('#radio-plan').addEventListener('input', () => {
        state.planDirty = true;
        if (state.planFor >= 0) $('#radio-plan-meta').textContent = '#' + state.planFor + ' · edited: Apply to rebuild it from this score';
    });
    $('#radio-start-defaults').addEventListener('click', () => {
        if (st) return;
        Object.assign(startOpts, START_DEFAULTS);
        Object.assign(songOpts, SONG_DEFAULTS);
        startPanel.refresh(); songPanel.refresh();
    });
    knobs.setApplied(null);
    meters.reset();
    frameLoop(tick);
    reveal();
    return { get running() { return !!st; }, get ranges() { return knobRanges(); } };
}
