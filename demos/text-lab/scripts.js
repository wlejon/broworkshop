// scripts.js — real strings in scripts that a 1:1 codepoint→glyph mapper
// cannot render at all.
//
// Each script here is chosen because it breaks a DIFFERENT assumption that
// Latin text lets you get away with:
//
//   ARABIC      contextual forms. A letter's glyph depends on its neighbours
//               (isolated / initial / medial / final), so the same code point
//               has four shapes and four advances. Plus lam-alef, a MANDATORY
//               ligature — Arabic is simply wrong without it, it is not a
//               typographic nicety.
//   HEBREW      RTL with optional combining points (nikud) that fuse into the
//               base letter's cluster.
//   DEVANAGARI  reordering INSIDE a cluster (the i-matra is stored after its
//               consonant and drawn before it) and conjuncts (consonant +
//               virama + consonant → one fused glyph). Cluster count is less
//               than code-point count and glyph count can exceed cluster count
//               at the same time.
//   THAI        marks with ZERO advance stacked above and below the base.
//               Width is not a function of character count in any sense.
//   CJK / HANGUL full-width advances and font fallback out of a Latin family.
//
// FONT COVERAGE IS PART OF THE TEST. There is no font-enumeration API in bro,
// so "does this machine have a face for Devanagari?" is answered by measuring:
// a run that fell back to .notdef boxes has a very different signature from a
// run that shaped. The report says which scripts genuinely rendered rather
// than skipping the ones that did not — a missing font is a finding.

import { el, n2, buildTable, verdict, utf8Length, codePoints } from '/app/textutil.js';
import { shape, widthOf } from '/app/shaping.js';

export const SCRIPT_SAMPLES = [
    {
        id: 'latin', name: 'Latin', dir: 'ltr',
        text: 'The quick brown fox',
        gloss: 'baseline — 1 code point, 1 cluster, 1 glyph throughout',
    },
    {
        id: 'arabic', name: 'Arabic', dir: 'rtl',
        text: 'صباح الخير',
        gloss: 'good morning — every letter takes a contextual form',
    },
    {
        id: 'hebrew', name: 'Hebrew', dir: 'rtl',
        text: 'שלום עולם',
        gloss: 'hello world — RTL, no contextual forms',
    },
    {
        id: 'hebrewNikud', name: 'Hebrew + nikud', dir: 'rtl',
        text: 'בְּרֵאשִׁית',
        gloss: 'pointed text — vowel marks fuse into the letter clusters',
    },
    {
        id: 'devanagari', name: 'Devanagari', dir: 'ltr',
        text: 'हिन्दी भाषा',
        gloss: 'the Hindi language — matra reordering and a conjunct',
    },
    {
        id: 'thai', name: 'Thai', dir: 'ltr',
        text: 'ภาษาไทยเป็นภาษา',
        gloss: 'Thai is a language — zero-advance marks above and below',
    },
    {
        id: 'cjk', name: 'Han', dir: 'ltr',
        text: '中文字型測試',
        gloss: 'fallback out of a Latin family, full-width advances',
    },
    {
        id: 'hangul', name: 'Hangul', dir: 'ltr',
        text: '한국어 텍스트',
        gloss: 'precomposed syllables',
    },
];

export const scriptState = {
    rows: [],
    coverage: [],
    joining: null,
    ligature: null,
    devanagari: null,
    thai: null,
    normalization: null,
};

// ── Font coverage ───────────────────────────────────────────────────────────

/**
 * Did this string actually get glyphs, or did it get .notdef boxes?
 *
 * bro.text.shape() does not expose glyph IDs (deliberately — shaped_run.h says
 * they must not escape bro::render), so ".notdef" is not directly observable.
 * What IS observable is the signature of a tofu run: every cluster gets the
 * SAME advance, because .notdef is one glyph with one width. Real text in any
 * proportional script has varying advances.
 *
 * That heuristic has one honest false positive — a monospaced or uniformly
 * full-width script such as Han — so the check also compares against the width
 * the engine gives a code point from a plane it certainly has no font for
 * (U+E000, a Private Use Area character). If the sample's advances match the
 * PUA advance, it is tofu.
 */
