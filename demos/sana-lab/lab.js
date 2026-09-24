// Sana Lab — steer Sana through its own conditioning space while holding one face.
//
// Two research seams of brodiffusion's Sana pipeline, driven from a worker
// (lab/sana-worker.js):
//
//   Axes      each axis is a direction in Gemma conditioning space, searched
//             live from two word sets (diff of means, the massive-activation
//             sink dims zeroed, unit-normalised) and driven by a strength
//             slider (the injection norm). All active axes apply per run;
//             strength 0 is a true no-op.
//   Identity  capture a reference portrait's per-step linear-attention
//             summaries once (Capture anchor); every later run adds them back
//             scaled by the strength slider, so the face stays the same person
//             while the prompt and axes change the expression. The summaries
//             are per step, so runs are pinned to the anchor's step count.
//
// "live" re-renders as sliders move: a latest-wins scheduler runs one render
// at a time and coalesces drags to the final value; a drag asks for a fast
// preview (512², and fewer steps when no anchor pins them), the release asks
// for a full render, which always beats a queued preview.

import { boot } from "/lib/kit/app.js";
import { ids, fmtMs } from "/lib/kit/dom.js";
import { prefStore } from "/lib/kit/prefs.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { modelPicker, backendBadge, genPanel, runBar, runGeneration, imageView, imageStrip, wordAxes }
    from "/lib/kit/imagegen.js";

const PREVIEW_STEPS = 8;     // no-anchor preview: fewer steps is fine
const PREVIEW_SIZE = 512;    // any preview: shrink resolution (summaries are token-count independent)

// Sana's standard recipe: 20 steps, guidance 4.5, 1024² native (multiples of 32).
const FIELDS = [
    { key: 'seed', def: 0, min: 0, random: true },
    { key: 'steps', def: 20, min: 1, max: 50 },
    { key: 'guidance', def: 4.5, step: 0.5, min: 1, max: 20 },
    { key: 'size', def: 1024, options: [1024, 768, 512], fmt: (v) => v + '²' },
];

export const prefs = prefStore('sana-lab.v3');
const { status } = boot();
const el = ids('anchor-prompt', 'capture', 'identity-weight', 'identity-weight-val', 'clear-anchor',
               'identity-hint', 'identity', 'ref-pane', 'gen-sub', 'timing', 'zero-axes');
const rpc = workerClient('lab/sana-worker.js');
const badge = backendBadge('#backend');

const lab = {
    loaded: false, loading: false, busy: false, run: null, error: null, config: null,
    live: !!prefs.data.live,
    pending: null,                          // queued render quality: 'preview' | 'full'
    anchor: { armed: false, steps: 0, bitmap: null },
    loose: null,                            // shown bitmap the gallery does not own (a preview)
    renders: 0,
};

const persist = () => prefs.set({
    modelDir: picker.path, form: panel.state(), live: lab.live,
    anchorPrompt: el.anchorPrompt.value, identityWeight: +el.identityWeight.value,
    axes: axes.serialize(),
});

const picker = modelPicker('#model', {
    label: 'Sana directory',
    candidates: ['brodiffusion/weights/sana-1.6b', 'brodiffusion/weights/sana-600m',
                 'brodiffusion/weights/sana-sprint-1.6b', 'brodiffusion/weights/sana-sprint-0.6b'],
    value: prefs.data.modelDir,
    onLoad: load,
    onPick: persist,
});

const liveBox = document.createElement('input');
liveBox.type = 'checkbox';
liveBox.checked = lab.live;
const liveLabel = document.createElement('label');
liveLabel.className = 'k-field';
liveLabel.title = 'Re-render as you drag the sliders (fast preview)';
liveLabel.append(liveBox, ' live');

const panel = genPanel('#gen', {
    prompt: 'a photo of a small bird perched on a branch',
    negative: 'blurry, low quality, deformed',
    fields: FIELDS,
    extra: liveLabel,
    onSubmit: () => schedule('full'),
    onCancel: cancel,
    onChange: persist,
});
panel.restore(prefs.data.form);

const axes = wordAxes('#axes', {
    rpc, status,
    range: { min: -25, max: 25, step: 0.5 },
    ready: () => lab.loaded && !lab.busy,
    setBusy,
    onChange: persist,
    onInput: () => { if (lab.live) schedule('preview'); },
    onCommit: () => { if (lab.live) schedule('full'); },
});

const bar = runBar('#run');
const view = imageView('#view', { hint: '#view-hint' });
const refView = imageView('#ref-view');
const strip = imageStrip('#gallery', { onSelect: (e) => show(e.bitmap, false) });

