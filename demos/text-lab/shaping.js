// shaping.js — HarfBuzz, seen from JS.
//
// Shaping is only interesting where it DISAGREES with per-character
// measurement, so every report here is a comparison between the two rather
// than a check that shaping returned something:
//
//   LIGATURES         n characters fuse into ONE glyph. Glyph ids never leave
//                     bro::render, but cluster.glyphs (a COUNT) is exported
//                     precisely so a ligature is assertable.
//   KERNING           a pair's width is not the sum of its parts — the cheapest
//                     proof that shaping ran, since per-character measurement
//                     gets a delta of exactly zero.
//   SPACING           letter-spacing suppresses ligatures (a shaping INPUT, in
//                     the cache key); its amount only repositions output.
//   SUBPIXEL ADVANCE  advances are floats; rounding per character drifts.
//
// src/render/shaped_run.h: with shaping, "prefix measurement is wrong by
// construction". prefixReport() measures a word both ways to show it.

import { shape, utf8Length } from '/lib/kit/text.js';
import { h } from '/lib/kit/dom.js';
import { n2, table, verdict, result } from '/app/report.js';

export { shape };

/** Shaped advance width of `text`. */
export function widthOf(text, opts) {
    return shape(text, opts).width;
}

// Families probed, one per role. The first name in each slot ships with
// Windows; the second is the face that ships with macOS in the same role. A
// slot takes the first name that resolves to a real face (else the first
// name, which the family row then reports as a fallback rather than hiding).
const FAMILY_SLOTS = [
    ['Calibri', 'Hoefler Text'],        // the f-ligature face (below)
    ['Arial'],                          // the no-ligature contrast
    ['Cambria', 'Palatino'],            // a serif whose italic has its own advances
    ['Georgia'],
    ['Times New Roman'],
    ['Segoe UI', 'Helvetica Neue'],     // the platform UI face
];

/**
 * Whether `family` resolved to a real face. There is no font-enumeration API,
 * so a family that shapes exactly like a certainly-missing name got the
 * fallback face: it is not installed, or it IS the fallback. Width alone is
 * not enough: Arial was drawn metric-compatible with Helvetica (macOS's
 * fallback), so 'Hamburgefonstiv' measures identically in both; their kerns
 * and ligatures still differ, so the fingerprint takes those in too.
 */
let bogusPrint = null;
function fingerprint(family) {
    return ['Hamburgefonstiv', 'AV', 'office'].map((t) => {
        const r = shape(t, { family, size: 32 });
        return r.width.toFixed(4) + '/' + r.glyphCount;
    }).join(' ');
}
export function familyPresent(family) {
    if (bogusPrint === null) bogusPrint = fingerprint('NoSuchFamily' + Date.now());
    return fingerprint(family) !== bogusPrint;
}

const pick = (names) => names.find(familyPresent) || names[0];
export const FAMILIES = FAMILY_SLOTS.map(pick);

// Measured across the six on Windows, Calibri is the ONLY face forming
// f-ligatures at default settings (shaped_run.h: "Calibri turns 'office
// fluffy first' into 14 clusters where the others make 19"); on macOS Hoefler
// Text fuses all of ff, fi, fl, ffi, ffl. A ligature assertion against Arial
// would prove nothing.
export const LIGATURE_FAMILY = FAMILIES[0];
export const LIGATURE_SAMPLES = ['ffi', 'ffl', 'fi', 'fl', 'ff', 'office'];

// Pairs that kern NEGATIVELY in essentially every text face.
export const KERN_PAIRS = ['AV', 'AW', 'To', 'Yo', 'LT', 'P,', 'F.'];

// Arial's and Times New Roman's italics share their roman advances, so an
// italic assertion against them passes for an engine that ignores the flag.
// Georgia's and Cambria's (Palatino's) differ; those are the ones asserted on.
export const ITALIC_DIVERGENT = ['Georgia', FAMILIES[2]];

export const shapeState = {
    families: [],       // [{ family, present, width }]
    ligatures: [],
    kerning: [],
    spacing: null,
    prefix: null,
    styles: [],
    subpixel: null,
    cacheProbe: null,
    cache: { hits: 0, misses: 0 },
};

// --- reports -------------------------------------------------------------------