export function coverageOf(text, family, size) {
    const opts = { family: family || 'Arial', size: size || 40 };
    const r = shape(text, opts);
    const advances = r.clusters.map((c) => c.advance).filter((a) => a > 0);
    const distinct = new Set(advances.map((a) => Math.round(a * 64)));
    // The engine's own "I have nothing for this" width, measured not assumed.
    const tofuWidth = widthOf('', opts);
    const looksTofu = advances.length > 0 &&
        advances.every((a) => Math.abs(a - tofuWidth) < 0.01);
    return {
        text, family: opts.family,
        clusters: r.clusters.length,
        glyphs: r.glyphCount,
        codePoints: codePoints(text).length,
        bytes: utf8Length(text),
        width: r.width,
        distinctAdvances: distinct.size,
        tofuWidth,
        rendered: !looksTofu && r.glyphCount > 0,
        looksTofu,
    };
}

// ── Arabic contextual joining ───────────────────────────────────────────────

/**
 * The same letter in four joining positions.
 *
 * Position is forced with U+0640 ARABIC TATWEEL, a joining-only "letter" whose
 * whole purpose is to make a neighbour join. So:
 *   ب        → isolated
 *   بـ       → initial  (something follows)
 *   ـبـ      → medial   (something on both sides)
 *   ـب       → final    (something precedes)
 *
 * WHAT WE CAN AND CANNOT ASSERT: the brief asks for "different glyph ids", but
 * bro.text.shape() exports `glyphs` (a COUNT) and never glyph ids — see the
 * ShapedRun header, which states that glyph ids are implementation detail of
 * bro::render and must not escape it. So the observable proxy is the ADVANCE
 * of the letter's own cluster, which differs between forms because the forms
 * are different outlines. That is a strictly weaker signal than a glyph id and
 * the panel says so; a joining-form check that a font happened to give equal
 * advances to would be invisible. See the report for the API gap.
 */
export const TATWEEL = 'ـ';

export function joiningReport(letter, family) {
    const L = letter || 'ب';   // ARABIC LETTER BEH
    const opts = { family: family || 'Arial', size: 40 };
    const forms = [
        { form: 'isolated', text: L, letterByte: 0 },
        { form: 'initial', text: L + TATWEEL, letterByte: 0 },
        { form: 'medial', text: TATWEEL + L + TATWEEL, letterByte: 2 },
        { form: 'final', text: TATWEEL + L, letterByte: 2 },
    ];
    const rows = forms.map((f) => {
        const r = shape(f.text, opts);
        // The letter's own cluster, found by its byte offset in the probe
        // string — NOT by visual position, since the run is RTL and the
        // cluster list is in visual order.
        const cl = r.clusters.find((c) => c.start === f.letterByte);
        return {
            form: f.form, text: f.text,
            advance: cl ? cl.advance : 0,
            rtl: cl ? cl.rtl : false,
            totalWidth: r.width,
            glyphs: r.glyphCount,
        };
    });
    const iso = rows[0].advance;
    const init = rows[1].advance;
    const med = rows[2].advance;
    const fin = rows[3].advance;
    return {
        letter: L, family: opts.family, rows,
        // Joined forms are narrower than the isolated form: the isolated glyph
        // carries the full bowl plus both side bearings, a joined one does not.
        initialDiffers: Math.abs(init - iso) > 0.01,
        medialDiffers: Math.abs(med - iso) > 0.01,
        finalDiffers: Math.abs(fin - med) > 0.01,
        joinedNarrower: init < iso && med < iso,
        // How many genuinely distinct advances the four forms produced. Arial
        // gives 2 (initial==medial, isolated==final); a fuller Arabic face
        // gives more. Reported, not asserted at a specific number.
        distinctForms: new Set([iso, init, med, fin].map((a) => Math.round(a * 64))).size,
        advances: { isolated: iso, initial: init, medial: med, final: fin },
        // Everything Arabic must be flagged RTL by the shaper.
        allRtl: rows.every((r) => r.rtl),
    };
}

/**
 * Lam-alef: ل + ا. This is a MANDATORY ligature in Arabic — the two letters
 * have no legal separate rendering — so it is the strongest ligature test
 * available anywhere in this lab. Two code points, four UTF-8 bytes, ONE
 * cluster, ONE glyph, and a width strictly less than the two letters apart.
 */
export function lamAlefReport(family) {
    const opts = { family: family || 'Arial', size: 40 };
    const lam = 'ل';
    const alef = 'ا';
    const joint = shape(lam + alef, opts);
    const apartW = widthOf(lam, opts) + widthOf(alef, opts);
    return {
        family: opts.family,
        text: lam + alef,
        bytes: utf8Length(lam + alef),
        clusters: joint.clusters.length,
        glyphs: joint.glyphCount,
        width: joint.width,
        apart: apartW,
        // The three independent facts that together mean "ligature".
        oneCluster: joint.clusters.length === 1,
        oneGlyph: joint.glyphCount === 1,
        spansAllBytes: joint.clusters.length === 1 &&
            joint.clusters[0].start === 0 && joint.clusters[0].end === utf8Length(lam + alef),
        narrower: joint.width < apartW - 0.01,
        rtl: joint.clusters.length > 0 && joint.clusters[0].rtl,
    };
}

