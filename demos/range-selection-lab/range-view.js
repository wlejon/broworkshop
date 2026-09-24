// range-view.js — the Range & Selection tab: the toolbar over the editor and
// the live Selection / Range inspector beside it.

import { $ } from '/lib/kit/dom.js';
import * as ops from '/app/range-ops.js';

export const rangeState = {
    last: null,          // the last metrics() snapshot rendered
    lastFragment: null,  // { kind: 'extracted'|'cloned', html }
    lastSurround: null,  // 'surround' | 'extract' | null
    stamps: 0,
};

let editor = null, onChange = () => {};

/** Wire the tab. `changed(metrics)` runs after every refresh (the status bar). */
export function initRangeView(changed) {
    editor = $('#editor');
    onChange = changed || onChange;

    const act = (id, fn) => $(id).addEventListener('click', () => { fn(); refreshRange(); });
    const wrap = (tag, cls) => () => { rangeState.lastSurround = ops.surround(tag, cls); };
    act('#btnBold', wrap('strong'));
    act('#btnItalic', wrap('em'));
    act('#btnCode', wrap('code'));
    act('#btnMark', wrap('mark'));
    act('#btnBadge', wrap('span', 'tag'));
    act('#btnExtract', () => keep('extracted', ops.extract()));
    act('#btnClone', () => keep('cloned', ops.clone()));
    act('#btnInsert', () => ops.insertNode(stamp()));
    act('#btnDelete', () => ops.deleteSelection());
    act('#btnCollapseStart', () => ops.collapse(true));
    act('#btnCollapseEnd', () => ops.collapse(false));
    act('#btnSentence', () => ops.selectSentence(editor));
    act('#btnParagraph', () => ops.selectParagraph(editor));
    act('#btnAll', () => ops.selectAll(editor));

    // A toolbar click must not steal the selection it is about to act on.
    for (const b of document.querySelectorAll('#rangeTools button')) {
        b.addEventListener('mousedown', (e) => e.preventDefault());
    }

    document.addEventListener('selectionchange', () => {
        if (ops.selectionInside(editor)) refreshRange();
    });
    editor.addEventListener('input', refreshRange);
    editor.addEventListener('keyup', refreshRange);
    editor.addEventListener('mouseup', refreshRange);
    refreshRange();
}

export function editorEl() { return editor; }

function keep(kind, res) {
    if (!res) return;
    rangeState.lastFragment = { kind, html: res.html };
    $('#lastFragment').textContent = `[${kind}]\n${res.html || '(empty)'}`;
}

function stamp() {
    const s = document.createElement('span');
    s.className = 'tag';
    s.textContent = `[stamp #${++rangeState.stamps}]`;
    return s;
}

const set = (id, v) => { $(id).textContent = String(v); };

/** Re-read the selection and render it. */
export function refreshRange() {
    const m = rangeState.last = ops.metrics(editor);
    if (!m.hasSelection) {
        for (const id of ['#selAnchorNode', '#selAnchorOffset', '#selFocusNode', '#selFocusOffset',
                          '#rangeStart', '#rangeStartOffset', '#rangeEnd', '#rangeEndOffset',
                          '#rangeAncestor', '#rangeLength', '#rangeRects', '#rangeBounding']) set(id, '—');
        set('#selDirection', 'none');
        set('#selCollapsed', '—');
        set('#selRangeCount', 0);
        set('#selType', 'None');
        set('#rangeFragment', '(no selection)');
        set('#caretCoords', '—');
        set('#caretHeight', '—');
        onChange(m);
        return m;
    }
    const s = m.selection, r = m.range;
    set('#selAnchorNode', s.anchorNode);
    set('#selAnchorOffset', s.anchorOffset);
    set('#selFocusNode', s.focusNode);
    set('#selFocusOffset', s.focusOffset);
    set('#selDirection', s.direction);
    set('#selCollapsed', s.isCollapsed);
    $('#selCollapsed').className = s.isCollapsed ? '' : 'ok';
    set('#selRangeCount', s.rangeCount);
    set('#selType', s.type);

    set('#rangeStart', r.start);
    set('#rangeStartOffset', r.startOffset);
    set('#rangeEnd', r.end);
    set('#rangeEndOffset', r.endOffset);
    set('#rangeAncestor', r.ancestor);
    set('#rangeLength', `${r.text.length} chars`);
    set('#rangeRects', `${r.rects.length} rect(s)`);
    const b = r.bounding;
    set('#rangeBounding', `(${b.x}, ${b.y}) ${b.width}×${b.height}`);
    set('#rangeFragment', r.html || '(empty)');

    const c = m.caret;
    set('#caretCoords', c ? `x ${c.x}, y ${c.y} in the editor (viewport ${c.viewportX}, ${c.viewportY})` : '—');
    set('#caretHeight', c ? `${c.height}px` : '—');
    onChange(m);
    return m;
}
