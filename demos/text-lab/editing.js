// editing.js — contenteditable, driven the way a user drives it.
//
// THE POINT OF THIS MODULE, AND OF THE WHOLE EDITING HALF:
//
// The first five modules of this lab read the text stack. They call
// bro.text.shape(), take Range rects, measure canvases — all of it
// observation. Nothing in them ever changed a character of text.
//
// Editing is the other half of a text engine and it is where the interesting
// failures live, because an editor has to hold THREE coordinate systems in
// agreement at once:
//
//   UTF-8 BYTES        what the engine stores and what dom::Text::data holds
//   UTF-16 CODE UNITS  what Selection.anchorOffset and Range.startOffset are,
//                      per spec, at the JS boundary
//   CLUSTERS           what a caret may actually sit on, because caret
//                      geometry has to land on a glyph edge
//
// Every bug this module hunts is a place where two of those three were
// confused. A ±1 through a byte offset lands inside a multi-byte character. A
// UTF-16 offset fed to a byte-domain API lands somewhere unrelated. A
// code-point step across a base+mark pair puts the caret inside a letter the
// user sees as one thing.
//
// HOW IT DRIVES. Everything goes through the headless injection surface —
// keyDown/keyUp, textInput, mouseDown/mouseUp — never through a synthesised
// DOM event and never by calling an engine internal. That is deliberate: the
// engine's key handler, its hit test, its focus resolution and its
// contenteditable mutation path are exactly what is under test, and
// `el.dispatchEvent(new KeyboardEvent(...))` would skip all four. In a
// windowed run those globals do not exist; the scenario tables then report
// `injection unavailable` and the live playground below them is driven by the
// human instead.
//
// WHAT IT REFUSES TO DO. Where bro gets something wrong, the report states the
// CORRECT answer and marks itself failed. There is no "expected" column
// holding bro's actual behaviour. The failures surface in the panel, in the
// smoke test, and in app.js's knownLimitations() — which recomputes them live,
// so fixing the engine turns them green by itself.

import {
    el, n2, buildTable, verdict, utf8Length, codePoints, codePointLabels,
    u8ToU16, u16ToU8,
} from '/app/textutil.js';
import { caretStops, stepForward, stepBackward } from '/app/clusters.js';
import { MIXED, MIXED_RTL_FIRST } from '/app/bidi.js';

// ── SDL keycodes ────────────────────────────────────────────────────────────
//
// keyDown/keyUp take raw SDL keycodes, which is the right level: the engine's
// key handler is what maps them to editing commands, and a test that called a
// higher-level helper would not be testing that mapping.

export const K = {
    BACKSPACE: 8,
    TAB: 9,
    RETURN: 13,
    DELETE: 127,
    LEFT: 0x40000050,
    RIGHT: 0x4000004F,
    UP: 0x40000052,
    DOWN: 0x40000051,
    HOME: 0x4000004A,
    END: 0x4000004D,
    Z: 122,
    Y: 121,
    A: 97,
};

export const MOD = {
    NONE: 0,
    LSHIFT: 0x0001,
    LCTRL: 0x0040,
};

// ── The injection harness ───────────────────────────────────────────────────
//
// One place that knows whether we can drive the engine, so no scenario has to
// guard individually. `available` is checked once at module load; the headless
// globals are installed before any app script runs.

export const INJECT = {
    keys: typeof keyDown === 'function' && typeof keyUp === 'function',
    text: typeof textInput === 'function',
    mouse: typeof mouseDown === 'function' && typeof mouseUp === 'function',
    ime: typeof imeCompose === 'function',
    clipboard: typeof copy === 'function' && typeof paste === 'function',
    flush: typeof flush === 'function',
};

/** True when the engine can be driven from script — i.e. we are headless. */
export const CAN_DRIVE = INJECT.keys && INJECT.text && INJECT.mouse;

/** Pump pending JS jobs. The input helpers auto-flush; DOM writes do not. */
export function pump() {
    if (INJECT.flush) flush();
}

/** A full key press. `mod` is an SDL modifier mask. */
export function press(key, mod) {
    keyDown(key, 0, mod || 0);
    keyUp(key, 0, mod || 0);
    pump();
}

/** Type a string one character at a time, the way an SDL text-input run does. */
export function typeText(str) {
    for (const ch of Array.from(str)) textInput(ch);
    pump();
}

/** Ctrl+Z / Ctrl+Y — the editing history keys the engine binds. */
export function undoKey() { press(K.Z, MOD.LCTRL); }
export function redoKey() { press(K.Y, MOD.LCTRL); }
export function redoShiftZKey() { press(K.Z, MOD.LCTRL | MOD.LSHIFT); }

// ── Hosts ───────────────────────────────────────────────────────────────────
//
// Every scenario gets a FRESH host, because contenteditable state is not just
// the DOM: focus, the Selection, and the per-host undo stack all persist, and
// a scenario that inherited any of them would be testing the previous
// scenario's leftovers.
//
// This rebuilds innerHTML — the one thing the house rules forbid per FRAME.
// It is fine per REFRESH: a refresh is a user action or a test step, not a
// 60 Hz loop, and there is no other way to get a genuinely fresh undo stack.

let stage = null;

/**
 * A fresh contenteditable host inside an arbitrary stage element.
 *
 * Exported because undo.js, ime.js and clipboard.js all need exactly this and
 * each owns its own stage — one definition of "a clean editable host" across
 * the whole editing half means a scenario that behaves differently in two
 * panels is a real difference, not a setup difference.
 *
 * The font is pinned inline rather than by class, because several scenarios
 * cross-check caret offsets against `caretStops()` — the shaper's own answer
 * for the same string — and that comparison is only meaningful if layout and
 * the shaping call used the same font descriptor.
 */
