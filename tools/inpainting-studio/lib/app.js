// app.js — Inpainting Studio: paint a mask over an image (or grow the canvas
// to outpaint), then repaint the masked area with Stable Diffusion 1.5
// (bro.diffusion inpaint: initImagePath + maskImagePath), optionally guided
// by a canny or depth ControlNet. main.js calls start(); tests import this.

import { boot } from "/lib/kit/app.js";
import { $, h, fmtMs } from "/lib/kit/dom.js";
import { bindControl, segmented } from "/lib/kit/index.js";
import { prefStore } from "/lib/kit/prefs.js";
import { findWeights } from "/lib/kit/weights.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { pickFile, imageDataFromFile, baseName, deviceBadge } from "/lib/kit/ml.js";
import { modelPicker, genPanel, runBar, runGeneration, imageStrip } from "/lib/kit/imagegen.js";import { Stage, VIEWS } from "./stage.js";
import { SCENES } from "./scenes.js";
import { MAX_SIDE } from "./mask.js";
import { FILL_MODES, fillMasked, maskToRgba, coverage } from "./pixels.js";

export const SD15_CANDIDATES = ['brodiffusion/weights/sd15', 'brodiffusion/weights/lcm-dreamshaper'];
export const CONTROLNETS = {
    canny: ['brodiffusion/weights/controlnet-canny'],
    depth: ['brodiffusion/weights/controlnet-depth'],
};
export const DEPTH_ANNOTATOR = ['brovisionml/weights/Depth-Anything-V2-Small'];
/** Outpaint steps per side: [dx, dy] (negative grows left / up). */
export const EXPAND = { n: [0, -64], w: [-64, 0], e: [64, 0], s: [0, 64] };
export const CONTROL_MODES ={ none: 'None (plain inpaint)', canny: 'Canny edges', depth: 'Depth map' };

const FIELDS = [
    { key: 'seed', def: 0, min: 0, random: true },
    { key: 'steps', def: 25, min: 1, max: 50 },
    { key: 'guidance', def: 7.5, step: 0.5, min: 1, max: 15 },
    { key: 'strength', def: 0.75, step: 0.05, min: 0.1, max: 1 },
];

export const prefs = prefStore('inpainting-studio.v2', {
    modelDir: '', autoLoad: '', form: null, fill: 'original', control: 'canny', controlWeight: 0.8,
});

/** Live page state (an object, so tests read current values). */
export const studio = {
    loaded: false, loading: false, run: null, error: null,
    scheduler: '', controlnets: [],        // kinds registered in the worker, in prime order
    depth: null, depthBusy: false,         // last depth map { width, height, gray }
    lastParams: null,
};

let status, stage, rpc, picker, panel, bar, strip, badge, view, fill, control, weight;

const persist = () => prefs.set({ modelDir: picker.path, form: panel.state(), fill: fill.value,
                                  control: control.value, controlWeight: weight.value });

/** A <select> filled from { value: label }, starting at `value`. */
function selectOf(sel, options, value, onChange) {
    const s = $(sel);
    for (const k in options) s.appendChild(h('option', { value: k }, options[k]));   // no Option ctor in bro
    if (options[value]) s.value = value;
    s.addEventListener('change', onChange);
    return s;
}

// ── model ────────────────────────────────────────────────────────────────────

/** ControlNets on disk, as the worker's load message wants them. */
export function availableControlNets() {
    return Object.keys(CONTROLNETS)
        .map((kind) => ({ kind, path: findWeights(CONTROLNETS[kind], { probe: 'config.json' }) }))
        .filter((c) => c.path);
}

export async function load() {
    const dir = picker.path;
    if (!dir) { status.error('set an SD 1.5 directory first'); return; }
    if (studio.loading || studio.run) return;
    persist();
    Object.assign(studio, { loading: true, loaded: false, error: null });
    picker.setBusy(true);
    panel.setEnabled(false);
    badge.set('loading…', 'warn');
    status.busy('loading Stable Diffusion 1.5…');
    try {
        const msg = await rpc.request({ type: 'load', modelDir: dir, controlnets: availableControlNets() });
        Object.assign(studio, { loaded: true, scheduler: msg.scheduler, controlnets: msg.controlnets });
        badge.set(msg.backend);
        // LCM checkpoints want a handful of steps at low guidance.
        if (msg.scheduler === 'lcm' && panel.get('steps') > 8) { panel.set('steps', 6); panel.set('guidance', 1.5); }
        $('#model-meta').textContent = msg.scheduler + ' scheduler · ControlNet: ' + (msg.controlnets.join(', ') || 'none found');
        status.ok('model ready · ' + baseName(dir));
        prefs.set({ autoLoad: dir });
        panel.setEnabled(true);
        refreshControlNote();
    } catch (e) {
        studio.error = e.message;
        badge.set('error', 'err');
        status.error(e);
    } finally {
        studio.loading = false;
        picker.setBusy(false);
    }
}

