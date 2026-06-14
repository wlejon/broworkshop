// ---------------------------------------------------------------------------
// Layers grid — the multi-layer sequencer step grid + per-row automation editor,
// plus the sequencer transport controls (play, BPM, save-loop, freeform record,
// seq/arp mode buttons, add-layer).
//
// `rebuild()` rebuilds the grid (the old `buildLayerRows`). The automation-editor
// canvas block is preserved verbatim.
// ---------------------------------------------------------------------------

import { $, $$, on } from "/std/dom.js";
import { engine } from "/app/lib/synth-engine.js";
import { Layers } from "/app/lib/layers.js";
import { Sequencer } from "/app/lib/sequencer.js";
import { Visualizer } from "/app/lib/visualizer.js";

var seqLayersEl;
var seqRecording = false;

// -----------------------------------------------------------------------
// Sequencer — multi-layer grid
// -----------------------------------------------------------------------
function buildLayerRows() {
    seqLayersEl.innerHTML = '';
    var count = Layers.count();

    for (var li = 0; li < count; li++) {
        (function(layerIdx) {
            var layer = Layers.get(layerIdx);
            var row = document.createElement('div');
            row.className = 'seq-layer-row';
            if (!Layers.isEditingMic() && layerIdx === Layers.getActiveIndex()) row.classList.add('selected');

            // Label (click to select)
            var label = document.createElement('div');
            label.className = 'seq-layer-label';
            label.style.borderLeftColor = layer.color;
            label.textContent = layer.name;
            label.addEventListener('click', function() {
                Layers.select(layerIdx);
                buildLayerRows();
            });
            row.appendChild(label);

            // Mode toggle (S = sequencer, A = arpeggiator)
            var modeBtn = document.createElement('div');
            modeBtn.className = 'seq-layer-mode' + (layer.mode === 'arpeggiator' ? ' arp' : '');
            modeBtn.textContent = layer.mode === 'arpeggiator' ? 'A' : 'S';
            modeBtn.title = 'Toggle Seq/Arp';
            modeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                layer.mode = layer.mode === 'arpeggiator' ? 'sequencer' : 'arpeggiator';
                layer.arpIndex = 0;
                modeBtn.textContent = layer.mode === 'arpeggiator' ? 'A' : 'S';
                modeBtn.classList.toggle('arp', layer.mode === 'arpeggiator');
                // Sync sidebar buttons if this is the active layer
                if (layerIdx === Layers.getActiveIndex()) {
                    $$('#seq-mode-btns .btn').forEach(function(b) {
                        b.classList.toggle('active', b.getAttribute('data-mode') === layer.mode);
                    });
                }
            });
            row.appendChild(modeBtn);

            // Mute button
            var muteBtn = document.createElement('div');
            muteBtn.className = 'seq-layer-mute' + (layer.muted ? ' muted' : '');
            muteBtn.textContent = 'M';
            muteBtn.title = 'Mute';
            muteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                layer.muted = !layer.muted;
                muteBtn.classList.toggle('muted', layer.muted);
                if (Sequencer.isPlaying()) Sequencer.rebuild();
            });
            row.appendChild(muteBtn);

            // Duplicate button
            var dupBtn = document.createElement('div');
            dupBtn.className = 'seq-layer-dup';
            dupBtn.textContent = 'D';
            dupBtn.title = 'Duplicate';
            dupBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (Layers.duplicate(layerIdx)) {
                    buildLayerRows();
                }
            });
            row.appendChild(dupBtn);

            // Delete button (only if >1 layer)
            if (count > 1) {
                var delBtn = document.createElement('div');
                delBtn.className = 'seq-layer-del';
                delBtn.textContent = 'X';
                delBtn.title = 'Delete';
                delBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    Layers.remove(layerIdx);
                    buildLayerRows();
                });
                row.appendChild(delBtn);
            }

            // Level meter
            var meter = document.createElement('div');
            meter.className = 'seq-layer-meter';
            meter.setAttribute('data-bus', layer.busId.toString());
            var meterL = document.createElement('div');
            meterL.className = 'meter-bar meter-l';
            var meterR = document.createElement('div');
            meterR.className = 'meter-bar meter-r';
            meter.appendChild(meterL);
            meter.appendChild(meterR);
            row.appendChild(meter);

            // Step grid
            var grid = document.createElement('div');
            grid.className = 'seq-layer-grid';

            for (var si = 0; si < Sequencer.NUM_STEPS; si++) {
                (function(stepIdx) {
                    var stepEl = document.createElement('div');
                    stepEl.className = 'seq-step';
                    stepEl.setAttribute('data-layer', layerIdx.toString());
                    stepEl.setAttribute('data-step', stepIdx.toString());

                    var noteIdx = layer.steps[stepIdx];
                    if (noteIdx !== null && noteIdx !== undefined) {
                        stepEl.classList.add('active');
                        stepEl.style.background = layer.color + '25';
                        stepEl.style.borderColor = layer.color + '60';
                        stepEl.style.color = layer.color;
                        stepEl.textContent = engine.notes[noteIdx] ? engine.notes[noteIdx].name : '';
                    }

                    stepEl.addEventListener('click', function() {
                        var current = Layers.getStep(layerIdx, stepIdx);
                        if (current !== null) {
                            Layers.clearStep(layerIdx, stepIdx);
                            stepEl.classList.remove('active');
                            stepEl.style.background = '';
                            stepEl.style.borderColor = '';
                            stepEl.style.color = '';
                            stepEl.textContent = '';
                        } else {
                            // Select this layer first
                            if (layerIdx !== Layers.getActiveIndex()) {
                                Layers.select(layerIdx);
                                buildLayerRows();
                                return; // rebuild will re-render; let user click again
                            }
                            var ni = engine.getLastPlayedNote();
                            Layers.setStep(layerIdx, stepIdx, ni);
                            stepEl.classList.add('active');
                            stepEl.style.background = layer.color + '25';
                            stepEl.style.borderColor = layer.color + '60';
                            stepEl.style.color = layer.color;
                            stepEl.textContent = engine.notes[ni] ? engine.notes[ni].name : '';
                        }
                        // Update running sequences with new step data
                        if (Sequencer.isPlaying()) Sequencer.rebuild();
                    });

                    grid.appendChild(stepEl);
                })(si);
            }

            row.appendChild(grid);
            seqLayersEl.appendChild(row);

            // --- Automation row ---
            var autoRow = document.createElement('div');
            autoRow.className = 'seq-auto-row';

            // Toggle button to show/hide automation
            var autoToggle = document.createElement('div');
            autoToggle.className = 'seq-auto-toggle' + (layer.automation.length > 0 ? ' active' : '');
            autoToggle.textContent = 'A';
            autoToggle.title = 'Toggle automation';
            autoToggle.addEventListener('click', function() {
                var l = Layers.get(layerIdx);
                if (l.automation.length === 0) {
                    // Add a default automation lane (filter freq)
                    var tgt = 'filter-freq';
                    var def = Layers.AUTOMATION_TARGETS[tgt];
                    l.automation.push({
                        target: tgt,
                        interpMode: 'linear',
                        points: []
                    });
                } else {
                    l.automation = [];
                }
                buildLayerRows();
                if (Sequencer.isPlaying()) Sequencer.rebuild();
            });
            autoRow.appendChild(autoToggle);

            if (layer.automation.length > 0) {
                var autoData = layer.automation[0]; // one lane per layer for now
                var targets = Layers.AUTOMATION_TARGETS;

                // Target selector
                var targetSel = document.createElement('select');
                targetSel.className = 'seq-auto-target';
                var targetKeys = Object.keys(targets);
                for (var ti = 0; ti < targetKeys.length; ti++) {
                    var opt = document.createElement('option');
                    opt.value = targetKeys[ti];
                    opt.textContent = targets[targetKeys[ti]].label;
                    if (targetKeys[ti] === autoData.target) opt.selected = true;
                    targetSel.appendChild(opt);
                }
                targetSel.addEventListener('change', function() {
                    var l = Layers.get(layerIdx);
                    l.automation[0].target = this.value;
                    l.automation[0].points = [];
                    buildLayerRows();
                    if (Sequencer.isPlaying()) Sequencer.rebuild();
                });
                autoRow.appendChild(targetSel);

                // Interp mode button
                var interpBtn = document.createElement('div');
                interpBtn.className = 'seq-auto-interp';
                var modes = ['linear', 'smooth', 'step'];
                interpBtn.textContent = autoData.interpMode === 'smooth' ? 'S' : autoData.interpMode === 'step' ? 'H' : 'L';
                interpBtn.title = 'Interpolation: ' + autoData.interpMode;
                interpBtn.addEventListener('click', function() {
                    var l = Layers.get(layerIdx);
                    var cur = modes.indexOf(l.automation[0].interpMode);
                    l.automation[0].interpMode = modes[(cur + 1) % modes.length];
                    buildLayerRows();
                    if (Sequencer.isPlaying()) Sequencer.rebuild();
                });
                autoRow.appendChild(interpBtn);

                // Canvas for drawing automation
                var canvas = document.createElement('canvas');
                canvas.className = 'seq-auto-canvas';
                autoRow.appendChild(canvas);

                // Draw and interact with automation points
                (function(canvas, layerIdx) {
                    var TARGETS = Layers.AUTOMATION_TARGETS;
                    var POINT_RADIUS = 4;
                    var dragging = -1;

                    function getAutoData() {
                        var l = Layers.get(layerIdx);
                        return l && l.automation.length > 0 ? l.automation[0] : null;
                    }

                    function getTarget() {
                        var ad = getAutoData();
                        return ad ? TARGETS[ad.target] : null;
                    }

                    // Map value to Y position (0 = top = max, h = bottom = min)
                    function valToY(val, h, tgt) {
                        if (tgt.log) {
                            var logMin = Math.log(tgt.min), logMax = Math.log(tgt.max);
                            return h - (Math.log(Math.max(val, tgt.min)) - logMin) / (logMax - logMin) * h;
                        }
                        return h - (val - tgt.min) / (tgt.max - tgt.min) * h;
                    }

                    function yToVal(y, h, tgt) {
                        var norm = 1 - y / h;
                        norm = Math.max(0, Math.min(1, norm));
                        if (tgt.log) {
                            var logMin = Math.log(tgt.min), logMax = Math.log(tgt.max);
                            return Math.exp(logMin + norm * (logMax - logMin));
                        }
                        return tgt.min + norm * (tgt.max - tgt.min);
                    }

                    function beatToX(beat, w) { return beat / 4 * w; }
                    function xToBeat(x, w) { return Math.max(0, Math.min(4, x / w * 4)); }

                    function draw() {
                        var w = canvas.clientWidth;
                        var h = canvas.clientHeight;
                        if (w <= 0 || h <= 0) return;
                        // Sync bitmap size to display size
                        if (canvas.width !== w) canvas.width = w;
                        if (canvas.height !== h) canvas.height = h;
                        var ctx = canvas.getContext('2d');
                        // Draw background (CSS bg is transparent for compositing)
                        ctx.fillStyle = '#12121a';
                        ctx.fillRect(0, 0, w, h);

                        var ad = getAutoData();
                        var tgt = getTarget();
                        if (!ad || !tgt) return;

                        var color = Layers.get(layerIdx).color || '#00e5ff';

                        // Draw grid lines at each step
                        ctx.strokeStyle = '#ffffff10';
                        ctx.lineWidth = 1;
                        for (var s = 0; s <= 16; s++) {
                            var gx = s / 16 * w;
                            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
                        }

                        if (ad.points.length === 0) return;

                        // Sort points for drawing
                        var pts = ad.points.slice().sort(function(a, b) { return a.beat - b.beat; });

                        // Draw interpolated curve
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        for (var px = 0; px < w; px++) {
                            var beat = xToBeat(px, w);
                            var val = evaluateAutomation(pts, beat, ad.interpMode, tgt);
                            var py = valToY(val, h, tgt);
                            if (px === 0) ctx.moveTo(px, py);
                            else ctx.lineTo(px, py);
                        }
                        ctx.stroke();

                        // Draw points
                        for (var i = 0; i < pts.length; i++) {
                            var bx = beatToX(pts[i].beat, w);
                            var by = valToY(pts[i].value, h, tgt);
                            ctx.beginPath();
                            ctx.arc(bx, by, POINT_RADIUS, 0, Math.PI * 2);
                            ctx.fillStyle = color;
                            ctx.fill();
                            ctx.strokeStyle = '#fff';
                            ctx.lineWidth = 1;
                            ctx.stroke();
                        }
                    }

                    // Simple JS-side evaluation for drawing curves
                    function evaluateAutomation(pts, beat, mode, tgt) {
                        if (pts.length === 0) return tgt.default;
                        if (pts.length === 1) return pts[0].value;
                        if (beat <= pts[0].beat) return pts[0].value;
                        if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

                        var p1, p2;
                        for (var i = 0; i < pts.length - 1; i++) {
                            if (beat >= pts[i].beat && beat < pts[i + 1].beat) {
                                p1 = pts[i]; p2 = pts[i + 1]; break;
                            }
                        }
                        if (!p1) return pts[pts.length - 1].value;

                        if (mode === 'step') return p1.value;
                        var t = (beat - p1.beat) / (p2.beat - p1.beat);
                        if (mode === 'smooth') t = (1 - Math.cos(t * Math.PI)) * 0.5;
                        return p1.value + t * (p2.value - p1.value);
                    }

                    function canvasSize() {
                        return { w: canvas.clientWidth, h: canvas.clientHeight };
                    }

                    function findPoint(x, y, w, h, pts, tgt) {
                        for (var i = 0; i < pts.length; i++) {
                            var bx = beatToX(pts[i].beat, w);
                            var by = valToY(pts[i].value, h, tgt);
                            if (Math.abs(x - bx) < 8 && Math.abs(y - by) < 8) return i;
                        }
                        return -1;
                    }

                    canvas.addEventListener('mousedown', function(e) {
                        var ad = getAutoData();
                        var tgt = getTarget();
                        if (!ad || !tgt) return;
                        var rect = canvas.getBoundingClientRect();
                        var x = e.clientX - rect.left;
                        var y = e.clientY - rect.top;
                        var sz = canvasSize();

                        var idx = findPoint(x, y, sz.w, sz.h, ad.points, tgt);
                        if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
                            // Right-click or ctrl+click: delete point
                            if (idx >= 0) {
                                ad.points.splice(idx, 1);
                                draw();
                                if (Sequencer.isPlaying()) Sequencer.rebuild();
                            }
                            e.preventDefault();
                            return;
                        }
                        if (idx >= 0) {
                            dragging = idx;
                        } else {
                            // Add new point
                            var beat = xToBeat(x, sz.w);
                            var val = yToVal(y, sz.h, tgt);
                            ad.points.push({ beat: beat, value: val });
                            ad.points.sort(function(a, b) { return a.beat - b.beat; });
                            dragging = findPoint(x, y, sz.w, sz.h, ad.points, tgt);
                            draw();
                            if (Sequencer.isPlaying()) Sequencer.rebuild();
                        }
                    });

                    canvas.addEventListener('mousemove', function(e) {
                        if (dragging < 0) return;
                        var ad = getAutoData();
                        var tgt = getTarget();
                        if (!ad || !tgt) return;
                        var rect = canvas.getBoundingClientRect();
                        var x = e.clientX - rect.left;
                        var y = e.clientY - rect.top;
                        var sz = canvasSize();

                        ad.points[dragging].beat = xToBeat(x, sz.w);
                        ad.points[dragging].value = yToVal(y, sz.h, tgt);
                        draw();
                    });

                    canvas.addEventListener('mouseup', function() {
                        if (dragging >= 0) {
                            dragging = -1;
                            var ad = getAutoData();
                            if (ad) ad.points.sort(function(a, b) { return a.beat - b.beat; });
                            if (Sequencer.isPlaying()) Sequencer.rebuild();
                        }
                    });

                    canvas.addEventListener('mouseleave', function() {
                        if (dragging >= 0) {
                            dragging = -1;
                            var ad = getAutoData();
                            if (ad) ad.points.sort(function(a, b) { return a.beat - b.beat; });
                            if (Sequencer.isPlaying()) Sequencer.rebuild();
                        }
                    });

                    canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

                    // Initial draw after layout
                    setTimeout(draw, 0);
                })(canvas, layerIdx);
            }

            seqLayersEl.appendChild(autoRow);
        })(li);
    }

    // Rebuild visualizer rows to match current layers
    if (Visualizer && Visualizer.rebuild) {
        Visualizer.rebuild();
    }
}