export function hostIn(stageEl, html, opts) {
    const o = opts || {};
    // No id: several stages are alive at once and duplicate ids in one
    // document are their own class of bug. Scoped querySelector instead.
    stageEl.innerHTML =
        '<div contenteditable="true" class="edit-host"' +
        ' style="font-family:' + (o.family || 'Arial') + ';' +
        'font-size:' + (o.size || 20) + 'px;' +
        (o.dir ? 'direction:' + o.dir + ';' : '') +
        '">' + (html === undefined ? '' : html) + '</div>';
    pump();
    return stageEl.querySelector('.edit-host');
}

/** hostIn() against this module's own stage. */
export function freshHost(html, opts) {
    return hostIn(stage, html, opts);
}

/** A fresh NON-editable div — the control case for every editable claim. */
export function freshPlain(html) {
    stage.innerHTML =
        '<div class="edit-host" style="font-family:Arial;font-size:20px">' +
        (html === undefined ? '' : html) + '</div>';
    pump();
    return stage.querySelector('.edit-host');
}

/** The shaping options matching a host built by freshHost(). */
export function hostOpts(opts) {
    const o = opts || {};
    return { family: o.family || 'Arial', size: o.size || 20 };
}

// ── Caret / selection helpers ───────────────────────────────────────────────

/**
 * Seat the caret at UTF-16 offset `off` of `node`.
 *
 * Note this goes through the DOM Selection API, which means the offset crosses
 * the UTF-16 → byte conversion on the way in. Scenarios that want to prove
 * that conversion is right use it deliberately; scenarios that want a caret
 * without depending on it click instead.
 */
export function caretAt(node, off) {
    const sel = window.getSelection();
    sel.collapse(node, off);
    pump();
    return sel;
}

export function selectIn(node, a, b) {
    const sel = window.getSelection();
    sel.setBaseAndExtent(node, a, node, b);
    pump();
    return sel;
}

/** Click `dx,dy` into an element's box, through the real hit-test path. */
export function clickInto(element, dx, dy) {
    const r = element.getBoundingClientRect();
    mouseDown(r.left + (dx === undefined ? 4 : dx), r.top + (dy === undefined ? 4 : dy));
    mouseUp(r.left + (dx === undefined ? 4 : dx), r.top + (dy === undefined ? 4 : dy));
    pump();
}

/** Everything about the current Selection worth putting in a panel. */
export function selectionSnapshot() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return { rangeCount: 0, text: '', collapsed: null, anchorOffset: null,
                 focusOffset: null, anchorName: '—', focusName: '—' };
    }
    return {
        rangeCount: sel.rangeCount,
        anchorOffset: sel.anchorOffset,
        focusOffset: sel.focusOffset,
        anchorName: nodeName(sel.anchorNode),
        focusName: nodeName(sel.focusNode),
        collapsed: sel.isCollapsed,
        text: sel.toString(),
    };
}

export function nodeName(node) {
    if (!node) return '—';
    if (node.nodeType === 3) return '#text("' + node.data.slice(0, 12) + '")';
    return '<' + (node.tagName || '?').toLowerCase() + '>';
}

// ── State ───────────────────────────────────────────────────────────────────

export const editState = {
    available: CAN_DRIVE,
    stepping: null,
    boundary: null,
    emptyHost: null,
    rtl: null,
    caretGeometry: null,
    live: null,
};

// ── 1. Arrow keys step whole characters, not bytes ──────────────────────────
//
// Engine commit fd4f2524. The failure it fixed is specific and nasty: the
// caret is stored as a byte offset, so a raw ±1 lands INSIDE a multi-byte
// character. The JS binding then clamps that back to a code-point boundary on
// the way out, so from JS the caret simply appears not to move — the key is
// "dead" over accented text and the user has no idea why.
//
// The oracle here is deliberately NOT a hardcoded offset list. It is
// `caretStops()` from clusters.js — the shaper's own answer for the same
// string in the same font, computed through bro.text.clusterRange(). So this
// is a cross-seam agreement check: the key handler and the shaper must name
// the same set of positions. A hardcoded list would pass for an engine whose
// key handler and shaper disagreed in matching ways.

export const STEP_SAMPLES = [
    {
        id: 'ascii', label: 'plain ASCII', text: 'abcd',
        why: 'the degenerate case where bytes, code units and clusters all coincide — ' +
             'and therefore the case that lets a byte-stepping bug ship',
    },
    {
        id: 'cjk', label: 'CJK (3 bytes each)', text: 'a日本b',
        why: 'each ideograph is 1 code unit but 3 bytes: a byte step lands 2 bytes ' +
             'short of the next character',
    },
    {
        id: 'accent', label: 'precomposed accent', text: 'café',
        why: 'é is 1 code unit, 2 bytes — the cheapest way to break an editor ' +
             'written and tested in English',
    },
    {
        id: 'combining', label: 'combining acute (base + mark)', text: 'café',
        why: 'e + U+0301 is TWO code points the user sees as ONE character. A caret ' +
             'between them is inside a letter, so a correct editor never stops there',
    },
    {
        id: 'astral', label: 'astral emoji', text: 'a\u{1F600}b',
        why: 'the emoji is 2 UTF-16 units and 4 UTF-8 bytes — the two systems ' +
             'disagree in OPPOSITE directions across it',
    },
    {
        id: 'astral2', label: 'two astral emoji', text: '\u{1F600}\u{1F389}',
        why: 'back-to-back surrogate pairs: an off-by-one here produces an unpaired ' +
             'surrogate, which is how emoji get mangled',
    },
];

