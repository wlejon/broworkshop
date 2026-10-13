// The Radio: yue.stream (YuE2Stream, bro docs/music-api.js) driven from the
// lab. A stream plays songs as they are built and steers them live:
//
//   songs      by default the radio's own: a fresh random concept per song
//              (radio_concepts.js: genre, mood, instruments, vocal, language,
//              tempo; title and lyrics from its seed), under the "what plays"
//              pins, handed to the stream when it asks ('want'); aheadSongs
//              30 s previews are kept built, so a skip is instant. Or the
//              Song panel's song (source), continued with the next seed
//   keep       a preview you do not skip becomes the whole song once the next
//              one is ready to skip to (or as its preview runs short): 30 s
//              of this one, 30 s of the next, the rest of this one, the next
//   player     the program audio (crossfades mixed in by the stream) through
//              one engine stream; its playhead paces the stream
//   knobs      energy / texture / percussion and the semantic steers
//              (arrangement and the style axes bro.music.knobRanges lists),
//              for the songs queued after a change: every song that exists
//              plays as it was started (skip to reach the change sooner)
//   plan       the next song's ABC score, editable, applied with setNextPlan
//
// A stream holds the model and the VAE until onDone, so the lab's other jobs
// are disabled while it runs (main.js asks `running`).

import { $ } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";
import { frameLoop } from "/lib/kit/ui.js";
import { programPlayer } from "./radio_player.js";
import { knobSliders, normMeter, programReadout, songMeters, songState, nowPlaying, playedList,
         knobRanges, PROGRAM_RATE, FRAME_SAMPLES } from "./radio_view.js";
import { conceptSupply, styleControls, conceptBoard, defaultStyle } from "./radio_concepts.js";
import { conceptTags } from "./concepts.js";
import { pickFolderAsync } from "/lib/kit/ml.js";
import { prefStore } from "/lib/kit/prefs.js";
import { saveTake } from "./takes.js";
import { radioVisual } from "./radio_visual.js";

// Keep playing: make the song on air whole once a preview is ready to skip
// to, or when its preview has this little left with none ready.
const KEEP_LEFT_SECONDS = 14;
// Played songs the stream keeps the audio of, for a save from the Played list.
const KEEP_PLAYED = 3;

// Start options (read once, by yue.stream) and per-song options (read by
// each enqueue). The defaults are the stream's own (docs/music-api.js),
// but for aheadSongs and previewSeconds: the radio keeps three 30 s previews
// built (scan mode: Make full song, or auto full, continues one).
export const START_DEFAULTS = { aheadSongs: 3, previewSeconds: 30, crossfadeSeconds: 3, windows: '250, 500', left: 25, right: 25,
                                emitLeadSeconds: 0.75, decodeLeadSeconds: 6 };
export const SONG_DEFAULTS = { odeSteps: 32 };
export const startOpts = Object.assign({}, START_DEFAULTS);
export const songOpts = Object.assign({}, SONG_DEFAULTS);

let st = null, stopping = false, deps = null, mode = 'concepts';
let knobs = null, norm = null, meters = null, prog = null, startPanel = null, songPanel = null;
let supply = null, board = null, styleUi = null, now = null, played = null, visual = null;
const kept = new Set();       // songs keep playing has made whole (or you kept)
// Saves: song index -> { path, state: waiting (for the whole song) / sent /
// saved / failed, text }.
const saves = new Map();
const player = programPlayer();
// The "what plays" pins (radio_concepts.js), shared by the supply and its controls.
export const radioStyle = defaultStyle();

// What the radio has seen, for the view and for tests.
const state = {
    events: [],               // every YuE2StreamEvent but 'window', in order
    plans: new Map(),         // song index -> ABC text
    known: new Map(),         // song index -> its last stats row (kept after it leaves stats)
    playhead: 0, emitted: 0,
    onAir: -1, next: -1,
    queued: 0,               // songs this radio enqueued (the first included)
    planFor: -1, planDirty: false, planApplied: false,
    lastDone: null,
    requests: [],             // every song request this radio enqueued: { index, source, style, lyrics, tag }
    wants: [],                // every 'want' value the stream sent
};