// ── control maps ─────────────────────────────────────────────────────────────

function refreshControlNote() {
    const m = control.value;
    const note = m === 'none' || (studio.loaded && studio.controlnets.indexOf(m) >= 0) ? ''
        : !studio.loaded ? 'preview only until a model is loaded'
        : 'no ' + m + ' ControlNet weights (' + CONTROLNETS[m][0] + '): shown, not used';
    $('#control-note').textContent = note;
    $('#control-note').hidden = !note;
}

/** Recompute the control map for the current base image and mode. */
export async function updateControl() {
    const m = control.value;
    refreshControlNote();
    if (m !== 'depth') { stage.drawControl(m); return; }
    const weights = findWeights(DEPTH_ANNOTATOR, { probe: 'config.json' });
    if (!weights) { status.warn('depth needs ' + DEPTH_ANNOTATOR[0]); stage.drawControl('none'); return; }
    studio.depthBusy = true;
    status.busy('estimating depth…');
    try {
        const d = await rpc.request({ type: 'depth', weights, imagePath: stage.writePng('depth-src', stage.pixels()) });
        studio.depth = d;
        stage.drawControl('depth', d.gray, d.width, d.height);
        status.ok('depth map ready');
    } catch (e) {
        status.error(e);
        stage.drawControl('none');
    } finally {
        studio.depthBusy = false;
    }
}

function baseChanged() {
    studio.depth = null;
    return updateControl();
}

// ── generation ───────────────────────────────────────────────────────────────

/** The GenerateOptions of one inpaint run; writes the init / mask / control PNGs. */
export function buildOpts() {
    const w = stage.width, h = stage.height;
    const bits = stage.maskBits();
    const o = panel.opts();
    const init = fillMasked(stage.pixels(), bits, fill.value, o.seed + 1);
    Object.assign(o, {
        width: w, height: h,
        strength: panel.get('strength'),
        initImagePath: stage.writePng('init', init),
        maskImagePath: stage.writePng('mask', { width: w, height: h, data: maskToRgba(bits, w, h) }),
    });
    // Every registered net needs an entry; the unused ones ride at scale 0.
    if (studio.controlnets.length) {
        const path = stage.writePng('control', stage.pixels(stage.control));
        o.controls = studio.controlnets.map((kind) => ({ imagePath: path, scale: kind === control.value ? weight.value : 0 }));
    }
    return { opts: o, coverage: coverage(bits) };
}

export async function generate() {
    if (!studio.loaded || studio.run) return;
    const { opts, coverage: cov } = buildOpts();
    if (!cov) { status.warn('paint a mask first (or Fill all to repaint everything)'); return; }
    const prompt = panel.prompt;
    persist();
    panel.setRunning(true);
    picker.setBusy(true);
    status.busy('inpainting ' + Math.round(cov * 100) + '% of the image…');
    bar.set(0, 'encoding…');
    studio.lastParams = { prompt, opts, coverage: cov, fill: fill.value, control: control.value };
    const run = studio.run = runGeneration(rpc, { prompt, opts, onStep: (m) => bar.step(m.stepIndex, m.numSteps) });
    try {
        const r = await run.promise;
        if (r.cancelled) { status.warn('cancelled'); bar.idle('cancelled'); return; }
        const f = r.final;
        stage.showResult(f.bitmap);
        strip.add(f.bitmap, {
            label: 'seed ' + opts.seed, file: 'inpaint-seed' + opts.seed,
            title: prompt + '\nseed ' + opts.seed + ' · ' + opts.steps + ' steps · cfg ' + opts.guidanceScale +
                   ' · strength ' + opts.strength + ' · ' + f.width + '×' + f.height + ' · ' + fmtMs(r.ms),
        });
        setView('result');
        status.ok('done in ' + fmtMs(r.ms));
        bar.set(1, 'done · ' + f.numSteps + ' steps');
    } catch (e) {
        status.error(e);
        bar.idle('failed');
    } finally {
        studio.run = null;
        panel.setRunning(false);
        picker.setBusy(false);
    }
}

