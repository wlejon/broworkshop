// lib/kit/imagegen.js — the page half of the bro.diffusion labs
// (demos/diffusion-lab, demos/sana-lab, demos/pixart-lab).
//
// The worker half is imagegen-worker.js; the transport is worker-rpc.js.
// Each piece builds its own markup into a host element (kit.css classes) and
// returns a handle:
//
//   modelPicker(host, opts)     weights dir field + browse + Load button
//   backendBadge(el)            CUDA / CPU badge
//   genPanel(host, opts)        prompt + negative + settings grid + Generate / Cancel
//   runBar(host)                progress bar + step label
//   runGeneration(rpc, opts)    prime + one step per request, with cancel
//   imageView(canvas)           contain-fit ImageBitmap view with an overlay layer
//   imageStrip(host, opts)      gallery of finished images (click to view, save PNG)
//   wordAxes(host, opts)        conditioning-space axes from two word sets
//
// See demos/pixart-lab for the smallest complete lab.

import { h, clear } from "./dom.js";
import { progressBar } from "./ui.js";
import { findWeights, weightPath } from "./weights.js";

const node = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
const baseName = (p) => { const s = String(p).split(/[\\/]/); return s[s.length - 1] || p; };

// ---- model -------------------------------------------------------------------

/**
 * A weights directory picker. opts:
 *   label        field caption ('Sana directory')
 *   candidates   repo-relative weight dirs (weights.js); the first found is the default
 *   probe        file that marks a valid dir (default 'model_index.json')
 *   value        a saved path, preferred over the candidates
 *   buttonText   default 'Load model'
 *   onLoad(dir)  Load clicked (or Enter in the field)
 *   onPick(dir)  a folder chosen with the browse button or typed (change)
 * Handle: path (get/set), input, button, setBusy(b).
 */
export function modelPicker(host, opts) {
    const o = opts || {};
    const found = o.candidates ? findWeights(o.candidates, { probe: o.probe || 'model_index.json' }) : null;
    const input = h('input.k-grow', { type: 'text',
        value: o.value || found || (o.candidates ? weightPath(o.candidates[0]) : '') });
    const browse = h('button.small', { title: 'Choose a model directory', text: 'Browse…' });
    const button = h('button.primary', { text: o.buttonText || 'Load model' });
    node(host).appendChild(h('div.k-col', null,
        h('span.k-cap', null, o.label || 'model directory'),
        h('div.k-row.k-nowrap', null, input, browse),
        button));
    const path = () => input.value.trim();
    browse.addEventListener('click', () => {
        if (typeof showOpenFolderDialog !== 'function') return;
        const dirs = showOpenFolderDialog(path() || null);
        const dir = Array.isArray(dirs) ? dirs[0] : dirs;
        if (!dir) return;
        input.value = dir;
        if (o.onPick) o.onPick(dir);
    });
    input.addEventListener('change', () => { if (o.onPick) o.onPick(path()); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && o.onLoad) o.onLoad(path()); });
    button.addEventListener('click', () => { if (o.onLoad) o.onLoad(path()); });
    return {
        get path() { return path(); },
        set path(v) { input.value = v || ''; },
        input, button, browse,
        setBusy(b) { button.disabled = !!b; browse.disabled = !!b; },
    };
}

/** A .k-badge showing the compute backend. set('cuda'|'cpu'|text, kind?) */
export function backendBadge(target) {
    const el = node(target);
    el.classList.add('k-badge');
    const api = {
        set(text, kind) {
            const t = String(text || '');
            const cpu = /^cpu$/i.test(t);
            el.textContent = cpu ? 'CPU' : t.toUpperCase();
            el.classList.remove('ok', 'warn', 'err');
            const k = kind || (cpu ? 'warn' : t ? 'ok' : '');
            if (k) el.classList.add(k);
            return api;
        },
        el,
    };
    return api;
}

// ---- prompt + settings -------------------------------------------------------