export function radioStream() { return st; }
export function radioState() { return state; }
export function radioPlayer() { return player; }
export function radioSupply() { return supply; }

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
    const typed = $('#radio-tag').value.trim();
    return Object.assign(base, { odeSteps: songOpts.odeSteps, tag: typed || autoTag(base.style, state.queued + 1) });
}

// Hand a request to the stream. The stream numbers songs in enqueue order
// from 0; with concepts its own continuation is off, so the index is this
// radio's count. With the Song panel source the continuation adds songs of
// its own, so the index is not known here (-1).
function enqueueRequest(req, source) {
    const r = Object.assign({ odeSteps: songOpts.odeSteps }, req);
    const n = state.queued++;
    const index = mode === 'concepts' ? n : -1;
    st.enqueue(r);
    state.requests.push({ index, source, style: r.style, lyrics: r.lyrics, tag: r.tag });
    return index;
}

function resetState() {
    state.events = []; state.plans = new Map(); state.known = new Map();
    state.playhead = 0; state.emitted = 0; state.onAir = -1; state.next = -1;
    state.queued = 0;
    state.planFor = -1; state.planDirty = false; state.planApplied = false;
    state.lastDone = null; state.requests = []; state.wants = [];
    kept.clear(); saves.clear();
    norm.reset(); meters.reset(); played.reset();
    for (const k of prog.keys) prog.set(k, '—');
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
    mode = $('#radio-source').value;
    player.reset(startOpts.emitLeadSeconds + 3);
    if (mode === 'concepts') { board.reset(); supply.reset(); }
    try {
        // Concepts: the stream asks ('want') and the supply answers with a
        // fresh concept each time; the stream's own continuation is off.
        // The Song panel: its song first, then the stream's continuation
        // (radio continue) fills each want at once.
        const songMode = mode !== 'concepts';
        st = yue.stream({
            vae, songs: [],
            radio: songMode && $('#radio-continue').checked,
            aheadSongs: startOpts.aheadSongs,
            previewSeconds: startOpts.previewSeconds,
            keepPlayed: KEEP_PLAYED,
            autoFull: $('#radio-autofull').checked,
            wantGraceSeconds: songMode ? 0 : 10,
            crossfadeSeconds: startOpts.crossfadeSeconds,
            windows, left: startOpts.left, right: startOpts.right,
            emitLeadSeconds: startOpts.emitLeadSeconds, decodeLeadSeconds: startOpts.decodeLeadSeconds,
            knobs: knobs.values(),
            onAudio, onEvent, onDone,
        });
        if (songMode) enqueueRequest(song(), 'song panel');
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
    deps.log.add('radio on (' + (mode === 'concepts' ? 'random concepts' : 'the Song panel\'s song') + '): ' +
                 startOpts.aheadSongs + (startOpts.previewSeconds > 0
                     ? ' previews of ' + startOpts.previewSeconds + ' s kept built ahead' + ($('#radio-autofull').checked ? ' (auto full)' : '')
                     : ' songs kept built ahead') + ', ' + windows.join('/') + ' frame windows, ' +
                 startOpts.crossfadeSeconds.toFixed(1) + ' s crossfade', 'ok');
    if (mode === 'concepts') supply.prime();
    reveal();
    deps.onRunning(true);
}

function enqueue() {
    if (!st) return;
    const s = song();
    try { enqueueRequest(s, 'song panel'); } catch (e) { deps.status.error('enqueue: ' + e.message); return; }
    deps.log.add('queued "' + s.tag + '" (seed ' + s.seed + ', score ' + s.cot + ')');
}

// The style pins changed: new ideas in the new style, and queued songs in
// the old one that are not built yet make way (built ones still skip
// instantly).
function restyled() {
    const n = supply.restyle(st && mode === 'concepts' ? st.stats : null);
    if (n) deps.log.add('new style: ' + n + ' unbuilt song' + (n === 1 ? '' : 's') + ' in the old one dropped');
}

function stop() {
    if (!st || stopping) return;
    stopping = true;
    st.stop();
    deps.log.add('radio stop requested');
    deps.onRunning(true);
}

/** Keep the song on air: it continues past its preview into the whole song. */
function keep(why) {
    if (!st || state.onAir < 0 || kept.has(state.onAir)) return;
    kept.add(state.onAir);
    st.makeFull(state.onAir);
    deps.log.add('keep #' + state.onAir + ' (' + why + '): the whole song');
}

// Saves go to one folder (the "saves to" line changes it), no dialog: a
// WAV per song named <date>_<time>_<title>.wav, so a folder sorts by when
// and a DAW takes them as they are. Beside it the lyrics (.txt), and under
// takes/<same name>/ the song's take (lib/takes.js: tokens, plan, latents,
// conditioning), for reuse in the lab.
const savePrefs = prefStore('yue2-lab.saves', { dir: '' });
export function saveDir() {
    return savePrefs.data.dir || require('node:path').join(require('node:os').homedir(), 'Music', 'YuE2');
}
export function setSaveDir(dir) { savePrefs.set({ dir: dir || '' }); showSaveDir(); }
function showSaveDir() { const el = $('#radio-save-dir'); if (el) { el.textContent = saveDir(); el.title = saveDir(); } }

const pad2 = (n) => String(n).padStart(2, '0');
/** "2026-10-12_14-03-27" in local time. */
export function stampOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' +
           pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
}
/** A WAV path in `dir` named for now and `title` that no file (or take) has yet. */
export function savePathFor(dir, title, when) {
    const fs = require('node:fs'), path = require('node:path');
    const name = String(title || 'song').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'song';
    const stem = stampOf(when || new Date()) + '_' + name;
    const taken = (s) => fs.existsSync(path.join(dir, s + '.wav')) || fs.existsSync(path.join(dir, 'takes', s)) ||
                         [...saves.values()].some((v) => v.stem === s);
    let s = stem;
    for (let n = 2; taken(s); n++) s = stem + '_' + n;
    return { stem: s, wav: path.join(dir, s + '.wav') };
}

