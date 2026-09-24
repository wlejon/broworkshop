// editing.js — contenteditable scenarios, driven the way a user drives them.
//
// An editor holds THREE coordinate systems in agreement at once:
//
//   UTF-8 BYTES        what the engine stores (dom::Text::data)
//   UTF-16 CODE UNITS  Selection.anchorOffset / Range.startOffset, per spec
//   CLUSTERS           where a caret may actually sit
//
// Every bug hunted here is a place where two of them were confused: a ±1
// through a byte offset lands inside a character, a UTF-16 offset fed to a
// byte API lands somewhere unrelated, a code-point step splits base + mark.
//
// Where bro gets something wrong, a report states the CORRECT answer and
// marks itself failed; there is no column holding bro's current behaviour.
// All driving goes through input.js (headless injection only).

import { utf8Length, codePoints, u8ToU16, u16ToU8, caretStops } from '/lib/kit/text.js';
import { n2 } from '/app/report.js';
import { MIXED, MIXED_RTL_FIRST } from '/app/bidi.js';
import { CAN_DRIVE, K, pump, press, typeText, clickInto, caretAt, hostIn, hostOpts, arrowWalk, reveal } from '/app/input.js';

// --- hosts ---------------------------------------------------------------------

let stage = null;

/** The scratch element the scenarios build their hosts in. */
export function setStage(el) { stage = el; }
export function clearStage() { stage.innerHTML = ''; pump(); }

/** A fresh editable host in this module's stage. */
export function freshHost(html, opts) {
    return hostIn(stage, html, opts);
}

