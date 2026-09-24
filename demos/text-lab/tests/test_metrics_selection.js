// test_metrics_selection.js — Text Lab, part 3: canvas TextMetrics, then
// Selection & Range across the UTF-16 / UTF-8 boundary.
//
// Run: scripts/validate.sh demos/text-lab
//
// measureText is asserted as a set of invariants between its twelve members,
// not against magic numbers that would only hold on this machine. Range
// offsets are asserted exhaustively over an astral, combining, reversed
// fixture, because a binding that forgot to convert UTF-16 to UTF-8 passes
// every ASCII test ever written.

import { check as assert, test, done, frames } from '/lib/kit/test.js';
import {
    metricsState, surfaceReport, inkSensitivityReport, alignReport, baselineReport, scalingReport,
    domAgreementReport, wordSplitProbe, METRIC_KEYS,
} from '/app/metrics.js';
import {
    roundTripReport, surrogateSplitReport, containerReport, selectionApiReport, geometryReport,
    editableSelectionReport,
} from '/app/selection.js';

resize(1600, 1000);
frames(4);

// =============================================================================
// 5. TEXTMETRICS
// =============================================================================

test('metrics: the surface is complete and nothing extra was invented', () => {
    const s = surfaceReport();
    assert(s.complete, 'all twelve spec TextMetrics members are present. Missing: ' + (s.missing.join(', ') || 'none'));
    assert(s.extra.length === 0, 'and nothing non-spec was added. Extra: ' + (s.extra.join(', ') || 'none'));
    assert(s.allNumbers, 'every member is a finite number');
    assert(METRIC_KEYS.length === 12, 'the spec surface being checked is the full twelve');
});

test('metrics: self-consistency, per sample', () => {
    for (const r of metricsState.rows) {
        assert(r.widthMatchesShape, `"${r.text}": measureText width ${r.m.width} === the shaped run's width ${r.shapedWidth}`);
        assert(r.widthMatchesClusters, `"${r.text}": and === the sum of the cluster advances ${r.clusterSum.toFixed(4)}`);
        assert(r.fontBoxNonZero,
            `"${r.text}": the font box is non-zero even when the string is empty — ` +
            'it is a property of the face, not of the string');
        assert(r.ideographicIsDescent,
            `"${r.text}": ideographicBaseline (${r.m.ideographicBaseline.toFixed(4)}) is exactly ` +
            `−fontBoundingBoxDescent (${(-r.m.fontBoundingBoxDescent).toFixed(4)})`);
        assert(r.alphabeticZero, `"${r.text}": alphabeticBaseline is 0 under the default 'alphabetic' baseline`);
        assert(r.fontBoxCoversInk, `"${r.text}": the ink box fits inside the font's line box`);
    }

    const inked = metricsState.rows.find((r) => r.text === 'Hamburgefonstiv');
    assert(inked.m.actualBoundingBoxAscent + inked.m.actualBoundingBoxDescent > 0,
        '"Hamburgefonstiv": actualBoundingBoxAscent + Descent = ' +
        `${(inked.m.actualBoundingBoxAscent + inked.m.actualBoundingBoxDescent).toFixed(3)} > 0`);
    assert(inked.m.actualBoundingBoxDescent > 0, 'and it has a real descent, because it contains a g');
    assert(inked.m.actualBoundingBoxLeft + inked.m.actualBoundingBoxRight > 0, 'and a positive ink width');

    const space = metricsState.rows.find((r) => r.text === ' ');
    assert(space.m.width > 0, 'a space has a positive ADVANCE width, got ' + space.m.width);
    assert(space.m.actualBoundingBoxAscent === 0 && space.m.actualBoundingBoxDescent === 0 &&
           space.m.actualBoundingBoxLeft === 0 && space.m.actualBoundingBoxRight === 0,
        'and an EMPTY ink box — advance and ink are genuinely different quantities, ' +
        'which a "bounding box == advance box" implementation gets wrong');

    const empty = metricsState.rows.find((r) => r.text === '');
    assert(empty.m.width === 0, 'the empty string has zero width');
    assert(empty.m.fontBoundingBoxAscent > 0 && empty.m.emHeightAscent > 0,
        'but still reports the face\'s font and em metrics — this is how the layout ' +
        'engine gets line metrics for an empty line (draw_traversal.cpp does exactly this)');
});

