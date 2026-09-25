// test_smoke.js — Text Lab, part 1: the bro.text binding surface, HarfBuzz
// shaping, and bidi. The other parts: test_scripts_clusters.js,
// test_metrics_selection.js, test_editing_app.js.
//
// Run: scripts/validate.sh demos/text-lab
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
//
// Assertions state the CORRECT behaviour, never the current one, so the bar is
// never quietly lowered to whatever the engine happens to do.

import { check as assert, test, done, frames } from '/lib/kit/test.js';
import {
    shapeState, shape, widthOf, ligatureReport, kerningReport, prefixReport, spacingReport,
    styleReport, subpixelReport, cacheProbe, FAMILIES, LIGATURE_FAMILY, KERN_PAIRS, ITALIC_DIVERGENT,
} from '/app/shaping.js';
import {
    analyze, reorderFor, permutationCheck, caretSummary, hitTestRoundTrip, overrideReport,
    domReorderProbe, rtlRangeProbe, MIXED, MIXED_RTL_FIRST, ARABIC_NUMBERS,
} from '/app/bidi.js';

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-4 : eps);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Fixed viewport: the DOM cross-checks take Range rects and
// getBoundingClientRect, and both depend on the line not wrapping.
resize(1600, 1000);
frames(4);

// =============================================================================
// 0. The binding surface exists at all
// =============================================================================

test('bro.text binding surface', () => {
    assert(typeof bro.text === 'object', 'bro.text is installed');
    for (const fn of ['shape', 'byteOffsetToX', 'xToByteOffset', 'clusterRange',
                      'cacheStats', 'bidi', 'bidiReorder']) {
        assert(typeof bro.text[fn] === 'function', `bro.text.${fn} is a function`);
    }
    assert(bro.text.bidiAvailable === true,
        'the ICU UAX#9 subset is compiled in — without it every bidi assertion below ' +
        'would be vacuous (bidi.h: with it OFF everything reports one uniform LTR run)');
});

// =============================================================================
// 1. HARFBUZZ SHAPING
// =============================================================================

// Asserted first because every measurement below is meaningless if every
// family silently resolved to the same fallback face.
test('shaping: real font faces were found', () => {
    const present = shapeState.families.filter((f) => f.present);
    assert(present.length >= 4,
        `at least 4 of the ${FAMILIES.length} probed families resolved to distinct faces, got ` +
        shapeState.families.map((f) => `${f.family}:${f.present ? 'yes' : 'NO'}`).join(' '));
    assert(shapeState.families.find((f) => f.family === LIGATURE_FAMILY).present,
        LIGATURE_FAMILY + ' is present — the ligature assertions below need it specifically');
});

// "ffi" is 3 characters and 3 UTF-8 bytes; in the ligature face (Calibri on
// Windows, Hoefler Text on macOS) it must come back as ONE
// glyph in ONE cluster spanning all three bytes.
test('shaping: ligatures are fewer glyphs than characters', () => {
    const r = shape('ffi', { family: LIGATURE_FAMILY, size: 48 });
    assert(r.glyphCount < 3,
        `"ffi" in ${LIGATURE_FAMILY} shapes to FEWER glyphs than characters: got ${r.glyphCount} of 3`);
    assert(r.glyphCount === 1, `and specifically to one glyph, got ${r.glyphCount}`);
    assert(r.clusters.length === 1, `in one cluster, got ${r.clusters.length}`);
    const c = r.clusters[0];
    assert(c.start === 0 && c.end === 3,
        `whose byte span covers all three source bytes, got ${c.start}–${c.end}`);
    assert(c.glyphs === 1, `and which reports glyphs===1, got ${c.glyphs}`);
    assert(near(c.advance, r.width), 'the single cluster advance is the whole run width');

    // The contrast case: the SAME string in Arial does not ligate, so the
    // assertion is about the shaper honouring the font, not always fusing.
    const arial = shape('ffi', { family: 'Arial', size: 48 });
    assert(arial.glyphCount === 3,
        'the same string in Arial stays 3 glyphs — the ligature came from the font, got ' + arial.glyphCount);
    assert(arial.clusters.length === 3, 'and 3 clusters in Arial');

    const rows = ligatureReport(LIGATURE_FAMILY);
    const office = rows.find((x) => x.text === 'office');
    assert(office.glyphs < office.bytes,
        `"office" in ${LIGATURE_FAMILY}: ${office.glyphs} glyphs from ${office.bytes} bytes`);
    assert(office.fused >= 1, 'at least one multi-byte single-glyph cluster in "office"');
    assert(rows.filter((x) => x.ligated).length >= 3,
        'at least 3 of the 6 ligature samples actually ligated, got ' + rows.filter((x) => x.ligated).length);
});

