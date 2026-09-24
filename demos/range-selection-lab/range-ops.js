// range-ops.js — Range & Selection operations on the editor, as plain
// functions over window.getSelection(). No UI here: range-view.js renders,
// the tests call these directly.

export function selection() {
    return window.getSelection();
}

/** The selection's first range, or null. */
export function currentRange() {
    const sel = selection();
    return sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
}

/** Replace the selection with `range`. */
export function setSelection(range) {
    const sel = selection();
    sel.removeAllRanges();
    sel.addRange(range);
}

export function selectionInside(editor) {
    const sel = selection();
    if (!sel || sel.rangeCount === 0) return false;
    return (!!sel.anchorNode && editor.contains(sel.anchorNode)) || (!!sel.focusNode && editor.contains(sel.focusNode));
}

/**
 * 'forward', 'backward' or 'none'. A Range from anchor to focus collapses
 * when focus precedes anchor (setEnd before the start moves the start too).
 */
export function direction() {
    const sel = selection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return 'none';
    const r = document.createRange();
    r.setStart(sel.anchorNode, sel.anchorOffset);
    r.setEnd(sel.focusNode, sel.focusOffset);
    return r.collapsed ? 'backward' : 'forward';
}

export function describeNode(node) {
    if (!node) return '—';
    if (node.nodeType === 3) {
        const t = node.data.trim();
        return `#text "${t.slice(0, 18)}${t.length > 18 ? '…' : ''}"`;
    }
    if (node.nodeType === 1) return `<${node.nodeName.toLowerCase()}${node.id ? '#' + node.id : ''}>`;
    return node.nodeName;
}

/** innerHTML of a fragment, without consuming it. */
export function fragmentHtml(fragment) {
    const div = document.createElement('div');
    div.appendChild(fragment.cloneNode(true));
    return div.innerHTML;
}

const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

/** Everything the inspector shows, or { hasSelection: false }. */
export function metrics(editor) {
    const sel = selection();
    const range = currentRange();
    if (!sel || !range) return { hasSelection: false };

    const ancestor = range.commonAncestorContainer;
    let html;
    try { html = fragmentHtml(range.cloneContents()); } catch (e) { html = `(unavailable: ${e.message})`; }

    return {
        hasSelection: true,
        inEditor: selectionInside(editor),
        selection: {
            anchorNode: describeNode(sel.anchorNode), anchorOffset: sel.anchorOffset,
            focusNode: describeNode(sel.focusNode), focusOffset: sel.focusOffset,
            isCollapsed: sel.isCollapsed, type: sel.type, rangeCount: sel.rangeCount, direction: direction(),
        },
        range: {
            start: describeNode(range.startContainer), startOffset: range.startOffset,
            end: describeNode(range.endContainer), endOffset: range.endOffset,
            ancestor: ancestor.nodeType === 3 ? `#text in ${describeNode(ancestor.parentNode)}` : describeNode(ancestor),
            collapsed: range.collapsed,
            text: range.toString(),
            rects: Array.from(range.getClientRects()).map(round),
            bounding: round(range.getBoundingClientRect()),
            html,
        },
        caret: caretPosition(editor, range),
    };
}

/**
 * Pixel position of the range start. A collapsed range in text reports a
 * zero-width rect AT the caret; a collapsed range between elements may have
 * no geometry, and then this returns null rather than inserting a probe node
 * into the document (which would show up in the MutationObserver log).
 */
export function caretPosition(editor, range) {
    const r = range.cloneRange();
    r.collapse(true);
    const rects = r.getClientRects();
    const rect = rects.length ? rects[0] : r.getBoundingClientRect();
    if (!rect || (rect.x === 0 && rect.y === 0 && rect.height === 0)) return null;
    const box = editor.getBoundingClientRect();
    return {
        viewportX: Math.round(rect.left), viewportY: Math.round(rect.top),
        x: Math.round(rect.left - box.left), y: Math.round(rect.top - box.top),
        height: Math.round(rect.height),
    };
}

// --- content operations ------------------------------------------------------------

function makeElement(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
}

/**
 * Wrap the selection in <tag>. surroundContents throws when the range
 * partially selects a non-text node; then extract + wrap + insert, which is
 * what an editor's "bold" does. Returns 'surround', 'extract' or null.
 */
export function surround(tag, className) {
    const range = currentRange();
    if (!range || range.collapsed) return null;
    const el = makeElement(tag, className);
    try {
        range.surroundContents(el);
        return 'surround';
    } catch (e) {
        const wrap = makeElement(tag, className);
        wrap.appendChild(range.extractContents());
        range.insertNode(wrap);
        return 'extract';
    }
}

/** Remove the selected content into a fragment; returns { fragment, html } or null. */
export function extract() {
    const range = currentRange();
    if (!range || range.collapsed) return null;
    const fragment = range.extractContents();
    return { fragment, html: fragmentHtml(fragment) };
}

/** Copy the selected content into a fragment, leaving the document alone. */
export function clone() {
    const range = currentRange();
    if (!range) return null;
    const fragment = range.cloneContents();
    return { fragment, html: fragmentHtml(fragment) };
}

/** Replace the selection with `node` and put the caret after it. */
export function insertNode(node) {
    const range = currentRange();
    if (!range) return false;
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    setSelection(range);
    return true;
}

export function deleteSelection() {
    const range = currentRange();
    if (!range) return false;
    range.deleteContents();
    return true;
}

export function collapse(toStart) {
    const range = currentRange();
    if (!range) return false;
    range.collapse(toStart);
    setSelection(range);
    return true;
}

// --- semantic selections -------------------------------------------------------------

/** Select the sentence around the anchor, within the anchor's text node. */
export function selectSentence(editor) {
    const sel = selection();
    if (!selectionInside(editor)) return false;
    const anchor = sel.anchorNode;
    const node = anchor.nodeType === 3 ? anchor : anchor.childNodes[sel.anchorOffset] || anchor.firstChild;
    if (!node || node.nodeType !== 3) return false;
    const text = node.data;
    const at = anchor === node ? Math.min(sel.anchorOffset, text.length) : 0;
    let start = 0, end = text.length;
    for (let i = at - 1; i >= 0; i--) {
        if (/[.!?\n]/.test(text[i])) {
            start = i + 1;
            while (start < text.length && /\s/.test(text[start])) start++;
            break;
        }
    }
    for (let i = at; i < text.length; i++) {
        if (/[.!?\n]/.test(text[i])) { end = i + 1; break; }
    }
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    setSelection(r);
    return true;
}

const BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'LI', 'PRE'];

/** Select the contents of the block holding the anchor. */
export function selectParagraph(editor) {
    const sel = selection();
    if (!selectionInside(editor)) return false;
    for (let n = sel.anchorNode; n && n !== editor; n = n.parentNode) {
        if (BLOCKS.includes(n.nodeName)) {
            const r = document.createRange();
            r.selectNodeContents(n);
            setSelection(r);
            return true;
        }
    }
    return false;
}

export function selectAll(editor) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    setSelection(r);
    return true;
}
