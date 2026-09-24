// lab.js — Text Lab: boot, the panel index, and what the app claims about the engine.
//
// Seven panels, each a module with a pure report half and a panel half:
//
//   shaping.js   HarfBuzz: ligatures, kerning, spacing, style axes, the cache
//   bidi.js      UAX #9: levels, rule L2 and the shaper checked against each
//                other, then against layout through Range rects
//   scripts.js   Arabic, Hebrew, Devanagari, Thai, Han, Hangul + font coverage
//   clusters.js  the cluster map drawn over fillText, astral text, caret stops
//   metrics.js   canvas measureText: all twelve TextMetrics members
//   selection.js Range / Selection offsets are UTF-16 over UTF-8 storage
//   editing.js   contenteditable driven through the real input path
//                (+ input.js, editing-panel.js)
//
// The first five only READ text; selection and editing mutate it, so they
// initialise last, after every read-only panel measured an undisturbed DOM.
// The UTF-16 ↔ UTF-8 boundary and the cluster map are lib/kit/text.js.
//
// Anything a test measures (Range rects, getBoundingClientRect) has a pinned
// font and no transition, transform or animation on it.

import { boot } from '/lib/kit/app.js';
import { h, $ } from '/lib/kit/dom.js';
import { stats as statsView, frameLoop } from '/lib/kit/ui.js';
import { initShaping, refreshShaping, shapeState, shape } from '/app/shaping.js';
import { initBidi, refreshBidi, bidiState } from '/app/bidi.js';
import { initScripts, refreshScripts, scriptState } from '/app/scripts.js';
import { initClusters, refreshAstral, selectSample, clusterState, CLUSTER_SAMPLES } from '/app/clusters.js';
import { initMetrics, refreshMetrics, metricsState } from '/app/metrics.js';
import { initSelection, refreshSelection, selectionState } from '/app/selection.js';
import { initEditing, refreshEditing, editState } from '/app/editing-panel.js';
import { CAN_DRIVE } from '/app/input.js';

export const PANELS = [
    { id: 'shaping', section: 'panelShaping', title: 'HarfBuzz shaping' },
    { id: 'bidi', section: 'panelBidi', title: 'Bidi — UAX #9' },
    { id: 'scripts', section: 'panelScripts', title: 'Complex scripts' },
    { id: 'clusters', section: 'panelClusters', title: 'Cluster map' },
    { id: 'metrics', section: 'panelMetrics', title: 'TextMetrics' },
    { id: 'selection', section: 'panelSelection', title: 'Selection & Range' },
    { id: 'editing', section: 'panelEditing', title: 'Editing' },
];

export const stats = { frames: 0 };

let app = null, nav = null, readouts = null;

/** Boot once: every panel, the index, the frame counter. */
export function start() {
    if (app) return;
    app = boot({ menu: { view: [{ id: 'view.rerun', label: 'Re-run All Panels' }],
                         handlers: { 'view.rerun': rerun } } });
    app.status.busy('measuring…');
    $('#rerun').addEventListener('click', rerun);
    tag('#bidiAvailable', bro.text.bidiAvailable === true,
        bro.text.bidiAvailable === true ? 'bidi resolver compiled in' : 'BIDI UNAVAILABLE — every string is one LTR run');
    tag('#injectAvailable', CAN_DRIVE, CAN_DRIVE ? 'input injection: available' : 'input injection: headless only');

    initShaping();
    initBidi();
    initScripts();
    initClusters();
    initMetrics();
    initSelection();
    initEditing();
    // The probes scrolled their stages into view to measure them; start the reader at the top.
    $('#main').scrollTop = 0;

    buildNav();
    readouts = statsView('#stats', { frames: 'frames', hits: 'shape cache hits', misses: 'misses' });
    showVerdicts();
    // Nothing here is time-varying; the loop exists so the frame counter
    // proves the app is alive. A text-node write every 30 frames, no relayout.
    frameLoop(() => {
        stats.frames++;
        if (stats.frames % 30 === 0) readouts.set('frames', stats.frames);
    });
}

