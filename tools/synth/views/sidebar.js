// ---------------------------------------------------------------------------
// Sidebar — the active-signal editor.
//
// Owns all sidebar param sliders, the effect on/off toggles, the effect-order
// drag list, the sidechain select, and `syncUIToSignal` (which reads the active
// layer/mic and pushes values into the sliders). These stay in ONE module
// because syncUIToSignal references the slider instances.
//
// The reactive seam: syncUIToSignal is driven by an effect that subscribes to
// `activeVersion`, so any module that calls `refreshActive()` re-syncs this UI.
// ---------------------------------------------------------------------------

import { $, $$, on } from "/std/dom.js";
import { slider } from "/std/slider.js";
import { effect } from "/std/signal.js";
import { engine } from "/app/lib/synth-engine.js";
import { Layers } from "/app/lib/layers.js";
import { SignalChain } from "/app/lib/signal-chain.js";
import { LFO } from "/app/lib/lfo.js";
import { activeVersion } from "/app/views/state.js";
import {
    signalParam, activeBusId,
    formatMs, formatFreq, formatLfoRate,
    cutoffSliderToFreq, freqToCutoffSlider, lfoSliderToHz, hzToLfoSlider,
    updateToggle, syncPanelCollapse
} from "/app/views/shared.js";

// Fancy sliders — populated in initSidebar(), read by syncUIToSignal().
var sliders = {};

// Effect on/off toggle buttons + sidechain select — assigned in initSidebar().
var filterToggle, delayToggle, reverbToggle, chorusToggle, compToggle, eqToggle, distToggle, lfoToggle;
var sidechainSelect;

// -----------------------------------------------------------------------
// Effect Order — draggable reorder list
// -----------------------------------------------------------------------
var EFFECT_NAMES = ['filter', 'delay', 'compressor', 'chorus', 'reverb', 'equalizer', 'distortion'];
var EFFECT_LABELS = { filter: 'Filter', delay: 'Delay', compressor: 'Compressor', chorus: 'Chorus', reverb: 'Reverb', equalizer: 'Equalizer', distortion: 'Distortion' };

function buildEffectOrderList() {
    var container = $('#effect-order-list');
    container.innerHTML = '';
    var signal = Layers.getActiveSignal();
    var order = (signal && signal.effectOrder) ? signal.effectOrder : EFFECT_NAMES.slice();

    for (var i = 0; i < order.length; i++) {
        (function(idx) {
            var item = document.createElement('div');
            item.className = 'effect-order-item';
            item.setAttribute('draggable', 'true');
            item.setAttribute('data-idx', idx.toString());

            var num = document.createElement('span');
            num.className = 'effect-order-num';
            num.textContent = (idx + 1) + '.';
            item.appendChild(num);

            var label = document.createElement('span');
            label.textContent = EFFECT_LABELS[order[idx]] || order[idx];
            item.appendChild(label);

            var arrows = document.createElement('span');
            arrows.className = 'effect-order-arrows';
            if (idx > 0) {
                var up = document.createElement('button');
                up.className = 'btn effect-order-btn';
                up.textContent = '\u25B2';
                up.addEventListener('click', function(e) {
                    e.stopPropagation();
                    swapEffectOrder(idx, idx - 1);
                });
                arrows.appendChild(up);
            }
            if (idx < order.length - 1) {
                var dn = document.createElement('button');
                dn.className = 'btn effect-order-btn';
                dn.textContent = '\u25BC';
                dn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    swapEffectOrder(idx, idx + 1);
                });
                arrows.appendChild(dn);
            }
            item.appendChild(arrows);

            container.appendChild(item);
        })(i);
    }
}

function swapEffectOrder(fromIdx, toIdx) {
    var signal = Layers.getActiveSignal();
    if (!signal || !signal.effectOrder) return;
    var order = signal.effectOrder;
    var tmp = order[fromIdx];
    order[fromIdx] = order[toIdx];
    order[toIdx] = tmp;
    SignalChain.setEffectOrder(Layers.getActiveBusId(), order);
    buildEffectOrderList();
}

