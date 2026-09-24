// Pieces every Node Forge audio card shares: form rows with native path
// pickers, the audio output strip (waveform, play, save .wav, autoplay),
// labelled sliders, the learned-direction and masc/fem sections, test tones
// and small file helpers.

import { h } from "/lib/kit/dom.js";
import { pickFolder, pickFile } from "/lib/kit/ml.js";
import { clipPlayer, saveWav, decodeAudioFile, downmix } from "/lib/kit/audio.js";

const fs = require('fs');

export const AUDIO_FILTER = 'Audio|wav;mp3;flac;ogg';

// --- files ---------------------------------------------------------------------------

export function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }
export function parentDir(p) { return String(p || '').replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, ''); }
export function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; } }
export const trimSlash = (p) => String(p || '').replace(/[\\/]+$/, '');
export const fileName = (p) => String(p || '').split(/[\\/]/).pop();

/** Decode an audio file to mono Float32 at `rate` (null when it cannot). */
export function decodeMono(path, rate) {
    const d = decodeAudioFile(path, rate);
    return d ? d.pcm : null;
}

/** Decode an audio file to mono at its own rate: { pcm, rate } or null. */
export function decodeNative(path) {
    const d = decodeAudioFile(path);
    return d ? { pcm: d.pcm, rate: d.rate } : null;
}

/** A standard normal draw. */
export function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A test tone at `rate` Hz, so an encoder has something with structure when
 * there is no file: 'sine' | 'harm' | 'saw' | 'sweep' | 'noise'.
 */
export function genTone(kind, freq, secs, rate) {
    const n = Math.max(1, Math.floor(secs * rate));
    const out = new Float32Array(n);
    const w = 2 * Math.PI * freq / rate, fade = rate * 0.01;
    for (let i = 0; i < n; i++) {
        let v = 0;
        if (kind === 'sine') v = Math.sin(w * i);
        else if (kind === 'harm') v = Math.sin(w * i) + 0.5 * Math.sin(2 * w * i) + 0.25 * Math.sin(3 * w * i) + 0.12 * Math.sin(4 * w * i);
        else if (kind === 'saw') v = 2 * ((i * freq / rate) % 1) - 1;
        else if (kind === 'sweep') v = Math.sin(2 * Math.PI * freq * Math.pow(8, i / n) * i / rate);
        else if (kind === 'noise') v = Math.random() * 2 - 1;
        out[i] = 0.3 * v * Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
    }
    return out;
}
export const TONES = ['sine', 'harm', 'saw', 'sweep', 'noise'];

/** Min/max-per-column waveform of mono or interleaved PCM onto a canvas. */
export function drawWaveform(canvas, data, channels, color) {
    const mono = data && channels > 1 ? downmix(data, channels) : data;
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#1b2330';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    if (!mono || !mono.length) return;
    const n = mono.length, per = Math.max(1, Math.floor(n / W));
    let peak = 1e-6;
    for (let i = 0; i < n; i++) { const a = Math.abs(mono[i]); if (a > peak) peak = a; }
    ctx.strokeStyle = color || '#5aa0e0';
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
        let lo = 0, hi = 0;
        const s0 = Math.floor(x * n / W), s1 = Math.min(n, s0 + per);
        for (let i = s0; i < s1; i++) { const v = mono[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        ctx.moveTo(x + 0.5, mid - (hi / peak) * mid);
        ctx.lineTo(x + 0.5, mid - (lo / peak) * mid + 0.5);
    }
    ctx.stroke();
}

// --- form pieces ---------------------------------------------------------------------

/** A collapsible section: <details><summary>title</summary>...children</details>. */
export function section(title, ...children) {
    return h('details', null, h('summary', null, title), children);
}

/** A labelled row: <div.form-row><span.form-label>label</span>...controls</div>. */
export function row(label, ...controls) {
    return h('div.form-row', null, label ? h('span.form-label', null, label) : null, controls);
}

/**
 * A text field for a path with a Browse button (native folder / file dialog).
 * opts: { label, value, folder = true, filter, placeholder, onChange(path) }
 * (onChange fires on edit-commit and after a browse). Returns { row, input }.
 */
export function pathRow(opts) {
    const o = opts || {};
    const input = h('input.form-input.wide', { type: 'text', value: o.value || '', placeholder: o.placeholder || '' });
    const commit = () => { if (o.onChange) o.onChange(input.value.trim()); };
    input.addEventListener('change', commit);
    const browse = h('button.small', {
        title: 'Browse…',
        onclick: () => {
            const picked = o.folder === false ? pickFile(o.filter || AUDIO_FILTER) : pickFolder(input.value);
            if (picked) { input.value = picked; commit(); }
        },
    }, '…');
    return { row: row(o.label, input, browse), input };
}

/** A checkbox with a label. Returns { el, input }. */
export function checkbox(label, checked, onChange) {
    const input = h('input.form-check', { type: 'checkbox', checked: !!checked, onchange: () => onChange(input.checked) });
    return { el: h('label.nf-check', null, input, ' ' + label), input };
}

/**
 * A named slider cell (.emo-axis): name, optional hint, value readout, range.
 * opts: { name, hint, min, max, step, value, fmt, onInput(v), onName }.
 * Returns { el, range, set(v) }.
 */
export function axisSlider(opts) {
    const fmt = opts.fmt || ((v) => (+v).toFixed(2));
    const val = h('span.emo-val', null, fmt(opts.value || 0));
    const name = h('span.emo-name', { title: opts.nameTitle || '' }, opts.name);
    if (opts.onName) { name.classList.add('pick'); name.addEventListener('click', opts.onName); }
    const range = h('input', { type: 'range', min: String(opts.min), max: String(opts.max), step: String(opts.step || 0.01), value: String(opts.value || 0) });
    range.addEventListener('input', () => { val.textContent = fmt(+range.value); opts.onInput(+range.value); });
    const el = h('div.emo-axis', null, h('div.emo-head', null, name, opts.hint ? h('span.emo-hint', null, opts.hint) : null, val), range);
    return { el, range, set(v) { range.value = String(v); val.textContent = fmt(+v); } };
}

/**
 * Sliders for a learned-direction basis ({ emotions, label, alphaMax,
 * defaultAlpha }): one 0..alphaMax slider per direction over `alphas`
 * (a params object, mutated). Clicking a name sets it to its default amount
 * and zeroes the rest. opts: { onInput(), onPick() }.
 */
export function directionSliders(host, basis, alphas, opts) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!basis) return;
    for (const e of basis.emotions) {
        if (alphas[e] === undefined) alphas[e] = 0;
        host.appendChild(axisSlider({
            name: (basis.label && basis.label[e]) || e, nameTitle: 'default amount, zero the rest',
            min: 0, max: basis.alphaMax || 5, step: 0.05, value: alphas[e],
            onInput: (v) => { alphas[e] = v; opts.onInput(); },
            onName: () => {
                for (const k of basis.emotions) alphas[k] = k === e ? (basis.defaultAlpha[e] || 2) : 0;
                directionSliders(host, basis, alphas, opts);
                opts.onPick();
            },
        }).el);
    }
}

