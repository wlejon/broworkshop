// ---------------------------------------------------------------------------
// Shared view helpers — pure formatters/mappings, active-signal param writes,
// and small DOM utilities used by multiple view modules.
// ---------------------------------------------------------------------------

import { $ } from "/std/dom.js";
import { Layers } from "/app/lib/layers.js";

// -----------------------------------------------------------------------
// Signal param helpers — write to the active signal (layer or mic)
// -----------------------------------------------------------------------
export function signalParam(path, value) {
    var signal = Layers.getActiveSignal();
    if (!signal) return;
    var parts = path.split('.');
    var obj = signal;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
}

export function activeBusId() {
    return Layers.getActiveBusId();
}

// -----------------------------------------------------------------------
// Small DOM helpers
// -----------------------------------------------------------------------
export function showVal(id, text) {
    var el = $('#' + id);
    if (el) el.textContent = text;
}

export function updateToggle(btn, active) {
    btn.classList.toggle('active', active);
    btn.textContent = active ? 'On' : 'Off';
}

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------
export function formatMs(ms) {
    return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms';
}

export function formatFreq(freq) {
    return freq >= 1000 ? (freq / 1000).toFixed(1) + 'kHz' : Math.round(freq) + 'Hz';
}

export function formatLfoRate(hz) {
    return hz < 1 ? hz.toFixed(2) + 'Hz' : hz.toFixed(1) + 'Hz';
}

// Exponential cutoff mapping: 0-100 slider -> 20Hz-20kHz
export function cutoffSliderToFreq(v) { return 20 * Math.pow(1000, v / 100); }
export function freqToCutoffSlider(f) { return Math.log(f / 20) / Math.log(1000) * 100; }

// Exponential LFO rate mapping: 0-100 slider -> 0.1Hz-10Hz
export function lfoSliderToHz(v) { return 0.1 * Math.pow(100, v / 100); }
export function hzToLfoSlider(hz) { return Math.log(hz / 0.1) / Math.log(100) * 100; }

// -----------------------------------------------------------------------
// Collapse/expand panels based on each effect's enabled state
// -----------------------------------------------------------------------
export function syncPanelCollapse(signal) {
    if (!signal) return;
    var pairs = [
        ['panel-filter', signal.filter && signal.filter.enabled],
        ['panel-delay', signal.delay && signal.delay.enabled],
        ['panel-reverb', signal.reverb && signal.reverb.enabled],
        ['panel-chorus', signal.chorus && signal.chorus.enabled],
        ['panel-compressor', signal.compressor && signal.compressor.enabled],
        ['panel-eq', signal.eq && signal.eq.enabled],
        ['panel-distortion', signal.distortion && signal.distortion.enabled],
        ['panel-lfo', signal.lfo && signal.lfo.enabled]
    ];
    for (var i = 0; i < pairs.length; i++) {
        var panel = $('#' + pairs[i][0]);
        if (panel) panel.classList.toggle('collapsed', !pairs[i][1]);
    }
}
