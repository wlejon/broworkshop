// observer.js — the MutationObserver tab: one observer on #editor recording
// every childList / attributes / characterData record, with old values, and
// a filterable, pausable, exportable log of them.

import { $, h, clear, clock } from '/lib/kit/dom.js';

export const KEEP = 250, SHOW = 80;

const emptyStats = () => ({ total: 0, childList: 0, attributes: 0, characterData: 0, nodesAdded: 0, nodesRemoved: 0 });

export const observerState = {
    records: [],        // newest first, at most KEEP
    stats: emptyStats(),
    paused: false,
    lastExport: null,   // the JSON text of the last export
};

const CONFIG = {
    childList: true, attributes: true, characterData: true, subtree: true,
    attributeOldValue: true, characterDataOldValue: true,
};

let observer = null, onChange = () => {}, seq = 0;

export function describe(node) {
    if (!node) return 'null';
    if (node.nodeType === 3) {
        const t = node.data.trim();
        return `#text "${t.slice(0, 20)}${t.length > 20 ? '…' : ''}"`;
    }
    if (node.nodeType === 1) {
        let d = '<' + node.nodeName.toLowerCase();
        if (node.id) d += ` id="${node.id}"`;
        if (typeof node.className === 'string' && node.className) d += ` class="${node.className}"`;
        return d + '>';
    }
    return node.nodeName || 'unknown';
}

/** One MutationRecord as plain, JSON-safe data. */
export function toEntry(record) {
    const s = observerState.stats;
    s.total++;
    s[record.type] = (s[record.type] || 0) + 1;
    let summary = '', details = {};
    if (record.type === 'childList') {
        const added = Array.from(record.addedNodes).map(describe);
        const removed = Array.from(record.removedNodes).map(describe);
        s.nodesAdded += added.length;
        s.nodesRemoved += removed.length;
        summary = `+${added.length} added, −${removed.length} removed in ${describe(record.target)}`;
        details = { added, removed, previousSibling: describe(record.previousSibling), nextSibling: describe(record.nextSibling) };
    } else if (record.type === 'attributes') {
        const name = record.attributeName;
        const now = record.target.getAttribute ? record.target.getAttribute(name) : null;
        summary = `attr "${name}": "${record.oldValue ?? 'null'}" → "${now ?? 'null'}" on ${describe(record.target)}`;
        details = { attributeName: name, oldValue: record.oldValue, newValue: now };
    } else if (record.type === 'characterData') {
        const now = record.target.data;
        summary = `text: "${(record.oldValue || '').slice(0, 25)}" → "${(now || '').slice(0, 25)}"`;
        details = { oldText: record.oldValue, newText: now };
    }
    return {
        id: ++seq, time: clock(), type: record.type,
        target: describe(record.target), targetTag: record.target ? record.target.nodeName.toLowerCase() : null,
        summary, details,
    };
}

/** Start observing `target`; `changed()` runs after every batch and every control action. */
export function initObserver(target, changed) {
    onChange = changed || onChange;
    observer = new MutationObserver((list) => {
        if (observerState.paused) return;
        for (const rec of list) observerState.records.unshift(toEntry(rec));
        observerState.records.length = Math.min(observerState.records.length, KEEP);
        render();
    });
    observer.observe(target, CONFIG);

    $('#obsFilter').addEventListener('change', render);
    $('#obsPause').addEventListener('click', () => setPaused(!observerState.paused));
    $('#obsClear').addEventListener('click', clearLog);
    $('#obsExport').addEventListener('click', exportLog);
    render();
}

/** Deliver any records still queued (MutationObserver callbacks are microtasks). */
export function takeRecords() {
    if (!observer || observerState.paused) return;
    const list = observer.takeRecords();
    for (const rec of list) observerState.records.unshift(toEntry(rec));
    observerState.records.length = Math.min(observerState.records.length, KEEP);
    render();
}

export function setPaused(p) {
    observerState.paused = p;
    $('#obsPause').textContent = p ? 'resume' : 'pause';
    $('#obsPause').classList.toggle('active', p);
    const chip = $('#observerChip');
    chip.textContent = p ? 'observer: paused' : 'observer: active';
    chip.classList.toggle('on', !p);
    onChange();
}

export function clearLog() {
    observerState.records = [];
    observerState.stats = emptyStats();
    render('Log cleared. Waiting for mutations…');
}

export function exportJson() {
    return JSON.stringify({ stats: observerState.stats, records: observerState.records }, null, 2);
}

/** Download the log through an <a download> over a Blob URL. */
export function exportLog() {
    const json = observerState.lastExport = exportJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = h('a', { href: url, download: `mutation-log-${Date.now()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** The records passing the current filter, newest first. */
export function visibleRecords() {
    const f = $('#obsFilter').value;
    return f === 'all' ? observerState.records : observerState.records.filter((r) => r.type === f);
}

function render(emptyText) {
    const s = observerState.stats;
    $('#obsTotal').textContent = String(s.total);
    $('#obsBreakdown').textContent =
        `childList ${s.childList} · attributes ${s.attributes} · characterData ${s.characterData} · ` +
        `+${s.nodesAdded} / −${s.nodesRemoved} nodes`;
    const log = $('#obsLog');
    clear(log);
    const rows = visibleRecords();
    if (rows.length === 0) {
        const f = $('#obsFilter').value;
        log.appendChild(h('div.empty', null, emptyText ||
            (observerState.records.length ? `No mutations match the filter "${f}".`
                : 'Waiting for DOM mutations in the editor… (type text, format nodes, or run a Range operation)')));
    } else {
        for (const r of rows.slice(0, SHOW)) {
            log.appendChild(h('div.rec', { dataset: { type: r.type } },
                h('span.t', null, r.time), h('span.badge.' + r.type, null, r.type), h('span.body', null, r.summary)));
        }
    }
    onChange();
}