test('shaping: kerning is strictly less than the sum of the parts', () => {
    for (const family of ['Arial', LIGATURE_FAMILY, 'Times New Roman']) {
        if (!shapeState.families.find((f) => f.family === family && f.present)) continue;
        const av = widthOf('AV', { family, size: 64 });
        const a = widthOf('A', { family, size: 64 });
        const v = widthOf('V', { family, size: 64 });
        assert(av < a + v, `${family}: width("AV") ${av} is strictly less than width("A")+width("V") ${a + v}`);
        // Not a rounding artefact — the pair kern is worth real pixels.
        assert((a + v) - av > 1, `${family}: and by more than a pixel (${((a + v) - av).toFixed(3)}px at 64px)`);
    }
    // A font with an empty kern table would give zero everywhere.
    const rows = kerningReport('Times New Roman');
    const kerned = rows.filter((r) => r.kerned);
    assert(kerned.length >= 4,
        `at least 4 of ${KERN_PAIRS.length} probe pairs kern in Times New Roman, got ${kerned.length}`);
    assert(rows.filter((r) => r.tightened).length >= 4,
        'and at least 4 of them kern TIGHTER (negative delta), which is what these shapes should do');
});

test('shaping: prefix measurement is wrong by construction', () => {
    const p = prefixReport('office', LIGATURE_FAMILY);
    assert(p.clusterSumMatches,
        'the cluster advances re-sum to the run width exactly — if they did not, ' +
        'carets would not land where glyphs are drawn');
    assert(Math.abs(p.error) > 0.5,
        `per-character measurement of "office" is off by ${p.error.toFixed(3)}px — ` +
        'shaping and summing disagree, as shaped_run.h says they must');
    assert(p.naive > p.shaped, 'and it over-measures, because it misses both the kerns and the ligature');
});

test('shaping: letter-spacing suppresses ligatures and lands between clusters', () => {
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

    // Each spaced cluster's x exceeds the previous right edge by exactly the amount.
    const r = shape('ffi', { family: LIGATURE_FAMILY, size: 48, letterSpacing: 2 });
    for (let i = 1; i < r.clusters.length; i++) {
        const prev = r.clusters[i - 1];
        const gap = r.clusters[i].x - (prev.x + prev.advance);
        assert(near(gap, 2, 0.01), `gap before cluster ${i} is exactly the 2px letter-spacing, got ${gap.toFixed(4)}`);
    }
});

test('shaping: style axes really re-shape', () => {
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
    // Italic only where the italic face genuinely has different advances:
    // Arial and Times New Roman ship italics metrically identical to their
    // romans, so asserting against them would pass an engine ignoring the flag.
    for (const family of ITALIC_DIVERGENT) {
        if (!shapeState.families.find((f) => f.family === family && f.present)) continue;
        const r = rows.find((x) => x.family === family);
        assert(r.italicDiffers,
            `${family}: the italic face has different advances (${r.italic} vs ${r.regular}) — ` +
            'italic is a shaping input, not a skew transform');
    }
});

test('shaping: subpixel advances', () => {
    const s = subpixelReport('Arial');
    assert(s.fractional > 0,
        `${s.fractional} of ${s.clusters} cluster advances have a fractional part at ${s.size}px — ` +
        'advances are not rounded to whole pixels');
    assert(s.driftMatters,
        'rounding every advance to an integer would move the end of one line by ' +
        `${Math.abs(s.drift).toFixed(3)}px — that accumulation is why they are not rounded`);
});

test('shaping: shaped-run cache', () => {
    const c = cacheProbe();
    assert(c.coldMiss, 'shaping a never-seen string missed the cache');
    assert(c.warmHit, 'shaping the identical tuple again HIT and did not miss');
    assert(c.sizeMiss, 'changing only the size missed — size is part of the key');
    assert(c.spacingAmountHit,
        'changing only the letter-spacing AMOUNT (staying non-zero) still hit — ' +
        'spacing repositions output and is deliberately absent from the cache key ' +
        '(shaped_run.h: "spacing does not change which glyphs the shaper produces")');
});

test('shaping: the family tags on screen match the probe', () => {
    const tags = [...document.querySelectorAll('#shapeFamilies .famtag')];
    assert(tags.length === FAMILIES.length, `one tag per probed family, got ${tags.length}`);
    const okTags = tags.filter((t) => t.classList.contains('ok')).length;
    assert(okTags === shapeState.families.filter((f) => f.present).length,
        'green tags are exactly the families that resolved to a real face');
});

// =============================================================================
// 2. BIDI / RTL
// =============================================================================