function show(bitmap, loose) {
    if (lab.loose && lab.loose !== bitmap) { try { lab.loose.close(); } catch (_) {} }
    lab.loose = loose ? bitmap : null;
    view.setImage(bitmap);
}

function setBusy(b) {
    lab.busy = !!b;
    panel.setEnabled(lab.loaded && !lab.busy);
    panel.setRunning(!!lab.run);
    picker.setBusy(lab.busy || lab.loading);
    axes.setEnabled(!lab.busy && lab.loaded);
    el.capture.disabled = lab.busy || !lab.loaded;
}

// ---- load ----------------------------------------------------------------------

async function load() {
    const dir = picker.path;
    if (!dir) { status.error('set a Sana directory first'); return; }
    if (lab.loading || lab.busy) return;
    persist();
    lab.loading = true; lab.loaded = false; lab.error = null;
    setBusy(true);
    clearAnchorUi();
    badge.set('loading…', 'warn');
    status.busy('loading model — this reads multi-GB weights, give it a moment');
    try {
        const msg = await rpc.request({ type: 'load', modelDir: dir });
        lab.loaded = true;
        lab.config = msg.config;
        badge.set(msg.backend);
        status.ok((msg.config.modelClass || 'model') + ' ready');
        prefs.set({ autoLoad: dir });
        axes.setLoaded(true);
        axes.reset();                       // the worker starts clean on every load
        await axes.restore(prefs.data.axes);
    } catch (e) {
        lab.error = e.message;
        badge.set('error', 'err');
        status.error(e);
    } finally {
        lab.loading = false;
        setBusy(false);
        pump();
    }
}

// ---- rendering -----------------------------------------------------------------

// GenerateOptions for a quality. With an anchor armed every render keeps the
// anchor's step schedule (t-alignment), so a preview only shrinks resolution.
function genOpts(quality) {
    const o = panel.opts();
    const preview = quality === 'preview';
    if (preview) { o.width = Math.min(o.width, PREVIEW_SIZE); o.height = Math.min(o.height, PREVIEW_SIZE); }
    o.steps = lab.anchor.armed ? lab.anchor.steps : preview ? Math.min(o.steps, PREVIEW_STEPS) : o.steps;
    return o;
}

const identityWeight = () => (lab.anchor.armed ? +el.identityWeight.value : 0);

/** Ask for a render; the latest request wins and 'full' beats a queued 'preview'. */
function schedule(quality) {
    if (!lab.loaded) return;
    if (quality === 'full' || lab.pending !== 'full') lab.pending = quality;
    pump();
}

function pump() {
    if (lab.busy || !lab.loaded || !lab.pending) return;
    const q = lab.pending;
    lab.pending = null;
    render(q);
}

async function render(quality) {
    const controls = axes.controls();
    const iw = identityWeight();
    const opts = genOpts(quality);
    const prompt = panel.prompt;
    persist();
    el.genSub.textContent = opts.width + '² · ' + opts.steps + ' steps' + (iw ? ' · held' : '');
    const bits = [];
    if (iw) bits.push('identity ' + iw.toFixed(1));
    const n = Object.keys(controls).length;
    if (n) bits.push(n + ' axis' + (n > 1 ? 'es' : ''));
    const label = quality === 'preview' ? 'preview' : 'generating';
    status.busy(label + (bits.length ? ' · ' + bits.join(' · ') : ' · baseline') + '…');
    el.timing.textContent = '';
    bar.set(0, 'encoding prompt…');
    lab.run = runGeneration(rpc, {
        prompt, opts, controls, identityWeight: iw,
        onStep: (m) => bar.step(m.stepIndex, m.numSteps),
    });
    setBusy(true);
    try {
        const r = await lab.run.promise;
        if (r.cancelled) { status.warn('cancelled'); bar.idle('cancelled'); return; }
        const f = r.final;
        lab.renders++;
        if (quality === 'full') {
            show(f.bitmap, false);
            strip.add(f.bitmap, {
                label: 'seed ' + opts.seed + (iw ? ' · held' : ''),
                file: 'sana-seed' + opts.seed,
                title: prompt + '\nseed ' + opts.seed + ' · ' + opts.steps + ' steps · cfg ' + opts.guidanceScale +
                       ' · ' + f.width + '² · ' + (bits.join(' · ') || 'baseline') + ' · ' + fmtMs(r.ms),
            });
        } else {
            show(f.bitmap, true);
        }
        status.ok(quality === 'preview' ? 'preview' : 'done');
        bar.set(1, (quality === 'preview' ? 'preview · ' : 'done · ') + f.numSteps + ' steps');
        el.timing.textContent = fmtMs(r.ms) + (quality === 'preview' ? ' · preview' : '');
    } catch (e) {
        status.error(e);
        bar.idle('failed');
    } finally {
        lab.run = null;
        setBusy(false);
        pump();                             // whatever was asked for meanwhile
    }
}

