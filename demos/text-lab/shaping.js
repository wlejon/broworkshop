// shaping.js — HarfBuzz, seen from JS.
//
// Everything a shaper does that a 1:1 codepoint→glyph mapper cannot:
//
//   LIGATURES        n characters fuse into ONE glyph. The cluster map is the
//                    only place this is visible from JS, because glyph ids
//                    never leave bro::render — but `cluster.glyphs` (the glyph
//                    COUNT) is exported precisely so a ligature is assertable.
//   KERNING          a pair's width is not the sum of its parts. This is the
//                    cheapest possible proof that shaping ran, because it
//                    fails loudly under any per-character measurement.
//   CONTEXTUAL FORMS the glyph chosen for a character depends on its
//                    neighbours (see scripts.js for Arabic joining, the
//                    extreme case).
//   SUBPIXEL ADVANCE advances are floats, not rounded integers. Rounding per
//                    character is how text drifts away from its own layout box
//                    over a long line.
//
// The header of src/render/shaped_run.h states the consequence outright:
// "prefix measurement is wrong by construction". This module demonstrates that
// literally — it measures a word both ways and shows the two answers differ.

import { el, n2, sum, buildTable, verdict, utf8Length } from '/app/textutil.js';

// Families we probe. All six ship with Windows; on another platform the
// missing ones simply fall back, which the coverage row below reports rather
// than hides.
export const FAMILIES = ['Calibri', 'Arial', 'Cambria', 'Georgia', 'Times New Roman', 'Segoe UI'];

// Calibri is the interesting one and is deliberately first: measured across
// these six faces it is the ONLY one that forms f-ligatures at default
// settings, which is exactly the note in shaped_run.h's byteOffsetToX comment
// ("Calibri turns 'office fluffy first' into 14 clusters where the others make
// 19"). An assertion written against Arial would silently prove nothing.
export const LIGATURE_FAMILY = 'Calibri';

// Strings whose character count and glyph count differ under a shaping font.
export const LIGATURE_SAMPLES = ['ffi', 'ffl', 'fi', 'fl', 'ff', 'office'];

// Pairs chosen because they kern NEGATIVELY in essentially every text face —
// the diagonal-then-vertical shapes that leave a hole if left unkerned.
export const KERN_PAIRS = ['AV', 'AW', 'To', 'Yo', 'LT', 'P,', 'F.'];

export const shapeState = {
    families: [],        // [{ family, present, width }]
    ligatures: [],       // [{ text, chars, bytes, glyphs, clusters, fused }]
    kerning: [],         // [{ pair, joint, apart, delta, kerned }]
    spacing: null,       // ligature suppression under letter-spacing
    prefix: null,        // the "prefix measurement is wrong" demonstration
    styles: [],          // weight / italic / size affecting the shaped result
    cache: { hits: 0, misses: 0 },
};

/**
 * The one place this lab calls bro.text.shape. Wrapping it buys two things:
 * a hard failure instead of a null deref when there is no renderer, and a
 * single point where the default font descriptor lives.
 */
export function shape(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 32 }, opts || {});
    const r = bro.text.shape(text, o);
    if (!r) throw new Error('bro.text.shape returned null for ' + JSON.stringify(text));
    return r;
}

/** Shaped advance width of `text`. */
export function widthOf(text, opts) {
    return shape(text, opts).width;
}

// ── Ligatures ───────────────────────────────────────────────────────────────

/**
 * For each sample: how many characters went in, how many glyphs came out, and
 * how many clusters the shaper grouped them into.
 *
 * `fused` is the assertion-grade fact: a cluster spanning more than one byte
 * AND producing exactly one glyph is a ligature by definition. Note that the
 * converse is NOT true — a Devanagari cluster spans many bytes and produces
 * SEVERAL glyphs (see scripts.js), so "multi-byte cluster" alone would be a
 * weaker claim than it looks.
 */
