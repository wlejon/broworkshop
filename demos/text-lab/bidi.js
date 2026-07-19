// bidi.js — the Unicode Bidirectional Algorithm (UAX #9) as bro implements it.
//
// Three separate things have to agree for RTL text to be correct, and this
// module checks each of them against the others rather than checking any one
// of them against a hardcoded expectation:
//
//   1. LEVEL RESOLUTION   bro.text.bidi() → rules P2-P3, X1-X8, W1-W7, N0-N2,
//                         I1-I2. Answers "what embedding level is each
//                         character at?" over a whole paragraph.
//   2. REORDERING         bro.text.bidiReorder() → rule L2 alone. Answers
//                         "given these levels, what order do they appear in?"
//   3. SHAPING            bro.text.shape() → runs the first two internally and
//                         emits its cluster map ALREADY IN VISUAL ORDER
//                         (ShapedRun::reorderRunsVisually, then finalize).
//
// The strong test is that (3) reproduces (1)+(2). If shape() emitted clusters
// in logical order, or reordered against levels it resolved differently, the
// permutation check below fails. A test that only asserted "the Hebrew is
// somewhere to the right" would pass in both cases.
//
// And then a FOURTH check: the DOM. `Range.getBoundingClientRect()` over a
// sub-span of a mixed-direction text node reports where that span was actually
// laid out, so the same permutation is verifiable through the layout engine
// and not just through the diagnostic binding.

import {
    el, n2, buildTable, verdict, codePoints, u16ToU8, u8ToU16, sliceByBytes,
    codePointLabels,
} from '/app/textutil.js';
import { shape } from '/app/shaping.js';

// The canonical mixed paragraph. Latin, then Hebrew, then Latin — the shape
// that makes every interesting boundary appear twice, once in each direction.
//
// Byte layout (Hebrew letters are 2 bytes each in UTF-8, Latin 1):
//   a(0) b(1) c(2) ␠(3) א(4-5) ב(6-7) ג(8-9) ␠(10) d(11) e(12) f(13)
// 11 code points, 14 bytes. Every offset in this file that looks "off by one"
// is that difference and nothing else.
export const MIXED = 'abc אבג def';

// A second sample where the RTL run is at the START, so P2/P3's auto-detection
// resolves the PARAGRAPH to RTL and the Latin becomes the embedded run.
export const MIXED_RTL_FIRST = 'אבג abc דהו';

// Numbers next to Arabic are the classic W-rule case: European digits adjacent
// to an Arabic-letter context resolve to level 2 (LTR inside RTL), so "123"
// reads left-to-right while sitting inside a right-to-left run.
export const ARABIC_NUMBERS = 'العدد 123 نهاية';

export const SAMPLES = [
    { id: 'mixed', label: 'LTR base, RTL run', text: MIXED, base: 'ltr' },
    { id: 'rtlfirst', label: 'auto → RTL paragraph', text: MIXED_RTL_FIRST, base: 'auto' },
    { id: 'numbers', label: 'digits inside Arabic', text: ARABIC_NUMBERS, base: 'auto' },
    { id: 'pure', label: 'pure LTR (uniform)', text: 'plain english text', base: 'auto' },
    { id: 'purertl', label: 'pure RTL (uniform)', text: 'שלום עולם', base: 'auto' },
];

export const bidiState = {
    available: false,
    samples: [],        // one analysis per SAMPLES entry
    permutation: null,  // shape() vs bidiReorder() cross-check
    carets: [],         // caret x walk across the mixed string
    dom: null,          // Range-rect cross-check
    overrides: null,    // unicode-bidi: bidi-override
};

// ── Level resolution ────────────────────────────────────────────────────────

/**
 * Full analysis of one string at one base direction.
 *
 * `levels` from bro.text.bidi() is one entry PER CODE POINT (text_bindings.cpp
 * takes the level at each UTF-8 lead byte), while `runs` are in BYTES. Mixing
 * those two up is the single easiest way to write a bidi test that passes on
 * ASCII and fails on everything else, so both are converted to a common
 * code-point index here and the byte forms are kept alongside for the panel.
 */
