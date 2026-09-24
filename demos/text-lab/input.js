// input.js — driving the engine the way a user does, for the editing half.
//
// Everything goes through the headless injection surface — keyDown/keyUp,
// textInput, mouseDown/mouseUp — never a synthesised DOM event: the engine's
// key handler, hit test, focus resolution and contenteditable mutation path
// are exactly what is under test, and dispatchEvent would skip all four. In a
// windowed run those globals do not exist; the scenarios then report
// "headless only" and the live playground is driven by the human instead.

// Raw SDL keycodes: the engine's key handler maps them to editing commands,
// and that mapping is under test too.
export const K = {
    BACKSPACE: 8, TAB: 9, RETURN: 13, DELETE: 127,
    LEFT: 0x40000050, RIGHT: 0x4000004F, UP: 0x40000052, DOWN: 0x40000051,
    HOME: 0x4000004A, END: 0x4000004D,
    Z: 122, Y: 121, A: 97,
};

export const MOD = { NONE: 0, LSHIFT: 0x0001, LCTRL: 0x0040 };

/** True when the engine can be driven from script — i.e. under bro-headless. */
export const CAN_DRIVE = typeof keyDown === 'function' && typeof keyUp === 'function' &&
    typeof textInput === 'function' && typeof mouseDown === 'function' && typeof mouseUp === 'function';

/** Pump pending work (headless only; a no-op in a window). */
export function pump() {
    if (typeof flush === 'function') flush();
}

/**
 * Scroll `el` into the visible part of the scrolling #main before clicking
 * into it: a real click has to land on screen. (Measuring needs no reveal —
 * Range rects report text wherever it is, scrolled out of view or not.)
 */
export function reveal(el) {
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView();
    pump();
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

/** Click `dx,dy` into an element's box through the real hit-test path. */
export function clickInto(element, dx, dy) {
    const r = element.getBoundingClientRect();
    const x = r.left + (dx === undefined ? 4 : dx), y = r.top + (dy === undefined ? 4 : dy);
    mouseDown(x, y);
    mouseUp(x, y);
    pump();
}

/**
 * Seat the caret at UTF-16 offset `off` of `node` through the Selection API,
 * so the offset crosses the UTF-16 → byte conversion on the way in.
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

/**
 * A fresh contenteditable host in `stageEl`. Fresh every scenario, because
 * focus, the Selection and the per-host undo stack all persist. The font is
 * pinned inline: several scenarios compare caret offsets against the
 * shaper's caretStops() for the same descriptor. No id: several stages are
 * alive at once.
 */
export function hostIn(stageEl, html, opts) {
    const o = opts || {};
    stageEl.innerHTML =
        '<div contenteditable="true" class="edit-host" style="font-family:' + (o.family || 'Arial') + ';' +
        'font-size:' + (o.size || 20) + 'px;' + (o.dir ? 'direction:' + o.dir + ';' : '') + '">' +
        (html === undefined ? '' : html) + '</div>';
    reveal(stageEl);
    return stageEl.querySelector('.edit-host');
}

/** The shaping options matching a host built by hostIn(). */
export function hostOpts(opts) {
    const o = opts || {};
    return { family: o.family || 'Arial', size: o.size || 20 };
}

export function nodeName(node) {
    if (!node) return '—';
    if (node.nodeType === 3) return '#text("' + node.data.slice(0, 12) + '")';
    return '<' + (node.tagName || '?').toLowerCase() + '>';
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

/** Arrow-walk the caret RIGHT to the end, then LEFT back; returns both focusOffset lists. */
export function arrowWalk(text) {
    const sel = window.getSelection();
    const forward = [sel.focusOffset];
    for (let guard = 0; guard < 64; guard++) {
        press(K.RIGHT);
        const at = sel.focusOffset;
        // The end is a fixed point: two identical readings mean done.
        if (at === forward[forward.length - 1]) break;
        forward.push(at);
        if (at >= text.length) break;
    }
    const backward = [sel.focusOffset];
    for (let guard = 0; guard < 64; guard++) {
        press(K.LEFT);
        const at = sel.focusOffset;
        if (at === backward[backward.length - 1]) break;
        backward.push(at);
        if (at <= 0) break;
    }
    backward.reverse();
    return { forward, backward };
}