/**
 * Prompt + negative prompt + a settings grid + the Generate / Cancel row.
 * opts:
 *   prompt       initial prompt text          placeholder   prompt placeholder
 *   negative     negative placeholder, or false to omit the field
 *   maxChars     counter cap (default 1000)
 *   fields       [{ key, label, def, min, max, step, options: [values|[v, label]],
 *                   fmt(v), random: true (adds a dice button), snap: n }]
 *                keys the opts() mapping knows: seed steps guidance size width height
 *   extra        nodes appended after the Generate / Cancel buttons (a "live" toggle)
 *   onSubmit()   Generate clicked / Ctrl+Enter in a prompt
 *   onCancel()   Cancel clicked
 *   onChange(key)  any field edited ('prompt', 'negative' or a field key)
 * Handle: prompt / negative (get/set), get(key), set(key, v), values(),
 * opts() -> GenerateOptions, reset(), lock(key, note|false), state(),
 * restore(state), setRunning(on), setEnabled(on), generate, cancel, el.
 */
export function genPanel(host, opts) {
    const o = opts || {};
    const max = o.maxChars || 1000;
    const onChange = (k) => { if (o.onChange) o.onChange(k); };

    const counter = (ta) => {
        const c = h('span.k-counter');
        const upd = () => { c.textContent = ta.value.length + ' / ' + max; c.classList.toggle('warn', ta.value.length >= max); };
        ta.addEventListener('input', upd);
        upd();
        return { el: c, upd };
    };
    const area = (value, placeholder, rows) => h('textarea', { rows, maxLength: max, placeholder: placeholder || '', value: value || '' });

    const promptEl = area(o.prompt, o.placeholder, 4);
    const pc = counter(promptEl);
    const parts = [h('label.k-stack', null, h('span.k-cap', null, 'prompt', pc.el), promptEl)];
    let negEl = null, nc = null;
    if (o.negative !== false) {
        negEl = area('', typeof o.negative === 'string' ? o.negative : 'blurry, low quality', 2);
        nc = counter(negEl);
        parts.push(h('label.k-stack', null,
            h('span.k-cap', null, 'negative prompt', h('span.dim', null, ' what to avoid'), nc.el), negEl));
    }

    const fields = {};
    const grid = h('div.k-grid2');
    for (const f of o.fields || []) {
        let input;
        if (f.options) {
            input = h('select', null, f.options.map((x) => {
                const [v, label] = Array.isArray(x) ? x : [x, f.fmt ? f.fmt(x) : String(x)];
                return h('option', { value: String(v) }, label);
            }));
        } else {
            input = h('input', { type: 'number', step: f.step != null ? String(f.step) : '1' });
            if (f.min != null) input.min = String(f.min);
            if (f.max != null) input.max = String(f.max);
        }
        input.value = String(f.def);
        input.addEventListener('change', () => onChange(f.key));
        const note = h('span.k-lock', { hidden: true });
        const control = f.random
            ? h('div.k-row.k-nowrap', null, input, h('button.small', {
                title: 'random seed', text: '⤮',
                onclick: () => { input.value = String(Math.floor(Math.random() * 1e9)); onChange(f.key); },
            }))
            : input;
        grid.appendChild(h('label.k-stack', { dataset: { field: f.key } },
            h('span.k-cap', null, f.label || f.key,
              h('span.dim', null, ' · def ' + (f.fmt ? f.fmt(f.def) : f.def)), note),
            control));
        fields[f.key] = { spec: f, input, note };
    }
    const reset = h('button.k-link', { title: 'restore the settings to their defaults', text: 'reset' });
    parts.push(h('div.k-cap.k-sub-head', null, 'settings', reset), grid);

    const generate = h('button.primary.k-grow', { text: 'Generate', disabled: true });
    const cancel = h('button', { text: 'Cancel', disabled: true });
    parts.push(h('div.k-row.k-nowrap', null, generate, cancel, o.extra || null));
    const el = h('div.k-col.k-gen', null, parts);
    node(host).appendChild(el);

    const submitKey = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!generate.disabled && o.onSubmit) o.onSubmit(); }
    };
    promptEl.addEventListener('keydown', submitKey);
    promptEl.addEventListener('change', () => onChange('prompt'));
    if (negEl) { negEl.addEventListener('keydown', submitKey); negEl.addEventListener('change', () => onChange('negative')); }
    generate.addEventListener('click', () => { if (o.onSubmit) o.onSubmit(); });
    cancel.addEventListener('click', () => { if (o.onCancel) o.onCancel(); });

    const num = (k) => {
        const f = fields[k];
        if (!f) return undefined;
        let v = parseFloat(f.input.value);
        if (!isFinite(v)) v = f.spec.def;
        if (f.spec.snap) v = Math.max(f.spec.snap, Math.round(v / f.spec.snap) * f.spec.snap);
        if (f.spec.min != null) v = Math.max(f.spec.min, v);
        if (f.spec.max != null) v = Math.min(f.spec.max, v);
        return v;
    };
    const api = {
        el, generate, cancel,
        promptEl, negativeEl: negEl,
        get prompt() { return promptEl.value; },
        set prompt(v) { promptEl.value = v || ''; pc.upd(); },
        get negative() { return negEl ? negEl.value : ''; },
        set negative(v) { if (negEl) { negEl.value = v || ''; nc.upd(); } },
        get: num,
        set(k, v) { if (fields[k]) fields[k].input.value = String(v); },
        values() { const out = {}; for (const k in fields) out[k] = num(k); return out; },
        /** The GenerateOptions bag: width/height from size or width+height. */
        opts() {
            const v = api.values();
            const out = {
                width: v.width != null ? v.width : v.size,
                height: v.height != null ? v.height : v.size,
                steps: Math.max(1, Math.round(v.steps)),
                guidanceScale: v.guidance,
                seed: Math.max(0, Math.round(v.seed || 0)),
            };
            if (negEl) out.negativePrompt = negEl.value.trim();
            return out;
        },
        reset() {
            for (const k in fields) if (!fields[k].input.disabled) fields[k].input.value = String(fields[k].spec.def);
            onChange('reset');
        },
        /** Disable a field and show a note beside its label (false unlocks). */
        lock(k, note) {
            const f = fields[k];
            if (!f) return;
            f.input.disabled = !!note;
            f.note.hidden = !note;
            f.note.textContent = note || '';
        },
        /** Plain object of the prompt, negative and field values, for prefs. */
        state() {
            const s = { prompt: promptEl.value, negative: negEl ? negEl.value : '' };
            for (const k in fields) s[k] = fields[k].input.value;
            return s;
        },
        restore(s) {
            if (!s) return;
            if (s.prompt != null) api.prompt = s.prompt;
            if (s.negative != null) api.negative = s.negative;
            for (const k in fields) if (s[k] != null && s[k] !== '') fields[k].input.value = String(s[k]);
        },
        /** Busy: Generate off, Cancel on (or back). */
        setRunning(on) { generate.disabled = !!on || !api.enabled; cancel.disabled = !on; },
        enabled: false,
        setEnabled(on) { api.enabled = !!on; generate.disabled = !on; },
    };
    reset.addEventListener('click', () => api.reset());
    return api;
}

