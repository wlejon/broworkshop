// find.js — the find & replace bar over the editor textarea (case-insensitive).

import { $ } from "/lib/kit/dom.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Count of `query` in `text`, ignoring case. */
export function countMatches(text, query) {
    return query ? (text.match(new RegExp(escapeRe(query), 'gi')) || []).length : 0;
}

export function findBar(editor) {
    const bar = $('#findBar'), input = $('#findInput'), repl = $('#replaceInput'), count = $('#findMatchCount');
    const ta = editor.ta;

    /** Select the next match after the caret (wrapping); returns its index or -1. */
    function next() {
        const q = input.value;
        count.textContent = countMatches(ta.value, q) + ' matches';
        if (!q) return -1;
        const text = ta.value.toLowerCase(), lq = q.toLowerCase();
        let at = text.indexOf(lq, ta.selectionEnd || 0);
        if (at < 0) at = text.indexOf(lq, 0);
        if (at >= 0) { ta.focus(); ta.setSelectionRange(at, at + q.length); }
        return at;
    }

    function replaceOne() {
        const q = input.value;
        if (!q) return;
        const s = ta.selectionStart, e = ta.selectionEnd;
        if (ta.value.slice(s, e).toLowerCase() === q.toLowerCase()) {
            editor.splice(repl.value, s, e, 'end');
            editor.changed();
        }
        next();
    }

    function replaceAll() {
        const q = input.value;
        const n = countMatches(ta.value, q);
        if (!n) return 0;
        editor.replaceAll(ta.value.replace(new RegExp(escapeRe(q), 'gi'), () => repl.value));
        count.textContent = 'Replaced ' + n + ' occurrences';
        return n;
    }

    function toggle(show) {
        const on = show === undefined ? bar.hidden : show;
        bar.hidden = !on;
        if (on) { input.focus(); input.select(); }
    }

    input.addEventListener('input', next);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    $('#btnFindNext').addEventListener('click', next);
    $('#btnReplace').addEventListener('click', replaceOne);
    $('#btnReplaceAll').addEventListener('click', replaceAll);
    $('#btnCloseFind').addEventListener('click', () => toggle(false));
    return { next, replaceOne, replaceAll, toggle };
}
