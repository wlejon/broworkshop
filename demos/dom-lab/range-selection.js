// Range & Selection: build a Range with one boundary in a text node and one on
// an element offset, show it through window.getSelection(), wrap it with
// surroundContents(), collapse it. The diagnostics table reads the Range back.
//
// The range deliberately ends at an ELEMENT boundary (after <strong>): a range
// ending partway into a later text node would be spec-legal for
// surroundContents, but bro drops the partially-contained text (see
// ENGINE-ISSUES.md, "Range clone/extract drop partially-contained nodes").

import { $ } from "/lib/kit/dom.js";

export const rangeState = { range: null, original: '' };

const nodeName = (n) => (n ? n.nodeName : 'null');

/** The Range read back as the table shows it. */
export function diagnose(r) {
    return {
        startContainer: nodeName(r.startContainer), startOffset: r.startOffset,
        endContainer: nodeName(r.endContainer), endOffset: r.endOffset,
        collapsed: r.collapsed, text: r.toString(),
    };
}

function show(note) {
    const r = rangeState.range;
    const d = diagnose(r);
    $('#range-start-node').textContent = d.startContainer;
    $('#range-start-offset').textContent = String(d.startOffset);
    $('#range-end-node').textContent = d.endContainer;
    $('#range-end-offset').textContent = String(d.endOffset);
    $('#range-collapsed').textContent = d.collapsed ? 'yes' : 'no';
    $('#range-text').textContent = JSON.stringify(d.text);
    const sel = window.getSelection();
    $('#sel-count').textContent = String(sel ? sel.rangeCount : 0);
    $('#range-note').textContent = note || '';
}

function mirrorToSelection() {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(rangeState.range);
}

/** Start at the end of p1's first text node ("The |"), end after <strong>. */
export function selectDefaultRange() {
    const p1 = $('#p1');
    const r = document.createRange();
    r.setStart(p1.firstChild, p1.firstChild.length);
    r.setEnd(p1, 2);
    rangeState.range = r;
    mirrorToSelection();
    show('text boundary → element boundary');
    return r;
}

export function surroundWithMark() {
    const r = rangeState.range;
    if (!r || r.collapsed) { show('nothing to wrap: the range is collapsed'); return false; }
    try {
        r.surroundContents(document.createElement('mark'));
        mirrorToSelection();
        show('wrapped in <mark>; the range now selects the new element');
        return true;
    } catch (e) {
        show('surroundContents threw ' + e.name);
        return false;
    }
}

export function collapseToStart() {
    if (!rangeState.range) return;
    rangeState.range.collapse(true);
    mirrorToSelection();
    show('collapsed to its start boundary');
}

export function resetArticle() {
    $('#article').innerHTML = rangeState.original;
    return selectDefaultRange();
}

export function initRangeSelection() {
    rangeState.original = $('#article').innerHTML;
    $('#select-range').addEventListener('click', selectDefaultRange);
    $('#surround-range').addEventListener('click', surroundWithMark);
    $('#collapse-range').addEventListener('click', collapseToStart);
    $('#reset-article').addEventListener('click', resetArticle);
    selectDefaultRange();
}