// ---- progress + the step loop ------------------------------------------------

/** A progress bar + label row. Handle: step(i, n), set(fraction, text), idle(text). */
export function runBar(host) {
    const bar = h('div.k-progress');
    const label = h('span.k-steplabel.dim', null, 'idle');
    node(host).appendChild(h('div.k-row.k-nowrap.k-run', null, bar, label));
    const p = progressBar(bar);
    return {
        step(i, n, suffix) { p.set(n ? i / n : 0); label.textContent = 'step ' + i + ' / ' + n + (suffix || ''); },
        set(f, text) { p.set(f); if (text != null) label.textContent = text; },
        idle(text) { p.set(0); label.textContent = text || 'idle'; },
        get text() { return label.textContent; },
        label, bar,
    };
}

/**
 * Run one generation step-wise through a worker speaking the
 * imagegen-worker.js protocol. opts:
 *   prompt, opts                  the prompt + GenerateOptions
 *   controls, identityWeight      forwarded to prime (word axes, Sana anchor)
 *   decode(stepIndex)             true to decode a preview after that step
 *                                 (the last step always decodes); default never
 *   ctrl(stepIndex)               -> { ctrl, transfer } for PipelineState.stepOnce
 *   onPrimed(info), onStep(msg)   progress callbacks
 * Returns { promise, cancel(), cancelled }. The promise resolves with
 * { final: <last stepped msg>, ms } or { cancelled: true }, and rejects on a
 * worker error. cancel() stops asking for steps, resets the worker's state
 * and drops any reply still in flight.
 */
