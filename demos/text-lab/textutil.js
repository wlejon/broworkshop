// textutil.js — the UTF-16 ↔ UTF-8 boundary, and the small helpers every
// other module in this lab needs.
//
// WHY THIS FILE EXISTS AT ALL:
//
// bro's text stack is a BYTE domain. `ShapedRun` (src/render/shaped_run.h) says
// so in its header comment — layout, DOM and JS all speak UTF-8 byte offsets,
// and glyph ids never escape bro::render. But JS strings are UTF-16, and
// `str.length`, `str[i]`, `slice()` and every regex all count UTF-16 code
// units. So EVERY number that comes out of `bro.text.*` — cluster.start,
// cluster.end, clusterRange(), the argument to byteOffsetToX() — is in a
// different coordinate system than the JS string you passed in.
//
// For pure ASCII the two coincide, which is exactly why this is a trap: an app
// written and tested in English works, and then breaks on the first accented
// character. This lab therefore does the conversion explicitly and loudly
// rather than getting away with it.
//
//   "abc"    → utf16 length 3, utf8 length 3    (identical, the trap)
//   "café"   → utf16 length 4, utf8 length 5    (é is 2 bytes)
//   "אבג"    → utf16 length 3, utf8 length 6    (Hebrew is 2 bytes)
//   "हिन्दी"  → utf16 length 6, utf8 length 18   (Devanagari is 3 bytes)
//   "a😀b"   → utf16 length 4, utf8 length 6    (astral: 2 units, 4 bytes)
//
// The last line is the one that catches people twice: an astral codepoint is
// TWO UTF-16 units but FOUR UTF-8 bytes, so the two offset systems disagree in
// opposite directions on either side of it.

// ── Code-point width in each encoding ───────────────────────────────────────

/** UTF-8 byte length of a single code point. */
export function cpUtf8Len(cp) {
    if (cp < 0x80) return 1;
    if (cp < 0x800) return 2;
    if (cp < 0x10000) return 3;
    return 4;
}

/** UTF-16 code-unit length of a single code point (2 iff astral). */
export function cpUtf16Len(cp) {
    return cp >= 0x10000 ? 2 : 1;
}

/**
 * Walk `str` code point by code point.
 * Calls fn({ cp, u16, u8, u16Len, u8Len, char }) for each, where `u16` and `u8`
 * are the offsets of that code point in each encoding. This single walk is what
 * every conversion below is built from — there is deliberately only one place
 * in this lab that knows how surrogate pairs work.
 */
export function forEachCodePoint(str, fn) {
    let u16 = 0;
    let u8 = 0;
    while (u16 < str.length) {
        const cp = str.codePointAt(u16);
        const u16Len = cpUtf16Len(cp);
        const u8Len = cpUtf8Len(cp);
        fn({ cp, u16, u8, u16Len, u8Len, char: str.slice(u16, u16 + u16Len) });
        u16 += u16Len;
        u8 += u8Len;
    }
}

/** Total UTF-8 byte length of a JS string. */
export function utf8Length(str) {
    let n = 0;
    forEachCodePoint(str, (c) => { n += c.u8Len; });
    return n;
}

/** Array of code points, in logical order, with both offset systems attached. */
export function codePoints(str) {
    const out = [];
    forEachCodePoint(str, (c) => out.push(c));
    return out;
}

/**
 * UTF-16 offset → UTF-8 byte offset.
 * An offset that lands inside a surrogate pair is clamped to the START of that
 * pair: half a code point has no byte offset, and silently rounding the other
 * way would put a caret inside a character.
 */
export function u16ToU8(str, u16Offset) {
    if (u16Offset <= 0) return 0;
    let result = 0;
    let done = false;
    forEachCodePoint(str, (c) => {
        if (done) return;
        if (u16Offset < c.u16 + c.u16Len) { result = c.u8; done = true; return; }
        result = c.u8 + c.u8Len;
    });
    return result;
}

/** UTF-8 byte offset → UTF-16 offset. Offsets inside a code point clamp back. */
export function u8ToU16(str, u8Offset) {
    if (u8Offset <= 0) return 0;
    let result = 0;
    let done = false;
    forEachCodePoint(str, (c) => {
        if (done) return;
        if (u8Offset < c.u8 + c.u8Len) { result = c.u16; done = true; return; }
        result = c.u16 + c.u16Len;
    });
    return result;
}