function tag(sel, ok, text) {
    const el = $(sel);
    el.textContent = text;
    el.className = 'k-chip ' + (ok ? 'ok' : 'err');
}

/** Re-run every panel. The verdicts must not change: panels are pure functions of the engine. */
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

function rerun() {
    app.status.busy('re-running…');
    const main = $('#main'), at = main.scrollTop;
    refreshAll();
    main.scrollTop = at;
    showVerdicts();
}

// --- the panel index ---------------------------------------------------------------

function buildNav() {
    const main = $('#main');
    nav = PANELS.map((p) => {
        const mark = h('span.mark');
        const btn = h('button.nav', {
            dataset: { panel: p.id },
            onclick: () => {
                const sec = document.getElementById(p.section);
                main.scrollTop += sec.getBoundingClientRect().top - main.getBoundingClientRect().top - 10;
            },
        }, h('span', null, p.title), mark);
        $('#nav').appendChild(btn);
        return { panel: p, mark };
    });
}

function showVerdicts() {
    const v = panelVerdicts();
    let green = 0;
    for (const n of nav) {
        const ok = v[n.panel.id];
        const na = !ok && n.panel.id === 'editing' && !CAN_DRIVE;
        if (ok) green++;
        n.mark.textContent = ok ? 'ok' : na ? 'headless only' : 'FAIL';
        n.mark.className = 'mark ' + (ok ? 'ok' : na ? 'dim' : 'err');
    }
    readouts.set({ hits: shapeState.cache.hits, misses: shapeState.cache.misses });
    const msg = `${green}/${nav.length} panels green`;
    if (green === nav.length) app.status.ok(msg); else app.status.warn(msg);
}

// --- what the app claims -------------------------------------------------------------

/**
 * One boolean per panel: did every verdict in it come out green? Computed
 * from the same state objects the tests assert on, so the on-screen summary
 * can be checked against the tests' independent conclusions.
 */
