// test_smoke.js — headless integration test for Text Lab.
//
// Run:
//   ./build/Release/bro-headless.exe ../broworkshop/demos/text-lab \
//       ../broworkshop/demos/text-lab/tests/test_smoke.js
//
// EVERY ASSERTION HERE IS MEASURED. Text is the single easiest subsystem in an
// engine to fake-pass, because "it rendered something" and "it returned a
// number" are both true of an implementation that is completely wrong. So the
// bar throughout is a relationship that only correct behaviour can satisfy:
//
//   - A ligature is asserted as "one glyph from several bytes", read out of
//     the cluster map — not as "it drew".
//   - Kerning is asserted as width(AV) < width(A) + width(V) — a strict
//     inequality that any per-character measurement fails by construction.
//   - Bidi reordering is asserted as an exact PERMUTATION: the shaper's visual
//     cluster order must equal rule L2 applied to the levels the engine itself
//     resolved. "The Hebrew ended up on the right" would pass for a shaper
//     that never reordered at all.
//   - Arabic joining is asserted as "the same letter yields a different
//     advance in a different position", because glyph ids do not escape
//     bro::render (see the limitation report at the bottom).
//   - measureText is asserted as a set of invariants between its twelve
//     members, not against magic numbers that would only hold on this machine.
//   - Astral text is asserted as "one cluster, one caret stop, and stepping
//     never lands between the surrogates".
//
// Assertions state the CORRECT behaviour, never the current one, so the bar is
// never quietly lowered to whatever the engine happens to do. APIs the text
// surface does not expose at all are printed at the bottom rather than
// asserted. Anything deliberately not asserted is called out inline with why.

import {
    // shaping
    shapeState, shape, widthOf,
    ligatureReport, kerningReport, prefixReport, spacingReport, styleReport,
    subpixelReport, cacheProbe,
    FAMILIES, LIGATURE_FAMILY, KERN_PAIRS, ITALIC_DIVERGENT,
    // bidi
    bidiState, analyze, reorderFor, visualOrderOf, permutationCheck,
    caretWalk, caretSummary, hitTestRoundTrip, overrideReport, domReorderProbe,
    rtlRangeProbe, MIXED, MIXED_RTL_FIRST, ARABIC_NUMBERS,
    // scripts
    scriptState, coverageOf, joiningReport, lamAlefReport, devanagariReport,
    thaiReport, normalizationReport, SCRIPT_SAMPLES,
    // clusters
    clusterState, clusterMap, offsetProbe, astralReport, steppingReport,
    alignmentCheck, stepForward, stepBackward, caretStops, selectSample,
    CLUSTER_SAMPLES,
    // metrics
    metricsState, measure, surfaceReport, consistencyRow, inkSensitivityReport,
    alignReport, baselineReport, scalingReport, domAgreementReport, wordSplitProbe,
    METRIC_KEYS,
    // app
    stats, refreshAll, panelVerdicts, knownLimitations,
} from '/app/app.js';

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-4 : eps);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Fixed viewport: the DOM cross-checks below take Range rects and
// getBoundingClientRect, and both depend on the line not wrapping.
resize(1600, 1000);
advanceTime(64);
flush();

// =============================================================================
// 0. The binding surface exists at all
// =============================================================================

assert(typeof bro.text === 'object', 'bro.text is installed');
for (const fn of ['shape', 'byteOffsetToX', 'xToByteOffset', 'clusterRange',
                  'cacheStats', 'bidi', 'bidiReorder']) {
    assert(typeof bro.text[fn] === 'function', `bro.text.${fn} is a function`);
}
assert(bro.text.bidiAvailable === true,
    'the ICU UAX#9 subset is compiled in — without it every bidi assertion below ' +
    'would be vacuous (bidi.h: with it OFF everything reports one uniform LTR run)');

console.log('  ✓ bro.text binding surface');

// =============================================================================
// 1. HARFBUZZ SHAPING
// =============================================================================

// ── The engine found real font faces ───────────────────────────────────────
//
// Asserted first because every measurement below is meaningless if every
// family silently resolved to the same fallback face.
const present = shapeState.families.filter((f) => f.present);
assert(present.length >= 4,
    `at least 4 of the ${FAMILIES.length} probed families resolved to distinct faces, got ` +
    shapeState.families.map((f) => `${f.family}:${f.present ? 'yes' : 'NO'}`).join(' '));
assert(shapeState.families.find((f) => f.family === LIGATURE_FAMILY).present,
    LIGATURE_FAMILY + ' is present — the ligature assertions below need it specifically');

// ── LIGATURES: fewer glyphs than characters ────────────────────────────────
//
// The headline shaping assertion. "ffi" is 3 characters and 3 UTF-8 bytes; in
// Calibri it must come back as ONE glyph in ONE cluster spanning all three
// bytes. Read out of the cluster map, which is the engine's own introspection
// surface for exactly this.
{
    const r = shape('ffi', { family: LIGATURE_FAMILY, size: 48 });
    assert(r.glyphCount < 3,
        `"ffi" in ${LIGATURE_FAMILY} shapes to FEWER glyphs than characters: got ${r.glyphCount} of 3`);
    assert(r.glyphCount === 1, `and specifically to one glyph, got ${r.glyphCount}`);
    assert(r.clusters.length === 1, `in one cluster, got ${r.clusters.length}`);
    const c = r.clusters[0];
    assert(c.start === 0 && c.end === 3,
        `whose byte span covers all three source bytes, got ${c.start}–${c.end}`);
    assert(c.glyphs === 1, `and which reports glyphs===1, got ${c.glyphs}`);
    assert(near(c.advance, r.width),
        'the single cluster advance is the whole run width');

    // The contrast case, which is what makes the above meaningful: the SAME
    // string in Arial does not ligate, so the assertion is about the shaper
    // honouring the font, not about it always fusing.
    const arial = shape('ffi', { family: 'Arial', size: 48 });
    assert(arial.glyphCount === 3,
        'the same string in Arial stays 3 glyphs — the ligature came from the font, ' +
        'got ' + arial.glyphCount);
    assert(arial.clusters.length === 3, 'and 3 clusters in Arial');
}

// Same claim over a longer word, via the report the panel uses.
{
    const rows = ligatureReport(LIGATURE_FAMILY);
    const office = rows.find((r) => r.text === 'office');
    assert(office.glyphs < office.bytes,
        `"office" in ${LIGATURE_FAMILY}: ${office.glyphs} glyphs from ${office.bytes} bytes`);
    assert(office.fused >= 1, 'at least one multi-byte single-glyph cluster in "office"');
    assert(rows.filter((r) => r.ligated).length >= 3,
        'at least 3 of the 6 ligature samples actually ligated, got ' +
        rows.filter((r) => r.ligated).length);
}