export function ligatureReport(family) {
    return LIGATURE_SAMPLES.map((text) => {
        const r = shape(text, { family, size: 48 });
        const clusters = r.clusters;
        const fused = clusters.filter((c) => (c.end - c.start) > 1 && c.glyphs === 1);
        return {
            family,
            text,
            chars: text.length,
            bytes: utf8Length(text),
            glyphs: r.glyphCount,
            clusters: clusters.length,
            width: r.width,
            // A ligature made the output SHORTER in glyphs than in characters.
            ligated: r.glyphCount < utf8Length(text),
            fused: fused.length,
            // Which byte spans fused, for the panel.
            spans: fused.map((c) => `${c.start}–${c.end}`).join(' '),
        };
    });
}

// ── Kerning ─────────────────────────────────────────────────────────────────

/**
 * width("AV") vs width("A") + width("V").
 *
 * This is the strongest cheap test in the whole lab. Kerning is a property of
 * the PAIR, so any implementation that measures characters independently and
 * adds — which is what bro did before shaping landed — gets `delta === 0` for
 * every row. A negative delta cannot be faked without a kern table lookup.
 */
export function kerningReport(family, size) {
    const sz = size || 64;
    return KERN_PAIRS.map((pair) => {
        const a = pair[0];
        const b = pair[1];
        const joint = widthOf(pair, { family, size: sz });
        const apart = widthOf(a, { family, size: sz }) + widthOf(b, { family, size: sz });
        const delta = joint - apart;
        return {
            family, pair, joint, apart, delta,
            kerned: Math.abs(delta) > 1e-4,
            tightened: delta < -1e-4,
        };
    });
}

// ── "Prefix measurement is wrong by construction" ───────────────────────────

/**
 * Measure a word two ways:
 *   naive  — sum of each character measured on its own (no pair context)
 *   shaped — one shape() call over the whole word
 *
 * and additionally walk the cluster map to show that the shaped width really
 * is the sum of the CLUSTER advances (which it must be, or the caret geometry
 * and the layout box would disagree).
 *
 * The naive number is wrong for two independent reasons at once here: kerning
 * between the pairs, and — in Calibri — a ligature that never forms when the
 * characters are shaped separately.
 */
export function prefixReport(word, family, size) {
    const opts = { family: family || LIGATURE_FAMILY, size: size || 48 };
    const r = shape(word, opts);
    let naive = 0;
    for (const ch of word) naive += widthOf(ch, opts);
    const clusterSum = sum(r.clusters, (c) => c.advance);
    return {
        word, family: opts.family, size: opts.size,
        naive,
        shaped: r.width,
        clusterSum,
        // The cluster map must reconstruct the run's own width exactly. If this
        // ever drifts, carets stop landing where glyphs are drawn.
        clusterSumMatches: Math.abs(clusterSum - r.width) < 1e-3,
        error: naive - r.width,
        chars: [...word].length,
        clusters: r.clusters.length,
        glyphs: r.glyphCount,
    };
}

// ── letter-spacing suppresses ligatures ─────────────────────────────────────

/**
 * CSS letter-spacing inserts space BETWEEN CHARACTERS. A ligature has fused
 * several characters into one indivisible glyph, so there is nowhere to put
 * the space — browsers therefore turn ligatures off whenever letter-spacing is
 * non-zero, and bro does the same: `TextShapingEngine::shape()` takes
 * `disableLigatures`, and text_bindings.cpp sets it from `letterSpacing != 0`.
 *
 * So a NON-ZERO letterSpacing changes which glyphs exist, not merely where
 * they sit. That is a shaping input, and it is in the cache key; the spacing
 * AMOUNT is not, because it only repositions already-shaped output.
 *
 * The second half of this report checks where the space actually lands: CSS
 * puts letter-spacing between clusters with n-1 gaps and NEVER a trailing one,
 * so a centred line is not dragged leftward by a phantom gap after the last
 * glyph.
 */
