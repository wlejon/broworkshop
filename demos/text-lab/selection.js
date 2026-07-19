// selection.js — Range and Selection, asserted against non-BMP text.
//
// THE ONE CLAIM THIS MODULE EXISTS FOR:
//
//   Range and Selection offsets are UTF-16 CODE UNITS at the JS boundary,
//   always, even though the engine stores text as UTF-8 and computes with byte
//   offsets throughout.
//
// That is not a style preference, it is the DOM spec, and it matters because
// the oracle for every check below is then a plain JS string operation. If
// `r.setStart(t, i); r.setEnd(t, j); r.toString()` does not equal
// `s.slice(i, j)` for EVERY pair of code-unit boundaries i ≤ j, the conversion
// is wrong somewhere, and there is no ambiguity about which side is at fault.
//
// WHY ASCII TESTS CANNOT CATCH THIS. For ASCII the two encodings are the same
// numbers, so a binding that forgot to convert passes everything. The bug
// surfaces on the first é, and it surfaces in a particularly confusing way:
// the offsets look plausible (they are small integers in roughly the right
// place) and the text comes out slightly wrong. Engine commits cea3b60f and
// fabf2c6b are exactly this.
//
// THE FIXTURE. One string that breaks a different assumption at each position:
//
//   a b   1 byte / 1 unit    the case that hides the bug
//   é ü   2 bytes / 1 unit   bytes run ahead of units
//   中 文  3 bytes / 1 unit   bytes run further ahead
//   𝄞     4 bytes / 2 units  units run ahead too, in the OTHER direction
//   😀    4 bytes / 2 units  the same, in the astral plane people notice
//   👨‍👩‍👦   ZWJ sequence       three astral code points joined by two ZWJs:
//                            18 bytes, 8 units, 1 user-perceived character
//   ֑ over א                  Hebrew + a combining accent: RTL and non-spacing
//
// Every offset used below is a code-point boundary of that string, computed —
// never typed as a literal, because a literal would encode this file's own
// idea of the encoding rather than testing the engine's.

import {
    el, n2, buildTable, verdict, utf8Length, codePoints, u8ToU16, u16ToU8,
} from '/app/textutil.js';
import { MIXED } from '/app/bidi.js';

/** The torture string. Built from escapes so this file's own bytes are ASCII. */
export const S =
    'ab' +
    'éü' +          // é ü — 2 bytes each
    '中文' +          // 中 文 — 3 bytes each
    '\u{1D11E}' +             // 𝄞 MUSICAL SYMBOL G CLEF — astral
    '\u{1F600}' +             // 😀 — astral
    '\u{1F468}‍\u{1F469}‍\u{1F466}' +   // 👨‍👩‍👦 ZWJ family
    'א֑' +          // א + Hebrew accent ETNAHTA — RTL + combining
    'z';

/** Every code-point boundary of S, plus its end. The only legal offsets. */
export const BOUNDARIES = (() => {
    const b = [];
    for (let i = 0; i < S.length;) {
        b.push(i);
        i += S.codePointAt(i) > 0xFFFF ? 2 : 1;
    }
    b.push(S.length);
    return b;
})();

export const selectionState = {
    roundTrip: null,
    surrogate: null,
    slices: null,
    containers: null,
    geometry: null,
    api: null,
    editable: null,
};

// ── Scratch DOM ─────────────────────────────────────────────────────────────

let stage = null;

function freshText(s) {
    stage.innerHTML = '';
    const t = document.createTextNode(s === undefined ? S : s);
    stage.appendChild(t);
    if (typeof flush === 'function') flush();
    return t;
}

function freshHTML(html) {
    stage.innerHTML = html;
    if (typeof flush === 'function') flush();
    return stage;
}

// ── 1. Offset round-trip over every boundary pair ───────────────────────────
//
// The exhaustive one. |BOUNDARIES|² pairs, each checked for three things: the
// offsets come back as they went in, `collapsed` agrees with i === j, and the
// text equals the JS slice. Exhaustive rather than sampled because the failure
// modes are positional — a conversion that is right for the first astral code
// point and wrong for the second is a real and likely bug.