export function panelVerdicts() {
    const s = shapeState, b = bidiState, sc = scriptState, c = clusterState;
    const m = metricsState, sl = selectionState, e = editState;
    // A null report has not run: for editing, the windowed case.
    const allRows = (...reports) => reports.every((r) => r !== null && r.rows.every((x) => x.ok));
    return {
        shaping:
            s.ligatures.some((r) => r.ligated) && s.kerning.some((r) => r.tightened) &&
            s.spacing.suppressed && s.spacing.gapExact && s.spacing.wsExact &&
            s.prefix.clusterSumMatches &&
            s.cacheProbe.coldMiss && s.cacheProbe.warmHit && s.cacheProbe.sizeMiss,
        bidi:
            b.available && b.permutation.matches && b.permutation.monotonicX &&
            b.samples.every((a) => a.levelsPerCodePoint && a.runsTile) &&
            b.overrides.ltrAllZero && b.overrides.rtlAllOne &&
            b.dom !== null && b.dom.wholeMatchesShaped && b.dom.latin1Matches && b.dom.latin2Matches &&
            b.dom.alefRightOfBet && b.dom.alefMatches && b.dom.betMatches && b.dom.hebrewReversed &&
            b.rtlRange !== null && b.rtlRange.lastCharRectMatches && b.rtlRange.wholeRunMatches &&
            b.rtlRange.trailingEdgeReachable,
        scripts:
            sc.ligature.oneGlyph && sc.ligature.narrower &&
            sc.joining.initialDiffers && sc.joining.joinedNarrower &&
            sc.devanagari.ki.multiGlyphCluster && sc.devanagari.ksha.oneGlyph &&
            sc.thai.sameWidth && sc.thai.hasZeroAdvance &&
            sc.normalization.sameWidth && sc.normalization.nfdClusterSpansAll,
        clusters:
            c.map.tiles && c.map.monotonic &&
            c.stepping.symmetric && c.stepping.allOnCodePointBoundaries && c.stepping.noSplitSurrogates &&
            c.alignment.every((a) => a.identical),
        metrics:
            m.surface.complete && m.surface.extra.length === 0 &&
            m.rows.every((r) => r.widthMatchesShape && r.inkPositive && r.fontBoxNonZero && r.ideographicIsDescent) &&
            m.ink.xBelowCaps && m.ink.flatNoDescent && m.ink.xOnlyOvershoot && m.ink.descHasDescent &&
            m.ink.fontBoxStable &&
            m.align.widthStable && m.align.centerShift &&
            m.baseline.rigid && m.baseline.alphaIsZero &&
            m.scaling.allScale &&
            m.domAgreement.every((d) => d.agrees) &&
            m.wordSplit !== null && m.wordSplit.every((w) => w.matchesWholeShaped),
        selection:
            sl.roundTrip !== null && sl.roundTrip.ok && sl.surrogate !== null && sl.surrogate.ok &&
            allRows(sl.containers, sl.api, sl.geometry, sl.editable),
        editing:
            e.available &&
            e.stepping !== null && e.stepping.every((r) => r.symmetric && r.matchesShaper && r.monotonic &&
                r.onCodePointBoundaries && r.noSplitSurrogates && r.reachedEnd && r.reachedStart) &&
            e.boundary !== null && e.boundary.every((x) => x.ok) &&
            e.emptyHost !== null && e.emptyHost.every((r) => r.ok) &&
            e.rtl !== null && e.rtl.every((r) => r.symmetric && r.matchesShaper && r.rightIncreases &&
                r.reachedEnd && r.rtlStopCount === r.wantRtlStopCount && r.backspaceOk && r.typeOk && r.wellFormed) &&
            e.caretGeometry !== null && e.caretGeometry.ok,
    };
}

/**
 * What the text surface does NOT expose, as data. Absent APIs, not wrong
 * answers; each entry is computed live, so one that gains an API flips to
 * `stillPresent: false` instead of going stale.
 */
export function knownLimitations() {
    const astral = clusterState.astral;
    return [
        {
            id: 'no-glyph-ids',
            what: 'bro.text.shape() reports a glyph COUNT but no glyph ids, so "the shaper picked a different ' +
                  'glyph" is only observable when the two glyphs happen to have different advances.',
            stillPresent: !('glyphIds' in shape('a', { family: 'Arial', size: 16 })),
            evidence: 'Arabic joining forms in Arial collapse to ' + scriptState.joining.distinctForms +
                      ' distinct advances across 4 forms.',
        },
        {
            id: 'cluster-not-grapheme',
            what: 'Caret stepping is by CLUSTER, not by grapheme — no UAX #29 data in this build ' +
                  '(shaped_run.h). Sequences the font does not fuse become several caret stops.',
            stillPresent: astral.some((a) => a.expectFused && !a.fused),
            evidence: astral.filter((a) => a.expectFused && !a.fused)
                .map((a) => `${a.label}: ${a.clusters} stops`).join('; ') || 'none on this machine',
        },
        {
            id: 'no-font-enumeration',
            what: 'No API lists installed font families, so coverage must be inferred by measuring.',
            stillPresent: typeof document.fonts === 'undefined',
            evidence: 'document.fonts is ' + typeof document.fonts + ', FontFace is ' + typeof FontFace + '.',
        },
        {
            id: 'no-caret-from-point',
            what: 'document.caretPositionFromPoint / caretRangeFromPoint are absent, so hit-testing a point to ' +
                  'a text offset has no DOM-level API; bro.text.xToByteOffset works on one shaped run only.',
            stillPresent: typeof document.caretPositionFromPoint === 'undefined' &&
                          typeof document.caretRangeFromPoint === 'undefined',
            evidence: 'both are undefined on document.',
        },
    ];
}