export function runGeneration(rpc, opts) {
    const o = opts || {};
    let cancelled = false;
    const t0 = Date.now();
    const promise = (async () => {
        const primed = await rpc.request({ type: 'prime', prompt: o.prompt, opts: o.opts,
                                           controls: o.controls, identityWeight: o.identityWeight });
        if (o.onPrimed) o.onPrimed(primed);
        for (let i = 0; ; i++) {
            const c = o.ctrl ? o.ctrl(i) : null;
            const msg = await rpc.request({ type: 'step', ctrl: c ? c.ctrl : undefined,
                                            decode: o.decode ? !!o.decode(i) : false },
                                          c ? c.transfer : undefined);
            if (o.onStep) o.onStep(msg);
            if (msg.done) return { final: msg, ms: Date.now() - t0 };
        }
    })().catch((e) => {
        if (cancelled || (e && e.abandoned)) return { cancelled: true };
        throw e;
    });
    return {
        promise,
        get cancelled() { return cancelled; },
        cancel() {
            if (cancelled) return;
            cancelled = true;
            rpc.abandon();
            rpc.post({ type: 'reset' });
        },
    };
}

// ---- viewing -----------------------------------------------------------------

/**
 * Draw an image (ImageBitmap or canvas) contain-fit into a canvas whose
 * drawing buffer tracks its CSS box (put it in a .k-viewport), with an
 * optional overlay image drawn over the same rect. The view borrows images;
 * whoever made them closes them. opts: { background, hint (element shown
 * while empty) }.
 * Handle: setImage(img), setOverlay(img|null, opacity?), setOpacity(a),
 * clear(), redraw(), hasImage(), image, rect().
 */
export function imageView(target, opts) {
    const canvas = node(target);
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const hint = o.hint ? node(o.hint) : null;
    let image = null, overlay = null, opacity = 0.7;

    const syncSize = () => {
        const w = Math.max(1, Math.round(canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 512));
        const hh = Math.max(1, Math.round(canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 512));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== hh) canvas.height = hh;
    };
    const rect = () => {
        if (!image) return null;
        const cw = canvas.width, ch = canvas.height;
        const s = Math.min(cw / image.width, ch / image.height);
        const dw = image.width * s, dh = image.height * s;
        return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
    };
    const redraw = () => {
        syncSize();
        ctx.fillStyle = o.background || '#07090d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (hint) hint.hidden = !!image;
        if (!image) return;
        const r = rect();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(image, r.x, r.y, r.w, r.h);
        if (overlay) {
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.drawImage(overlay, r.x, r.y, r.w, r.h);
            ctx.restore();
        }
    };
    // Track the box: the panels around a viewport grow (a gallery fills in).
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => redraw()).observe(canvas);
    else window.addEventListener('resize', redraw);
    redraw();
    return {
        canvas,
        setImage(img) { image = img || null; redraw(); },
        setOverlay(img, a) { overlay = img || null; if (a != null) opacity = a; redraw(); },
        setOpacity(a) { opacity = a; redraw(); },
        clear() { image = null; overlay = null; redraw(); },
        redraw,
        hasImage: () => !!image,
        get image() { return image; },
        get overlay() { return overlay; },
        rect,
    };
}

/** RGBA pixels of an ImageBitmap / canvas (via a scratch canvas). */
export function imagePixels(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height);
}

/**
 * A gallery row of finished images, newest first. The strip OWNS the
 * bitmaps added to it (closes them when they fall off the end or on
 * clear()). opts: { max = 16, onSelect(entry), save = true (a "save PNG"
 * button for the selected image), empty: hint text }.
 * An entry is { bitmap, width, height, meta, el }; meta.title is the tooltip.
 * Handle: add(bitmap, meta) -> entry, select(entry|index), selected,
 * entries, clear(), save(entry, path).
 */
