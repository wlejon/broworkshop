// ui/sidebar.js — the sound editor for the selected layer (or the mic),
// plus the global LFO.
//
// Built from spec tables with the kit's params(): each control writes
// straight into the active signal's sound object, then song.soundEdited(path)
// pushes that one value to the engine and records the edit. The panels are
// rebuilt whenever the edited signal changes (selection, preset, undo, load);
// effect panels fold to match their on/off state, like a rack.

import { h, clear } from "/lib/kit/dom.js";
import { segmented, foldPanels } from "/lib/kit/ui.js";
import { params } from "/lib/kit/params.js";
import { WAVEFORMS, EQ_BANDS, EFFECT_LABELS } from "../audio/sound.js";
import { LFO_SHAPES, LFO_TARGETS } from "../audio/lfo.js";

// --- formatters ---------------------------------------------------------------
const pct = (v) => Math.round(v * 100) + '%';
const ms = (sec) => (sec >= 1 ? sec.toFixed(2) + 's' : Math.round(sec * 1000) + 'ms');
const msRaw = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 's' : (v < 10 ? v.toFixed(1) : Math.round(v)) + 'ms');
const hz = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + 'kHz' : (v < 10 ? v.toFixed(2) : Math.round(v)) + 'Hz');
const db = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + 'dB';
const times = (v) => v.toFixed(2) + 'x';

// --- spec tables ----------------------------------------------------------------
const OSC = {
    volume: { label: 'level', min: 0, max: 2, step: 0.01, fmt: pct, reset: 1 },
    pan:    { label: 'pan', min: -1, max: 1, step: 0.01, reset: 0,
              fmt: (v) => (Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)) },
};
const UNISON = {
    count:       { label: 'voices', min: 1, max: 8, step: 1, reset: 1, fmt: (v) => (v === 1 ? 'off' : v + 'x') },
    detune:      { label: 'detune', min: 0, max: 2, step: 0.01, reset: 0.15, fmt: (v) => v.toFixed(2) + ' st' },
    stereoWidth: { label: 'spread', min: 0, max: 1, step: 0.01, reset: 0.7, fmt: pct },
};
const ADSR = {
    attack:  { min: 0.001, max: 2, step: 0.001, reset: 0.01, fmt: ms },
    decay:   { min: 0.001, max: 2, step: 0.001, reset: 0.1, fmt: ms },
    sustain: { min: 0, max: 1, step: 0.01, reset: 1, fmt: pct },
    release: { min: 0.001, max: 3, step: 0.001, reset: 0.08, fmt: ms },
};