/**
 * Walk the caret right across `text` with the RIGHT arrow, then left back with
 * LEFT, recording every offset it visits.
 *
 * Four claims come out of this:
 *   forward  — the stops it visits going right
 *   backward — going left must retrace them EXACTLY (an editor whose two
 *              directions disagree has two different notions of "character")
 *   onCodePointBoundaries — no stop may split a code point
 *   matchesShaper — the set must equal what the shaper says the caret stops are
 */
export function arrowSteppingReport(sample) {
    if (!CAN_DRIVE) return null;
    const text = sample.text;
    const opts = hostOpts();
    const ed = freshHost(text, opts);
    const tn = ed.firstChild;
    const sel = window.getSelection();

    // Start from a CLICK rather than a script-seeded caret where we can, so
    // the walk begins from a caret the engine itself established. Then pin it
    // to 0 for determinism — the click's landing point depends on the font.
    clickInto(ed, 4, 6);
    caretAt(tn, 0);

    const forward = [0];
    let guard = 0;
    while (guard++ < 64) {
        press(K.RIGHT);
        const at = sel.focusOffset;
        // The end is a fixed point: pressing right there must not move and
        // must not wrap. Two identical readings mean we are done.
        if (at === forward[forward.length - 1]) break;
        forward.push(at);
        if (at >= text.length) break;
    }

    // And back. Note the caret is wherever forward left it — at the end.
    const backward = [sel.focusOffset];
    guard = 0;
    while (guard++ < 64) {
        press(K.LEFT);
        const at = sel.focusOffset;
        if (at === backward[backward.length - 1]) break;
        backward.push(at);
        if (at <= 0) break;
    }
    backward.reverse();

    // The shaper's independent answer, converted from bytes to code units.
    const shaperStops = caretStops(text, opts).map((b) => u8ToU16(text, b));

    // Code-point starts, plus the end. A stop anywhere else is inside a
    // character.
    const cpStarts = new Set(codePoints(text).map((c) => c.u16));
    cpStarts.add(text.length);

    const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    return {
        id: sample.id, label: sample.label, text, why: sample.why,
        utf16: text.length,
        bytes: utf8Length(text),
        forward,
        backward,
        shaperStops,
        symmetric: eq(forward, backward),
        reachedEnd: forward[forward.length - 1] === text.length,
        reachedStart: backward[0] === 0,
        onCodePointBoundaries: forward.every((o) => cpStarts.has(o)),
        // A surrogate pair spans offsets n and n+1; a stop at n+1 splits it.
        // Detected by the round trip through the byte domain being identity.
        noSplitSurrogates: forward.every((o) => u8ToU16(text, u16ToU8(text, o)) === o),
        matchesShaper: eq(forward, shaperStops),
        // Every arrow press must make progress until the end. A caret that
        // stops moving early is the fd4f2524 symptom exactly.
        monotonic: forward.every((o, i) => i === 0 || o > forward[i - 1]),
    };
}

export function steppingReportAll() {
    if (!CAN_DRIVE) return null;
    return STEP_SAMPLES.map(arrowSteppingReport);
}

// ── 2. Backspace and Delete across element boundaries ───────────────────────
//
// Engine commit 71d5e794. Within one text node deletion is arithmetic on a
// string. At offset 0, or at the end of a node, it is a TREE operation: find
// the previous leaf inside the editing host, delete from its tail, and if that
// empties an inline, remove the inline and merge the text nodes it separated —
// without ever walking out of the host.
//
// Each case below asserts the resulting innerHTML, not just textContent,
// because the whole difficulty is structural. "The characters are gone" is
// true of an implementation that also destroyed the markup.