export function roundTripReport() {
    const t = freshText();
    let pairs = 0;
    const failures = [];
    for (const i of BOUNDARIES) {
        for (const j of BOUNDARIES) {
            if (j < i) continue;
            pairs++;
            const r = document.createRange();
            r.setStart(t, i);
            r.setEnd(t, j);
            const want = S.slice(i, j);
            const got = r.toString();
            if (r.startOffset !== i) {
                failures.push({ i, j, what: 'startOffset', want: i, got: r.startOffset });
            }
            if (r.endOffset !== j) {
                failures.push({ i, j, what: 'endOffset', want: j, got: r.endOffset });
            }
            if (r.collapsed !== (i === j)) {
                failures.push({ i, j, what: 'collapsed', want: i === j, got: r.collapsed });
            }
            if (got !== want) {
                failures.push({ i, j, what: 'toString', want, got });
            }
        }
    }
    return {
        text: S,
        utf16: S.length,
        bytes: utf8Length(S),
        codePoints: codePoints(S).length,
        boundaries: BOUNDARIES.slice(),
        pairs,
        failures,
        ok: failures.length === 0,
    };
}

// ── 2. The offsets that are NOT boundaries ──────────────────────────────────
//
// Half of a surrogate pair is a legal UTF-16 index and an illegal caret
// position. What an engine does with it is a real design question, and the
// answer must at least be SAFE: whatever offset comes back, the text the Range
// covers must be well-formed — no lone surrogate, no U+FFFD.
//
// This is not asserted as "it must clamp down" or "it must clamp up", because
// the DOM spec permits an offset inside a pair (JS strings do). What is
// asserted is that nothing downstream produces mojibake.

export function surrogateSplitReport() {
    const t = freshText();
    const rows = [];
    for (let i = 0; i < S.length; i++) {
        if (BOUNDARIES.indexOf(i) !== -1) continue;   // legal boundary, skip
        const r = document.createRange();
        r.setStart(t, 0);
        r.setEnd(t, i);
        const got = r.toString();
        const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(got);
        rows.push({
            offset: i,
            endOffset: r.endOffset,
            text: got,
            replacement: got.indexOf('�') !== -1,
            loneSurrogate: lone,
            ok: got.indexOf('�') === -1,
        });
    }
    return {
        rows,
        // The engine must never manufacture a replacement character out of a
        // mid-pair offset. A lone surrogate is arguably faithful; U+FFFD is a
        // silent corruption.
        ok: rows.every((r) => r.ok),
    };
}

// ── 3. Element containers are child indices, not text offsets ───────────────
//
// The conversion must apply to Text and Comment containers ONLY. An offset
// into an element container is a CHILD INDEX, and running it through a UTF-16
// → byte conversion produces a number that is silently wrong whenever any
// child contains a multi-byte character. This is the exact shape of bug that
// a blanket "convert all offsets" fix introduces.

export function containerReport() {
    freshHTML('<span>\u{1F600}</span><span>中</span><span>x</span>');
    const rows = [];

    {
        const r = document.createRange();
        r.setStart(stage, 1);
        r.setEnd(stage, 3);
        rows.push({
            what: 'element container child indices pass through unconverted',
            want: '1..3 → "中x"',
            got: `${r.startOffset}..${r.endOffset} → ${JSON.stringify(r.toString())}`,
            ok: r.startOffset === 1 && r.endOffset === 3 && r.toString() === '中x',
        });
    }

    {
        // selectNodeContents on an element: end offset is the CHILD COUNT.
        const r = document.createRange();
        r.selectNodeContents(stage);
        rows.push({
            what: 'selectNodeContents(element) end offset is the child count',
            want: '0..3',
            got: `${r.startOffset}..${r.endOffset}`,
            ok: r.startOffset === 0 && r.endOffset === stage.childNodes.length,
        });
    }

    {
        // selectNodeContents on a Text node: end offset is the UTF-16 LENGTH,
        // not the byte length. For S those differ by a lot, which is the point.
        const t = freshText();
        const r = document.createRange();
        r.selectNodeContents(t);
        rows.push({
            what: 'selectNodeContents(text) end offset is the UTF-16 length, not the byte length',
            want: `${S.length} (bytes would be ${utf8Length(S)})`,
            got: String(r.endOffset),
            ok: r.endOffset === S.length && r.toString() === S,
        });
    }

    {
        // Out of range clamps to the code-unit length. Clamping to the byte
        // length would be an offset past the end of the string.
        const t = freshText();
        const r = document.createRange();
        r.setStart(t, 0);
        r.setEnd(t, 9999);
        rows.push({
            what: 'an out-of-range end clamps to the UTF-16 length',
            want: String(S.length),
            got: String(r.endOffset),
            ok: r.endOffset === S.length,
        });
    }

    {
        // selectNode (as opposed to its contents) puts the range in the
        // PARENT's child-index space.
        freshHTML('<b>a\u{1F600}</b><i>b</i>');
        const b = stage.querySelector('b');
        const r = document.createRange();
        r.selectNode(b);
        rows.push({
            what: 'selectNode uses the parent\'s child-index space',
            want: '0..1 → "a\u{1F600}"',
            got: `${r.startOffset}..${r.endOffset} → ${JSON.stringify(r.toString())}`,
            ok: r.startOffset === 0 && r.endOffset === 1 && r.toString() === 'a\u{1F600}',
        });
    }

    return { rows, ok: rows.every((r) => r.ok) };
}

