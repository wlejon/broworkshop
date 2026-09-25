// TripoSplat Lab — single image to a 3D Gaussian splat, reconstructed on device.
//
// The pipeline (DINOv3 + Flux.2 VAE encoders -> flow-matching DiT -> octree
// Gaussian decoder, with optional BiRefNet background removal) runs through
// bro.triposplat in a Worker (lab/splat-worker.js), so the page stays live
// while it computes. This file conducts: pick an image, set parameters, ask
// the worker to reconstruct, hand the cloud to the viewport, export a .ply.

import { boot } from "/lib/kit/app.js";
import { h, ids, clear } from "/lib/kit/dom.js";
import { deviceBadge, pickFile, pickSaveFile, baseName, appPath } from "/lib/kit/ml.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";
import { params as paramPanel } from "/lib/kit/params.js";
import { prefStore } from "/lib/kit/prefs.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { splatViewport } from "/app/lab/viewport.js";

/** The checkpoints, by bro.triposplat.load key. BiRefNet is optional. */
export const WEIGHTS = {
    dinov3: { what: 'DINOv3 ViT-H image encoder', candidates: ['brovisionml/weights/triposplat/clip_vision/dino_v3_vit_h.safetensors'] },
    vae: { what: 'Flux.2 VAE', candidates: ['brodiffusion/weights/triposplat/vae/flux2-vae.safetensors'] },
    flow: { what: 'TripoSplat flow DiT', candidates: ['brodiffusion/weights/triposplat/diffusion_models/triposplat_fp16.safetensors'] },
    decoder: { what: 'TripoSplat Gaussian decoder', candidates: ['brodiffusion/weights/triposplat/vae/triposplat_vae_decoder_fp16.safetensors'] },
    birefnet: { what: 'BiRefNet matte model', optional: true,
                candidates: ['brovisionml/weights/triposplat/background_removal/birefnet.safetensors'] },
};
export const SAMPLES = [{ name: 'Portrait', path: 'samples/portrait.png' }, { name: 'Robot arm', path: 'samples/robot-arm.png' }];

const SPEC = {
    steps: { label: 'steps', min: 4, max: 30, step: 1, hint: 'flow-matching sampler steps' },
    cfg: { label: 'guidance', min: 1, max: 7, step: 0.1, fmt: (v) => v.toFixed(1), hint: 'classifier-free guidance scale' },
    numGaussians: { label: 'gaussians', min: 32768, max: 262144, step: 32768, fmt: (v) => v.toLocaleString() },
    shift: { label: 'flow shift', min: 1, max: 6, step: 0.1, fmt: (v) => v.toFixed(1), hint: 'timestep shift of the flow schedule' },
};