// -----------------------------------------------------------------------
// Sidechain options
// -----------------------------------------------------------------------
function rebuildSidechainOptions() {
    var current = sidechainSelect.value;
    sidechainSelect.innerHTML = '<option value="-1">Self</option>';
    var count = Layers.count();
    var activeIdx = Layers.getActiveIndex();
    for (var i = 0; i < count; i++) {
        if (i === activeIdx && !Layers.isEditingMic()) continue;
        var layer = Layers.get(i);
        var opt = document.createElement('option');
        opt.value = layer.busId;
        opt.textContent = layer.name;
        sidechainSelect.appendChild(opt);
    }
    sidechainSelect.value = current;
}

// -----------------------------------------------------------------------
// Sync UI to active signal (layer or mic)
// -----------------------------------------------------------------------
function syncUIToSignal() {
    var signal = Layers.getActiveSignal();
    if (!signal) return;

    var isMic = Layers.isEditingMic();

    // Layer indicator
    $('#layer-indicator-color').style.background = signal.color || '#00e5ff';
    $('#layer-indicator-name').textContent = signal.name || 'Layer 1';

    // Waveform (layers only)
    if (!isMic) {
        $$('#wave-btns .btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-wave') === signal.waveform);
        });
    }

    // Volume (global)
    $('#volume').value = Math.round(engine.getVolume() * 100);

    // Pan (layers only)
    if (!isMic && signal.pan !== undefined) {
        sliders.pan.setValue(Math.round(signal.pan * 100), true);
    }

    // ADSR (layers only)
    if (!isMic && signal.adsr) {
        sliders.adsrA.setValue(Math.round(signal.adsr.attack * 1000), true);
        sliders.adsrD.setValue(Math.round(signal.adsr.decay * 1000), true);
        sliders.adsrS.setValue(Math.round(signal.adsr.sustain * 100), true);
        sliders.adsrR.setValue(Math.round(signal.adsr.release * 1000), true);
    }

    // Unison (layers only)
    if (!isMic && signal.unison) {
        sliders.unisonCount.setValue(signal.unison.count, true);
        sliders.unisonDetune.setValue(Math.round(signal.unison.detune * 100), true);
        sliders.unisonWidth.setValue(Math.round(signal.unison.stereoWidth * 100), true);
    }

    // Effect order
    buildEffectOrderList();

    // Collapse/expand panels based on enabled state
    syncPanelCollapse(signal);

    // Filter
    updateToggle(filterToggle, signal.filter.enabled);
    $$('#filter-type-btns .btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-type') === signal.filter.type);
    });
    sliders.filterCutoff.setValue(Math.round(freqToCutoffSlider(signal.filter.frequency)), true);
    sliders.filterQ.setValue(Math.round(signal.filter.Q * 10), true);

    // Delay
    updateToggle(delayToggle, signal.delay.enabled);
    sliders.delayTime.setValue(Math.round(signal.delay.time * 1000), true);
    sliders.delayFb.setValue(Math.round(signal.delay.feedback * 100), true);
    sliders.delayMix.setValue(Math.round(signal.delay.mix * 100), true);

    // Reverb
    updateToggle(reverbToggle, signal.reverb.enabled);
    sliders.reverbRoom.setValue(Math.round(signal.reverb.roomSize * 100), true);
    sliders.reverbDamp.setValue(Math.round(signal.reverb.damping * 100), true);
    sliders.reverbMix.setValue(Math.round(signal.reverb.mix * 100), true);

    // Chorus
    updateToggle(chorusToggle, signal.chorus.enabled);
    sliders.chorusRate.setValue(Math.round(signal.chorus.rate * 10), true);
    sliders.chorusDepth.setValue(Math.round(signal.chorus.depth * 10000), true);
    sliders.chorusMix.setValue(Math.round(signal.chorus.mix * 100), true);

    // Compressor
    updateToggle(compToggle, signal.compressor.enabled);
    sliders.compThresh.setValue(Math.round(signal.compressor.threshold), true);
    sliders.compRatio.setValue(Math.round(signal.compressor.ratio * 10), true);
    rebuildSidechainOptions();
    sidechainSelect.value = signal.compressor.sidechainBusId !== undefined ? signal.compressor.sidechainBusId : -1;

    // Equalizer
    updateToggle(eqToggle, signal.eq.enabled);
    for (var bi = 0; bi < 7; bi++) {
        sliders.eqBands[bi].setValue(signal.eq.bands[bi], true);
    }
    sliders.eqMaster.setValue(signal.eq.masterGain, true);

    // Distortion
    if (signal.distortion) {
        updateToggle(distToggle, signal.distortion.enabled);
        $$('#dist-mode-btns .btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === signal.distortion.mode);
        });
        sliders.distDrive.setValue(Math.round(signal.distortion.drive * 10), true);
        sliders.distMix.setValue(Math.round(signal.distortion.mix * 100), true);
        sliders.distOutput.setValue(Math.round(signal.distortion.outputGain * 100), true);
        sliders.distBits.setValue(Math.round(signal.distortion.crushBits), true);
        sliders.distRate.setValue(Math.round(signal.distortion.crushRate * 100), true);
    }

    // LFO
    updateToggle(lfoToggle, signal.lfo.enabled);
    sliders.lfoRate.setValue(Math.round(hzToLfoSlider(signal.lfo.rate)), true);
    sliders.lfoDepth.setValue(Math.round(signal.lfo.depth * 100), true);
    $$('#lfo-target-btns .btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-target') === signal.lfo.target);
    });

    // Seq/Arp mode (per-layer, not mic)
    if (!isMic) {
        $$('#seq-mode-btns .btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === signal.mode);
        });
        $$('#arp-pattern-btns .btn').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-pattern') === signal.arpPattern);
        });
    }

    // Highlight selected layer row
    $$('.seq-layer-row').forEach(function(row, i) {
        row.classList.toggle('selected', !isMic && i === Layers.getActiveIndex());
    });
}

