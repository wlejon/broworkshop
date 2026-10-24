// lib/kit/evidence.js — show an engine's answer beside what the page checked
// on its own: the Answer verdict, the "checked by the page" list, a stage
// caption legend, a preset picker, and the kit's token colours for canvas
// drawing. Solver Lab and Superopt Lab are built on it.
//
//   import { verdict, checks, legend, presetPicker, kitColors } from "/lib/kit/evidence.js";
//   const answer = verdict('#answer');        answer.set('ok', 'SAT', 'x = 64, y = 106');
//   const list = checks('#checks');
//   list.set([{ ok: true, label: 'f(64, 106) returns 1 when the page runs it' },
//             { ok: null, label: 'a brute-force scan needs 65,536 tries', detail: '12 ms' }]);

import { $, h, clear } from "./dom.js";

/**
 * The answer line (.k-verdict): set(kind 'ok' | 'warn' | 'err', badge, text)
 * shows a badge and the one line that matters.
 */
export function verdict(target) {
    const node = $(target);
    node.classList.add('k-verdict');
    return {
        set(kind, badge, text) {
            clear(node);
            node.appendChild(h('span.k-badge.' + kind, null, badge));
            if (text) node.appendChild(h('b', null, text));
        },
        el: node,
    };
}

/**
 * The page's own checks (.k-checks): set([{ ok, label, detail }]). ok true
 * passes, false fails, null is a finding that is neither (shown as
 * information). Returns { passed, failed, counted } (counted = passed + failed).
 */
export function checks(target) {
    const node = $(target);
    node.classList.add('k-checks');
    return {
        set(list) {
            clear(node);
            let passed = 0, failed = 0;
            for (const c of list) {
                const cls = c.ok === true ? 'ok' : c.ok === false ? 'fail' : 'info';
                if (c.ok === true) passed++;
                if (c.ok === false) failed++;
                node.appendChild(h('div.k-check.' + cls, null,
                    h('i', null, c.ok === true ? '✓' : c.ok === false ? '✗' : '•'),
                    h('div', null, h('span', null, c.label), c.detail ? h('small', null, c.detail) : null)));
            }
            return { passed, failed, counted: passed + failed };
        },
        el: node,
    };
}

/**
 * A legend (.k-legend) for a stage caption: items are [colour, label] or
 * [colour, label, 'line' | 'ring'] (a stroke or an outline swatch).
 */
export function legend(target, items) {
    const node = clear($(target));
    node.classList.add('k-legend');
    for (const [color, label, shape] of items) {
        const sw = h('i' + (shape ? '.' + shape : ''));
        if (shape === 'ring') sw.style.borderColor = color; else sw.style.background = color;
        node.appendChild(h('span', null, sw, label));
    }
}

/**
 * Example buttons in `target`, one per key of `presets` (labelled by its
 * `.label`); onPick(key) on a click. Handle: select(key) marks one active.
 */
export function presetPicker(target, presets, onPick) {
    const node = $(target);
    node.classList.add('k-presets');
    const buttons = {};
    for (const key of Object.keys(presets)) {
        buttons[key] = h('button.small', { onclick: () => onPick(key) }, presets[key].label);
        node.appendChild(buttons[key]);
    }
    return {
        select(key) { for (const k in buttons) buttons[k].classList.toggle('active', k === key); },
        el: node,
    };
}

/**
 * The kit's token colours (kit.css :root, or an app's overrides) as strings
 * for canvas drawing, plus `font` (11px UI font). Read once per call.
 */
export function kitColors() {
    const css = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
        bg: tok('--k-bg', '#0c0e12'),
        surface: tok('--k-surface', '#10141c'),
        input: tok('--k-input', '#131720'),
        border: tok('--k-border', '#1d2330'),
        borderHi: tok('--k-border-hi', '#2c3c57'),
        text: tok('--k-text', '#d7dde6'),
        muted: tok('--k-muted', '#97a1b2'),
        dim: tok('--k-dim', '#6b7686'),
        value: tok('--k-value', '#cfe0ff'),
        accent: tok('--k-accent', '#5c9dff'),
        ok: tok('--k-ok', '#7fe6a8'),
        warn: tok('--k-warn', '#e6c07f'),
        err: tok('--k-err', '#ff8585'),
        font: '11px ' + tok('--k-font-ui', 'system-ui, sans-serif'),
    };
}

/** `rgba()` of a #rrggbb colour at opacity `a`. */
export function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