export const BOUNDARY_CASES = [
    {
        id: 'bs-into-prev',
        label: 'Backspace at offset 0 of <i> reaches into <b>',
        html: '<b>foo</b><i>bar</i>',
        why: 'the classic cross-node case: the caret is at the start of one inline ' +
             'and the character to remove lives in a different node entirely',
        run: (ed) => {
            caretAt(ed.querySelector('i').firstChild, 0);
            press(K.BACKSPACE);
        },
        wantHTML: '<b>fo</b><i>bar</i>',
        wantText: 'fobar',
        wantFocusOffset: 2,
    },
    {
        id: 'del-into-next',
        label: 'Delete at the end of <b> reaches into <i>',
        html: '<b>foo</b><i>bar</i>',
        why: 'the mirror image, and a separate code path — forward deletion has to ' +
             'find the NEXT leaf, which is a different tree walk',
        run: (ed) => {
            const b = ed.querySelector('b').firstChild;
            caretAt(b, b.data.length);
            press(K.DELETE);
        },
        wantHTML: '<b>foo</b><i>ar</i>',
        wantText: 'fooar',
    },
    {
        id: 'empty-inline-dropped',
        label: 'Emptying an inline removes it and merges its neighbours',
        html: 'ab<b>c</b>ef',
        why: 'the structural case. An empty <b> left behind is invisible but real: ' +
             'it splits the text into three nodes forever and every subsequent ' +
             'offset computation has to cope with it',
        run: (ed) => {
            caretAt(ed.querySelector('b').firstChild, 1);
            press(K.BACKSPACE);
        },
        wantHTML: 'abef',
        wantText: 'abef',
        wantChildCount: 1,
        wantFocusOffset: 2,
    },
    {
        id: 'merge-then-type',
        label: 'Typing at the join after a merge lands between the old halves',
        html: 'ab<b>c</b>ef',
        why: 'proves the merge produced a real single text node with a valid caret ' +
             'in it, rather than a plausible-looking textContent',
        run: (ed) => {
            caretAt(ed.querySelector('b').firstChild, 1);
            press(K.BACKSPACE);
            typeText('-');
        },
        wantText: 'ab-ef',
    },
    {
        id: 'nested-inline',
        label: 'Backspace out of a nested inline finds the leaf, not the parent',
        html: '<b>x<i>y</i></b>z',
        why: 'the previous leaf is a sibling of the caret\'s GRANDPARENT — a walk ' +
             'that only looks at siblings misses it',
        run: (ed) => {
            caretAt(ed.querySelector('i').firstChild, 0);
            press(K.BACKSPACE);
        },
        wantText: 'yz',
    },
    {
        id: 'multibyte-across',
        label: 'Cross-node deletion takes a whole multi-byte character',
        html: '<b>a日</b><i>b</i>',
        why: 'the two bugs compounded: crossing a node boundary AND crossing a ' +
             '3-byte character. Byte arithmetic here leaves invalid UTF-8',
        run: (ed) => {
            caretAt(ed.querySelector('i').firstChild, 0);
            press(K.BACKSPACE);
        },
        wantText: 'ab',
    },
    {
        id: 'astral-across',
        label: 'Cross-node deletion takes a whole surrogate pair',
        html: '<b>a\u{1F600}</b><i>b</i>',
        why: 'same again at 4 bytes / 2 code units — a half-deleted pair shows up ' +
             'as U+FFFD and is unrecoverable',
        run: (ed) => {
            caretAt(ed.querySelector('i').firstChild, 0);
            press(K.BACKSPACE);
        },
        wantText: 'ab',
    },
    {
        id: 'host-start-noop',
        label: 'Backspace at the host start does not escape the host',
        html: 'xy',
        why: 'the containment claim. Editing must never reach text outside the ' +
             'contenteditable subtree, however the tree is walked',
        outside: true,
        run: (ed) => {
            caretAt(ed.firstChild, 0);
            press(K.BACKSPACE);
        },
        wantText: 'xy',
        wantOutside: 'beforexyafter',
    },
    {
        id: 'host-end-noop',
        label: 'Delete at the host end does not escape the host',
        html: 'xy',
        why: 'the forward mirror of the containment claim',
        outside: true,
        run: (ed) => {
            caretAt(ed.firstChild, 2);
            press(K.DELETE);
        },
        wantText: 'xy',
        wantOutside: 'beforexyafter',
    },
    {
        id: 'br-symmetry',
        label: 'Enter inserts a <br>; Backspace takes it back',
        html: '',
        why: 'the only structural node the editor creates. If it can make one it ' +
             'must be able to unmake one, or the document accumulates them',
        run: (ed) => {
            clickInto(ed, 4, 6);
            typeText('a');
            press(K.RETURN);
            typeText('b');
            press(K.BACKSPACE);   // removes "b"
            press(K.BACKSPACE);   // removes the <br>
        },
        wantText: 'a',
        wantNoBr: true,
    },
];

export function boundaryReport() {
    if (!CAN_DRIVE) return null;
    return BOUNDARY_CASES.map((c) => {
        let ed;
        if (c.outside) {
            stage.innerHTML =
                'before<div contenteditable="true" class="edit-host" ' +
                'style="font-family:Arial;font-size:20px">' + c.html + '</div>after';
            pump();
            ed = stage.querySelector('.edit-host');
        } else {
            ed = freshHost(c.html);
        }

        let threw = null;
        try {
            c.run(ed);
        } catch (e) {
            threw = String(e && e.message ? e.message : e);
        }

        const gotHTML = ed.innerHTML;
        const gotText = ed.textContent;
        const sel = window.getSelection();
        const checks = [];
        if (c.wantHTML !== undefined) {
            checks.push({ name: 'innerHTML', want: c.wantHTML, got: gotHTML,
                          ok: gotHTML === c.wantHTML });
        }
        if (c.wantText !== undefined) {
            checks.push({ name: 'textContent', want: c.wantText, got: gotText,
                          ok: gotText === c.wantText });
        }
        if (c.wantChildCount !== undefined) {
            checks.push({ name: 'childNodes', want: String(c.wantChildCount),
                          got: String(ed.childNodes.length),
                          ok: ed.childNodes.length === c.wantChildCount });
        }
        if (c.wantFocusOffset !== undefined) {
            checks.push({ name: 'focusOffset', want: String(c.wantFocusOffset),
                          got: String(sel.focusOffset),
                          ok: sel.focusOffset === c.wantFocusOffset });
        }
        if (c.wantOutside !== undefined) {
            checks.push({ name: 'stage text', want: c.wantOutside, got: stage.textContent,
                          ok: stage.textContent === c.wantOutside });
        }
        if (c.wantNoBr) {
            checks.push({ name: 'no <br> left', want: 'none',
                          got: ed.querySelectorAll('br').length + ' br',
                          ok: ed.querySelector('br') === null });
        }
        // Nothing may leave a replacement character behind: that is the
        // signature of a byte-wise cut through a multi-byte sequence.
        checks.push({ name: 'well-formed', want: 'no U+FFFD',
                      got: gotText.indexOf('�') === -1 ? 'clean' : 'U+FFFD present',
                      ok: gotText.indexOf('�') === -1 });

        return {
            id: c.id, label: c.label, why: c.why, html: c.html,
            gotHTML, gotText, threw, checks,
            ok: threw === null && checks.every((k) => k.ok),
        };
    });
}

