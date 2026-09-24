// sidebar.js — the note list: search, cards, pin and delete.

import { $, h, clear } from "/lib/kit/dom.js";
import { searchNotes } from "./store.js";

const snippet = (n) => n.content.replace(/[#*`_~[\]>|-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Empty note';
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Render the list into #docList. opts: { activeId, onOpen(id), onPin(id), onDelete(id) }.
 */
export function renderNoteList(opts) {
    const list = clear($('#docList'));
    const query = $('#docSearchInput').value;
    const hits = searchNotes(query);
    if (!hits.length) {
        list.appendChild(h('div.doc-empty', null, 'No notes match "' + query.trim() + '".'));
        return;
    }
    for (const n of hits) {
        const act = (name, title, glyph, fn) => h('button.doc-action.' + name, {
            title, onclick: (e) => { e.stopPropagation(); fn(n.id); },
        }, glyph);
        list.appendChild(h('div.doc-card' + (n.id === opts.activeId ? '.active' : '') + (n.pinned ? '.pinned' : ''),
            { dataset: { docId: n.id }, onclick: () => opts.onOpen(n.id) },
            h('div.doc-card-title', null, n.title),
            h('div.doc-card-preview', null, snippet(n)),
            h('div.doc-card-foot', null,
                h('span.doc-card-date', null, (n.pinned ? 'pinned · ' : '') + shortDate(n.modifiedAt)),
                h('span.doc-actions', null,
                    act('pin', n.pinned ? 'Unpin note' : 'Pin note', n.pinned ? 'Unpin' : 'Pin', opts.onPin),
                    act('delete', 'Delete note', 'Delete', opts.onDelete)))));
    }
}