// ── KERNING: strictly less than the sum of the parts ───────────────────────
{
    for (const family of ['Arial', 'Calibri', 'Times New Roman']) {
        if (!shapeState.families.find((f) => f.family === family && f.present)) continue;
        const av = widthOf('AV', { family, size: 64 });
        const a = widthOf('A', { family, size: 64 });
        const v = widthOf('V', { family, size: 64 });
        assert(av < a + v,
            `${family}: width("AV") ${av} is strictly less than width("A")+width("V") ${a + v}`);
        // Not a rounding artefact — the pair kern is worth real pixels.
        assert((a + v) - av > 1,
            `${family}: and by more than a pixel (${((a + v) - av).toFixed(3)}px at 64px)`);
    }

    // Across the whole pair set, most pairs must kern. A font with an empty
    // kern table would give zero everywhere, which is the failure this catches.
    const rows = kerningReport('Times New Roman');
    const kerned = rows.filter((r) => r.kerned);
    assert(kerned.length >= 4,
        `at least 4 of ${KERN_PAIRS.length} probe pairs kern in Times New Roman, got ${kerned.length}`);
    assert(rows.filter((r) => r.tightened).length >= 4,
        'and at least 4 of them kern TIGHTER (negative delta), which is what these ' +
        'shapes should do');
}

// ── Prefix measurement is wrong by construction ────────────────────────────
{
    const p = prefixReport('office', LIGATURE_FAMILY);
    assert(p.clusterSumMatches,
        'the cluster advances re-sum to the run width exactly — if they did not, ' +
        'carets would not land where glyphs are drawn');
    assert(Math.abs(p.error) > 0.5,
        `per-character measurement of "office" is off by ${p.error.toFixed(3)}px — ` +
        'shaping and summing disagree, as shaped_run.h says they must');
    assert(p.naive > p.shaped,
        'and it over-measures, because it misses both the kerns and the ligature');
}

// ── letter-spacing suppresses ligatures, and lands between clusters ────────
{
    const sp = spacingReport(LIGATURE_FAMILY);
    assert(sp.plainGlyphs === 1, 'baseline: "ffi" is 1 glyph with no letter-spacing');
    assert(sp.suppressed,
        `non-zero letter-spacing broke the ligature apart: ${sp.plainGlyphs} → ${sp.spacedGlyphs} glyphs. ` +
        'CSS requires this — a ligature is one indivisible glyph and there is nowhere ' +
        'to put the inter-character space');
    assert(sp.spacedGlyphs === 3, 'and back to one glyph per character, got ' + sp.spacedGlyphs);

    assert(sp.gapExact,
        `letter-spacing ${sp.amount}px over "${sp.gapWord}" added exactly ${sp.gaps} × ${sp.amount}px ` +
        `= n−1 gaps with no trailing gap; got ${sp.gapDelta.toFixed(4)}px`);
    // The n-1 rule specifically: a trailing gap would make the delta n × amount.
    assert(!near(sp.gapDelta, (sp.gaps + 1) * sp.amount, 0.01),
        'and NOT n gaps — a trailing gap would drag centred text leftward');

    assert(sp.wsExact,
        `word-spacing 7px over "${sp.wsWord}" added exactly ${sp.spaceCount} × 7px, ` +
        `got ${sp.wsDelta.toFixed(4)}px — it lands on U+0020 clusters only`);

    // The gaps really are BETWEEN clusters: each spaced cluster's x exceeds the
    // previous cluster's right edge by exactly the spacing amount.
    const r = shape('ffi', { family: LIGATURE_FAMILY, size: 48, letterSpacing: 2 });
    for (let i = 1; i < r.clusters.length; i++) {
        const prev = r.clusters[i - 1];
        const gap = r.clusters[i].x - (prev.x + prev.advance);
        assert(near(gap, 2, 0.01),
            `gap before cluster ${i} is exactly the 2px letter-spacing, got ${gap.toFixed(4)}`);
    }
}

// ── Style axes really re-shape ─────────────────────────────────────────────
{
    const rows = styleReport();
    for (const r of rows) {
        if (!shapeState.families.find((f) => f.family === r.family && f.present)) continue;
        assert(r.boldWider,
            `${r.family}: weight 700 is wider than weight 400 (${r.bold} > ${r.regular}) — ` +
            'weight is in the shaping cache key, not a synthetic emboldening');
        assert(r.scales,
            `${r.family}: 24px doubled (${(r.half * 2).toFixed(3)}) matches 48px (${r.regular.toFixed(3)}) ` +
            'to within 2% — advances are linear in the size');
    }
    // Italic: asserted only on the families where the italic face genuinely has
    // different advances. Arial and Times New Roman ship italics metrically
    // identical to their romans, so an italic assertion against them would pass
    // for an engine that ignored the flag entirely. Stating the reason rather
    // than quietly testing all six.
    for (const family of ITALIC_DIVERGENT) {
        if (!shapeState.families.find((f) => f.family === family && f.present)) continue;
        const r = rows.find((x) => x.family === family);
        assert(r.italicDiffers,
            `${family}: the italic face has different advances (${r.italic} vs ${r.regular}) — ` +
            'italic is a shaping input, not a skew transform');
    }
}

// ── Subpixel advances ──────────────────────────────────────────────────────
{
    const s = subpixelReport('Arial');
    assert(s.fractional > 0,
        `${s.fractional} of ${s.clusters} cluster advances have a fractional part at ${s.size}px — ` +
        'advances are not rounded to whole pixels');
    assert(s.driftMatters,
        `rounding every advance to an integer would move the end of one line by ` +
        `${Math.abs(s.drift).toFixed(3)}px — that accumulation is why they are not rounded`);
}

// ── Shaped-run cache ───────────────────────────────────────────────────────
{
    const c = cacheProbe();
    assert(c.coldMiss, 'shaping a never-seen string missed the cache');
    assert(c.warmHit, 'shaping the identical tuple again HIT and did not miss');
    assert(c.sizeMiss, 'changing only the size missed — size is part of the key');
    assert(c.spacingAmountHit,
        'changing only the letter-spacing AMOUNT (staying non-zero) still hit — ' +
        'spacing repositions output and is deliberately absent from the cache key ' +
        '(shaped_run.h: "spacing does not change which glyphs the shaper produces")');
}

console.log('  ✓ HarfBuzz shaping — ligatures, kerning, spacing, cache');

// =============================================================================
// 2. BIDI / RTL
// =============================================================================

