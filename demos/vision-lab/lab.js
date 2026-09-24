// Vision Lab — every bro.vision model driven from one image.
//
// Left rail: the model list (weights present / loaded / failed), the selected
// model's parameters, Load, Run, and "Run all" into a contact sheet. Centre:
// the image stage, showing the input, the output, or the output over the
// input. Right rail: the result thumbnail, its metadata, SAM's masks.
// SAM gets the interactive flow: Set image (the ViT encode), click points /
// drag a box, Segment (one or three ranked masks), or Segment everything.
//
// lab/models.js is the registry; lab/stage.js draws; lab/sam.js holds SAM's
// prompt state. This file is the wiring.

import { boot } from "/lib/kit/app.js";
import { h, ids, clear } from "/lib/kit/dom.js";
import { deviceBadge, pickFile, pickFolder, imageDataFromFile, baseName } from "/lib/kit/ml.js";
import { findWeights, weightPath, missingWeights } from "/lib/kit/weights.js";
import { params as paramPanel } from "/lib/kit/params.js";
import { prefStore } from "/lib/kit/prefs.js";
import { segmented } from "/lib/kit/ui.js";
import { MODELS, ANNOTATORS, byId, defaults, fmtInt, VISION_ROOT } from "/app/lab/models.js";
import { Stage } from "/app/lab/stage.js";
import { Sam } from "/app/lab/sam.js";

const fs = require('fs');
const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };

const AMG = {
    pointsPerSide: { label: 'points / side', type: 'number', min: 4, max: 64, step: 4, default: 32 },
    predIouThresh: { label: 'pred-IoU thr', min: 0, max: 1, step: 0.01, default: 0.88 },
    stabilityThresh: { label: 'stability thr', min: 0, max: 1, step: 0.01, default: 0.95 },
    boxNmsThresh: { label: 'box NMS thr', min: 0, max: 1, step: 0.01, default: 0.7 },
    minMaskRegionArea: { label: 'min region px', type: 'number', min: 0, max: 5000, step: 50, default: 0 },
};
const MASK_COLORS = ['#4a6cf0', '#f0c64a', '#4fd06a', '#e0556a', '#a06af0', '#f08a3a', '#3ad0c0'];

/** Live app state (tests read it; module `let` exports would be snapshots). */
export const lab = {
    root: '',           // weights root
    avail: {},          // id -> weights present
    selected: 'depth',
    instances: {},      // id -> { model, params }
    errors: {},         // id -> last load error
    image: null,        // ImageData fed to the models
    imagePath: '',
    bitmap: null,       // drawable copy of the input
    result: null,       // last annotator / SAM result
    busy: false,
    runs: 0,            // finished runs (annotator / SAM op / run-all)
    contact: [],        // ids that made it onto the contact sheet
    error: '',
    ui: null,
};

