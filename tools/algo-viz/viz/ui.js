// Small UI pieces every viz shares, on top of the kit: a params row bound
// to the viz state, buttons, toggles, overlays, and a cancellable frame loop
// plus window-listener bookkeeping so destroy() leaves nothing behind.

import { h } from "/lib/kit/dom.js";
import { params } from "/lib/kit/params.js";

/** kit params() into the toolbar row; onChange(key, value) after state[key] updates. */
export function controls(container, state, spec, onChange) {
    return params(container, state, spec, { onChange: (k, v) => onChange && onChange(k, v) });
}

/** A small toolbar button. */
export function button(container, label, onClick, title) {
    const b = h('button.small', { onclick: onClick, title: title || null }, label);
    container.appendChild(b);
    return b;
}

/**
 * A button that flips `.active`. Handle: on (get/set, silent), el.
 * onChange(on) fires on clicks.
 */
export function toggle(container, label, on, onChange) {
    const b = button(container, label, () => { api.on = !api.on; if (onChange) onChange(api.on); });
    const api = {
        get on() { return b.classList.contains('active'); },
        set on(v) { b.classList.toggle('active', !!v); },
        el: b,
    };
    api.on = on;
    return api;
}

/** An absolutely positioned text overlay (.av-overlay) inside `parent`. */
export function overlay(parent, cls) {
    const o = h('div.av-overlay' + (cls ? '.' + cls : ''));
    parent.appendChild(o);
    let last = '';
    return {
        el: o,
        /** Writes only when the text changed. */
        set(text) { if (text !== last) { o.textContent = text; last = text; } },
    };
}

/**
 * Lifetime of one mounted viz: a rAF loop that stops on dispose, and
 * window/document listeners that are removed on dispose.
 *   const life = lifetime();
 *   life.loop((now) => draw(now));
 *   life.listen(window, 'keydown', onKey);
 *   ... destroy: life.dispose();
 */
export function lifetime() {
    const offs = [];
    let alive = true, raf = 0;
    return {
        get alive() { return alive; },
        loop(fn) {
            const frame = (now) => {
                if (!alive) return;
                fn(now);
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
        },
        listen(target, type, fn, opts) {
            target.addEventListener(type, fn, opts);
            offs.push(() => target.removeEventListener(type, fn, opts));
        },
        dispose() {
            alive = false;
            if (raf) cancelAnimationFrame(raf);
            for (const off of offs.splice(0)) off();
        },
    };
}