/** Effect racks: a mode row (segmented) and sliders. */
const FX = [
    { key: 'filter', label: 'Filter',
      mode: ['type', { lowpass: 'LP', highpass: 'HP', bandpass: 'BP', notch: 'Notch' }],
      spec: {
          frequency: { label: 'cutoff', min: 20, max: 20000, log: true, fmt: hz, reset: 2000 },
          Q:         { label: 'resonance', min: 0.1, max: 20, step: 0.1, reset: 1, fmt: (v) => v.toFixed(1) },
      } },
    { key: 'delay', label: 'Delay', spec: {
          time:     { min: 0.01, max: 1.5, step: 0.001, reset: 0.3, fmt: ms },
          feedback: { min: 0, max: 0.9, step: 0.01, reset: 0.3, fmt: pct },
          mix:      { min: 0, max: 1, step: 0.01, reset: 0.3, fmt: pct },
      } },
    { key: 'reverb', label: 'Reverb', spec: {
          roomSize: { label: 'room', min: 0, max: 1, step: 0.01, reset: 0.5, fmt: pct },
          damping:  { min: 0, max: 1, step: 0.01, reset: 0.5, fmt: pct },
          mix:      { min: 0, max: 1, step: 0.01, reset: 0.2, fmt: pct },
      } },
    { key: 'chorus', label: 'Chorus', spec: {
          rate:      { min: 0.1, max: 10, step: 0.1, reset: 1, fmt: hz },
          depth:     { min: 0.0001, max: 0.01, step: 0.0001, reset: 0.003, fmt: (v) => pct(v / 0.01) },
          mix:       { min: 0, max: 1, step: 0.01, reset: 0.3, fmt: pct },
          feedback:  { min: 0, max: 0.9, step: 0.01, reset: 0, fmt: pct },
          baseDelay: { label: 'delay', min: 0.001, max: 0.05, step: 0.001, reset: 0.007, fmt: ms },
      } },
    { key: 'compressor', label: 'Compressor', sidechain: true, spec: {
          threshold: { label: 'thresh', min: -60, max: 0, step: 1, reset: -12, fmt: (v) => v + 'dB' },
          ratio:     { min: 1, max: 20, step: 0.1, reset: 4, fmt: (v) => v.toFixed(1) + ':1' },
          attack:    { min: 0.1, max: 100, step: 0.1, reset: 10, fmt: msRaw },
          release:   { min: 1, max: 1000, step: 1, reset: 100, fmt: msRaw },
      } },
    { key: 'eq', label: 'Equalizer', bands: true, spec: {
          masterGain: { label: 'master', min: 0, max: 11, step: 0.5, reset: 0, fmt: db },
      } },
    { key: 'distortion', label: 'Distortion',
      mode: ['mode', { softclip: 'Soft', hardclip: 'Hard', foldback: 'Fold', bitcrush: 'Crush' }],
      spec: {
          drive:      { min: 1, max: 50, step: 0.1, reset: 2.5, fmt: (v) => v.toFixed(1) + 'x' },
          mix:        { min: 0, max: 1, step: 0.01, reset: 1, fmt: pct },
          outputGain: { label: 'output', min: 0, max: 2, step: 0.01, reset: 0.7, fmt: times },
          crushBits:  { label: 'bits', min: 1, max: 16, step: 1, reset: 8, fmt: (v) => v + ' bit' },
          crushRate:  { label: 'rate', min: 0.01, max: 1, step: 0.01, reset: 0.5, fmt: pct },
      } },
];
const EQ_SPEC = Object.fromEntries(EQ_BANDS.map((label, i) => [i, { label, min: -12, max: 12, step: 0.5, reset: 0, fmt: db }]));
const LFO_SPEC = {
    rate:  { min: 0.1, max: 10, log: true, reset: 2, fmt: hz },
    depth: { min: 0, max: 1, step: 0.01, reset: 0.3, fmt: pct },
    sync:  { label: 'key sync', hint: 'restart the LFO on every note' },
};

/** A panel whose caption holds an on/off checkbox (kit foldPanels). */
function foldPanel(title, on, onToggle, dataset) {
    const box = h('input', { type: 'checkbox', checked: !!on, onchange: () => onToggle(box.checked) });
    return h('div.k-panel.fold' + (on ? '' : '.folded'), { dataset }, h('h2', null, box, ' ' + title));
}