/**
 * The masc <-> fem section: a bipolar slider over params.mfAlpha, pole labels
 * that jump to the basis' default amounts, and a neutral button.
 * opts: { onInput() (slider drag), onCommit() (pole / neutral click) }.
 * Returns { el, build(basis) (hides the section without one), sync() }.
 */
export function mascFemSection(p, opts) {
    const fem = h('span.mf-pole'), masc = h('span.mf-pole');
    const slider = h('input.mf-range', { type: 'range' });
    const val = h('span.mf-val', null, 'neutral');
    const neutral = h('button.small', null, '○ neutral');
    const el = section('Masc ✦ Fem', h('div.mf-row', null, fem, slider, masc, val), neutral);
    let basis = null;
    function sync() {
        slider.value = String(p.mfAlpha);
        val.textContent = p.mfAlpha === 0 ? 'neutral' : (p.mfAlpha > 0 ? 'masc ' : 'fem ') + Math.abs(p.mfAlpha).toFixed(2);
    }
    fem.addEventListener('click', () => { if (basis) { p.mfAlpha = -(basis.defaultAlpha.F || 2); sync(); opts.onCommit(); } });
    masc.addEventListener('click', () => { if (basis) { p.mfAlpha = basis.defaultAlpha.M || 2; sync(); opts.onCommit(); } });
    slider.addEventListener('input', () => { p.mfAlpha = +slider.value; sync(); opts.onInput(); });
    neutral.addEventListener('click', () => { p.mfAlpha = 0; sync(); opts.onCommit(); });
    return {
        el, sync,
        build(b) {
            basis = b;
            el.style.display = b ? '' : 'none';
            if (!b) return;
            const max = b.alphaMax || 3;
            fem.textContent = '← ' + (b.label.F || 'feminine');
            masc.textContent = (b.label.M || 'masculine') + ' →';
            slider.min = String(-max); slider.max = String(max); slider.step = '0.05';
            sync();
        },
    };
}

// --- audio output --------------------------------------------------------------------

/**
 * The card's output strip: waveform, Play, ⤓ wav, autoplay (bound to
 * node.params.autoplay) and a caption. opts: { empty (caption before any
 * audio), wavName, color }.
 * Returns { el, publish(samples, rate, channels), play(), info }.
 */
export function audioOut(node, opts) {
    const o = Object.assign({ empty: 'no audio yet', wavName: node.type + '.wav', color: '#ffcf6b' }, opts);
    const player = node._player || (node._player = clipPlayer());
    const canvas = h('canvas.curve-canvas.nf-wave', { width: 660, height: 96 });
    const info = h('span.curve-stats', null, o.empty);
    const play = h('button.small', { disabled: true, onclick: () => api.play() }, '▶ Play');
    const wav = h('button.small', {
        disabled: true, title: 'Save as .wav',
        onclick: () => {
            const a = node._audio;
            if (a) saveWav(a.samples, a.sampleRate, { defaultName: o.wavName, channels: a.channels });
        },
    }, '⤓ wav');
    const auto = checkbox('autoplay', node.params.autoplay, (v) => { node.params.autoplay = v; });
    const el = h('div.audio-preview', null, canvas, h('div.audio-preview-controls', null, play, wav, auto.el, info));

    function show(a) {
        drawWaveform(canvas, a.samples, a.channels, o.color);
        const secs = a.samples.length / a.channels / a.sampleRate;
        info.textContent = secs.toFixed(2) + 's · ' + a.sampleRate + 'Hz' + (a.channels > 1 ? ' × ' + a.channels : '');
        play.disabled = false; wav.disabled = false;
    }
    const api = {
        el, info,
        publish(samples, sampleRate, channels) {
            node._audio = { samples, sampleRate, channels: channels || 1 };
            show(node._audio);
            if (node.params.autoplay) api.play();
        },
        play() {
            const a = node._audio;
            if (a) { try { player.play(a.samples, a.sampleRate, { channels: a.channels }); } catch (e) { /* no audio device */ } }
        },
    };
    if (node._audio) show(node._audio);   // a card rebuilt over a node that already has audio
    return api;
}