// ── 4. The Selection API surface, over non-BMP text ─────────────────────────
//
// Every mutator the task names, driven at astral offsets: collapse, extend,
// setBaseAndExtent, addRange, removeAllRanges, getRangeAt, selectAllChildren,
// collapseToStart/End, containsNode. The oracle is the JS slice throughout.

export function selectionApiReport() {
    const t = freshText();
    const sel = window.getSelection();
    const rows = [];
    const add = (what, ok, want, got) => rows.push({ what, ok, want, got });

    const emoji = S.indexOf('\u{1F600}');
    const clef = S.indexOf('\u{1D11E}');
    const family = S.indexOf('\u{1F468}');

    // setBaseAndExtent at every boundary pair — the same exhaustive sweep the
    // Range got, because Selection has its own conversion path.
    {
        let bad = 0;
        let example = null;
        for (const i of BOUNDARIES) {
            for (const j of BOUNDARIES) {
                sel.removeAllRanges();
                sel.setBaseAndExtent(t, i, t, j);
                const lo = Math.min(i, j), hi = Math.max(i, j);
                const want = S.slice(lo, hi);
                if (sel.anchorOffset !== i || sel.focusOffset !== j || sel.toString() !== want) {
                    bad++;
                    if (!example) {
                        example = `(${i},${j}) → anchor ${sel.anchorOffset} focus ` +
                                  `${sel.focusOffset} text ${JSON.stringify(sel.toString())} ` +
                                  `want ${JSON.stringify(want)}`;
                    }
                }
            }
        }
        add(`setBaseAndExtent round-trips at all ${BOUNDARIES.length}² boundary pairs`,
            bad === 0, '0 failures', bad === 0 ? '0 failures' : `${bad} failures, e.g. ${example}`);
    }

    // getRangeAt hands back the SAME UTF-16 numbers, normalised to start ≤ end.
    {
        sel.removeAllRanges();
        sel.setBaseAndExtent(t, S.length, t, emoji);   // backwards on purpose
        const r = sel.getRangeAt(0);
        add('getRangeAt normalises a backwards selection and keeps UTF-16 offsets',
            r.startOffset === emoji && r.endOffset === S.length,
            `${emoji}..${S.length}`, `${r.startOffset}..${r.endOffset}`);
    }

    // collapse at an astral start.
    {
        sel.collapse(t, emoji);
        add('collapse() at an astral code point start',
            sel.anchorOffset === emoji && sel.focusOffset === emoji && sel.isCollapsed,
            `${emoji},${emoji},collapsed`,
            `${sel.anchorOffset},${sel.focusOffset},${sel.isCollapsed ? 'collapsed' : 'not'}`);
    }

    // extend from there to the end.
    {
        sel.extend(t, S.length);
        add('extend() to the end covers exactly the JS slice',
            sel.focusOffset === S.length && sel.toString() === S.slice(emoji),
            JSON.stringify(S.slice(emoji)), JSON.stringify(sel.toString()));
    }

    // createRange + addRange feeds UTF-16 straight back.
    {
        sel.removeAllRanges();
        const r = document.createRange();
        r.setStart(t, clef);
        r.setEnd(t, clef + 2);
        sel.addRange(r);
        add('createRange + addRange keeps UTF-16 offsets and selects one astral code point',
            sel.anchorOffset === clef && sel.focusOffset === clef + 2 &&
            sel.toString() === '\u{1D11E}',
            `${clef}..${clef + 2} → "\u{1D11E}"`,
            `${sel.anchorOffset}..${sel.focusOffset} → ${JSON.stringify(sel.toString())}`);
    }

    // The ZWJ family: 8 code units, 3 astral code points, 2 ZWJs, ONE thing
    // a user would call a character. Selecting it must give all 8 units.
    {
        sel.removeAllRanges();
        const r = document.createRange();
        r.setStart(t, family);
        r.setEnd(t, family + 8);
        sel.addRange(r);
        const want = S.slice(family, family + 8);
        add('a ZWJ sequence selects as 8 code units / 18 bytes / 1 grapheme',
            sel.toString() === want && utf8Length(sel.toString()) === 18,
            `${want.length} units, 18 bytes`,
            `${sel.toString().length} units, ${utf8Length(sel.toString())} bytes`);
    }

    // collapseToStart / collapseToEnd land on the range ends, not on bytes.
    {
        sel.removeAllRanges();
        sel.setBaseAndExtent(t, clef, t, family);
        sel.collapseToStart();
        const atStart = sel.anchorOffset;
        sel.removeAllRanges();
        sel.setBaseAndExtent(t, clef, t, family);
        sel.collapseToEnd();
        add('collapseToStart/End land on the range\'s UTF-16 ends',
            atStart === clef && sel.anchorOffset === family,
            `${clef} / ${family}`, `${atStart} / ${sel.anchorOffset}`);
    }

    // removeAllRanges really empties it.
    {
        sel.removeAllRanges();
        add('removeAllRanges empties the selection',
            sel.rangeCount === 0 && sel.toString() === '',
            'rangeCount 0', `rangeCount ${sel.rangeCount}`);
    }

    // selectAllChildren over a subtree with astral content.
    {
        freshHTML('<b>a\u{1F600}</b><i>中</i>');
        sel.selectAllChildren(stage);
        add('selectAllChildren covers a mixed subtree',
            sel.toString() === 'a\u{1F600}中',
            '"a\u{1F600}中"', JSON.stringify(sel.toString()));
    }

    // containsNode over the same subtree.
    {
        const b = stage.querySelector('b');
        const i = stage.querySelector('i');
        add('containsNode sees both children of the selected subtree',
            sel.containsNode(b, true) === true && sel.containsNode(i, true) === true,
            'true/true',
            `${sel.containsNode(b, true)}/${sel.containsNode(i, true)}`);
    }

    return { rows, ok: rows.every((r) => r.ok) };
}