// ── Devanagari ──────────────────────────────────────────────────────────────

/**
 * Two things at once, both impossible without a shaper:
 *
 *   REORDERING  क + ि (ka + i-matra) is stored in that order and DRAWN in the
 *               other — the vowel sign appears to the LEFT of the consonant.
 *               From JS the visible consequence is that both code points fuse
 *               into ONE cluster of TWO glyphs: the shaper refuses to let a
 *               caret sit between them, because there is no "between" on
 *               screen.
 *   CONJUNCT    क + ् + ष (ka + virama + ssa) → क्ष, three code points and
 *               NINE UTF-8 bytes collapsing to one cluster and one glyph.
 *
 * Note the pair of them makes "glyphs < characters" and "glyphs > clusters"
 * both true in the same script, which is why the ligature test in shaping.js
 * is written against glyph COUNT per cluster rather than against cluster size.
 */
export function devanagariReport(family) {
    const opts = { family: family || 'Arial', size: 40 };
    const ka = 'क';
    const iMatra = 'ि';
    const virama = '्';
    const ssa = 'ष';

    const ki = shape(ka + iMatra, opts);
    const ksha = shape(ka + virama + ssa, opts);
    const word = shape('हिन्दी', opts);

    return {
        family: opts.family,
        ki: {
            text: ka + iMatra,
            codePoints: 2, bytes: utf8Length(ka + iMatra),
            clusters: ki.clusters.length,
            glyphs: ki.glyphCount,
            // One cluster from two code points, made of MORE than one glyph:
            // fused for caret purposes, not fused into a single outline.
            fusedCluster: ki.clusters.length === 1,
            multiGlyphCluster: ki.clusters.length === 1 && ki.clusters[0].glyphs > 1,
            spansBothBytes: ki.clusters.length === 1 && ki.clusters[0].end === 6,
        },
        ksha: {
            text: ka + virama + ssa,
            codePoints: 3, bytes: utf8Length(ka + virama + ssa),
            clusters: ksha.clusters.length,
            glyphs: ksha.glyphCount,
            oneCluster: ksha.clusters.length === 1,
            oneGlyph: ksha.glyphCount === 1,
            width: ksha.width,
            // A true conjunct is narrower than the two consonants side by side.
            narrower: ksha.width < widthOf(ka, opts) + widthOf(ssa, opts) - 0.01,
        },
        word: {
            text: 'हिन्दी',
            codePoints: codePoints('हिन्दी').length,
            bytes: utf8Length('हिन्दी'),
            clusters: word.clusters.length,
            glyphs: word.glyphCount,
            // 6 code points → fewer clusters. Caret stepping is by cluster, so
            // this word has fewer caret positions than it has characters.
            fewerClustersThanCodePoints:
                word.clusters.length < codePoints('हिन्दी').length,
            clusterSpans: word.clusters.map((c) => `${c.start}–${c.end}(${c.glyphs}g)`),
        },
    };
}

// ── Thai: zero-advance marks ────────────────────────────────────────────────

/**
 * ก้ is KO KAI plus MAI THO, a tone mark drawn ABOVE the consonant. It occupies
 * no horizontal space, so:
 *
 *     width("ก้") === width("ก")
 *
 * exactly, and the mark's own cluster has advance 0. A per-character width
 * model gets this wrong by exactly one glyph advance, and the error compounds
 * — Thai stacks up to two marks on one base.
 *
 * The mark is a SEPARATE cluster here rather than being folded into the base's,
 * which is worth stating: a caret can therefore sit between the consonant and
 * its tone mark, at the same x. That is a consequence of stepping by cluster
 * rather than by grapheme, and shaped_run.h's byteOffsetToX comment explains
 * why grapheme stepping is not available in this build (no UAX #29 data).
 */