test('bidi: level resolution', () => {
    const a = analyze(MIXED, 'ltr');
    assert(a.paragraphLevel === 0, 'explicit ltr base gives paragraph level 0');
    assert(!a.uniform, 'a mixed paragraph is not uniform');
    assert(a.levelsPerCodePoint,
        `levels come back one per CODE POINT: ${a.levels.length} for ${a.codePoints} code points ` +
        '(not per byte — the Hebrew is 2 bytes each — and not per UTF-16 unit)');
    assert(eq(a.levels, [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]),
        'resolved levels for "abc אבג def" are [0,0,0,0,1,1,1,0,0,0,0], got [' + a.levels + ']');
    assert(a.runs.length === 3, 'which is 3 level runs, got ' + a.runs.length);
    assert(a.runs[1].rtl && a.runs[1].level === 1, 'the middle run is RTL at level 1');
    assert(a.runs[1].byteStart === 4 && a.runs[1].byteEnd === 10,
        `the RTL run spans BYTES 4–10 (3 letters × 2 bytes), got ${a.runs[1].byteStart}–${a.runs[1].byteEnd}`);
    assert(a.runs[1].text === 'אבג', 'and slicing those bytes back gives the Hebrew, got ' + a.runs[1].text);
    assert(a.runsTile, 'runs tile the byte range contiguously with no gaps or overlaps');
});

test('bidi: P2/P3 auto-detection', () => {
    const a = analyze(MIXED_RTL_FIRST, 'auto');
    assert(a.paragraphLevel === 1 && a.rtlParagraph,
        'a paragraph starting with a strong RTL character auto-resolves to RTL (P2/P3), got level ' +
        a.paragraphLevel);
    assert(a.levels.some((l) => l === 2),
        'and the embedded Latin run sits at level 2 — LTR inside RTL, not back at 0. levels [' + a.levels + ']');
    assert(a.runsTile, 'runs tile');
    const ltr = analyze('plain english text', 'auto');
    assert(ltr.paragraphLevel === 0 && ltr.uniform, 'pure Latin auto-resolves to a uniform LTR paragraph');
    assert(ltr.runs.length === 1, 'in exactly one run');
});

// W-rules: European digits adjacent to Arabic resolve to an even (LTR) level
// INSIDE the right-to-left run, so the number reads left to right.
test('bidi: W-rules for digits in Arabic', () => {
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
        'left-to-right while the text around them reads right-to-left. levels [' + digitLevels + ']');
    assert(digitLevels.every((l) => l >= 2),
        'and to a level deeper than the paragraph (embedded, not reset to 0), got [' + digitLevels + ']');
});

test('bidi: rule L2 reordering as an exact permutation', () => {
    const perm = reorderFor(MIXED, 'ltr');
    assert(eq(perm, [0, 1, 2, 3, 6, 5, 4, 7, 8, 9, 10]),
        'bidiReorder over the resolved levels gives the exact expected permutation ' +
        '[0 1 2 3 6 5 4 7 8 9 10] — the three Hebrew positions reversed and nothing else. Got [' + perm + ']');
    const id = bro.text.bidiReorder(bro.text.bidi('plain text', 'ltr').levels);
    assert(id.every((v, k) => v === k), 'an all-level-0 line reorders to the identity');
    const rev = bro.text.bidiReorder([1, 1, 1, 1]);
    assert(eq(rev, [3, 2, 1, 0]), 'an all-level-1 line fully reverses, got [' + rev + ']');
    const nested = bro.text.bidiReorder([0, 1, 2, 1, 0]);
    assert(eq(nested, [0, 3, 2, 1, 4]),
        'levels [0,1,2,1,0] reorder to [0,3,2,1,4] — the level-2 run stays put inside ' +
        'the reversed level-1 span. Got [' + nested + ']');
});

// The strongest bidi assertion: shape() applies L2 internally and emits its
// cluster map in visual order; it must equal the permutation computed from
// bro.text.bidi + bro.text.bidiReorder, so the three seams cannot disagree.
test('bidi: the shaper reordered exactly as rule L2 says', () => {
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
    const heb = p.got.slice(4, 7);
    assert(eq(heb, [6, 5, 4]),
        'the three Hebrew code points appear on screen in reverse logical order [6 5 4], got [' + heb + ']');
    assert(p.rtlFlags.slice(4, 7).every((f) => f === true), 'and the shaper flagged exactly those clusters rtl');
    assert(p.rtlFlags.filter((f) => f).length === 3,
        'exactly 3 rtl clusters in the run, got ' + p.rtlFlags.filter((f) => f).length);
});