// ── Level resolution ───────────────────────────────────────────────────────
{
    const a = analyze(MIXED, 'ltr');
    assert(a.paragraphLevel === 0, 'explicit ltr base gives paragraph level 0');
    assert(!a.uniform, 'a mixed paragraph is not uniform');
    assert(a.levelsPerCodePoint,
        `levels come back one per CODE POINT: ${a.levels.length} for ${a.codePoints} code points ` +
        '(not per byte — the Hebrew is 2 bytes each — and not per UTF-16 unit)');
    // "abc " is level 0, "אבג" is level 1, " def" is level 0.
    assert(eq(a.levels, [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]),
        'resolved levels for "abc אבג def" are [0,0,0,0,1,1,1,0,0,0,0], got [' + a.levels + ']');
    assert(a.runs.length === 3, 'which is 3 level runs, got ' + a.runs.length);
    assert(a.runs[1].rtl && a.runs[1].level === 1, 'the middle run is RTL at level 1');
    // Runs are in BYTES: 4..10 is three 2-byte Hebrew letters.
    assert(a.runs[1].byteStart === 4 && a.runs[1].byteEnd === 10,
        `the RTL run spans BYTES 4–10 (3 letters × 2 bytes), got ${a.runs[1].byteStart}–${a.runs[1].byteEnd}`);
    assert(a.runs[1].text === 'אבג', 'and slicing those bytes back gives the Hebrew, got ' + a.runs[1].text);
    assert(a.runsTile, 'runs tile the byte range contiguously with no gaps or overlaps');
}

// P2/P3 auto-detection: the first STRONG character decides the paragraph.
{
    const a = analyze(MIXED_RTL_FIRST, 'auto');
    assert(a.paragraphLevel === 1 && a.rtlParagraph,
        'a paragraph starting with a strong RTL character auto-resolves to RTL (P2/P3), got level ' +
        a.paragraphLevel);
    // Inside an RTL paragraph the embedded Latin goes to level 2, not 0.
    assert(a.levels.some((l) => l === 2),
        'and the embedded Latin run sits at level 2 — LTR inside RTL, not back at 0. levels [' +
        a.levels + ']');
    assert(a.runsTile, 'runs tile');

    const ltr = analyze('plain english text', 'auto');
    assert(ltr.paragraphLevel === 0 && ltr.uniform,
        'pure Latin auto-resolves to a uniform LTR paragraph');
    assert(ltr.runs.length === 1, 'in exactly one run');
}

// W-rules: European digits adjacent to Arabic resolve to an even (LTR) level
// INSIDE the right-to-left run, so the number reads left to right.
{
    const a = analyze(ARABIC_NUMBERS, 'auto');
    assert(a.rtlParagraph, 'an Arabic paragraph resolves RTL');
    const digitLevels = [];
    let i = 0;
    for (const ch of ARABIC_NUMBERS) {
        if (ch >= '0' && ch <= '9') digitLevels.push(a.levels[i]);
        i++;
    }
    assert(digitLevels.length === 3, 'found the three digits, got ' + digitLevels.length);
    assert(digitLevels.every((l) => (l & 1) === 0),
        'the digits resolved to an EVEN level inside the RTL paragraph — they read ' +
        'left-to-right while the text around them reads right-to-left. levels [' +
        digitLevels + ']');
    assert(digitLevels.every((l) => l >= 2),
        'and to a level deeper than the paragraph (embedded, not reset to 0), got [' + digitLevels + ']');
}

// ── Rule L2 reordering, as an exact permutation ────────────────────────────
{
    const perm = reorderFor(MIXED, 'ltr');
    assert(eq(perm, [0, 1, 2, 3, 6, 5, 4, 7, 8, 9, 10]),
        'bidiReorder over the resolved levels gives the exact expected permutation ' +
        '[0 1 2 3 6 5 4 7 8 9 10] — the three Hebrew positions reversed and nothing else. Got [' +
        perm + ']');

    // A pure-LTR paragraph must be the identity permutation.
    const idLevels = bro.text.bidi('plain text', 'ltr').levels;
    const id = bro.text.bidiReorder(idLevels);
    assert(id.every((v, i) => v === i), 'an all-level-0 line reorders to the identity');

    // A pure-RTL line must reverse completely.
    const rev = bro.text.bidiReorder([1, 1, 1, 1]);
    assert(eq(rev, [3, 2, 1, 0]), 'an all-level-1 line fully reverses, got [' + rev + ']');

    // Nested levels: L2 reverses from the highest level downward.
    const nested = bro.text.bidiReorder([0, 1, 2, 1, 0]);
    assert(eq(nested, [0, 3, 2, 1, 4]),
        'levels [0,1,2,1,0] reorder to [0,3,2,1,4] — the level-2 run stays put inside ' +
        'the reversed level-1 span. Got [' + nested + ']');
}

// ── THE CROSS-CHECK: the shaper reordered exactly as rule L2 says ──────────
//
// This is the strongest bidi assertion in the file. shape() resolves levels
// and applies L2 internally (ShapedRun::reorderRunsVisually) and emits its
// cluster map in visual order. Requiring that map to equal the permutation
// computed from bro.text.bidi + bro.text.bidiReorder means the three seams
// cannot disagree. A shaper that never reordered, or that reordered against
// different levels, fails here while still "rendering Hebrew".
{
    const p = permutationCheck(MIXED, 'ltr');
    assert(p.sameLength,
        `shape() produced one cluster per code point for this string: ${p.got.length} vs ${p.expected.length}`);
    assert(p.matches,
        'shape()\'s VISUAL cluster order equals rule L2 applied to the engine\'s own ' +
        `resolved levels. expected [${p.expected}] got [${p.got}]` +
        (p.firstMismatch >= 0 ? ` (first mismatch at ${p.firstMismatch})` : ''));
    assert(p.monotonicX,
        'and the pen x is non-decreasing across that visual list — the reordering ' +
        'happened in pen space too, not only in the index space');

    // The Hebrew clusters specifically: byte offsets DESCEND as x ascends.
    const heb = p.got.slice(4, 7);
    assert(eq(heb, [6, 5, 4]),
        'the three Hebrew code points appear on screen in reverse logical order [6 5 4], got [' + heb + ']');
    assert(p.rtlFlags.slice(4, 7).every((f) => f === true),
        'and the shaper flagged exactly those clusters rtl');
    assert(p.rtlFlags.filter((f) => f).length === 3,
        'exactly 3 rtl clusters in the run, got ' + p.rtlFlags.filter((f) => f).length);
}

// ── Caret geometry ─────────────────────────────────────────────────────────
{
    const s = caretSummary(MIXED);
    assert(s.hasRtlCaretMotion,
        `caret x DECREASES as the byte offset increases at ${s.decreasingSteps} step(s) — ` +
        'only an RTL run can do that, and it is the observable signature of bidi carets');
    assert(s.decreasingSteps === 2,
        'and at exactly 2 steps: the two interior boundaries of the 3-letter Hebrew run. Got ' +
        s.decreasingSteps);

    // Round-tripping a caret x back through the hit test must land on a cluster
    // boundary. Full identity is NOT asserted, and the reason is real rather
    // than a hedge: in a bidi string two distinct logical offsets share one x,
    // so the inverse is genuinely one-to-many and any single answer is correct.
    const rt = hitTestRoundTrip(MIXED);
    assert(rt.every((r) => r.onBoundary),
        'every caret x hit-tests back to a cluster boundary — never mid-cluster');
    const pure = hitTestRoundTrip('abcdef');
    assert(pure.every((r) => r.identity),
        'and in a pure-LTR string the round trip is the exact identity at every cluster');
}