// Save a song as a WAV (the stream writes its own audio, no crossfades). The
// song on air is kept and saved once it is whole; a played one is saved as
// it played.
function save(index) {
    if (!st || index < 0) return;
    const d = describe(index, state.known.has(index) ? state.known.get(index).tag : '');
    const dir = saveDir();
    try { require('node:fs').mkdirSync(dir, { recursive: true }); } catch (e) {
        deps.status.error('save: cannot make ' + dir + ': ' + e.message); return;
    }
    const { stem, wav } = savePathFor(dir, d.title);
    saves.set(index, { path: wav, dir, stem, state: 'waiting', text: '' });
    if (index === state.onAir) keep('you saved it');
    st.saveSong(index, wav);   // the stream writes it once it is whole
    deps.log.add('save #' + index + ' ' + d.title + ' → ' + wav);
}

function saved(e) {
    const v = saves.get(e.song);
    if (!v) return;
    if (e.value < 0) {
        v.state = 'failed'; v.text = e.text;
        deps.log.add('save #' + e.song + ' failed: ' + e.text, 'err');
        return;
    }
    v.state = 'saved'; v.text = e.text;
    const d = describe(e.song, e.tag);
    const path = require('node:path');
    try {
        require('node:fs').writeFileSync(e.text.replace(/\.wav$/i, '.txt'),
            d.title + '\n' + d.tags + '\n\n' + (d.lyrics || '').trim() + '\n');
    } catch (err) { deps.log.add('save #' + e.song + ' lyrics: ' + err.message, 'warn'); }
    if (e.take) {
        try {
            const t = e.take;
            saveTake(path.join(v.dir, 'takes', v.stem), {
                kind: 'radio', seed: t.seed, style: t.style, lyrics: t.lyrics, cot: t.cot, cfgScale: t.cfgScale,
                settings: { knobs: knobs.values() }, abc: t.plan ? t.plan.abc : '', plan: t.plan, frames: t.frames,
                semantic: t.semantic, latents: t.latents, energy: t.energy,
                title: d.title, tags: d.tags, wav: path.relative(path.join(v.dir, 'takes', v.stem), e.text).replace(/\\/g, '/'),
                when: new Date(),
            });
        } catch (err) { deps.log.add('save #' + e.song + ' take: ' + err.message, 'warn'); }
    }
    played.mark(e.song, 'saved ✓');
    deps.log.add('saved #' + e.song + ' ' + d.title + ': ' + clockText(e.seconds) + (e.value ? '' : ' (not the whole song)') +
                 ' → ' + e.text, 'ok');
}

