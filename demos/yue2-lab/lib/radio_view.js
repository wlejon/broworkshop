// The radio's DOM: knob sliders, the per-song meters, the latent-norm meter
// and the readouts. No stream logic here (that is radio.js); every function
// takes plain stream stats and events.

import { $, h, clear } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { readout } from "/lib/kit/ui.js";

export const PROGRAM_RATE = 48000;
export const FRAME_SAMPLES = 1920;            // one latent frame of program audio

// The knob clamps, before any stream exists: bro.music.knobRanges is the
// one a stream reports as its knobRanges (docs/music-api.js), from the same
// constants the stream clamps with. Empty without bro.music.
export function knobRanges() {
    return (typeof bro !== 'undefined' && bro.music && bro.music.knobRanges) || {};
}
// A knob steers the songs queued after it moves; the songs that exist keep
// theirs (skip to hear it sooner).
export const KNOB_HINTS = {
    energy: 'latent offset along the energy direction: louder, brighter',
    texture: 'NAR steer after layer 21',
    percussion: 'NAR steer after layer 9: onsets',
    arrangement: 'semantic steer after layer 21: a real arrangement change',
    density: 'semantic style steer: full band (+) ↔ sparse (−)',
    timbre: 'semantic style steer: bright, aggressive (+) ↔ warm, mellow (−)',
};
const knobHint = (name) => (KNOB_HINTS[name] || 'semantic style steer') + '; for the songs to come';
// The Sound sliders' labels and order (the stream's knob names underneath).
const KNOB_LABELS = { energy: 'energy', density: 'sparse ↔ full', timbre: 'warm ↔ bright', arrangement: 'arrangement',
                      texture: 'texture', percussion: 'percussion' };