// Public: rebuild the grid from current layer state.
export function rebuild() {
    buildLayerRows();
}

// -----------------------------------------------------------------------
// initLayersGrid — wire the grid, step highlight, transport, add-layer
// -----------------------------------------------------------------------
export function initLayersGrid() {
    seqLayersEl = $('#seq-layers');

    // Step highlight callback
    Sequencer.onStep(function(step) {
        $$('.seq-step').forEach(function(el) {
            el.classList.toggle('playing', parseInt(el.getAttribute('data-step')) === step);
        });
    });

    // Add layer button
    on($('#layer-add'), 'click', function() {
        var newLayer = Layers.add();
        if (newLayer) {
            Layers.select(Layers.count() - 1);
            buildLayerRows();
        }
    });

    // Build initial layer rows
    buildLayerRows();

    // -------------------------------------------------------------------
    // Sequencer transport & controls
    // -------------------------------------------------------------------
    on($('#seq-play'), 'click', function() {
        if (Sequencer.isPlaying()) {
            Sequencer.stop();
            this.textContent = 'Play';
        } else {
            Sequencer.start();
            this.textContent = 'Stop';
        }
    });

    on($('#seq-bpm'), 'input', function(e) {
        Sequencer.setBPM(parseInt(e.target.value));
        $('#seq-bpm-display').textContent = e.target.value;
    });

    // -------------------------------------------------------------------
    // Save Loop — offline-render one full sequencer/arp loop to WAV
    // -------------------------------------------------------------------
    on($('#seq-save-loop'), 'click', function() {
        var audioCtx = engine.getAudioContext();
        if (!audioCtx) return;

        var NUM_STEPS = Sequencer.NUM_STEPS;
        var bpm = Sequencer.getBPM();
        var SAMPLE_RATE = audioCtx.sampleRate || 44100;
        var stepDur = 60 / bpm / 4;
        var loopDur = stepDur * NUM_STEPS;
        var layerCount = Layers.count();

        // Check there are notes to play
        var hasNotes = false;
        for (var i = 0; i < layerCount; i++) {
            var layer = Layers.get(i);
            if (!layer || layer.muted) continue;
            for (var s = 0; s < NUM_STEPS; s++) {
                if (layer.steps[s] !== null) { hasNotes = true; break; }
            }
            if (hasNotes) break;
        }
        if (!hasNotes) {
            console.warn('Nothing to save — add notes to the sequencer');
            return;
        }

        var path = showSaveFileDialog('WAV Files|wav', 'loop.wav');
        if (!path) return;
        if (path.indexOf('.wav') < 0 && path.indexOf('.WAV') < 0) path += '.wav';

        var btn = $('#seq-save-loop');
        btn.textContent = 'Saving...';
        btn.classList.add('active');

        function collectUnique(layer) {
            var held = [];
            for (var i = 0; i < NUM_STEPS; i++) {
                if (layer.steps[i] !== null && held.indexOf(layer.steps[i]) < 0) held.push(layer.steps[i]);
            }
            held.sort(function(a, b) { return a - b; });
            return held;
        }

        function pickArp(arpIdx, held, pattern) {
            if (held.length === 0) return { note: -1, next: arpIdx };
            var idx, next;
            switch (pattern) {
                case 'down':
                    idx = held[held.length - 1 - (arpIdx % held.length)]; next = arpIdx + 1; break;
                case 'updown':
                    if (held.length === 1) { idx = held[0]; next = arpIdx; }
                    else { var c = held.length * 2 - 2; var p = arpIdx % c;
                           idx = p < held.length ? held[p] : held[c - p]; next = arpIdx + 1; }
                    break;
                case 'random':
                    idx = held[Math.floor(Math.random() * held.length)]; next = arpIdx; break;
                default: idx = held[arpIdx % held.length]; next = arpIdx + 1;
            }
            return { note: idx, next: next };
        }

        // Find max release for tail
        var maxRelease = 0;
        for (var li = 0; li < layerCount; li++) {
            var l = Layers.get(li);
            if (l && !l.muted) maxRelease = Math.max(maxRelease, l.adsr.release);
        }

        var totalSamples = Math.ceil((loopDur + maxRelease) * SAMPLE_RATE);
        var mixedOutput = new Float32Array(totalSamples);

        // Render each layer: oscillator+ADSR in JS, then effects offline in C++
        for (var li = 0; li < layerCount; li++) {
            var layer = Layers.get(li);
            if (!layer || layer.muted) continue;

            var layerBuf = new Float32Array(totalSamples);
            var arpIdx = 0;

            for (var step = 0; step < NUM_STEPS; step++) {
                var noteIdx = -1;
                if (layer.mode === 'arpeggiator') {
                    if (layer.steps[step] !== null) {
                        var pick = pickArp(arpIdx, collectUnique(layer), layer.arpPattern);
                        noteIdx = pick.note; arpIdx = pick.next;
                    }
                } else {
                    var sn = layer.steps[step];
                    if (sn !== null && sn !== undefined && sn >= 0) noteIdx = sn;
                }
                if (noteIdx < 0) continue;
                var note = engine.notes[noteIdx];
                if (!note) continue;

                var startSmp = Math.floor(step * stepDur * SAMPLE_RATE);
                var onSmp = Math.floor(stepDur * SAMPLE_RATE);
                var relSmp = Math.ceil(layer.adsr.release * SAMPLE_RATE);
                var noteSmp = onSmp + relSmp;

                for (var s = 0; s < noteSmp; s++) {
                    var outIdx = startSmp + s;
                    if (outIdx >= totalSamples) break;
                    var t = s / SAMPLE_RATE;
                    var phase = t * note.freq;
                    var val;
                    switch (layer.waveform) {
                        case 'square':     val = (phase % 1) < 0.5 ? 1 : -1; break;
                        case 'sawtooth':   val = 2 * (phase % 1) - 1; break;
                        case 'triangle':   var p = phase % 1; val = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
                        case 'whitenoise': val = Math.random() * 2 - 1; break;
                        case 'pinknoise':  val = (Math.random() + Math.random() + Math.random()) / 1.5 - 1; break;
                        default:           val = Math.sin(2 * Math.PI * phase);
                    }
                    var env;
                    if (t < layer.adsr.attack) {
                        env = layer.adsr.attack > 0 ? t / layer.adsr.attack : 1;
                    } else if (t < layer.adsr.attack + layer.adsr.decay) {
                        var dp = (t - layer.adsr.attack) / (layer.adsr.decay || 0.001);
                        env = 1.0 - dp * (1.0 - layer.adsr.sustain);
                    } else if (t < stepDur) {
                        env = layer.adsr.sustain;
                    } else {
                        var rt = t - stepDur;
                        env = rt < layer.adsr.release ? layer.adsr.sustain * (1 - rt / layer.adsr.release) : 0;
                    }
                    layerBuf[outIdx] += val * env * 0.3;
                }
            }

            // Process through bus effect chain (offline, non-realtime)
            var processed = audioCtx.processEffectsOffline(layer.busId, layerBuf);
            var src = processed || layerBuf;
            var len = Math.min(src.length, mixedOutput.length);
            for (var i = 0; i < len; i++) mixedOutput[i] += src[i];
            // If processed is longer (effect tail), extend output
            if (processed && processed.length > mixedOutput.length) {
                var extended = new Float32Array(processed.length);
                extended.set(mixedOutput);
                for (var i = mixedOutput.length; i < processed.length; i++) extended[i] = processed[i];
                mixedOutput = extended;
            }
        }

        // Trim trailing silence
        var end = mixedOutput.length - 1;
        while (end > 0 && Math.abs(mixedOutput[end]) < 0.0001) end--;
        var minSmp = Math.ceil(loopDur * SAMPLE_RATE);
        end = Math.max(end, minSmp - 1);
        var finalOutput = mixedOutput.subarray(0, end + 1);

        // Clamp
        for (var c = 0; c < finalOutput.length; c++) {
            if (finalOutput[c] > 1) finalOutput[c] = 1;
            else if (finalOutput[c] < -1) finalOutput[c] = -1;
        }

        try {
            audioCtx.saveWav(path, finalOutput, 1, SAMPLE_RATE);
            console.log('Loop saved:', path, '(' + finalOutput.length + ' samples)');
        } catch (e) {
            console.error('Save failed:', e.message);
        }

        btn.textContent = 'Save Loop';
        btn.classList.remove('active');
    });

    // -------------------------------------------------------------------
    // Freeform Record — record live playing to WAV
    // -------------------------------------------------------------------
    on($('#seq-record'), 'click', function() {
        var btn = this;
        var audioCtx = engine.getAudioContext();
        if (!audioCtx) return;

        if (!seqRecording) {
            // Start recording
            audioCtx.startRecording();
            seqRecording = true;
            btn.classList.add('recording');
            btn.textContent = 'Stop Rec';
        } else {
            // Stop recording and save
            var samples = audioCtx.stopRecording();
            seqRecording = false;
            btn.classList.remove('recording');
            btn.textContent = 'Record';

            if (!samples || samples.length === 0) {
                console.warn('No audio recorded');
                return;
            }

            var path = showSaveFileDialog('WAV Files|wav', 'recording.wav');
            if (path) {
                if (path.indexOf('.wav') < 0 && path.indexOf('.WAV') < 0) path += '.wav';
                try {
                    audioCtx.saveWav(path, samples, 1, audioCtx.sampleRate);
                    console.log('Recording saved:', path);
                } catch (e) {
                    console.error('Save failed:', e.message);
                }
            }
        }
    });

    $$('#seq-mode-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#seq-mode-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var layer = Layers.getActive();
            if (layer) {
                layer.mode = btn.getAttribute('data-mode');
                if (Sequencer.isPlaying()) Sequencer.rebuild();
            }
            buildLayerRows();
        });
    });

    $$('#arp-pattern-btns .btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            $$('#arp-pattern-btns .btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var layer = Layers.getActive();
            if (layer) {
                layer.arpPattern = btn.getAttribute('data-pattern');
                layer.arpIndex = 0;
                if (Sequencer.isPlaying()) Sequencer.rebuild();
            }
        });
    });
}