export function analyze(text, base) {
    const b = bro.text.bidi(text, base || 'auto');
    const cps = codePoints(text);
    return {
        text, base: base || 'auto',
        paragraphLevel: b.paragraphLevel,
        rtlParagraph: (b.paragraphLevel & 1) === 1,
        uniform: b.uniform,
        levels: b.levels,
        codePoints: cps.length,
        // Sanity that has bitten before: one level per code point, not per byte
        // and not per UTF-16 unit.
        levelsPerCodePoint: b.levels.length === cps.length,
        runs: b.runs.map((r) => ({
            byteStart: r.start,
            byteEnd: r.end,
            level: r.level,
            rtl: (r.level & 1) === 1,
            cpStart: u8ToU16(text, r.start),   // UTF-16 index, for slicing
            text: sliceByBytes(text, r.start, r.end),
        })),
        // Runs must tile the string exactly: contiguous, no gaps, no overlap.
        runsTile: runsTile(b.runs, text),
    };
}

function runsTile(runs, text) {
    if (runs.length === 0) return text.length === 0;
    let expect = 0;
    for (const r of runs) {
        if (r.start !== expect) return false;
        if (r.end <= r.start) return false;
        expect = r.end;
    }
    // The last run must reach the end of the string, in BYTES.
    let bytes = 0;
    codePoints(text).forEach((c) => { bytes += c.u8Len; });
    return expect === bytes;
}

// ── Reordering (rule L2) ────────────────────────────────────────────────────

/** bro.text.bidiReorder over a string's own resolved per-code-point levels. */
export function reorderFor(text, base) {
    const b = bro.text.bidi(text, base || 'auto');
    return bro.text.bidiReorder(b.levels);
}

/**
 * The visual order shape() actually produced, expressed as CODE POINT indices.
 *
 * shape()'s cluster list is already in visual order (left to right on screen),
 * and each cluster carries the BYTE range it came from. Mapping each cluster's
 * byteStart back to a code-point index gives the permutation the shaper chose.
 * This is the number that must equal bidiReorder's.
 */
export function visualOrderOf(text, opts) {
    const r = shape(text, opts || { family: 'Arial', size: 32 });
    const cps = codePoints(text);
    const byteToIndex = new Map();
    cps.forEach((c, i) => byteToIndex.set(c.u8, i));
    return {
        run: r,
        // One entry per cluster. Multi-codepoint clusters (ligatures, Indic
        // syllables) collapse several logical positions into one visual slot,
        // which is why this is compared against the reorder permutation
        // FILTERED to cluster starts rather than element-wise.
        order: r.clusters.map((c) => byteToIndex.get(c.start)),
        clusterStarts: r.clusters.map((c) => c.start),
        xs: r.clusters.map((c) => c.x),
        rtlFlags: r.clusters.map((c) => c.rtl),
    };
}

/**
 * Cross-check: does shape()'s visual cluster order equal rule L2 applied to
 * the levels bro.text.bidi() resolved?
 *
 * For a string where every cluster is one code point (which MIXED is — Latin
 * and Hebrew both shape 1:1 here) the two arrays must be element-wise equal.
 * The function reports the mismatch position rather than a bare boolean so a
 * failure says WHERE the two disagreed.
 */
export function permutationCheck(text, base, opts) {
    const vis = visualOrderOf(text, opts);
    const expected = reorderFor(text, base);
    const got = vis.order;
    let firstMismatch = -1;
    const n = Math.min(expected.length, got.length);
    for (let i = 0; i < n; i++) {
        if (expected[i] !== got[i]) { firstMismatch = i; break; }
    }
    const sameLength = expected.length === got.length;
    return {
        text, base,
        expected, got,
        sameLength,
        matches: sameLength && firstMismatch === -1,
        firstMismatch,
        // x must be strictly increasing across the visual list — that IS what
        // "visual order" means, and it is an independent way to catch a run
        // that was reordered in the index space but not in the pen space.
        monotonicX: vis.xs.every((x, i) => i === 0 || x >= vis.xs[i - 1] - 1e-4),
        xs: vis.xs,
        rtlFlags: vis.rtlFlags,
    };
}

