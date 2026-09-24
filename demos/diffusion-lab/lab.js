// Diffusion Lab — watch a diffusion model think.
//
// Drives an SD1.5 pipeline step by step from a worker (lab/diffusion-worker.js)
// through brodiffusion's prime() / stepOnce() / decode() API: the page asks
// for one denoising step per round-trip, keeps every decoded frame so the
// trajectory can be scrubbed, and records (or steers) cross-attention for the
// inspector on the right (lab/inspector.js). The left panel's LoRA,
// ControlNet and init-image extras live in lab/adapters.js; word axes,
// the settings panel, the gallery and the step loop are the kit's
// (lib/kit/imagegen.js), shared with sana-lab and pixart-lab.

import { boot } from "/lib/kit/app.js";
import { ids, fmtMs } from "/lib/kit/dom.js";
import { foldPanels } from "/lib/kit/ui.js";
import { prefStore } from "/lib/kit/prefs.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { modelPicker, backendBadge, genPanel, runBar, runGeneration, imageView, imageStrip, wordAxes }
    from "/lib/kit/imagegen.js";
import { Tokenizer } from "/app/lab/tokenizer.js";
import { Profiles } from "/app/lab/profiles.js";
import { createInspector } from "/app/lab/inspector.js";
import { createAdapters } from "/app/lab/adapters.js";

const FIELDS = [
    { key: 'steps', def: 25, min: 1, max: 150 },
    { key: 'guidance', def: 7.5, min: 1, max: 30, step: 0.5 },
    { key: 'width', def: 512, min: 64, max: 1024, step: 64, snap: 8 },
    { key: 'height', def: 512, min: 64, max: 1024, step: 64, snap: 8 },
    { key: 'seed', def: 0, min: 0, random: true },
];

export const prefs = prefStore('diffusion-lab.v2');
const { status } = boot();
foldPanels();
const el = ids('model-name', 'scheduler', 'int8', 'trace', 'scrub', 'run', 'timing', 'diff-version');
const rpc = workerClient('lab/diffusion-worker.js');
const badge = backendBadge('#backend');
const gpu = !!(typeof bro !== 'undefined' && bro.tensor && bro.tensor.available);

const lab = {
    detected: null,        // Profiles.detect() of the adopted directory
    loaded: false, loading: false, busy: false, run: null, error: null, config: null,
    frames: [],            // { stepIndex, bitmap, owned } per decoded step of the current run
    final: null,           // the current run's final bitmap (owned by the gallery)
};

const persist = () => prefs.set({
    modelDir: picker.path, form: panel.state(), scheduler: el.scheduler.value,
    int8: el.int8.checked, trace: el.trace.checked, axes: axes.serialize(),
});

const picker = modelPicker('#model', {
    label: 'SD1.5 directory (diffusers layout)',
    candidates: ['brodiffusion/weights/lcm-dreamshaper', 'brodiffusion/weights/sd15'],
    probe: 'unet',
    value: prefs.data.modelDir,
    buttonText: 'Load weights',
    onLoad: loadWeights,
    onPick: (dir) => { adoptModel(dir); persist(); },
});

const panel = genPanel('#gen', {
    prompt: 'a fox in autumn leaves, oil painting',
    placeholder: 'a fox in autumn leaves, oil painting',
    fields: FIELDS,
    onSubmit: generate,
    onCancel: cancel,
    onChange: persist,
});
panel.restore(prefs.data.form);

const view = imageView('#view', { hint: '#view-hint' });
const insp = createInspector(view);
const adapters = createAdapters({ prefs, status, running: () => !!lab.run || lab.loading, onStale: markStale });
const bar = runBar('#run');
el.run.appendChild(el.scrub);           // progress, label, then the trajectory scrubber
const strip = imageStrip('#gallery', { onSelect: showEntry });

const axes = wordAxes('#axes', {
    rpc, status,
    range: { min: -40, max: 40, step: 1 },
    placeholders: { name: 'age', from: 'a young person, a child', to: 'an old person, an elderly man' },
    ready: () => lab.loaded && !lab.busy,
    setBusy,
    onChange: persist,
});

function setBusy(b) {
    lab.busy = !!b;
    const on = lab.busy || lab.loading;
    panel.setEnabled(lab.loaded && !on);
    panel.setRunning(!!lab.run);
    picker.setBusy(on);
    adapters.setBusy(on);
    axes.setEnabled(lab.loaded && !on);
    el.scheduler.disabled = on;
    el.int8.disabled = on || !gpu;
    el.trace.disabled = on || !insp.traceCapable;
    panel.promptEl.disabled = !!lab.run;
    if (panel.negativeEl) panel.negativeEl.disabled = !!lab.run;
}

// A LoRA / ControlNet change needs a reload from the base weights.
function markStale(msg) {
    if (!lab.loaded || lab.run) return;
    lab.loaded = false;
    setBusy(false);
    status.warn(msg);
}

// ---- model ---------------------------------------------------------------------