export function sidebar(host, { song }) {
    let sidechainSel = null, orderList = null;

    const edit = (path) => song.soundEdited(path);

    function fillSidechain() {
        if (!sidechainSel) return;
        const s = song.activeSignal();
        clear(sidechainSel);
        sidechainSel.appendChild(h('option', { value: '' }, 'self'));
        for (const l of song.layers) {
            if (l === s) continue;
            sidechainSel.appendChild(h('option', { value: String(l.uid) }, l.name));
        }
        const sc = s ? s.sound.compressor.sidechain : null;
        sidechainSel.value = sc == null ? '' : String(sc);
    }

    function fillOrder() {
        const s = song.activeSignal();
        clear(orderList);
        const order = s.sound.effectOrder;
        order.forEach((name, i) => {
            const move = (j) => {
                [order[i], order[j]] = [order[j], order[i]];
                edit('effectOrder');
                fillOrder();
            };
            orderList.appendChild(h('div.fx-order-item', { dataset: { fx: name } },
                h('span.dim', null, (i + 1) + '.'), h('span.k-grow', null, EFFECT_LABELS[name]),
                i > 0 ? h('button.small', { title: 'earlier', onclick: () => move(i - 1) }, '▲') : null,
                i < order.length - 1 ? h('button.small', { title: 'later', onclick: () => move(i + 1) }, '▼') : null));
        });
    }

    function fxPanel(fx, sound) {
        const state = sound[fx.key];
        const panel = foldPanel(fx.label, state.enabled, (on) => {
            state.enabled = on;
            edit(fx.key + '.enabled');
        }, { fx: fx.key });
        if (fx.mode) {
            const [key, options] = fx.mode;
            panel.appendChild(segmented(h('div.k-row.seg'), options, {
                value: state[key], onChange: (v) => { state[key] = v; edit(fx.key + '.' + key); },
            }).el);
        }
        if (fx.bands) params(panel, state.bands, EQ_SPEC, { onChange: (k) => edit('eq.bands.' + k) });
        params(panel, state, fx.spec, { onChange: (k) => edit(fx.key + '.' + k) });
        if (fx.sidechain) {
            sidechainSel = h('select', {
                onchange: () => {
                    state.sidechain = sidechainSel.value === '' ? null : +sidechainSel.value;
                    edit('compressor.sidechain');
                },
            });
            panel.appendChild(h('label.k-field', { title: 'key the compressor from another layer' },
                h('span', null, 'sidechain'), sidechainSel));
            fillSidechain();
        }
        return panel;
    }

    function lfoPanel() {
        const lfo = song.lfo;
        const panel = foldPanel('LFO', lfo.enabled, (on) => { lfo.enabled = on; song.lfoEdited('enabled'); }, { fx: 'lfo' });
        panel.appendChild(h('p.k-note', null, 'Global: modulates every voice.'));
        panel.appendChild(segmented(h('div.k-row.seg'), LFO_SHAPES, {
            value: lfo.waveform, onChange: (v) => { lfo.waveform = v; song.lfoEdited('waveform'); },
        }).el);
        params(panel, lfo, LFO_SPEC, { onChange: (k) => song.lfoEdited(k) });
        panel.appendChild(segmented(h('div.k-row.seg'), LFO_TARGETS, {
            value: lfo.target, onChange: (v) => { lfo.target = v; song.lfoEdited('target'); },
        }).el);
        return panel;
    }

    function render() {
        clear(host);
        sidechainSel = null;
        const s = song.activeSignal();
        if (!s) return;
        const sound = s.sound;
        const isMic = s === song.mic;

        host.appendChild(h('div.k-panel#editing', null,
            h('div.k-row', null, h('span.swatch', { style: { background: s.color } }),
                h('b#editing-name', null, s.name), h('span.dim', null, isMic ? 'input effects' : 'layer sound'))));

        if (!isMic) {
            const osc = h('div.k-panel', { dataset: { section: 'osc' } }, h('h2', null, 'Oscillator'));
            osc.appendChild(segmented(h('div.k-row.seg#waveform'), WAVEFORMS, {
                value: sound.waveform, onChange: (v) => { sound.waveform = v; edit('waveform'); },
            }).el);
            params(osc, sound, OSC, { onChange: (k) => edit(k) });
            host.appendChild(osc);

            const uni = h('div.k-panel', { dataset: { section: 'unison' } }, h('h2', null, 'Unison'));
            params(uni, sound.unison, UNISON, { onChange: (k) => edit('unison.' + k) });
            host.appendChild(uni);

            const env = h('div.k-panel', { dataset: { section: 'adsr' } }, h('h2', null, 'Envelope'));
            params(env, sound.adsr, ADSR, { onChange: (k) => edit('adsr.' + k) });
            host.appendChild(env);
        }

        for (const fx of FX) host.appendChild(fxPanel(fx, sound));
        host.appendChild(lfoPanel());

        const order = h('div.k-panel.fold.folded', { dataset: { fx: 'order' } }, h('h2', null, 'Effect order'));
        orderList = h('div.fx-order');
        order.appendChild(orderList);
        fillOrder();
        host.appendChild(order);

        foldPanels(host);
    }

    song.on((what) => {
        if (what === 'select' || what === 'sound' || what === 'all') render();
        else if (what === 'layers') fillSidechain();
    });
    render();
    return { render };
}