// ── Caret geometry across a direction boundary ──────────────────────────────

/**
 * Walk every byte offset in `text` and record where bro.text.byteOffsetToX
 * puts the caret.
 *
 * The shape of the answer is the interesting part. Inside an LTR run x
 * increases with the offset; inside an RTL run it DECREASES, because logical
 * "next character" is visually leftward. That sign flip is the whole of
 * bidi caret behaviour and it is directly observable here.
 *
 * THE CASE THIS EXISTS FOR — at a direction boundary one logical offset sits
 * at TWO places on the line: the trailing edge of the run that ends there and
 * the leading edge of the one that begins. `CaretPositions` carries both, and
 * the walk records both, because counting only the primary makes a real
 * cluster edge look unreachable — no offset appears to return it — which is
 * how a caret ends up unable to reach one end of a reversed run.
 */
export function caretWalk(text, opts) {
    const o = opts || { family: 'Arial', size: 32 };
    const cps = codePoints(text);
    let bytes = 0;
    cps.forEach((c) => { bytes += c.u8Len; });
    const out = [];
    for (let off = 0; off <= bytes; off++) {
        // Only offsets that are code-point boundaries are meaningful carets.
        if (off < bytes && u16ToU8(text, u8ToU16(text, off)) !== off) continue;
        const c = bro.text.byteOffsetToX(text, o, off);
        out.push({
            byteOffset: off,
            u16Offset: u8ToU16(text, off),
            x: c.x,
            isLeadingEdge: c.isLeadingEdge,
            hasSecondary: c.secondary !== undefined,
            secondaryX: c.secondary ? c.secondary.x : null,
        });
    }
    return out;
}

/**
 * Summarise the caret walk into the facts worth asserting.
 *
 *   `decreasingInRtl` — somewhere in the walk x goes DOWN as the offset goes
 *                       UP. Only an RTL run can do that.
 *   `duplicateX`      — distinct offsets that landed on the same x. Under
 *                       correct bidi these are exactly the direction
 *                       boundaries, and each should have carried a secondary.
 *   `reachableX`      — the set of x values any offset can produce. Compared
 *                       against the cluster edges to find unreachable ones.
 */
export function caretSummary(text, opts) {
    const walk = caretWalk(text, opts);
    const r = shape(text, opts || { family: 'Arial', size: 32 });

    let decreasing = 0;
    for (let i = 1; i < walk.length; i++) {
        if (walk[i].x < walk[i - 1].x - 1e-4) decreasing++;
    }

    const byX = new Map();
    for (const w of walk) {
        const k = Math.round(w.x * 100);
        if (!byX.has(k)) byX.set(k, []);
        byX.get(k).push(w.byteOffset);
    }
    const duplicates = [...byX.values()].filter((v) => v.length > 1);

    // Every cluster edge — leading and trailing — is a place a caret must be
    // able to sit. Anything in this set no offset produces is unreachable.
    const edges = new Set();
    for (const c of r.clusters) {
        edges.add(Math.round(c.x * 100));
        edges.add(Math.round((c.x + c.advance) * 100));
    }
    // Both positions an offset can name. At a direction boundary one logical
    // offset sits at two places on the line — the trailing edge of the run
    // that ends there and the leading edge of the one that begins — and only
    // counting the primary would call the other one unreachable.
    const reachable = new Set();
    for (const w of walk) {
        reachable.add(Math.round(w.x * 100));
        if (w.secondaryX !== null) reachable.add(Math.round(w.secondaryX * 100));
    }
    const unreachable = [...edges].filter((e) => !reachable.has(e)).map((e) => e / 100);

    return {
        walk,
        decreasingSteps: decreasing,
        hasRtlCaretMotion: decreasing > 0,
        duplicates,
        anySecondary: walk.some((w) => w.hasSecondary),
        anyTrailingEdge: walk.some((w) => w.isLeadingEdge === false),
        unreachable: unreachable.sort((a, b) => a - b),
    };
}