// -----------------------------------------------------------------------
// initSidebar — build sliders, wire toggles, install the reactive seam
// -----------------------------------------------------------------------
export function initSidebar() {
    // -------------------------------------------------------------------
    // Collapsible panels — click header to toggle, auto-expand on enable
    // -------------------------------------------------------------------
    $$('.panel-collapsible').forEach(function(panel) {
        var header = panel.querySelector('.panel-header');
        if (!header) return;
        header.addEventListener('click', function(e) {
            // Don't toggle when clicking the On/Off button itself
            var tgt = e.target;
            if (tgt && tgt.classList && tgt.classList.contains('btn-toggle')) return;
            panel.classList.toggle('collapsed');
        });
    });

    // Map effect toggle buttons to their panels for auto-expand
    var togglePanelMap = {
        'filter-toggle': 'panel-filter',
        'delay-toggle': 'panel-delay',
        'reverb-toggle': 'panel-reverb',
        'chorus-toggle': 'panel-chorus',
        'comp-toggle': 'panel-compressor',
        'eq-toggle': 'panel-eq',
        'dist-toggle': 'panel-distortion',
        'lfo-toggle': 'panel-lfo'
    };

    // -------------------------------------------------------------------
    // Fancy Sliders — sidebar synth params
    // -------------------------------------------------------------------
    sliders.adsrA = slider($('#adsr-a-slider'), {
        min: 1, max: 2000, value: 10, step: 1, defaultValue: 10,
        format: formatMs,
        onChange: function(ms) {
            signalParam('adsr.attack', ms / 1000);
            Layers.updateActiveAllocator();
        }
    });

    sliders.adsrD = slider($('#adsr-d-slider'), {
        min: 1, max: 2000, value: 100, step: 1, defaultValue: 100,
        format: formatMs,
        onChange: function(ms) {
            signalParam('adsr.decay', ms / 1000);
            Layers.updateActiveAllocator();
        }
    });

    sliders.adsrS = slider($('#adsr-s-slider'), {
        min: 0, max: 100, value: 100, step: 1, defaultValue: 100,
        format: function(v) { return v + '%'; },
        onChange: function(pct) {
            signalParam('adsr.sustain', pct / 100);
            Layers.updateActiveAllocator();
        }
    });

    sliders.adsrR = slider($('#adsr-r-slider'), {
        min: 1, max: 3000, value: 80, step: 1, defaultValue: 80,
        format: formatMs,
        onChange: function(ms) {
            signalParam('adsr.release', ms / 1000);
            Layers.updateActiveAllocator();
        }
    });

    // -------------------------------------------------------------------
    // Unison sliders
    // -------------------------------------------------------------------
    sliders.unisonCount = slider($('#unison-count-slider'), {
        min: 1, max: 8, value: 1, step: 1, defaultValue: 1,
        format: function(v) { return v === 1 ? 'Off' : v + 'x'; },
        onChange: function(v) {
            signalParam('unison.count', v);
            Layers.updateActiveAllocator();
        }
    });

    sliders.unisonDetune = slider($('#unison-detune-slider'), {
        min: 0, max: 200, value: 15, step: 1, defaultValue: 15,
        format: function(v) { return (v / 100).toFixed(2) + ' st'; },
        onChange: function(v) {
            signalParam('unison.detune', v / 100);
            Layers.updateActiveAllocator();
        }
    });

    sliders.unisonWidth = slider($('#unison-width-slider'), {
        min: 0, max: 100, value: 70, step: 1, defaultValue: 70,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('unison.stereoWidth', v / 100);
            Layers.updateActiveAllocator();
        }
    });

    sliders.filterCutoff = slider($('#filter-cutoff-slider'), {
        min: 0, max: 100, value: 50, step: 0.5, defaultValue: 50,
        format: function(v) { return formatFreq(cutoffSliderToFreq(v)); },
        onChange: function(v) {
            var freq = cutoffSliderToFreq(v);
            signalParam('filter.frequency', freq);
            SignalChain.setFilterFrequency(activeBusId(), freq);
        }
    });

    sliders.filterQ = slider($('#filter-q-slider'), {
        min: 1, max: 200, value: 10, step: 1, defaultValue: 10,
        format: function(v) { return (v / 10).toFixed(1); },
        onChange: function(v) {
            signalParam('filter.Q', v / 10);
            SignalChain.setFilterQ(activeBusId(), v / 10);
        }
    });

    sliders.delayTime = slider($('#delay-time-slider'), {
        min: 10, max: 1500, value: 300, step: 1, defaultValue: 300,
        format: formatMs,
        onChange: function(ms) {
            signalParam('delay.time', ms / 1000);
            SignalChain.setDelayTime(activeBusId(), ms / 1000);
        }
    });

    sliders.delayFb = slider($('#delay-fb-slider'), {
        min: 0, max: 90, value: 30, step: 1, defaultValue: 30,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('delay.feedback', v / 100);
            SignalChain.setDelayFeedback(activeBusId(), v / 100);
        }
    });

    sliders.delayMix = slider($('#delay-mix-slider'), {
        min: 0, max: 100, value: 30, step: 1, defaultValue: 30,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('delay.mix', v / 100);
            SignalChain.setDelayMix(activeBusId(), v / 100);
        }
    });

    // -------------------------------------------------------------------
    // Reverb sliders
    // -------------------------------------------------------------------
    sliders.reverbRoom = slider($('#reverb-room-slider'), {
        min: 0, max: 100, value: 50, step: 1, defaultValue: 50,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('reverb.roomSize', v / 100);
            SignalChain.setReverbRoomSize(activeBusId(), v / 100);
        }
    });

    sliders.reverbDamp = slider($('#reverb-damp-slider'), {
        min: 0, max: 100, value: 50, step: 1, defaultValue: 50,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('reverb.damping', v / 100);
            SignalChain.setReverbDamping(activeBusId(), v / 100);
        }
    });

    sliders.reverbMix = slider($('#reverb-mix-slider'), {
        min: 0, max: 100, value: 20, step: 1, defaultValue: 20,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('reverb.mix', v / 100);
            SignalChain.setReverbMix(activeBusId(), v / 100);
        }
    });

    // -------------------------------------------------------------------
    // Chorus sliders
    // -------------------------------------------------------------------
    sliders.chorusRate = slider($('#chorus-rate-slider'), {
        min: 1, max: 100, value: 20, step: 1, defaultValue: 20,
        format: function(v) { return (v / 10).toFixed(1) + 'Hz'; },
        onChange: function(v) {
            signalParam('chorus.rate', v / 10);
            SignalChain.setChorusRate(activeBusId(), v / 10);
        }
    });

    sliders.chorusDepth = slider($('#chorus-depth-slider'), {
        min: 0, max: 100, value: 30, step: 1, defaultValue: 30,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('chorus.depth', v / 10000);
            SignalChain.setChorusDepth(activeBusId(), v / 10000);
        }
    });

    sliders.chorusMix = slider($('#chorus-mix-slider'), {
        min: 0, max: 100, value: 30, step: 1, defaultValue: 30,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('chorus.mix', v / 100);
            SignalChain.setChorusMix(activeBusId(), v / 100);
        }
    });

    // -------------------------------------------------------------------
    // Compressor sliders
    // -------------------------------------------------------------------
    sliders.compThresh = slider($('#comp-thresh-slider'), {
        min: -60, max: 0, value: -12, step: 1, defaultValue: -12,
        format: function(v) { return v + 'dB'; },
        onChange: function(v) {
            signalParam('compressor.threshold', v);
            SignalChain.setCompressorThreshold(activeBusId(), v);
        }
    });

    sliders.compRatio = slider($('#comp-ratio-slider'), {
        min: 10, max: 200, value: 40, step: 1, defaultValue: 40,
        format: function(v) { return (v / 10).toFixed(1) + ':1'; },
        onChange: function(v) {
            signalParam('compressor.ratio', v / 10);
            SignalChain.setCompressorRatio(activeBusId(), v / 10);
        }
    });

    // -------------------------------------------------------------------
    // Equalizer sliders (7 bands + master)
    // -------------------------------------------------------------------
    var EQ_BAND_LABELS = ['60Hz', '170Hz', '350Hz', '1kHz', '3.5kHz', '10kHz', '16kHz'];
    sliders.eqBands = [];
    for (var bi = 0; bi < 7; bi++) {
        (function(band) {
            sliders.eqBands[band] = slider($('#eq-band' + band + '-slider'), {
                min: -12, max: 12, value: 0, step: 0.5, defaultValue: 0,
                format: function(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + 'dB'; },
                onChange: function(v) {
                    var signal = Layers.getActiveSignal();
                    if (signal && signal.eq) signal.eq.bands[band] = v;
                    SignalChain.setEqBandGain(activeBusId(), band, v);
                }
            });
        })(bi);
    }

    sliders.eqMaster = slider($('#eq-master-slider'), {
        min: -12, max: 12, value: 0, step: 0.5, defaultValue: 0,
        format: function(v) { return (v > 0 ? '+' : '') + v.toFixed(1) + 'dB'; },
        onChange: function(v) {
            signalParam('eq.masterGain', v);
            SignalChain.setEqMasterGain(activeBusId(), v);
        }
    });

    // -------------------------------------------------------------------
    // Distortion sliders
    // -------------------------------------------------------------------
    sliders.distDrive = slider($('#dist-drive-slider'), {
        min: 10, max: 500, value: 25, step: 1, defaultValue: 25,
        format: function(v) { return (v / 10).toFixed(1) + 'x'; },
        onChange: function(v) {
            signalParam('distortion.drive', v / 10);
            SignalChain.setDistortionDrive(activeBusId(), v / 10);
        }
    });

    sliders.distMix = slider($('#dist-mix-slider'), {
        min: 0, max: 100, value: 100, step: 1, defaultValue: 100,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('distortion.mix', v / 100);
            SignalChain.setDistortionMix(activeBusId(), v / 100);
        }
    });

    sliders.distOutput = slider($('#dist-output-slider'), {
        min: 0, max: 200, value: 70, step: 1, defaultValue: 70,
        format: function(v) { return (v / 100).toFixed(2) + 'x'; },
        onChange: function(v) {
            signalParam('distortion.outputGain', v / 100);
            SignalChain.setDistortionOutputGain(activeBusId(), v / 100);
        }
    });

    sliders.distBits = slider($('#dist-bits-slider'), {
        min: 1, max: 16, value: 8, step: 1, defaultValue: 8,
        format: function(v) { return v + ' bit'; },
        onChange: function(v) {
            signalParam('distortion.crushBits', v);
            SignalChain.setDistortionCrushBits(activeBusId(), v);
        }
    });

    sliders.distRate = slider($('#dist-rate-slider'), {
        min: 1, max: 100, value: 50, step: 1, defaultValue: 50,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('distortion.crushRate', v / 100);
            SignalChain.setDistortionCrushRate(activeBusId(), v / 100);
        }
    });

    // -------------------------------------------------------------------
    // Sidechain select
    // -------------------------------------------------------------------
    sidechainSelect = $('#comp-sidechain-select');
    on(sidechainSelect, 'change', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var scBusId = parseInt(sidechainSelect.value, 10);
        signal.compressor.sidechainBusId = scBusId;
        SignalChain.setCompressorSidechain(activeBusId(), scBusId);
    });

    sliders.lfoRate = slider($('#lfo-rate-slider'), {
        min: 0, max: 100, value: 30, step: 0.5, defaultValue: 30,
        format: function(v) { return formatLfoRate(lfoSliderToHz(v)); },
        onChange: function(v) {
            var hz = lfoSliderToHz(v);
            signalParam('lfo.rate', hz);
            LFO.setRate(hz);
        }
    });

    sliders.lfoDepth = slider($('#lfo-depth-slider'), {
        min: 0, max: 100, value: 30, step: 1, defaultValue: 30,
        format: function(v) { return v + '%'; },
        onChange: function(v) {
            signalParam('lfo.depth', v / 100);
            LFO.setDepth(v / 100);
        }
    });

    // -------------------------------------------------------------------
    // Waveform buttons (per-layer)
    // -------------------------------------------------------------------
    $$('#wave-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#wave-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var wf = btn.getAttribute('data-wave');
            signalParam('waveform', wf);
            Layers.updateActiveAllocator();
        });
    });

    // -------------------------------------------------------------------
    // Pan slider (per-layer)
    // -------------------------------------------------------------------
    sliders.pan = slider($('#pan-slider'), {
        min: -100, max: 100, value: 0, step: 1, defaultValue: 0,
        format: function(v) {
            if (v === 0) return 'C';
            return v < 0 ? 'L' + Math.abs(v) : 'R' + v;
        },
        onChange: function(v) {
            var pan = v / 100;
            signalParam('pan', pan);
            Layers.updateActiveAllocator();
        }
    });

    // -------------------------------------------------------------------
    // Volume (global, not per-layer)
    // -------------------------------------------------------------------
    on($('#volume'), 'input', function(e) {
        engine.setVolume(parseInt(e.target.value) / 100);
    });

    // -------------------------------------------------------------------
    // Filter toggle & type
    // -------------------------------------------------------------------
    filterToggle = $('#filter-toggle');
    on(filterToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.filter.enabled;
        signal.filter.enabled = enabled;
        SignalChain.setFilterEnabled(activeBusId(), enabled);
        updateToggle(filterToggle, enabled);
        if (enabled) $('#panel-filter').classList.remove('collapsed');
    });

    $$('#filter-type-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#filter-type-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var type = btn.getAttribute('data-type');
            signalParam('filter.type', type);
            SignalChain.setFilterType(activeBusId(), type);
        });
    });

    // -------------------------------------------------------------------
    // Delay toggle
    // -------------------------------------------------------------------
    delayToggle = $('#delay-toggle');
    on(delayToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.delay.enabled;
        signal.delay.enabled = enabled;
        SignalChain.setDelayEnabled(activeBusId(), enabled);
        updateToggle(delayToggle, enabled);
        if (enabled) $('#panel-delay').classList.remove('collapsed');
    });

    // -------------------------------------------------------------------
    // Reverb toggle
    // -------------------------------------------------------------------
    reverbToggle = $('#reverb-toggle');
    on(reverbToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.reverb.enabled;
        signal.reverb.enabled = enabled;
        SignalChain.setReverbEnabled(activeBusId(), enabled);
        updateToggle(reverbToggle, enabled);
        if (enabled) $('#panel-reverb').classList.remove('collapsed');
    });

    // -------------------------------------------------------------------
    // Chorus toggle
    // -------------------------------------------------------------------
    chorusToggle = $('#chorus-toggle');
    on(chorusToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.chorus.enabled;
        signal.chorus.enabled = enabled;
        SignalChain.setChorusEnabled(activeBusId(), enabled);
        updateToggle(chorusToggle, enabled);
        if (enabled) $('#panel-chorus').classList.remove('collapsed');
    });

    // -------------------------------------------------------------------
    // Compressor toggle
    // -------------------------------------------------------------------
    compToggle = $('#comp-toggle');
    on(compToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.compressor.enabled;
        signal.compressor.enabled = enabled;
        SignalChain.setCompressorEnabled(activeBusId(), enabled);
        updateToggle(compToggle, enabled);
        if (enabled) $('#panel-compressor').classList.remove('collapsed');
    });

    // -------------------------------------------------------------------
    // EQ toggle
    // -------------------------------------------------------------------
    eqToggle = $('#eq-toggle');
    on(eqToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.eq.enabled;
        signal.eq.enabled = enabled;
        SignalChain.setEqEnabled(activeBusId(), enabled);
        updateToggle(eqToggle, enabled);
        if (enabled) $('#panel-eq').classList.remove('collapsed');
    });

    // -------------------------------------------------------------------
    // Distortion toggle + mode
    // -------------------------------------------------------------------
    distToggle = $('#dist-toggle');
    on(distToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal || !signal.distortion) return;
        var enabled = !signal.distortion.enabled;
        signal.distortion.enabled = enabled;
        SignalChain.setDistortionEnabled(activeBusId(), enabled);
        updateToggle(distToggle, enabled);
        if (enabled) $('#panel-distortion').classList.remove('collapsed');
    });

    $$('#dist-mode-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#dist-mode-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var mode = btn.getAttribute('data-mode');
            signalParam('distortion.mode', mode);
            SignalChain.setDistortionMode(activeBusId(), mode);
        });
    });

    // -------------------------------------------------------------------
    // LFO toggle & target
    // -------------------------------------------------------------------
    lfoToggle = $('#lfo-toggle');
    on(lfoToggle, 'click', function() {
        var signal = Layers.getActiveSignal();
        if (!signal) return;
        var enabled = !signal.lfo.enabled;
        signal.lfo.enabled = enabled;
        LFO.setEnabled(enabled);
        updateToggle(lfoToggle, enabled);
        if (enabled) $('#panel-lfo').classList.remove('collapsed');
    });

    $$('#lfo-target-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#lfo-target-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var t = btn.getAttribute('data-target');
            LFO.setTarget(t);
            signalParam('lfo.target', t);
        });
    });

    // -------------------------------------------------------------------
    // Reactive seam: re-sync the sidebar whenever the active signal bumps.
    // Runs once immediately (effect semantics), replacing the old manual
    // Layers.onSelect(syncUIToSignal) + the final syncUIToSignal() call.
    // -------------------------------------------------------------------
    effect(function() {
        activeVersion();
        syncUIToSignal();
    });
}