// The old "acemn has no descent" claim was wrong: round glyphs (a c e)
// genuinely overshoot the baseline by a fraction of a pixel, in every
// renderer. The flat-bottomed "mnx" is the no-descent case, and "acemn" is
// asserted to overshoot only slightly.
test('metrics: the ink box follows the glyphs; the font box does not', () => {
    const ink = inkSensitivityReport('64px Arial');
    assert(ink.xBelowCaps,
        `ink ascent of "acemn" (${ink.xAscent.toFixed(3)}) < that of "ABCH" (${ink.capAscent.toFixed(3)}) — ` +
        'the box tracks WHICH glyphs were measured, not just the font');
    assert(ink.capsAtMostAscenders,
        `and caps (${ink.capAscent.toFixed(3)}) ≤ ascenders "bdfkl" (${ink.ascAscent.toFixed(3)})`);
    assert(ink.flatNoDescent,
        `flat-bottomed "mnx" has no ink below the baseline at all: descent ${ink.flatDescent.toFixed(4)}`);
    assert(ink.xOnlyOvershoot,
        `"acemn" dips below it only by round-glyph overshoot: ${ink.xDescent.toFixed(4)}px < 3% of ${ink.size}px`);
    assert(ink.descHasDescent, `while "gjpqy" has ${ink.descDescent.toFixed(3)}px of it (> 15% of the size)`);
    assert(ink.fontBoxStable,
        'meanwhile fontBoundingBoxAscent did not move between the two strings — it is the ' +
        'face\'s metric and must not vary with content');
});

test('metrics: textAlign moves the alignment point by an exact amount', () => {
    const a = alignReport();
    assert(a.widthStable, 'width is identical across textAlign left/center/right — alignment moves the origin, not the text');
    assert(a.centerShift,
        'left→center moved actualBoundingBoxLeft up by exactly width/2 and actualBoundingBoxRight down by exactly width/2');
    assert(a.rightShift, 'left→right moved it by exactly the full width');
    assert(a.inkWidthStable, 'and the ink WIDTH (left+right) is invariant — same glyphs either way');
    assert(a.verticalUntouched, 'a horizontal alignment change left every vertical metric untouched');
});

test('metrics: textBaseline translates every vertical metric rigidly', () => {
    const b = baselineReport();
    assert(b.alphaIsZero, "alphabeticBaseline is 0 under textBaseline:'alphabetic'");
    assert(b.topEmAscentZero, "under 'top' the emHeightAscent collapses to 0 — the alignment point IS the em top");
    assert(b.topShiftIsEmAscent, 'and the alphabetic baseline moved down by exactly emHeightAscent');
    assert(b.rigid,
        'every vertical metric — ink ascent, ink descent, hanging baseline — translated ' +
        'by that same shift. A rigid translation, not a recomputation');
    assert(b.widthStable, 'and width was untouched by the vertical change');
    assert(b.middleBetween,
        "'middle' lands strictly between 'top' and 'bottom' — top is the most " +
        `negative (${b.top.alphabeticBaseline.toFixed(3)}), then middle ` +
        `(${b.middle.alphabeticBaseline.toFixed(3)}), then bottom (${b.bottom.alphabeticBaseline.toFixed(3)})`);
    assert(b.middleHalvesEm,
        "'middle' splits the em box exactly evenly: emHeightAscent === emHeightDescent === " +
        `${b.middle.emHeightAscent.toFixed(3)}, and they still sum to the full em`);
    assert(b.bottomEmDescentZero, "'bottom' puts the entire em box above the alignment point (emHeightDescent === 0)");
});

test('metrics: linearity in the font size', () => {
    const s = scalingReport();
    // The eight SCALABLE members double to within 2%.
    const scalable = s.checks.filter((c) => !c.ink);
    const badScalable = scalable.filter((c) => !c.ok);
    assert(badScalable.length === 0,
        `all ${scalable.length} advance/face/baseline members double from 24px to 48px ` +
        'within 2% — they are linear in the font size. Failures: ' +
        badScalable.map((c) => `${c.key} ${c.small.toFixed(3)}→${c.large.toFixed(3)} (expected ${c.expected.toFixed(3)})`).join(', '));
    // The four INK members are integral boxes around HINTED outlines, so exact
    // doubling would be asserting that hinting does not exist.
    const ink = s.checks.filter((c) => c.ink);
    assert(ink.length === 4, 'four ink members were classified as such');
    assert(s.maxInkError <= 1.5,
        `and they drift by at most ${s.maxInkError.toFixed(3)}px across a 2× size change — ` +
        'the residue of integral, hinted glyph boxes, not a scaling bug');
    assert(ink.every((c) => Math.sign(c.large) === Math.sign(c.expected) || c.expected === 0),
        'and every ink metric kept its sign across the size change');
});