export function start() {
    const { status } = boot();
    const badge = deviceBadge('#device');
    const el = ids('weights-root', 'btn-weights', 'image-sel', 'btn-image', 'image-meta', 'model-list', 'param-title',
                   'model-tagline', 'params', 'btn-load', 'load-meta', 'annot-panel', 'btn-run', 'btn-runall', 'sam-panel',
                   'btn-setimage', 'sam-multimask', 'btn-segment', 'btn-sam-clear', 'amg-params', 'btn-everything',
                   'view-mode', 'opacity-wrap', 'opacity', 'opacity-val', 'stage-label', 'view', 'out-thumb', 'out-hint',
                   'meta', 'mask-panel', 'mask-count', 'mask-list', 'contact-panel', 'contact-grid', 'vision-version');
    const prefs = prefStore('vision-lab.v2', { selected: 'depth', imagePath: 'assets/robot-arm.png', root: '' });
    const stage = Stage.create(el.view);
    const sam = Sam.create();
    let values = {};                          // the selected model's param values
    const amg = defaults({ params: AMG });

    if (bro.vision) { try { bro.vision.init(); } catch (_) { /* already */ } }
    el.visionVersion.textContent = bro.vision && bro.vision.version ? 'brovisionml ' + bro.vision.version : '';

    const view = segmented(el.viewMode, [['input', 'input'], ['output', 'output'], ['overlay', 'overlay']], {
        value: 'input', onChange: (m) => stage.setMode(m),
    });
    function setView(m) { view.value = m; stage.setMode(m); }

    const model = () => byId(lab.selected);
    const isSam = () => model().group === 'sam';

    // ── weights ──────────────────────────────────────────────────────────
    function setRoot(root) {
        lab.root = root.replace(/[\\/]+$/, '');
        el.weightsRoot.value = lab.root;
        lab.instances = {}; lab.errors = {};
        lab.avail = {};
        for (const m of MODELS) lab.avail[m.id] = exists(lab.root + '/' + m.probe);
        const n = Object.values(lab.avail).filter(Boolean).length;
        if (!n) status.error(exists(lab.root) ? 'no model weights under ' + lab.root
                                              : missingWeights('brovisionml weights', VISION_ROOT));
        buildList();
        refresh();
    }

    function buildList() {
        clear(el.modelList);
        for (const m of MODELS) {
            const cls = ['model-item', m.id === lab.selected && 'active', lab.avail[m.id] && 'avail',
                         lab.instances[m.id] && 'loaded', lab.errors[m.id] && 'failed'].filter(Boolean).join('.');
            el.modelList.appendChild(h('div.' + cls, {
                dataset: { id: m.id },
                title: lab.errors[m.id] ? 'load failed: ' + lab.errors[m.id] : lab.avail[m.id] ? 'weights present' : 'weights missing: ' + m.probe,
                onclick: () => select(m.id),
            }, h('span.dot'), h('span', null, m.label)));
        }
    }

    // ── selection + params ───────────────────────────────────────────────
    function select(id) {
        if (lab.busy || !byId(id)) return;
        lab.selected = id;
        prefs.set({ selected: id });
        const m = model();
        el.paramTitle.textContent = m.label;
        el.modelTagline.textContent = m.tagline || '';
        clear(el.params);
        values = defaults(m);
        if (Object.keys(m.params).length) {
            paramPanel(el.params, values, m.params, { onChange: (k) => onParam(m, k) });
        } else el.params.appendChild(h('p.k-note', null, 'No parameters.'));
        el.annotPanel.hidden = isSam();
        el.samPanel.hidden = !isSam();
        if (isSam()) sam.setModel(lab.instances.sam ? lab.instances.sam.model : null);
        lab.result = null;
        stage.clearVectors();
        showResult(null);
        el.maskPanel.hidden = true;
        setView('input');
        buildList();
        refresh();
    }

    // A loader param was baked in at load: changing it unloads the model.
    // A runtime one (depth invert) is read per run.
    function onParam(m, key) {
        if (m.params[key].runtime || !lab.instances[m.id]) return;
        delete lab.instances[m.id];
        if (m.id === 'sam') sam.setModel(null);
        status.warn(m.label + ': parameters changed, Load again to apply');
        buildList();
        refresh();
    }

    function refresh() {
        const m = model(), loaded = !!lab.instances[m.id], busy = lab.busy, img = !!lab.image;
        el.btnLoad.disabled = busy || !lab.avail[m.id] || loaded;
        el.btnLoad.textContent = loaded ? 'Loaded ✓' : 'Load';
        el.loadMeta.textContent = loaded ? lab.instances[m.id].model.device || '' : lab.errors[m.id] ? 'load failed' : '';
        el.btnRun.disabled = busy || !loaded || !img;
        el.btnRunall.disabled = busy || !img;
        el.btnSetimage.disabled = busy || !lab.instances.sam || !img;
        el.btnSegment.disabled = busy || !sam.isEncoded() || !sam.hasPrompts();
        el.btnSamClear.disabled = busy || !sam.hasPrompts();
        el.btnEverything.disabled = busy || !lab.instances.sam || !img;
    }

    function setBusy(on, label) {
        lab.busy = on;
        el.stageLabel.textContent = label || 'idle';
        refresh();
    }

    // ── image ────────────────────────────────────────────────────────────
    function openImage(path) {
        let img;
        try { img = imageDataFromFile(path); } catch (e) { status.error('image load failed: ' + e.message); return false; }
        lab.image = img;
        lab.imagePath = path;
        prefs.set({ imagePath: path });
        el.imageMeta.textContent = baseName(path) + ' · ' + img.width + '×' + img.height;
        sam.cancelEncode();
        sam.setModel(lab.instances.sam ? lab.instances.sam.model : null);
        stage.clearVectors();
        lab.result = null;
        showResult(null);
        setView('input');
        createImageBitmap(img).then((bmp) => {
            if (lab.bitmap && lab.bitmap.close) lab.bitmap.close();
            lab.bitmap = bmp;
            stage.setInput(bmp);
        });
        refresh();
        return true;
    }

    // ── load (synchronous: bro.vision loaders take no callbacks) ─────────
    function loadModel(m, p) {
        try {
            const inst = m.load(lab.root, p);
            if (!inst) throw new Error('loader returned nothing');
            lab.instances[m.id] = { model: inst, params: p };
            delete lab.errors[m.id];
            if (inst.device) badge.set(String(inst.device));
            return inst;
        } catch (e) {
            lab.errors[m.id] = String((e && e.message) || e);
            return null;
        }
    }

    function load() {
        const m = model();
        if (lab.busy || !lab.avail[m.id]) return;
        setBusy(true, 'loading ' + m.id + '…');
        status.busy('loading ' + m.label + '…');
        setTimeout(() => {                     // let the status paint before the blocking load
            const inst = loadModel(m, Object.assign({}, values));
            setBusy(false);
            buildList();
            if (!inst) { lab.error = m.label + ' load failed: ' + lab.errors[m.id]; status.error(lab.error); return; }
            if (m.id === 'sam') sam.setModel(inst);
            status.ok(m.label + ' ready on ' + inst.device);
            refresh();
        }, 30);
    }

    // ── annotators ───────────────────────────────────────────────────────
    function run() {
        const m = model(), inst = lab.instances[m.id];
        if (lab.busy || !inst || !lab.image) return;
        setBusy(true, 'running ' + m.id + '…');
        status.busy('running ' + m.label + '…');
        const t0 = Date.now();
        try {
            m.run(inst.model, lab.image, values, (r, info) => {
                setBusy(false);
                lab.runs++;
                if (info && info.error) { lab.error = 'run failed: ' + info.error; status.error(lab.error); return; }
                if (info && info.cancelled) { status.warn('cancelled'); return; }
                lab.result = r;
                stage.setResult(r.image);
                setView('overlay');
                if (m.vectors === 'mlsd') stage.setVectors({ kind: 'mlsd', segments: r.segments });
                else if (m.vectors === 'pose') stage.setVectors({ kind: 'pose', bodies: r.bodies });
                else stage.clearVectors();
                showResult(r.image, m.metadata(r).concat([['time', (Date.now() - t0) + ' ms']]));
                status.ok(m.label + ' done');
            });
        } catch (e) { setBusy(false); lab.runs++; lab.error = 'run failed: ' + e.message; status.error(lab.error); }
    }

    function showResult(bmp, rows) {
        clear(el.meta);
        el.outThumb.hidden = !bmp;
        el.outHint.hidden = !!bmp;
        el.opacityWrap.hidden = !bmp;
        if (!bmp) return;
        el.outThumb.width = bmp.width; el.outThumb.height = bmp.height;
        el.outThumb.getContext('2d').drawImage(bmp, 0, 0);
        for (const [k, v] of rows || []) el.meta.appendChild(h('div', null, h('span', null, k), h('b', null, String(v))));
    }

    // Load (with defaults) and run every available annotator in turn.
    function runAll() {
        if (lab.busy || !lab.image) return;
        clear(el.contactGrid);
        el.contactPanel.hidden = false;
        lab.contact = [];
        const queue = ANNOTATORS.filter((m) => lab.avail[m.id]);
        let i = 0, failed = 0;
        setBusy(true, 'contact sheet…');
        const next = () => {
            if (i >= queue.length) {
                setBusy(false);
                lab.runs++;
                buildList();
                const msg = 'contact sheet: ' + lab.contact.length + ' of ' + queue.length + ' annotators' +
                            (failed ? ' (' + failed + ' failed to load, see the model list)' : '');
                if (failed) status.warn(msg); else status.ok(msg);
                return;
            }
            const m = queue[i++];
            status.busy('contact sheet: ' + m.label + ' (' + i + '/' + queue.length + ')…');
            setTimeout(() => {
                const p = defaults(m);
                const inst = lab.instances[m.id] ? lab.instances[m.id].model : loadModel(m, p);
                if (!inst) { failed++; next(); return; }
                try {
                    m.run(inst, lab.image, p, (r, info) => {
                        if (r && r.image && !(info && info.error)) addCell(m, r.image);
                        next();
                    });
                } catch (e) { next(); }
            }, 10);
        };
        next();
    }

    function addCell(m, bmp) {
        const c = h('canvas');
        c.width = 240; c.height = Math.round(240 * bmp.height / bmp.width);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        el.contactGrid.appendChild(h('div.contact-cell', { dataset: { id: m.id }, title: m.label, onclick: () => select(m.id) },
                                     c, h('div', null, m.label)));
        lab.contact.push(m.id);
    }

    // ── SAM ──────────────────────────────────────────────────────────────
    function samSetImage() {
        if (lab.busy || !lab.image) return;
        setBusy(true, 'encoding…');
        status.busy('SAM: encoding the image (ViT pass)…');
        setView('input');
        sam.setImage(lab.image, (err) => {
            setBusy(false);
            lab.runs++;
            if (err) { lab.error = 'SAM encode failed: ' + err.message; status.error(lab.error); return; }
            status.ok('SAM ready: click to add prompts');
            refresh();
        });
    }

    const samVectors = () => { const p = sam.prompts(); stage.setVectors({ kind: 'sam', points: p.points, labels: p.labels, box: p.box }); };

    function samSegment() {
        if (lab.busy) return;
        try {
            const seg = sam.segment(el.samMultimask.checked);
            lab.result = seg;
            lab.runs++;
            showMasks(seg);
            status.ok('SAM: ' + seg.num + ' mask(s), best IoU ' + seg.masks[seg.best].iou.toFixed(3));
        } catch (e) { lab.error = 'segment failed: ' + e.message; status.error(lab.error); }
    }

    function showMasks(seg) {
        el.maskPanel.hidden = false;
        el.maskCount.textContent = '(' + seg.num + ')';
        clear(el.maskList);
        const pick = (i) => {
            stage.setResult(seg.masks[i].image);
            setView('overlay');
            showResult(seg.masks[i].image, [['mask', (i + 1) + ' / ' + seg.num], ['IoU', seg.masks[i].iou.toFixed(4)],
                                            ['best', i === seg.best ? 'yes' : 'no']]);
            [...el.maskList.children].forEach((ch, j) => ch.classList.toggle('active', j === i));
        };
        seg.masks.forEach((mk, i) => el.maskList.appendChild(h('div.mask-row', { onclick: () => pick(i) },
            h('span.swatch', { style: { background: MASK_COLORS[i % MASK_COLORS.length] } }),
            h('span', null, 'IoU ' + mk.iou.toFixed(3)), i === seg.best ? h('span.best', null, 'BEST') : null)));
        pick(seg.best);
    }

    function samEverything() {
        if (lab.busy || !lab.image) return;
        setBusy(true, 'segment everything…');
        status.busy('SAM: segment everything…');
        sam.segmentEverything(lab.image, amg, (err, r) => {
            setBusy(false);
            lab.runs++;
            if (err) { lab.error = 'segment everything failed: ' + err.message; status.error(lab.error); return; }
            lab.result = r;
            // Composite every translucent mask overlay into one bitmap for the stage.
            const c = h('canvas'); c.width = r.width; c.height = r.height;
            const cx = c.getContext('2d');
            for (const mk of r.masks) cx.drawImage(mk.image, 0, 0);
            createImageBitmap(cx.getImageData(0, 0, c.width, c.height)).then((bmp) => {
                stage.setResult(bmp); setView('overlay');
                showResult(bmp, [['masks', fmtInt(r.masks.length)],
                                 ['largest area', r.masks.length ? fmtInt(r.masks[0].area) + ' px' : '—'],
                                 ['map size', r.width + '×' + r.height]]);
            });
            el.maskPanel.hidden = true;
            status.ok('SAM: ' + r.masks.length + ' masks');
        });
    }

    // Stage input: click = point (Shift = background), drag = box.
    let drag = null;
    el.view.addEventListener('mousedown', (e) => {
        if (!isSam() || !sam.isEncoded() || lab.busy) return;
        const p = stage.toImage(e.offsetX, e.offsetY);
        if (p) drag = { x: p.x, y: p.y, sx: e.offsetX, sy: e.offsetY, moved: false };
    });
    el.view.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const p = stage.toImage(e.offsetX, e.offsetY);
        if (!p) return;
        if (Math.abs(e.offsetX - drag.sx) + Math.abs(e.offsetY - drag.sy) > 4) drag.moved = true;
        if (drag.moved) { const pr = sam.prompts(); stage.setVectors({ kind: 'sam', points: pr.points, labels: pr.labels, box: [drag.x, drag.y, p.x, p.y] }); }
    });
    el.view.addEventListener('mouseup', (e) => {
        if (!drag) return;
        const p = stage.toImage(e.offsetX, e.offsetY) || drag;
        if (drag.moved) sam.setBox(drag.x, drag.y, p.x, p.y);
        else sam.addPoint(p.x, p.y, !e.shiftKey);
        drag = null;
        samVectors();
        refresh();
    });

    // ── wiring ───────────────────────────────────────────────────────────
    el.btnLoad.onclick = load;
    el.btnRun.onclick = run;
    el.btnRunall.onclick = runAll;
    el.btnSetimage.onclick = samSetImage;
    el.btnSegment.onclick = samSegment;
    el.btnSamClear.onclick = () => { sam.clearPrompts(); samVectors(); el.maskPanel.hidden = true; refresh(); };
    el.btnEverything.onclick = samEverything;
    el.imageSel.addEventListener('change', () => openImage(el.imageSel.value));
    el.btnImage.onclick = () => { const p = pickFile('Image|png;jpg;jpeg;webp;bmp'); if (p) openImage(p); };
    el.btnWeights.onclick = () => { const d = pickFolder(lab.root); if (d) { prefs.set({ root: d }); setRoot(d); } };
    el.weightsRoot.addEventListener('keydown', (e) => { if (e.key === 'Enter') { prefs.set({ root: el.weightsRoot.value.trim() }); setRoot(el.weightsRoot.value.trim()); } });
    el.opacity.addEventListener('input', () => { stage.setOpacity(+el.opacity.value / 100); el.opacityVal.textContent = el.opacity.value + '%'; });
    window.addEventListener('resize', () => stage.redraw());
    paramPanel(el.amgParams, amg, AMG);

    // ── boot ─────────────────────────────────────────────────────────────
    lab.ui = { status, badge, stage, sam, prefs, select, load, run, runAll, openImage, setRoot, view };
    setRoot(prefs.data.root || findWeights(VISION_ROOT, { probe: 'sam-vit-base' }) ||
            findWeights(VISION_ROOT) || weightPath(VISION_ROOT[0]));
    select(byId(prefs.data.selected) ? prefs.data.selected : 'depth');
    if (!openImage(prefs.data.imagePath)) openImage('assets/robot-arm.png');
    if ([...el.imageSel.options].some((o) => o.value === lab.imagePath)) el.imageSel.value = lab.imagePath;
    if (!status.el.classList.contains('err')) status.set('Pick a model and Load');
}
