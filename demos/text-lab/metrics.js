// metrics.js — canvas 2D `measureText` and the whole TextMetrics surface.
//
// bro implements TextMetrics in CanvasScene::measureText (src/canvas/
// canvas_scene.cpp), exposed by js_measureText in src/js/canvas_bindings.cpp.
// Measured against the spec, all TWELVE members are present:
//
//   width
//   actualBoundingBoxLeft / Right / Ascent / Descent
//   fontBoundingBoxAscent / Descent
//   emHeightAscent / Descent
//   hangingBaseline / alphabeticBaseline / ideographicBaseline
//
// The interesting property is not that they exist but that they are MUTUALLY
// CONSISTENT and consistent with the rest of the engine, because they are all
// derived from the same two sources: the ShapedRun's ink bounds, and the
// face's SkFontMetrics. So this module checks relationships rather than
// values, which is the only kind of check that survives a different machine
// with different fonts:
//
//   width                        == the shaped run's width == Σ cluster advances
//   actualAscent + actualDescent  > 0 for any inked text, == 0 for a space
//   the two `actual` horizontals  shift by exactly width/2 when textAlign
//                                 changes left → center
//   alphabeticBaseline            == 0 with textBaseline 'alphabetic', and
//                                 == −emHeightAscent with 'top'
//   ideographicBaseline           == −fontBoundingBoxDescent
//   every metric scales linearly with font size
//
// A caveat the panel states outright: no face on this machine ships an OpenType
// BASE table, so hangingBaseline and ideographicBaseline are the conventional
// browser fallbacks (0.8 × ascent, and the descent) rather than table lookups.
// canvas_scene.cpp says so in a comment. The relationships above still hold.

import { el, n2, buildTable, verdict } from '/app/textutil.js';
import { shape } from '/app/shaping.js';

// The complete spec surface, in spec order. Used to assert nothing is missing
// AND that nothing extra has been invented.
export const METRIC_KEYS = [
    'width',
    'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
    'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
    'emHeightAscent', 'emHeightDescent',
    'hangingBaseline', 'alphabeticBaseline', 'ideographicBaseline',
];

export const METRIC_SAMPLES = [
    { id: 'mixed', text: 'Hamburgefonstiv', note: 'ascenders and descenders' },
    { id: 'xheight', text: 'aceomnrsuvwxz', note: 'x-height only — no ascender, no descender' },
    { id: 'caps', text: 'ABCDEFGH', note: 'caps — ascender box, no descender' },
    { id: 'desc', text: 'gjpqy', note: 'descenders only' },
    { id: 'space', text: ' ', note: 'advance but no ink' },
    { id: 'empty', text: '', note: 'no advance, but font metrics still valid' },
    { id: 'rtl', text: 'שלום', note: 'RTL — metrics are direction-agnostic' },
    { id: 'emoji', text: '😀', note: 'astral, colour glyph' },
];

export const metricsState = {
    surface: null,
    rows: [],
    align: null,
    baseline: null,
    scaling: null,
    domAgreement: null,
    wordSplit: null,
};

let ctx = null;

function withFont(font, fn) {
    const prev = ctx.font;
    ctx.font = font;
    const r = fn();
    ctx.font = prev;
    return r;
}

/** measureText as a plain object, so it can be diffed and stored. */
export function measure(text, font, align, baseline) {
    const prevA = ctx.textAlign;
    const prevB = ctx.textBaseline;
    if (align) ctx.textAlign = align;
    if (baseline) ctx.textBaseline = baseline;
    const m = withFont(font || ctx.font, () => ctx.measureText(text));
    const out = {};
    for (const k in m) out[k] = m[k];
    ctx.textAlign = prevA;
    ctx.textBaseline = prevB;
    return out;
}

// ── Surface completeness ────────────────────────────────────────────────────

/**
 * Which of the spec's TextMetrics members exist, and whether anything beyond
 * the spec appears. Enumerated from the object rather than probed key by key,
 * so an accidentally-omitted member shows up as missing rather than as
 * `undefined` quietly propagating into arithmetic.
 */
export function surfaceReport() {
    const m = measure('Hg', '48px Arial');
    const present = Object.keys(m);
    return {
        present,
        missing: METRIC_KEYS.filter((k) => present.indexOf(k) < 0),
        extra: present.filter((k) => METRIC_KEYS.indexOf(k) < 0),
        allNumbers: present.every((k) => typeof m[k] === 'number' && isFinite(m[k])),
        complete: METRIC_KEYS.every((k) => present.indexOf(k) >= 0),
        sample: m,
    };
}

