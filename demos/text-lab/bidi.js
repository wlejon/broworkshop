// bidi.js — the Unicode Bidirectional Algorithm (UAX #9) as bro implements it.
//
// Three things must agree for RTL text to be right, and each is checked
// against the others rather than against a hardcoded expectation:
//
//   1. LEVEL RESOLUTION  bro.text.bidi(): what level is each character at?
//   2. REORDERING        bro.text.bidiReorder(): rule L2 alone.
//   3. SHAPING           bro.text.shape() runs both internally and emits its
//                        cluster map ALREADY IN VISUAL ORDER.
//
// The strong test is that (3) reproduces (1)+(2). Then a fourth seam: the
// live layout, through Range.getBoundingClientRect() over sub-spans of a
// mixed-direction text node.

import { codePoints, u16ToU8, u8ToU16, sliceByBytes, codePointLabels, utf8Length } from '/lib/kit/text.js';
import { h, clear } from '/lib/kit/dom.js';
import { shape } from '/app/shaping.js';
import { n2, table, result, glyphCell } from '/app/report.js';

// Latin, Hebrew, Latin: every interesting boundary appears twice.
//   a(0) b(1) c(2) ␠(3) א(4-5) ב(6-7) ג(8-9) ␠(10) d(11) e(12) f(13)
// 11 code points, 14 bytes. Every "off by one" offset below is that difference.
export const MIXED = 'abc אבג def';
// RTL run first: P2/P3 resolve the PARAGRAPH to RTL, the Latin is embedded.
export const MIXED_RTL_FIRST = 'אבג abc דהו';
// European digits in an Arabic context resolve to level 2: LTR inside RTL.
export const ARABIC_NUMBERS = 'العدد 123 نهاية';

export const SAMPLES = [
    { id: 'mixed', label: 'LTR base, RTL run', text: MIXED, base: 'ltr' },
    { id: 'rtlfirst', label: 'auto → RTL paragraph', text: MIXED_RTL_FIRST, base: 'auto' },
    { id: 'numbers', label: 'digits inside Arabic', text: ARABIC_NUMBERS, base: 'auto' },
    { id: 'pure', label: 'pure LTR (uniform)', text: 'plain english text', base: 'auto' },
    { id: 'purertl', label: 'pure RTL (uniform)', text: 'שלום עולם', base: 'auto' },
];

const ARIAL32 = { family: 'Arial', size: 32 };

export const bidiState = {
    available: false,
    samples: [],
    permutation: null,
    carets: [],
    caretSummary: null,
    dom: null,
    rtlRange: null,
    overrides: null,
};

// --- level resolution ----------------------------------------------------------

/**
 * One string at one base direction. bro.text.bidi() levels are one per CODE
 * POINT, its runs are in BYTES: mixing those up passes on ASCII and fails on
 * everything else, so both forms are kept.
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
        levelsPerCodePoint: b.levels.length === cps.length,
        runs: b.runs.map((r) => ({
            byteStart: r.start, byteEnd: r.end, level: r.level,
            rtl: (r.level & 1) === 1,
            cpStart: u8ToU16(text, r.start),
            text: sliceByBytes(text, r.start, r.end),
        })),
        runsTile: runsTile(b.runs, text),
    };
}

/** Runs must tile the string exactly, in bytes: contiguous, no gaps, no overlap. */
function runsTile(runs, text) {
    if (runs.length === 0) return text.length === 0;
    let expect = 0;
    for (const r of runs) {
        if (r.start !== expect || r.end <= r.start) return false;
        expect = r.end;
    }
    return expect === utf8Length(text);
}

// --- reordering (rule L2) ------------------------------------------------------

/** bro.text.bidiReorder over a string's own resolved levels. */
export function reorderFor(text, base) {
    return bro.text.bidiReorder(bro.text.bidi(text, base || 'auto').levels);
}

/**
 * The visual order shape() produced, as CODE POINT indices: each visual
 * cluster's byteStart mapped back to its code-point index.
 */
export function visualOrderOf(text, opts) {
    const r = shape(text, opts || ARIAL32);
    const byteToIndex = new Map();
    codePoints(text).forEach((c, i) => byteToIndex.set(c.u8, i));
    return {
        run: r,
        order: r.clusters.map((c) => byteToIndex.get(c.start)),
        clusterStarts: r.clusters.map((c) => c.start),
        xs: r.clusters.map((c) => c.x),
        rtlFlags: r.clusters.map((c) => c.rtl),
    };
}

