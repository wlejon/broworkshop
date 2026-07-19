// Text Lab — the text stack bro built and nothing in the workshop exercised.
//
// Before this app there was, across the whole of broworkshop, zero RTL text,
// zero complex script, and not one call to measureText. So the engine's
// HarfBuzz integration, its UAX #9 bidi resolver, its cluster map and its
// TextMetrics implementation were all load-bearing and all unverified by any
// app. This lab depends on every one of them, hard.
//
// The five modules, and what each is really for:
//
//   shaping.js   HarfBuzz itself. Ligatures, kerning, spacing, style axes,
//                the shaped-run cache. Built around one idea: shaping is only
//                interesting where it DISAGREES with per-character
//                measurement, so every check is a comparison between the two
//                rather than a check that shaping returned something.
//   bidi.js      UAX #9. Level resolution, rule L2, and the shaper's own
//                reordering — checked against each other, then against the
//                live layout through Range.getBoundingClientRect(). Three
//                independent seams that must produce one answer.
//   scripts.js   Arabic, Hebrew, Devanagari, Thai, Han, Hangul, with real
//                strings. Also the font-coverage probe: a script with no face
//                on this machine is a FINDING and is reported as one, never
//                skipped.
//   clusters.js  The byte→cluster→glyph map, drawn on top of the glyphs it
//                describes, plus astral text and caret stepping. Owns
//                stepForward/stepBackward — the caret-motion primitives the
//                editing half of this lab will want.
//   metrics.js   canvas measureText and all twelve TextMetrics members,
//                checked for mutual consistency rather than for values.
//
// House rules, inherited from input-lab / platform-lab and worth restating
// because this app breaks them more expensively than most would:
//
//   - Panels never rebuild innerHTML per frame. Here that is not just a
//     relayout, it is a RESHAPE of every string in the subtree — the exact
//     cost the shaping cache exists to avoid. Rows are built once; only
//     textContent changes afterwards.
//   - Every driver the UI uses is an exported named function, so the smoke
//     test drives the app through the same entry points a click does rather
//     than reaching past it into the engine.
//   - Anything a test measures (Range rects, getBoundingClientRect) has a
//     pinned font and no transition, transform or animation on it.
//
// TWO HALVES. The first five panels only READ text — they shape, measure and
// compare, and never change a character. selection.js and editing.js are the
// other half, where the engine has to keep UTF-8 bytes, UTF-16 code units and
// cluster edges in agreement while text is being mutated. They are sibling
// modules on the same terms as the rest: no module imports another except
// through the two genuinely shared seams, textutil.js (the UTF-16↔UTF-8
// boundary) and shaping.js's shape() wrapper.

import { installSystemMenu } from '/lib/system-menu.js';

import {
    initShaping, refreshShaping, shapeState, shape, widthOf,
    ligatureReport, kerningReport, prefixReport, spacingReport, styleReport,
    subpixelReport, cacheProbe,
    FAMILIES, LIGATURE_FAMILY, LIGATURE_SAMPLES, KERN_PAIRS, ITALIC_DIVERGENT,
} from '/app/shaping.js';

import {
    initBidi, refreshBidi, bidiState,
    analyze, reorderFor, visualOrderOf, permutationCheck,
    caretWalk, caretSummary, hitTestRoundTrip, overrideReport, domReorderProbe,
    rtlRangeProbe,
    MIXED, MIXED_RTL_FIRST, ARABIC_NUMBERS, SAMPLES as BIDI_SAMPLES,
} from '/app/bidi.js';

import {
    initScripts, refreshScripts, scriptState,
    coverageOf, joiningReport, lamAlefReport, devanagariReport, thaiReport,
    normalizationReport, SCRIPT_SAMPLES, TATWEEL,
} from '/app/scripts.js';

import {
    initClusters, refreshAstral, selectSample, clusterState,
    clusterMap, offsetProbe, astralReport, steppingReport, alignmentCheck,
    stepForward, stepBackward, caretStops, drawClusterMap,
    CLUSTER_SAMPLES, ASTRAL_SAMPLES,
} from '/app/clusters.js';

