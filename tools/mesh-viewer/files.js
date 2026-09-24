// files.js — the file panel: a directory of mesh files (remembered across
// runs) or a single opened / dropped file, rendered as a clickable list.

import { h, clear } from "/lib/kit/dom.js";
import { prefStore } from "/lib/kit/prefs.js";
import { LOAD_EXTS, fileName } from "./loader.js";

const fs = require('fs');
const path = require('path');

const norm = (p) => path.normalize(p).replace(/\\/g, '/');

/** Mesh files directly inside `dir`, sorted by name: { ok, files, error? }. */
export function scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return { ok: false, error: e.message, files: [] }; }
    const files = entries
        .filter((e) => e.isFile && e.isFile() && LOAD_EXTS.some((x) => e.name.toLowerCase().endsWith(x)))
        .map((e) => norm(path.join(dir, e.name)));
    files.sort((a, b) => fileName(a).localeCompare(fileName(b)));
    return { ok: true, files };
}

/**
 * opts: { list (element), status (element), onPick(path, index), canPick() }.
 * Handle: { files, index, dir, prefs, setDirectory(dir, { autoload, selected }),
 * setSingle(path), pick(i), restore() }.
 */
export function createFileBrowser(opts) {
    const prefs = prefStore('mesh-viewer', { dir: '' });
    const api = {
        files: [], index: -1, dir: '', prefs,

        /** List `dir`; autoload opens `selected` (or the first file). Returns false on a bad dir. */
        setDirectory(dir, o) {
            const d = norm(dir), res = scanDir(d);
            api.dir = d;
            api.files = res.files;
            api.index = -1;
            if (!res.ok) {
                setStatus('error: ' + res.error, true);
                render();
                return false;
            }
            prefs.set({ dir: d });
            setStatus(res.files.length + ' file' + (res.files.length === 1 ? '' : 's') + ' · ' + d);
            render();
            const oo = o || {};
            if (oo.autoload && res.files.length) {
                const at = oo.selected ? res.files.indexOf(norm(oo.selected)) : -1;
                api.pick(Math.max(0, at));
            }
            return true;
        },

        /** Show one file on its own and open it. */
        setSingle(p) {
            api.dir = '';
            api.files = [norm(p)];
            api.index = -1;
            setStatus('single file · ' + path.dirname(api.files[0]));
            api.pick(0);
        },

        /** Open file `i` of the list. */
        pick(i) {
            if (i < 0 || i >= api.files.length) return;
            if (opts.canPick && !opts.canPick()) return;
            api.index = i;
            render();
            opts.onPick(api.files[i], i);
        },

        /** Re-list the remembered directory (without opening anything). */
        restore() {
            const d = prefs.data.dir;
            if (d && fs.existsSync(d)) return api.setDirectory(d);
            setStatus('File → Open Folder... or Open File..., or drop a mesh');
            render();
            return false;
        },
    };

    function setStatus(text, bad) {
        opts.status.textContent = text;
        opts.status.classList.toggle('bad', !!bad);
    }

    function render() {
        const list = opts.list;
        clear(list);
        if (!api.files.length) {
            list.appendChild(h('div.k-note', null, api.dir ? 'No mesh files in this directory.' : ''));
            return;
        }
        api.files.forEach((f, i) => {
            list.appendChild(h('div.file-item' + (i === api.index ? '.selected' : ''),
                { title: f, onclick: () => api.pick(i) },
                h('span.dim', null, String(i + 1)), h('span.nm', null, fileName(f))));
        });
        const sel = list.querySelector('.file-item.selected');
        if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }

    return api;
}
