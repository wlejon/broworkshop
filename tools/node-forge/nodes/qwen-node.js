// Qwen TTS: qwen-tts-lab on one card. Qwen3-TTS is autoregressive over RVQ
// codes, so there is no prosody contour to paint; its controls are voice
// identity (one panel per checkpoint variant: CustomVoice speakers,
// VoiceDesign instructions, Base x-vector design), learned emotion and
// masc/fem directions, sampling ("delivery"), a codebook-0 logit-bias steer
// (click a code in the trace to stage one), and the AR trace itself.
//
// exec() uses the blocking QwenTtsModel.synthesize (trace in the same call);
// the card's controls use the asynchronous bro.tts.synthesize, debounced.
// Not ported from qwen-tts-lab: the gapless streaming queue and barge-in Stop.

import { h } from "/lib/kit/dom.js";
import { types } from "./types.js";
import { mountBasisSliderMap } from "../widgets/basis-slider-map.js";
import { createTraceView } from "../widgets/trace-view.js";
import {
    section, row, pathRow, checkbox, audioOut, axisSlider, directionSliders, mascFemSection,
    decodeNative, gauss, exists, parentDir, trimSlash, fileName, AUDIO_FILTER,
} from "./common.js";
import {
    seedDefaults, ensureLoadedSync, afterLoad, buildOpts, designedXvec, coordsFromXvec,
    VARIANT_DIRS, INSTRUCT_PRESETS, INSTRUCT_GROUPS, STEER_DEFAULT, GREEDY,
} from "./qwen/voice.js";

