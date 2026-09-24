// Diffusion Lab — the load-time and run-time extras of the left panel:
//
//   LoRA adapters   merged into the weights at load (irreversible), so any
//                   change marks the resident weights stale until Load
//   ControlNets     registered at load in list order (sticky on the pipeline);
//                   adding / removing one also needs a reload, while each
//                   row's control image, scale and step window are per-run
//   init image      img2img (strength, VAE sample) and an inpaint mask,
//                   per-run; a mask needs an init image
//
// Everything persists through the lab's prefs. The lab supplies
// { prefs, status, running(), onStale(msg) }.

import { h, ids } from "/lib/kit/dom.js";
import { baseName } from "/lib/kit/ml.js";

const IMAGES = 'Image|png;jpg;jpeg';

function pickFile(filter, multi, status) {
    if (typeof showOpenFileDialog !== 'function') { status.error('file dialog unavailable in this build'); return []; }
    return showOpenFileDialog(filter, !!multi) || [];
}

const num = (v, d) => (isFinite(v) ? +v : d);

export function createAdapters(ctx) {
    const { prefs, status } = ctx;
    const el = ids('lora-list', 'lora-add', 'cn-list', 'cn-add', 'cn-stale', 'cn-section',
                   'init-section', 'init-pick', 'init-path', 'init-clear', 'strength', 'strength-val',
                   'vae-sample', 'mask-pick', 'mask-path', 'mask-clear');

    const d = prefs.data;
    const loras = (d.loras || []).filter((l) => l && l.path).map((l) => ({ path: l.path, scale: num(l.scale, 1) }));
    const cns = (d.controlnets || []).filter((c) => c && c.path).map((c) => ({
        path: c.path, image: c.image || '', scale: num(c.scale, 1),
        startStep: num(c.startStep, 0), endStep: num(c.endStep, 1),
    }));
    const init = {
        image: typeof d.initImage === 'string' ? d.initImage : '',
        strength: num(d.initStrength, 0.8),
        vaeSample: !!d.vaeSample,
        mask: typeof d.maskImage === 'string' ? d.maskImage : '',
    };
    let cnLoaded = 0;

    const persist = () => prefs.set({
        loras, controlnets: cns,
        initImage: init.image, initStrength: init.strength, vaeSample: init.vaeSample, maskImage: init.mask,
    });

    // ---- LoRA ------------------------------------------------------------------
    function loraChanged() {
        renderLoras();
        persist();
        ctx.onStale('LoRA set changed — click Load weights to apply.');
    }
    function renderLoras() {
        el.loraList.textContent = '';
        if (!loras.length) { el.loraList.appendChild(h('p.k-note', null, 'None — the base model runs unmodified.')); return; }
        loras.forEach((lora, i) => {
            const scale = h('input', { type: 'number', step: '0.05', value: String(lora.scale), title: 'adapter strength' });
            scale.addEventListener('change', () => {
                lora.scale = num(parseFloat(scale.value), 1);
                scale.value = String(lora.scale);
                loraChanged();
            });
            el.loraList.appendChild(h('div.k-row.k-nowrap.adapter', null,
                h('span.k-grow.name', { title: lora.path }, baseName(lora.path)),
                scale,
                h('button.small', { title: 'remove adapter', text: '✕',
                    onclick: () => { if (ctx.running()) return; loras.splice(i, 1); loraChanged(); } })));
        });
    }
    function addLora(path, scale) {
        loras.push({ path, scale: scale == null ? 1 : scale });
        loraChanged();
    }

    // ---- ControlNets -----------------------------------------------------------
    function cnChanged() {
        renderCns();
        persist();
        el.cnStale.hidden = cns.length === cnLoaded;
        if (cns.length !== cnLoaded) ctx.onStale('ControlNet set changed — click Load weights to apply.');
    }
    function renderCns() {
        el.cnList.textContent = '';
        if (!cns.length) {
            el.cnList.appendChild(h('p.k-note', null, 'None — add one to condition generation on a pose / depth / canny image.'));
            return;
        }
        cns.forEach((cn, i) => {
            const imgName = h('span.k-grow.dim.name', { title: cn.image }, cn.image ? baseName(cn.image) : 'none');
            const scaleVal = h('span.k-val', null, cn.scale.toFixed(2));
            const scale = h('input', { type: 'range', min: '0', max: '2', step: '0.05', value: String(cn.scale) });
            scale.addEventListener('input', () => {
                cn.scale = num(parseFloat(scale.value), 1);
                scaleVal.textContent = cn.scale.toFixed(2);
                persist();
            });
            const win = (v) => h('input.win', { type: 'number', min: '0', max: '1', step: '0.05', value: String(v) });
            const start = win(cn.startStep), end = win(cn.endStep);
            const commit = () => {
                const clamp = (v, dflt) => (isFinite(v) ? Math.max(0, Math.min(1, v)) : dflt);
                cn.startStep = clamp(parseFloat(start.value), 0);
                cn.endStep = clamp(parseFloat(end.value), 1);
                start.value = String(cn.startStep);
                end.value = String(cn.endStep);
                persist();
            };
            start.addEventListener('change', commit);
            end.addEventListener('change', commit);
            el.cnList.appendChild(h('div.k-col.cn-row', null,
                h('div.k-row.k-nowrap', null,
                    h('span.k-grow.name', { title: cn.path }, baseName(cn.path)),
                    h('button.small', { title: 'remove ControlNet', text: '✕',
                        onclick: () => { if (ctx.running()) return; cns.splice(i, 1); cnChanged(); } })),
                h('div.k-row.k-nowrap', null,
                    h('button.small', { text: 'Image…', title: 'control image', onclick: () => {
                        if (ctx.running()) return;
                        const f = pickFile('Control image|png;jpg;jpeg', false, status);
                        if (!f.length) return;
                        cn.image = f[0];
                        imgName.textContent = baseName(cn.image);
                        imgName.title = cn.image;
                        persist();
                    } }),
                    imgName),
                h('label.k-field', null, h('span', null, 'scale'), scale, scaleVal),
                h('label.k-field', null, h('span', null, 'window'), start, h('span', null, '—'), end)));
        });
    }
    function addControlNet(path, o) {
        const x = o || {};
        cns.push({ path, image: x.image || '', scale: num(x.scale, 1),
                   startStep: num(x.startStep, 0), endStep: num(x.endStep, 1) });
        cnChanged();
        el.cnSection.classList.remove('folded');
    }

    // ---- init image + mask -------------------------------------------------------
    function paintInit() {
        el.initPath.textContent = init.image ? baseName(init.image) : 'none';
        el.initPath.title = init.image;
        el.maskPath.textContent = init.mask ? baseName(init.mask) : 'none';
        el.maskPath.title = init.mask;
        el.strength.value = String(init.strength);
        el.strengthVal.textContent = init.strength.toFixed(2);
        el.vaeSample.checked = init.vaeSample;
    }
    const setInit = (p) => { init.image = p || ''; if (!init.image) init.mask = ''; paintInit(); persist(); };
    const setMask = (p) => { init.mask = p || ''; paintInit(); persist(); };

    el.loraAdd.addEventListener('click', () => {
        if (ctx.running()) return;
        for (const f of pickFile('LoRA weights|safetensors', true, status)) addLora(f, 1);
    });
    el.cnAdd.addEventListener('click', () => {
        if (ctx.running()) return;
        for (const f of pickFile('ControlNet weights|safetensors', true, status)) addControlNet(f);
    });
    el.initPick.addEventListener('click', () => {
        if (ctx.running()) return;
        const f = pickFile(IMAGES, false, status);
        if (f.length) setInit(f[0]);
    });
    el.initClear.addEventListener('click', () => { if (!ctx.running()) setInit(''); });   // clears the mask too
    el.maskPick.addEventListener('click', () => {
        if (ctx.running()) return;
        if (!init.image) { status.error('mask requires an init image — pick one first'); return; }
        const f = pickFile('Mask image|png;jpg;jpeg', false, status);
        if (f.length) setMask(f[0]);
    });
    el.maskClear.addEventListener('click', () => { if (!ctx.running()) setMask(''); });
    el.strength.addEventListener('input', () => {
        init.strength = num(parseFloat(el.strength.value), 0.8);
        el.strengthVal.textContent = init.strength.toFixed(2);
        persist();
    });
    el.vaeSample.addEventListener('change', () => { init.vaeSample = el.vaeSample.checked; persist(); });

    renderLoras();
    renderCns();
    paintInit();
    // A returning user sees their previous setup unfolded.
    if (init.image || init.mask) el.initSection.classList.remove('folded');
    if (cns.length) el.cnSection.classList.remove('folded');

    return {
        loras, controlnets: cns, init,
        /** What the worker's load needs beyond the profile spec. */
        loadSpec: () => ({ loras: loras.slice(), controlnets: cns.map((c) => ({ path: c.path })) }),
        /** The weights now carry these adapters. */
        markLoaded(numControlNets) { cnLoaded = numControlNets || 0; el.cnStale.hidden = true; },
        get cnLoaded() { return cnLoaded; },
        /** Add the per-run fields to a GenerateOptions bag. */
        applyOpts(opts) {
            if (init.image) {
                opts.initImagePath = init.image;
                opts.strength = init.strength;
                opts.vaeEncodeSample = init.vaeSample;
                if (init.mask) opts.maskImagePath = init.mask;
            }
            // Only while the registered count matches the list: otherwise prime()
            // would throw a count mismatch (the stale marker says so).
            if (cns.length && cns.length === cnLoaded) {
                opts.controls = cns.map((c) => ({ imagePath: c.image, scale: c.scale,
                                                  startStep: c.startStep, endStep: c.endStep }));
            }
            return opts;
        },
        /** Why a run cannot start, or null. */
        problem() {
            if (init.mask && !init.image) return 'mask requires an init image';
            if (cns.length !== cnLoaded) return 'ControlNet set changed — click Load weights to apply.';
            const i = cns.findIndex((c) => !c.image);
            return i >= 0 ? 'ControlNet ' + (i + 1) + ' has no control image' : null;
        },
        setBusy(on) {
            for (const b of [el.loraAdd, el.cnAdd, el.initPick, el.initClear, el.maskPick, el.maskClear,
                             el.strength, el.vaeSample]) b.disabled = !!on;
        },
        // Dialog-free equivalents of the pickers, for scripts and tests.
        addLora, addControlNet,
        setInitImage: setInit,
        setMaskImage: setMask,
        setStrength(v) { init.strength = num(v, 0.8); paintInit(); persist(); },
        setVaeSample(on) { init.vaeSample = !!on; paintInit(); persist(); },
    };
}
