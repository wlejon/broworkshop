// test_range.js — Range & Selection Lab, the Range tab: the inspector reads
// the real Selection, and every toolbar operation does what its Range API
// promises to the live document.
//
// Run: scripts/validate.sh demos/range-selection-lab

import { check, eq, test, done, frames, q, text, clickOn, shot } from '/lib/kit/test.js';
import { rangeState, refreshRange } from '/app/range-view.js';
import { currentRange, direction } from '/app/range-ops.js';

frames(4);

const editor = q('#editor');
const sel = window.getSelection();
const textOf = (id) => document.getElementById(id).firstChild;   // first text node of a block

/** Select [a, b) of a text node the way a script would, then let selectionchange land. */
function select(node, a, b, focusNode, focusOffset) {
    sel.setBaseAndExtent(node, a, focusNode || node, focusOffset === undefined ? b : focusOffset);
    frames(1);
    refreshRange();
}

/** A fresh copy of the original document, so each case starts from the same text. */
const ORIGINAL = editor.innerHTML;
function reset() {
    editor.innerHTML = ORIGINAL;
    sel.removeAllRanges();
    frames(1);
}

test('boot: the Range tab is showing and the others are hidden', () => {
    check(/ready/.test(text('#status')), 'status reads ready: ' + text('#status'));
    check(!q('[data-pane="range"]').hidden, 'range pane visible');
    for (const p of ['observer', 'parser', 'shaper']) check(q(`[data-pane="${p}"]`).hidden, p + ' pane hidden');
    eq(text('#selType'), 'None', 'no selection yet');
});

test('tabs switch panes', () => {
    for (const p of ['observer', 'parser', 'shaper', 'range']) {
        clickOn(`#tabs [data-tab="${p}"]`);
        check(!q(`[data-pane="${p}"]`).hidden, p + ' pane shown after its tab click');
        check(q(`#tabs [data-tab="${p}"]`).classList.contains('active'), p + ' tab marked active');
    }
});

