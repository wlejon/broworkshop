// lib/kit/speech.js — the shared view of the speech labs (parakeet-lab,
// qwen-asr-lab, sortformer-lab, cluster-diar-lab), so the four read as one
// family: the same input bar, the same transcript view, the same speaker
// view. Styles: lib/kit/speech.css (link it after kit.css).
//
//   clipInput(host, opts)      source bar: ● record (bro.mic), an audio file,
//                              ▷ play, level meter; hands 16 kHz mono PCM on
//   liveInput(host, opts)      live bar: a bro.listen source (mic / system /
//                              one app) + listen / stop + level meter
//   transcriptView(el)         streaming transcript text
//   timelineView(canvas)       waveform + time ruler + token pins
//   tokenTable(el)             start time · piece · id rows
//   speakerView(cards, lanes)  per-speaker cards + activity lanes
//
// Every widget takes elements (or selectors) already in the page and builds
// only its own innards; the app owns the layout and the model.

import { h, clear, $ as el } from "./dom.js";
import { levelMeter, fitCanvas } from "./gauges.js";
import { sourcePicker } from "./audio-ui.js";
import { clipPlayer, micRecorder, decodeAudioFile, peakOf } from "./audio.js";
import { pickFile, baseName } from "./ml.js";

/** The rate every speech model here takes. */
export const SPEECH_RATE = 16000;

export const SPEAKER_COLORS = ['#5ad1ff', '#ffb24d', '#7fe08a', '#ff6f91',
                               '#c79bff', '#ffe06b', '#6bd6c2', '#ff8f6b'];

const add = (node, ...kids) => { for (const k of kids) if (k) node.appendChild(k); };

// --- input: a clip -------------------------------------------------------------

/**
 * The source bar, built into `host` (a .k-toolbar): ● record from the mic,
 * or decode an audio file; ▷ play the clip; `auto` re-runs the model when a
 * new clip lands. Ids: btn-record, mic-level, src-file, btn-open-file,
 * btn-play-src, autorun, src-meta.
 * opts: { rate = 16000, agc = true, autorun = true (false hides the box),
 *         onClip(pcm, label), onError(message), onRecord(on) }.
 * Handle: clip, label, seconds, set(pcm, label), loadFile(path) -> bool,
 * startRecording({ live }) (live: false = fed by bro.mic.feed, for tests),
 * stopRecording() -> samples captured, recording, play(), autorun.
 */
export function clipInput(host, opts) {
    const node = el(host);
    const o = Object.assign({ rate: SPEECH_RATE, agc: true, autorun: true }, opts);
    const fail = (m) => { if (o.onError) o.onError(m); };
    const player = clipPlayer();
    let clip = null, label = '';

    const rec = h('button#btn-record', { title: 'Record from the microphone; stop to use the take' }, '● record');
    const meterEl = h('span#mic-level', { title: 'mic level' });
    const file = h('input#src-file', { type: 'text', placeholder: 'audio file (.wav / .flac / .mp3 / .ogg)',
                                        style: { width: '300px' } });
    const browse = h('button.small', { title: 'Choose an audio file' }, '…');
    const open = h('button#btn-open-file', { title: 'Decode the file as the source clip' }, 'load');
    const play = h('button#btn-play-src', { disabled: true, title: 'Play the source clip' }, '▷ play');
    const auto = h('input#autorun', { type: 'checkbox', checked: o.autorun !== false });
    const meta = h('span.dim#src-meta');
    add(node, h('span.dim', null, 'source'), rec, meterEl, h('span.k-sep'),
        file, browse, open, h('span.k-sep'), play,
        o.autorun === false ? null : h('label.k-field', { title: 'Run the model whenever a new clip lands' }, auto, 'auto'),
        meta);
    const meter = levelMeter(meterEl, { curve: (t) => Math.min(1, t * 1.3) });

    const mic = micRecorder({ rate: o.rate, agc: o.agc, onChunk: (c) => meter.set(c.peak || 0) });

    const api = {
        get clip() { return clip; },
        get label() { return label; },
        get seconds() { return clip ? clip.length / o.rate : 0; },
        get recording() { return mic.recording; },
        get autorun() { return o.autorun !== false && auto.checked; },
        set autorun(v) { auto.checked = !!v; },
        set(pcm, name) {
            clip = pcm; label = name || 'clip';
            meta.textContent = label + ' · ' + (pcm.length / o.rate).toFixed(2) + ' s @ ' + (o.rate / 1000) + ' kHz';
            play.disabled = !pcm || !pcm.length;
            if (o.onClip) o.onClip(pcm, label);
        },
        loadFile(path) {
            path = String(path || file.value).trim();
            if (!path) { fail('pick an audio file'); return false; }
            file.value = path;
            let dec = null;
            try { dec = decodeAudioFile(path, o.rate); } catch (e) { fail('file error: ' + (e.message || e)); return false; }
            if (!dec) { fail('could not decode ' + path); return false; }
            api.set(dec.pcm, baseName(path));
            return true;
        },
        startRecording(startOpts) {
            if (mic.recording) return;
            try { mic.start(startOpts); } catch (e) { fail('mic: ' + (e.message || e)); return; }
            rec.textContent = '■ stop';
            rec.classList.add('danger');
            if (o.onRecord) o.onRecord(true);
        },
        stopRecording() {
            if (!mic.recording) return 0;
            const pcm = mic.stop();
            meter.set(0);
            rec.textContent = '● record';
            rec.classList.remove('danger');
            if (o.onRecord) o.onRecord(false);
            if (!pcm || !pcm.length) { fail('no audio captured'); return 0; }
            api.set(pcm, 'mic ' + (pcm.length / o.rate).toFixed(1) + ' s');
            return pcm.length;
        },
        play() { if (clip) player.play(clip, o.rate); },
        stop() { player.stop(); },
        el: node,
    };

    rec.addEventListener('click', () => (mic.recording ? api.stopRecording() : api.startRecording()));
    browse.addEventListener('click', () => { const f = pickFile('Audio|wav;flac;mp3;ogg;opus'); if (f) file.value = f; });
    open.addEventListener('click', () => api.loadFile());
    file.addEventListener('keydown', (e) => { if (e.key === 'Enter') api.loadFile(); });
    play.addEventListener('click', () => api.play());
    return api;
}