export function thaiReport(family) {
    const opts = { family: family || 'Arial', size: 40 };
    const base = 'ก';        // THAI CHARACTER KO KAI
    const tone = '้';        // THAI CHARACTER MAI THO
    const sara = 'ั';        // THAI CHARACTER MAI HAN AKAT (vowel above)

    const plain = shape(base, opts);
    const marked = shape(base + tone, opts);
    const twoMarks = shape(base + sara + tone, opts);
    const zero = marked.clusters.filter((c) => c.advance === 0);

    return {
        family: opts.family,
        baseWidth: plain.width,
        markedWidth: marked.width,
        twoMarksWidth: twoMarks.width,
        markedClusters: marked.clusters.length,
        markedGlyphs: marked.glyphCount,
        zeroAdvanceClusters: zero.length,
        // The three facts, each independently checkable.
        sameWidth: Math.abs(marked.width - plain.width) < 0.01,
        stillSameWithTwo: Math.abs(twoMarks.width - plain.width) < 0.01,
        hasZeroAdvance: zero.length > 0,
        extraGlyph: marked.glyphCount > plain.glyphCount,
    };
}

// ── Normalisation forms shape identically ───────────────────────────────────

/**
 * "á" written two ways:
 *   NFC  U+00E1                     (1 code point, 2 UTF-8 bytes)
 *   NFD  U+0061 U+0301              (2 code points, 3 UTF-8 bytes)
 *
 * These are canonically equivalent and MUST render identically. HarfBuzz
 * composes the decomposed form during shaping, so both come out as one cluster
 * of one glyph with the same advance — despite having different byte lengths
 * and different cluster byte ranges. This is the cleanest possible proof that
 * the byte domain and the glyph domain are genuinely decoupled: same picture,
 * different offsets.
 */
export function normalizationReport(family) {
    const opts = { family: family || 'Arial', size: 40 };
    const nfc = 'á';
    const nfd = 'á';
    const a = shape(nfc, opts);
    const b = shape(nfd, opts);
    return {
        family: opts.family,
        nfcBytes: utf8Length(nfc), nfdBytes: utf8Length(nfd),
        nfcCodePoints: 1, nfdCodePoints: 2,
        nfcClusters: a.clusters.length, nfdClusters: b.clusters.length,
        nfcGlyphs: a.glyphCount, nfdGlyphs: b.glyphCount,
        nfcWidth: a.width, nfdWidth: b.width,
        sameWidth: Math.abs(a.width - b.width) < 0.01,
        bothOneCluster: a.clusters.length === 1 && b.clusters.length === 1,
        bothOneGlyph: a.glyphCount === 1 && b.glyphCount === 1,
        // The decomposed form's single cluster must span BOTH code points —
        // no caret between a letter and its accent.
        nfdClusterSpansAll: b.clusters.length === 1 && b.clusters[0].end === utf8Length(nfd),
    };
}

// ── Panel ───────────────────────────────────────────────────────────────────

let scriptCells = null;
let joinCells = null;
let ligHost = null;
let devHost = null;
let thaiHost = null;
let normHost = null;

export function initScripts() {
    // Live specimens, each in a container with the right `dir` so layout gets
    // the base direction right as well as the shaper.
    const spec = document.getElementById('scriptSpecimens');
    for (const s of SCRIPT_SAMPLES) {
        const box = el('div', 'specimen');
        const head = el('div', 'spec-head');
        head.appendChild(el('span', 'spec-name', s.name));
        head.appendChild(el('span', 'spec-gloss', s.gloss));
        box.appendChild(head);
        const line = el('div', 'spec-text');
        line.setAttribute('dir', s.dir);
        line.textContent = s.text;
        box.appendChild(line);
        spec.appendChild(box);
    }

    scriptCells = buildTable(document.getElementById('scriptCoverage'),
        ['script', 'code pts', 'utf8 bytes', 'clusters', 'glyphs', 'width', 'distinct adv', 'coverage'],
        SCRIPT_SAMPLES.length).cells;

    joinCells = buildTable(document.getElementById('scriptJoining'),
        ['position', 'probe', 'letter advance', 'rtl', 'differs from isolated'],
        4).cells;

    ligHost = document.getElementById('scriptLamAlef');
    devHost = document.getElementById('scriptDevanagari');
    thaiHost = document.getElementById('scriptThai');
    normHost = document.getElementById('scriptNormalization');

    refreshScripts();
}