test('bidi: caret geometry', () => {
    const s = caretSummary(MIXED);
    assert(s.hasRtlCaretMotion,
        `caret x DECREASES as the byte offset increases at ${s.decreasingSteps} step(s) — ` +
        'only an RTL run can do that, and it is the observable signature of bidi carets');
    assert(s.decreasingSteps === 2,
        'and at exactly 2 steps: the two interior boundaries of the 3-letter Hebrew run. Got ' + s.decreasingSteps);
    // Full identity is NOT asserted: in a bidi string two distinct logical
    // offsets share one x, so the inverse is genuinely one-to-many.
    const rt = hitTestRoundTrip(MIXED);
    assert(rt.every((r) => r.onBoundary), 'every caret x hit-tests back to a cluster boundary — never mid-cluster');
    const pure = hitTestRoundTrip('abcdef');
    assert(pure.every((r) => r.identity),
        'and in a pure-LTR string the round trip is the exact identity at every cluster');
});

test('bidi: unicode-bidi: bidi-override (rule X6)', () => {
    const o = overrideReport(MIXED);
    assert(!o.normalUniform && o.normalRuns === 3, 'without override the paragraph has 3 runs');
    assert(o.overLtrUniform && o.ltrAllZero,
        'unicode-bidi:bidi-override with direction:ltr forces EVERY character to level 0 — ' +
        'one uniform run. levels [' + o.overLtrLevels + ']');
    assert(o.overRtlUniform && o.rtlAllOne,
        'and with direction:rtl to level 1 throughout. levels [' + o.overRtlLevels + ']');
});

// Independent seam: Range.getBoundingClientRect over sub-spans of a live text node.
test('bidi: the same reordering, through layout', () => {
    const d = domReorderProbe();
    assert(d, 'the DOM bidi probe element is in the tree');
    assert(d.wholeMatchesShaped,
        `layout laid the whole line out at ${d.whole.width.toFixed(4)}px and the shaper ` +
        `independently says ${d.shapedWidth.toFixed(4)}px — one string, two engines, one number`);
    assert(d.latin1Matches && d.latin2Matches,
        'the two Latin runs land exactly on the shaper\'s clusters: ' +
        `abc[${d.latin1.left.toFixed(2)}–${d.latin1.right.toFixed(2)}] ` +
        `def[${d.latin2.left.toFixed(2)}–${d.latin2.right.toFixed(2)}]`);
    assert(d.runsInOrder, 'and the three runs occupy left-to-right bands in logical run order');
    assert(d.alefRightOfBet,
        `א (logically first) is at x ${d.alef.left.toFixed(2)} and ב (logically second) at ` +
        `${d.bet.left.toFixed(2)} — the FIRST letter is drawn to the RIGHT of the second. ` +
        'Layout is showing the reordering, not merely placing the run');
    assert(d.alefMatches && d.betMatches,
        'and each per-character Range rect matches the shaper\'s cluster box exactly: ' +
        `א [${d.alef.left.toFixed(2)}–${d.alef.right.toFixed(2)}], ` +
        `ב [${d.bet.left.toFixed(2)}–${d.bet.right.toFixed(2)}]`);
    assert(d.hebrewReversed,
        'and the shaper\'s cluster byte-starts DESCEND as x ascends [' + d.hebClusterStarts + ']');
});

// The two cases that separate "a range's extent is the sum of the advances it
// covers" from "the distance between two caret positions".
test('bidi: Range geometry inside an RTL run', () => {
    const b = rtlRangeProbe();
    assert(b, 'the RTL Range-geometry probe ran');
    const s = caretSummary(MIXED);
    assert(s.unreachable.length === 0,
        'every cluster edge in "' + MIXED + '" is reachable from some byte offset. ' +
        'unreachable: [' + s.unreachable.map((x) => x.toFixed(2)) + ']');
    assert(b.trailingEdgeReachable,
        'including the RTL run\'s left edge x=' + b.rtlTrailingEdge.toFixed(2) +
        ', carets 4–10: [' + b.carets.map((c) => c.x.toFixed(2)) + ']');
    assert(b.lastCharRectMatches,
        'a Range over the last logical Hebrew letter is that letter\'s box: expected [' +
        b.gimelExpected.left.toFixed(2) + '–' + b.gimelExpected.right.toFixed(2) +
        '], got [' + b.gimelActual.left.toFixed(2) + '–' + b.gimelActual.right.toFixed(2) + ']');
    assert(b.wholeRunMatches,
        'a Range over the whole RTL run spans it: expected [' +
        b.wholeRunExpected.left.toFixed(2) + '–' + b.wholeRunExpected.right.toFixed(2) +
        '], got [' + b.wholeRtlRect.left.toFixed(2) + '–' + b.wholeRtlRect.right.toFixed(2) +
        '] (width ' + b.wholeRtlRect.width.toFixed(2) + ')');
});

done('text-lab smoke (surface, shaping, bidi)');