// ── Per-sample consistency ──────────────────────────────────────────────────

/**
 * The self-consistency checks, per sample string.
 *
 *   `widthMatchesShape` — measureText's width is the ShapedRun's width. These
 *        are two readings of ONE shaping call, so the bar is exact equality,
 *        not a tolerance. Anything else means canvas has its own text path.
 *   `inkPositive`       — inked text has a positive ink box; a space has none.
 *        Note it is the SPACE that is the interesting row: `width` is 13.34px
 *        and every `actual*` is 0, which is exactly right and is the case a
 *        naive "bounding box == advance box" implementation gets wrong.
 *   `fontBoxCoversInk`  — the font's line box must contain the ink of any
 *        string set in it. If it does not, lines overlap.
 *   `ascentSensitive`   — actualBoundingBoxAscent depends on WHICH glyphs were
 *        asked for, not just the font. 'ace' and 'ABC' must differ.
 */
export function consistencyRow(text, font) {
    const m = measure(text, font);
    const inked = text.trim().length > 0;
    const size = parseFloat(font);
    const family = font.slice(font.indexOf(' ') + 1);
    const shaped = text.length ? shape(text, { family, size }) : null;

    return {
        text, font, m,
        shapedWidth: shaped ? shaped.width : 0,
        widthMatchesShape: Math.abs(m.width - (shaped ? shaped.width : 0)) < 1e-4,
        clusterSum: shaped ? shaped.clusters.reduce((a, c) => a + c.advance, 0) : 0,
        widthMatchesClusters: !shaped ||
            Math.abs(m.width - shaped.clusters.reduce((a, c) => a + c.advance, 0)) < 1e-3,
        inkHeight: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
        inkWidth: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
        inkPositive: inked ? (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) > 0
                           : (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) === 0,
        // The font box is a property of the FACE and is non-zero even for "".
        fontBoxNonZero: m.fontBoundingBoxAscent + m.fontBoundingBoxDescent > 0,
        fontBoxCoversInk: !inked ||
            (m.actualBoundingBoxAscent <= m.fontBoundingBoxAscent + 0.01 &&
             m.actualBoundingBoxDescent <= m.fontBoundingBoxDescent + 0.01),
        // Ink never exceeds the advance by more than the side bearings, and for
        // ordinary text is a little narrower.
        inkWithinReason: !inked || (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) <= m.width + size,
        // ideographicBaseline is defined as sitting at the descent below the
        // alphabetic baseline — canvas_scene.cpp derives it exactly that way.
        ideographicIsDescent: Math.abs(m.ideographicBaseline + m.fontBoundingBoxDescent) < 0.01,
        // With the default 'alphabetic' baseline the alphabetic baseline is
        // the alignment point itself, so it is 0 by definition.
        alphabeticZero: Math.abs(m.alphabeticBaseline) < 1e-6,
        // hanging is above the alphabetic baseline.
        hangingAbove: m.hangingBaseline > 0,
    };
}

/**
 * Ink ascent must respond to WHICH characters were measured, not merely to the
 * font. This is the check that separates a real ink box from one faked out of
 * the font metrics: 'ace' (x-height only) must have a smaller ascent than
 * 'ABC' (cap height), which must be no larger than 'bdfk' (ascender height);
 * and 'ace' must have no descent while 'gjpqy' has one.
 */
export function inkSensitivityReport(font) {
    const f = font || '64px Arial';
    const x = measure('acemn', f);
    const caps = measure('ABCH', f);
    const asc = measure('bdfkl', f);
    const desc = measure('gjpqy', f);
    return {
        font: f,
        xAscent: x.actualBoundingBoxAscent,
        capAscent: caps.actualBoundingBoxAscent,
        ascAscent: asc.actualBoundingBoxAscent,
        xDescent: x.actualBoundingBoxDescent,
        descDescent: desc.actualBoundingBoxDescent,
        xBelowCaps: x.actualBoundingBoxAscent < caps.actualBoundingBoxAscent,
        capsAtMostAscenders: caps.actualBoundingBoxAscent <= asc.actualBoundingBoxAscent + 0.01,
        // 'acemn' sits entirely on the baseline: no descent at all.
        xNoDescent: x.actualBoundingBoxDescent <= 0.01,
        descHasDescent: desc.actualBoundingBoxDescent > 0.5,
        // The font box does NOT move — it is the face's, not the string's.
        fontBoxStable: Math.abs(x.fontBoundingBoxAscent - desc.fontBoundingBoxAscent) < 1e-6,
    };
}