// ── 5. Range geometry ───────────────────────────────────────────────────────
//
// getBoundingClientRect over a Range is where the UTF-16 domain meets the
// layout domain, and it is the only part of this module that is expected to
// go red — for the reasons app.js already records under `rtl-range-geometry`.
//
// The claims, all of them stated as they SHOULD hold:
//
//   1. A range over more characters is at least as wide as a range over
//      fewer. (Monotone in the character count, within one directional run.)
//   2. The rects of adjacent single-character ranges tile the run: each one's
//      right edge is the next one's left edge, within an LTR run.
//   3. A COLLAPSED range reports a zero-width rect AT THE CARET — not at the
//      document origin. A rect of {0,0,0,0} is indistinguishable from "no
//      geometry" and is what the engine currently returns.
//   4. Inside an RTL run, single-character rects tile RIGHT to LEFT.
//
// Claim 3 and claim 4 are the known ones. They are still asserted.

export function geometryReport() {
    const rows = [];

    // Claim 1 + 2, over pure LTR with astral content. Pinned font.
    freshHTML('<span id="selGeomLtr">ab\u{1F600}cd</span>');
    const ltr = document.getElementById('selGeomLtr');
    const ltrText = ltr.firstChild;
    const ltrChars = Array.from(ltrText.data);   // code points, not units
    let u = 0;
    const ltrRects = ltrChars.map((ch) => {
        const r = document.createRange();
        r.setStart(ltrText, u);
        r.setEnd(ltrText, u + ch.length);
        u += ch.length;
        const b = r.getBoundingClientRect();
        return { ch, left: b.left, right: b.right, width: b.width };
    });
    const tiles = ltrRects.every((r, i) =>
        i === 0 || Math.abs(r.left - ltrRects[i - 1].right) < 0.5);
    const positive = ltrRects.every((r) => r.width > 0);
    rows.push({
        what: 'single-character Range rects tile an LTR run left to right',
        ok: tiles && positive,
        want: 'each rect starts where the previous ended, all widths > 0',
        got: ltrRects.map((r) => `${r.ch}[${n2(r.left)}–${n2(r.right)}]`).join(' '),
    });

    // Monotone in the character count.
    {
        const widths = [];
        for (let n = 1; n <= ltrText.data.length; n++) {
            const r = document.createRange();
            r.setStart(ltrText, 0);
            r.setEnd(ltrText, n);
            widths.push(r.getBoundingClientRect().width);
        }
        const mono = widths.every((w, i) => i === 0 || w >= widths[i - 1] - 1e-6);
        rows.push({
            what: 'Range width is non-decreasing as the end offset grows',
            ok: mono,
            want: 'monotone',
            got: widths.map(n2).join(' ≤ '),
        });
    }

    // Claim 3: a collapsed range's rect is AT the caret.
    let collapsedAtOrigin = [];
    {
        const probes = [0, 2, 4, ltrText.data.length];
        const got = [];
        for (const at of probes) {
            const r = document.createRange();
            r.setStart(ltrText, at);
            r.setEnd(ltrText, at);
            const b = r.getBoundingClientRect();
            const origin = b.left === 0 && b.top === 0 && b.width === 0 && b.height === 0;
            if (origin) collapsedAtOrigin.push(at);
            got.push(`${at}:{${n2(b.left)},${n2(b.top)},${n2(b.width)}×${n2(b.height)}}`);
        }
        const host = ltr.getBoundingClientRect();
        rows.push({
            what: 'a collapsed Range reports a zero-width rect AT the caret, not at {0,0}',
            ok: collapsedAtOrigin.length === 0,
            want: `left within the span's box [${n2(host.left)}–${n2(host.right)}], height > 0`,
            got: got.join(' '),
        });
    }

    // Claim 4: inside an RTL run, rects tile right to left.
    freshHTML('<span id="selGeomRtl">' + MIXED + '</span>');
    const rtlSpan = document.getElementById('selGeomRtl');
    const rtlText = rtlSpan.firstChild;
    // MIXED is 'abc אבג def' — the Hebrew occupies UTF-16 4..7.
    const heb = [];
    for (let i = 4; i < 7; i++) {
        const r = document.createRange();
        r.setStart(rtlText, i);
        r.setEnd(rtlText, i + 1);
        const b = r.getBoundingClientRect();
        heb.push({ i, ch: rtlText.data[i], left: b.left, right: b.right, width: b.width });
    }
    const rtlTiles = heb.every((r, k) =>
        k === 0 || Math.abs(r.right - heb[k - 1].left) < 0.5);
    const rtlPositive = heb.every((r) => r.width > 0);
    rows.push({
        what: 'inside an RTL run, successive single-character rects tile RIGHT to LEFT',
        ok: rtlTiles && rtlPositive,
        want: 'each rect\'s right edge is the previous rect\'s left edge, widths > 0',
        got: heb.map((r) => `u16 ${r.i}[${n2(r.left)}–${n2(r.right)}]`).join(' '),
    });

    // And a range over the WHOLE RTL run must have positive width — it covers
    // three visible letters.
    {
        const r = document.createRange();
        r.setStart(rtlText, 4);
        r.setEnd(rtlText, 7);
        const b = r.getBoundingClientRect();
        rows.push({
            what: 'a Range over the whole RTL run has positive width',
            ok: b.width > 0,
            want: '> 0',
            got: `${n2(b.width)} at {${n2(b.left)},${n2(b.top)}}`,
        });
    }

    return {
        rows,
        collapsedAtOrigin,
        ok: rows.every((r) => r.ok),
    };
}