// ── 3. Clicking a host with no text to hit plants a caret ───────────────────
//
// Engine commit ef70a208. The press path hit-tests for a text run and, finding
// none, used to fall through to removeAllRanges(). The user-visible result:
// clicking an empty editable box focused it, showed nothing, and swallowed
// every keystroke. It looked like the field was broken rather than like the
// caret was missing, which is why it survived so long.
//
// The real assertion is not "rangeCount === 1". It is that TYPING WORKS
// afterwards, with no script intervention — that is the property the user
// actually has.

export function emptyHostReport() {
    if (!CAN_DRIVE) return null;
    const rows = [];

    // (a) A genuinely empty host: no text node exists to hit at all.
    {
        const ed = freshHost('');
        window.getSelection().removeAllRanges();
        pump();
        clickInto(ed, 20, 10);
        const sel = window.getSelection();
        const rangeCount = sel.rangeCount;
        const onHost = sel.focusNode === ed;
        const collapsed = sel.isCollapsed;
        typeText('hi');
        rows.push({
            id: 'empty', label: 'empty host', why: 'no text node exists to hit',
            rangeCount, onHost, collapsed,
            typed: ed.textContent,
            ok: rangeCount === 1 && collapsed && ed.textContent === 'hi',
            want: 'rangeCount 1, caret on the host element, typing lands "hi"',
        });
    }

    // (b) A host whose only child is an element — still no text run.
    {
        const ed = freshHost('<br>');
        window.getSelection().removeAllRanges();
        pump();
        clickInto(ed, 40, 8);
        const sel = window.getSelection();
        typeText('z');
        rows.push({
            id: 'br-only', label: 'host containing only a <br>',
            why: 'there is a box to hit but no text run inside it',
            rangeCount: sel.rangeCount, onHost: true, collapsed: true,
            typed: ed.textContent,
            ok: sel.rangeCount === 1 && ed.textContent === 'z',
            want: 'rangeCount 1 and typing lands "z"',
        });
    }

    // (c) A click PAST the end of a host's text: every run misses, but there
    //     is content, so the caret belongs after it.
    {
        const ed = freshHost('abc');
        window.getSelection().removeAllRanges();
        pump();
        clickInto(ed, 400, 40);
        const sel = window.getSelection();
        typeText('!');
        rows.push({
            id: 'past-text', label: 'click past the end of the text',
            why: 'the hit test misses every run, but dropping the selection would ' +
                 'be worse than placing it at the nearest position',
            rangeCount: sel.rangeCount, onHost: sel.focusNode === ed,
            collapsed: true, typed: ed.textContent,
            ok: sel.rangeCount === 1 && ed.textContent === 'abc!',
            want: 'rangeCount 1 and typing appends: "abc!"',
        });
    }

    // (d) The control case. A non-editable div that hits no text must still
    //     clear the selection — otherwise this is not a fix, it is a
    //     regression in the other direction.
    {
        const plain = freshPlain('');
        // Give it a selection to lose.
        const other = document.getElementById('editLive');
        if (other && other.firstChild) {
            window.getSelection().collapse(other.firstChild, 0);
            pump();
        }
        clickInto(plain, 20, 10);
        const sel = window.getSelection();
        rows.push({
            id: 'plain', label: 'non-editable empty div (control)',
            why: 'the fix must be scoped to editable hosts; a plain div that hits ' +
                 'no text still drops the selection',
            rangeCount: sel.rangeCount, onHost: false, collapsed: null, typed: '—',
            ok: sel.rangeCount === 0,
            want: 'rangeCount 0 — the selection is cleared',
        });
    }

    return rows;
}

// ── 4. Editing inside bidi text ─────────────────────────────────────────────
//
// The hardest case in the whole lab, and the least covered anywhere.
//
// In LTR text "logically next" and "visually right" are the same direction, so
// an editor can confuse them for years without anyone noticing. Inside an RTL
// run they are OPPOSITE. Everything an editor does — arrow keys, backspace,
// the caret's x position, the selection highlight — has to pick one and be
// consistent about it.
//
// bro's arrow keys move LOGICALLY, which is what every browser and every
// platform toolkit does: LEFT means "previous character in the string", not
// "the character to the left of the caret on screen". This module asserts the
// logical model, because that is the model the engine implements and the one
// the DOM Selection offsets describe. What it will NOT do is assert that the
// caret's X position behaves — that is where known limitation #1 lives (see
// app.js: byteOffsetToX only ever returns a cluster's leading edge), and the
// geometry report below states the correct answer and fails.
//
// The fixtures are the first half's, reused deliberately: the bidi panel has
// already established what the shaper does with these exact strings, so a
// disagreement here is an EDITING bug rather than a shaping one.

export const RTL_SAMPLES = [
    {
        id: 'mixed', label: 'LTR base, RTL run', text: MIXED, dir: 'ltr',
        rtlSpan: [4, 7],
        why: 'the first half\'s primary bidi fixture: "abc אבג def". The Hebrew ' +
             'occupies UTF-16 4–7 logically and renders in the middle, reversed',
    },
    {
        id: 'rtlFirst', label: 'RTL first', text: MIXED_RTL_FIRST, dir: 'ltr',
        rtlSpan: [0, 3],
        why: 'an RTL run at logical offset 0 in an LTR paragraph — the caret starts ' +
             'at the string start but at the RIGHT edge of the first glyph run',
    },
    {
        id: 'rtlBase', label: 'RTL paragraph direction', text: MIXED, dir: 'rtl',
        rtlSpan: [4, 7],
        why: 'the same string with direction:rtl. The bidi levels resolve ' +
             'differently and the visual order changes, but the LOGICAL offsets ' +
             'the arrows walk must not',
    },
];