// --- input: a live source ------------------------------------------------------

/**
 * The live bar, built at the front of `host`: a bro.listen source picker (mic tap,
 * system loopback, one app), ▶ listen / ■ stop, a level meter. The app pulls
 * audio from `stream` (a ListenStream: frame(), audio(a, b), info()).
 * Ids: src-sel, btn-listen, btn-stop, live-level.
 * opts: { retainSec = 180, onStart(stream, spec), onStop(), onError(message) }.
 * Handle: start() -> bool, stop(), stream, running, enabled (get/set; the
 * listen button waits for a model), level(peak), spec.
 */
export function liveInput(host, opts) {
    const node = el(host);
    const o = Object.assign({ retainSec: 180 }, opts);
    const fail = (m) => { if (o.onError) o.onError(m); };
    const sel = h('select#src-sel', { title: 'Audio source' });
    const listen = h('button#btn-listen.primary', { disabled: true, title: 'Open the source and start' }, '▶ listen');
    const stopBtn = h('button#btn-stop', { disabled: true, title: 'Stop and close the source' }, '■ stop');
    const meterEl = h('span#live-level', { title: 'input level' });
    // Ahead of whatever the app already put in the bar (its own knobs follow).
    const first = node.firstChild;
    for (const k of [h('span.dim', null, 'live'), sel, listen, stopBtn, meterEl, h('span.k-sep')]) node.insertBefore(k, first);
    const meter = levelMeter(meterEl, { curve: (t) => Math.min(1, t * 1.4) });
    const picker = sourcePicker(sel);
    sel.addEventListener('mousedown', () => { if (!running) picker.rebuild(); });

    let stream = null, running = false, enabled = false, spec = null;
    const paint = () => {
        listen.disabled = !enabled || running;
        stopBtn.disabled = !running;
        sel.disabled = running;
    };
    const api = {
        start() {
            if (running || !enabled) return false;
            const s = picker.spec();
            if (!s) { fail('pick a valid source'); return false; }
            const arg = s.kind === 'process' ? { process: s.pid } : s.kind;
            const what = s.kind === 'process' ? (s.name || 'pid ' + s.pid) : s.kind === 'system' ? 'system audio' : 'microphone';
            let hnd = null;
            try { hnd = bro.listen.open(arg); } catch (e) { fail('open ' + what + ': ' + (e.message || e)); return false; }
            if (!hnd || !hnd.valid) { fail('could not open ' + what); return false; }
            hnd.retain(o.retainSec);
            stream = hnd; running = true; spec = Object.assign({ label: what }, s);
            paint();
            if (o.onStart) o.onStart(stream, spec);
            return true;
        },
        stop() {
            if (!running) return;
            running = false;
            try { stream.close(); } catch (e) { /* already closed */ }
            stream = null;
            meter.set(0);
            paint();
            if (o.onStop) o.onStop();
        },
        level(peak) { meter.set(peak); },
        get stream() { return stream; },
        get running() { return running; },
        get spec() { return spec; },
        get enabled() { return enabled; },
        set enabled(v) { enabled = !!v; paint(); },
        el: node,
    };
    listen.addEventListener('click', () => api.start());
    stopBtn.addEventListener('click', () => api.stop());
    paint();
    return api;
}