/** Recognise a directory, build its tokenizer and show the prompt's tokens. */
function adoptModel(dir) {
    if (lab.run || lab.loading) return false;
    try {
        const det = Profiles.detect(dir);
        const tk = Tokenizer.create(Profiles.readText(det.vocabPath), Profiles.readText(det.mergesPath));
        lab.detected = det;
        insp.setTokenizer(tk, panel.prompt);
    } catch (e) {
        lab.detected = null;
        insp.setTokenizer(null, '');
        el.modelName.textContent = 'no model';
        status.error('cannot use that folder: ' + e.message);
        return false;
    }
    lab.loaded = false;
    el.modelName.textContent = lab.detected.name;
    el.modelName.classList.remove('dim');
    setBusy(false);
    status.set(lab.detected.profile.label + ' detected — sampler suggestion: ' +
               lab.detected.suggestedScheduler.toUpperCase() + '. Click Load weights.');
    return true;
}

async function loadWeights() {
    if (lab.run || lab.loading) return;
    const dir = picker.path;
    if (!lab.detected || lab.detected.dir !== dir) { if (!adoptModel(dir)) return; }
    const det = lab.detected;
    const sel = el.scheduler.value;
    const scheduler = sel === 'auto' ? det.suggestedScheduler : sel;
    const spec = Object.assign(det.profile.buildSpec(det, scheduler, el.int8.checked), adapters.loadSpec());
    persist();

    lab.loading = true; lab.loaded = false; lab.error = null;
    setBusy(true);
    const extras = [];
    if (spec.loras.length) extras.push(spec.loras.length + ' LoRA');
    if (spec.controlnets.length) extras.push(spec.controlnets.length + ' ControlNet');
    status.busy(extras.length ? 'loading weights + ' + extras.join(' + ') + ' — please wait…'
                              : 'loading weights — this reads multi-GB files, please wait…');
    badge.set('loading…', 'warn');
    try {
        const info = await rpc.request({ type: 'load', spec });
        const cfg = info.config || {};
        lab.loaded = true;
        lab.config = cfg;
        adapters.markLoaded(cfg.numControlNets || 0);
        badge.set(info.backend);
        // Nudge a step count that is clearly wrong for the sampler: LCM
        // resolves in a handful of steps, DDIM needs a couple dozen.
        const steps = panel.get('steps');
        if (scheduler === 'lcm' && steps > 12) panel.set('steps', 6);
        else if (scheduler === 'ddim' && steps < 15) panel.set('steps', 25);
        // An INT8 U-Net cannot trace (brodiffusion's traced cross-attention is
        // FP16-only), so capture and steering go dark. cfg.quantizeWeights is
        // what actually happened (a no-op on the CPU backend).
        insp.setTraceCapable(!cfg.quantizeWeights);
        if (cfg.quantizeWeights) el.trace.checked = false;
        status.ok('ready — ' + (cfg.modelClass || 'model') + ' · ' + (cfg.scheduler || scheduler) + ' · ' +
                  (info.backend || '?') + ' · ' + info.numXAttnBlocks + ' cross-attention blocks' +
                  (info.lorasApplied ? ' · ' + info.lorasApplied + ' LoRA' : '') +
                  (adapters.cnLoaded ? ' · ' + adapters.cnLoaded + ' ControlNet' : '') +
                  (cfg.quantizeWeights ? ' — INT8: capture & steering off' : ''));
        prefs.set({ autoLoad: dir });
        // The worker starts clean on every load: re-register the saved axes.
        axes.setLoaded(true);
        axes.reset();
        lab.loading = false;
        setBusy(true);
        await axes.restore(prefs.data.axes);
    } catch (e) {
        lab.error = e.message;
        badge.set('error', 'err');
        status.error('load failed: ' + e.message);
    } finally {
        lab.loading = false;
        setBusy(false);
    }
}

// ---- generation ----------------------------------------------------------------

const readOpts = () => adapters.applyOpts(panel.opts());

function dropFrames() {
    for (const f of lab.frames) if (!f.owned) { try { f.bitmap.close(); } catch (_) {} }
    lab.frames = [];
    el.scrub.disabled = true;
    el.scrub.max = '0';
    el.scrub.value = '0';
}