/** A fresh NON-editable div: the control case for every editable claim. */
export function freshPlain(html) {
    stage.innerHTML = '<div class="edit-host" style="font-family:Arial;font-size:20px">' +
        (html === undefined ? '' : html) + '</div>';
    reveal(stage);
    return stage.querySelector('.edit-host');
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- 1. arrow keys step whole characters ----------------------------------------
//
// The caret is stored as a byte offset, so a raw ±1 lands INSIDE a multi-byte
// character; the binding then clamps it back on the way out, and from JS the
// key simply looks dead over accented text. The oracle is caretStops() — the
// shaper's own answer via bro.text.clusterRange — so the key handler and the
// shaper must name the same positions.

export const STEP_SAMPLES = [
    { id: 'ascii', label: 'plain ASCII', text: 'abcd',
      why: 'bytes, code units and clusters all coincide — the case that lets a byte-stepping bug ship' },
    { id: 'cjk', label: 'CJK (3 bytes each)', text: 'a日本b',
      why: 'each ideograph is 1 code unit but 3 bytes: a byte step lands 2 bytes short of the next character' },
    { id: 'accent', label: 'precomposed accent', text: 'café',
      why: 'é is 1 code unit, 2 bytes — the cheapest way to break an editor tested in English' },
    { id: 'combining', label: 'combining acute (base + mark)', text: 'café',
      why: 'e + U+0301 is TWO code points the user sees as ONE character; a caret between them is inside a letter' },
    { id: 'astral', label: 'astral emoji', text: 'a\u{1F600}b',
      why: 'the emoji is 2 UTF-16 units and 4 UTF-8 bytes — the systems disagree in OPPOSITE directions' },
    { id: 'astral2', label: 'two astral emoji', text: '\u{1F600}\u{1F389}',
      why: 'back-to-back surrogate pairs: an off-by-one produces an unpaired surrogate' },
];

/** RIGHT across `sample.text`, then LEFT back: the stops must be the shaper's and must retrace. */
export function arrowSteppingReport(sample) {
    if (!CAN_DRIVE) return null;
    const text = sample.text;
    const ed = freshHost(text);
    // Start from a caret the engine itself placed, then pin it to 0 for
    // determinism (the click's landing point depends on the font).
    clickInto(ed, 4, 6);
    caretAt(ed.firstChild, 0);
    const { forward, backward } = arrowWalk(text);
    const shaperStops = caretStops(text, hostOpts()).map((b) => u8ToU16(text, b));
    const cpStarts = new Set(codePoints(text).map((c) => c.u16));
    cpStarts.add(text.length);
    return {
        id: sample.id, label: sample.label, text, why: sample.why,
        utf16: text.length, bytes: utf8Length(text),
        forward, backward, shaperStops,
        symmetric: same(forward, backward),
        reachedEnd: forward[forward.length - 1] === text.length,
        reachedStart: backward[0] === 0,
        onCodePointBoundaries: forward.every((o) => cpStarts.has(o)),
        noSplitSurrogates: forward.every((o) => u8ToU16(text, u16ToU8(text, o)) === o),
        matchesShaper: same(forward, shaperStops),
        monotonic: forward.every((o, i) => i === 0 || o > forward[i - 1]),
    };
}

export function steppingReportAll() {
    return CAN_DRIVE ? STEP_SAMPLES.map(arrowSteppingReport) : null;
}

// --- 2. Backspace and Delete across element boundaries -------------------------
//
// At offset 0 or the end of a node, deletion is a TREE operation: find the
// neighbouring leaf inside the host, delete from it, drop an emptied inline
// and merge the text it separated — without ever walking out of the host.
// Cases assert innerHTML, not just textContent: the difficulty is structural.

export const BOUNDARY_CASES = [
    { id: 'bs-into-prev', label: 'Backspace at offset 0 of <i> reaches into <b>',
      html: '<b>foo</b><i>bar</i>',
      why: 'the caret starts one inline and the character to remove lives in another node',
      run: (ed) => { caretAt(ed.querySelector('i').firstChild, 0); press(K.BACKSPACE); },
      wantHTML: '<b>fo</b><i>bar</i>', wantText: 'fobar', wantFocusOffset: 2 },
    { id: 'del-into-next', label: 'Delete at the end of <b> reaches into <i>',
      html: '<b>foo</b><i>bar</i>',
      why: 'the mirror image and a separate code path: forward deletion walks to the NEXT leaf',
      run: (ed) => { const b = ed.querySelector('b').firstChild; caretAt(b, b.data.length); press(K.DELETE); },
      wantHTML: '<b>foo</b><i>ar</i>', wantText: 'fooar' },
    { id: 'empty-inline-dropped', label: 'Emptying an inline removes it and merges its neighbours',
      html: 'ab<b>c</b>ef',
      why: 'an empty <b> left behind is invisible but splits the text into three nodes forever',
      run: (ed) => { caretAt(ed.querySelector('b').firstChild, 1); press(K.BACKSPACE); },
      wantHTML: 'abef', wantText: 'abef', wantChildCount: 1, wantFocusOffset: 2 },
    { id: 'merge-then-type', label: 'Typing at the join after a merge lands between the old halves',
      html: 'ab<b>c</b>ef',
      why: 'proves the merge left one real text node with a valid caret in it',
      run: (ed) => { caretAt(ed.querySelector('b').firstChild, 1); press(K.BACKSPACE); typeText('-'); },
      wantText: 'ab-ef' },
    { id: 'nested-inline', label: 'Backspace out of a nested inline finds the leaf, not the parent',
      html: '<b>x<i>y</i></b>z',
      why: "the previous leaf is a sibling of the caret's GRANDPARENT — a sibling-only walk misses it",
      run: (ed) => { caretAt(ed.querySelector('i').firstChild, 0); press(K.BACKSPACE); },
      wantText: 'yz' },
    { id: 'multibyte-across', label: 'Cross-node deletion takes a whole multi-byte character',
      html: '<b>a日</b><i>b</i>',
      why: 'crossing a node boundary AND a 3-byte character; byte arithmetic leaves invalid UTF-8',
      run: (ed) => { caretAt(ed.querySelector('i').firstChild, 0); press(K.BACKSPACE); },
      wantText: 'ab' },
    { id: 'astral-across', label: 'Cross-node deletion takes a whole surrogate pair',
      html: '<b>a\u{1F600}</b><i>b</i>',
      why: 'the same at 4 bytes / 2 code units — a half-deleted pair shows up as U+FFFD',
      run: (ed) => { caretAt(ed.querySelector('i').firstChild, 0); press(K.BACKSPACE); },
      wantText: 'ab' },
    { id: 'host-start-noop', label: 'Backspace at the host start does not escape the host',
      html: 'xy', outside: true,
      why: 'editing must never reach text outside the contenteditable subtree',
      run: (ed) => { caretAt(ed.firstChild, 0); press(K.BACKSPACE); },
      wantText: 'xy', wantOutside: 'beforexyafter' },
    { id: 'host-end-noop', label: 'Delete at the host end does not escape the host',
      html: 'xy', outside: true,
      why: 'the forward mirror of the containment claim',
      run: (ed) => { caretAt(ed.firstChild, 2); press(K.DELETE); },
      wantText: 'xy', wantOutside: 'beforexyafter' },
    { id: 'br-symmetry', label: 'Enter inserts a <br>; Backspace takes it back',
      html: '',
      why: 'the one structural node the editor creates: if it can make one it must unmake one',
      run: (ed) => {
          clickInto(ed, 4, 6);
          typeText('a');
          press(K.RETURN);
          typeText('b');
          press(K.BACKSPACE);   // "b"
          press(K.BACKSPACE);   // the <br>
      },
      wantText: 'a', wantNoBr: true },
];

export function boundaryReport() {
    if (!CAN_DRIVE) return null;
    return BOUNDARY_CASES.map((c) => {
        let ed;
        if (c.outside) {
            stage.innerHTML = 'before<div contenteditable="true" class="edit-host" ' +
                'style="font-family:Arial;font-size:20px">' + c.html + '</div>after';
            pump();
            ed = stage.querySelector('.edit-host');
        } else {
            ed = freshHost(c.html);
        }
        let threw = null;
        try { c.run(ed); } catch (e) { threw = String(e && e.message ? e.message : e); }

        const gotHTML = ed.innerHTML, gotText = ed.textContent;
        const sel = window.getSelection();
        const checks = [];
        const check = (name, want, got) => checks.push({ name, want, got, ok: want === got });
        if (c.wantHTML !== undefined) check('innerHTML', c.wantHTML, gotHTML);
        if (c.wantText !== undefined) check('textContent', c.wantText, gotText);
        if (c.wantChildCount !== undefined) check('childNodes', String(c.wantChildCount), String(ed.childNodes.length));
        if (c.wantFocusOffset !== undefined) check('focusOffset', String(c.wantFocusOffset), String(sel.focusOffset));
        if (c.wantOutside !== undefined) check('stage text', c.wantOutside, stage.textContent);
        if (c.wantNoBr) check('no <br> left', '0 br', ed.querySelectorAll('br').length + ' br');
        // A U+FFFD is the signature of a byte-wise cut through a multi-byte sequence.
        check('well-formed', 'clean', gotText.indexOf('�') === -1 ? 'clean' : 'U+FFFD present');
        return {
            id: c.id, label: c.label, why: c.why, html: c.html,
            gotHTML, gotText, threw, checks,
            ok: threw === null && checks.every((k) => k.ok),
        };
    });
}

// --- 3. clicking a host with no text to hit plants a caret ----------------------
//
// The press path hit-tests for a text run; finding none, it used to drop the
// selection, so clicking an empty editable box focused it and swallowed every
// keystroke. The real assertion is that TYPING WORKS afterwards.

export function emptyHostReport() {
    if (!CAN_DRIVE) return null;
    const rows = [];
    const sel = window.getSelection();
    const fromClick = (html, dx, dy) => {
        const ed = freshHost(html);
        sel.removeAllRanges();
        pump();
        clickInto(ed, dx, dy);
        return { ed, rangeCount: sel.rangeCount, onHost: sel.focusNode === ed, collapsed: sel.isCollapsed };
    };

    {
        const r = fromClick('', 20, 10);
        typeText('hi');
        rows.push({ id: 'empty', label: 'empty host', why: 'no text node exists to hit',
            rangeCount: r.rangeCount, onHost: r.onHost, collapsed: r.collapsed, typed: r.ed.textContent,
            ok: r.rangeCount === 1 && r.collapsed && r.ed.textContent === 'hi',
            want: 'rangeCount 1, caret on the host element, typing lands "hi"' });
    }
    {
        const r = fromClick('<br>', 40, 8);
        typeText('z');
        rows.push({ id: 'br-only', label: 'host containing only a <br>',
            why: 'there is a box to hit but no text run inside it',
            rangeCount: r.rangeCount, onHost: true, collapsed: true, typed: r.ed.textContent,
            ok: r.rangeCount === 1 && r.ed.textContent === 'z', want: 'rangeCount 1 and typing lands "z"' });
    }
    {
        const r = fromClick('abc', 400, 40);
        typeText('!');
        rows.push({ id: 'past-text', label: 'click past the end of the text',
            why: 'every run misses, but placing the caret at the nearest position beats dropping it',
            rangeCount: r.rangeCount, onHost: r.onHost, collapsed: true, typed: r.ed.textContent,
            ok: r.rangeCount === 1 && r.ed.textContent === 'abc!', want: 'rangeCount 1 and typing appends: "abc!"' });
    }
    {
        // The control: a NON-editable div that hits no text. The caret goes
        // into the div the user clicked (Chromium's answer) — never into text
        // elsewhere, such as the editable host a moment ago.
        const plain = freshPlain('');
        const other = document.getElementById('editLive');
        if (other && other.firstChild) caretAt(other.firstChild, 0);
        clickInto(plain, 20, 10);
        const inPlain = sel.rangeCount > 0 && plain.contains(sel.anchorNode);
        rows.push({ id: 'plain', label: 'non-editable empty div (control)',
            why: 'a plain div that hits no text takes the caret itself; the text elsewhere is not a target',
            rangeCount: sel.rangeCount, onHost: inPlain, collapsed: sel.rangeCount ? sel.isCollapsed : null, typed: '—',
            ok: inPlain && sel.isCollapsed, want: 'a collapsed caret inside the clicked div, not in text elsewhere' });
    }
    return rows;
}

// --- 4. editing inside bidi text -------------------------------------------------
//
// bro's arrow keys move LOGICALLY, as every browser does: LEFT is "previous
// character in the string", which inside an RTL run is visually rightward.
// The fixtures are the bidi panel's, so a disagreement here is an EDITING bug.

export const RTL_SAMPLES = [
    { id: 'mixed', label: 'LTR base, RTL run', text: MIXED, dir: 'ltr', rtlSpan: [4, 7],
      why: 'the primary bidi fixture: the Hebrew occupies UTF-16 4–7 and renders reversed in the middle' },
    { id: 'rtlFirst', label: 'RTL first', text: MIXED_RTL_FIRST, dir: 'ltr', rtlSpan: [0, 3],
      why: 'an RTL run at offset 0 of an LTR paragraph: the caret starts at the RIGHT edge of the first run' },
    { id: 'rtlBase', label: 'RTL paragraph direction', text: MIXED, dir: 'rtl', rtlSpan: [4, 7],
      why: 'direction:rtl changes the levels and the visual order, but not the LOGICAL offsets the arrows walk' },
];

/**
 * RIGHT always increases the offset and LEFT decreases it, every RTL letter
 * is one stop, the stops are the shaper's, Backspace in the RTL run removes
 * one whole letter, and typing inside it lands at the logical offset.
 */
export function rtlEditingReport(sample) {
    if (!CAN_DRIVE) return null;
    const { text, dir } = sample;
    const ed = freshHost(text, { dir });
    caretAt(ed.firstChild, 0);
    const { forward, backward } = arrowWalk(text);
    const shaperStops = caretStops(text, hostOpts()).map((b) => u8ToU16(text, b));

    const [rs, re] = sample.rtlSpan;
    const ed2 = freshHost(text, { dir });
    caretAt(ed2.firstChild, re);
    press(K.BACKSPACE);
    const afterBs = ed2.textContent, wantBs = text.slice(0, re - 1) + text.slice(re);

    const ed3 = freshHost(text, { dir });
    caretAt(ed3.firstChild, rs + 1);
    typeText('X');
    const afterType = ed3.textContent, wantType = text.slice(0, rs + 1) + 'X' + text.slice(rs + 1);

    return {
        id: sample.id, label: sample.label, text, dir, why: sample.why,
        utf16: text.length, bytes: utf8Length(text),
        forward, backward, shaperStops,
        symmetric: same(forward, backward),
        matchesShaper: same(forward, shaperStops),
        rightIncreases: forward.every((o, i) => i === 0 || o > forward[i - 1]),
        reachedEnd: forward[forward.length - 1] === text.length,
        rtlStopCount: forward.filter((o) => o >= rs && o <= re).length,
        wantRtlStopCount: re - rs + 1,
        afterBackspace: afterBs, wantBackspace: wantBs, backspaceOk: afterBs === wantBs,
        afterType, wantType, typeOk: afterType === wantType,
        wellFormed: afterBs.indexOf('�') === -1 && afterType.indexOf('�') === -1,
    };
}

export function rtlReportAll() {
    return CAN_DRIVE ? RTL_SAMPLES.map(rtlEditingReport) : null;
}

// --- 5. caret geometry across a direction boundary -----------------------------
//
// A collapsed Range's rect at each logical offset of MIXED. Inside the RTL
// run x must FALL as the offset rises; no rect may sit at {0,0}.
//
// The two DIRECTION-BOUNDARY offsets (4: space|alef, 7: gimel|space) are
// genuinely ambiguous: each has two visual candidates, the run's left and
// right edge, and under any consistent affinity (upstream or downstream,
// Chromium's included) both boundaries resolve to the SAME edge. So the
// claim there is that each boundary offset sits on an edge of the RTL run,
// and that only boundary offsets ever share an x; a shared x anywhere else is
// a caret the user could not place.
// Works without injection: it only reads layout.

export function caretGeometryReport() {
    const text = MIXED;
    const tn = freshHost(text).firstChild;
    const rectOf = (a, b) => {
        const r = document.createRange();
        r.setStart(tn, a);
        r.setEnd(tn, b);
        return r.getBoundingClientRect();
    };
    const rows = [];
    for (let i = 0; i <= text.length; i++) {
        const box = rectOf(i, i);
        rows.push({
            u16: i, byte: u16ToU8(text, i), ch: i < text.length ? text[i] : '∅',
            x: box.left, width: box.width,
            atOrigin: box.left === 0 && box.top === 0 && box.width === 0 && box.height === 0,
        });
    }
    // 'abc אבג def': UTF-16 0–3 LTR, 4–7 Hebrew, 8–11 LTR.
    const RS = 4, RE = 7, BOUNDARY = [RS, RE];
    const run = rectOf(RS, RE);
    const rises = (a) => a.every((r, i) => i === 0 || r.x > a[i - 1].x);
    const falls = (a) => a.every((r, i) => i === 0 || r.x < a[i - 1].x);
    const onEdge = (x) => Math.abs(x - run.left) < 0.5 || Math.abs(x - run.right) < 0.5;
    const inside = (x) => x > run.left + 0.5 && x < run.right - 0.5;
    const byX = new Map();
    for (const r of rows) {
        const k = n2(r.x);
        if (!byX.has(k)) byX.set(k, []);
        byX.get(k).push(r.u16);
    }
    const shared = [...byX.entries()].filter(([, v]) => v.length > 1).map(([x, offsets]) => ({ x, offsets }));
    const boundaryShares = shared.filter((c) => c.offsets.every((o) => BOUNDARY.includes(o)));
    const collisions = shared.filter((c) => !boundaryShares.includes(c));
    const originRects = rows.filter((r) => r.atOrigin).map((r) => r.u16);
    const interior = rows.slice(RS + 1, RE);
    const ltrHeadRises = rises(rows.slice(0, RS)), ltrTailRises = rises(rows.slice(RE + 1));
    const rtlFalls = falls(interior) && interior.every((r) => inside(r.x));
    const boundariesOnEdges = BOUNDARY.every((o) => onEdge(rows[o].x));
    return {
        text, rows, run: { left: run.left, right: run.right },
        ltrHeadRises, rtlFalls, ltrTailRises, boundariesOnEdges,
        boundaryShares, collisions, noCollisions: collisions.length === 0,
        originRects, noOriginRects: originRects.length === 0,
        ok: ltrHeadRises && rtlFalls && ltrTailRises && boundariesOnEdges &&
            collisions.length === 0 && originRects.length === 0,
    };
}