// ── unicode-bidi: bidi-override (rule X6) ──────────────────────────────────
{
    const o = overrideReport(MIXED);
    assert(!o.normalUniform && o.normalRuns === 3, 'without override the paragraph has 3 runs');
    assert(o.overLtrUniform && o.ltrAllZero,
        'unicode-bidi:bidi-override with direction:ltr forces EVERY character to level 0 — ' +
        'one uniform run. levels [' + o.overLtrLevels + ']');
    assert(o.overRtlUniform && o.rtlAllOne,
        'and with direction:rtl to level 1 throughout. levels [' + o.overRtlLevels + ']');
}

// ── The same reordering, through layout ────────────────────────────────────
//
// Independent seam: Range.getBoundingClientRect over sub-spans of a live text
// node. If this agreed with shape() only because both were wrong the same way,
// they would still have to be wrong through completely different code paths.
{
    const d = domReorderProbe();
    assert(d, 'the DOM bidi probe element is in the tree');
    assert(d.wholeMatchesShaped,
        `layout laid the whole line out at ${d.whole.width.toFixed(4)}px and the shaper ` +
        `independently says ${d.shapedWidth.toFixed(4)}px — one string, two engines, one number`);
    assert(d.latin1Matches && d.latin2Matches,
        `the two Latin runs land exactly on the shaper's clusters: ` +
        `abc[${d.latin1.left.toFixed(2)}–${d.latin1.right.toFixed(2)}] ` +
        `def[${d.latin2.left.toFixed(2)}–${d.latin2.right.toFixed(2)}]`);
    assert(d.runsInOrder, 'and the three runs occupy left-to-right bands in logical run order');

    // The reordering itself, seen by LAYOUT: the logically-first Hebrew letter
    // is drawn to the RIGHT of the logically-second. This is independent
    // evidence — it comes from htmlayout's line boxes, not from the shaper's
    // cluster list, even though the two are asserted to agree below.
    assert(d.alefRightOfBet,
        `א (logically first) is at x ${d.alef.left.toFixed(2)} and ב (logically second) at ` +
        `${d.bet.left.toFixed(2)} — the FIRST letter is drawn to the RIGHT of the second. ` +
        'Layout is showing the reordering, not merely placing the run');
    assert(d.alefMatches && d.betMatches,
        `and each per-character Range rect matches the shaper's cluster box exactly: ` +
        `א [${d.alef.left.toFixed(2)}–${d.alef.right.toFixed(2)}], ` +
        `ב [${d.bet.left.toFixed(2)}–${d.bet.right.toFixed(2)}]`);
    assert(d.hebrewReversed,
        'and the shaper\'s cluster byte-starts DESCEND as x ascends [' +
        d.hebClusterStarts + ']');
}

// ── Range geometry inside an RTL run ────────────────────────────────────────
//
// The two cases that separate "a range's extent is the sum of the advances it
// covers" from "a range's extent is the distance between two caret positions".
// Both implementations agree on left-to-right text; only these disagree.
{
    const b = rtlRangeProbe();
    assert(b, 'the RTL Range-geometry probe ran');
    // Every cluster edge is nameable by some byte offset — the property the
    // two rects below are built on. A trailing edge that no offset returns is
    // a hole the geometry silently inherits.
    const s = caretSummary(MIXED);
    assert(s.unreachable.length === 0,
        'every cluster edge in "' + MIXED + '" is reachable from some byte offset. ' +
        'unreachable: [' + s.unreachable.map((x) => x.toFixed(2)) + ']');
    assert(b.trailingEdgeReachable,
        'including the RTL run\'s left edge x=' + b.rtlTrailingEdge.toFixed(2) +
        ', carets 4–10: [' + b.carets.map((c) => c.x.toFixed(2)) + ']');
    // The last LOGICAL character of the run is its leftmost box, not the union
    // of the letters that precede it.
    assert(b.lastCharRectMatches,
        'a Range over the last logical Hebrew letter is that letter\'s box: expected [' +
        b.gimelExpected.left.toFixed(2) + '–' + b.gimelExpected.right.toFixed(2) +
        '], got [' + b.gimelActual.left.toFixed(2) + '–' + b.gimelActual.right.toFixed(2) + ']');
    // A range over the whole run spans the whole run rather than collapsing.
    assert(b.wholeRunMatches,
        'a Range over the whole RTL run spans it: expected [' +
        b.wholeRunExpected.left.toFixed(2) + '–' + b.wholeRunExpected.right.toFixed(2) +
        '], got [' + b.wholeRtlRect.left.toFixed(2) + '–' + b.wholeRtlRect.right.toFixed(2) +
        '] (width ' + b.wholeRtlRect.width.toFixed(2) + ')');
}

console.log('  ✓ Bidi — levels, rule L2, shaper cross-check, layout cross-check');

// =============================================================================
// 3. COMPLEX SCRIPTS
// =============================================================================

// ── Font coverage is a finding, not a skip ─────────────────────────────────
{
    const rendered = scriptState.coverage.filter((c) => c.rendered);
    const tofu = scriptState.coverage.filter((c) => !c.rendered);
    assert(rendered.length === SCRIPT_SAMPLES.length,
        'every probed script found a real face on this machine. Tofu: ' +
        (tofu.map((t) => t.name).join(', ') || 'none'));
    // Each sample must produce at least as many glyphs as it has clusters, and
    // a positive width — the minimum sign of life.
    for (const c of scriptState.coverage) {
        assert(c.glyphs >= c.clusters && c.width > 0,
            `${c.name}: ${c.clusters} clusters, ${c.glyphs} glyphs, width ${c.width.toFixed(2)}`);
    }
}

