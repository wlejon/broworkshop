// lib/kit/dom.js — tiny DOM helpers: query, build, format.
//
//   import { $, $$, h, clear } from "/lib/kit/dom.js";
//   const row = h('div.k-row', null,
//       h('button.primary', { onclick: go }, 'Run'),
//       h('span.dim#note', null, 'idle'));

/** querySelector that throws when the selector matches nothing. */
export function $(sel, root) {
    const el = (root || document).querySelector(sel);
    if (!el) throw new Error('kit: no element matches ' + sel);
    return el;
}

/** querySelectorAll as an array. */
export function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
}

/**
 * Build an element. `tag` may carry `.class` and `#id` suffixes
 * ('button.small.active', 'div#log'). `props`:
 *   class / className  string (added to the tag's classes)
 *   style              string or object
 *   dataset            object
 *   on<event>          function -> addEventListener(event)
 *   text               textContent
 *   anything else      property if the element has it, else attribute
 * Children: strings, numbers, nodes, arrays, null/false (skipped).
 */
export function h(tag, props, ...children) {
    const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(tag);
    if (!m) throw new Error('kit: bad tag ' + tag);
    const el = document.createElement(m[1] || 'div');
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
        if (part[0] === '.') el.classList.add(part.slice(1));
        else el.id = part.slice(1);
    }
    if (props) {
        for (const k in props) {
            const v = props[k];
            if (v == null || v === false) continue;
            if (k === 'class' || k === 'className') {
                for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c);
            } else if (k === 'style') {
                if (typeof v === 'string') el.setAttribute('style', v);
                else for (const s in v) el.style[s] = v[s];
            } else if (k === 'dataset') {
                for (const d in v) el.dataset[d] = v[d];
            } else if (k === 'text') {
                el.textContent = v;
            } else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') {
                el.addEventListener(k.slice(2), v);
            } else if (k in el) {
                el[k] = v;
            } else {
                el.setAttribute(k, v === true ? '' : String(v));
            }
        }
    }
    append(el, children);
    return el;
}

function append(el, kids) {
    for (const c of kids) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
}

/** Remove every child; returns the element. */
export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/** Look up many ids at once: ids('status', 'go') -> { status, go }. Throws on a miss. */
export function ids(...names) {
    const out = {};
    for (const n of names) {
        const el = document.getElementById(n);
        if (!el) throw new Error('kit: no element #' + n);
        out[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = el;
    }
    return out;
}

/**
 * Follow one mouse drag: call from a mousedown handler. Listens on window for
 * mousemove -> onMove(e) and the first mouseup -> onUp(e), then detaches, so
 * a widget never leaves window listeners behind. Returns a cancel function.
 */
export function trackDrag(onMove, onUp) {
    const move = (e) => { if (onMove) onMove(e); };
    const up = (e) => { stop(); if (onUp) onUp(e); };
    function stop() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return stop;
}

// --- formatting ---------------------------------------------------------------

/** 1536 -> "1.5 KB". */
export function fmtBytes(n) {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (Math.abs(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : String(n)) + ' ' + u[i];
}

/** Milliseconds -> "12.3 ms" / "4.20 s" / "2m 05s". */
export function fmtMs(ms) {
    if (ms < 1000) return ms.toFixed(ms < 10 ? 2 : 1) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + ' s';
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

/** Wall-clock "hh:mm:ss". */
export function clock(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