/**
 * Characters in vs glyphs out, per sample. `fused` counts clusters spanning
 * several bytes that produced exactly ONE glyph — a ligature by definition.
 * (A multi-byte cluster alone is weaker: a Devanagari cluster spans many
 * bytes and produces several glyphs.)
 */
export function ligatureReport(family) {
    return LIGATURE_SAMPLES.map((text) => {
        const r = shape(text, { family, size: 48 });
        const fused = r.clusters.filter((c) => (c.end - c.start) > 1 && c.glyphs === 1);
        return {
            family, text,
            chars: text.length,
            bytes: utf8Length(text),
            glyphs: r.glyphCount,
            clusters: r.clusters.length,
            width: r.width,
            ligated: r.glyphCount < utf8Length(text),
            fused: fused.length,
            spans: fused.map((c) => `${c.start}–${c.end}`).join(' '),
        };
    });
}

/** width("AV") vs width("A") + width("V"): only a kern table lookup makes a negative delta. */
export function kerningReport(family, size) {
    const o = { family, size: size || 64 };
    return KERN_PAIRS.map((pair) => {
        const joint = widthOf(pair, o);
        const apart = widthOf(pair[0], o) + widthOf(pair[1], o);
        const delta = joint - apart;
        return { family, pair, joint, apart, delta,
                 kerned: Math.abs(delta) > 1e-4, tightened: delta < -1e-4 };
    });
}

/**
 * A word measured per character and summed (naive) vs shaped once. The naive
 * number misses both the kerns and, in Calibri, the ligature. The cluster
 * advances must also re-sum to the run width exactly, or carets stop landing
 * where glyphs are drawn.
 */
export function prefixReport(word, family, size) {
    const opts = { family: family || LIGATURE_FAMILY, size: size || 48 };
    const r = shape(word, opts);
    let naive = 0;
    for (const ch of word) naive += widthOf(ch, opts);
    const clusterSum = r.clusters.reduce((a, c) => a + c.advance, 0);
    return {
        word, family: opts.family, size: opts.size,
        naive, shaped: r.width, clusterSum,
        clusterSumMatches: Math.abs(clusterSum - r.width) < 1e-3,
        error: naive - r.width,
        chars: [...word].length,
        clusters: r.clusters.length,
        glyphs: r.glyphCount,
    };
}

/**
 * letter-spacing inserts space BETWEEN characters; a ligature has fused them,
 * so non-zero letter-spacing must turn ligatures off (TextShapingEngine takes
 * disableLigatures = letterSpacing != 0). The space lands in n-1 gaps with no
 * trailing gap; word-spacing lands on U+0020 clusters only.
 */
export function spacingReport(family) {
    const base = { family: family || LIGATURE_FAMILY, size: 48 };
    const plain = shape('ffi', base);
    const spaced = shape('ffi', Object.assign({ letterSpacing: 2 }, base));

    // No ligature in the gap word, so the cluster count is stable across the
    // two measurements and the delta is purely the inserted space.
    const gapWord = 'nnnn', amount = 5;
    const g0 = shape(gapWord, base);
    const g1 = shape(gapWord, Object.assign({ letterSpacing: amount }, base));
    const gaps = g0.clusters.length - 1;

    const wsWord = 'a b c';
    const w0 = shape(wsWord, base);
    const w1 = shape(wsWord, Object.assign({ wordSpacing: 7 }, base));
    const spaceCount = (wsWord.match(/ /g) || []).length;

    return {
        family: base.family,
        plainGlyphs: plain.glyphCount, plainClusters: plain.clusters.length,
        spacedGlyphs: spaced.glyphCount, spacedClusters: spaced.clusters.length,
        suppressed: spaced.glyphCount > plain.glyphCount,
        gapWord, gaps, amount,
        gapDelta: g1.width - g0.width,
        gapExact: Math.abs((g1.width - g0.width) - gaps * amount) < 1e-3,
        wsWord, spaceCount,
        wsDelta: w1.width - w0.width,
        wsExact: Math.abs((w1.width - w0.width) - spaceCount * 7) < 1e-3,
        spacedX: spaced.clusters.map((c) => c.x),
    };
}

