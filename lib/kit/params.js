// lib/kit/params.js — controls bound to plain objects.
//
// Two entry points:
//
//   bindControl(input, opts)   wire ONE existing control (static HTML) with
//                              a value readout and a typed onChange.
//   params(container, state, spec, opts)
//                              build a column of labelled controls for the
//                              fields of `state`, kept in sync both ways.
//
//   const state = { count: 3000, radius: 55, mode: 'aces', shadows: false };
//   const panel = params('#tuning', state, {
//       count:   { min: 500, max: 8000, step: 500, label: 'agents' },
//       radius:  { min: 10, max: 120, step: 5, fmt: (v) => v + ' px' },
//       mode:    { options: { aces: 'ACES', reinhard: 'Reinhard' } },
//       shadows: {},                         // boolean value -> checkbox
//   }, { onChange: (key, value) => rebuild(key) });
//   panel.set('radius', 80);                 // updates state + control, fires onChange

import { h } from "./dom.js";

const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);

function kindOf(input) {
    if (input.tagName === 'SELECT') return 'select';
    const t = (input.getAttribute('type') || 'text').toLowerCase();
    if (t === 'checkbox') return 'bool';
    if (t === 'range' || t === 'number') return 'number';
    return 'text';
}

function defaultFmt(input) {
    const step = parseFloat(input.getAttribute('step'));
    const dp = step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
    return (v) => (+v).toFixed(dp);
}

/**
 * Wire an existing <input>/<select>. opts:
 *   out       element/selector showing the formatted value (a range's readout)
 *   fmt(v)    readout formatter (default: fixed to the step's decimals)
 *   onChange(value)  typed value: number for range/number, boolean for
 *             checkbox, string otherwise. Fires on 'input' for ranges and
 *             text, on 'change' for the rest.
 * Returns { get value(), set value(v) (silent), input }.
 */
export function bindControl(target, opts) {
    const input = el(target);
    if (!input) throw new Error('kit: bindControl target missing: ' + target);
    const o = opts || {};
    const kind = kindOf(input);
    const out = o.out ? el(o.out) : null;
    const fmt = o.fmt || (kind === 'number' ? defaultFmt(input) : String);
    const read = () => {
        if (kind === 'bool') return !!input.checked;
        if (kind === 'number') return parseFloat(input.value);
        return input.value;
    };
    const paint = () => { if (out) out.textContent = fmt(read()); };
    const fire = () => {
        paint();
        if (o.onChange) o.onChange(read());
    };
    const live = kind === 'text' || input.getAttribute('type') === 'range';
    input.addEventListener(live ? 'input' : 'change', fire);
    paint();
    return {
        get value() { return read(); },
        set value(v) {
            if (kind === 'bool') input.checked = !!v;
            else input.value = String(v);
            paint();
        },
        input,
    };
}

function normOptions(options) {
    if (Array.isArray(options)) {
        return options.map((x) => (Array.isArray(x) ? [String(x[0]), String(x[1])] : [String(x), String(x)]));
    }
    return Object.keys(options).map((k) => [k, String(options[k])]);
}

function buildControl(key, value, s) {
    if (s.options) {
        return h('select', null, normOptions(s.options).map(([v, label]) =>
            h('option', { value: v, selected: String(value) === v }, label)));
    }
    if (s.type === 'bool' || typeof value === 'boolean') {
        return h('input', { type: 'checkbox', checked: !!value });
    }
    if (s.type === 'number' || (typeof value === 'number' && s.min === undefined)) {
        return h('input', { type: 'number', value: String(value), step: s.step != null ? String(s.step) : 'any' });
    }
    if (typeof value === 'number' || s.min !== undefined) {
        return h('input', {
            type: 'range', min: String(s.min != null ? s.min : 0), max: String(s.max != null ? s.max : 1),
            step: String(s.step != null ? s.step : 'any'), value: String(value),
        });
    }
    return h('input', { type: 'text', value: value == null ? '' : String(value) });
}

/**
 * Build labelled controls for `spec`'s keys into `container`, bound to
 * `state[key]`. Spec entry fields: label, min, max, step, fmt, options,
 * type ('bool' | 'number' | 'text'), hint (title tooltip).
 * opts: { onChange(key, value, state) }.
 * Returns { set(key, v, silent?), refresh(), rows: {key: rowEl}, el }.
 */
export function params(target, state, spec, opts) {
    const container = el(target);
    const o = opts || {};
    const bound = {}, rows = {};
    for (const key of Object.keys(spec)) {
        const s = spec[key] || {};
        const input = buildControl(key, state[key], s);
        const isRange = input.getAttribute('type') === 'range';
        const out = isRange ? h('span.k-val') : null;
        const row = h('label.k-field', { title: s.hint || null },
            h('span', null, s.label || key), input, out);
        container.appendChild(row);
        rows[key] = row;
        bound[key] = bindControl(input, {
            out, fmt: s.fmt,
            onChange: (v) => { state[key] = v; if (o.onChange) o.onChange(key, v, state); },
        });
    }
    return {
        set(key, v, silent) {
            state[key] = v;
            if (bound[key]) bound[key].value = v;
            if (!silent && o.onChange) o.onChange(key, v, state);
        },
        refresh() { for (const k in bound) bound[k].value = state[k]; },
        rows,
        el: container,
    };
}