/**
 * Arrow-walk a bidi string and check the logical model holds.
 *
 * The claims:
 *   - RIGHT always increases the offset and LEFT always decreases it, even
 *     inside the RTL run where that means moving visually leftward/rightward.
 *     (This is the logical model. It is what the DOM offsets mean.)
 *   - Every Hebrew letter is ONE stop, not two, despite being 2 UTF-8 bytes.
 *   - The stops match the shaper's cluster stops for the same string.
 *   - Backspace inside the RTL run removes exactly one Hebrew letter.
 */
export function rtlEditingReport(sample) {
    if (!CAN_DRIVE) return null;
    const text = sample.text;
    const opts = hostOpts();
    const ed = freshHost(text, { dir: sample.dir });
    const tn = ed.firstChild;
    const sel = window.getSelection();
    caretAt(tn, 0);

    const forward = [0];
    let guard = 0;
    while (guard++ < 64) {
        press(K.RIGHT);
        const at = sel.focusOffset;
        if (at === forward[forward.length - 1]) break;
        forward.push(at);
        if (at >= text.length) break;
    }

    const backward = [sel.focusOffset];
    guard = 0;
    while (guard++ < 64) {
        press(K.LEFT);
        const at = sel.focusOffset;
        if (at === backward[backward.length - 1]) break;
        backward.push(at);
        if (at <= 0) break;
    }
    backward.reverse();

    const shaperStops = caretStops(text, opts).map((b) => u8ToU16(text, b));
    const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // Deletion inside the RTL run: put the caret after the run's last logical
    // character and backspace once. Exactly one Hebrew letter must go — two
    // bytes, one code unit, one user-perceived character.
    const [rs, re] = sample.rtlSpan;
    const ed2 = freshHost(text, { dir: sample.dir });
    caretAt(ed2.firstChild, re);
    press(K.BACKSPACE);
    const afterBs = ed2.textContent;
    const wantBs = text.slice(0, re - 1) + text.slice(re);

    // And typing INSIDE the RTL run lands at the logical offset, not at the
    // visual position — a Latin letter typed there is a level-boundary case.
    const ed3 = freshHost(text, { dir: sample.dir });
    caretAt(ed3.firstChild, rs + 1);
    typeText('X');
    const afterType = ed3.textContent;
    const wantType = text.slice(0, rs + 1) + 'X' + text.slice(rs + 1);

    return {
        id: sample.id, label: sample.label, text, dir: sample.dir, why: sample.why,
        utf16: text.length,
        bytes: utf8Length(text),
        forward, backward, shaperStops,
        symmetric: eq(forward, backward),
        matchesShaper: eq(forward, shaperStops),
        // The logical model: right increases, left decreases, everywhere.
        rightIncreases: forward.every((o, i) => i === 0 || o > forward[i - 1]),
        reachedEnd: forward[forward.length - 1] === text.length,
        // Every RTL letter is its own stop — none fused, none split.
        rtlStopCount: forward.filter((o) => o >= rs && o <= re).length,
        wantRtlStopCount: re - rs + 1,
        afterBackspace: afterBs, wantBackspace: wantBs,
        backspaceOk: afterBs === wantBs,
        afterType, wantType, typeOk: afterType === wantType,
        wellFormed: afterBs.indexOf('�') === -1 && afterType.indexOf('�') === -1,
    };
}

export function rtlReportAll() {
    if (!CAN_DRIVE) return null;
    return RTL_SAMPLES.map(rtlEditingReport);
}

// ── 5. Caret geometry across a direction boundary ───────────────────────────
//
// This one is EXPECTED TO FAIL and is written to fail honestly.
//
// The first half already established (app.js, limitation `no-secondary-caret`)
// that byteOffsetToX only ever returns a cluster's LEADING edge, and that
// CaretPositions.secondary is never filled. A caret at a direction boundary
// therefore has one x where it needs two, and the trailing edge of an RTL run
// is unreachable from any byte offset.
//
// The editing consequence, measured here through the DOM rather than through
// bro.text: place the caret at each logical offset in a bidi string and take
// the collapsed Range's rect. Inside the RTL run, x must DECREASE as the
// offset increases — that sign flip is the whole of bidi caret behaviour. And
// no two distinct logical offsets that sit at a direction boundary may share
// an x, because then the user cannot tell where their caret is.
//
// Both claims are asserted as stated. Where the engine cannot satisfy them the
// row goes red and app.js reports it live.

export function caretGeometryReport() {
    const text = MIXED;
    const ed = freshHost(text);
    const tn = ed.firstChild;
    const rows = [];
    for (let i = 0; i <= text.length; i++) {
        const r = document.createRange();
        r.setStart(tn, i);
        r.setEnd(tn, i);
        const box = r.getBoundingClientRect();
        rows.push({
            u16: i,
            byte: u16ToU8(text, i),
            ch: i < text.length ? text[i] : '∅',
            x: box.left,
            width: box.width,
            atOrigin: box.left === 0 && box.top === 0 && box.width === 0 && box.height === 0,
        });
    }

    // 'abc אבג def': UTF-16 0–3 LTR, 3 space, 4–7 Hebrew, 7 space, 8–11 LTR.
    const ltrHead = rows.slice(0, 4);
    const rtl = rows.slice(4, 8);
    const ltrTail = rows.slice(8);

    const rises = (a) => a.every((r, i) => i === 0 || r.x > a[i - 1].x);
    const falls = (a) => a.every((r, i) => i === 0 || r.x < a[i - 1].x);

    // Distinct offsets sharing one x: a caret the user cannot place.
    const byX = new Map();
    for (const r of rows) {
        const k = n2(r.x);
        if (!byX.has(k)) byX.set(k, []);
        byX.get(k).push(r.u16);
    }
    const collisions = [...byX.entries()].filter(([, v]) => v.length > 1);

    const originRects = rows.filter((r) => r.atOrigin);

    return {
        text, rows,
        ltrHeadRises: rises(ltrHead),
        // The correct behaviour. Inside an RTL run, logically-next is visually
        // leftward, so x must fall.
        rtlFalls: falls(rtl),
        ltrTailRises: rises(ltrTail),
        collisions: collisions.map(([x, offs]) => ({ x, offsets: offs })),
        noCollisions: collisions.length === 0,
        // A collapsed Range must report its rect AT the caret, not at {0,0}.
        originRects: originRects.map((r) => r.u16),
        noOriginRects: originRects.length === 0,
        ok: rises(ltrHead) && falls(rtl) && rises(ltrTail) &&
            collisions.length === 0 && originRects.length === 0,
    };
}