function cancel() {
    lab.pending = null;
    if (lab.run) lab.run.cancel();
}

// ---- identity anchor -------------------------------------------------------------

async function captureAnchor() {
    if (!lab.loaded || lab.busy) return;
    const prompt = el.anchorPrompt.value.trim();
    if (!prompt) { status.error('enter an anchor prompt first'); return; }
    persist();
    const steps = panel.get('steps');
    const opts = panel.opts();
    setBusy(true);
    status.busy('capturing identity anchor — one full render…');
    bar.set(0, 'capturing anchor…');
    try {
        const msg = await rpc.request({ type: 'anchor', prompt, opts });
        if (lab.anchor.bitmap) { try { lab.anchor.bitmap.close(); } catch (_) {} }
        lab.anchor = { armed: true, steps, bitmap: msg.bitmap };
        refView.setImage(msg.bitmap);
        panel.set('steps', steps);
        panel.lock('steps', 'locked');
        el.clearAnchor.disabled = false;
        el.identity.classList.add('armed');
        el.refPane.hidden = false;
        refreshAnchorHint();
        bar.set(1, 'anchor captured');
        status.ok('identity anchor captured · ' + fmtMs(msg.ms || 0));
    } catch (e) {
        status.error(e);
        bar.idle('failed');
    } finally {
        setBusy(false);
        pump();
    }
}

function clearAnchorUi() {
    if (lab.anchor.bitmap) { try { lab.anchor.bitmap.close(); } catch (_) {} }
    lab.anchor = { armed: false, steps: 0, bitmap: null };
    refView.clear();
    panel.lock('steps', false);
    el.clearAnchor.disabled = true;
    el.identity.classList.remove('armed');
    el.refPane.hidden = true;
    refreshAnchorHint();
}

async function clearAnchor() {
    if (lab.busy) return;
    clearAnchorUi();
    persist();
    try { await rpc.request({ type: 'clearAnchor' }); status.ok('identity anchor cleared'); }
    catch (e) { status.error(e); }
}

function refreshAnchorHint() {
    el.identityHint.textContent = lab.anchor.armed
        ? 'strength = identity pull · push an expression axis and the face holds'
        : 'Capture a neutral portrait to hold its identity across edits.';
}

// ---- wiring --------------------------------------------------------------------

if (prefs.data.anchorPrompt) el.anchorPrompt.value = prefs.data.anchorPrompt;
if (prefs.data.identityWeight != null) el.identityWeight.value = String(prefs.data.identityWeight);
const paintWeight = () => { el.identityWeightVal.textContent = (+el.identityWeight.value).toFixed(1); };
paintWeight();
refreshAnchorHint();
el.identityWeight.addEventListener('input', () => {
    paintWeight(); persist();
    if (lab.live && lab.anchor.armed) schedule('preview');
});
el.identityWeight.addEventListener('change', () => { if (lab.live && lab.anchor.armed) schedule('full'); });
el.anchorPrompt.addEventListener('change', persist);
el.capture.addEventListener('click', captureAnchor);
el.clearAnchor.addEventListener('click', clearAnchor);
el.zeroAxes.addEventListener('click', () => { axes.zero(); if (lab.live) schedule('full'); });
liveBox.addEventListener('change', () => {
    lab.live = liveBox.checked;
    persist();
    if (lab.live) schedule('full');         // catch up to the current sliders
});
setBusy(false);

rpc.onReady(() => {
    status.set('ready — load a model to begin');
    if (prefs.data.autoLoad && prefs.data.autoLoad === picker.path) load();
});

/** Live state for tests and the console. */
export const sana = {
    rpc, picker, panel, axes, view, refView, strip, bar, status, el, liveBox,
    load, schedule, cancel, captureAnchor, clearAnchor,
    state: () => ({
        loaded: lab.loaded, loading: lab.loading, busy: lab.busy, running: !!lab.run,
        pending: lab.pending, error: lab.error, armed: lab.anchor.armed, anchorSteps: lab.anchor.steps,
        images: strip.entries.length, renders: lab.renders, axes: axes.count, live: lab.live,
        modelClass: lab.config && lab.config.modelClass,
    }),
};