// ── 6. Selection inside a contenteditable host ──────────────────────────────
//
// Everything above ran over inert text. A contenteditable host is the case
// that matters, because there the Selection is not just a query result — it is
// the caret, and the engine reads it back on every keystroke. So the offsets
// have to survive a round trip THROUGH the editing path, not just in and out
// of the binding.

export function editableSelectionReport() {
    const rows = [];
    stage.innerHTML =
        '<div id="selEd" contenteditable="true" class="edit-host" ' +
        'style="font-family:Arial;font-size:20px"></div>';
    if (typeof flush === 'function') flush();
    const ed = document.getElementById('selEd');
    const tn = document.createTextNode(S);
    ed.appendChild(tn);
    if (typeof flush === 'function') flush();

    const sel = window.getSelection();
    const emoji = S.indexOf('\u{1F600}');

    // A caret seated at an astral boundary, then typed at: the insertion must
    // land exactly there. A double conversion (UTF-16 → byte → UTF-16 → byte)
    // puts it somewhere plausible-looking and wrong.
    if (typeof textInput === 'function') {
        sel.removeAllRanges();
        sel.collapse(tn, emoji);
        if (typeof flush === 'function') flush();
        textInput('Z');
        if (typeof flush === 'function') flush();
        const want = S.slice(0, emoji) + 'Z' + S.slice(emoji);
        rows.push({
            what: 'typing at a caret seated on an astral boundary inserts exactly there',
            ok: ed.textContent === want,
            want: JSON.stringify(want),
            got: JSON.stringify(ed.textContent),
        });
        rows.push({
            what: 'and the caret reported back afterwards is still UTF-16',
            ok: sel.anchorOffset === emoji + 1,
            want: String(emoji + 1),
            got: String(sel.anchorOffset),
        });
    }

    // A selection spanning element boundaries inside the host.
    stage.innerHTML =
        '<div id="selEd2" contenteditable="true" class="edit-host" ' +
        'style="font-family:Arial;font-size:20px">' +
        '<b>a\u{1F600}</b><i>中b</i></div>';
    if (typeof flush === 'function') flush();
    const ed2 = document.getElementById('selEd2');
    const bText = ed2.querySelector('b').firstChild;
    const iText = ed2.querySelector('i').firstChild;
    {
        const r = document.createRange();
        r.setStart(bText, 1);          // after 'a', before the emoji
        r.setEnd(iText, 1);            // after 中
        sel.removeAllRanges();
        sel.addRange(r);
        if (typeof flush === 'function') flush();
        rows.push({
            what: 'a cross-element selection reads out as the concatenated text',
            ok: sel.toString() === '\u{1F600}中',
            want: '"\u{1F600}中"',
            got: JSON.stringify(sel.toString()),
        });
        rows.push({
            what: 'and its commonAncestorContainer is the editing host',
            ok: sel.getRangeAt(0).commonAncestorContainer === ed2,
            want: '<div id=selEd2>',
            got: sel.getRangeAt(0).commonAncestorContainer === ed2 ? '<div id=selEd2>' : 'other',
        });
    }

    // getBoundingClientRect over a cross-element range must at least land
    // inside the host's own box. This is a weak claim on purpose — the strong
    // ones are in geometryReport() — but it catches a rect computed in the
    // wrong coordinate space entirely.
    {
        const hostBox = ed2.getBoundingClientRect();
        const b = sel.getRangeAt(0).getBoundingClientRect();
        const inside = b.width > 0 && b.left >= hostBox.left - 1 &&
                       b.right <= hostBox.right + 1;
        rows.push({
            what: 'a cross-element Range rect lies within the host\'s box',
            ok: inside,
            want: `within [${n2(hostBox.left)}–${n2(hostBox.right)}]`,
            got: `[${n2(b.left)}–${n2(b.right)}] w=${n2(b.width)}`,
        });
    }

    return { rows, ok: rows.every((r) => r.ok) };
}