const clockText = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

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
        case 'breakWarning':
            norm.warn(e.value, performance.now());
            deps.log.add('break warning ' + who + ': latent norm ' + e.value.toFixed(2), 'warn');
            break;
        case 'songEnd':
            deps.log.add('song ' + who + ' ends at ' + fmtSec(e.sample));
            played.add(describe(e.song, e.tag));
            if (mode === 'concepts') supply.gone(e.song, 'played');
            break;
        case 'firstAudio': deps.log.add('first audio ' + who + ': ' + e.seconds.toFixed(2) + ' s', 'ok'); break;
        case 'error': deps.log.add('radio ' + who + ': ' + e.text, 'err'); deps.status.warn('radio: ' + e.text); break;
        case 'idle':
            if (mode === 'concepts') break;   // the first songs are still being written
            deps.log.add('radio idle: the queue is played out'); deps.status.set('radio idle: queue a song');
            break;
        case 'want':
            state.wants.push(e.value);
            if (mode === 'concepts') supply.want(e.value);
            break;
        case 'built':
            deps.log.add('built ' + who + ': ' + (e.frames / 25).toFixed(0) + ' s of audio waiting, ' + e.seconds.toFixed(1) + ' s after it was queued', 'ok');
            break;
        case 'full':
            if (e.value) deps.log.add('full song ' + who + ': continuing from ' + (e.frame0 / 25).toFixed(1) + ' s', 'ok');
            else deps.log.add('full song ' + who + ': too late (it has ended, or its successor is on air)', 'warn');
            break;
        case 'saved': saved(e); break;
        case 'dropped':
            deps.log.add('dropped ' + who);
            if (mode === 'concepts') supply.gone(e.song, 'dropped');
            break;
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

function tick(dt) {
    norm.tick(performance.now());
    visual.tick(dt);   // draws only while the card is laid out
    board.render(supply, st ? st.stats : null);
    if (!st) { now.render(null, null, 0, false); return; }
    const ph = player.tick();
    st.setPlayhead(ph);
    const s = st.stats;
    if (mode === 'concepts') supply.tick(s);
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
    const readyAhead = songs.filter((r) => r.index > onAir && !r.gone && !r.dropped && r.ready &&
                                           (r.start < 0 || r.start > s.playhead)).length;
    if (air && air.preview && !kept.has(onAir) && $('#radio-keep').checked) {
        const left = (air.start + air.previewFrames * FRAME_SAMPLES - s.playhead) / PROGRAM_RATE;
        if (readyAhead > 0) keep('the next song is ready');
        else if (left < KEEP_LEFT_SECONDS) keep('its preview is running out');
    }
    now.render(air ? describe(air.index, air.tag) : null, air, s.playhead, kept.has(onAir), saves.get(onAir));
    setText('#radio-next-meta', readyAhead + ' ready to skip to');
    const ps = player.stats();
    prog.set({
        onair: air ? '#' + air.index + ' ' + air.tag + ' (' + songState(air, s.playhead) + ')' : 'nothing yet',
        playhead: fmtSec(s.playhead),
        emitted: fmtSec(s.emitted),
        lead: ((s.emitted - s.playhead) / PROGRAM_RATE).toFixed(2) + ' s',
        firstAudio: s.firstAudioSeconds > 0 ? s.firstAudioSeconds.toFixed(2) + ' s' : '—',
        ahead: aheadText(s, songs),
        fullSong: fullText(air),
        ring: ps.bufferedSec.toFixed(2) + ' s',
        underrun: ps.underrunSec.toFixed(2) + ' s',
    });
    setText('#radio-meta', (stopping ? 'stopping… · ' : '') + songs.filter((r) => !r.gone).length + ' in the queue');
}