export function refreshScripts() {
    scriptState.coverage = SCRIPT_SAMPLES.map((s) => {
        const c = coverageOf(s.text);
        return Object.assign({ id: s.id, name: s.name }, c);
    });
    scriptState.coverage.forEach((c, i) => {
        const row = scriptCells[i];
        row[0].textContent = c.name;
        row[1].textContent = c.codePoints;
        row[2].textContent = c.bytes;
        row[3].textContent = c.clusters;
        row[4].textContent = c.glyphs;
        row[5].textContent = n2(c.width);
        row[6].textContent = c.distinctAdvances;
        verdict(row[7], c.rendered, c.rendered ? 'shaped' : 'TOFU — no font on this machine');
    });

    scriptState.joining = joiningReport();
    const j = scriptState.joining;
    j.rows.forEach((r, i) => {
        const row = joinCells[i];
        row[0].textContent = r.form;
        row[1].textContent = r.text;
        row[2].textContent = n2(r.advance);
        row[3].textContent = r.rtl ? 'yes' : 'NO';
        const differs = i === 0 ? '—' : (Math.abs(r.advance - j.advances.isolated) > 0.01 ? 'yes' : 'same');
        verdict(row[4], i === 0 || differs === 'yes', differs);
        if (i === 0) row[4].className = 'neutral';
    });

    const lam = lamAlefReport();
    scriptState.ligature = lam;
    ligHost.textContent =
        `لا (lam+alef) — ${lam.bytes} UTF-8 bytes, ${lam.clusters} cluster, ${lam.glyphs} glyph, ` +
        `width ${n2(lam.width)} vs ${n2(lam.apart)} for the two letters shaped apart. ` +
        `Mandatory ligature formed: ${lam.oneGlyph && lam.narrower ? 'YES' : 'NO'}. ` +
        `Cluster spans all ${lam.bytes} bytes: ${lam.spansAllBytes ? 'yes' : 'NO'} · rtl flag: ${lam.rtl ? 'yes' : 'NO'}`;
    ligHost.className = 'result ' + (lam.oneGlyph && lam.narrower && lam.spansAllBytes ? 'ok' : 'bad');

    const dev = devanagariReport();
    scriptState.devanagari = dev;
    devHost.textContent =
        `कि (ka + i-matra): 2 code points / ${dev.ki.bytes} bytes → ${dev.ki.clusters} cluster ` +
        `of ${dev.ki.glyphs} glyphs — the matra reordered, so no caret may sit between them. ` +
        `क्ष (ka+virama+ssa): 3 code points / ${dev.ksha.bytes} bytes → ` +
        `${dev.ksha.clusters} cluster, ${dev.ksha.glyphs} glyph, and narrower than the two ` +
        `consonants apart: ${dev.ksha.narrower ? 'yes' : 'NO'}. ` +
        `हिन्दी: ${dev.word.codePoints} code points → ${dev.word.clusters} clusters ` +
        `[${dev.word.clusterSpans.join(' ')}] — fewer caret stops than characters.`;
    devHost.className = 'result ' +
        (dev.ki.multiGlyphCluster && dev.ksha.oneGlyph && dev.word.fewerClustersThanCodePoints ? 'ok' : 'bad');

    const thai = thaiReport();
    scriptState.thai = thai;
    thaiHost.textContent =
        `ก = ${n2(thai.baseWidth)} · ก้ (with tone mark) = ${n2(thai.markedWidth)} · ` +
        `กั้ (two marks) = ${n2(thai.twoMarksWidth)}. Adding marks changed the width: ` +
        `${thai.sameWidth && thai.stillSameWithTwo ? 'NOT AT ALL, as required' : 'IT DID — bug'}. ` +
        `${thai.zeroAdvanceClusters} zero-advance cluster(s), and the mark did add a glyph: ` +
        `${thai.extraGlyph ? 'yes' : 'NO'}.`;
    thaiHost.className = 'result ' + (thai.sameWidth && thai.hasZeroAdvance ? 'ok' : 'bad');

    const norm = normalizationReport();
    scriptState.normalization = norm;
    normHost.textContent =
        `NFC "á" = U+00E1: ${norm.nfcBytes} bytes, ${norm.nfcClusters} cluster, ${norm.nfcGlyphs} glyph, ${n2(norm.nfcWidth)}px. ` +
        `NFD "á" = U+0061 U+0301: ${norm.nfdBytes} bytes, ${norm.nfdClusters} cluster, ${norm.nfdGlyphs} glyph, ${n2(norm.nfdWidth)}px. ` +
        `Different byte lengths, identical rendering: ${norm.sameWidth && norm.bothOneGlyph ? 'yes' : 'NO'}. ` +
        `The decomposed form's cluster covers both code points (no caret inside): ` +
        `${norm.nfdClusterSpansAll ? 'yes' : 'NO'}.`;
    normHost.className = 'result ' +
        (norm.sameWidth && norm.bothOneGlyph && norm.nfdClusterSpansAll ? 'ok' : 'bad');
}