export function spacingReport(family) {
    const fam = family || LIGATURE_FAMILY;
    const base = { family: fam, size: 48 };
    const plain = shape('ffi', base);
    const spaced = shape('ffi', Object.assign({ letterSpacing: 2 }, base));

    // Gap accounting on a string with no ligature, so cluster count is stable
    // across the two measurements and the delta is purely the inserted space.
    const gapWord = 'nnnn';
    const g0 = shape(gapWord, base);
    const amount = 5;
    const g1 = shape(gapWord, Object.assign({ letterSpacing: amount }, base));
    const gaps = g0.clusters.length - 1;

    // word-spacing is the other CSS spacing knob and lands on U+0020 clusters
    // only (ShapedRun::Cluster::isWordSep — "exactly one U+0020").
    const wsWord = 'a b c';
    const w0 = shape(wsWord, base);
    const w1 = shape(wsWord, Object.assign({ wordSpacing: 7 }, base));
    const spaceCount = (wsWord.match(/ /g) || []).length;

    return {
        family: fam,
        plainGlyphs: plain.glyphCount,
        plainClusters: plain.clusters.length,
        spacedGlyphs: spaced.glyphCount,
        spacedClusters: spaced.clusters.length,
        // Non-zero letter-spacing must have BROKEN the ligature apart.
        suppressed: spaced.glyphCount > plain.glyphCount,
        gapWord, gaps, amount,
        gapDelta: g1.width - g0.width,
        // n-1 gaps, no trailing gap.
        gapExact: Math.abs((g1.width - g0.width) - gaps * amount) < 1e-3,
        wsWord, spaceCount,
        wsDelta: w1.width - w0.width,
        wsExact: Math.abs((w1.width - w0.width) - spaceCount * 7) < 1e-3,
        // Positions of the spaced clusters, to show the gaps are BETWEEN them.
        spacedX: spaced.clusters.map((c) => c.x),
    };
}

// ── Style axes that are shaping inputs ──────────────────────────────────────

/**
 * size, weight and italic are all part of TextShapingEngine::Key, so each one
 * produces a genuinely different ShapedRun rather than a scaled reading of one.
 *
 * A caveat worth stating in the panel rather than hiding: for Arial and Times
 * New Roman the italic face has the SAME advance widths as the roman, so an
 * italic assertion against those families proves nothing. Georgia and Cambria
 * do differ, so those are the ones this lab asserts on. That is a font fact,
 * not an engine fact, and the panel says which is which.
 */
export const ITALIC_DIVERGENT = ['Georgia', 'Cambria'];

export function styleReport(word) {
    const w = word || 'Hello world';
    const out = [];
    for (const family of FAMILIES) {
        const base = { family, size: 48 };
        const regular = widthOf(w, base);
        const bold = widthOf(w, Object.assign({ weight: 700 }, base));
        const italic = widthOf(w, Object.assign({ italic: true }, base));
        const half = widthOf(w, { family, size: 24 });
        out.push({
            family, regular, bold, italic, half,
            boldWider: bold > regular,
            italicDiffers: Math.abs(italic - regular) > 1e-3,
            // Advances scale linearly with size (hinting aside) — half the size
            // is half the width to within a rounding grid.
            scales: Math.abs(half * 2 - regular) < regular * 0.02,
        });
    }
    return out;
}

// ── Subpixel advances ───────────────────────────────────────────────────────

/**
 * If advances were rounded to integers, a long run's width would be an integer
 * and the per-cluster advances would all be whole numbers. They are not: Skia
 * reports advances on a 1/64 px grid, so the interesting assertion is that at
 * least one advance in an ordinary English word has a fractional part.
 *
 * Why it matters: rounding per character accumulates. Over an 80-character
 * line a half-pixel-per-glyph rounding error is 40px of drift between where
 * layout thinks the text ends and where it is drawn.
 */
export function subpixelReport(family) {
    const opts = { family: family || 'Arial', size: 17 };  // odd size on purpose
    const word = 'The quick brown fox jumps over the lazy dog';
    const r = shape(word, opts);
    const frac = r.clusters.filter((c) => Math.abs(c.advance - Math.round(c.advance)) > 1e-4);
    const roundedSum = sum(r.clusters, (c) => Math.round(c.advance));
    return {
        family: opts.family, size: opts.size, word,
        clusters: r.clusters.length,
        fractional: frac.length,
        width: r.width,
        roundedSum,
        drift: roundedSum - r.width,
        // The whole point: rounding every advance moves the end of the line.
        driftMatters: Math.abs(roundedSum - r.width) > 1,
    };
}

// ── Shaping cache ───────────────────────────────────────────────────────────