export function cancel() { if (studio.run) studio.run.cancel(); }

// ── canvas tools ─────────────────────────────────────────────────────────────

export function setView(mode) {
    view.value = mode;
    stage.setView(mode);
    $('#btn-adopt').disabled = !stage.hasResult;
}

export function loadScene(key) {
    $('#presetSelect').value = key;
    stage.loadScene(key);
    return baseChanged();
}

export function expand(dx, dy) {
    if (!stage.expand(dx, dy)) { status.warn('the canvas is at its ' + MAX_SIDE + 'px limit'); return false; }
    status.ok('canvas ' + stage.width + '×' + stage.height + ' · the new border is masked');
    baseChanged();
    return true;
}

function uploadImage() {
    const p = pickFile('Images|png;jpg;jpeg;webp;bmp');
    if (!p) return;
    try { stage.loadImage(imageDataFromFile(p)); baseChanged(); status.ok('loaded ' + baseName(p)); }
    catch (e) { status.error(e); }
}

function bindTools() {
    segmented('#tool', { brush: 'Brush', eraser: 'Eraser' }, { onChange: (v) => { stage.mask.tool = v; } });
    bindControl('#brushSize', { out: '#brushSizeVal', fmt: (v) => v + 'px', onChange: (v) => { stage.mask.size = v; } });
    bindControl('#brushHardness', { out: '#brushHardnessVal', fmt: (v) => v + '%', onChange: (v) => { stage.mask.hardness = v / 100; } });
    $('#invertMaskBtn').addEventListener('click', () => stage.mask.invert());
    $('#clearMaskBtn').addEventListener('click', () => stage.mask.clear());
    $('#fillMaskBtn').addEventListener('click', () => stage.mask.fill());
    for (const b of document.querySelectorAll('[data-expand]')) {
        b.addEventListener('click', () => { const [dx, dy] = EXPAND[b.dataset.expand]; expand(dx, dy); });
    }
    selectOf('#presetSelect', SCENES, 'portrait', (e) => loadScene(e.target.value));
    $('#uploadImgBtn').addEventListener('click', uploadImage);
    $('#btn-adopt').addEventListener('click', () => { if (stage.adoptResult()) { setView('composite'); baseChanged(); } });
}

function bindGuidance() {
    fill = selectOf('#fillModeSelect', FILL_MODES, prefs.data.fill, persist);
    control = selectOf('#controlnetMode', CONTROL_MODES, prefs.data.control, () => { persist(); updateControl(); });
    $('#controlWeight').value = String(prefs.data.controlWeight);
    weight = bindControl('#controlWeight', { out: '#controlWeightVal', fmt: (v) => v.toFixed(2), onChange: persist });
}

export function start() {
    status = boot().status;
    rpc = workerClient('lib/worker.js');
    badge = deviceBadge('#backend').set('no model', 'warn');
    stage = new Stage();
    picker = modelPicker('#model', {
        label: 'SD 1.5 directory (diffusers layout)',
        candidates: SD15_CANDIDATES, probe: 'tokenizer/vocab.json',
        value: prefs.data.modelDir, onLoad: load, onPick: persist,
    });
    panel = genPanel('#gen', {
        prompt: 'a golden dragon crest embroidered on dark velvet, intricate metallic thread',
        negative: 'blurry, low quality, artifacts, distorted',
        fields: FIELDS, onSubmit: generate, onCancel: cancel, onChange: () => persist(),
    });
    bindTools();
    bindGuidance();
    panel.restore(prefs.data.form);
    bar = runBar('#run');
    strip = imageStrip('#gallery', { onSelect: (e) => { stage.showResult(e.bitmap); setView('result'); } });
    view = segmented('#views', VIEWS, { onChange: setView });

    setView('composite');
    loadScene('portrait');
    rpc.onReady(() => {
        status.set('ready: paint a mask, load a model, Generate');
        if (prefs.data.autoLoad && prefs.data.autoLoad === picker.path) load();
    });
    Object.assign(studio, { rpc, stage, picker, panel, bar, strip, badge, status });
    Object.defineProperties(studio, {
        fill: { get: () => fill.value, set: (v) => { fill.value = v; }, configurable: true },
        control: { get: () => control.value, configurable: true },
        weight: { get: () => weight.value, set: (v) => { weight.value = v; }, configurable: true },
    });
    return studio;
}

/** Switch the ControlNet mode as the select would (tests, console). */
export function setControl(mode) {
    control.value = mode;
    persist();
    return updateControl();
}
