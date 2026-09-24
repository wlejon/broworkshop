// lib/kit/text.js — bro.text from JS: the UTF-16 <-> UTF-8 boundary, caret
// stops, and the cluster map (as data and drawn on a canvas).
//
//   import { shape, clusterMap, caretStops, u8ToU16, drawClusterMap } from "/lib/kit/text.js";
//   const map = clusterMap('a😀b', { family: 'Arial', size: 48 });
//   map.clusters[1].text        // '😀' — bytes 1-5, UTF-16 1-3
//
// bro's text stack is a BYTE domain: every offset bro.text returns
// (cluster.start/end, clusterRange, byteOffsetToX's argument) is a UTF-8 byte
// offset, while JS strings, Selection and Range count UTF-16 code units. For
// ASCII the two coincide, which is why confusing them ships:
//
//   "café"  utf16 4, utf8 5      "a😀b"  utf16 4, utf8 6
//
// An astral code point is 2 units but 4 bytes, so the two systems disagree in
// opposite directions on either side of it. Convert explicitly with the
// helpers here rather than hoping the text is ASCII.
//
// Used by demos/text-lab and demos/range-selection-lab.

// --- code points and the two encodings ---------------------------------------

/** UTF-8 byte length of one code point. */
export function cpUtf8Len(cp) {
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** UTF-16 code-unit length of one code point (2 iff astral). */
export function cpUtf16Len(cp) {
    return cp >= 0x10000 ? 2 : 1;
}

/**
 * Walk `str` code point by code point: fn({ cp, u16, u8, u16Len, u8Len, char })
 * with the offset of each code point in both encodings. The one place that
 * knows how surrogate pairs work; everything below is built on it.
 */
export function forEachCodePoint(str, fn) {
    let u16 = 0, u8 = 0;
    while (u16 < str.length) {
        const cp = str.codePointAt(u16);
        const u16Len = cpUtf16Len(cp), u8Len = cpUtf8Len(cp);
        fn({ cp, u16, u8, u16Len, u8Len, char: str.slice(u16, u16 + u16Len) });
        u16 += u16Len;
        u8 += u8Len;
    }
}

/** Code points of `str` in logical order, each with both offsets attached. */
export function codePoints(str) {
    const out = [];
    forEachCodePoint(str, (c) => out.push(c));
    return out;
}

/** UTF-8 byte length of a JS string. */
export function utf8Length(str) {
    let n = 0;
    forEachCodePoint(str, (c) => { n += c.u8Len; });
    return n;
}

/**
 * UTF-16 offset -> UTF-8 byte offset. An offset inside a surrogate pair clamps
 * to the START of the pair: half a code point has no byte offset.
 */
export function u16ToU8(str, u16Offset) {
    if (u16Offset <= 0) return 0;
    let result = 0, done = false;
    forEachCodePoint(str, (c) => {
        if (done) return;
        if (u16Offset < c.u16 + c.u16Len) { result = c.u8; done = true; return; }
        result = c.u8 + c.u8Len;
    });
    return result;
}

/** UTF-8 byte offset -> UTF-16 offset. An offset inside a code point clamps back. */
export function u8ToU16(str, u8Offset) {
    if (u8Offset <= 0) return 0;
    let result = 0, done = false;
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

/** Rough combining-mark test: enough of Mn/Me for Latin, Hebrew, Arabic, Devanagari, Thai. */
export function isCombining(cp) {
    return (cp >= 0x0300 && cp <= 0x036F) || (cp >= 0x0591 && cp <= 0x05BD) ||
           (cp >= 0x064B && cp <= 0x065F) || (cp >= 0x0900 && cp <= 0x0903) ||
           (cp >= 0x093A && cp <= 0x094F) || (cp >= 0x0E31 && cp <= 0x0E3A) ||
           (cp >= 0x0E47 && cp <= 0x0E4E) || (cp >= 0x20D0 && cp <= 0x20F0);
}

/** Strong-RTL code point (Hebrew, Arabic, Syriac + presentation forms). For colouring. */
export function isRtlCodePoint(cp) {
    return (cp >= 0x0590 && cp <= 0x077F) || (cp >= 0xFB1D && cp <= 0xFDFF) ||
           (cp >= 0xFE70 && cp <= 0xFEFF);
}

/** Every code point as { hex: 'U+XXXX', char, u16, u8, astral, combining, rtlChar }. */
export function codePointLabels(str) {
    return codePoints(str).map((c) => ({
        hex: 'U+' + c.cp.toString(16).toUpperCase().padStart(4, '0'),
        char: c.char, u16: c.u16, u8: c.u8,
        astral: c.cp >= 0x10000,
        combining: isCombining(c.cp),
        rtlChar: isRtlCodePoint(c.cp),
    }));
}

// --- shaping -------------------------------------------------------------------

/**
 * bro.text.shape with a default descriptor ({ family: 'Arial', size: 32 }),
 * throwing instead of returning null (no renderer).
 */
export function shape(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 32 }, opts || {});
    const r = bro.text.shape(text, o);
    if (!r) throw new Error('bro.text.shape returned null for ' + JSON.stringify(text));
    return r;
}