// --- transcript ----------------------------------------------------------------

/**
 * Transcript text in a .k-box. set(text, streaming) shows a cursor while a
 * decode is still streaming; placeholder(text) shows dim hint text.
 * Handle: set, placeholder, text, streaming.
 */
export function transcriptView(target, opts) {
    const node = el(target);
    node.classList.add('k-box', 'k-transcript');
    let text = '', streaming = false;
    const api = {
        set(t, isStreaming) {
            text = t || ''; streaming = !!isStreaming;
            node.classList.toggle('streaming', streaming);
            node.classList.remove('empty');
            clear(node);
            node.appendChild(document.createTextNode(text));
            if (streaming) node.appendChild(h('span.cursor', null, ' ▌'));
            return api;
        },
        placeholder(t) {
            text = ''; streaming = false;
            node.classList.remove('streaming');
            node.classList.add('empty');
            node.textContent = t || '';
            return api;
        },
        get text() { return text; },
        get streaming() { return streaming; },
        el: node,
    };
    return api.placeholder((opts && opts.placeholder) || '');
}

// --- waveform + token timeline -------------------------------------------------

/**
 * A clip waveform (min/max per column) under a seconds ruler, with tokens
 * pinned at their emission times on two staggered label rows below.
 * opts: { rate = 16000, height = 150 }.
 * Handle: set({ clip, tokens: [{ t, text }] }), draw(), tokens.
 */
export function timelineView(target, opts) {
    const canvas = el(target);
    const o = Object.assign({ rate: SPEECH_RATE, height: 150 }, opts);
    const s = { clip: null, tokens: [] };
    const WAVE = 84, TOP = 14;

    function draw() {
        const { ctx, w, h: hh } = fitCanvas(canvas, { minWidth: 320, height: s.tokens.length ? o.height : TOP + WAVE + 4 });
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, w, hh);
        const clip = s.clip;
        if (!clip || !clip.length) return;
        const secs = clip.length / o.rate, mid = TOP + WAVE / 2;
        const xAt = (t) => Math.min(w - 1, (t / secs) * (w - 2) + 1);

        const step = secs > 24 ? 4 : secs > 12 ? 2 : secs > 6 ? 1 : 0.5;
        ctx.font = '10px monospace';
        for (let t = 0; t <= secs; t += step) {
            const x = xAt(t);
            ctx.strokeStyle = '#161c26';
            ctx.beginPath(); ctx.moveTo(x, TOP - 2); ctx.lineTo(x, TOP + WAVE); ctx.stroke();
            ctx.fillStyle = '#4f586a';
            ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + 's', x + 2, 9);
        }

        ctx.strokeStyle = '#3d6f8f';
        ctx.beginPath();
        const spp = clip.length / (w - 2);
        for (let x = 0; x < w - 2; x++) {
            let mn = 1, mx = -1;
            const a = Math.floor(x * spp), b = Math.min(clip.length, Math.ceil((x + 1) * spp));
            for (let i = a; i < b; i++) { const v = clip[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            if (mn > mx) { mn = 0; mx = 0; }
            ctx.moveTo(x + 1, mid - mx * (WAVE / 2 - 2));
            ctx.lineTo(x + 1, mid - mn * (WAVE / 2 - 2) + 0.5);
        }
        ctx.stroke();

        ctx.font = '11px monospace';
        for (let i = 0; i < s.tokens.length; i++) {
            const tk = s.tokens[i], x = xAt(tk.t), y = TOP + WAVE + 16 + (i % 2) * 16;
            ctx.strokeStyle = '#2e7d5b';
            ctx.beginPath(); ctx.moveTo(x, TOP + WAVE); ctx.lineTo(x, y - 9); ctx.stroke();
            ctx.fillStyle = '#7fd99a';
            ctx.fillText(String(tk.text).trim() || '·', x + 1, y);
        }
    }
    return {
        set(v) { Object.assign(s, v); if (!s.tokens) s.tokens = []; draw(); return this; },
        draw,
        get tokens() { return s.tokens; },
        el: canvas,
    };
}

/** A table of token emissions: rows [{ t (s), piece, id }]. Handle: set(rows), count. */
export function tokenTable(target) {
    const node = el(target);
    let count = 0;
    return {
        set(rows) {
            clear(node);
            count = rows ? rows.length : 0;
            if (!count) return;
            node.appendChild(h('table.k-tokens', null, rows.map((r) =>
                h('tr', null, h('td.t', null, r.t.toFixed(2) + 's'),
                              h('td.piece', null, r.piece || '·'),
                              h('td.id', null, String(r.id))))));
        },
        get count() { return count; },
        el: node,
    };
}

// --- speakers ------------------------------------------------------------------