// "3 previews ready" (built after the song on air), or the songs-ahead count
// without previews.
function aheadText(s, songs) {
    const mb = ' · ' + (s.hostBytes / 1e6).toFixed(0) + ' MB';
    if (!(startOpts.previewSeconds > 0)) {
        return s.readyAhead + ' of ' + s.ahead + ' ready' +
               (s.ahead < startOpts.aheadSongs ? ' (building toward ' + startOpts.aheadSongs + ')' : '') + mb;
    }
    const after = songs.filter((r) => r.index > state.onAir && !r.gone && !r.dropped && (r.start < 0 || r.start > s.playhead));
    const ready = after.filter((r) => r.ready).length;
    return ready + ' preview' + (ready === 1 ? '' : 's') + ' ready' +
           (ready < startOpts.aheadSongs ? ' (building toward ' + startOpts.aheadSongs + ')' : '') + mb;
}

// The song on air: "preview", or "full song: generating 64%" (latents over
// the plan's estimate) until it is built.
function fullText(air) {
    if (!air) return '—';
    if (air.preview) return 'preview (' + (air.previewFrames / 25).toFixed(0) + ' s): Make full song continues it';
    if (air.built) return 'full song: built';
    const pct = air.estimateFrames > 0 ? Math.min(99, Math.round(100 * air.latentFrames / air.estimateFrames)) : 0;
    return 'full song: generating ' + (air.estimateFrames > 0 ? pct + '%' : (air.latentFrames / 25).toFixed(0) + ' s');
}

// ── buttons ──────────────────────────────────────────────────────────────────
export function radioRunning() { return !!st; }

/** Enable the radio's controls for the lab's state (main.js updateButtons). */
export function syncRadio(loaded, jobBusy) {
    const on = !!st && !stopping;
    // One power button: Start while off, Stop while on (Stopping… until onDone).
    $('#radio-start').hidden = !!st;
    $('#radio-stop').hidden = !st;
    $('#radio-start').disabled = !loaded || jobBusy || !!st;
    $('#radio-stop').textContent = stopping ? 'Stopping…' : '■ Stop';
    $('#radio-full').disabled = !on || !(startOpts.previewSeconds > 0);
    for (const id of ['radio-enqueue', 'radio-skip-now', 'radio-stop']) $('#' + id).disabled = !on;
    $('#radio-plan-apply').disabled = !on;
    $('#radio-continue').disabled = !!st;
    $('#radio-source').disabled = !!st;
    for (const inp of document.querySelectorAll('#radio-start-params input')) inp.disabled = !!st;
}

/** A song for the now-playing card and the played list: { index, title, tags, lyrics }. */
function describe(index, tag) {
    const c = mode === 'concepts' && supply ? supply.concept(index) : null;
    if (c) return { index, title: c.title || tag || '#' + index, tags: conceptTags(c).join(' · '), lyrics: c.lyrics };
    const r = state.requests.find((x) => x.index === index);
    return { index, title: tag || (r && r.tag) || '#' + index, tags: r ? r.style : '', lyrics: r ? r.lyrics : '' };
}

let tabActive = false;
/**
 * The main area on the Radio tab is the radio alone: its panels show (and
 * the lab's pipeline panels hide) on the tab, and the radio's whenever a
 * stream runs.
 */
export function reveal(onTab) {
    if (onTab !== undefined) tabActive = onTab;
    // The lab's pipeline transport (Generate … Load take) is not the radio's.
    document.body.classList.toggle('on-radio', tabActive);
    const show = tabActive || !!st;
    for (const p of document.querySelectorAll('.radio-main')) p.hidden = !show;
    for (const p of document.querySelectorAll('.k-main > .k-panel:not(.radio-main)')) p.hidden = tabActive;
}

/**
 * deps: { models() -> {yue, vae}, request() -> song request from the Song
 * panel, sampling() -> the Sampling panel's AR sampling (for concepts),
 * canStart() -> no lab job running, onRunning(bool), log, status }.
 */
