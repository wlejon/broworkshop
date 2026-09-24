// PixArt Lab — a clean text-to-image bench for PixArt-Sigma on bro.diffusion.
//
// PixArt-Σ (T5-XXL + an AdaLN-single DiT + the SDXL KL-VAE) is auto-detected by
// brodiffusion from the diffusers dir and rides the model-agnostic Pipeline —
// the same prime()/stepOnce()/decode() surface SD and Sana use. The worker
// (lab/pixart-worker.js) owns the pipeline; this page drives one denoising step
// per request through the kit's imagegen runner, so there is a live step
// counter and Cancel. There is no conditioning-control seam here: brodiffusion
// wires it into the Sana and SD1.5 prime paths only (see sana-lab, diffusion-lab).

import { boot } from "/lib/kit/app.js";
import { fmtMs } from "/lib/kit/dom.js";
import { prefStore } from "/lib/kit/prefs.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { modelPicker, genPanel, runBar, runGeneration, imageView, imageStrip }
    from "/lib/kit/imagegen.js";
import { deviceBadge } from "/lib/kit/ml.js";

// PixArt-Sigma's standard recipe: 20 steps, guidance 4.5, 1024² native.
const FIELDS = [
    { key: 'seed', def: 0, min: 0, random: true },
    { key: 'steps', def: 20, min: 1, max: 50 },
    { key: 'guidance', def: 4.5, step: 0.5, min: 1, max: 20 },
    { key: 'size', def: 1024, options: [1024, 768, 512], fmt: (v) => v + '²' },
];

export const prefs = prefStore('pixart-lab.v2');
const { status } = boot();
const timing = document.getElementById('timing');
const rpc = workerClient('lab/pixart-worker.js');
const badge = deviceBadge('#backend');

const lab = { loaded: false, loading: false, run: null, config: null, error: null };

const persist = () => prefs.set({ modelDir: picker.path, form: panel.state() });

const picker = modelPicker('#model', {
    label: 'PixArt-Sigma directory',
    candidates: ['brodiffusion/weights/pixart-sigma'],
    value: prefs.data.modelDir,
    onLoad: load,
    onPick: persist,
});
const panel = genPanel('#gen', {
    prompt: 'a photo of a small bird perched on a branch',
    negative: 'blurry, low quality, deformed, watermark',
    fields: FIELDS,
    onSubmit: generate,
    onCancel: cancel,
    onChange: persist,
});
panel.restore(prefs.data.form);
const bar = runBar('#run');
const view = imageView('#view', { hint: '#view-hint' });
const strip = imageStrip('#gallery', { onSelect: (e) => view.setImage(e.bitmap) });

async function load() {
    const dir = picker.path;
    if (!dir) { status.error('set a PixArt directory first'); return; }
    if (lab.loading || lab.run) return;
    persist();
    lab.loading = true; lab.loaded = false; lab.error = null;
    picker.setBusy(true);
    panel.setEnabled(false);
    badge.set('loading…', 'warn');
    status.busy('loading model — this reads multi-GB weights, give it a moment');
    try {
        const msg = await rpc.request({ type: 'load', modelDir: dir });
        lab.loaded = true;
        lab.config = msg.config;
        badge.set(msg.backend);
        status.ok((msg.config.modelClass || 'model') + ' ready');
        prefs.set({ autoLoad: dir });
        panel.setEnabled(true);
    } catch (e) {
        lab.error = e.message;
        badge.set('error', 'err');
        status.error(e);
    } finally {
        lab.loading = false;
        picker.setBusy(false);
    }
}

async function generate() {
    if (!lab.loaded || lab.run) return;
    const opts = panel.opts();
    const prompt = panel.prompt;
    persist();
    panel.setRunning(true);
    picker.setBusy(true);
    status.busy('generating…');
    timing.textContent = '';
    bar.set(0, 'encoding prompt…');
    const run = lab.run = runGeneration(rpc, {
        prompt, opts,
        onStep: (m) => bar.step(m.stepIndex, m.numSteps),
    });
    try {
        const r = await run.promise;
        if (r.cancelled) { status.warn('cancelled'); bar.idle('cancelled'); return; }
        const f = r.final;
        view.setImage(f.bitmap);
        strip.add(f.bitmap, {
            label: 'seed ' + opts.seed,
            file: 'pixart-seed' + opts.seed,
            title: prompt + '\nseed ' + opts.seed + ' · ' + opts.steps + ' steps · cfg ' + opts.guidanceScale +
                   ' · ' + f.width + '×' + f.height + ' · ' + fmtMs(r.ms),
        });
        status.ok('done');
        bar.set(1, 'done · ' + f.numSteps + ' steps');
        timing.textContent = fmtMs(r.ms);
    } catch (e) {
        status.error(e);
        bar.idle('failed');
    } finally {
        lab.run = null;
        panel.setRunning(false);
        picker.setBusy(false);
    }
}

function cancel() { if (lab.run) lab.run.cancel(); }

rpc.onReady(() => {
    status.set('ready — load a model to begin');
    // Reload the model the last session loaded successfully.
    if (prefs.data.autoLoad && prefs.data.autoLoad === picker.path) load();
});

/** Live state for tests and the console. */
export const pixart = {
    rpc, picker, panel, view, strip, bar, status, load, generate, cancel,
    state: () => ({ loaded: lab.loaded, loading: lab.loading, running: !!lab.run,
                    error: lab.error, images: strip.entries.length,
                    modelClass: lab.config && lab.config.modelClass }),
};