/** size, weight and italic are all in the shaping key: each yields a genuinely different run. */
export function styleReport(word) {
    const w = word || 'Hello world';
    return FAMILIES.map((family) => {
        const base = { family, size: 48 };
        const regular = widthOf(w, base);
        const bold = widthOf(w, Object.assign({ weight: 700 }, base));
        const italic = widthOf(w, Object.assign({ italic: true }, base));
        const half = widthOf(w, { family, size: 24 });
        return {
            family, regular, bold, italic, half,
            boldWider: bold > regular,
            italicDiffers: Math.abs(italic - regular) > 1e-3,
            // Linear in size, hinting aside.
            scales: Math.abs(half * 2 - regular) < regular * 0.02,
        };
    });
}

/**
 * Advances are on Skia's 1/64 px grid, not integers. Rounding per character
 * accumulates: over one line it moves where the text ends.
 */
export function subpixelReport(family) {
    const opts = { family: family || 'Arial', size: 17 };   // odd size on purpose
    const word = 'The quick brown fox jumps over the lazy dog';
    const r = shape(word, opts);
    const fractional = r.clusters.filter((c) => Math.abs(c.advance - Math.round(c.advance)) > 1e-4).length;
    const roundedSum = r.clusters.reduce((a, c) => a + Math.round(c.advance), 0);
    return {
        family: opts.family, size: opts.size, word,
        clusters: r.clusters.length, fractional,
        width: r.width, roundedSum,
        drift: roundedSum - r.width,
        driftMatters: Math.abs(roundedSum - r.width) > 1,
    };
}

/**
 * bro.text.cacheStats(): the same (text, family, size, weight, italic,
 * direction, ligature toggle) tuple twice must hit; changing any must miss.
 * Changing only the letter-spacing AMOUNT (staying non-zero) must still hit,
 * because spacing repositions output and is absent from the key.
 */
export function cacheProbe() {
    const uniq = 'cache-probe-' + Math.random().toString(36).slice(2);
    const opts = { family: 'Arial', size: 31 };
    const a = bro.text.cacheStats();
    shape(uniq, opts);
    const b = bro.text.cacheStats();
    shape(uniq, opts);
    const c = bro.text.cacheStats();
    shape(uniq, { family: 'Arial', size: 32 });
    const d = bro.text.cacheStats();
    shape(uniq, Object.assign({ letterSpacing: 1 }, opts));
    const e = bro.text.cacheStats();
    shape(uniq, Object.assign({ letterSpacing: 9 }, opts));
    const f = bro.text.cacheStats();
    return {
        coldMiss: b.misses > a.misses,
        warmHit: c.hits > b.hits && c.misses === b.misses,
        sizeMiss: d.misses > c.misses,
        spacingAmountHit: f.hits > e.hits && f.misses === e.misses,
        stats: f,
    };
}

/** Which families resolved to a real face (familyPresent), with a probe width. */
export function familyReport() {
    return FAMILIES.map((family) => ({
        family,
        width: widthOf('Hamburgefonstiv', { family, size: 32 }),
        present: familyPresent(family),
    }));
}

// --- panel ---------------------------------------------------------------------

let ui = null;

export function initShaping() {
    const $ = (id) => document.getElementById(id);
    ui = {
        families: $('shapeFamilies'),
        lig: table($('shapeLigatures'), ['text', 'chars', 'bytes', 'glyphs', 'clusters', 'fused span', 'verdict'],
            LIGATURE_SAMPLES.length),
        kern: table($('shapeKerning'), ['pair', 'width(pair)', 'w(a)+w(b)', 'delta', 'verdict'], KERN_PAIRS.length),
        styles: table($('shapeStyles'), ['family', '48px', 'bold', 'italic', '24px×2', 'bold≠reg', 'italic≠reg'],
            FAMILIES.length),
        spacing: $('shapeSpacing'), prefix: $('shapePrefix'), subpixel: $('shapeSubpixel'), cache: $('shapeCache'),
    };
    shapeState.families = familyReport();
    for (const f of shapeState.families) {
        ui.families.appendChild(h('span.famtag.' + (f.present ? 'ok' : 'warn'), {
            title: f.present ? 'a distinct face was found'
                             : 'measures the same as the fallback face: not installed, or it is the fallback',
        }, f.family + ' ' + n2(f.width) + (f.present ? '' : ' = fallback')));
    }
    refreshShaping();
}

