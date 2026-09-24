// report.js — how every panel in this lab shows a verdict.
//
// Rows and tables are built ONCE and only their text changes afterwards:
// rebuilding innerHTML in a text lab means re-SHAPING every string in the
// subtree, the very cost the shaping cache exists to avoid.

import { h, clear } from '/lib/kit/dom.js';

/** Fixed two-decimal number for panel text; keeps rows from jittering. */
export function n2(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
}

/** A table under `host` with `rowCount` empty rows; returns the cell matrix. */
export function table(host, headers, rowCount) {
    const cells = [];
    const body = h('tbody');
    for (let r = 0; r < rowCount; r++) {
        const row = headers.map(() => h('td'));
        cells.push(row);
        body.appendChild(h('tr', null, row));
    }
    host.appendChild(h('table.grid', null, h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))), body));
    return cells;
}

/** Write a verdict into a cell: green, red, or dim when `ok` is null (informational). */
export function verdict(cell, ok, text) {
    cell.textContent = text;
    cell.className = ok === null ? 'dim' : ok ? 'ok' : 'err';
    return ok;
}

/** A result strip: one sentence of evidence, bordered green or red. */
export function result(host, ok, text) {
    host.textContent = text;
    host.className = 'result ' + (ok ? 'ok' : 'err');
    return ok;
}

/** A note line coloured ok / warn. */
export function note(host, ok, text) {
    host.textContent = text;
    host.className = 'note ' + (ok ? 'ok' : 'warn');
}

/** Rows of { what, ok, want, got }: a tick or cross, and want/got on failure. */
export function checkRows(host, rows) {
    clear(host);
    for (const r of rows) {
        host.appendChild(h('div.check.' + (r.ok ? 'ok' : 'err'), null,
            h('b', null, (r.ok ? '✓ ' : '✗ ') + r.what),
            r.ok ? h('span.got', null, '  ' + r.got)
                 : [h('span.want', null, ' want ' + r.want), h('span.got', null, ' got ' + r.got)]));
    }
}

/**
 * One driven scenario as a block: head, why, the in/out evidence
 * (pre-wrapped), then a line per check ({ ok, text }).
 */
export function caseBox(ok, head, why, io, checks) {
    return h('div.case.' + (ok ? 'ok' : 'err'), null,
        h('div.case-head', null, head),
        why ? h('div.case-why', null, why) : null,
        h('div.case-io', null, io),
        checks.map((c) => h('div.check.' + (c.ok ? 'ok' : 'err'), null, (c.ok ? '✓ ' : '✗ ') + c.text)));
}

/**
 * A glyph-over-label cell (code-point strips, bidi level bars): the character
 * on top, a caption underneath. Spaces and ZWJ get visible stand-ins.
 */
export function glyphCell(cls, char, caption, title) {
    const shown = char === ' ' ? '␠' : char === '‍' ? '⌁' : char;
    return h('span.' + cls.split(' ').join('.'), { title }, h('b', null, shown), h('i', null, caption));
}