test('metrics: canvas and layout agree on how wide a string is', () => {
    const rows = domAgreementReport();
    assert(rows && rows.length === 4, 'four DOM probe spans were measured');
    for (const d of rows) {
        assert(d.agrees,
            `"${d.text}" (${d.size}px ${d.family}): layout shrink-wrapped it to ` +
            `${d.domWidth.toFixed(4)}px and canvas measureText says ${d.canvasWidth.toFixed(4)}px — ` +
            `Δ${d.delta.toFixed(4)}. These reach the answer through completely different code ` +
            '(htmlayout vs CanvasScene) and bottom out in the same TextShapingEngine');
    }
    assert(rows.some((d) => d.text.indexOf('שלום') >= 0 && d.agrees), 'including the Hebrew probe');
    assert(rows.some((d) => d.text.indexOf('हिन्दी') >= 0 && d.agrees), 'and the Devanagari one');
    assert(rows.every((d) => d.text.indexOf(' ') < 0),
        'every probe in this block is a single word — see the word-split probe below');
});

// Line breaking splits at word boundaries, so its widths must carry their
// neighbours' context: asserted against the whole string shaped once, with
// the isolated-word sum named explicitly as the wrong answer.
test('metrics: multi-word text is measured with its kerning intact', () => {
    const rows = wordSplitProbe();
    assert(rows && rows.length === 2, 'the two multi-word probes were measured');
    for (const w of rows) {
        assert(w.matchesWholeShaped,
            `"${w.text}" (${w.size}px ${w.family}): layout reported ${w.domWidth.toFixed(4)}px and ` +
            `shaping the whole string at once gives ${w.wholeShaped.toFixed(4)}px (Δ${w.delta.toFixed(4)})`);
        assert(w.lostKerning > 0,
            `and shaping each word alone would have given ${w.pieceSum.toFixed(4)}px instead — ` +
            `${w.lostKerning.toFixed(4)}px wider, since dropping kerns can only widen text`);
        assert(!w.matchesPieceSum, `so layout's number is NOT the per-word sum ${w.pieceSum.toFixed(4)}px`);
    }
    const control = domAgreementReport().find((d) => d.text === 'AVWaToLT');
    assert(control && control.agrees,
        'the same characters with the spaces removed agree exactly between layout and canvas');
});

// =============================================================================
// 6. SELECTION & RANGE
// =============================================================================

test('selection: every offset pair round-trips through Range', () => {
    const rt = roundTripReport();
    assert(rt.ok,
        `all ${rt.pairs} ordered offset pairs round-trip through Range — startOffset, ` +
        'endOffset, collapsed and toString() against the JS slice. failures: ' + JSON.stringify(rt.failures.slice(0, 4)));
    assert(rt.pairs > 100, `and that is an exhaustive sweep, not a sample (${rt.pairs} pairs)`);
    assert(rt.bytes > rt.utf16,
        `the fixture really does have multi-byte characters — ${rt.bytes} UTF-8 bytes ` +
        `against ${rt.utf16} UTF-16 units, so the two domains cannot be confused for one`);
});

test('selection: offsets inside a surrogate pair produce no U+FFFD', () => {
    const su = surrogateSplitReport();
    assert(su.ok,
        'no offset inside a surrogate pair produces a U+FFFD downstream. The DOM permits ' +
        'such offsets because JS string indices do; manufacturing a replacement character ' +
        'out of one is what must not happen. rows: ' + JSON.stringify(su.rows));
});

for (const [name, report] of [['containers', containerReport], ['selection API', selectionApiReport],
                              ['range geometry', geometryReport], ['editable selection', editableSelectionReport]]) {
    test('selection: ' + name, () => {
        const rep = report();
        const bad = rep.rows.filter((r) => !r.ok);
        assert(bad.length === 0,
            `${name}: all ${rep.rows.length} checks pass. failed: ` +
            bad.map((r) => `${r.what} (want ${r.want}, got ${r.got})`).join('; '));
    });
}

test('selection: the fixture strip shows every code point', () => {
    const cells = document.querySelectorAll('#selFixture .cp');
    assert(cells.length === roundTripReport().codePoints,
        `one cell per fixture code point, got ${cells.length}`);
    assert(document.querySelectorAll('#selFixture .cp.astral').length > 0, 'the astral cells are marked');
});

done('text-lab metrics + selection');