// ── Panel ───────────────────────────────────────────────────────────────────

let cpHost = null;
let rtHost = null;
let surrHost = null;
let contHost = null;
let apiHost = null;
let geomHost = null;
let edHost = null;

function renderRows(host, rows) {
    host.textContent = '';
    for (const r of rows) {
        const line = el('div', 'checkline ' + (r.ok ? 'ok' : 'bad'));
        line.appendChild(el('b', null, (r.ok ? '✓ ' : '✗ ') + r.what));
        if (!r.ok) {
            line.appendChild(el('span', 'want', ' want ' + r.want));
            line.appendChild(el('span', 'got', ' got ' + r.got));
        } else {
            line.appendChild(el('span', 'got', '  ' + r.got));
        }
        host.appendChild(line);
    }
}

export function initSelection() {
    stage = document.getElementById('selStage');
    cpHost = document.getElementById('selFixture');
    rtHost = document.getElementById('selRoundTrip');
    surrHost = document.getElementById('selSurrogate');
    contHost = document.getElementById('selContainers');
    apiHost = document.getElementById('selApi');
    geomHost = document.getElementById('selGeometry');
    edHost = document.getElementById('selEditable');

    // The fixture, drawn code point by code point. Reused from the cluster
    // panel's presentation so the two halves of the lab look like one app.
    cpHost.textContent = '';
    for (const c of codePoints(S)) {
        const hex = c.cp.toString(16).toUpperCase().padStart(4, '0');
        const cell = el('span', 'cp' + (c.cp >= 0x10000 ? ' astral' : ''));
        cell.appendChild(el('b', null, c.char === '‍' ? '⌁' : c.char));
        cell.appendChild(el('i', null, `${c.u16}/${c.u8}`));
        cell.title = `U+${hex} — utf16 offset ${c.u16} (${c.u16Len} unit(s)), ` +
                     `utf8 offset ${c.u8} (${c.u8Len} byte(s))`;
        cpHost.appendChild(cell);
    }

    refreshSelection();
}