/** Live app state (tests read it). */
export const lab = {
    paths: {},          // resolved checkpoint paths (missing ones absent)
    missing: [],        // required checkpoints not found
    loaded: false,
    device: '',
    hasBgModel: false,
    image: null,        // { data, width, height, label }
    running: false,
    cancelling: false,
    cloud: null,        // the last cloud (SoA typed arrays, count, shDegree) + ms
    runs: 0,            // settled generates (done / cancelled / error)
    last: '',           // 'generated' | 'cancelled' | 'error'
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('samples', 'btn-open', 'image-meta', 'thumb', 'bg-remove', 'bg-row', 'params', 'seed', 'btn-rand',
                   'btn-go', 'elapsed', 'weights', 'autorotate', 'btn-reset', 'vscale', 'vscale-val', 'vlight',
                   'splat-meta', 'btn-save', 'stage', 'view-hint');
    const prefs = prefStore('triposplat-lab.v2', { steps: 12, cfg: 3, numGaussians: 131072, shift: 3, seed: 42, bgRemove: true,
                                                  autorotate: true, light: false, scale: 100, image: SAMPLES[0].path });
    const values = { steps: prefs.data.steps, cfg: prefs.data.cfg, numGaussians: prefs.data.numGaussians, shift: prefs.data.shift };
    const controls = paramPanel(el.params, values, SPEC, { onChange: () => prefs.set(values) });
    const view = splatViewport('#view');
    const rpc = workerClient('lab/splat-worker.js');
    let timer = 0;

    // ── weights ──────────────────────────────────────────────────────────
    function resolveWeights() {
        clear(el.weights);
        lab.paths = {}; lab.missing = [];
        for (const k in WEIGHTS) {
            const w = WEIGHTS[k], p = findWeights(w.candidates);
            if (p) lab.paths[k] = p;
            else if (!w.optional) lab.missing.push(k);
            el.weights.appendChild(h('div' + (p ? '' : '.miss'), { title: p || missingWeights(w.what, w.candidates) },
                h('span', null, w.what), h('b', null, p ? baseName(p) : w.optional ? 'absent (optional)' : 'missing')));
        }
    }

    async function load() {
        if (lab.missing.length) {
            const w = WEIGHTS[lab.missing[0]];
            lab.error = missingWeights(w.what, w.candidates);
            status.error(lab.error);
            el.viewHint.textContent = 'Weights missing: see the Weights panel.';
            return;
        }
        status.busy('loading models (DINOv3 + VAE + flow + decoder' + (lab.paths.birefnet ? ' + BiRefNet' : '') + ')…');
        try {
            await rpc.ready;
            const info = await rpc.request({ type: 'load', weights: lab.paths });
            lab.loaded = true;
            lab.device = info.device || '';
            lab.hasBgModel = !!info.backgroundRemoval;
            if (lab.device) badge.set(lab.device);
            el.bgRemove.checked = lab.hasBgModel && prefs.data.bgRemove;
            el.bgRow.title = lab.hasBgModel ? 'Isolate the subject with BiRefNet before reconstruction'
                                            : 'BiRefNet weights not found: background removal unavailable';
            el.viewHint.textContent = 'Pick an image and Generate.';
            status.ok('models ready on ' + lab.device);
        } catch (e) {
            lab.error = 'load failed: ' + e.message;
            status.error(lab.error);
            el.viewHint.textContent = 'Model load failed: see the status bar.';
        }
        refresh();
    }

    // ── images ───────────────────────────────────────────────────────────
    function useDrawable(src, w, hh, label) {
        const c = h('canvas'); c.width = w; c.height = hh;
        const cx = c.getContext('2d');
        cx.drawImage(src, 0, 0);
        const img = cx.getImageData(0, 0, w, hh);
        lab.image = { data: img.data, width: w, height: hh, label };
        // Letterbox into a fixed thumbnail so a tall image does not stretch the rail.
        el.thumb.hidden = false;
        el.thumb.width = 280; el.thumb.height = 180;
        const tc = el.thumb.getContext('2d'), k = Math.min(280 / w, 180 / hh);
        tc.fillStyle = '#0b0d11'; tc.fillRect(0, 0, 280, 180);
        tc.drawImage(src, (280 - w * k) / 2, (180 - hh * k) / 2, w * k, hh * k);
        el.imageMeta.textContent = label + ' · ' + w + '×' + hh;
        for (const t of el.samples.children) t.classList.toggle('active', t.dataset.label === label);
        refresh();
    }

    function openPath(path) {
        const img = new Image();
        img.src = appPath(path);
        if (!img.naturalWidth) { status.error('could not decode image: ' + path); return false; }
        useDrawable(img, img.naturalWidth, img.naturalHeight, baseName(path));
        prefs.set({ image: path });
        return true;
    }

    function buildSamples() {
        for (const s of SAMPLES) {
            const img = new Image();
            img.src = appPath(s.path);
            if (!img.naturalWidth) continue;
            const c = h('canvas'); c.width = 64; c.height = 64;
            const k = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight);
            c.getContext('2d').drawImage(img, (64 - img.naturalWidth * k) / 2, (64 - img.naturalHeight * k) / 2,
                                         img.naturalWidth * k, img.naturalHeight * k);
            el.samples.appendChild(h('div.k-thumb', { title: s.name, dataset: { label: baseName(s.path), path: s.path },
                                                      onclick: () => { if (!lab.running) openPath(s.path); } },
                                     c, h('span', null, s.name)));
        }
    }

    // ── generate / cancel ────────────────────────────────────────────────
    function opts() {
        return {
            seed: Math.max(0, parseInt(el.seed.value, 10) || 0),
            steps: values.steps, guidanceScale: values.cfg, numGaussians: values.numGaussians, shift: values.shift,
            removeBackground: lab.hasBgModel && el.bgRemove.checked,
        };
    }

    async function generate() {
        if (lab.running || !lab.loaded || !lab.image) return;
        const o = opts();
        prefs.set({ seed: o.seed, bgRemove: el.bgRemove.checked });
        lab.running = true; lab.cancelling = false; lab.error = '';
        refresh();
        el.viewHint.textContent = view.hasCloud() ? '' : 'Reconstructing…';
        const t0 = Date.now();
        clearInterval(timer);
        timer = setInterval(() => { el.elapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);
        status.busy('reconstructing ' + o.numGaussians.toLocaleString() + ' Gaussians (' + o.steps + ' steps' +
                    (o.removeBackground ? ', BiRefNet' : '') + ')…');
        // Transfer a throwaway copy so the source stays intact for re-runs.
        const image = { data: new Uint8ClampedArray(lab.image.data), width: lab.image.width, height: lab.image.height };
        try {
            const r = await rpc.request({ type: 'generate', image, opts: o }, [image.data.buffer]);
            if (r.type === 'cancelled') {
                lab.last = 'cancelled';
                status.warn('cancelled');
            } else {
                view.setCloud(r.cloud);
                lab.cloud = Object.assign(r.cloud, { ms: r.ms });
                lab.last = 'generated';
                el.splatMeta.textContent = r.cloud.count.toLocaleString() + ' splats · seed ' + o.seed;
                status.ok(r.cloud.count.toLocaleString() + ' Gaussians · ' + (r.ms / 1000).toFixed(1) + ' s · seed ' + o.seed);
            }
        } catch (e) {
            lab.last = 'error';
            lab.error = 'generate failed: ' + e.message;
            status.error(lab.error);
        }
        clearInterval(timer);
        el.elapsed.textContent = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
        el.viewHint.textContent = view.hasCloud() ? '' : 'Pick an image and Generate.';
        lab.running = false; lab.cancelling = false; lab.runs++;
        refresh();
    }

    // The worker is blocked inside generate(), so cancel flips the native flag
    // from this thread; generate() returns at its next stage / step boundary.
    function cancel() {
        if (!lab.running || lab.cancelling) return;
        lab.cancelling = true;
        if (bro.triposplat && bro.triposplat.cancel) bro.triposplat.cancel();
        status.busy('cancelling…');
        refresh();
    }

    function savePly(path) {
        if (!view.hasCloud()) return null;
        const def = (lab.image ? lab.image.label.replace(/\.[^.]+$/, '') : 'splat') + '.ply';
        const p = path || pickSaveFile('Gaussian Splat|ply', def);
        if (!p) return null;
        try {
            view.savePly(p);
            status.ok('saved ' + view.splatCount().toLocaleString() + ' splats → ' + baseName(p));
            return p;
        } catch (e) { status.error('save failed: ' + e.message); return null; }
    }

    function refresh() {
        const busy = lab.running;
        el.btnGo.textContent = busy ? (lab.cancelling ? 'Cancelling…' : 'Cancel') : 'Generate';
        el.btnGo.disabled = busy ? lab.cancelling : !lab.loaded || !lab.image;
        el.btnSave.disabled = busy || !view.hasCloud();
        el.btnOpen.disabled = busy;
        el.seed.disabled = el.btnRand.disabled = busy;
        for (const inp of el.params.querySelectorAll('input')) inp.disabled = busy;
        el.bgRemove.disabled = busy || !lab.hasBgModel;
        el.samples.style.opacity = busy ? '0.5' : '1';
    }

    // ── wiring ───────────────────────────────────────────────────────────
    el.btnGo.onclick = () => (lab.running ? cancel() : generate());
    el.btnSave.onclick = () => savePly();
    el.btnOpen.onclick = () => { const p = pickFile('Images|png;jpg;jpeg;webp'); if (p) openPath(p); };
    el.btnRand.onclick = () => { el.seed.value = String(Math.floor(Math.random() * 1e9)); };
    el.stage.addEventListener('dragover', (e) => e.preventDefault());
    el.stage.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = !lab.running && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) createImageBitmap(f).then((b) => useDrawable(b, b.width, b.height, f.name || 'dropped image'),
                                         (err) => status.error('could not open ' + f.name + ': ' + err.message));
    });
    el.autorotate.addEventListener('change', () => { view.autoRotate = el.autorotate.checked; prefs.set({ autorotate: view.autoRotate }); });
    el.btnReset.onclick = () => view.reset();
    el.vscale.addEventListener('input', () => {
        view.setScale(+el.vscale.value / 100);
        el.vscaleVal.textContent = (+el.vscale.value / 100).toFixed(2);
        prefs.set({ scale: +el.vscale.value });
    });
    el.vlight.addEventListener('change', () => { el.stage.classList.toggle('light', el.vlight.checked); prefs.set({ light: el.vlight.checked }); });

    // ── boot ─────────────────────────────────────────────────────────────
    el.seed.value = String(prefs.data.seed);
    el.autorotate.checked = view.autoRotate = prefs.data.autorotate !== false;
    el.vlight.checked = !!prefs.data.light;
    el.stage.classList.toggle('light', el.vlight.checked);
    el.vscale.value = String(prefs.data.scale);
    el.vscaleVal.textContent = (prefs.data.scale / 100).toFixed(2);
    view.setScale(prefs.data.scale / 100);
    buildSamples();
    if (!openPath(prefs.data.image)) openPath(SAMPLES[0].path);
    resolveWeights();
    lab.ui = { status, badge, view, rpc, prefs, controls, generate, cancel, savePly, openPath };
    refresh();
    load();
}