/** A bro.diar Diarization ({ numFrames, numSpeakers, probs }) as one Float32Array per frame. */
export function diarFrames(res) {
    const out = [], S = res.numSpeakers;
    for (let f = 0; f < res.numFrames; f++) out.push(res.probs.slice(f * S, (f + 1) * S));
    return out;
}

/**
 * Speaker cards + an activity-lanes canvas. Each card: colour dot, name,
 * a live-activity meter (the latest frame's probability) and total speaking
 * time (frames at or above the threshold). Lanes: one row per speaker, one
 * column per frame across the whole width, brighter = more confident.
 * opts: { threshold = 0.5, frameSeconds = 0.08, height = 200, empty }.
 * Handle: set(frames, numSpeakers, frameSeconds?), threshold (get/set;
 * redraws), clear(), numSpeakers, frames, totals() -> seconds per speaker.
 */
export function speakerView(cardsTarget, lanesTarget, opts) {
    const cards = el(cardsTarget), lanes = el(lanesTarget);
    const o = Object.assign({ threshold: 0.5, frameSeconds: 0.08, height: 200,
                              empty: 'no speech yet' }, opts);
    let frames = [], S = 0, built = -1;
    let cells = [];

    function build() {
        clear(cards);
        cells = [];
        if (!S) { cards.appendChild(h('span.dim', null, o.empty)); built = 0; return; }
        for (let s = 0; s < S; s++) {
            const c = SPEAKER_COLORS[s % SPEAKER_COLORS.length];
            const bar = h('span.bar');
            const val = h('span.val', null, '0.0 s');
            const card = h('div.k-speaker#spk-' + s, null,
                h('span.dot', { style: { background: c } }), h('span.nm', null, 'Speaker ' + (s + 1)), bar, val);
            cards.appendChild(card);
            const m = levelMeter(bar);
            m.color(c);
            cells.push({ card, m, val });
        }
        built = S;
    }

    const totals = () => {
        const out = new Array(S).fill(0);
        for (const p of frames) for (let s = 0; s < S; s++) if ((p[s] || 0) >= o.threshold) out[s] += o.frameSeconds;
        return out;
    };

    function paintCards() {
        if (built !== S) build();
        const last = frames[frames.length - 1];
        const tot = totals();
        for (let s = 0; s < S; s++) {
            const p = last ? (last[s] || 0) : 0;
            cells[s].m.set(p);
            cells[s].val.textContent = tot[s].toFixed(1) + ' s';
            cells[s].card.classList.toggle('idle', p < o.threshold);
        }
    }

    function drawLanes() {
        const { ctx, w, h: hh } = fitCanvas(lanes, { minWidth: 320, height: o.height });
        ctx.fillStyle = '#0a0c11';
        ctx.fillRect(0, 0, w, hh);
        if (!S) {
            ctx.fillStyle = '#5c6478'; ctx.font = '12px sans-serif';
            ctx.fillText(o.empty, 10, 22);
            return;
        }
        const laneH = hh / S;
        ctx.strokeStyle = '#1a1f2c';
        for (let s = 1; s < S; s++) { ctx.beginPath(); ctx.moveTo(0, s * laneH); ctx.lineTo(w, s * laneH); ctx.stroke(); }
        const n = frames.length;
        if (n) {
            const colW = w / n;
            for (let i = 0; i < n; i++) {
                // integer column edges: fractional ones seam under alpha
                const p = frames[i], x = Math.round(i * colW), cw = Math.max(1, Math.round((i + 1) * colW) - x);
                for (let s = 0; s < S; s++) {
                    const v = p[s] || 0;
                    if (v <= 0.02) continue;
                    ctx.globalAlpha = v >= o.threshold ? Math.min(1, 0.35 + v * 0.65) : v * 0.45;
                    ctx.fillStyle = SPEAKER_COLORS[s % SPEAKER_COLORS.length];
                    ctx.fillRect(x, s * laneH + 2, cw, laneH - 4);
                }
            }
            ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#5c6478'; ctx.font = '11px sans-serif';
        for (let s = 0; s < S; s++) ctx.fillText('S' + (s + 1), 4, s * laneH + 13);
    }

    const api = {
        set(fr, numSpeakers, frameSeconds) {
            frames = fr || [];
            S = numSpeakers != null ? numSpeakers : S;
            if (frameSeconds) o.frameSeconds = frameSeconds;
            paintCards();
            drawLanes();
            return api;
        },
        clear() { frames = []; paintCards(); drawLanes(); return api; },
        get threshold() { return o.threshold; },
        set threshold(v) { o.threshold = v; paintCards(); drawLanes(); },
        get numSpeakers() { return S; },
        get frames() { return frames; },
        totals,
        el: cards,
    };
    build();
    drawLanes();
    return api;
}

/** Peak of a PCM buffer (for the level meters). */
export const peak = (pcm) => peakOf(pcm, 1);