/**
 * bro.text.xToByteOffset is the inverse: hit-test an x back to a byte offset.
 * Round-tripping every CLUSTER-LEADING offset through both must be the
 * identity — hit-testing the exact x of a caret must give that caret's offset
 * back. (Offsets INSIDE a cluster are excluded: those legitimately snap, which
 * is the documented behaviour, not a round-trip failure.)
 */
export function hitTestRoundTrip(text, opts) {
    const o = opts || { family: 'Arial', size: 32 };
    const r = shape(text, o);
    const out = [];
    for (const c of r.clusters) {
        const pos = bro.text.byteOffsetToX(text, o, c.start);
        const back = bro.text.xToByteOffset(text, o, pos.x);
        out.push({
            byteStart: c.start,
            x: pos.x,
            back,
            // In a bidi string two offsets share one x, so the round trip is
            // allowed to come back as EITHER of them — what it must never do
            // is land somewhere that is not a cluster boundary at all.
            onBoundary: r.clusters.some((k) => k.start === back) || back === textBytes(text),
            identity: back === c.start,
        });
    }
    return out;
}

function textBytes(text) {
    let n = 0;
    codePoints(text).forEach((c) => { n += c.u8Len; });
    return n;
}

// ── unicode-bidi: bidi-override ─────────────────────────────────────────────

/**
 * bro.text.bidi()'s third argument is the Override flag — rule X6, every
 * character takes the base level regardless of its own class. It is what CSS
 * `unicode-bidi: bidi-override` compiles to.
 *
 * Under override the paragraph must become UNIFORM (one run, one level) even
 * for text that would otherwise resolve to several — that is the entire
 * observable effect.
 */
export function overrideReport(text) {
    const normal = bro.text.bidi(text, 'ltr', false);
    const overLtr = bro.text.bidi(text, 'ltr', true);
    const overRtl = bro.text.bidi(text, 'rtl', true);
    return {
        text,
        normalUniform: normal.uniform,
        normalRuns: normal.runs.length,
        overLtrUniform: overLtr.uniform,
        overLtrLevels: overLtr.levels,
        overRtlUniform: overRtl.uniform,
        overRtlLevels: overRtl.levels,
        // Override forces every level to the base, so an LTR override is all
        // zeros and an RTL override is all ones.
        ltrAllZero: overLtr.levels.every((l) => l === 0),
        rtlAllOne: overRtl.levels.every((l) => l === 1),
    };
}

// ── DOM cross-check ─────────────────────────────────────────────────────────

/**
 * Verify the same reordering through LAYOUT rather than through the diagnostic
 * binding, using Range.getBoundingClientRect() over sub-spans of one text node.
 *
 * WHAT THIS CHECKS, and why it is the shape it is:
 *
 * For "abc אבג def" laid out LTR the three logical runs are already in
 * logical = visual order at the paragraph level, so the interesting claim is
 * not "the Hebrew is in the middle" but what happens INSIDE the Hebrew run:
 * the first Hebrew letter must be drawn to the RIGHT of the second. A
 * per-character Range rect states that directly, and it comes from layout, not
 * from the shaper — so it is genuinely independent evidence of reordering.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: a Range spanning the WHOLE RTL run, or
 * the run's last logical character. Those are the two cases a pair of caret
 * positions cannot describe, and they get their own probe (rtlRangeProbe
 * below) rather than being folded in here where a pass would be ambiguous.
 */
