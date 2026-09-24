// The algo-viz shell: a sidebar of registered visualisations, and a stage +
// toolbar the active one is mounted into (and torn down from on switch).
//
// Each viz module registers a descriptor (viz/registry.js):
//   { id, name, category, subtitle, init({ stage, params, status }) -> handle, destroy(handle) }
// Import order below is sidebar order within a category.

import { h, $, clear } from "/lib/kit/dom.js";
import { VIZ } from "./viz/registry.js";
import "./viz/pathfinding.js";
import "./viz/noise.js";
import "./viz/terrain.js";
import "./viz/isosurface.js";

/** Build the shell into the page. Returns { VIZ, activate(id), current, handle }. */
export function mountShell(status) {
    const list = $('#viz-list'), stage = $('#stage'), params = $('#params');
    const title = $('#title'), subtitle = $('#subtitle');
    let current = null, handle = null;

    const byCat = new Map();
    for (const v of VIZ) {
        if (!byCat.has(v.category)) byCat.set(v.category, []);
        byCat.get(v.category).push(v);
    }
    for (const [cat, items] of byCat) {
        list.appendChild(h('h2', null, cat));
        for (const v of items) {
            list.appendChild(h('div.viz-item', { dataset: { id: v.id }, onclick: () => shell.activate(v.id) }, v.name));
        }
    }

    const shell = {
        VIZ,
        get current() { return current; },
        get handle() { return handle; },
        activate(id) {
            if (current && current.id === id) return handle;
            const def = VIZ.find((v) => v.id === id);
            if (!def) throw new Error('algo-viz: no viz ' + id);
            if (current && handle) {
                try { current.destroy(handle); } catch (e) { console.error('destroy', current.id, e); }
            }
            handle = null;
            clear(stage);
            clear(params);
            status.set('');
            current = def;
            title.textContent = def.name;
            subtitle.textContent = def.subtitle || '';
            for (const el of list.querySelectorAll('.viz-item')) el.classList.toggle('active', el.dataset.id === id);
            try {
                handle = def.init({ stage, params, status });
            } catch (e) {
                console.error('init', id, e);
                status.error('init failed: ' + e.message);
            }
            return handle;
        },
    };
    return shell;
}