/**
 * bro.text.cacheStats() reads TextShapingEngine's hit/miss counters. The
 * observable contract: shaping the SAME (text, family, size, weight, italic,
 * direction, ligature-toggle) tuple twice must hit; changing any of them must
 * miss. Crucially, changing only letterSpacing's AMOUNT (while staying
 * non-zero) must NOT miss, because spacing is applied to positioned output and
 * is deliberately absent from the key.
 */
export function cacheProbe() {
    const uniq = 'cache-probe-' + Math.random().toString(36).slice(2);
    const opts = { family: 'Arial', size: 31 };

    const a = bro.text.cacheStats();
    shape(uniq, opts);                       // cold: must miss
    const b = bro.text.cacheStats();
    shape(uniq, opts);                       // same tuple: must hit
    const c = bro.text.cacheStats();
    shape(uniq, { family: 'Arial', size: 32 });  // different size: must miss
    const d = bro.text.cacheStats();

    // Two different NON-ZERO letter-spacings over an already-shaped string.
    // Both disable ligatures, so both map to the same cache key; the second
    // must hit even though the spacing amount changed.
    shape(uniq, Object.assign({ letterSpacing: 1 }, opts));
    const e = bro.text.cacheStats();
    shape(uniq, Object.assign({ letterSpacing: 9 }, opts));
    const f = bro.text.cacheStats();

    return {
        coldMiss: b.misses > a.misses,
        warmHit: c.hits > b.hits && c.misses === b.misses,
        sizeMiss: d.misses > c.misses,
        // Spacing amount is not in the key: a second, different amount hits.
        spacingAmountHit: f.hits > e.hits && f.misses === e.misses,
        stats: f,
    };
}

// ── Panel ───────────────────────────────────────────────────────────────────

let ligCells = null;
let kernCells = null;
let styleCells = null;
let spacingHost = null;
let prefixHost = null;
let subHost = null;
let cacheHost = null;

export function initShaping() {
    // Family presence. There is no font-enumeration API in bro, so "is this
    // family here?" is answered the only way available: shape a probe string
    // and see whether the width differs from the fallback the engine picks for
    // a family name that certainly does not exist. Same width = same face =
    // the family was not found. Reported, never silently skipped.
    const bogus = widthOf('Hamburgefonstiv', { family: 'NoSuchFamily' + Date.now(), size: 32 });
    shapeState.families = FAMILIES.map((family) => {
        const width = widthOf('Hamburgefonstiv', { family, size: 32 });
        return { family, width, present: Math.abs(width - bogus) > 1e-3 };
    });

    const famHost = document.getElementById('shapeFamilies');
    for (const f of shapeState.families) {
        const tag = el('span', 'famtag ' + (f.present ? 'ok' : 'bad'),
            f.family + ' ' + n2(f.width));
        tag.title = f.present ? 'distinct face found' : 'fell back — family not installed';
        famHost.appendChild(tag);
    }

    ligCells = buildTable(document.getElementById('shapeLigatures'),
        ['text', 'chars', 'bytes', 'glyphs', 'clusters', 'fused span', 'verdict'],
        LIGATURE_SAMPLES.length).cells;

    kernCells = buildTable(document.getElementById('shapeKerning'),
        ['pair', 'width(pair)', 'w(a)+w(b)', 'delta', 'verdict'],
        KERN_PAIRS.length).cells;

    styleCells = buildTable(document.getElementById('shapeStyles'),
        ['family', '48px', 'bold', 'italic', '24px×2', 'bold≠reg', 'italic≠reg'],
        FAMILIES.length).cells;

    spacingHost = document.getElementById('shapeSpacing');
    prefixHost = document.getElementById('shapePrefix');
    subHost = document.getElementById('shapeSubpixel');
    cacheHost = document.getElementById('shapeCache');

    refreshShaping();
}