/**
 * Does shape()'s visual cluster order equal rule L2 over the levels
 * bro.text.bidi() resolved? Reports the first mismatch position, and whether
 * pen x rises across the visual list (reordered in pen space too).
 */
export function permutationCheck(text, base, opts) {
    const vis = visualOrderOf(text, opts);
    const expected = reorderFor(text, base);
    const got = vis.order;
    let firstMismatch = -1;
    for (let i = 0; i < Math.min(expected.length, got.length); i++) {
        if (expected[i] !== got[i]) { firstMismatch = i; break; }
    }
    const sameLength = expected.length === got.length;
    return {
        text, base, expected, got, sameLength,
        matches: sameLength && firstMismatch === -1,
        firstMismatch,
        monotonicX: vis.xs.every((x, i) => i === 0 || x >= vis.xs[i - 1] - 1e-4),
        xs: vis.xs,
        rtlFlags: vis.rtlFlags,
    };
}

// --- caret geometry across a direction boundary --------------------------------

/**
 * bro.text.byteOffsetToX at every code-point boundary. Inside an RTL run x
 * FALLS as the offset rises. At a direction boundary one logical offset sits
 * at two places (the trailing edge of the run that ends, the leading edge of
 * the one that begins); CaretPositions carries both, and so does the walk.
 */