import {
    initMetrics, refreshMetrics, metricsState,
    measure, surfaceReport, consistencyRow, inkSensitivityReport,
    alignReport, baselineReport, scalingReport, domAgreementReport, wordSplitProbe,
    drawMetrics, METRIC_KEYS, METRIC_SAMPLES, INK_KEYS,
} from '/app/metrics.js';

import {
    initSelection, refreshSelection, selectionState,
    roundTripReport, surrogateSplitReport, containerReport, selectionApiReport,
    geometryReport, editableSelectionReport, BOUNDARIES, S as SEL_FIXTURE,
} from '/app/selection.js';

import {
    initEditing, refreshEditing, editState,
    steppingReportAll, boundaryReport, emptyHostReport, rtlReportAll,
    caretGeometryReport, arrowSteppingReport, typeText, press, clickInto,
    selectionSnapshot, freshHost, freshPlain, caretAt,
    CAN_DRIVE, K, MOD, STEP_SAMPLES, BOUNDARY_CASES, RTL_SAMPLES,
} from '/app/editing.js';

installSystemMenu();

export const stats = { frames: 0 };

// ── Boot ────────────────────────────────────────────────────────────────────
//
// Order matters exactly twice, and both times for the same reason: two panels
// read the LIVE LAYOUT and so must be initialised after their probe elements
// have been styled and laid out.
//
//   bidi.js    takes Range rects over #bidiDomProbe
//   metrics.js measures the spans in #metricsDomProbe
//
// Both are in the static HTML, so a single layout pass before init is enough —
// but initShaping() runs first regardless because everything else imports its
// shape() wrapper, and a failure there should surface before anything has
// touched the DOM.

initShaping();
initBidi();
initScripts();
initClusters();
initMetrics();
// Last, and in this order: selection.js and editing.js both build fixtures in
// their own stage and drive the real input path, so they must not run until
// every read-only panel has taken its measurements off an undisturbed DOM.
initSelection();
initEditing();

// ── Frame loop ──────────────────────────────────────────────────────────────
//
// There is deliberately almost nothing here. Nothing in this lab is
// time-varying: shaping a string twice gives the same run, and re-measuring a
// static specimen every frame would only burn cache misses and prove nothing.
// The loop exists so the test can assert the app is still alive, and so the
// cluster canvas is repainted after a window resize changes nothing about the
// text but does change the canvas backing store.

const framesTag = document.getElementById('statFrames');