types.define({
    type: 'qwen', label: 'Qwen TTS', cat: 'Audio', color: '#5ad1ff',
    desc: 'Qwen3-TTS: preset / designed / described voices, delivery, logit steer, AR trace',
    ins: [], outs: [{ name: 'audio', type: 'audio-buffer' }],

    exec(ins, params, node) {
        ensureLoadedSync(node);
        const opts = buildOpts(node);
        if (!opts) throw new Error('design a voice first (enroll or random)');
        opts.trace = true;
        const r = node._qwen.synthesize(params.text, opts);
        node._lastTrace = r;
        return [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }];
    },

    mount(body, node, graph, api) {
        seedDefaults(node.params);
        const p = node.params;
        const timers = {};
        const later = (key, ms, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
        api.onUnmount(() => { for (const k in timers) clearTimeout(timers[k]); });
        const commit = () => { api.markDirty(); run(); };
        const soon = () => { api.markDirty(); later('synth', 160, run); };

        // --- on the card: text, variant chips, output ------------------------------------------
        const text = h('input.form-input.wide', { type: 'text', value: p.text, placeholder: 'Type something to speak…' });
        const speak = () => { p.text = text.value; commit(); };
        text.addEventListener('change', speak);
        const chips = {};
        for (const id of Object.keys(VARIANT_DIRS)) {
            chips[id] = h('button.small', { onclick: () => { if (chips[id]._dir) setModelDir(chips[id]._dir); } }, id);
        }
        const out = audioOut(node, { empty: 'no audio yet — set a checkpoint dir', wavName: 'qwen-tts.wav' });
        body.append(row(null, text, h('button.small', { title: 'Render', onclick: speak }, '▶')), row(null, Object.values(chips)), out.el);

        // --- model --------------------------------------------------------------------------------
        const dir = pathRow({ label: 'Checkpoint dir', value: p.modelDir, onChange: setModelDir });
        const modelMeta = h('div.axis-note');
        function setModelDir(v) { dir.input.value = v; p.modelDir = v; api.markDirty(); loadLive(); }
        function syncChips(d) {
            const root = parentDir(d);
            for (const [id, name] of Object.entries(VARIANT_DIRS)) {
                const full = root + '/' + name, ok = exists(full + '/config.json');
                chips[id].disabled = !ok;
                chips[id].classList.toggle('active', ok && trimSlash(d).endsWith('/' + name));
                chips[id]._dir = full;
            }
        }

        // --- voice: one panel per variant -----------------------------------------------------------
        const speakerSel = h('select.form-input.wide');
        const dialect = h('span.curve-stats');
        const cvNote = h('div.axis-note');
        const cvPanel = h('div', null, row(null, speakerSel, dialect), cvNote);
        const instruct = h('input.form-input.wide', { type: 'text', value: p.instruct });
        const adjs = new Set(); let noun = null;
        const adjOrder = INSTRUCT_GROUPS.filter((g) => g.kind === 'adj').flatMap((g) => g.tags);
        const assemble = () => {
            const a = adjOrder.filter((t) => adjs.has(t));
            return !a.length && !noun ? '' : 'a ' + (a.length ? a.join(', ') + ' ' : '') + (noun || 'voice');
        };
        const tagRows = INSTRUCT_GROUPS.map((g) => row(g.name, g.tags.map((t) => {
            const b = h('button.small', null, t);
            b.addEventListener('click', () => {
                if (g.kind === 'noun') noun = noun === t ? null : t;
                else if (adjs.has(t)) adjs.delete(t); else adjs.add(t);
                for (const other of b.parentNode.querySelectorAll('button')) {
                    other.classList.toggle('active', g.kind === 'noun' ? noun === other.textContent : adjs.has(other.textContent));
                }
                instruct.value = p.instruct = assemble();
                commit();
            });
            return b;
        })));
        const vdPanel = h('div', null, row(null, instruct),
            row(null, INSTRUCT_PRESETS.map((preset) => h('button.small', {
                title: preset, onclick: () => { instruct.value = p.instruct = preset; commit(); },
            }, preset.split(',')[0]))),
            tagRows);
        const basePanel = h('div.axis-note', null, 'identity comes from Voice design, below — enroll a clip or go random.');
        const langSel = h('select.form-input');
        const langRow = row('Language', langSel);
        const voiceSec = section('Voice', cvPanel, vdPanel, langRow, basePanel);
        speakerSel.addEventListener('change', () => {
            p.speaker = speakerSel.value; p.cvSource = 'preset';
            try { dialect.textContent = node._qwen.speakerDialect(p.speaker) || ''; } catch (e) { /* no dialect info */ }
            updateCvNote(); commit();
        });
        langSel.addEventListener('change', () => { p.language = langSel.value; commit(); });
        instruct.addEventListener('change', () => { p.instruct = instruct.value; commit(); });

        // --- voice design (Base + CustomVoice) ------------------------------------------------------
        const designerBody = h('div');
        const designerMeta = h('div.axis-note');
        const wav = pathRow({ label: 'Clone .wav', value: p.refWav, folder: false, filter: AUDIO_FILTER, onChange: (v) => { p.refWav = v; } });
        wav.row.append(h('button.small', { onclick: () => enroll(wav.input.value.trim()) }, '⤓ enroll'),
            h('button.small', { onclick: randomVoice }, '🎲 random'));
        const designerSec = section('Voice design', designerBody, wav.row, designerMeta);

        // --- learned emotion + masc/fem -------------------------------------------------------------
        const emoAxes = h('div');
        const emoOpts = { onInput: soon, onPick: commit };
        const emoSec = section('Emotion ✦ learned', emoAxes, h('button.small', {
            onclick: () => {
                const eb = node._emotionBasis;
                if (eb) for (const e of eb.emotions) p.emoAlpha[e] = 0;
                directionSliders(emoAxes, eb, p.emoAlpha, emoOpts);
                commit();
            },
        }, '○ none'));
        const mf = mascFemSection(p, { onInput: soon, onCommit: commit });

        // --- delivery -------------------------------------------------------------------------------
        const deliveryMeta = h('div.axis-note');
        const s = p.sampling;
        const dial = (name, key, min, max, step, fmt) => {
            const d = axisSlider({ name, min, max, step, value: s[key], fmt, onInput: (v) => { s[key] = v; updateDeliveryMeta(); soon(); } });
            d.el.className = 'dial';
            return d;
        };
        const dials = {
            temperature: dial('temperature', 'temperature', 0, 1.5, 0.05),
            topK: dial('top-k', 'topK', 0, 200, 1, (v) => String(v | 0)),
            topP: dial('top-p', 'topP', 0, 1, 0.01),
            repetitionPenalty: dial('repetition penalty', 'repetitionPenalty', 1, 2, 0.01),
            adaptive: dial('adaptive temp', 'adaptive', 0, 2, 0.05),
        };
        const seed = h('input.form-input', { type: 'number', value: String(s.seed) });
        seed.addEventListener('input', () => { s.seed = parseInt(seed.value, 10) || 0; updateDeliveryMeta(); soon(); });
        const lock = checkbox('lock', s.seedLocked, (v) => { s.seedLocked = v; api.markDirty(); });
        const greedy = h('button.small', {
            onclick: () => {
                Object.assign(s, GREEDY);
                for (const k in GREEDY) dials[k].set(GREEDY[k]);
                updateDeliveryMeta(); commit();
            },
        }, '○ greedy');
        const deliverySec = section('Delivery', Object.values(dials).map((d) => d.el), row('seed', seed, lock.el, greedy), deliveryMeta);
        function updateDeliveryMeta() {
            deliveryMeta.textContent = (s.temperature > 0 ? 'sampling · seed ' + s.seed + (s.seedLocked ? ' (locked)' : '') : 'greedy · deterministic') +
                (s.repetitionPenalty !== 1.05 ? ' · rep ' + s.repetitionPenalty.toFixed(2) : '') +
                (s.temperature > 0 && s.adaptive > 0 ? ' · adaptive ' + s.adaptive.toFixed(2) : '');
        }

        // --- steer ------------------------------------------------------------------------------------
        const steerList = h('div.steer-list');
        const steerMeta = h('div.axis-note');
        const steerId = h('input.form-input', { type: 'number', min: '0', step: '1' });
        const steerSec = section('Steer', steerList, row('code', steerId,
            h('button.small', { onclick: addSteer }, '+ bias'),
            h('button.small', { onclick: () => { for (const k in p.steer) delete p.steer[k]; renderSteer(); commit(); } }, 'clear')),
        steerMeta);
        function renderSteer() {
            steerList.textContent = '';
            const ids = Object.keys(p.steer).map((k) => k | 0).sort((a, b) => a - b);
            if (!ids.length) steerList.appendChild(h('span.curve-stats', null, 'no codes biased — click row 0 of the code raster, or add an id'));
            for (const id of ids) {
                const val = h('span.steer-val', null, p.steer[id].toFixed(1));
                const sl = h('input', { type: 'range', min: '-12', max: '12', step: '0.5', value: String(p.steer[id]) });
                sl.addEventListener('input', () => { p.steer[id] = +sl.value; val.textContent = p.steer[id].toFixed(1); updateSteerMeta(); soon(); });
                steerList.appendChild(h('div.steer-entry', null, h('span.steer-id', null, 'code ' + id), sl, val,
                    h('button.small', { onclick: () => { delete p.steer[id]; renderSteer(); commit(); } }, '×')));
            }
            updateSteerMeta();
        }
        function updateSteerMeta() {
            const n = Object.keys(p.steer).length;
            steerMeta.textContent = n ? n + ' code' + (n > 1 ? 's' : '') + ' biased on codebook 0' : 'favor (+) or forbid (−) specific Talker codes';
        }
        function addSteer() {
            const v = parseInt(steerId.value, 10);
            if (!isFinite(v) || v < 0) { api.setBadge('enter a non-negative code id', true); return; }
            p.steer[v] = STEER_DEFAULT; steerId.value = '';
            renderSteer(); commit();
        }
        function steerPick(frame, r, code) {
            if (r !== 0) { api.setBadge('logit bias steers codebook 0 only — click the top row', true); return; }
            p.steer[code] = STEER_DEFAULT;
            renderSteer();
            api.setBadge('staged code ' + code + ' (frame ' + frame + ')', false);
            commit();
        }

        // --- trace -------------------------------------------------------------------------------------
        const traceWrap = h('div');
        const traceView = createTraceView(traceWrap);
        function rebuildTrace() {
            const r = node._lastTrace;
            if (!r) return;
            const codes = r.stages && r.stages.find((x) => x.name === 'codes');
            const conf = r.stages && r.stages.find((x) => x.name === 'c0_confidence');
            const keep = ['audio'];
            traceView.beginFrame();
            if (codes) { traceView.renderCodes('codes', 'codes', '16 x F RVQ code stream — row 0 semantic (Talker), 1..15 acoustic', codes, { onPick: steerPick }); keep.push('codes'); }
            if (conf) { traceView.renderConf('conf', 'confidence', 'Talker top-1 confidence per frame — low = the model hedged', conf); keep.push('conf'); }
            traceView.renderWave('audio', 'audio', 'output waveform — ' + (r.sampleRate / 1000) + ' kHz mono', r.samples, r.sampleRate, true);
            traceView.clear(keep);
        }

        api.dialogBody.append(section('Model & checkpoint', dir.row, modelMeta), voiceSec, designerSec, emoSec, mf.el,
            deliverySec, steerSec, section('Pipeline trace', traceWrap));

        // --- panels that follow the loaded checkpoint ---------------------------------------------------
        function syncVariant() {
            const v = node._variant, designer = v === 'base' || v === 'customvoice';
            cvPanel.style.display = v === 'customvoice' ? '' : 'none';
            vdPanel.style.display = v === 'voicedesign' ? '' : 'none';
            basePanel.style.display = v === 'base' ? '' : 'none';
            langRow.style.display = v === 'voicedesign' ? 'none' : '';
            designerSec.style.display = designer && node._voiceBasis ? '' : 'none';
            emoSec.style.display = designer && node._emotionBasis ? '' : 'none';
            mf.build(designer ? node._mascFemBasis : null);
        }
        function rebuildDesigner() {
            designerBody.textContent = '';
            const basis = node._voiceBasis;
            if (basis) {
                designerBody.appendChild(mountBasisSliderMap(node, {
                    dim: () => basis.k,
                    axisName: (n, i) => (basis.axisName ? basis.axisName[i] : 'V' + (i + 1)),
                    axisRange: (n, i) => [basis.range[i][0] * 1.15, basis.range[i][1] * 1.15],
                    coords: () => p.coords,
                    presets: () => (basis.names || []).map((nm, i) => ({ name: nm, coords: basis.anchors[i] })),
                }, { onEdit() { if (node._variant === 'customvoice') markDesigned(); updateDesignerMeta(); soon(); } }));
            }
            updateDesignerMeta();
        }
        function updateDesignerMeta() {
            const x = designedXvec(node);
            designerMeta.textContent = x ? 'designed x-vector ‖' + Math.sqrt(x.reduce((a, v) => a + v * v, 0)).toFixed(2) + '‖' : '';
            updateCvNote();
        }
        function updateCvNote() {
            if (node._variant !== 'customvoice') return;
            cvNote.textContent = '';
            if (p.cvSource === 'designed') {
                cvNote.append('◆ rendering the designed voice (slot override) · ',
                    h('button.small', { onclick: () => { p.cvSource = 'preset'; updateCvNote(); commit(); } }, '↺ use preset'));
            } else cvNote.textContent = 'preset ‘' + (p.speaker || '') + '’ · or design a voice below';
        }
        function markDesigned() { p.cvSource = 'designed'; updateCvNote(); }
        function enroll(path) {
            if (!path || !node._qwen) return;
            try {
                const dec = decodeNative(path);
                if (!dec) { api.setBadge('enroll: cannot decode ' + path, true); return; }
                const x = node._qwen.embedSpeaker(dec.pcm, { sampleRate: dec.rate });
                if (node._voiceBasis) {
                    const c = coordsFromXvec(node._voiceBasis, x);
                    for (let k = 0; k < node._voiceBasis.k; k++) p.coords[k] = c[k];
                    rebuildDesigner();
                }
                if (node._variant === 'customvoice') markDesigned();
                api.setBadge('enrolled ' + fileName(path), false);
                commit();
            } catch (e) { api.setBadge('enroll: ' + ((e && e.message) || e), true); }
        }
        function randomVoice() {
            const basis = node._voiceBasis;
            if (!basis) { api.setBadge('no voice basis for this checkpoint', true); return; }
            for (let k = 0; k < basis.k; k++) {
                const [lo, hi] = basis.range[k];
                p.coords[k] = Math.max(lo * 1.15, Math.min(hi * 1.15, gauss() * (0.5 + (basis.varExplained ? basis.varExplained[k] : 0.2) * 3)));
            }
            rebuildDesigner();
            if (node._variant === 'customvoice') markDesigned();
            commit();
        }
        function populateVoicePanel() {
            let names = [];
            try { names = node._qwen.speakers() || []; } catch (e) { /* not a CustomVoice checkpoint */ }
            speakerSel.textContent = '';
            speakerSel.append(names.map((n) => h('option', { value: n }, n)));
            if (names.length && !p.speaker) p.speaker = names[0];
            speakerSel.value = p.speaker;
            try { dialect.textContent = node._qwen.speakerDialect(p.speaker) || ''; } catch (e) { dialect.textContent = ''; }
            p.cvSource = 'preset';
            updateCvNote();
            let langs = [];
            try { langs = node._qwen.languages() || []; } catch (e) { /* default below */ }
            if (!langs.length) langs = ['english'];
            langSel.textContent = '';
            langSel.append(langs.map((l) => h('option', { value: l }, l)));
            langSel.value = p.language = langs.indexOf(p.language) >= 0 ? p.language : langs[0];
            instruct.value = p.instruct;
        }

        // --- loading + synthesis ---------------------------------------------------------------------
        function status(msg, err) { modelMeta.textContent = msg; api.setBadge(err ? msg : node._qwen ? 'ready' : '', err); }
        function loadLive() {
            const d = trimSlash(p.modelDir);
            syncChips(d);
            node._qwen = null; node._lastTrace = null;
            if (!exists(d + '/config.json')) { status('no config.json in ' + d, true); return; }
            status('loading checkpoint…', false);
            try {
                bro.tts.loadQwen(d, {
                    onReady: (q) => {
                        node._qwen = q;
                        afterLoad(node, d);
                        populateVoicePanel(); rebuildDesigner();
                        directionSliders(emoAxes, node._emotionBasis, p.emoAlpha, emoOpts);
                        syncVariant();
                        status(node._variant + ' · ' + q.sampleRate / 1000 + ' kHz', false);
                        node._dirty = true;
                        pump();
                    },
                    onError: (m) => status('load failed: ' + m, true),
                });
            } catch (e) { status('load failed: ' + ((e && e.message) || e), true); }
        }
        function run() { node._dirty = true; pump(); }
        function pump() {
            if (node._synthBusy || !node._dirty || !node._qwen) return;
            const opts = buildOpts(node);
            node._dirty = false;
            if (!opts) { api.setBadge('design a voice first (enroll or random)', true); return; }
            opts.trace = true;
            const t0 = performance.now();
            node._synthBusy = true;
            try {
                bro.tts.synthesize(node._qwen, text.value, Object.assign(opts, {
                    onDone: (r, info) => {
                        node._synthBusy = false;
                        if (info.error) api.setBadge('synthesize: ' + info.error, true);
                        else if (!info.cancelled) {
                            node._lastTrace = r;
                            out.publish(r.samples, r.sampleRate, 1);
                            rebuildTrace();
                            api.invalidate(node, [{ samples: r.samples, sampleRate: r.sampleRate, channels: 1 }], performance.now() - t0);
                            api.setBadge('ready', false);
                        }
                        if (node._dirty) pump();
                    },
                }));
            } catch (e) { node._synthBusy = false; api.setBadge('synthesize: ' + ((e && e.message) || e), true); }
        }

        updateDeliveryMeta();
        renderSteer();
        vdPanel.style.display = 'none'; basePanel.style.display = 'none';
        designerSec.style.display = 'none'; emoSec.style.display = 'none'; mf.build(null);
        if (p.modelDir) loadLive();
    },
});