// ── ARABIC: contextual joining ─────────────────────────────────────────────
//
// The brief asks for "different glyph ids". bro.text.shape() exports a glyph
// COUNT and deliberately never exports glyph ids (shaped_run.h: they "MUST NOT
// escape" bro::render). The advance of the letter's own cluster is the
// available proxy — it differs because the joined and isolated outlines are
// different glyphs. Reported as a limitation at the bottom.
{
    const j = joiningReport('ب');
    assert(j.allRtl, 'every Arabic cluster is flagged rtl by the shaper');
    assert(j.initialDiffers,
        `the SAME letter ب has a different advance initially (${j.advances.initial.toFixed(3)}) than ` +
        `isolated (${j.advances.isolated.toFixed(3)}) — a different glyph was chosen for the ` +
        'same code point purely because of its neighbours');
    assert(j.medialDiffers,
        `and medially (${j.advances.medial.toFixed(3)}) vs isolated (${j.advances.isolated.toFixed(3)})`);
    assert(j.finalDiffers,
        `and finally (${j.advances.final.toFixed(3)}) vs medially (${j.advances.medial.toFixed(3)})`);
    assert(j.joinedNarrower,
        'joined forms are narrower than the isolated form, which is what joining means: ' +
        `initial ${j.advances.initial.toFixed(2)} and medial ${j.advances.medial.toFixed(2)} ` +
        `both < isolated ${j.advances.isolated.toFixed(2)}`);
    assert(j.distinctForms >= 2,
        `the four positions produced ${j.distinctForms} distinct advances (Arial gives 2: ` +
        'initial==medial and isolated==final share outlines)');

    // A real Arabic word must shape to as many glyphs as letters and be RTL
    // throughout — a font that could not join would fall back to isolated
    // forms, which is visible as a much wider run.
    const word = shape('صباح الخير', { family: 'Arial', size: 40 });
    assert(word.clusters.every((c) => c.rtl || c.advance === 0),
        'every cluster in an Arabic word is rtl');
    assert(word.clusters[0].start > word.clusters[word.clusters.length - 1].start,
        'and the cluster list runs from the HIGHEST byte offset to the lowest — ' +
        'visual order for an RTL run');
}

// ── ARABIC: lam-alef, a mandatory ligature ─────────────────────────────────
{
    const l = lamAlefReport();
    assert(l.bytes === 4, 'لا is 2 code points / 4 UTF-8 bytes');
    assert(l.oneGlyph,
        `and shapes to ONE glyph, got ${l.glyphs}. This is a mandatory Arabic ligature — ` +
        'the two letters have no legal separate rendering');
    assert(l.oneCluster && l.spansAllBytes,
        `in one cluster spanning all 4 bytes, got ${l.clusters} cluster(s)`);
    assert(l.narrower,
        `and strictly narrower than the two letters shaped apart: ${l.width.toFixed(3)} < ${l.apart.toFixed(3)}`);
    assert(l.rtl, 'flagged rtl');
}

// ── DEVANAGARI: reordering and conjuncts ───────────────────────────────────
{
    const d = devanagariReport();
    assert(d.ki.fusedCluster,
        'क + ि (consonant + i-matra) fuses into ONE cluster — the matra is stored after ' +
        'the consonant and drawn BEFORE it, so there is no "between" for a caret to sit in');
    assert(d.ki.multiGlyphCluster,
        `and that one cluster is made of ${d.ki.glyphs} glyphs — fused for caret purposes ` +
        'without being fused into a single outline. This is why the ligature test above ' +
        'is written against glyphs-per-cluster and not against cluster size');
    assert(d.ki.spansBothBytes, 'and it spans both code points (6 bytes)');

    assert(d.ksha.oneCluster && d.ksha.oneGlyph,
        `क् + ष (ka + virama + ssa) → one cluster of one glyph from ${d.ksha.bytes} bytes: a conjunct. ` +
        `Got ${d.ksha.clusters} cluster(s), ${d.ksha.glyphs} glyph(s)`);
    assert(d.ksha.narrower,
        'and it is narrower than the two consonants side by side — a real conjunct outline, ' +
        'not two glyphs abutted');

    assert(d.word.fewerClustersThanCodePoints,
        `हिन्दी: ${d.word.codePoints} code points collapse to ${d.word.clusters} clusters — ` +
        'the word has fewer caret stops than it has characters');
    assert(d.word.glyphs > d.word.clusters,
        `and more glyphs (${d.word.glyphs}) than clusters (${d.word.clusters}) at the same time`);
}

// ── THAI: zero-advance marks ───────────────────────────────────────────────
{
    const t = thaiReport();
    assert(t.sameWidth,
        `adding a tone mark above ก changed the width by nothing at all: ` +
        `${t.baseWidth.toFixed(4)} → ${t.markedWidth.toFixed(4)}. A per-character width model ` +
        'gets this wrong by exactly one glyph advance');
    assert(t.stillSameWithTwo,
        `and two stacked marks still change nothing: ${t.twoMarksWidth.toFixed(4)}`);
    assert(t.hasZeroAdvance,
        `${t.zeroAdvanceClusters} cluster(s) have advance exactly 0`);
    assert(t.extraGlyph,
        `while the glyph count DID rise (${t.markedGlyphs} vs ${t.markedGlyphs - 1}) — the mark is ` +
        'drawn, it just occupies no horizontal space');
}

// ── Canonical equivalence ──────────────────────────────────────────────────
{
    const n = normalizationReport();
    assert(n.nfcBytes === 2 && n.nfdBytes === 3,
        `NFC "á" is 2 UTF-8 bytes and NFD "á" is 3, got ${n.nfcBytes} and ${n.nfdBytes}`);
    assert(n.bothOneCluster && n.bothOneGlyph,
        'both shape to one cluster of one glyph — HarfBuzz composed the decomposed form');
    assert(n.sameWidth,
        `and to the same width: ${n.nfcWidth.toFixed(4)} vs ${n.nfdWidth.toFixed(4)}. Different byte ` +
        'lengths, identical picture — the byte domain and the glyph domain really are decoupled');
    assert(n.nfdClusterSpansAll,
        'the decomposed form\'s single cluster covers BOTH code points, so no caret can ' +
        'land between a letter and its combining accent');
}

console.log('  ✓ Complex scripts — Arabic joining + lam-alef, Devanagari, Thai, NFC/NFD');

// =============================================================================
// 4. CLUSTER MAP, ASTRAL TEXT, CARET STEPPING
// =============================================================================

// ── The cluster map is a total, gap-free tiling ────────────────────────────
{
    for (const s of CLUSTER_SAMPLES) {
        const m = clusterMap(s.text, { family: s.family, size: s.size });
        assert(m.tiles,
            `"${s.text}" (${s.family}): clusters tile bytes [0,${m.bytes}) with no gaps or overlaps — ` +
            'without this some byte offset has no cluster and a caret there has no geometry');
        assert(near(m.advanceSum, m.width, 1e-3),
            `"${s.text}": cluster advances re-sum to the run width (${m.advanceSum.toFixed(4)} vs ${m.width.toFixed(4)})`);
        assert(m.monotonic,
            `"${s.text}": pen x is non-decreasing across the visual cluster list`);
        assert(m.clusters.every((c) => c.byteEnd > c.byteStart),
            `"${s.text}": no zero-byte clusters`);
    }

    // Reordering happened in exactly the samples that contain RTL text.
    const arabic = clusterMap('العربية', { family: 'Arial', size: 64 });
    assert(arabic.reordered, 'the Arabic sample\'s visual order differs from its logical order');
    const ascii = clusterMap('Waffle', { family: 'Arial', size: 64 });
    assert(!ascii.reordered, 'while plain ASCII is not reordered at all');
}