/** The substring covered by a [byteStart, byteEnd) span reported by bro.text. */
export function sliceByBytes(str, byteStart, byteEnd) {
    return str.slice(u8ToU16(str, byteStart), u8ToU16(str, byteEnd));
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * Render a string so its structure is visible in a panel: every code point as
 * U+XXXX, with the astral ones flagged. Panels that print raw RTL or combining
 * text are unreadable precisely because the engine is doing its job.
 */
export function codePointLabels(str) {
    return codePoints(str).map((c) => {
        const hex = c.cp.toString(16).toUpperCase().padStart(4, '0');
        return {
            hex: 'U+' + hex,
            char: c.char,
            u16: c.u16,
            u8: c.u8,
            astral: c.cp >= 0x10000,
            combining: isCombining(c.cp),
            rtlChar: isRtlCodePoint(c.cp),
        };
    });
}

/** Rough combining-mark test — enough of Mn/Me for the samples in this lab. */
export function isCombining(cp) {
    return (cp >= 0x0300 && cp <= 0x036F) ||   // Combining Diacritical Marks
           (cp >= 0x0591 && cp <= 0x05BD) ||   // Hebrew points
           (cp >= 0x064B && cp <= 0x065F) ||   // Arabic harakat
           (cp >= 0x0900 && cp <= 0x0903) ||   // Devanagari signs
           (cp >= 0x093A && cp <= 0x094F) ||   // Devanagari matras + virama
           (cp >= 0x0E31 && cp <= 0x0E3A) ||   // Thai vowels above/below
           (cp >= 0x0E47 && cp <= 0x0E4E) ||   // Thai tone marks
           (cp >= 0x20D0 && cp <= 0x20F0);     // Combining marks for symbols
}

/** Strong-RTL code point (Hebrew + Arabic blocks) — used only for colouring. */
export function isRtlCodePoint(cp) {
    return (cp >= 0x0590 && cp <= 0x05FF) ||   // Hebrew
           (cp >= 0x0600 && cp <= 0x06FF) ||   // Arabic
           (cp >= 0x0700 && cp <= 0x074F) ||   // Syriac
           (cp >= 0x0750 && cp <= 0x077F) ||   // Arabic Supplement
           (cp >= 0xFB1D && cp <= 0xFDFF) ||   // Hebrew/Arabic presentation
           (cp >= 0xFE70 && cp <= 0xFEFF);     // Arabic presentation B
}

/** Fixed-precision number for panel text; keeps rows from jittering. */
export function n2(v) {
    return (Math.round(v * 100) / 100).toFixed(2);
}

/** Sum of a mapped array — used constantly for cluster advances. */
export function sum(arr, f) {
    return arr.reduce((a, x) => a + (f ? f(x) : x), 0);
}

// ── DOM helpers shared by every panel ───────────────────────────────────────

export function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

/**
 * Build a table once and hand back a setter for its cells.
 *
 * House rule inherited from input-lab / platform-lab: panels must NEVER rebuild
 * innerHTML per frame. A 60 Hz innerHTML rewrite forces a full re-parse and
 * re-layout of the subtree, which in a text lab means re-SHAPING every string
 * in it — the very thing whose cost the shaping cache exists to avoid. So rows
 * are created once and only textContent is rewritten afterwards.
 */
export function buildTable(host, headers, rowCount) {
    const table = el('table', 'grid');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of headers) hr.appendChild(el('th', null, h));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    const cells = [];
    for (let r = 0; r < rowCount; r++) {
        const tr = el('tr');
        const row = [];
        for (let c = 0; c < headers.length; c++) {
            const td = el('td');
            tr.appendChild(td);
            row.push(td);
        }
        tbody.appendChild(tr);
        cells.push(row);
    }
    table.appendChild(tbody);
    host.appendChild(table);
    return { table, tbody, cells };
}

/** Mark a table cell pass/fail — the visual half of an assertion. */
export function verdict(cell, ok, text) {
    cell.textContent = text;
    cell.className = ok ? 'ok' : 'bad';
    return ok;
}
