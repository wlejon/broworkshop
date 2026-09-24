// lib/kit/ui.js — small stateful widgets over kit.css markup.
//
// Each takes an existing element (a selector or node) so the page stays
// static HTML, and returns a handle. None of them owns layout.
//
//   import { statusLine, logView, stats, fpsMeter } from "/lib/kit/ui.js";
//   const status = statusLine('#status');
//   status.busy('loading…'); status.ok('ready'); status.error(e);

import { $ as el, h, clear, clock } from "./dom.js";

/**
 * Status text with a severity class (ok | warn | err | busy).
 * Handle: set(text, kind?), ok(text), warn(text), error(errOrText), busy(text),
 * text (getter).
 */
export function statusLine(target) {
    const node = el(target);
    const set = (text, kind) => {
        node.textContent = text;
        node.className = kind === 'err' || kind === 'ok' || kind === 'warn' ? kind
                       : kind === 'busy' ? 'dim' : '';
        return api;
    };
    const api = {
        set,
        ok:    (t) => set(t, 'ok'),
        warn:  (t) => set(t, 'warn'),
        busy:  (t) => set(t, 'busy'),
        error: (e) => set(typeof e === 'string' ? e : String((e && e.message) || e), 'err'),
        get text() { return node.textContent; },
        el: node,
    };
    return api;
}

/** A .k-progress bar. Handle: set(fraction 0..1). Builds the fill if absent. */
export function progressBar(target) {
    const node = el(target);
    let fill = node.firstElementChild;
    if (!fill) { fill = h('div'); node.appendChild(fill); }
    return {
        set(f) {
            const pct = Math.max(0, Math.min(1, +f || 0)) * 100;
            fill.style.width = pct.toFixed(1) + '%';
        },
        el: node,
    };
}

/**
 * Append-only log (.k-log). opts: { max = 500, newestFirst = false, time = true }.
 * Handle: add(textOrNode, kind?) -> row, clear(), count.
 */
export function logView(target, opts) {
    const node = el(target);
    const o = Object.assign({ max: 500, newestFirst: false, time: true }, opts);
    let count = 0;
    return {
        add(item, kind) {
            count++;
            const row = h('div', { class: kind || null },
                o.time ? h('span.t', null, clock()) : null,
                typeof item === 'object' ? item : String(item));
            if (o.newestFirst) node.insertBefore(row, node.firstChild);
            else node.appendChild(row);
            while (node.childElementCount > o.max) {
                node.removeChild(o.newestFirst ? node.lastElementChild : node.firstElementChild);
            }
            if (!o.newestFirst) node.scrollTop = node.scrollHeight;
            return row;
        },
        clear() { clear(node); count = 0; },
        get count() { return count; },
        el: node,
    };
}

/**
 * Labelled readouts ("fps <b>60</b>"). `labels` maps key -> label text; the
 * spans are built into `target` in order. With no labels, set() writes to
 * existing <b data-stat="key"> or #key elements already in the page.
 * Handle: set(key, value) or set({ key: value, ... }).
 */
export function stats(target, labels) {
    const node = el(target);
    const cells = {};
    if (labels) {
        for (const k in labels) {
            cells[k] = h('b', { dataset: { stat: k } }, '—');
            node.appendChild(h('span', null, labels[k] + ' ', cells[k]));
        }
    }
    const cell = (k) => cells[k] ||
        (cells[k] = node.querySelector('[data-stat="' + k + '"]') || document.getElementById(k));
    return {
        set(k, v) {
            if (typeof k === 'object') { for (const key in k) this.set(key, k[key]); return; }
            const c = cell(k);
            if (c) c.textContent = String(v);
        },
        el: node,
    };
}

/**
 * Label/value rows (.k-kv) for live readouts, built once into `target`.
 * `labels` is { key: 'label' } or an array of labels (keys are the indices).
 * set() only writes a value that changed, so a per-frame update costs no
 * relayout. Handle: set(key, value, on?) (on toggles the row's .on class),
 * set({ key: value, ... }), get(key), row(key), keys.
 */
export function readout(target, labels) {
    const node = el(target);
    node.classList.add('k-kv');
    const rows = {}, vals = {};
    const keys = Array.isArray(labels) ? labels.map((_, i) => String(i)) : Object.keys(labels);
    for (const k of keys) {
        vals[k] = h('b', null, '—');
        rows[k] = h('div', null, h('span', null, Array.isArray(labels) ? labels[+k] : labels[k]), vals[k]);
        node.appendChild(rows[k]);
    }
    return {
        set(k, v, on) {
            if (typeof k === 'object') { for (const key in k) this.set(key, k[key]); return; }
            const c = vals[k];
            if (!c) return;
            const s = String(v);
            if (c.textContent !== s) c.textContent = s;
            if (on !== undefined && rows[k].classList.contains('on') !== !!on) rows[k].classList.toggle('on', !!on);
        },
        get(k) { return vals[k] ? vals[k].textContent : undefined; },
        row(k) { return rows[k]; },
        keys,
        el: node,
    };
}

/** Frames-per-second over a sliding half second. Call tick() once a frame; returns the fps. */
export function fpsMeter() {
    let frames = 0, last = performance.now(), fps = 0;
    return {
        tick() {
            frames++;
            const now = performance.now();
            if (now - last >= 500) { fps = frames * 1000 / (now - last); frames = 0; last = now; }
            return fps;
        },
        get fps() { return fps; },
    };
}