// ── textAlign / textBaseline move the alignment point ───────────────────────

/**
 * measureText is reported RELATIVE TO THE ALIGNMENT POINT, which textAlign and
 * textBaseline move. canvas_scene.cpp computes the reported box with the very
 * same adjustTextX/adjustTextY that fillText uses to place the glyphs, so the
 * reported box is by construction the box that would be drawn.
 *
 * The exact predictions:
 *   left → center : the alignment point moves right by width/2, so
 *                   actualBoundingBoxLeft GAINS width/2 and Right LOSES it.
 *   left → right  : it moves by the full width.
 *   width itself  : never changes. Alignment moves the origin, not the text.
 */
export function alignReport(text, font) {
    const t = text || 'Hamburg';
    const f = font || '48px Arial';
    const left = measure(t, f, 'left');
    const center = measure(t, f, 'center');
    const right = measure(t, f, 'right');
    const half = left.width / 2;
    return {
        text: t, font: f, left, center, right,
        widthStable: Math.abs(center.width - left.width) < 1e-6 &&
                     Math.abs(right.width - left.width) < 1e-6,
        centerShift: Math.abs((center.actualBoundingBoxLeft - left.actualBoundingBoxLeft) - half) < 0.01 &&
                     Math.abs((left.actualBoundingBoxRight - center.actualBoundingBoxRight) - half) < 0.01,
        rightShift: Math.abs((right.actualBoundingBoxLeft - left.actualBoundingBoxLeft) - left.width) < 0.01,
        // Ink width is invariant: it is the same glyphs either way.
        inkWidthStable:
            Math.abs((left.actualBoundingBoxLeft + left.actualBoundingBoxRight) -
                     (center.actualBoundingBoxLeft + center.actualBoundingBoxRight)) < 0.01,
        // Vertical metrics must be untouched by a HORIZONTAL alignment change.
        verticalUntouched:
            Math.abs(left.actualBoundingBoxAscent - center.actualBoundingBoxAscent) < 1e-6 &&
            Math.abs(left.alphabeticBaseline - center.alphabeticBaseline) < 1e-6,
    };
}

/**
 * textBaseline moves the alignment point VERTICALLY, and every vertical metric
 * must move with it by exactly the same amount.
 *
 * With 'top' the alignment point is the top of the em box, so the alphabetic
 * baseline is emHeightAscent BELOW it — i.e. alphabeticBaseline becomes
 * −emHeightAscent(alphabetic), and emHeightAscent itself becomes 0.
 */
export function baselineReport(text, font) {
    const t = text || 'Hamburg';
    const f = font || '48px Arial';
    const alpha = measure(t, f, 'left', 'alphabetic');
    const top = measure(t, f, 'left', 'top');
    const bottom = measure(t, f, 'left', 'bottom');
    const middle = measure(t, f, 'left', 'middle');
    const shift = -top.alphabeticBaseline;   // how far down the baseline moved
    return {
        text: t, font: f, alpha, top, bottom, middle,
        alphaIsZero: Math.abs(alpha.alphabeticBaseline) < 1e-6,
        // 'top' puts the alignment point at the top of the em box.
        topEmAscentZero: Math.abs(top.emHeightAscent) < 1e-4,
        topShiftIsEmAscent: Math.abs(shift - alpha.emHeightAscent) < 0.01,
        // Every vertical metric moved by the SAME shift — a rigid translation.
        rigid:
            Math.abs((alpha.actualBoundingBoxAscent - top.actualBoundingBoxAscent) - shift) < 0.01 &&
            Math.abs((top.actualBoundingBoxDescent - alpha.actualBoundingBoxDescent) - shift) < 0.01 &&
            Math.abs((alpha.hangingBaseline - top.hangingBaseline) - shift) < 0.01,
        // Width is untouched by a vertical alignment change.
        widthStable: Math.abs(top.width - alpha.width) < 1e-6,
        // 'middle' lands strictly between 'top' and 'bottom'. Note the sign
        // convention: a baseline BELOW the alignment point reports negative, so
        // 'top' is the most negative and 'bottom' the most positive.
        middleBetween: middle.alphabeticBaseline > top.alphabeticBaseline &&
                       middle.alphabeticBaseline < bottom.alphabeticBaseline,
        // And it is exactly halfway: 'middle' splits the em box evenly.
        middleHalvesEm: Math.abs(middle.emHeightAscent - middle.emHeightDescent) < 0.01 &&
            Math.abs(middle.emHeightAscent + middle.emHeightDescent -
                     (alpha.emHeightAscent + alpha.emHeightDescent)) < 0.01,
        // 'bottom' puts the whole em box above the alignment point.
        bottomEmDescentZero: Math.abs(bottom.emHeightDescent) < 1e-4,
    };
}