export function refreshSelection() {
    const rt = roundTripReport();
    selectionState.roundTrip = rt;
    rtHost.textContent =
        `Fixture: ${rt.utf16} UTF-16 units, ${rt.codePoints} code points, ${rt.bytes} UTF-8 bytes ` +
        `→ ${rt.boundaries.length} legal offsets → ${rt.pairs} ordered pairs checked. ` +
        `Each pair asserted for startOffset, endOffset, collapsed and toString() against ` +
        `the JS slice. ` +
        (rt.ok
            ? 'Every pair agrees — Range offsets are UTF-16 code units end to end.'
            : `${rt.failures.length} failure(s): ` +
              rt.failures.slice(0, 4).map((f) =>
                  `(${f.i},${f.j}) ${f.what} want ${JSON.stringify(f.want)} got ${JSON.stringify(f.got)}`).join('; '));
    rtHost.className = 'result ' + (rt.ok ? 'ok' : 'bad');

    const su = surrogateSplitReport();
    selectionState.surrogate = su;
    surrHost.textContent =
        `${su.rows.length} offset(s) of the fixture fall INSIDE a surrogate pair. ` +
        `The DOM permits them (JS string indices do), so the claim is not that they ` +
        `are rejected but that nothing downstream manufactures a U+FFFD out of one. ` +
        su.rows.map((r) => `${r.offset}→${r.endOffset}${r.replacement ? ' U+FFFD!' : ''}`).join(' ') +
        (su.ok ? ' — no replacement characters produced.' : ' — REPLACEMENT CHARACTERS PRODUCED.');
    surrHost.className = 'result ' + (su.ok ? 'ok' : 'bad');

    const cont = containerReport();
    selectionState.containers = cont;
    renderRows(contHost, cont.rows);

    const api = selectionApiReport();
    selectionState.api = api;
    renderRows(apiHost, api.rows);

    const geom = geometryReport();
    selectionState.geometry = geom;
    renderRows(geomHost, geom.rows);

    const ed = editableSelectionReport();
    selectionState.editable = ed;
    renderRows(edHost, ed.rows);

    // Leave no stray selection pointing into a node we are about to destroy.
    window.getSelection().removeAllRanges();
    stage.innerHTML = '';
    if (typeof flush === 'function') flush();
}
