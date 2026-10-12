// The radio's DOM: knob sliders, the per-song meters, the latent-norm meter
// and the readouts. No stream logic here (that is radio.js); every function
// takes plain stream stats and events.

import { $, h, clear } from "/lib/kit/dom.js";
import { bindControl } from "/lib/kit/params.js";
import { readout } from "/lib/kit/ui.js";

export const PROGRAM_RATE = 48000;
export const FRAME_SAMPLES = 1920;            // one latent frame of program audio

// docs/music-api.js YuE2Knobs: the clamps a stream reports as knobRanges,
// shown before a stream exists (a running stream's own knobRanges replace them).
export const DOC_KNOB_RANGES = {
    energy:      { min: -2, max: 1 },
    texture:     { min: -2, max: 2 },
    percussion:  { min: -6, max: 6 },
    arrangement: { min: -2, max: 1 },
};
export const KNOB_HINTS = {
    energy: 'latent offset along the energy direction: louder, brighter; heard within the emit lead (~0.75 s)',
    texture: 'NAR steer after layer 21; re-solved from ~1.5 s ahead',
    percussion: 'NAR steer after layer 9: onsets; re-solved from ~1.5 s ahead',
    arrangement: 'semantic steer after layer 21: a real arrangement change; the song continues under it from ~2.5 s ahead',
};

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
    for (const [name, r] of Object.entries(DOC_KNOB_RANGES)) {
        const input = h('input#knob-' + name, { type: 'range', min: r.min, max: r.max, step: name === 'percussion' ? 0.1 : 0.05, value: 0 });
        applied[name] = h('span.k-val#knob-' + name + '-val', { title: 'the value the stream applied (clamped)' }, '0.00');
        node.appendChild(h('label.k-field', { title: KNOB_HINTS[name] }, h('span', null, name), input, applied[name]));
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
        firstAudio: 'first audio (request → handed out)', ring: 'player ring', underrun: 'player underrun',
    });
    for (const k of r.keys) r.row(k).lastChild.id = 'radio-' + k;
    return r;
}

export function interruptReadout(host) {
    const r = readout(host, { int1: 'stage 1 · latent offset', int2: 'stage 2 · arrangement' });
    for (const k of r.keys) r.row(k).lastChild.id = 'radio-' + k;
    return r;
}

/** What a song is doing, from its stats row and the playhead. */
export function songState(s, playhead) {
    if (s.dropped) return 'dropped';
    if (s.end >= 0 && playhead >= s.end) return 'played';
    if (s.start >= 0 && playhead >= s.start) return 'on air';
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
                    (s.start >= 0 ? ' · from ' + sec(s.start) : '');
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