function frame() {
    stats.frames++;
    // Cheap, and only every 30 frames: the frame counter is the one thing on
    // screen that changes, and it is a text node write, not a relayout.
    if (stats.frames % 30 === 0) {
        framesTag.textContent = stats.frames + ' frames';
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Whole-app drivers ───────────────────────────────────────────────────────

/**
 * Re-run every panel. Exported so the test can prove the panels are idempotent
 * — running them twice must not change any verdict, which catches a panel that
 * accumulates state into its own report.
 */
export function refreshAll() {
    refreshShaping();
    refreshBidi();
    refreshScripts();
    selectSample(CLUSTER_SAMPLES.indexOf(clusterState.current));
    refreshAstral();
    refreshMetrics();
    refreshSelection();
    refreshEditing();
}

/**
 * One boolean per panel: did every verdict in it come out green?
 *
 * This is what the app itself claims about the engine, computed from the same
 * state objects the test asserts on. Exported so the test can check that the
 * app's OWN summary agrees with the test's independent conclusions — if the
 * panel says green while the test says red, the panel is lying to a human
 * reader and that is its own bug.
 */
export function panelVerdicts() {
    const s = shapeState;
    const b = bidiState;
    const sc = scriptState;
    const c = clusterState;
    const m = metricsState;
    const sl = selectionState;
    const e = editState;
    // Every row-based report is a list of {ok} checks; a panel is green when
    // every row in every one of its reports is. A report that is null has not
    // run — for the editing panel that is the windowed case, where the
    // injection globals do not exist and the panel says so rather than
    // claiming a pass it did not earn.
    const allRows = (...reports) =>
        reports.every((r) => r !== null && r.rows.every((x) => x.ok));
    return {
        shaping:
            s.ligatures.some((r) => r.ligated) &&
            s.kerning.some((r) => r.tightened) &&
            s.spacing.suppressed && s.spacing.gapExact && s.spacing.wsExact &&
            s.prefix.clusterSumMatches &&
            s.cacheProbe.coldMiss && s.cacheProbe.warmHit && s.cacheProbe.sizeMiss,
        bidi:
            b.available &&
            b.permutation.matches && b.permutation.monotonicX &&
            b.samples.every((a) => a.levelsPerCodePoint && a.runsTile) &&
            b.overrides.ltrAllZero && b.overrides.rtlAllOne &&
            b.dom !== null && b.dom.wholeMatchesShaped && b.dom.latin1Matches &&
            b.dom.latin2Matches && b.dom.alefRightOfBet && b.dom.alefMatches &&
            b.dom.betMatches && b.dom.hebrewReversed &&
            b.rtlRange !== null && b.rtlRange.lastCharRectMatches &&
            b.rtlRange.wholeRunMatches && b.rtlRange.trailingEdgeReachable,
        scripts:
            sc.ligature.oneGlyph && sc.ligature.narrower &&
            sc.joining.initialDiffers && sc.joining.joinedNarrower &&
            sc.devanagari.ki.multiGlyphCluster && sc.devanagari.ksha.oneGlyph &&
            sc.thai.sameWidth && sc.thai.hasZeroAdvance &&
            sc.normalization.sameWidth && sc.normalization.nfdClusterSpansAll,
        clusters:
            c.map.tiles && c.map.monotonic &&
            c.stepping.symmetric && c.stepping.allOnCodePointBoundaries &&
            c.stepping.noSplitSurrogates &&
            c.alignment.every((a) => a.identical),
        metrics:
            m.surface.complete && m.surface.extra.length === 0 &&
            m.rows.every((r) => r.widthMatchesShape && r.inkPositive &&
                                r.fontBoxNonZero && r.ideographicIsDescent) &&
            m.ink.xBelowCaps && m.ink.fontBoxStable &&
            m.align.widthStable && m.align.centerShift &&
            m.baseline.rigid && m.baseline.alphaIsZero &&
            m.scaling.allScale &&
            m.domAgreement.every((d) => d.agrees) &&
            m.wordSplit !== null && m.wordSplit.every((w) => w.matchesWholeShaped),
        selection:
            sl.roundTrip !== null && sl.roundTrip.ok &&
            sl.surrogate !== null && sl.surrogate.ok &&
            allRows(sl.containers, sl.api, sl.geometry, sl.editable),
        editing:
            e.available &&
            e.stepping !== null && e.stepping.every((r) =>
                r.symmetric && r.matchesShaper && r.monotonic &&
                r.onCodePointBoundaries && r.noSplitSurrogates &&
                r.reachedEnd && r.reachedStart) &&
            e.boundary !== null && e.boundary.every((b) => b.ok) &&
            e.emptyHost !== null && e.emptyHost.every((r) => r.ok) &&
            e.rtl !== null && e.rtl.every((r) =>
                r.symmetric && r.matchesShaper && r.rightIncreases && r.reachedEnd &&
                r.rtlStopCount === r.wantRtlStopCount &&
                r.backspaceOk && r.typeOk && r.wellFormed) &&
            e.caretGeometry !== null && e.caretGeometry.ok,
    };
}

/**
 * What the text surface does NOT expose, as data rather than as prose.
 *
 * These are absent APIs rather than wrong answers — every behaviour this lab
 * measures is checked against the shaper or against canvas and has to agree.
 * Each entry is still computed live, so an entry that gains an API flips to
 * `false` on the next run rather than silently going stale.
 */
export function knownLimitations() {
    const astral = clusterState.astral;
    return [
        {
            id: 'no-glyph-ids',
            what: 'bro.text.shape() reports a glyph COUNT but no glyph ids, so ' +
                  '"the shaper picked a different glyph" is only observable when ' +
                  'the two glyphs happen to have different advances.',
            stillPresent: !('glyphIds' in shape('a', { family: 'Arial', size: 16 })),
            evidence: 'Arabic joining forms in Arial collapse to ' +
                      scriptState.joining.distinctForms + ' distinct advances across 4 forms.',
        },
        {
            id: 'cluster-not-grapheme',
            what: 'Caret stepping is by CLUSTER, not by grapheme — this build has ' +
                  'no UAX #29 data (stated in shaped_run.h). Sequences the font ' +
                  'does not fuse become several caret stops.',
            stillPresent: astral.some((a) => a.expectFused && !a.fused),
            evidence: astral.filter((a) => a.expectFused && !a.fused)
                .map((a) => `${a.label}: ${a.clusters} stops`).join('; ') || 'none on this machine',
        },
        {
            id: 'no-font-enumeration',
            what: 'No API lists installed font families, so coverage must be ' +
                  'inferred by measuring a probe string.',
            stillPresent: typeof document.fonts === 'undefined',
            evidence: 'document.fonts is ' + typeof document.fonts +
                      ', FontFace is ' + typeof FontFace + ' (no CSS Font Loading API).',
        },
        {
            id: 'no-caret-from-point',
            what: 'document.caretPositionFromPoint / caretRangeFromPoint are absent, ' +
                  'so hit-testing a click to a text offset has no DOM-level API — ' +
                  'bro.text.xToByteOffset is the only route, and it works on a ' +
                  'single shaped run rather than on a laid-out document.',
            stillPresent: typeof document.caretPositionFromPoint === 'undefined' &&
                          typeof document.caretRangeFromPoint === 'undefined',
            evidence: 'both are undefined on document.',
        },
    ];
}

// ── Re-exports for the smoke test ───────────────────────────────────────────
//
// The test imports everything from '/app/app.js' rather than from the modules
// directly, so the app's public surface is one file and a module rename never
// touches the test. The editing half appends its own block here.

export {
    // shaping
    shapeState, shape, widthOf, refreshShaping,
    ligatureReport, kerningReport, prefixReport, spacingReport, styleReport,
    subpixelReport, cacheProbe,
    FAMILIES, LIGATURE_FAMILY, LIGATURE_SAMPLES, KERN_PAIRS, ITALIC_DIVERGENT,
    // bidi
    bidiState, refreshBidi,
    analyze, reorderFor, visualOrderOf, permutationCheck,
    caretWalk, caretSummary, hitTestRoundTrip, overrideReport, domReorderProbe,
    rtlRangeProbe,
    MIXED, MIXED_RTL_FIRST, ARABIC_NUMBERS, BIDI_SAMPLES,
    // scripts
    scriptState, refreshScripts,
    coverageOf, joiningReport, lamAlefReport, devanagariReport, thaiReport,
    normalizationReport, SCRIPT_SAMPLES, TATWEEL,
    // clusters
    clusterState, refreshAstral, selectSample,
    clusterMap, offsetProbe, astralReport, steppingReport, alignmentCheck,
    stepForward, stepBackward, caretStops, drawClusterMap,
    CLUSTER_SAMPLES, ASTRAL_SAMPLES,
    // metrics
    metricsState, refreshMetrics,
    measure, surfaceReport, consistencyRow, inkSensitivityReport,
    alignReport, baselineReport, scalingReport, domAgreementReport, wordSplitProbe,
    drawMetrics, METRIC_KEYS, METRIC_SAMPLES, INK_KEYS,
    // selection
    selectionState, refreshSelection,
    roundTripReport, surrogateSplitReport, containerReport, selectionApiReport,
    geometryReport, editableSelectionReport, BOUNDARIES, SEL_FIXTURE,
    // editing
    editState, refreshEditing,
    steppingReportAll, boundaryReport, emptyHostReport, rtlReportAll,
    caretGeometryReport, arrowSteppingReport, typeText, press, clickInto,
    selectionSnapshot, freshHost, freshPlain, caretAt,
    CAN_DRIVE, K, MOD, STEP_SAMPLES, BOUNDARY_CASES, RTL_SAMPLES,
};