export function imageStrip(host, opts) {
    const o = Object.assign({ max: 16, save: true, empty: 'finished images collect here' }, opts);
    const row = h('div.k-gallery');
    const hintEl = h('span.dim.k-gallery-empty', null, o.empty);
    const saveBtn = o.save ? h('button.small', { text: 'Save PNG…', disabled: true, title: 'save the selected image' }) : null;
    const count = h('span.dim');
    node(host).appendChild(h('div.k-col.k-gallery-box', null,
        h('div.k-row.k-nowrap', null, h('span.k-cap', null, 'gallery'), count, h('span.k-spacer'), saveBtn),
        row, hintEl));
    const entries = [];
    let selected = null;

    const paint = () => {
        count.textContent = entries.length ? entries.length + '' : '';
        hintEl.hidden = entries.length > 0;
        if (saveBtn) saveBtn.disabled = !selected;
        for (const e of entries) e.el.classList.toggle('active', e === selected);
    };
    const api = {
        el: row,
        entries,
        get selected() { return selected; },
        add(bitmap, meta) {
            const thumb = h('canvas');
            const th = 72;
            thumb.height = th;
            thumb.width = Math.max(1, Math.round(th * bitmap.width / bitmap.height));
            thumb.getContext('2d').drawImage(bitmap, 0, 0, thumb.width, thumb.height);
            const m = meta || {};
            const entry = { bitmap, width: bitmap.width, height: bitmap.height, meta: m, el: null };
            entry.el = h('div.k-thumb', { title: m.title || '', onclick: () => api.select(entry) }, thumb,
                m.label ? h('span', null, m.label) : null);
            entries.unshift(entry);
            row.insertBefore(entry.el, row.firstChild);
            while (entries.length > o.max) {
                const gone = entries.pop();
                gone.el.remove();
                if (gone === selected) selected = null;
                try { gone.bitmap.close(); } catch (_) {}
            }
            selected = entry;
            paint();
            return entry;
        },
        select(e) {
            const entry = typeof e === 'number' ? entries[e] : e;
            if (!entry) return;
            selected = entry;
            paint();
            if (o.onSelect) o.onSelect(entry);
        },
        clear() {
            for (const e of entries) { try { e.bitmap.close(); } catch (_) {} }
            entries.length = 0;
            selected = null;
            clear(row);
            paint();
        },
        /** Write an entry as PNG (asks for a path when none is given). Returns the path or null. */
        save(entry, path) {
            const e = entry || selected;
            if (!e) return null;
            let p = path;
            if (!p) {
                if (typeof showSaveFileDialog !== 'function') return null;
                p = showSaveFileDialog('PNG image|png', (e.meta.file || 'image') + '.png');
                if (!p) return null;
            }
            const px = imagePixels(e.bitmap);
            bro.image.encodePngFile(p, px.data, px.width, px.height, 4);
            return p;
        },
    };
    if (saveBtn) saveBtn.addEventListener('click', () => api.save());
    paint();
    return api;
}

// ---- word axes ---------------------------------------------------------------