// --- caret stops -----------------------------------------------------------------
//
// A caret sits on a cluster edge, never inside a cluster (a ligature, an
// emoji, a base + mark pair). These go through bro.text.clusterRange, the
// engine's own answer for one offset. Offsets are UTF-8 bytes.

/** The next caret stop after `byteOffset`, moving logically forward. */
export function stepForward(text, opts, byteOffset) {
    const total = utf8Length(text);
    if (byteOffset >= total) return total;
    const span = bro.text.clusterRange(text, opts, byteOffset);
    // A degenerate span must still make progress, or a caret loop hangs.
    if (!span || span.end <= byteOffset) return Math.min(byteOffset + 1, total);
    return span.end;
}

/** The previous caret stop strictly before `byteOffset`. */
export function stepBackward(text, opts, byteOffset) {
    if (byteOffset <= 0) return 0;
    const span = bro.text.clusterRange(text, opts, byteOffset - 1);
    if (!span || span.start >= byteOffset) return Math.max(byteOffset - 1, 0);
    return span.start;
}

/** Every caret stop in `text` (bytes, logical order), 0 and the end included. */
export function caretStops(text, opts) {
    const stops = [0];
    const total = utf8Length(text);
    for (let at = 0, guard = 0; at < total && guard < 4096; guard++) {
        const next = stepForward(text, opts, at);
        if (next <= at) break;
        stops.push(at = next);
    }
    return stops;
}

// --- the cluster map -------------------------------------------------------------

/**
 * One string's cluster map: every cluster (visual order) with its byte span,
 * UTF-16 span, source text, pen x, advance, glyph count and rtl flag, plus
 * the invariants worth checking:
 *   tiles      clusters sorted logically cover [0, bytes) with no gap/overlap
 *   monotonic  pen x never decreases across the visual list
 *   reordered  visual order differs from logical (something was RTL)
 *   advanceSum the cluster advances summed (must equal width)
 */
export function clusterMap(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 64 }, opts || {});
    const r = shape(text, o);
    const bytes = utf8Length(text);
    const cps = codePoints(text);
    const clusters = r.clusters.map((c, i) => ({
        visualIndex: i,
        byteStart: c.start, byteEnd: c.end, byteLen: c.end - c.start,
        u16Start: u8ToU16(text, c.start), u16End: u8ToU16(text, c.end),
        text: sliceByBytes(text, c.start, c.end),
        x: c.x, advance: c.advance, glyphs: c.glyphs, rtl: c.rtl,
        // Several code points fused into one caret stop.
        multiCodePoint: cps.filter((p) => p.u8 >= c.start && p.u8 < c.end).length > 1,
        // Several bytes drawn as exactly one glyph: a ligature by definition.
        ligature: c.end - c.start > 1 && c.glyphs === 1 &&
                  cps.filter((p) => p.u8 >= c.start && p.u8 < c.end).length > 1,
    }));
    const logical = clusters.slice().sort((a, b) => a.byteStart - b.byteStart);
    let tiles = true, expect = 0;
    for (const c of logical) {
        if (c.byteStart !== expect || c.byteEnd <= c.byteStart) { tiles = false; break; }
        expect = c.byteEnd;
    }
    if (expect !== bytes) tiles = false;
    return {
        text, opts: o,
        bytes, codePoints: cps.length, utf16: text.length,
        width: r.width, glyphCount: r.glyphCount,
        clusters, logical, tiles,
        advanceSum: clusters.reduce((a, c) => a + c.advance, 0),
        monotonic: clusters.every((c, i) => i === 0 || c.x >= clusters[i - 1].x - 1e-4),
        reordered: clusters.some((c, i) => logical[i].byteStart !== c.byteStart),
    };
}