export function domReorderProbe() {
    const host = document.getElementById('bidiDomProbe');
    if (!host) return null;
    const node = host.firstChild;
    if (!node) return null;

    const hostRect = host.getBoundingClientRect();
    const rel = (r) => ({ left: r.left - hostRect.left, right: r.right - hostRect.left, width: r.width });
    const rectFor = (u16a, u16b) => {
        const r = document.createRange();
        r.setStart(node, u16a);
        r.setEnd(node, u16b);
        return rel(r.getBoundingClientRect());
    };

    // The engine's own answer for the same string at the same font, so the two
    // seams are compared rather than either being compared to a magic number.
    const cs = getComputedStyle(host);
    const size = parseFloat(cs.fontSize);
    const vis = visualOrderOf(MIXED, { family: 'Arial', size });
    const clusterAt = (byteStart) => vis.run.clusters.find((c) => c.start === byteStart);

    // MIXED in UTF-16 indices: "abc"=0..3, " "=3, "אבג"=4..7, " "=7, "def"=8..11
    const whole = rectFor(0, 11);
    const latin1 = rectFor(0, 3);
    const latin2 = rectFor(8, 11);
    // Per-character Hebrew, in LOGICAL order: א then ב.
    const alef = rectFor(4, 5);
    const bet = rectFor(5, 6);

    const cAlef = clusterAt(4);   // bytes 4–6, logically first Hebrew letter
    const cBet = clusterAt(6);    // bytes 6–8, logically second
    const cGimel = clusterAt(8);  // bytes 8–10, logically third

    const hebClusters = vis.run.clusters.filter((c) => c.start >= 4 && c.start < 10);

    return {
        fontSize: size,
        whole, latin1, latin2, alef, bet,
        shapedWidth: vis.run.width,
        // The whole line: layout's box for the entire text node is exactly the
        // shaped run's width. One string, two engines, one number.
        wholeMatchesShaped: Math.abs(whole.width - vis.run.width) < 0.05,
        // The two Latin runs land exactly where the shaper put their clusters.
        latin1Matches: Math.abs(latin1.left - clusterAt(0).x) < 0.05 &&
            Math.abs(latin1.right - (clusterAt(2).x + clusterAt(2).advance)) < 0.05,
        latin2Matches: Math.abs(latin2.left - clusterAt(11).x) < 0.05 &&
            Math.abs(latin2.right - (clusterAt(13).x + clusterAt(13).advance)) < 0.05,
        // THE REORDERING, seen by layout: the logically-FIRST Hebrew letter is
        // drawn to the RIGHT of the logically-second one.
        alefRightOfBet: alef.left > bet.left + 0.5,
        // And each per-character rect matches the shaper's cluster box exactly.
        alefMatches: Math.abs(alef.left - cAlef.x) < 0.05 &&
            Math.abs(alef.right - (cAlef.x + cAlef.advance)) < 0.05,
        betMatches: Math.abs(bet.left - cBet.x) < 0.05 &&
            Math.abs(bet.right - (cBet.x + cBet.advance)) < 0.05,
        // Runs appear left to right in logical run order.
        runsInOrder: latin1.right <= cGimel.x + 0.5 &&
            (cAlef.x + cAlef.advance) <= latin2.left + 0.5,
        // Hebrew clusters descend in byte order as x ascends — reordering.
        hebrewReversed: hebClusters.every((c, i) =>
            i === 0 || c.start < hebClusters[i - 1].start),
        hebClusterStarts: hebClusters.map((c) => c.start),
        shapedHebrewLeft: cGimel.x,
        shapedHebrewRight: cAlef.x + cAlef.advance,
    };
}

/**
 * Range geometry INSIDE an RTL run — the case a caret-difference gets wrong.
 *
 * Every rect above came from spans that happen to sit on one direction run.
 * These two do not, and they are where the obvious implementation fails:
 *
 *   1. A Range over the LAST logical character of the RTL run (utf16 6–7, ג).
 *      Its box is the run's LEFTMOST one, because the run is reversed — so an
 *      implementation that only ever resolves an offset to its cluster's
 *      leading edge reports the union of the two OTHER letters instead.
 *   2. A Range over the WHOLE RTL run (utf16 4–7). Both endpoints name the
 *      same visual edge if you ask for leading edges only, so the rect
 *      collapses to zero width — and a collapsed rect that is not even placed
 *      at the collapse point loses the last clue that anything happened.
 *
 * The fix both cases want is the same one: a range's extent is the sum of the
 * advances it covers, not the distance between two caret positions. This
 * checks the engine agrees, against the shaper's own cluster boxes.
 */