const splitPhrases = (text) => String(text || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Conditioning-space control axes built live from two word sets: a "from"
 * set A and a "to" set B. The worker (imagegen-worker.js `search`) encodes
 * the phrases, takes the diff of means and registers a named axis; each axis
 * gets a strength slider (the injection norm, A below 0, B above). opts:
 *   rpc                       the worker client
 *   range                     { min, max, step } of the strength sliders
 *   placeholders              { name, from, to }
 *   ready()                   may an axis be built now (model loaded, idle)?
 *   setBusy(on)               bracket a build
 *   status                    a kit statusLine
 *   onInput(), onCommit()     a slider moved / was released (live preview hooks)
 *   onChange()                the axis set or a strength changed (persist)
 * Handle: controls() -> { workerName: alpha } of nonzero axes, serialize(),
 * restore(defs) -> Promise, setLoaded(b), reset(), zero(), count, build().
 */
export function wordAxes(host, opts) {
    const o = opts || {};
    const rg = Object.assign({ min: -25, max: 25, step: 0.5 }, o.range);
    const ph = Object.assign({ name: 'expression', from: 'neutral expression, calm face', to: 'a big joyful smile' }, o.placeholders);
    const nameIn = h('input', { type: 'text', placeholder: ph.name });
    const negIn = h('textarea', { rows: 2, placeholder: ph.from });
    const posIn = h('textarea', { rows: 2, placeholder: ph.to });
    const buildBtn = h('button', { text: 'Add axis', disabled: true });
    const hint = h('p.k-note');
    const list = h('div.k-col.k-axes');
    node(host).appendChild(h('div.k-col', null,
        h('label.k-stack', null, h('span.k-cap', null, 'name', h('span.dim', null, ' (optional)')), nameIn),
        h('label.k-stack', null, h('span.k-cap', null, 'set A · the "from" concept'), negIn),
        h('label.k-stack', null, h('span.k-cap', null, 'set B · the "to" concept'), posIn),
        buildBtn, hint, list));

    const axes = [];     // { wname, name, neg, pos, sep, range, card }
    let seq = 0, loaded = false;
    const changed = () => { if (o.onChange) o.onChange(); };
    const refreshHint = () => {
        hint.textContent = axes.length ? 'strength = injection norm · A below 0 / B above · 0 = no change'
            : loaded ? 'Add an axis from two word sets (e.g. young / old).'
            : 'Load a model, then add an axis from two word sets.';
    };

    function addCard(def) {
        const range = h('input', { type: 'range', min: String(rg.min), max: String(rg.max), step: String(rg.step) });
        range.value = String(def.strength || 0);
        const val = h('span.k-val', { title: 'double-click to zero' });
        const paintVal = () => {
            const v = +range.value;
            val.textContent = (v > 0 ? '+' : '') + v;
            val.classList.toggle('dim', v === 0);
        };
        const del = h('button.k-link', { text: 'remove', title: 'remove this axis' });
        const card = h('div.k-axis', null,
            h('div.k-row.k-nowrap', null,
                h('span.k-grow.k-axis-name', { title: 'A: ' + def.neg.join(', ') + '  /  B: ' + def.pos.join(', ') +
                                                        '  · separation ' + def.sep.toFixed(2) }, def.name),
                del),
            h('div.k-row.k-nowrap', null, range, val));
        const rec = { wname: def.wname, name: def.name, neg: def.neg, pos: def.pos, sep: def.sep, range, card };
        range.addEventListener('input', () => { paintVal(); changed(); if (o.onInput) o.onInput(); });
        range.addEventListener('change', () => { if (o.onCommit) o.onCommit(); });
        val.addEventListener('dblclick', () => { range.value = '0'; paintVal(); changed(); if (o.onCommit) o.onCommit(); });
        del.addEventListener('click', () => {
            o.rpc.request({ type: 'remove', name: rec.wname }).catch(() => {});
            axes.splice(axes.indexOf(rec), 1);
            card.remove();
            refreshHint();
            changed();
        });
        paintVal();
        list.appendChild(card);
        axes.push(rec);
        refreshHint();
        return rec;
    }

    async function register(neg, pos, name, strength) {
        const wname = 'ax' + (seq++);
        const msg = await o.rpc.request({ type: 'search', neg, pos, name: wname });
        return addCard({ wname, name: name || (neg[0] + ' → ' + pos[0]), neg, pos, sep: msg.sep, strength });
    }

    async function build() {
        if (o.ready && !o.ready()) return null;
        const neg = splitPhrases(negIn.value), pos = splitPhrases(posIn.value);
        if (!neg.length || !pos.length) { if (o.status) o.status.error('enter at least one word in each set'); return null; }
        const name = nameIn.value.trim();
        if (o.setBusy) o.setBusy(true);
        if (o.status) o.status.busy('building axis — encoding ' + (neg.length + pos.length) + ' phrases…');
        try {
            const rec = await register(neg, pos, name, 0);
            nameIn.value = ''; negIn.value = ''; posIn.value = '';
            if (o.status) o.status.ok('axis "' + rec.name + '" added · separation ' + rec.sep.toFixed(2));
            changed();
            return rec;
        } catch (e) {
            if (o.status) o.status.error(e);
            return null;
        } finally {
            if (o.setBusy) o.setBusy(false);
        }
    }
    buildBtn.addEventListener('click', build);
    refreshHint();

    return {
        get count() { return axes.length; },
        axes,
        build,
        buildButton: buildBtn,
        inputs: { name: nameIn, from: negIn, to: posIn },
        controls() {
            const out = {};
            for (const a of axes) { const v = +a.range.value; if (v) out[a.wname] = v; }
            return out;
        },
        serialize() {
            return axes.map((a) => ({ name: a.name, neg: a.neg, pos: a.pos, sep: a.sep, strength: +a.range.value }));
        },
        /** Re-register saved axes against a freshly loaded pipeline, one at a time. */
        async restore(defs) {
            for (const d of Array.isArray(defs) ? defs : []) {
                if (!d || !d.neg || !d.pos) continue;
                try { await register(d.neg, d.pos, d.name, +d.strength || 0); } catch (_) { /* skip a bad def */ }
            }
            changed();
        },
        setLoaded(b) { loaded = !!b; buildBtn.disabled = !loaded; refreshHint(); },
        setEnabled(b) { buildBtn.disabled = !b || !loaded; },
        /** Drop every card (a reload starts the worker's axis set clean). */
        reset() { for (const a of axes) a.card.remove(); axes.length = 0; refreshHint(); },
        /** Zero every strength. */
        zero() {
            for (const a of axes) { a.range.value = '0'; a.range.dispatchEvent(new Event('input')); }
            changed();
        },
    };
}

export { baseName };