/**
 * Draw `text` with canvas fillText and overlay one box per cluster from the
 * cluster map. canvas fillText and bro.text.shape share one ShapedRun, so the
 * boxes land on the glyphs; if they drift, two shaping paths exist.
 * Orange outlines: clusters of several glyphs; purple: RTL; pink fill: a
 * ligature; green ticks on the baseline: the caret stops.
 *
 * view: { x = 34, baseline = 96 (px), labels = true, stops = true, bg = '#12151c' }.
 * Returns the clusterMap.
 */
export function drawClusterMap(canvas, text, opts, view) {
    const v = Object.assign({ x: 34, baseline: 96, labels: true, stops: true, bg: '#12151c' }, view || {});
    const o = Object.assign({ family: 'Arial', size: 64 }, opts || {});
    const g = canvas.getContext('2d');
    const map = clusterMap(text, o);
    const X = v.x, B = v.baseline, S = o.size;
    const font = (o.italic ? 'italic ' : '') + (o.weight ? o.weight + ' ' : '') + S + 'px ' + o.family;

    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = v.bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = '#2b3242';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X, B + 0.5);
    g.lineTo(canvas.width - X, B + 0.5);
    g.stroke();

    // Boxes under the text so the glyphs stay readable.
    const top = B - S * 1.05, hgt = S * 1.35;
    map.clusters.forEach((c, i) => {
        const w = Math.max(c.advance, 2);
        g.fillStyle = c.ligature ? '#3a1f33' : c.rtl ? (i % 2 ? '#33203a' : '#3d2545')
                                             : (i % 2 ? '#1b2433' : '#222c3d');
        g.fillRect(X + c.x, top, w, hgt);
        g.strokeStyle = c.glyphs > 1 ? '#f59e0b' : c.ligature ? '#ff6ec7' : c.rtl ? '#c084fc' : '#3b82f6';
        g.lineWidth = c.glyphs > 1 || c.ligature ? 2 : 1;
        g.strokeRect(X + c.x + 0.5, top + 0.5, w - 1, hgt - 1);
    });

    g.fillStyle = '#e8edf7';
    g.font = font;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(text, X, B);

    if (v.labels) {
        g.font = '11px Consolas, monospace';
        // Narrow clusters would overprint their neighbours' labels, so a label
        // that would collide steps out to the next lane (up for the byte
        // spans, down for the visual indices).
        const lanes = (dir) => {
            const ends = [];
            return (x, label) => {
                const w = g.measureText(label).width + 4;
                let k = 0;
                while (k < 2 && ends[k] !== undefined && ends[k] > x) k++;
                ends[k] = x + w;
                return dir * k * 12;
            };
        };
        const above = lanes(-1), below = lanes(1);
        map.clusters.forEach((c, i) => {
            const x = X + c.x + 2;
            const span = c.byteStart + '–' + c.byteEnd;
            g.fillStyle = c.glyphs > 1 ? '#fbbf24' : c.ligature ? '#ff6ec7' : '#7d8aa3';
            g.fillText(span, x, top - 6 + above(x, span));
            const vis = 'v' + i + (c.glyphs > 1 ? ' ·' + c.glyphs + 'g' : c.ligature ? ' lig' : '');
            g.fillStyle = c.rtl ? '#c084fc' : '#5b6b86';
            g.fillText(vis, x, B + S * 0.36 + below(x, vis));
        });
    }

    if (v.stops) {
        g.strokeStyle = '#4ade80';
        g.lineWidth = 1;
        for (const b of caretStops(text, o)) {
            const x = X + bro.text.byteOffsetToX(text, o, b).x + 0.5;
            g.beginPath();
            g.moveTo(x, B + 6);
            g.lineTo(x, B + 18);
            g.stroke();
        }
    }
    return map;
}
