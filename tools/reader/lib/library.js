// library.js — the library view: document cards, import, resume, delete.

import { $, h, clear } from "/lib/kit/dom.js";
import { library, deleteDocument, importPaths, IMPORT_FILTER } from "./docs.js";
import { openDocument } from "./reader.js";

let status = null;

export function initLibrary(statusLine) {
    status = statusLine;
    $('#btn-import').addEventListener('click', importViaDialog);
}

/** The native open dialog (multi-select). Never triggered by tests: it blocks. */
export function importViaDialog() {
    if (typeof showOpenFileDialog !== 'function') { status.error('file dialog unavailable in this build'); return; }
    const files = showOpenFileDialog(IMPORT_FILTER, true);
    if (files && files.length) importAndShow(Array.isArray(files) ? files : [files]);
}

/** Import paths, re-render, report errors in the status line. Returns the last record. */
export function importAndShow(paths) {
    const { last, errors } = importPaths(paths);
    renderLibrary();
    if (errors.length) status.error(errors.join(' · '));
    else if (last) status.ok('imported ' + last.title);
    return last;
}

function fmtDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function card(doc) {
    const pct = doc.sentenceCount ? Math.round((doc.pos / doc.sentenceCount) * 100) : 0;
    const voice = doc.voice || doc.speaker;
    const del = h('button.danger', { title: 'Remove from library (click twice)' }, '✕');
    del.addEventListener('click', () => {
        if (del.dataset.armed) { deleteDocument(doc.id); renderLibrary(); return; }
        del.dataset.armed = '1';
        del.textContent = 'remove?';
        setTimeout(() => { delete del.dataset.armed; del.textContent = '✕'; }, 1800);
    });
    return h('div.card', { dataset: { id: doc.id } },
        h('div.card-title', null, doc.title),
        h('div.card-meta', null, fmtDate(doc.addedAt) + ' · ' + doc.sentenceCount + ' sentences' +
            (doc.engine ? ' · ' + doc.engine : '') + (voice ? ' · ' + voice : '')),
        h('div.k-progress', null, h('div', { style: { width: pct + '%' } })),
        h('div.card-row', null,
            h('button.primary.open', { onclick: () => openDocument(doc) }, doc.pos > 0 ? '▶ Continue · ' + pct + '%' : '▶ Read'),
            del));
}

export function renderLibrary() {
    const grid = clear($('#doc-grid'));
    $('#lib-empty').hidden = library.length > 0;
    for (const doc of library) grid.appendChild(card(doc));
}