// ── clusterRange is total: any byte offset resolves to its whole cluster ───
{
    // Deliberately the Devanagari sample: it has multi-byte code points inside
    // multi-code-point clusters, so "an offset in the middle of a UTF-8
    // sequence inside a fused cluster" is reachable.
    const probe = offsetProbe('हिन्दी', { family: 'Arial', size: 48 });
    const bad = probe.filter((p) => !p.correct);
    assert(bad.length === 0,
        `every one of the ${probe.length} byte offsets in हिन्दी resolves to its containing ` +
        'cluster in full — including offsets inside a multi-byte code point. Failures: ' +
        bad.map((b) => `byte ${b.byte}→${b.spanStart}–${b.spanEnd}`).join(', '));

    // Specifically: the interior of a ligature returns the WHOLE ligature.
    const lig = bro.text.clusterRange('ffi', { family: LIGATURE_FAMILY, size: 48 }, 1);
    assert(lig.start === 0 && lig.end === 3,
        `an offset inside the "ffi" ligature returns the whole ligature 0–3, got ${lig.start}–${lig.end}`);
}

// ── ASTRAL: one cluster, one caret stop, offsets step over it as a unit ────
{
    const rows = astralReport();
    // A lone astral emoji: 2 UTF-16 units, 1 code point, 4 UTF-8 bytes, and it
    // must be exactly ONE cluster — one caret stop, one grapheme.
    const grin = rows.find((r) => r.id === 'grin');
    assert(grin.utf16 === 2 && grin.codePoints === 1 && grin.bytes === 4,
        `"😀" is 2 UTF-16 units / 1 code point / 4 UTF-8 bytes, got ` +
        `${grin.utf16} / ${grin.codePoints} / ${grin.bytes}`);
    assert(grin.fused && grin.caretStops === 1,
        `and is ONE cluster with ONE caret stop, got ${grin.clusters} cluster(s) / ` +
        `${grin.caretStops} stop(s)`);

    // The same emoji BETWEEN two letters is legitimately 3 clusters — a, the
    // emoji, b. Listed separately with expectFused:false so it is never counted
    // as a grapheme-clustering failure, which would be a false positive.
    const inline = rows.find((r) => r.id === 'inline');
    assert(inline.utf16 === 4 && inline.codePoints === 3 && inline.bytes === 6,
        `"a😀b" is 4 UTF-16 units / 3 code points / 6 UTF-8 bytes, got ` +
        `${inline.utf16} / ${inline.codePoints} / ${inline.bytes}`);
    assert(inline.clusters === 3,
        `and shapes to 3 clusters — the emoji is ONE of them despite spanning 4 bytes. ` +
        `Got ${inline.clusters}`);

    const map = clusterMap('a😀b', { family: 'Arial', size: 48 });
    const emojiCluster = map.logical[1];
    assert(emojiCluster.byteStart === 1 && emojiCluster.byteEnd === 5,
        `the emoji's cluster spans bytes 1–5, got ${emojiCluster.byteStart}–${emojiCluster.byteEnd}`);
    assert(emojiCluster.u16Start === 1 && emojiCluster.u16End === 3,
        `which is UTF-16 1–3 — 2 units for 4 bytes, the two offset systems disagreeing in ` +
        `opposite directions. Got ${emojiCluster.u16Start}–${emojiCluster.u16End}`);
    // Every interior byte resolves to the whole emoji.
    for (const b of [1, 2, 3, 4]) {
        const span = bro.text.clusterRange('a😀b', { family: 'Arial', size: 48 }, b);
        assert(span.start === 1 && span.end === 5,
            `byte ${b} (inside the surrogate-pair emoji) resolves to the whole cluster 1–5, ` +
            `got ${span.start}–${span.end}`);
    }

    // Skin-tone modifier: base + modifier is a real shaped sequence, and the
    // font on this machine does fuse it — 8 bytes, one cluster.
    const skin = rows.find((r) => r.id === 'skin');
    assert(skin.bytes === 8 && skin.codePoints === 2,
        'the skin-tone sequence is 2 astral code points / 8 UTF-8 bytes');
    assert(skin.fused,
        `and fuses to ONE cluster — the modifier is not separately selectable. Got ${skin.clusters}`);
}

// ── Caret stepping over astral text ────────────────────────────────────────
{
    const s = steppingReport('a😀b');
    assert(eq(s.forward, [0, 1, 5, 6]),
        `caret stops in "a😀b" are bytes [0,1,5,6] — it steps OVER the emoji as one unit and ` +
        `never lands on bytes 2, 3 or 4. Got [${s.forward}]`);
    assert(eq(s.forwardU16, [0, 1, 3, 4]),
        `which in UTF-16 is [0,1,3,4] — never index 2, which would split the surrogate pair. ` +
        `Got [${s.forwardU16}]`);
    assert(s.symmetric,
        `stepping backward retraces exactly the same stops: [${s.backward}]`);
    assert(s.allOnCodePointBoundaries, 'no stop lands mid-code-point');
    assert(s.noSplitSurrogates, 'no stop splits a surrogate pair');

    // The primitives directly, since the editing half will build on them.
    const o = { family: 'Arial', size: 48 };
    assert(stepForward('a😀b', o, 1) === 5, 'stepForward from before the emoji jumps to after it');
    assert(stepForward('a😀b', o, 3) === 5, 'and from INSIDE it also lands after it — never mid-glyph');
    assert(stepBackward('a😀b', o, 5) === 1, 'stepBackward from after the emoji lands before it');
    assert(stepBackward('a😀b', o, 3) === 1, 'and from inside it also lands before it');
    assert(stepForward('a😀b', o, 6) === 6, 'stepping forward at the end is a fixed point');
    assert(stepBackward('a😀b', o, 0) === 0, 'and backward at the start');

    // The same guarantee over a ligature: 6 bytes of "office" in Calibri is
    // FEWER caret stops than 6, because the ffi fused.
    const ligStops = caretStops('office', { family: LIGATURE_FAMILY, size: 48 });
    assert(ligStops.length - 1 < 6,
        `"office" in ${LIGATURE_FAMILY} has ${ligStops.length - 1} caret stops for 6 characters — ` +
        'the ligature is one stop. This is the documented cluster-stepping behaviour and ' +
        'differs from Chromium, which subdivides a ligature by grapheme (shaped_run.h)');
}

// ── canvas fillText and bro.text.shape are ONE shaping path ────────────────
{
    const canvas = document.getElementById('clusterCanvas');
    const rows = alignmentCheck(canvas);
    for (const r of rows) {
        assert(r.identical,
            `"${r.text}" (${r.size}px ${r.family}): canvas measureText ${r.canvasW} === ` +
            `bro.text.shape width ${r.shapedW}. These are two readings of the SAME ShapedRun, ` +
            'so anything but exact equality means a second shaping path exists. Δ=' + r.delta);
    }
}

// The panel repaints without throwing for every sample, including the RTL and
// Devanagari ones where the drawing code walks reordered clusters.
{
    for (let i = 0; i < CLUSTER_SAMPLES.length; i++) {
        const m = selectSample(i);
        assert(m.clusters.length > 0, `sample ${i} (${CLUSTER_SAMPLES[i].label}) drew clusters`);
    }
    selectSample(0);
    flush();
}