const knobOrder = (names) => names.sort((a, b) => {
    const k = Object.keys(KNOB_LABELS), ia = k.indexOf(a), ib = k.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

// The corpus range of a window's mean latent norm (breakWarning outside it),
// and the span the meter draws.
export const NORM_OK = [6.5, 9.5];
const NORM_SPAN = [5, 11];

const sec = (samples) => (samples / PROGRAM_RATE).toFixed(1) + ' s';
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * One slider per knob into `host`. onInput(name, value) fires as a slider
 * moves; right-click returns a knob to 0. Handle: values() (requested),
 * setRanges(r), setApplied(knobs | null), sliders.
 */
export function knobSliders(host, onInput) {
    const node = $(host);
    const sliders = {}, applied = {};
    const ranges = knobRanges();
    for (const name of knobOrder(Object.keys(ranges))) {
        const r = ranges[name];
        const input = h('input#knob-' + name, { type: 'range', min: r.min, max: r.max, step: name === 'percussion' ? 0.1 : 0.05, value: 0 });
        applied[name] = h('span.k-val#knob-' + name + '-val', { title: 'the value the stream applied (clamped)' }, '0.00');
        node.appendChild(h('label.k-field', { title: knobHint(name) }, h('span', null, KNOB_LABELS[name] || name), input, applied[name]));
        sliders[name] = input;
        bindControl(input, { reset: 0, onChange: (v) => onInput(name, v) });
    }
    return {
        sliders,
        values() {
            const o = {};
            for (const k in sliders) o[k] = Number(sliders[k].value);
            return o;
        },
        setRanges(ranges) {
            for (const k in sliders) {
                const r = ranges && ranges[k];
                if (!r) continue;
                sliders[k].min = String(r.min); sliders[k].max = String(r.max);
            }
        },
        /** The applied knobs, or null before a stream (the slider values then show as requested). */
        setApplied(k) {
            for (const name in applied) {
                const v = k ? k[name] : Number(sliders[name].value);
                const s = (+v).toFixed(2);
                if (applied[name].textContent !== s) applied[name].textContent = s;
                if (k && Math.abs(Number(sliders[name].value) - v) > 1e-6) sliders[name].value = String(v);
            }
        },
    };
}

/** A latent-norm meter with the 6.5..9.5 band marked and a break-warning lamp. */
export function normMeter(host) {
    const node = $(host);
    const fill = h('div.fill'), lo = h('div.mark'), hi = h('div.mark');
    const pos = (v) => clamp01((v - NORM_SPAN[0]) / (NORM_SPAN[1] - NORM_SPAN[0])) * 100 + '%';
    lo.style.left = pos(NORM_OK[0]); hi.style.left = pos(NORM_OK[1]);
    const meter = h('div.k-meter.norm#radio-norm', { title: 'mean latent norm of the last NAR window; the marks are the corpus range ' + NORM_OK.join('..') }, fill, lo, hi);
    const val = h('span.k-val#radio-norm-val', null, '—');
    const lamp = h('span.k-badge#radio-break', { title: 'a window left the corpus range: a steer may be breaking the audio' }, 'no break warning');
    node.append(h('span.k-cap', null, 'latent norm'), meter, val, lamp);
    let warnings = 0, litUntil = 0;
    return {
        set(norm) {
            fill.style.width = pos(norm);
            val.textContent = norm.toFixed(2);
            meter.classList.toggle('out', norm < NORM_OK[0] || norm > NORM_OK[1]);
        },
        warn(norm, nowMs) {
            warnings++;
            litUntil = nowMs + 4000;
            lamp.textContent = 'break warning ×' + warnings + ' (' + norm.toFixed(2) + ')';
            lamp.className = 'k-badge err on';
        },
        tick(nowMs) {
            if (lamp.classList.contains('on') && nowMs > litUntil) {
                lamp.classList.remove('on');
                lamp.className = 'k-badge warn';
            }
        },
        reset() {
            warnings = 0; litUntil = 0;
            fill.style.width = '0%'; val.textContent = '—';
            meter.classList.remove('out');
            lamp.textContent = 'no break warning'; lamp.className = 'k-badge';
        },
        get warnings() { return warnings; },
    };
}

/** The stream's program readouts; each value cell gets id radio-<key>. */
export function programReadout(host) {
    const r = readout(host, {
        onair: 'on air', playhead: 'playhead', emitted: 'handed out', lead: 'buffered lead (handed out − playhead)',
        firstAudio: 'first audio (request → handed out)', ahead: 'built ahead (skip is instant to a ready one)',
        fullSong: 'the song on air',
        ring: 'player ring', underrun: 'player underrun',
    });
    for (const k of r.keys) r.row(k).lastChild.id = 'radio-' + k;
    return r;
}

const clock = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/**
 * The now-playing card (#radio-now's children by id). render(song, row,
 * playhead, kept): song is { title, tags, lyrics } or null; row the song's
 * stream stats; the bar shows what is played and what is generated over the
 * song's length (its preview's until it is kept, then the plan's estimate).
 */
export function nowPlaying() {
    const el = {
        state: $('#radio-now-state'), title: $('#radio-now-title'), tags: $('#radio-now-tags'),
        gen: $('#radio-progress-gen'), play: $('#radio-progress-play'),
        time: $('#radio-now-time'), note: $('#radio-now-note'), len: $('#radio-now-len'),
        lyrics: $('#radio-now-lyrics'), keep: $('#radio-full'), save: $('#radio-save'),
    };
    const SAVE_LABEL = { waiting: 'Saving when it is done…', saved: 'Saved ✓', failed: 'Save failed: again?' };
    const set = (n, t) => { if (n.textContent !== t) n.textContent = t; };
    let lyricsFor = -1;
    return {
        render(song, row, playhead, kept, save) {
            set(el.save, save ? SAVE_LABEL[save.state] : 'Save');
            el.save.disabled = !row || (!!save && save.state === 'waiting');
            el.save.title = save && save.text ? save.text : 'Save this song as a WAV (and its lyrics): a preview is kept and saved whole once it is done';
            if (!song || !row) {
                set(el.state, 'off'); el.state.className = 'k-badge';
                set(el.title, row === null && song === null ? 'Press Start radio' : 'Tuning in…');
                set(el.tags, ''); set(el.time, '0:00'); set(el.len, '—'); set(el.note, '');
                el.gen.style.width = '0%'; el.play.style.width = '0%';
                if (lyricsFor !== -1) { lyricsFor = -1; el.lyrics.textContent = ''; }
                return;
            }
            const whole = !row.preview;
            const lenFrames = whole ? (row.semanticDone ? row.semanticFrames : Math.max(row.estimateFrames || 0, row.latentFrames))
                                    : row.previewFrames;
            const len = Math.max(1, lenFrames) / 25;
            const t = Math.max(0, (playhead - row.start) / PROGRAM_RATE);
            const gen = Math.max(row.decodedFrames, row.latentFrames) / 25;
            set(el.title, song.title);
            set(el.tags, song.tags);
            el.play.style.width = clamp01(t / len) * 100 + '%';
            el.gen.style.width = clamp01(gen / len) * 100 + '%';
            set(el.time, clock(t));
            set(el.len, (whole && !row.semanticDone ? '~' : '') + clock(len));
            // Generated once its latents are complete (the audio is decoded
            // a few seconds ahead of the playhead as it plays).
            const done = row.built || (row.semanticDone && row.latentFrames >= row.semanticFrames);
            const st = whole ? (done ? 'whole song' : 'whole song · generating') : kept ? 'keeping…' : 'preview';
            set(el.state, st); el.state.className = 'k-badge ' + (whole ? 'ok' : '');
            set(el.note, whole ? (done ? '' : 'generating ' + Math.round(clamp01(gen / len) * 100) + '%')
                               : kept ? 'continuing into the whole song' : 'a 30 s preview: Keep, or it moves on');
            el.keep.hidden = whole || kept;
            if (lyricsFor !== song.index) {
                lyricsFor = song.index;
                el.lyrics.textContent = song.lyrics || '';
            }
        },
    };
}

/**
 * The played list, newest first: add({ index, title, tags }), mark(index,
 * text) on a save, reset(). The newest `savable` (the stream's keepPlayed)
 * carry a save link: older ones' audio is gone.
 */
export function playedList(host, onSave, savable) {
    const node = $(host);
    const links = new Map();   // song index -> its save link
    let n = 0;
    return {
        add(song) {
            if (!n) clear(node);
            n++;
            const link = h('button.k-link.radio-played-save', { title: 'Save it as a WAV (as it played) and its lyrics',
                                                               onclick: () => onSave(song.index) }, 'save');
            links.set(song.index, link);
            node.insertBefore(h('div.radio-played', null, h('b', null, song.title), h('span.dim', null, song.tags), link),
                              node.firstChild);
            const order = [...links.keys()];
            for (const i of order.slice(0, Math.max(0, order.length - savable))) {
                const l = links.get(i);
                if (l.textContent === 'save') l.remove();
                links.delete(i);
            }
            while (node.children.length > 30) node.removeChild(node.lastChild);
        },
        mark(index, text) { const l = links.get(index); if (l) { l.textContent = text; l.disabled = true; } },
        reset() { n = 0; links.clear(); clear(node); node.appendChild(h('span.dim', null, 'nothing yet')); },
    };
}

/** What a song is doing, from its stats row and the playhead. */
export function songState(s, playhead) {
    if (s.dropped) return 'dropped';
    if (s.end >= 0 && playhead >= s.end) return 'played';
    if (s.start >= 0 && playhead >= s.start) return 'on air';
    if (s.built) return 'built';
    if (s.ready) return 'ready';
    if (s.decodedFrames > 0) return 'decoding';
    if (s.latentFrames > 0) return 'synthesizing';
    if (s.semanticDone) return 'semantic done';
    if (s.planned) return 'sampling semantic';
    return 'planning';
}

/**
 * Per-song rows: state, and semantic / latent / decoded frames as bars on one
 * scale (the song's length once its semantic tokens are done), with the
 * playhead as a mark. render(songs, playhead) once a frame.
 */
export function songMeters(host) {
    const node = $(host);
    const rows = new Map();
    let shown = '';

    function bar(cls, title) {
        const fill = h('div.fill');
        return { el: h('div.k-meter.block.' + cls, { title }, fill, h('div.mark.head')), fill };
    }

    function build(s) {
        const head = h('b', null, '#' + s.index + ' ' + (s.tag || ''));
        const state = h('span.song-state', null, '');
        const nums = h('span.dim', null, '');
        const bars = {
            sem: bar('sem', 'semantic frames sampled'),
            lat: bar('lat', 'final latent frames (NAR windows landed)'),
            dec: bar('dec', 'frames decoded by the VAE'),
        };
        const el = h('div.radio-song', { dataset: { index: s.index } },
            h('div.k-row', null, head, state, nums),
            h('div.song-bars', null, ['sem', 'lat', 'dec'].map((k) =>
              h('div.song-bar', null, h('span.k-cap', null, k), bars[k].el))));
        return { el, state, nums, bars };
    }

    return {
        render(songs, playhead) {
            const key = songs.map((s) => s.index).join(',');
            if (key !== shown) {
                shown = key;
                clear(node);
                if (!songs.length) node.appendChild(h('span.dim', null, 'nothing queued'));
                for (const s of songs) {
                    let r = rows.get(s.index);
                    if (!r) { r = build(s); rows.set(s.index, r); }
                    node.appendChild(r.el);
                }
            }
            for (const s of songs) {
                const r = rows.get(s.index);
                const st = songState(s, playhead);
                const total = Math.max(1, s.semanticDone ? s.semanticFrames
                    : Math.max(s.semanticFrames, s.latentFrames, s.decodedFrames) * 1.25);
                const playFrames = s.start >= 0 ? Math.max(0, (playhead - s.start) / FRAME_SAMPLES) : 0;
                const len = s.semanticDone ? ' · ' + (s.semanticFrames / 25).toFixed(1) + ' s' : '';
                if (r.state.textContent !== st) { r.state.textContent = st; r.el.className = 'radio-song ' + st.replace(/\s+/g, '-'); }
                const nums = 'sem ' + s.semanticFrames + ' · lat ' + s.latentFrames + ' · dec ' + s.decodedFrames +
                    ' · play ' + Math.min(Math.round(playFrames), s.semanticFrames || Infinity) + len +
                    (s.start >= 0 ? ' · from ' + sec(s.start) : '') +
                    (s.preview ? ' · preview ' + (s.previewFrames / 25).toFixed(0) + ' s' : '');
                if (r.nums.textContent !== nums) r.nums.textContent = nums;
                const mark = clamp01(playFrames / total) * 100 + '%';
                for (const [k, n] of [['sem', s.semanticFrames], ['lat', s.latentFrames], ['dec', s.decodedFrames]]) {
                    r.bars[k].fill.style.width = clamp01(n / total) * 100 + '%';
                    r.bars[k].el.lastChild.style.left = mark;
                    r.bars[k].el.lastChild.hidden = s.start < 0;
                }
            }
        },
        reset() { rows.clear(); shown = '\u0000'; clear(node); node.appendChild(h('span.dim', null, 'nothing queued')); },
    };
}