/**
 * A button that flips between two states, styled .active when on.
 * opts: { on = false, labels: [offText, onText], onChange(on) }.
 * Handle: on (get/set; setting does not fire onChange), toggle().
 */
export function toggleButton(target, opts) {
    const btn = el(target);
    const o = opts || {};
    let on = !!o.on;
    const paint = () => {
        btn.classList.toggle('active', on);
        if (o.labels) btn.textContent = o.labels[on ? 1 : 0];
    };
    const api = {
        get on() { return on; },
        set on(v) { on = !!v; paint(); },
        toggle() { on = !on; paint(); if (o.onChange) o.onChange(on); return on; },
        el: btn,
    };
    btn.addEventListener('click', () => api.toggle());
    paint();
    return api;
}

/**
 * A row of mutually exclusive buttons (a segmented control) built into
 * `target`. options: array of values, [value, label] pairs, or { value: label }.
 * opts: { value, onChange(value), small = true, title(value) }.
 * The chosen button carries .active and data-value. Handle: value (get/set;
 * setting does not fire onChange), buttons.
 */
export function segmented(target, options, opts) {
    const node = el(target);
    const o = opts || {};
    const list = Array.isArray(options)
        ? options.map((x) => (Array.isArray(x) ? x : [x, x]))
        : Object.keys(options).map((k) => [k, options[k]]);
    let value = o.value != null ? o.value : list[0] && list[0][0];
    const buttons = list.map(([v, label]) => {
        const b = h(o.small === false ? 'button' : 'button.small', {
            dataset: { value: String(v) }, title: o.title ? o.title(v) : null,
            onclick: () => { api.value = v; if (o.onChange) o.onChange(v); },
        }, String(label));
        node.appendChild(b);
        return b;
    });
    const api = {
        get value() { return value; },
        set value(v) {
            value = v;
            for (const b of buttons) b.classList.toggle('active', b.dataset.value === String(v));
        },
        buttons,
        el: node,
    };
    api.value = value;
    return api;
}

/**
 * Tabs: buttons carrying data-tab="name" inside `target` (a .k-tabs bar)
 * show the element with data-pane="name" and hide the other panes.
 * opts: { onChange(name) }. Handle: select(name), current.
 */
export function tabs(target, opts) {
    const bar = el(target);
    const o = opts || {};
    const buttons = Array.from(bar.querySelectorAll('[data-tab]'));
    let current = null;
    const select = (name) => {
        current = name;
        for (const b of buttons) b.classList.toggle('active', b.dataset.tab === name);
        for (const p of document.querySelectorAll('[data-pane]')) {
            if (buttons.some((b) => b.dataset.tab === p.dataset.pane)) p.hidden = p.dataset.pane !== name;
        }
        if (o.onChange) o.onChange(name);
    };
    for (const b of buttons) b.addEventListener('click', () => select(b.dataset.tab));
    const first = buttons.find((b) => b.classList.contains('active')) || buttons[0];
    if (first) select(first.dataset.tab);
    return { select, get current() { return current; }, el: bar };
}

/**
 * requestAnimationFrame loop. fn(dt seconds, t seconds) runs every frame
 * while running. Handle: running, pause(), resume(), stop(), step().
 * dt is clamped to 0.1 s so a stall does not explode a simulation.
 */
export function frameLoop(fn) {
    let running = true, alive = true, last = performance.now(), t = 0;
    const frame = () => {
        if (!alive) return;
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (running) { t += dt; fn(dt, t); }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return {
        get running() { return running; },
        pause() { running = false; },
        resume() { running = true; last = performance.now(); },
        step(dt) { dt = dt || 1 / 60; t += dt; fn(dt, t); },
        stop() { alive = false; },
    };
}

/**
 * Fixed-timestep accumulator, for simulations that must not depend on the
 * frame rate (and replay identically under headless advanceTime):
 *   const step = fixedStep(1 / 60);
 *   loop: step(dt, (h) => world.tick(h));
 * Runs fn(h) as many whole steps as the accumulated time holds, at most
 * `maxSteps` per call (a longer stall is dropped). Returns the step count.
 */
export function fixedStep(h, maxSteps = 8) {
    let acc = 0;
    return (dt, fn) => {
        acc += dt;
        let n = 0;
        while (acc >= h && n < maxSteps) { fn(h); acc -= h; n++; }
        if (acc >= h) acc = 0;
        return n;
    };
}

/**
 * Foldable panels: a click on the <h2> caption of any `.k-panel.fold` inside
 * `root` toggles `.folded` (everything but the caption hides). Clicks on a
 * control inside the caption (a checkbox that switches the feature) do not
 * fold; ticking such a checkbox unfolds the panel, since switching a feature
 * on is the moment its controls matter. Start a panel folded with
 * class="k-panel fold folded".
 */
export function foldPanels(root) {
    const node = root ? el(root) : document;
    for (const cap of node.querySelectorAll('.k-panel.fold > h2')) {
        cap.addEventListener('click', (e) => {
            const t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'LABEL' || t === 'SELECT' || t === 'BUTTON') return;
            cap.parentNode.classList.toggle('folded');
        });
        const box = cap.querySelector('input[type=checkbox]');
        if (box) box.addEventListener('change', () => { if (box.checked) cap.parentNode.classList.remove('folded'); });
    }
}