// ── Panel ───────────────────────────────────────────────────────────────────

let stepCells = null;
let stepNote = null;
let boundaryHost = null;
let emptyCells = null;
let rtlHost = null;
let geomHost = null;
let liveHost = null;
let liveReadout = null;
let availTag = null;

export function initEditing() {
    stage = document.getElementById('editStage');
    availTag = document.getElementById('editInject');

    stepCells = buildTable(document.getElementById('editStepping'),
        ['sample', 'utf16', 'bytes', 'arrow stops (RIGHT)', 'shaper stops',
         'symmetric', 'no split', 'agree'],
        STEP_SAMPLES.length).cells;
    stepNote = document.getElementById('editSteppingNote');

    boundaryHost = document.getElementById('editBoundary');
    emptyCells = buildTable(document.getElementById('editEmpty'),
        ['case', 'rangeCount', 'collapsed', 'typing landed', 'verdict'], 4).cells;
    rtlHost = document.getElementById('editRtl');
    geomHost = document.getElementById('editGeometry');

    // ── The live playground ─────────────────────────────────────────────
    //
    // Not a test — a demonstration. In a windowed run this is the only part
    // of the editing half a human can exercise, and it is the part that makes
    // the rest legible: click in, type an emoji, arrow over it, and watch the
    // three coordinate systems move together in the readout.
    liveHost = document.getElementById('editLive');
    liveReadout = document.getElementById('editLiveReadout');
    document.addEventListener('selectionchange', updateLiveReadout);
    liveHost.addEventListener('input', updateLiveReadout);
    liveHost.addEventListener('keyup', updateLiveReadout);
    updateLiveReadout();

    refreshEditing();
}

/**
 * The caret readout: the SAME offset in all three coordinate systems, side by
 * side. This is the whole thesis of the module reduced to one line of text.
 */
export function updateLiveReadout() {
    if (!liveReadout) return;
    const snap = selectionSnapshot();
    const inHost = liveHost && liveHost.contains
        ? (window.getSelection().focusNode &&
           (window.getSelection().focusNode === liveHost ||
            liveHost.contains(window.getSelection().focusNode)))
        : false;
    const text = liveHost ? liveHost.textContent : '';

    let detail = '';
    if (inHost && snap.focusOffset !== null && window.getSelection().focusNode &&
        window.getSelection().focusNode.nodeType === 3) {
        const data = window.getSelection().focusNode.data;
        const u16 = snap.focusOffset;
        const byte = u16ToU8(data, u16);
        const stops = caretStops(data, hostOpts());
        const onStop = stops.indexOf(byte) !== -1;
        detail =
            ` — caret at UTF-16 ${u16} = UTF-8 byte ${byte} of ${utf8Length(data)}; ` +
            `that offset ${onStop ? 'IS' : 'is NOT'} one of the shaper's ${stops.length} cluster stops`;
    }

    editState.live = { snap, inHost, text };
    liveReadout.textContent =
        `anchor ${snap.anchorName}@${snap.anchorOffset} · focus ${snap.focusName}@${snap.focusOffset} · ` +
        `${snap.collapsed === null ? 'no range' : snap.collapsed ? 'collapsed' : 'selection "' + snap.text + '"'} · ` +
        `host text ${JSON.stringify(text)} (${text.length} u16, ${utf8Length(text)} bytes)` +
        detail;
    liveReadout.className = 'result' + (inHost ? ' ok' : '');
}