export function caretWalk(text, opts) {
    const o = opts || ARIAL32;
    const bytes = utf8Length(text);
    const out = [];
    for (let off = 0; off <= bytes; off++) {
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
 * The facts worth asserting about a caret walk: steps where x decreases (only
 * an RTL run can), offsets sharing an x, and cluster edges no offset reaches
 * (counting secondaries, or a real edge looks unreachable).
 */
export function caretSummary(text, opts) {
    const walk = caretWalk(text, opts);
    const r = shape(text, opts || ARIAL32);
    let decreasing = 0;
    for (let i = 1; i < walk.length; i++) if (walk[i].x < walk[i - 1].x - 1e-4) decreasing++;

    const byX = new Map();
    for (const w of walk) {
        const k = Math.round(w.x * 100);
        if (!byX.has(k)) byX.set(k, []);
        byX.get(k).push(w.byteOffset);
    }
    const edges = new Set();
    for (const c of r.clusters) {
        edges.add(Math.round(c.x * 100));
        edges.add(Math.round((c.x + c.advance) * 100));
    }
    const reachable = new Set();
    for (const w of walk) {
        reachable.add(Math.round(w.x * 100));
        if (w.secondaryX !== null) reachable.add(Math.round(w.secondaryX * 100));
    }
    return {
        walk,
        decreasingSteps: decreasing,
        hasRtlCaretMotion: decreasing > 0,
        duplicates: [...byX.values()].filter((v) => v.length > 1),
        anySecondary: walk.some((w) => w.hasSecondary),
        anyTrailingEdge: walk.some((w) => w.isLeadingEdge === false),
        unreachable: [...edges].filter((e) => !reachable.has(e)).map((e) => e / 100).sort((a, b) => a - b),
    };
}

/**
 * xToByteOffset(byteOffsetToX(start)) for every cluster start. In a bidi
 * string two offsets share one x, so the inverse is one-to-many: the round
 * trip must land on SOME boundary, and is the identity only in pure LTR.
 */
export function hitTestRoundTrip(text, opts) {
    const o = opts || ARIAL32;
    const r = shape(text, o);
    const bytes = utf8Length(text);
    return r.clusters.map((c) => {
        const pos = bro.text.byteOffsetToX(text, o, c.start);
        const back = bro.text.xToByteOffset(text, o, pos.x);
        return {
            byteStart: c.start, x: pos.x, back,
            onBoundary: r.clusters.some((k) => k.start === back) || back === bytes,
            identity: back === c.start,
        };
    });
}

/**
 * bro.text.bidi's third argument is rule X6 override — what CSS
 * `unicode-bidi: bidi-override` compiles to: every level becomes the base.
 */
export function overrideReport(text) {
    const normal = bro.text.bidi(text, 'ltr', false);
    const overLtr = bro.text.bidi(text, 'ltr', true);
    const overRtl = bro.text.bidi(text, 'rtl', true);
    return {
        text,
        normalUniform: normal.uniform, normalRuns: normal.runs.length,
        overLtrUniform: overLtr.uniform, overLtrLevels: overLtr.levels,
        overRtlUniform: overRtl.uniform, overRtlLevels: overRtl.levels,
        ltrAllZero: overLtr.levels.every((l) => l === 0),
        rtlAllOne: overRtl.levels.every((l) => l === 1),
    };
}

// --- through layout ------------------------------------------------------------

/** Range rects over UTF-16 spans of #bidiDomProbe, relative to the probe, plus the matching shaped run. */
function probe() {
    const host = document.getElementById('bidiDomProbe');
    const node = host && host.firstChild;
    if (!node) return null;
    const hostRect = host.getBoundingClientRect();
    const rectFor = (a, b) => {
        const r = document.createRange();
        r.setStart(node, a);
        r.setEnd(node, b);
        const x = r.getBoundingClientRect();
        return { left: x.left - hostRect.left, right: x.right - hostRect.left, width: x.width };
    };
    // The font is pinned in CSS, so the shaped comparison uses layout's descriptor.
    const size = parseFloat(getComputedStyle(host).fontSize);
    const vis = visualOrderOf(MIXED, { family: 'Arial', size });
    const clusterAt = (byteStart) => vis.run.clusters.find((c) => c.start === byteStart);
    return { rectFor, size, vis, clusterAt };
}

const near05 = (a, b) => Math.abs(a - b) < 0.05;

/**
 * The reordering seen by LAYOUT: layout's whole-line width is the shaped
 * width, the Latin runs land on the shaper's clusters, and inside the Hebrew
 * run the logically-FIRST letter is drawn to the RIGHT of the second.
 * UTF-16 spans of MIXED: "abc" 0..3, "אבג" 4..7, "def" 8..11.
 */
export function domReorderProbe() {
    const p = probe();
    if (!p) return null;
    const { rectFor, clusterAt, vis } = p;
    const whole = rectFor(0, 11), latin1 = rectFor(0, 3), latin2 = rectFor(8, 11);
    const alef = rectFor(4, 5), bet = rectFor(5, 6);
    const cAlef = clusterAt(4), cBet = clusterAt(6), cGimel = clusterAt(8);
    const heb = vis.run.clusters.filter((c) => c.start >= 4 && c.start < 10);
    const boxMatches = (r, c) => near05(r.left, c.x) && near05(r.right, c.x + c.advance);
    return {
        fontSize: p.size,
        whole, latin1, latin2, alef, bet,
        shapedWidth: vis.run.width,
        wholeMatchesShaped: near05(whole.width, vis.run.width),
        latin1Matches: near05(latin1.left, clusterAt(0).x) &&
            near05(latin1.right, clusterAt(2).x + clusterAt(2).advance),
        latin2Matches: near05(latin2.left, clusterAt(11).x) &&
            near05(latin2.right, clusterAt(13).x + clusterAt(13).advance),
        alefRightOfBet: alef.left > bet.left + 0.5,
        alefMatches: boxMatches(alef, cAlef),
        betMatches: boxMatches(bet, cBet),
        runsInOrder: latin1.right <= cGimel.x + 0.5 && (cAlef.x + cAlef.advance) <= latin2.left + 0.5,
        hebrewReversed: heb.every((c, i) => i === 0 || c.start < heb[i - 1].start),
        hebClusterStarts: heb.map((c) => c.start),
        shapedHebrewLeft: cGimel.x,
        shapedHebrewRight: cAlef.x + cAlef.advance,
    };
}

/**
 * The two Range cases a pair of caret positions cannot describe: the RTL
 * run's LAST logical letter (its leftmost box), and a Range over the WHOLE
 * run (both endpoints name one visual edge if only leading edges exist, so
 * the rect collapses). A range's extent is the advances it covers, not the
 * distance between two carets.
 */
export function rtlRangeProbe() {
    const p = probe();
    if (!p) return null;
    const { rectFor, clusterAt, vis, size } = p;
    const cGimel = clusterAt(8);
    const gimel = rectFor(6, 7), wholeRtl = rectFor(4, 7);
    const carets = [4, 5, 6, 7, 8, 9, 10].map((b) => {
        const c = bro.text.byteOffsetToX(MIXED, { family: 'Arial', size }, b);
        return { byte: b, x: c.x, secondaryX: c.secondary ? c.secondary.x : null };
    });
    const reachable = new Set();
    for (const c of carets) {
        reachable.add(Math.round(c.x * 100));
        if (c.secondaryX !== null) reachable.add(Math.round(c.secondaryX * 100));
    }
    const heb = vis.run.clusters.filter((c) => c.start >= 4 && c.start < 10);
    const hebLeft = Math.min(...heb.map((c) => c.x));
    const hebRight = Math.max(...heb.map((c) => c.x + c.advance));
    return {
        gimelExpected: { left: cGimel.x, right: cGimel.x + cGimel.advance },
        gimelActual: { left: gimel.left, right: gimel.right },
        lastCharRectMatches: Math.abs(gimel.left - cGimel.x) < 0.5 &&
            Math.abs(gimel.right - (cGimel.x + cGimel.advance)) < 0.5,
        wholeRtlRect: { left: wholeRtl.left, right: wholeRtl.right, width: wholeRtl.width },
        wholeRunExpected: { left: hebLeft, right: hebRight },
        wholeRunMatches: Math.abs(wholeRtl.left - hebLeft) < 0.5 && Math.abs(wholeRtl.right - hebRight) < 0.5,
        rtlTrailingEdge: cGimel.x,
        trailingEdgeReachable: reachable.has(Math.round(cGimel.x * 100)),
        carets,
    };
}

// --- panel ---------------------------------------------------------------------

let ui = null;

export function initBidi() {
    bidiState.available = bro.text.bidiAvailable === true;
    const $ = (id) => document.getElementById(id);
    const samples = SAMPLES.map((s) => {
        const bar = h('div.bidi-bar'), runs = h('div.bidi-runs');
        $('bidiSamples').appendChild(h('div.bidi-sample', null,
            h('div.bidi-label', null, s.label + '  ·  base=' + s.base),
            h('div.bidi-text', null, s.text), bar, runs));
        return { bar, runs };
    });
    ui = {
        samples,
        carets: table($('bidiCarets'), ['byte', 'utf16', 'char', 'caret x', 'edge', 'secondary'],
            caretWalk(MIXED).length),
        caretNote: $('bidiCaretNote'), perm: $('bidiPermutation'), override: $('bidiOverride'),
        dom: $('bidiDomResult'), rtlRange: $('bidiRtlRange'),
    };
    refreshBidi();
}

export function refreshBidi() {
    bidiState.samples = SAMPLES.map((s) => analyze(s.text, s.base));
    bidiState.samples.forEach((a, i) => {
        const u = ui.samples[i];
        clear(u.bar);
        codePointLabels(a.text).forEach((lbl, k) => {
            const lv = a.levels[k];
            u.bar.appendChild(glyphCell('lvl lvl' + Math.min(lv, 3), lbl.char, String(lv),
                `${lbl.hex}  utf16 ${lbl.u16}  utf8 ${lbl.u8}  level ${lv}`));
        });
        u.runs.textContent =
            `paragraph level ${a.paragraphLevel} (${a.rtlParagraph ? 'RTL' : 'LTR'}) · ` +
            (a.uniform ? 'uniform' : `${a.runs.length} runs`) + ' · ' +
            a.runs.map((r) => `[${r.byteStart},${r.byteEnd}) L${r.level}${r.rtl ? '↤' : '↦'}`).join(' ');
    });

    const perm = bidiState.permutation = permutationCheck(MIXED, 'ltr');
    result(ui.perm, perm.matches && perm.monotonicX,
        `"${MIXED}" · bidiReorder(levels) = [${perm.expected.join(' ')}] · ` +
        `shape() visual cluster order = [${perm.got.join(' ')}] · ` +
        (perm.matches ? 'IDENTICAL — the shaper reordered exactly as rule L2 says'
                      : `MISMATCH at index ${perm.firstMismatch}`) +
        ` · pen x monotonic across the visual list: ${perm.monotonicX ? 'yes' : 'NO'}`);

    const summary = bidiState.caretSummary = caretSummary(MIXED);
    bidiState.carets = summary.walk;
    summary.walk.forEach((w, i) => {
        const c = ui.carets[i];
        const ch = sliceByBytes(MIXED, w.byteOffset, w.byteOffset + 1) || '⟂';
        c[0].textContent = w.byteOffset;
        c[1].textContent = w.u16Offset;
        c[2].textContent = ch === ' ' ? '␠' : ch;
        c[3].textContent = n2(w.x);
        c[4].textContent = w.isLeadingEdge ? 'leading' : 'trailing';
        c[5].textContent = w.hasSecondary ? n2(w.secondaryX) : '—';
        c[5].className = w.hasSecondary ? 'ok' : 'dim';
    });
    ui.caretNote.textContent =
        `${summary.decreasingSteps} step(s) where x DECREASES as the byte offset increases — that is the RTL ` +
        `run, and only an RTL run can do it. ${summary.duplicates.length} direction boundary/boundaries where ` +
        `two distinct offsets share one x: ${summary.duplicates.map((d) => '{' + d.join(',') + '}').join(' ')}. ` +
        `Secondary caret returned at any of them: ${summary.anySecondary ? 'yes' : 'NO'}. ` +
        `Cluster edges no offset can reach: ` + (summary.unreachable.length ? summary.unreachable.map(n2).join(', ') : 'none');
    ui.caretNote.className = 'note ' + (summary.anySecondary && summary.unreachable.length === 0 ? 'ok' : 'warn');

    const ov = bidiState.overrides = overrideReport(MIXED);
    result(ui.override, ov.ltrAllZero && ov.rtlAllOne && ov.overLtrUniform && ov.overRtlUniform,
        `normal: ${ov.normalRuns} run(s), uniform=${ov.normalUniform} · unicode-bidi:bidi-override + direction:ltr → ` +
        `levels all 0: ${ov.ltrAllZero ? 'yes' : 'NO'}, uniform=${ov.overLtrUniform} · + direction:rtl → levels all 1: ` +
        `${ov.rtlAllOne ? 'yes' : 'NO'}, uniform=${ov.overRtlUniform}`);

    const dom = bidiState.dom = domReorderProbe();
    if (dom) {
        result(ui.dom, dom.wholeMatchesShaped && dom.latin1Matches && dom.latin2Matches &&
            dom.alefRightOfBet && dom.alefMatches && dom.betMatches && dom.hebrewReversed,
            `Whole line: layout ${n2(dom.whole.width)}px, shaper ${n2(dom.shapedWidth)}px — ` +
            `${dom.wholeMatchesShaped ? 'identical' : 'MISMATCH'}. abc [${n2(dom.latin1.left)}–${n2(dom.latin1.right)}] ` +
            `and def [${n2(dom.latin2.left)}–${n2(dom.latin2.right)}] land exactly on the shaper's clusters: ` +
            `${dom.latin1Matches && dom.latin2Matches ? 'yes' : 'NO'}. Inside the Hebrew run, the logically FIRST ` +
            `letter א [${n2(dom.alef.left)}–${n2(dom.alef.right)}] is drawn to the RIGHT of the logically second ` +
            `ב [${n2(dom.bet.left)}–${n2(dom.bet.right)}]: ` +
            `${dom.alefRightOfBet ? 'yes — layout is showing the reordering' : 'NO'}, and both match the shaper's ` +
            `boxes: ${dom.alefMatches && dom.betMatches ? 'yes' : 'NO'}. Cluster byte-starts descend as x ascends ` +
            `[${dom.hebClusterStarts.join(' ')}]: ${dom.hebrewReversed ? 'yes' : 'NO'}.`);
    }

    const rr = bidiState.rtlRange = rtlRangeProbe();
    if (rr) {
        result(ui.rtlRange, rr.lastCharRectMatches && rr.wholeRunMatches && rr.trailingEdgeReachable,
            `The LAST logical Hebrew letter ג is drawn at the run's LEFT end: Range reports ` +
            `[${n2(rr.gimelActual.left)}–${n2(rr.gimelActual.right)}], the shaper's cluster box is ` +
            `[${n2(rr.gimelExpected.left)}–${n2(rr.gimelExpected.right)}] — ` +
            `${rr.lastCharRectMatches ? 'identical' : 'MISMATCH'}. A Range over the WHOLE RTL run spans ` +
            `[${n2(rr.wholeRtlRect.left)}–${n2(rr.wholeRtlRect.right)}] against the run's own ` +
            `[${n2(rr.wholeRunExpected.left)}–${n2(rr.wholeRunExpected.right)}]: ` +
            `${rr.wholeRunMatches ? 'identical' : 'MISMATCH — the collapse this case is famous for'}. ` +
            `The run's left edge x ${n2(rr.rtlTrailingEdge)} is reachable from a byte offset: ` +
            `${rr.trailingEdgeReachable ? 'yes' : 'NO — no offset resolves to it'}. ` +
            `Caret x for bytes 4–10: ${rr.carets.map((c) => `${c.byte}:${n2(c.x)}`).join(' ')}.`);
    }
}