export function buildRadio(d) {
    deps = d;
    knobs = knobSliders('#radio-knobs', knobInput);
    norm = normMeter('#radio-norm-row');
    meters = songMeters('#radio-songs');
    prog = programReadout('#radio-program');
    now = nowPlaying('#radio-now');
    visual = radioVisual($('#radio-vis'), $('#radio-vis-ctl'));
    played = playedList('#radio-history', save, KEEP_PLAYED);
    supply = conceptSupply({
        enqueue: (req) => enqueueRequest(Object.assign(deps.sampling ? deps.sampling() : {}, req), 'concept'),
        drop: (index) => { if (st) st.drop(index); },
        log: (t, cls) => deps.log.add(t, cls),
    }, radioStyle);
    board = conceptBoard('#radio-concepts', {
        reroll: (id) => supply.reroll(id),
        edit: (id, patch) => supply.edit(id, patch),
        drop: (index) => { if (st) { st.drop(index); deps.log.add('drop #' + index); } },
    });
    styleUi = styleControls('#radio-style', radioStyle, restyled);
    params('#radio-concept-params', supply, {
        waiting: { min: 0, max: 6, step: 1, label: 'ideas ahead', hint: 'song ideas kept rolled and editable before the stream takes them' },
    });
    startPanel = params('#radio-start-params', startOpts, {
        aheadSongs:        { min: 1, max: 8, step: 1, label: 'songs ahead', fmt: (v) => v + ' built',
                             hint: 'songs (or previews) kept built after the one playing, so a skip is instant (one builds at a time; ~66 MB host memory a full song, ~12 MB a 30 s preview)' },
        previewSeconds:    { min: 0, max: 120, step: 10, label: 'preview', fmt: (v) => v > 0 ? v + ' s' : 'off (whole songs)',
                             hint: 'build each song as a preview this long (~11 s of GPU, not ~45); Make full song continues one seamlessly, with the knobs it was built with' },
        crossfadeSeconds:  { min: 2, max: 4, step: 0.1, label: 'crossfade', fmt: (v) => v.toFixed(1) + ' s',
                             hint: 'song to song, equal power' },
        windows:           { label: 'NAR windows', hint: 'frames: the first window, then the size that repeats (250, 500)' },
        left:              { min: 0, max: 100, step: 1, label: 'left context', fmt: (v) => v + ' fr', hint: 'inpainted frames left of each window' },
        right:             { min: 0, max: 100, step: 1, label: 'lookahead', fmt: (v) => v + ' fr', hint: 'frames solved past each window' },
        emitLeadSeconds:   { min: 0.25, max: 3, step: 0.05, label: 'emit lead', fmt: (v) => v.toFixed(2) + ' s',
                             hint: 'audio handed out ahead of the playhead' },
        decodeLeadSeconds: { min: 1, max: 20, step: 0.5, label: 'decode lead', fmt: (v) => v.toFixed(1) + ' s',
                             hint: 'audio decoded ahead of the playhead while a song is still building (in 2 s blocks); a built song decodes whole' },
    });
    songPanel = params('#radio-song-params', songOpts, {
        odeSteps: { min: 1, max: 64, step: 1, label: 'ODE steps', hint: 'midpoint steps per NAR window (each song you queue from now)' },
    });
    $('#radio-start').addEventListener('click', start);
    $('#radio-enqueue').addEventListener('click', enqueue);
    const skip = () => { if (st) { st.skip(); deps.log.add('skip'); } };
    $('#radio-skip-now').addEventListener('click', skip);
    $('#radio-full').addEventListener('click', () => keep('you kept it'));
    $('#radio-save').addEventListener('click', () => save(state.onAir));
    showSaveDir();
    $('#radio-save-dir-change').addEventListener('click', async () => {
        const p = await pickFolderAsync(saveDir());
        if (p) { setSaveDir(p); deps.log.add('saves go to ' + p); }
    });
    $('#radio-autofull').addEventListener('change', (e) => {
        if (st) { st.setAutoFull(e.target.checked); deps.log.add('auto full ' + (e.target.checked ? 'on' : 'off')); }
    });
    $('#radio-stop').addEventListener('click', stop);
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