export function refreshShaping(family) {
    const fam = family || LIGATURE_FAMILY;

    shapeState.ligatures = ligatureReport(fam);
    shapeState.ligatures.forEach((r, i) => {
        const c = ligCells[i];
        c[0].textContent = r.text;
        c[1].textContent = r.chars;
        c[2].textContent = r.bytes;
        c[3].textContent = r.glyphs;
        c[4].textContent = r.clusters;
        c[5].textContent = r.spans || '—';
        verdict(c[6], true, r.ligated ? `ligated (${r.bytes}→${r.glyphs})` : 'no ligature');
        c[6].className = r.ligated ? 'ok' : 'neutral';
    });

    shapeState.kerning = kerningReport(fam);
    shapeState.kerning.forEach((r, i) => {
        const c = kernCells[i];
        c[0].textContent = r.pair;
        c[1].textContent = n2(r.joint);
        c[2].textContent = n2(r.apart);
        c[3].textContent = (r.delta >= 0 ? '+' : '') + n2(r.delta);
        verdict(c[4], r.kerned, r.tightened ? 'kerned tighter' : (r.kerned ? 'kerned' : 'no kern pair'));
        if (!r.kerned) c[4].className = 'neutral';
    });

    shapeState.styles = styleReport();
    shapeState.styles.forEach((r, i) => {
        const c = styleCells[i];
        c[0].textContent = r.family;
        c[1].textContent = n2(r.regular);
        c[2].textContent = n2(r.bold);
        c[3].textContent = n2(r.italic);
        c[4].textContent = n2(r.half * 2);
        verdict(c[5], r.boldWider, r.boldWider ? 'yes' : 'no');
        verdict(c[6], r.italicDiffers, r.italicDiffers ? 'yes' : 'same advances');
        if (!r.italicDiffers) c[6].className = 'neutral';
    });

    shapeState.spacing = spacingReport(fam);
    const sp = shapeState.spacing;
    spacingHost.textContent =
        `"ffi" in ${sp.family}: ${sp.plainGlyphs} glyph(s) normally, ` +
        `${sp.spacedGlyphs} with letter-spacing:2 — ligature ` +
        (sp.suppressed ? 'SUPPRESSED as it must be' : 'NOT suppressed (bug)') + '. ' +
        `letter-spacing ${sp.amount}px over "${sp.gapWord}" added ${n2(sp.gapDelta)}px ` +
        `= ${sp.gaps} gaps × ${sp.amount} (n−1, no trailing gap): ${sp.gapExact ? 'exact' : 'MISMATCH'}. ` +
        `word-spacing 7px over "${sp.wsWord}" added ${n2(sp.wsDelta)}px ` +
        `across ${sp.spaceCount} space(s): ${sp.wsExact ? 'exact' : 'MISMATCH'}.`;

    shapeState.prefix = prefixReport('office', fam);
    const pr = shapeState.prefix;
    prefixHost.textContent =
        `"${pr.word}" in ${pr.family} ${pr.size}px — measured per character and summed: ` +
        `${n2(pr.naive)}px. Shaped as one run: ${n2(pr.shaped)}px. ` +
        `Per-character measurement is off by ${n2(pr.error)}px ` +
        `(${pr.chars} chars → ${pr.clusters} clusters → ${pr.glyphs} glyphs). ` +
        `Cluster advances re-sum to the run width: ${pr.clusterSumMatches ? 'yes' : 'NO'}.`;

    const sub = subpixelReport();
    shapeState.subpixel = sub;
    subHost.textContent =
        `${sub.clusters} clusters at ${sub.size}px, ${sub.fractional} with fractional advances. ` +
        `Run width ${n2(sub.width)}px; rounding every advance to an integer gives ` +
        `${n2(sub.roundedSum)}px — ${n2(Math.abs(sub.drift))}px of drift over one line.`;

    const cp = cacheProbe();
    shapeState.cacheProbe = cp;
    shapeState.cache = cp.stats;
    cacheHost.textContent =
        `cold shape misses: ${cp.coldMiss ? 'yes' : 'NO'} · ` +
        `identical re-shape hits: ${cp.warmHit ? 'yes' : 'NO'} · ` +
        `size change misses: ${cp.sizeMiss ? 'yes' : 'NO'} · ` +
        `letter-spacing AMOUNT change still hits (not in the key): ${cp.spacingAmountHit ? 'yes' : 'NO'} · ` +
        `totals ${cp.stats.hits} hits / ${cp.stats.misses} misses`;
}