test('the inspector reads a forward selection', () => {
    reset();
    const t = textOf('p1');                     // "The "
    const strong = q('#p1 strong').firstChild;  // "DOM Range"
    select(t, 0, 0, strong, 3);
    const m = rangeState.last;
    check(m.hasSelection && m.inEditor, 'selection seen inside the editor');
    eq(text('#selDirection'), 'forward', 'direction');
    eq(text('#selCollapsed'), 'false', 'not collapsed');
    eq(text('#selRangeCount'), '1', 'one range');
    eq(text('#selType'), 'Range', 'Selection.type');
    eq(m.range.text, 'The DOM', 'Range.toString crosses into <strong>');
    eq(text('#rangeLength'), '7 chars', 'length readout');
    check(/<p#p1>/.test(text('#rangeAncestor')), 'common ancestor is the paragraph: ' + text('#rangeAncestor'));
    check(m.range.rects.length >= 1, 'at least one client rect: ' + m.range.rects.length);
    check(m.range.bounding.width > 20, 'bounding box has real width: ' + JSON.stringify(m.range.bounding));
    eq(text('#rangeFragment'), 'The <strong>DOM</strong>',
        'fragment preview clones "The " and the partial <strong>');
});

test('a backward selection reports direction backward', () => {
    const strong = q('#p1 strong').firstChild;
    select(strong, 5, 0, textOf('p1'), 0);   // anchor after "DOM R", focus at paragraph start
    eq(direction(), 'backward', 'direction()');
    eq(text('#selDirection'), 'backward', 'direction readout');
    eq(currentRange().toString(), 'The DOM R', 'the range itself is normalised forward');
});

test('a collapsed caret in text puts the HUD at the caret', () => {
    select(textOf('p2'), 6, 6);
    eq(text('#selCollapsed'), 'true', 'collapsed');
    eq(text('#selType'), 'Caret', 'Selection.type Caret');
    const c = rangeState.last.caret;
    check(c && c.height > 0, 'caret has geometry: ' + JSON.stringify(c));
    check(c.x > 20 && c.y >= 0, 'caret x is inside the editor, past the padding: ' + JSON.stringify(c));
    check(/^x \d+, y \d+/.test(text('#caretCoords')), 'HUD shows it: ' + text('#caretCoords'));
    // The caret rect is in the same viewport space as element rects, menu bar
    // or not: it sits on p2's first line.
    const p2 = q('#p2').getBoundingClientRect();
    check(c.viewportY >= p2.top - 1 && c.viewportY < p2.top + 29,
        `caret viewport y ${c.viewportY} is on p2's first line (top ${p2.top})`);
});

test('a real mouse drag selects text and the inspector follows', () => {
    reset();
    // Coordinates from a Range rect over the first word — the same viewport
    // space the mouse uses.
    const first = document.createRange();
    first.setStart(textOf('p2'), 0);
    first.setEnd(textOf('p2'), 6);
    const b = first.getBoundingClientRect();
    const y = b.top + b.height / 2;
    mouseDown(b.left + 1, y);
    mouseMove(b.left + 30, y);
    mouseMove(b.left + 60, y);
    mouseUp(b.left + 60, y);
    frames(2);
    check(sel.rangeCount === 1 && !sel.isCollapsed, 'the drag made a range selection');
    check(/^Select/.test(sel.toString()), 'it starts at the word the drag started on: ' + JSON.stringify(sel.toString()));
    check(rangeState.last.inEditor && !rangeState.last.selection.isCollapsed, 'the inspector saw it (selectionchange)');
});

test('bold wraps a plain text selection, and the toolbar click keeps it', () => {
    reset();
    const t = textOf('p2');
    select(t, 7, 10);                                   // "any"
    clickOn('#btnBold');                                // lands on the <b> inside the button
    eq(rangeState.lastSurround, 'surround', 'surroundContents succeeded directly');
    const s = q('#p2 strong');
    check(s && s.textContent === 'any', 'the word is wrapped: ' + q('#p2').innerHTML.slice(0, 60));
    eq(sel.toString(), 'any', 'the selection now spans the new <strong>');
});

test('bold wraps a whole-node selection with surroundContents', () => {
    reset();
    const first = textOf('p2').data;
    select(q('#p2'), 0, 0, q('#p2'), 1);                // exactly p2's first text node
    clickOn('#btnBold');
    eq(rangeState.lastSurround, 'surround', 'surroundContents succeeded directly');
    const s = q('#p2').firstElementChild;
    check(s && s.tagName === 'STRONG' && s.textContent === first && q('#p2').firstChild === s,
        'p2 now starts with <strong> around its first text node: ' + q('#p2').innerHTML.slice(0, 60));
});

test('italic, code, mark and badge wrap too', () => {
    for (const [btn, tag, cls] of [['#btnItalic', 'EM'], ['#btnCode', 'CODE'], ['#btnMark', 'MARK'], ['#btnBadge', 'SPAN', 'tag']]) {
        reset();
        select(q('#p1'), 1, 1, q('#p1'), 2);            // exactly <strong>DOM Range</strong>
        clickOn(btn);
        const el = q('#p1').childNodes[1];
        check(el && el.tagName === tag && el.firstElementChild && el.firstElementChild.tagName === 'STRONG' &&
              (!cls || el.classList.contains(cls)),
            `${btn} wrapped the <strong> in <${tag.toLowerCase()}>: ${q('#p1').innerHTML.slice(0, 80)}`);
    }
});

// surroundContents throws InvalidStateError when the range partially selects
// an element, and the app then extracts + wraps.
test('wrapping across an element boundary falls back to extract + wrap', () => {
    reset();
    const em = q('#p2 em').firstChild;                  // "live telemetry"
    select(textOf('p2'), 30, 30, em, 4);                // "…the live" — ends inside <em>
    const want = currentRange().toString();
    clickOn('#btnMark');
    eq(rangeState.lastSurround, 'extract', 'surroundContents threw, the fallback ran');
    const marks = [...q('#p2').querySelectorAll('mark')];
    check(marks.some((m) => m.textContent === want),
        `a <mark> holds exactly ${JSON.stringify(want)}: ${q('#p2').innerHTML.slice(0, 120)}`);
});

test('extract across an element boundary', () => {
    reset();
    select(textOf('p1'), 0, 0, q('#p1 strong').firstChild, 3);   // "The DOM"
    clickOn('#btnExtract');
    eq(rangeState.lastFragment && rangeState.lastFragment.html, 'The <strong>DOM</strong>',
        'extract took "The <strong>DOM</strong>" out');
    check(q('#p1').textContent.startsWith(' Range'), 'p1 now starts " Range": ' +
        JSON.stringify(q('#p1').textContent.slice(0, 20)));
});

test('extract removes the range into a fragment', () => {
    reset();
    const before = q('#p1').textContent;
    select(textOf('p1'), 0, 4);                         // "The "
    clickOn('#btnExtract');
    eq(rangeState.lastFragment.kind, 'extracted', 'kind');
    eq(rangeState.lastFragment.html, 'The ', 'fragment html');
    eq(q('#p1').textContent, before.slice(4), 'the text left the document');
    check(text('#lastFragment').startsWith('[extracted]'), 'the store panel shows it');
});

test('clone copies without touching the document', () => {
    reset();
    const before = editor.innerHTML;
    select(textOf('p1'), 0, 0, q('#p1 strong').firstChild, 9);
    clickOn('#btnClone');
    eq(rangeState.lastFragment.kind, 'cloned', 'kind');
    eq(editor.innerHTML, before, 'document unchanged');
    eq(rangeState.lastFragment.html, 'The <strong>DOM Range</strong>',
        'text@0 -> end of the <strong> text clones the partial <strong>');
    // Element offsets give the same content as whole child nodes.
    select(q('#p1'), 0, 0, q('#p1'), 2);
    clickOn('#btnClone');
    eq(rangeState.lastFragment.html, 'The <strong>DOM Range</strong>', 'element-offset clone');
    check(text('#lastFragment').startsWith('[cloned]'), 'the store panel shows it');
});

test('insert stamp replaces the selection and leaves the caret after it', () => {
    reset();
    select(textOf('p3'), 0, 6);                         // "Check "
    const n = rangeState.stamps;
    clickOn('#btnInsert');
    const stamp = q('#p3 span.tag');
    eq(stamp.textContent, `[stamp #${n + 1}]`, 'numbered stamp inserted');
    check(q('#p3').textContent.startsWith(`[stamp #${n + 1}]out`), 'it replaced "Check ": ' + q('#p3').textContent.slice(0, 30));
    check(sel.isCollapsed, 'caret collapsed');
    const r = currentRange();
    // insertNode at text offset 0 splits the text, leaving an empty text node
    // before the stamp (as Chromium does), so the offset is not fixed.
    check(r.startContainer === q('#p3') && q('#p3').childNodes[r.startOffset - 1] === stamp,
        `caret right after the stamp, got ${r.startContainer.nodeName}@${r.startOffset}`);
});

test('delete removes the selected text', () => {
    reset();
    select(textOf('p1'), 0, 4);
    clickOn('#btnDelete');
    check(q('#p1').textContent.startsWith('DOM Range'), 'p1 starts at DOM Range now');
});

test('collapse to start and to end', () => {
    reset();
    select(textOf('p1'), 2, 10, textOf('p1'), 2);       // placeholder, replaced below
    select(textOf('p2'), 7, 10);
    clickOn('#btnCollapseStart');
    check(sel.isCollapsed && sel.anchorOffset === 7, 'collapsed to start 7, got ' + sel.anchorOffset);
    select(textOf('p2'), 7, 10);
    clickOn('#btnCollapseEnd');
    check(sel.isCollapsed && sel.anchorOffset === 10, 'collapsed to end 10, got ' + sel.anchorOffset);
});

test('sentence selects the sentence around the caret', () => {
    reset();
    const t = q('#p1 code').nextSibling;                // " object, web applications … typography."
    select(t, 10, 10);
    clickOn('#btnSentence');
    eq(sel.toString(), t.data.slice(0, t.data.indexOf('.') + 1),
        'from the node start (no terminator before it in this node) to the full stop');
    select(textOf('p2'), 60, 60);                       // inside the second sentence of p2
    clickOn('#btnSentence');
    check(sel.toString().startsWith('You can test') || /^[A-Z]/.test(sel.toString()),
        'a mid-node sentence starts after the previous terminator and its spaces: ' + JSON.stringify(sel.toString()));
});

test('paragraph selects the whole block', () => {
    reset();
    select(q('#p2 em').firstChild, 2, 2);
    clickOn('#btnParagraph');
    eq(sel.toString(), q('#p2').textContent, 'the whole of p2, from inside its <em>');
    eq(rangeState.last.range.start, '<p#p2>', 'range starts on the paragraph element');
});

test('all selects the editor', () => {
    reset();
    select(textOf('p1'), 1, 1);
    clickOn('#btnAll');
    eq(sel.toString(), editor.textContent, 'selection covers the editor text');
    eq(text('#rangeStart'), '<div#editor>', 'start container is the editor');
});

test('typing into the editor edits the document', () => {
    reset();
    const t = textOf('p1');
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 1);
    const b = r.getBoundingClientRect();
    click(b.left + 1, b.top + b.height / 2);
    frames(1);
    press0('End');
    textInput('Z');
    frames(1);
    check(editor.textContent.includes('Z'), 'the typed character landed in the editor');
    shot('range');
});

function press0(key) {
    const code = { End: 0x4000004d }[key];
    keyDown(code, 0, 0);
    keyUp(code, 0, 0);
    flush();
}

done('range-selection-lab range');