export function rtlRangeProbe() {
    const host = document.getElementById('bidiDomProbe');
    if (!host) return null;
    const node = host.firstChild;
    if (!node) return null;

    const hostRect = host.getBoundingClientRect();
    const rectFor = (a, b) => {
        const r = document.createRange();
        r.setStart(node, a);
        r.setEnd(node, b);
        const x = r.getBoundingClientRect();
        return { left: x.left - hostRect.left, right: x.right - hostRect.left, width: x.width, raw: x };
    };

    const cs = getComputedStyle(host);
    const size = parseFloat(cs.fontSize);
    const vis = visualOrderOf(MIXED, { family: 'Arial', size });
    const clusterAt = (byteStart) => vis.run.clusters.find((c) => c.start === byteStart);
    const cGimel = clusterAt(8);

    const gimel = rectFor(6, 7);
    const wholeRtl = rectFor(4, 7);
    const carets = [4, 5, 6, 7, 8, 9, 10].map((b) => {
        const c = bro.text.byteOffsetToX(MIXED, { family: 'Arial', size }, b);
        return { byte: b, x: c.x, secondaryX: c.secondary ? c.secondary.x : null };
    });
    // An offset at a direction boundary names two positions, so both count.
    const reachable = new Set();
    for (const c of carets) {
        reachable.add(Math.round(c.x * 100));
        if (c.secondaryX !== null) reachable.add(Math.round(c.secondaryX * 100));
    }

    // The island's own width, as the shaper reports it: the extent from the
    // leftmost cluster's left edge to the rightmost's right edge.
    const heb = vis.run.clusters.filter((c) => c.start >= 4 && c.start < 10);
    const hebLeft = Math.min(...heb.map((c) => c.x));
    const hebRight = Math.max(...heb.map((c) => c.x + c.advance));

    return {
        // 1. The last logical RTL character sits at the run's LEFT end, and
        //    its box is that one letter rather than the union of the others.
        gimelExpected: { left: cGimel.x, right: cGimel.x + cGimel.advance },
        gimelActual: { left: gimel.left, right: gimel.right },
        lastCharRectMatches: Math.abs(gimel.left - cGimel.x) < 0.5 &&
            Math.abs(gimel.right - (cGimel.x + cGimel.advance)) < 0.5,
        // 2. A range over the whole RTL run spans the whole run.
        wholeRtlRect: { left: wholeRtl.left, right: wholeRtl.right, width: wholeRtl.width },
        wholeRunExpected: { left: hebLeft, right: hebRight },
        wholeRunMatches: Math.abs(wholeRtl.left - hebLeft) < 0.5 &&
            Math.abs(wholeRtl.right - hebRight) < 0.5,
        // Both edges of the run are reachable from some byte offset — the
        // property the two rects above are built on.
        rtlTrailingEdge: cGimel.x,
        trailingEdgeReachable: reachable.has(Math.round(cGimel.x * 100)),
        carets,
    };
}

// ── Panel ───────────────────────────────────────────────────────────────────

let sampleHosts = [];
let permHost = null;
let caretCells = null;
let caretNote = null;
let overrideHost = null;
let domHost = null;

export function initBidi() {
    bidiState.available = bro.text.bidiAvailable === true;

    const availTag = document.getElementById('bidiAvailable');
    availTag.textContent = bidiState.available
        ? 'bidi resolver compiled in (ICU UAX#9 subset)'
        : 'BIDI UNAVAILABLE — every string will report one uniform LTR run';
    availTag.className = 'tag ' + (bidiState.available ? 'ok' : 'bad');

    // One block per sample: a level bar per code point, then the run table.
    const host = document.getElementById('bidiSamples');
    sampleHosts = SAMPLES.map((s) => {
        const box = el('div', 'bidi-sample');
        box.appendChild(el('div', 'bidi-label', s.label + '  ·  base=' + s.base));
        const text = el('div', 'bidi-text');
        text.textContent = s.text;
        box.appendChild(text);
        const bar = el('div', 'bidi-bar');
        box.appendChild(bar);
        const runs = el('div', 'bidi-runs');
        box.appendChild(runs);
        host.appendChild(box);
        return { bar, runs, sample: s };
    });

    permHost = document.getElementById('bidiPermutation');
    caretNote = document.getElementById('bidiCaretNote');
    overrideHost = document.getElementById('bidiOverride');
    domHost = document.getElementById('bidiDomResult');

    const carets = caretWalk(MIXED);
    caretCells = buildTable(document.getElementById('bidiCarets'),
        ['byte', 'utf16', 'char', 'caret x', 'edge', 'secondary'],
        carets.length).cells;

    refreshBidi();
}