console.log('  ✓ Cluster map, astral text, caret stepping');

// =============================================================================
// 5. TEXTMETRICS
// =============================================================================

// ── The surface is complete and nothing extra was invented ─────────────────
{
    const s = surfaceReport();
    assert(s.complete,
        'all twelve spec TextMetrics members are present. Missing: ' +
        (s.missing.join(', ') || 'none'));
    assert(s.extra.length === 0,
        'and nothing non-spec was added. Extra: ' + (s.extra.join(', ') || 'none'));
    assert(s.allNumbers, 'every member is a finite number');
    assert(METRIC_KEYS.length === 12, 'the spec surface being checked is the full twelve');
}

// ── Self-consistency, per sample ───────────────────────────────────────────
{
    for (const r of metricsState.rows) {
        assert(r.widthMatchesShape,
            `"${r.text}": measureText width ${r.m.width} === the shaped run's width ${r.shapedWidth}`);
        assert(r.widthMatchesClusters,
            `"${r.text}": and === the sum of the cluster advances ${r.clusterSum.toFixed(4)}`);
        assert(r.fontBoxNonZero,
            `"${r.text}": the font box is non-zero even when the string is empty — ` +
            'it is a property of the face, not of the string');
        assert(r.ideographicIsDescent,
            `"${r.text}": ideographicBaseline (${r.m.ideographicBaseline.toFixed(4)}) is exactly ` +
            `−fontBoundingBoxDescent (${(-r.m.fontBoundingBoxDescent).toFixed(4)})`);
        assert(r.alphabeticZero,
            `"${r.text}": alphabeticBaseline is 0 under the default 'alphabetic' baseline`);
        assert(r.fontBoxCoversInk,
            `"${r.text}": the ink box fits inside the font's line box`);
    }

    // Inked text has a positive ink box; a space has none at all.
    const inked = metricsState.rows.find((r) => r.text === 'Hamburgefonstiv');
    assert(inked.m.actualBoundingBoxAscent + inked.m.actualBoundingBoxDescent > 0,
        `"Hamburgefonstiv": actualBoundingBoxAscent + Descent = ` +
        `${(inked.m.actualBoundingBoxAscent + inked.m.actualBoundingBoxDescent).toFixed(3)} > 0`);
    assert(inked.m.actualBoundingBoxDescent > 0,
        'and it has a real descent, because it contains a g');
    assert(inked.m.actualBoundingBoxLeft + inked.m.actualBoundingBoxRight > 0,
        'and a positive ink width');

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
}

// ── The ink box follows the glyphs; the font box does not ──────────────────
{
    const ink = inkSensitivityReport('64px Arial');
    assert(ink.xBelowCaps,
        `ink ascent of "acemn" (${ink.xAscent.toFixed(3)}) < that of "ABCH" (${ink.capAscent.toFixed(3)}) — ` +
        'the box tracks WHICH glyphs were measured, not just the font');
    assert(ink.capsAtMostAscenders,
        `and caps (${ink.capAscent.toFixed(3)}) ≤ ascenders "bdfkl" (${ink.ascAscent.toFixed(3)})`);
    assert(ink.xNoDescent,
        `"acemn" has no ink below the baseline at all: descent ${ink.xDescent.toFixed(4)}`);
    assert(ink.descHasDescent,
        `while "gjpqy" has ${ink.descDescent.toFixed(3)}px of it`);
    assert(ink.fontBoxStable,
        'meanwhile fontBoundingBoxAscent did not move between the two strings — it is the ' +
        'face\'s metric and must not vary with content');
}

// ── textAlign moves the alignment point by an exact amount ─────────────────
{
    const a = alignReport();
    assert(a.widthStable,
        'width is identical across textAlign left/center/right — alignment moves the ' +
        'origin, not the text');
    assert(a.centerShift,
        'left→center moved actualBoundingBoxLeft up by exactly width/2 and ' +
        'actualBoundingBoxRight down by exactly width/2');
    assert(a.rightShift, 'left→right moved it by exactly the full width');
    assert(a.inkWidthStable,
        'and the ink WIDTH (left+right) is invariant — same glyphs either way');
    assert(a.verticalUntouched,
        'a horizontal alignment change left every vertical metric untouched');
}

// ── textBaseline translates every vertical metric rigidly ──────────────────
{
    const b = baselineReport();
    assert(b.alphaIsZero, "alphabeticBaseline is 0 under textBaseline:'alphabetic'");
    assert(b.topEmAscentZero,
        "under 'top' the emHeightAscent collapses to 0 — the alignment point IS the em top");
    assert(b.topShiftIsEmAscent,
        'and the alphabetic baseline moved down by exactly emHeightAscent');
    assert(b.rigid,
        'every vertical metric — ink ascent, ink descent, hanging baseline — translated ' +
        'by that same shift. A rigid translation, not a recomputation');
    assert(b.widthStable, 'and width was untouched by the vertical change');
    assert(b.middleBetween,
        "'middle' lands strictly between 'top' and 'bottom' — with the sign convention " +
        'that a baseline below the alignment point is negative, so top is the most ' +
        `negative (${b.top.alphabeticBaseline.toFixed(3)}), then middle ` +
        `(${b.middle.alphabeticBaseline.toFixed(3)}), then bottom (${b.bottom.alphabeticBaseline.toFixed(3)})`);
    assert(b.middleHalvesEm,
        "'middle' splits the em box exactly evenly: emHeightAscent === emHeightDescent === " +
        `${b.middle.emHeightAscent.toFixed(3)}, and they still sum to the full em`);
    assert(b.bottomEmDescentZero,
        "'bottom' puts the entire em box above the alignment point (emHeightDescent === 0)");
}

// ── Linearity in the font size ─────────────────────────────────────────────
{
    const s = scalingReport();
    // The eight SCALABLE members must double to within 2%: they come from the
    // face's units-per-em scaled by the size and land on Skia's 1/64px grid.
    const scalable = s.checks.filter((c) => !c.ink);
    const badScalable = scalable.filter((c) => !c.ok);
    assert(badScalable.length === 0,
        `all ${scalable.length} advance/face/baseline members double from 24px to 48px ` +
        'within 2% — they are linear in the font size. Failures: ' +
        badScalable.map((c) => `${c.key} ${c.small.toFixed(3)}→${c.large.toFixed(3)} (expected ${c.expected.toFixed(3)})`).join(', '));

    // The four INK members are deliberately held to a looser bar, and the
    // reason is stated rather than the tolerance being widened silently:
    // actualBoundingBox* is the union of glyph bounding boxes, which Skia
    // reports as INTEGRAL pixel rectangles around the HINTED outline at that
    // size. 'Hamburgefonstiv' has ink ascent 17 at 24px and 35 at 48px, not 34.
    // Asserting exact doubling here would be asserting that hinting does not
    // exist. What IS asserted is that the drift stays sub-pixel-ish.
    const ink = s.checks.filter((c) => c.ink);
    assert(ink.length === 4, 'four ink members were classified as such');
    assert(s.maxInkError <= 1.5,
        `and they drift by at most ${s.maxInkError.toFixed(3)}px across a 2× size change — ` +
        'the residue of integral, hinted glyph boxes, not a scaling bug');
    assert(ink.every((c) => Math.sign(c.large) === Math.sign(c.expected) || c.expected === 0),
        'and every ink metric kept its sign across the size change');
}