// ── Linear scaling ──────────────────────────────────────────────────────────

/**
 * Doubling the font size doubles every metric — but the tolerance is not the
 * same for all twelve, and the reason is real rather than a fudge.
 *
 * The ADVANCE and FACE metrics (width, fontBoundingBox*, emHeight*, and the
 * three baselines, which are derived from them) are scalable quantities: they
 * come from the font's own units-per-em scaled by the size, land on Skia's
 * 1/64px grid, and must double to a fraction of a percent.
 *
 * The INK metrics (actualBoundingBox*) do NOT. They are the union of GLYPH
 * BOUNDING BOXES, which Skia reports as integral pixel rectangles derived from
 * the hinted outline at that specific size. 'Hamburgefonstiv' in Arial has ink
 * ascent 17 at 24px and 35 at 48px — not 34 — because both are whole pixels
 * around a hinted outline, and hinting is deliberately non-linear. Requiring
 * exact doubling there would be asserting that hinting does not exist.
 *
 * So ink gets ±1px plus a small proportional term, and the report says which
 * bucket each member is in rather than quietly applying one loose tolerance to
 * everything.
 */
export const INK_KEYS = [
    'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
];

export function scalingReport(text, family) {
    const t = text || 'Hamburgefonstiv';
    const fam = family || 'Arial';
    const a = measure(t, `24px ${fam}`);
    const b = measure(t, `48px ${fam}`);
    const checks = METRIC_KEYS.map((k) => {
        const expected = a[k] * 2;
        const got = b[k];
        const scale = Math.max(Math.abs(expected), 1);
        const ink = INK_KEYS.indexOf(k) >= 0;
        // Scalable metrics: 2%. Ink metrics: 2% plus one whole pixel, because
        // both readings are integral pixel boxes around a hinted outline.
        const tol = ink ? scale * 0.02 + 1.0 : scale * 0.02 + 0.02;
        return {
            key: k, small: a[k], large: got, expected, ink, tol,
            ok: Math.abs(got - expected) <= tol,
            error: got - expected,
        };
    });
    return {
        text: t, family: fam, checks,
        allScale: checks.every((c) => c.ok),
        scalableExact: checks.filter((c) => !c.ink).every((c) => c.ok),
        // How far the ink metrics actually drifted, so the panel can state the
        // hinting effect as a number instead of hiding it in a tolerance.
        maxInkError: Math.max(...checks.filter((c) => c.ink).map((c) => Math.abs(c.error))),
    };
}

// ── DOM cross-seam ──────────────────────────────────────────────────────────

/**
 * The canvas and the LAYOUT engine must agree on how wide a string is.
 *
 * They reach the answer through different code — canvas through
 * CanvasScene::measureText, layout through Renderer::measureText and
 * htmlayout — but both bottom out in the same TextShapingEngine, so an inline
 * box shrink-wrapped around a string must be as wide as measureText says.
 * A disagreement here is the classic "text overflows its box by one glyph"
 * bug, caught before it is visible.
 */