async function generate() {
    if (!lab.loaded || lab.run || lab.busy) return;
    const prompt = panel.prompt.trim();
    if (!prompt) { status.error('enter a prompt first'); return; }
    const problem = adapters.problem();
    if (problem) { status.error(problem); return; }

    const opts = readOpts();
    const controls = axes.controls();
    const nAxes = Object.keys(controls).length;
    persist();
    const run = insp.beginRun(el.trace.checked);
    // The gallery owns the last run's final image; everything else goes now.
    if (lab.frames.some((f) => !f.owned && f.bitmap === view.image)) view.setImage(lab.final);
    dropFrames();
    const bits = [];
    if (run.steered) bits.push('steering ' + run.steered + ' token(s)');
    if (nAxes) bits.push(nAxes + ' axis' + (nAxes > 1 ? 'es' : ''));
    status.busy('encoding prompt' + (bits.length ? ' — ' + bits.join(' · ') : '') + '…');
    el.timing.textContent = '';
    bar.set(0, 'encoding prompt…');

    let latent = { latentWidth: 0, latentHeight: 0 };
    lab.run = runGeneration(rpc, {
        prompt, opts, controls,
        decode: () => true,                     // every step: the trajectory is the point
        ctrl: () => insp.stepCtrl(),
        onPrimed: (p) => { latent = p; },
        onStep: (m) => {
            if (m.bitmap) {
                lab.frames.push({ stepIndex: m.stepIndex, bitmap: m.bitmap, owned: false });
                view.setImage(m.bitmap);
            }
            if (m.trace) insp.accumulate(m.trace);
            if (m.done) bar.set(1, 'done · ' + m.numSteps + ' steps');
            else bar.step(m.stepIndex, m.numSteps);
        },
    });
    setBusy(true);
    try {
        const r = await lab.run.promise;
        if (r.cancelled) { status.warn('cancelled'); bar.idle(); return; }
        const f = r.final;
        const last = lab.frames[lab.frames.length - 1];
        if (last) last.owned = true;
        lab.final = f.bitmap;
        strip.add(f.bitmap, {
            label: 'seed ' + opts.seed,
            file: 'diffusion-seed' + opts.seed,
            title: prompt + '\nseed ' + opts.seed + ' · ' + f.numSteps + ' steps · cfg ' + opts.guidanceScale +
                   ' · ' + f.width + '×' + f.height + (bits.length ? ' · ' + bits.join(' · ') : '') + ' · ' + fmtMs(r.ms),
        });
        el.scrub.max = String(lab.frames.length - 1);
        el.scrub.value = el.scrub.max;
        el.scrub.disabled = lab.frames.length < 2;
        insp.finish(latent.latentWidth, latent.latentHeight);
        status.ok('generated ' + f.numSteps + ' steps · seed ' + opts.seed);
        el.timing.textContent = fmtMs(r.ms);
    } catch (e) {
        status.error('generation failed: ' + e.message);
        bar.idle('failed');
    } finally {
        lab.run = null;
        setBusy(false);
    }
}

function cancel() { if (lab.run) lab.run.cancel(); }

// ---- viewing -------------------------------------------------------------------

function scrubTo(i) {
    const f = lab.frames[i];
    if (!f) return;
    view.setImage(f.bitmap);
    bar.set((i + 1) / lab.frames.length, 'step ' + f.stepIndex + ' / ' + lab.frames.length);
    insp.setOnLastFrame(i === lab.frames.length - 1);
}

function showEntry(entry) {
    if (entry.bitmap === lab.final && lab.frames.length) {
        el.scrub.value = String(lab.frames.length - 1);
        scrubTo(lab.frames.length - 1);
        return;
    }
    view.setImage(entry.bitmap);
    insp.setOnLastFrame(false);             // the trace belongs to the current run only
}

// ---- wiring --------------------------------------------------------------------

if (prefs.data.scheduler) el.scheduler.value = prefs.data.scheduler;
if (prefs.data.trace === false) el.trace.checked = false;
el.int8.checked = gpu && !!prefs.data.int8;
el.scheduler.addEventListener('change', persist);
el.int8.addEventListener('change', persist);
el.trace.addEventListener('change', persist);
el.scrub.addEventListener('input', () => scrubTo(+el.scrub.value));

// Live re-tokenization, debounced: an edit shifts token indices, so steering
// and any captured trace are dropped.
let promptTimer = 0;
panel.promptEl.addEventListener('input', () => {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(() => insp.promptChanged(panel.prompt), 300);
});

badge.set(gpu ? 'GPU' : 'CPU');
if (typeof bro !== 'undefined' && bro.diffusion && bro.diffusion.version) {
    el.diffVersion.textContent = 'brodiffusion ' + bro.diffusion.version;
}
setBusy(false);
if (picker.path) adoptModel(picker.path);
if (!gpu) status.warn('CPU backend — generation will be slow; an LCM model helps.');

rpc.onReady(() => {
    if (prefs.data.autoLoad && prefs.data.autoLoad === picker.path) loadWeights();
});

/** Live state for tests and the console (the old window.DLabApp surface). */
export const dlab = {
    rpc, picker, panel, axes, view, strip, bar, status, insp, adapters, el,
    viewport: view,
    adoptModel, loadWeights, generate, cancel, readOpts, scrubTo,
    addLoraPath: adapters.addLora,
    addControlNetPath: adapters.addControlNet,
    setInitImage: adapters.setInitImage,
    setMaskImage: adapters.setMaskImage,
    setStrength: adapters.setStrength,
    setVaeSample: adapters.setVaeSample,
    get frames() { return lab.frames; },
    state: () => ({
        detected: !!lab.detected, loaded: lab.loaded, loading: lab.loading, busy: lab.busy,
        running: !!lab.run, error: lab.error, frames: lab.frames.length, hasTrace: insp.hasTrace,
        traceCapable: insp.traceCapable, images: strip.entries.length, axes: axes.count,
        loras: adapters.loras.length, controlnets: adapters.controlnets.length, cnLoaded: adapters.cnLoaded,
        initImage: adapters.init.image, maskImage: adapters.init.mask,
        modelClass: lab.config && lab.config.modelClass, scheduler: lab.config && lab.config.scheduler,
    }),
};