// ── Canvas and layout agree on how wide a string is ────────────────────────
{
    const rows = domAgreementReport();
    assert(rows && rows.length === 4, 'four DOM probe spans were measured');
    for (const d of rows) {
        assert(d.agrees,
            `"${d.text}" (${d.size}px ${d.family}): layout shrink-wrapped it to ` +
            `${d.domWidth.toFixed(4)}px and canvas measureText says ${d.canvasWidth.toFixed(4)}px — ` +
            `Δ${d.delta.toFixed(4)}. These reach the answer through completely different code ` +
            '(htmlayout vs CanvasScene) and bottom out in the same TextShapingEngine');
    }
    // Including the RTL and Devanagari probes specifically — the two where an
    // engine that measured logically but laid out visually would diverge.
    assert(rows.some((d) => d.text.indexOf('שלום') >= 0 && d.agrees),
        'including the Hebrew probe');
    assert(rows.some((d) => d.text.indexOf('हिन्दी') >= 0 && d.agrees),
        'and the Devanagari one');
    // Every probe is a SINGLE WORD, deliberately. The multi-word case is
    // separated out immediately below because layout gets it wrong, and the
    // scoping is stated rather than the tolerance being widened to hide it.
    assert(rows.every((d) => d.text.indexOf(' ') < 0),
        'every probe in this block is a single word — see the word-split probe below');
}

// ── Multi-word text is measured with its kerning intact ────────────────────
//
// Line breaking splits text at word boundaries, so the widths it produces have
// to carry their neighbours' context. Asserted against the whole string shaped
// once, with the isolated-word sum named explicitly as the wrong answer — the
// two only differ by the kerns that straddle a space, which is exactly the
// quantity a per-word implementation drops.
{
    const rows = wordSplitProbe();
    assert(rows && rows.length === 2, 'the two multi-word probes were measured');
    for (const w of rows) {
        assert(w.matchesWholeShaped,
            `"${w.text}" (${w.size}px ${w.family}): layout reported ${w.domWidth.toFixed(4)}px and ` +
            `shaping the whole string at once gives ${w.wholeShaped.toFixed(4)}px (Δ${w.delta.toFixed(4)})`);
        // The control that gives the assertion its teeth: the isolated-word sum
        // is a DIFFERENT number, so passing above is not vacuous.
        assert(w.lostKerning > 0,
            `and shaping each word alone would have given ${w.pieceSum.toFixed(4)}px instead — ` +
            `${w.lostKerning.toFixed(4)}px wider, since dropping kerns can only widen text. ` +
            'That is the line that would have overflowed the box measured for it');
        assert(!w.matchesPieceSum,
            `so layout's number is NOT the per-word sum ${w.pieceSum.toFixed(4)}px`);
    }
    // With no space to split at, layout and canvas agree exactly — so the
    // spaced cases above are testing the split, not two divergent text paths.
    const control = domAgreementReport().find((d) => d.text === 'AVWaToLT');
    assert(control && control.agrees,
        'the same characters with the spaces removed agree exactly between layout and canvas');
}

console.log('  ✓ TextMetrics — complete surface, mutual consistency, DOM agreement');

// =============================================================================
// 6. THE APP ITSELF
// =============================================================================

// Panels are idempotent: running every driver a second time must not change
// any verdict. This catches a panel that accumulates into its own report.
{
    const before = JSON.stringify(panelVerdicts());
    refreshAll();
    flush();
    const after = JSON.stringify(panelVerdicts());
    assert(before === after,
        'refreshing every panel a second time produced identical verdicts — the panels ' +
        'are pure functions of the engine, not accumulators');
}

// The app's own on-screen summary agrees with this test's independent
// conclusions. If a panel showed green while the test said red, the panel
// would be lying to a human reader, which is its own bug.
{
    const v = panelVerdicts();
    for (const k in v) {
        assert(v[k] === true,
            `the ${k} panel's own verdict is green, matching this test's independent findings`);
    }
}

// The frame loop kept running throughout.
{
    advanceTime(300);
    flush();
    assert(stats.frames > 10, 'the rAF loop kept running, frames = ' + stats.frames);
}

// A resize must not disturb anything: nothing in this lab is viewport-relative,
// and the DOM cross-checks must still hold at a different width.
{
    resize(1280, 900);
    advanceTime(64);
    flush();
    const d = domReorderProbe();
    assert(d.wholeMatchesShaped && d.alefRightOfBet && d.alefMatches,
        'the bidi DOM probe still agrees with the shaper after a resize');
    const rows = domAgreementReport();
    assert(rows.every((r) => r.agrees),
        'and layout still agrees with canvas measureText at the new viewport width');
    resize(1600, 1000);
    flush();
}

console.log('  ✓ App drivers, idempotence, resize stability');

// =============================================================================
// SURFACE GAPS — what the text APIs do not expose
// =============================================================================
//
// Absent APIs rather than wrong answers: everything this test measures has to
// agree with the shaper or with canvas, and does. Printed, not asserted — each
// entry is computed live, so an entry that gains an API flips to "resolved" on
// the next run instead of silently going stale.

console.log('');
console.log('  text surface gaps observed by this run:');
for (const lim of knownLimitations()) {
    console.log(`    [${lim.stillPresent ? 'PRESENT ' : 'resolved'}] ${lim.id}`);
    console.log(`        ${lim.what}`);
    console.log(`        evidence: ${lim.evidence}`);
}

console.log('');
console.log('  font coverage on this machine:');
for (const c of scriptState.coverage) {
    console.log(`    ${c.rendered ? 'ok  ' : 'TOFU'} ${c.name.padEnd(16)} ` +
        `${c.codePoints} cp / ${c.bytes} B → ${c.clusters} clusters → ${c.glyphs} glyphs`);
}
for (const a of clusterState.astral) {
    // Only a sequence that SHOULD have been one grapheme counts as split.
    const tag = !a.expectFused ? 'n/a ' : (a.fused ? 'ok  ' : 'SPLIT');
    console.log(`    ${tag} ${a.label.padEnd(30)} ` +
        `${a.clusters} cluster(s), ${a.caretStops} caret stop(s)`);
}

console.log('');
console.log('text-lab smoke test: all assertions passed');