export function refreshBidi() {
    bidiState.samples = SAMPLES.map((s) => analyze(s.text, s.base));

    bidiState.samples.forEach((a, i) => {
        const h = sampleHosts[i];
        h.bar.textContent = '';
        const labels = codePointLabels(a.text);
        labels.forEach((lbl, k) => {
            const lv = a.levels[k];
            const cell = el('span', 'lvl lvl' + Math.min(lv, 3));
            // The glyph on top, its level underneath. Printing the level is
            // the point: "it looked right" is not evidence.
            cell.appendChild(el('b', null, lbl.char === ' ' ? '␠' : lbl.char));
            cell.appendChild(el('i', null, String(lv)));
            cell.title = `${lbl.hex}  utf16 ${lbl.u16}  utf8 ${lbl.u8}  level ${lv}`;
            h.bar.appendChild(cell);
        });
        h.runs.textContent =
            `paragraph level ${a.paragraphLevel} (${a.rtlParagraph ? 'RTL' : 'LTR'}) · ` +
            (a.uniform ? 'uniform' : `${a.runs.length} runs`) + ' · ' +
            a.runs.map((r) => `[${r.byteStart},${r.byteEnd}) L${r.level}${r.rtl ? '↤' : '↦'}`).join(' ');
    });

    // Permutation cross-check.
    const perm = permutationCheck(MIXED, 'ltr');
    bidiState.permutation = perm;
    permHost.textContent =
        `"${MIXED}" · bidiReorder(levels) = [${perm.expected.join(' ')}] · ` +
        `shape() visual cluster order = [${perm.got.join(' ')}] · ` +
        (perm.matches ? 'IDENTICAL — the shaper reordered exactly as rule L2 says'
                      : `MISMATCH at index ${perm.firstMismatch}`) + ' · ' +
        `pen x monotonic across the visual list: ${perm.monotonicX ? 'yes' : 'NO'}`;
    permHost.className = perm.matches && perm.monotonicX ? 'result ok' : 'result bad';

    // Caret walk.
    const summary = caretSummary(MIXED);
    bidiState.carets = summary.walk;
    bidiState.caretSummary = summary;
    summary.walk.forEach((w, i) => {
        const c = caretCells[i];
        const ch = sliceByBytes(MIXED, w.byteOffset, w.byteOffset + 1) || '⟂';
        c[0].textContent = w.byteOffset;
        c[1].textContent = w.u16Offset;
        c[2].textContent = ch === ' ' ? '␠' : ch;
        c[3].textContent = n2(w.x);
        c[4].textContent = w.isLeadingEdge ? 'leading' : 'trailing';
        c[5].textContent = w.hasSecondary ? n2(w.secondaryX) : '—';
        c[5].className = w.hasSecondary ? 'ok' : 'neutral';
    });
    caretNote.textContent =
        `${summary.decreasingSteps} step(s) where x DECREASES as the byte offset increases ` +
        `— that is the RTL run, and only an RTL run can do it. ` +
        `${summary.duplicates.length} direction boundary/boundaries where two distinct offsets ` +
        `share one x: ${summary.duplicates.map((d) => '{' + d.join(',') + '}').join(' ')}. ` +
        `Secondary caret returned at any of them: ${summary.anySecondary ? 'yes' : 'NO — see note'}. ` +
        `Cluster edges no offset can reach: ` +
        (summary.unreachable.length ? summary.unreachable.map(n2).join(', ') : 'none');
    caretNote.className = summary.anySecondary && summary.unreachable.length === 0
        ? 'note ok' : 'note warn';

    // Override.
    const ov = overrideReport(MIXED);
    bidiState.overrides = ov;
    overrideHost.textContent =
        `normal: ${ov.normalRuns} run(s), uniform=${ov.normalUniform} · ` +
        `unicode-bidi:bidi-override + direction:ltr → levels all 0: ${ov.ltrAllZero ? 'yes' : 'NO'}, uniform=${ov.overLtrUniform} · ` +
        `+ direction:rtl → levels all 1: ${ov.rtlAllOne ? 'yes' : 'NO'}, uniform=${ov.overRtlUniform}`;
    overrideHost.className = 'result ' +
        (ov.ltrAllZero && ov.rtlAllOne && ov.overLtrUniform && ov.overRtlUniform ? 'ok' : 'bad');

    // DOM cross-check.
    const dom = domReorderProbe();
    bidiState.dom = dom;
    if (dom) {
        domHost.textContent =
            `Whole line: layout ${n2(dom.whole.width)}px, shaper ${n2(dom.shapedWidth)}px — ` +
            `${dom.wholeMatchesShaped ? 'identical' : 'MISMATCH'}. ` +
            `abc [${n2(dom.latin1.left)}–${n2(dom.latin1.right)}] and def ` +
            `[${n2(dom.latin2.left)}–${n2(dom.latin2.right)}] land exactly on the shaper's clusters: ` +
            `${dom.latin1Matches && dom.latin2Matches ? 'yes' : 'NO'}. ` +
            `Inside the Hebrew run, the logically FIRST letter א [${n2(dom.alef.left)}–${n2(dom.alef.right)}] ` +
            `is drawn to the RIGHT of the logically second ב [${n2(dom.bet.left)}–${n2(dom.bet.right)}]: ` +
            `${dom.alefRightOfBet ? 'yes — layout is showing the reordering' : 'NO'}, ` +
            `and both match the shaper's boxes: ${dom.alefMatches && dom.betMatches ? 'yes' : 'NO'}. ` +
            `Cluster byte-starts descend as x ascends [${dom.hebClusterStarts.join(' ')}]: ` +
            `${dom.hebrewReversed ? 'yes' : 'NO'}.`;
        domHost.className = 'result ' +
            (dom.wholeMatchesShaped && dom.latin1Matches && dom.latin2Matches &&
             dom.alefRightOfBet && dom.alefMatches && dom.betMatches && dom.hebrewReversed
                ? 'ok' : 'bad');
    }

    // The two cases a caret-difference gets wrong, stated on screen.
    const rr = rtlRangeProbe();
    bidiState.rtlRange = rr;
    const rrHost = document.getElementById('bidiRtlRange');
    if (rr && rrHost) {
        const ok = rr.lastCharRectMatches && rr.wholeRunMatches && rr.trailingEdgeReachable;
        rrHost.textContent =
            `The LAST logical Hebrew letter ג is drawn at the run's LEFT end: Range reports ` +
            `[${n2(rr.gimelActual.left)}–${n2(rr.gimelActual.right)}], the shaper's cluster box is ` +
            `[${n2(rr.gimelExpected.left)}–${n2(rr.gimelExpected.right)}] — ` +
            `${rr.lastCharRectMatches ? 'identical' : 'MISMATCH'}. ` +
            `A Range over the WHOLE RTL run spans [${n2(rr.wholeRtlRect.left)}–${n2(rr.wholeRtlRect.right)}] ` +
            `against the run's own [${n2(rr.wholeRunExpected.left)}–${n2(rr.wholeRunExpected.right)}]: ` +
            `${rr.wholeRunMatches ? 'identical' : 'MISMATCH — the collapse this case is famous for'}. ` +
            `The run's left edge x ${n2(rr.rtlTrailingEdge)} is reachable from a byte offset: ` +
            `${rr.trailingEdgeReachable ? 'yes' : 'NO — no offset resolves to it'}. ` +
            `Caret x for bytes 4–10: ${rr.carets.map((c) => `${c.byte}:${n2(c.x)}`).join(' ')}.`;
        rrHost.className = 'result ' + (ok ? 'ok' : 'bad');
    }
}