export function domAgreementReport() {
    const host = document.getElementById('metricsDomProbe');
    if (!host) return null;
    return [...host.querySelectorAll('span')].map((sp) => {
        const cs = getComputedStyle(sp);
        const size = parseFloat(cs.fontSize);
        const family = cs.fontFamily.replace(/["']/g, '').split(',')[0].trim();
        const rect = sp.getBoundingClientRect();
        const m = measure(sp.textContent, `${size}px ${family}`);
        return {
            text: sp.textContent, family, size,
            domWidth: rect.width,
            canvasWidth: m.width,
            delta: rect.width - m.width,
            // Sub-pixel: the same shaped advance, read twice.
            agrees: Math.abs(rect.width - m.width) < 0.5,
        };
    });
}

/**
 * Kerning does not stop at a space — so layout must not either.
 *
 * The single-word probes above agree with canvas exactly. A space is the case
 * that separates two implementations that both look right on one word: line
 * breaking has to split text at word boundaries, and the tempting way to
 * measure the result is
 *
 *     Σ width(word_i)  +  (n−1) × width(" ")
 *
 * which shapes every word in isolation and loses every kern pair that
 * straddles a space. For "A V" in 28px Arial that is 1.54px on three
 * characters; for "AV Wa To LT" it is 0.51px — enough for text to overflow a
 * box measured for it. It is the same "prefix measurement is wrong by
 * construction" failure `shaped_run.h` warns about, one layer up at word
 * granularity instead of character granularity.
 *
 * So this checks layout's width against the WHOLE string shaped once, and
 * reports the isolated-word sum alongside it — naming the number layout must
 * not be, not just the one it must be.
 */
export function wordSplitProbe() {
    const host = document.getElementById('metricsWordProbe');
    if (!host) return null;
    return [...host.querySelectorAll('span')].map((sp) => {
        const cs = getComputedStyle(sp);
        const size = parseFloat(cs.fontSize);
        const family = cs.fontFamily.replace(/["']/g, '').split(',')[0].trim();
        const text = sp.textContent;
        const opts = { family, size };

        const domWidth = sp.getBoundingClientRect().width;
        const wholeShaped = shape(text, opts).width;
        const words = text.split(' ');
        const spaceW = shape(' ', opts).width;
        const pieceSum = words.reduce((a, w) => a + shape(w, opts).width, 0) +
            (words.length - 1) * spaceW;

        return {
            text, family, size, words: words.length,
            domWidth, wholeShaped, pieceSum, spaceW,
            delta: domWidth - wholeShaped,
            // The mechanism, not just the symptom: layout's number IS the sum
            // of independently-shaped pieces, to within a rounding grid.
            matchesPieceSum: Math.abs(domWidth - pieceSum) < 0.01,
            // What correct behaviour would look like.
            matchesWholeShaped: Math.abs(domWidth - wholeShaped) < 0.01,
            lostKerning: pieceSum - wholeShaped,
        };
    });
}

// ── Drawing: the metric boxes over real glyphs ──────────────────────────────

const MX = 60;
const MY = 130;

/**
 * Draw a string and every box measureText reported around it. This is the
 * panel's whole reason to exist — the numbers in the table are abstract until
 * the em box, the font box and the ink box are visibly nested.
 */
export function drawMetrics(canvas, text, font) {
    const g = canvas.getContext('2d');
    const t = text === undefined ? 'Hamburgefonstiv' : text;
    const f = font || '84px Georgia';

    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#12151c';
    g.fillRect(0, 0, canvas.width, canvas.height);

    g.font = f;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const m = g.measureText(t);

    const box = (top, bottom, left, right, color, label) => {
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.setLineDash([]);
        g.strokeRect(MX + left + 0.5, MY - top + 0.5, right - left, top + bottom);
        g.fillStyle = color;
        g.font = '11px Consolas, monospace';
        g.fillText(label, MX + left + 3, MY - top - 4);
        g.font = f;
    };

    // font box (the face's line box) — outermost.
    box(m.fontBoundingBoxAscent, m.fontBoundingBoxDescent, 0, m.width,
        '#3f4a5f', 'fontBoundingBox');
    // em box.
    box(m.emHeightAscent, m.emHeightDescent, 0, m.width, '#3b82f6', 'emHeight');
    // ink box.
    box(m.actualBoundingBoxAscent, m.actualBoundingBoxDescent,
        -m.actualBoundingBoxLeft, m.actualBoundingBoxRight, '#f59e0b', 'actualBoundingBox');

    // Baselines.
    const line = (y, color, label) => {
        g.strokeStyle = color;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(MX - 22, MY - y + 0.5);
        g.lineTo(MX + m.width + 40, MY - y + 0.5);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = color;
        g.font = '11px Consolas, monospace';
        g.fillText(label, MX + m.width + 44, MY - y + 4);
        g.font = f;
    };
    line(m.alphabeticBaseline, '#4ade80', 'alphabetic');
    line(m.hangingBaseline, '#c084fc', 'hanging');
    line(m.ideographicBaseline, '#f472b6', 'ideographic');

    // The glyphs, last, on top.
    g.fillStyle = '#e8edf7';
    g.fillText(t, MX, MY);

    return m;
}

// ── Panel ───────────────────────────────────────────────────────────────────

let metricCanvas = null;
let rowCells = null;
let surfaceHost = null;
let inkHost = null;
let alignHost = null;
let baseHost = null;
let scaleHost = null;
let domHost = null;
let wordHost = null;

export function initMetrics() {
    metricCanvas = document.getElementById('metricsCanvas');
    ctx = document.getElementById('metricsProbe').getContext('2d');

    surfaceHost = document.getElementById('metricsSurface');
    inkHost = document.getElementById('metricsInk');
    alignHost = document.getElementById('metricsAlign');
    baseHost = document.getElementById('metricsBaseline');
    scaleHost = document.getElementById('metricsScaling');
    domHost = document.getElementById('metricsDom');
    wordHost = document.getElementById('metricsWords');

    rowCells = buildTable(document.getElementById('metricsTable'),
        ['sample', 'width', 'ink W', 'ink H', 'ascent', 'descent', 'font asc/desc', 'em asc/desc', 'w == shaped'],
        METRIC_SAMPLES.length).cells;

    refreshMetrics();
}

export function refreshMetrics(text, font) {
    drawMetrics(metricCanvas, text, font);

    const surf = surfaceReport();
    metricsState.surface = surf;
    surfaceHost.textContent =
        `${surf.present.length} members present. Missing from the spec surface: ` +
        (surf.missing.length ? surf.missing.join(', ') : 'none — the surface is complete') +
        '. Non-spec extras: ' + (surf.extra.length ? surf.extra.join(', ') : 'none') +
        '. All finite numbers: ' + (surf.allNumbers ? 'yes' : 'NO') + '.';
    surfaceHost.className = 'result ' +
        (surf.complete && surf.extra.length === 0 && surf.allNumbers ? 'ok' : 'bad');

    metricsState.rows = METRIC_SAMPLES.map((s) => {
        const family = s.id === 'rtl' || s.id === 'emoji' ? 'Arial' : 'Arial';
        return Object.assign({ id: s.id, note: s.note },
            consistencyRow(s.text, `48px ${family}`));
    });
    metricsState.rows.forEach((r, i) => {
        const c = rowCells[i];
        const s = METRIC_SAMPLES[i];
        c[0].textContent = (s.text === '' ? '(empty)' : s.text === ' ' ? '(space)' : s.text)
            + ' — ' + s.note;
        c[1].textContent = n2(r.m.width);
        c[2].textContent = n2(r.inkWidth);
        c[3].textContent = n2(r.inkHeight);
        c[4].textContent = n2(r.m.actualBoundingBoxAscent);
        c[5].textContent = n2(r.m.actualBoundingBoxDescent);
        c[6].textContent = n2(r.m.fontBoundingBoxAscent) + ' / ' + n2(r.m.fontBoundingBoxDescent);
        c[7].textContent = n2(r.m.emHeightAscent) + ' / ' + n2(r.m.emHeightDescent);
        verdict(c[8], r.widthMatchesShape, r.widthMatchesShape ? 'exact' : 'Δ' + n2(r.m.width - r.shapedWidth));
    });

    const ink = inkSensitivityReport();
    metricsState.ink = ink;
    inkHost.textContent =
        `ink ascent: "acemn" ${n2(ink.xAscent)} < "ABCH" ${n2(ink.capAscent)} ≤ "bdfkl" ${n2(ink.ascAscent)} — ` +
        `${ink.xBelowCaps && ink.capsAtMostAscenders ? 'ordered correctly' : 'OUT OF ORDER'}. ` +
        `ink descent: "acemn" ${n2(ink.xDescent)} (none), "gjpqy" ${n2(ink.descDescent)} — ` +
        `${ink.xNoDescent && ink.descHasDescent ? 'the box follows the glyphs' : 'WRONG'}. ` +
        `Meanwhile fontBoundingBoxAscent did not move: ${ink.fontBoxStable ? 'correct — it is the face, not the string' : 'IT MOVED — bug'}.`;
    inkHost.className = 'result ' +
        (ink.xBelowCaps && ink.xNoDescent && ink.descHasDescent && ink.fontBoxStable ? 'ok' : 'bad');

    const al = alignReport();
    metricsState.align = al;
    alignHost.textContent =
        `width unchanged across left/center/right: ${al.widthStable ? 'yes' : 'NO'}. ` +
        `left→center moved the ink box by exactly width/2: ${al.centerShift ? 'yes' : 'NO'}. ` +
        `left→right moved it by the full width: ${al.rightShift ? 'yes' : 'NO'}. ` +
        `Ink WIDTH invariant: ${al.inkWidthStable ? 'yes' : 'NO'}. ` +
        `Vertical metrics untouched by a horizontal change: ${al.verticalUntouched ? 'yes' : 'NO'}.`;
    alignHost.className = 'result ' +
        (al.widthStable && al.centerShift && al.rightShift && al.verticalUntouched ? 'ok' : 'bad');

    const bl = baselineReport();
    metricsState.baseline = bl;
    baseHost.textContent =
        `alphabeticBaseline is 0 under textBaseline:'alphabetic': ${bl.alphaIsZero ? 'yes' : 'NO'}. ` +
        `Under 'top' the em ascent collapses to 0: ${bl.topEmAscentZero ? 'yes' : 'NO'}, ` +
        `and the baseline moved down by exactly emHeightAscent: ${bl.topShiftIsEmAscent ? 'yes' : 'NO'}. ` +
        `Every vertical metric translated rigidly by that same shift: ${bl.rigid ? 'yes' : 'NO'}. ` +
        `'middle' lands between 'top' and 'bottom': ${bl.middleBetween ? 'yes' : 'NO'}. ` +
        `Width untouched: ${bl.widthStable ? 'yes' : 'NO'}.`;
    baseHost.className = 'result ' +
        (bl.alphaIsZero && bl.topEmAscentZero && bl.topShiftIsEmAscent && bl.rigid ? 'ok' : 'bad');

    const sc = scalingReport();
    metricsState.scaling = sc;
    const badScale = sc.checks.filter((c) => !c.ok);
    scaleHost.textContent =
        `24px → 48px. The 8 scalable members (advance, face and baseline metrics) ` +
        `doubled to within 2%: ${sc.scalableExact ? 'yes' : 'NO'}. The 4 ink members are ` +
        `integral pixel boxes around a HINTED outline, so they drift by up to ` +
        `${n2(sc.maxInkError)}px — hinting is non-linear by design, and requiring exact ` +
        `doubling there would be asserting it does not exist. ` +
        (badScale.length === 0
            ? 'All twelve within their own tolerance.'
            : 'Outside tolerance: ' + badScale.map((c) =>
                `${c.key} ${n2(c.small)}→${n2(c.large)} (expected ${n2(c.expected)})`).join(', '));
    scaleHost.className = 'result ' + (badScale.length === 0 ? 'ok' : 'bad');

    const dom = domAgreementReport();
    metricsState.domAgreement = dom;
    if (dom) {
        const off = dom.filter((d) => !d.agrees);
        domHost.textContent =
            `${dom.length} inline boxes measured by layout and by canvas: ` +
            (off.length === 0
                ? 'all agree to within half a pixel — one shaping engine under both.'
                : off.map((d) => `"${d.text}" DOM ${n2(d.domWidth)} vs canvas ${n2(d.canvasWidth)} (Δ${n2(d.delta)})`).join('; '));
        domHost.className = 'result ' + (off.length === 0 ? 'ok' : 'bad');
    }

    const words = wordSplitProbe();
    metricsState.wordSplit = words;
    if (words && wordHost) {
        const broken = words.filter((w) => !w.matchesWholeShaped);
        wordHost.textContent = words.map((w) =>
            `"${w.text}" (${w.size}px ${w.family}): layout ${n2(w.domWidth)}px vs the whole string ` +
            `shaped once ${n2(w.wholeShaped)}px — ${w.matchesWholeShaped ? 'identical' : `MISMATCH (Δ${n2(w.delta)})`}. ` +
            `Shaping each word alone would give ${n2(w.pieceSum)}px instead, ` +
            `losing ${n2(w.lostKerning)}px of kerning across the ${w.words - 1} space(s)` +
            (w.matchesPieceSum ? ' — which is exactly what layout reports' : '')
          ).join(' · ');
        wordHost.className = 'result ' + (broken.length === 0 ? 'ok' : 'bad');
    }
}