export function refreshShaping(family) {
    const fam = family || LIGATURE_FAMILY;

    shapeState.ligatures = ligatureReport(fam);
    shapeState.ligatures.forEach((r, i) => {
        const c = ui.lig[i];
        [r.text, r.chars, r.bytes, r.glyphs, r.clusters, r.spans || '—']
            .forEach((v, k) => { c[k].textContent = v; });
        verdict(c[6], r.ligated ? true : null, r.ligated ? `ligated (${r.bytes}→${r.glyphs})` : 'no ligature');
    });

    shapeState.kerning = kerningReport(fam);
    shapeState.kerning.forEach((r, i) => {
        const c = ui.kern[i];
        c[0].textContent = r.pair;
        c[1].textContent = n2(r.joint);
        c[2].textContent = n2(r.apart);
        c[3].textContent = (r.delta >= 0 ? '+' : '') + n2(r.delta);
        verdict(c[4], r.kerned ? true : null, r.tightened ? 'kerned tighter' : r.kerned ? 'kerned' : 'no kern pair');
    });

    shapeState.styles = styleReport();
    shapeState.styles.forEach((r, i) => {
        const c = ui.styles[i];
        c[0].textContent = r.family;
        c[1].textContent = n2(r.regular);
        c[2].textContent = n2(r.bold);
        c[3].textContent = n2(r.italic);
        c[4].textContent = n2(r.half * 2);
        verdict(c[5], r.boldWider, r.boldWider ? 'yes' : 'no');
        verdict(c[6], r.italicDiffers ? true : null, r.italicDiffers ? 'yes' : 'same advances');
    });

    const sp = shapeState.spacing = spacingReport(fam);
    result(ui.spacing, sp.suppressed && sp.gapExact && sp.wsExact,
        `"ffi" in ${sp.family}: ${sp.plainGlyphs} glyph(s) normally, ${sp.spacedGlyphs} with letter-spacing:2 — ` +
        `ligature ${sp.suppressed ? 'SUPPRESSED as it must be' : 'NOT suppressed (bug)'}. ` +
        `letter-spacing ${sp.amount}px over "${sp.gapWord}" added ${n2(sp.gapDelta)}px = ${sp.gaps} gaps × ` +
        `${sp.amount} (n−1, no trailing gap): ${sp.gapExact ? 'exact' : 'MISMATCH'}. ` +
        `word-spacing 7px over "${sp.wsWord}" added ${n2(sp.wsDelta)}px across ${sp.spaceCount} space(s): ` +
        `${sp.wsExact ? 'exact' : 'MISMATCH'}.`);

    const pr = shapeState.prefix = prefixReport('office', fam);
    result(ui.prefix, pr.clusterSumMatches && Math.abs(pr.error) > 0.5,
        `"${pr.word}" in ${pr.family} ${pr.size}px — measured per character and summed: ${n2(pr.naive)}px. ` +
        `Shaped as one run: ${n2(pr.shaped)}px. Per-character measurement is off by ${n2(pr.error)}px ` +
        `(${pr.chars} chars → ${pr.clusters} clusters → ${pr.glyphs} glyphs). ` +
        `Cluster advances re-sum to the run width: ${pr.clusterSumMatches ? 'yes' : 'NO'}.`);

    const sub = shapeState.subpixel = subpixelReport();
    result(ui.subpixel, sub.fractional > 0 && sub.driftMatters,
        `${sub.clusters} clusters at ${sub.size}px, ${sub.fractional} with fractional advances. ` +
        `Run width ${n2(sub.width)}px; rounding every advance to an integer gives ${n2(sub.roundedSum)}px — ` +
        `${n2(Math.abs(sub.drift))}px of drift over one line.`);

    const cp = shapeState.cacheProbe = cacheProbe();
    shapeState.cache = cp.stats;
    result(ui.cache, cp.coldMiss && cp.warmHit && cp.sizeMiss && cp.spacingAmountHit,
        `cold shape misses: ${cp.coldMiss ? 'yes' : 'NO'} · identical re-shape hits: ${cp.warmHit ? 'yes' : 'NO'} · ` +
        `size change misses: ${cp.sizeMiss ? 'yes' : 'NO'} · letter-spacing AMOUNT change still hits ` +
        `(not in the key): ${cp.spacingAmountHit ? 'yes' : 'NO'} · totals ${cp.stats.hits} hits / ${cp.stats.misses} misses`);
}