export function refreshEditing() {
    editState.available = CAN_DRIVE;
    availTag.textContent = CAN_DRIVE ? 'injection: available' : 'injection: headless only';
    availTag.className = 'tag ' + (CAN_DRIVE ? 'ok' : 'bad');

    if (!CAN_DRIVE) {
        stepNote.textContent =
            'These scenarios drive the engine through keyDown/textInput/mouseDown, ' +
            'which exist only under bro-headless. Run the smoke test to see them. ' +
            'The live playground below works here.';
        stepNote.className = 'note warn';
        return;
    }

    // 1. Arrow stepping
    const steps = steppingReportAll();
    editState.stepping = steps;
    steps.forEach((r, i) => {
        const c = stepCells[i];
        c[0].textContent = `${r.text}  — ${r.label}`;
        c[1].textContent = r.utf16;
        c[2].textContent = r.bytes;
        c[3].textContent = r.forward.join(' → ');
        c[4].textContent = r.shaperStops.join(' → ');
        verdict(c[5], r.symmetric, r.symmetric ? 'yes' : 'NO — left ≠ right');
        verdict(c[6], r.noSplitSurrogates && r.onCodePointBoundaries,
            r.noSplitSurrogates && r.onCodePointBoundaries ? 'clean' : 'SPLITS');
        verdict(c[7], r.matchesShaper,
            r.matchesShaper ? 'key handler = shaper' : 'DISAGREE');
    });
    const bad = steps.filter((r) => !r.matchesShaper);
    stepNote.textContent =
        'Oracle is caretStops() from the cluster panel — the shaper\'s own answer for ' +
        'the same string, via bro.text.clusterRange(), converted from bytes to UTF-16. ' +
        (bad.length === 0
            ? 'The key handler and the shaper name the same positions in every sample.'
            : `${bad.length} sample(s) disagree: ` +
              bad.map((r) => `${r.label} keys [${r.forward.join(',')}] vs shaper [${r.shaperStops.join(',')}]`).join(' | '));
    stepNote.className = 'note ' + (bad.length === 0 ? 'ok' : 'warn');

    // 2. Boundary cases
    const bounds = boundaryReport();
    editState.boundary = bounds;
    boundaryHost.textContent = '';
    for (const b of bounds) {
        const box = el('div', 'case' + (b.ok ? ' ok' : ' bad'));
        box.appendChild(el('div', 'case-head', b.label));
        box.appendChild(el('div', 'case-why', b.why));
        box.appendChild(el('div', 'case-io',
            `in:  ${JSON.stringify(b.html)}\nout: ${JSON.stringify(b.gotHTML)}` +
            (b.threw ? `\nTHREW: ${b.threw}` : '')));
        for (const k of b.checks) {
            const line = el('div', 'case-check ' + (k.ok ? 'ok' : 'bad'));
            line.textContent = `${k.ok ? '✓' : '✗'} ${k.name}: want ${JSON.stringify(k.want)}` +
                (k.ok ? '' : `, got ${JSON.stringify(k.got)}`);
            box.appendChild(line);
        }
        boundaryHost.appendChild(box);
    }

    // 3. Empty-host caret
    const empties = emptyHostReport();
    editState.emptyHost = empties;
    empties.forEach((r, i) => {
        const c = emptyCells[i];
        c[0].textContent = r.label;
        c[1].textContent = r.rangeCount;
        c[2].textContent = r.collapsed === null ? '—' : (r.collapsed ? 'yes' : 'no');
        c[3].textContent = r.typed;
        verdict(c[4], r.ok, r.ok ? 'as specified' : 'WRONG — want ' + r.want);
    });

    // 4. RTL editing
    const rtl = rtlReportAll();
    editState.rtl = rtl;
    rtlHost.textContent = '';
    for (const r of rtl) {
        const box = el('div', 'case' + (r.symmetric && r.matchesShaper && r.rightIncreases &&
            r.backspaceOk && r.typeOk ? ' ok' : ' bad'));
        box.appendChild(el('div', 'case-head', `${r.label} (direction:${r.dir})`));
        box.appendChild(el('div', 'case-why', r.why));
        box.appendChild(el('div', 'case-io',
            `text ${JSON.stringify(r.text)} — ${r.utf16} u16, ${r.bytes} bytes\n` +
            `RIGHT walk  ${r.forward.join(' → ')}\n` +
            `LEFT  walk  ${r.backward.join(' → ')}\n` +
            `shaper      ${r.shaperStops.join(' → ')}`));
        const add = (ok, txt) => {
            const line = el('div', 'case-check ' + (ok ? 'ok' : 'bad'));
            line.textContent = (ok ? '✓ ' : '✗ ') + txt;
            box.appendChild(line);
        };
        add(r.rightIncreases, 'RIGHT always increases the logical offset, inside the RTL run too');
        add(r.symmetric, 'LEFT retraces the RIGHT walk exactly');
        add(r.matchesShaper, 'the key handler\'s stops equal the shaper\'s cluster stops');
        add(r.rtlStopCount === r.wantRtlStopCount,
            `every RTL letter is one stop (${r.rtlStopCount} of ${r.wantRtlStopCount} in the run)`);
        add(r.backspaceOk, `Backspace in the RTL run removes one whole letter: ` +
            `${JSON.stringify(r.afterBackspace)}` +
            (r.backspaceOk ? '' : ` — want ${JSON.stringify(r.wantBackspace)}`));
        add(r.typeOk, `typing lands at the logical offset: ${JSON.stringify(r.afterType)}` +
            (r.typeOk ? '' : ` — want ${JSON.stringify(r.wantType)}`));
        rtlHost.appendChild(box);
    }

    // 5. Caret geometry (expected red — see limitation no-secondary-caret)
    const geom = caretGeometryReport();
    editState.caretGeometry = geom;
    geomHost.textContent =
        `Collapsed Range rects at every caret offset in ${JSON.stringify(geom.text)}: ` +
        geom.rows.map((r) => `${r.u16}:${n2(r.x)}`).join('  ') + '. ' +
        `LTR head x rises: ${geom.ltrHeadRises ? 'yes' : 'NO'}. ` +
        `RTL run x falls (logically-next is visually leftward): ${geom.rtlFalls ? 'yes' : 'NO'}. ` +
        `LTR tail x rises: ${geom.ltrTailRises ? 'yes' : 'NO'}. ` +
        (geom.noCollisions
            ? 'No two logical offsets share an x.'
            : `${geom.collisions.length} x value(s) shared by several offsets — ` +
              geom.collisions.map((c) => `x=${c.x} ← offsets ${c.offsets.join(',')}`).join('; ') +
              ' — a caret the user cannot place unambiguously.') +
        (geom.noOriginRects ? '' :
            ` Collapsed rects reported at the origin {0,0} instead of at the caret: offsets ${geom.originRects.join(',')}.`);
    geomHost.className = 'result ' + (geom.ok ? 'ok' : 'bad');

    // Leave the stage in a clean state — a scenario's leftover host is not
    // something a human reader should be looking at.
    stage.innerHTML = '';
    pump();
}
