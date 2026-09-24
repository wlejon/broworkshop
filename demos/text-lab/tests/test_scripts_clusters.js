// test_scripts_clusters.js — Text Lab, part 2: complex scripts (Arabic
// joining + lam-alef, Devanagari, Thai, NFC/NFD), then the cluster map,
// astral text and caret stepping.
//
// Run: scripts/validate.sh demos/text-lab
//
// Arabic joining is asserted as "the same letter yields a different advance in
// a different position", because glyph ids do not escape bro::render (see the
// limitation list printed by test_editing_app.js). Astral text is asserted as
// "one cluster, one caret stop, and stepping never lands between the
// surrogates".

import { check as assert, test, done, frames, q } from '/lib/kit/test.js';
import { shape, LIGATURE_FAMILY } from '/app/shaping.js';
import {
    scriptState, joiningReport, lamAlefReport, devanagariReport, thaiReport, normalizationReport, SCRIPT_SAMPLES,
} from '/app/scripts.js';
import {
    clusterState, clusterMap, offsetProbe, astralReport, steppingReport, alignmentCheck,
    stepForward, stepBackward, caretStops, selectSample, CLUSTER_SAMPLES,
} from '/app/clusters.js';

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-4 : eps);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

resize(1600, 1000);
frames(4);

// =============================================================================
// 3. COMPLEX SCRIPTS
// =============================================================================

test('scripts: font coverage is a finding, not a skip', () => {
    const rendered = scriptState.coverage.filter((c) => c.rendered);
    const tofu = scriptState.coverage.filter((c) => !c.rendered);
    assert(rendered.length === SCRIPT_SAMPLES.length,
        'every probed script found a real face on this machine. Tofu: ' + (tofu.map((t) => t.name).join(', ') || 'none'));
    for (const c of scriptState.coverage) {
        assert(c.glyphs >= c.clusters && c.width > 0,
            `${c.name}: ${c.clusters} clusters, ${c.glyphs} glyphs, width ${c.width.toFixed(2)}`);
    }
});

// bro.text.shape() exports a glyph COUNT and deliberately never glyph ids
// (shaped_run.h: they "MUST NOT escape" bro::render). The advance of the
// letter's own cluster is the available proxy.
test('scripts: Arabic contextual joining', () => {
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

    const word = shape('صباح الخير', { family: 'Arial', size: 40 });
    assert(word.clusters.every((c) => c.rtl || c.advance === 0), 'every cluster in an Arabic word is rtl');
    assert(word.clusters[0].start > word.clusters[word.clusters.length - 1].start,
        'and the cluster list runs from the HIGHEST byte offset to the lowest — visual order for an RTL run');
});

test('scripts: Arabic lam-alef, a mandatory ligature', () => {
    const l = lamAlefReport();
    assert(l.bytes === 4, 'لا is 2 code points / 4 UTF-8 bytes');
    assert(l.oneGlyph,
        `and shapes to ONE glyph, got ${l.glyphs}. This is a mandatory Arabic ligature — ` +
        'the two letters have no legal separate rendering');
    assert(l.oneCluster && l.spansAllBytes, `in one cluster spanning all 4 bytes, got ${l.clusters} cluster(s)`);
    assert(l.narrower,
        `and strictly narrower than the two letters shaped apart: ${l.width.toFixed(3)} < ${l.apart.toFixed(3)}`);
    assert(l.rtl, 'flagged rtl');
});

test('scripts: Devanagari reordering and conjuncts', () => {
    const d = devanagariReport();
    assert(d.ki.fusedCluster,
        'क + ि (consonant + i-matra) fuses into ONE cluster — the matra is stored after ' +
        'the consonant and drawn BEFORE it, so there is no "between" for a caret to sit in');
    assert(d.ki.multiGlyphCluster,
        `and that one cluster is made of ${d.ki.glyphs} glyphs — fused for caret purposes ` +
        'without being fused into a single outline');
    assert(d.ki.spansBothBytes, 'and it spans both code points (6 bytes)');
    assert(d.ksha.oneCluster && d.ksha.oneGlyph,
        `क् + ष (ka + virama + ssa) → one cluster of one glyph from ${d.ksha.bytes} bytes: a conjunct. ` +
        `Got ${d.ksha.clusters} cluster(s), ${d.ksha.glyphs} glyph(s)`);
    assert(d.ksha.narrower,
        'and it is narrower than the two consonants side by side — a real conjunct outline, not two glyphs abutted');
    assert(d.word.fewerClustersThanCodePoints,
        `हिन्दी: ${d.word.codePoints} code points collapse to ${d.word.clusters} clusters — ` +
        'the word has fewer caret stops than it has characters');
    assert(d.word.glyphs > d.word.clusters,
        `and more glyphs (${d.word.glyphs}) than clusters (${d.word.clusters}) at the same time`);
});

test('scripts: Thai zero-advance marks', () => {
    const t = thaiReport();
    assert(t.sameWidth,
        `adding a tone mark above ก changed the width by nothing at all: ` +
        `${t.baseWidth.toFixed(4)} → ${t.markedWidth.toFixed(4)}. A per-character width model ` +
        'gets this wrong by exactly one glyph advance');
    assert(t.stillSameWithTwo, `and two stacked marks still change nothing: ${t.twoMarksWidth.toFixed(4)}`);
    assert(t.hasZeroAdvance, `${t.zeroAdvanceClusters} cluster(s) have advance exactly 0`);
    assert(t.extraGlyph,
        `while the glyph count DID rise (${t.markedGlyphs} vs ${t.markedGlyphs - 1}) — the mark is ` +
        'drawn, it just occupies no horizontal space');
});

test('scripts: canonical equivalence', () => {
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
});

test('scripts: one specimen per sample on screen', () => {
    const specs = document.querySelectorAll('#scriptSpecimens .specimen');
    assert(specs.length === SCRIPT_SAMPLES.length, `${SCRIPT_SAMPLES.length} specimens, got ${specs.length}`);
});

// =============================================================================
// 4. CLUSTER MAP, ASTRAL TEXT, CARET STEPPING
// =============================================================================

test('clusters: the cluster map is a total, gap-free tiling', () => {
    for (const s of CLUSTER_SAMPLES) {
        const m = clusterMap(s.text, { family: s.family, size: s.size });
        assert(m.tiles,
            `"${s.text}" (${s.family}): clusters tile bytes [0,${m.bytes}) with no gaps or overlaps — ` +
            'without this some byte offset has no cluster and a caret there has no geometry');
        assert(near(m.advanceSum, m.width, 1e-3),
            `"${s.text}": cluster advances re-sum to the run width (${m.advanceSum.toFixed(4)} vs ${m.width.toFixed(4)})`);
        assert(m.monotonic, `"${s.text}": pen x is non-decreasing across the visual cluster list`);
        assert(m.clusters.every((c) => c.byteEnd > c.byteStart), `"${s.text}": no zero-byte clusters`);
    }
    assert(clusterMap('العربية', { family: 'Arial', size: 64 }).reordered,
        'the Arabic sample\'s visual order differs from its logical order');
    assert(!clusterMap('Waffle', { family: 'Arial', size: 64 }).reordered, 'while plain ASCII is not reordered at all');
});

test('clusters: clusterRange is total over byte offsets', () => {
    // Devanagari: multi-byte code points inside multi-code-point clusters.
    const probe = offsetProbe('हिन्दी', { family: 'Arial', size: 48 });
    const bad = probe.filter((p) => !p.correct);
    assert(bad.length === 0,
        `every one of the ${probe.length} byte offsets in हिन्दी resolves to its containing ` +
        'cluster in full — including offsets inside a multi-byte code point. Failures: ' +
        bad.map((b) => `byte ${b.byte}→${b.spanStart}–${b.spanEnd}`).join(', '));
    const lig = bro.text.clusterRange('ffi', { family: LIGATURE_FAMILY, size: 48 }, 1);
    assert(lig.start === 0 && lig.end === 3,
        `an offset inside the "ffi" ligature returns the whole ligature 0–3, got ${lig.start}–${lig.end}`);
});

test('clusters: astral text is one cluster and one caret stop', () => {
    const rows = astralReport();
    const grin = rows.find((r) => r.id === 'grin');
    assert(grin.utf16 === 2 && grin.codePoints === 1 && grin.bytes === 4,
        `"😀" is 2 UTF-16 units / 1 code point / 4 UTF-8 bytes, got ${grin.utf16} / ${grin.codePoints} / ${grin.bytes}`);
    assert(grin.fused && grin.caretStops === 1,
        `and is ONE cluster with ONE caret stop, got ${grin.clusters} cluster(s) / ${grin.caretStops} stop(s)`);

    // Between two letters it is legitimately 3 clusters (expectFused:false).
    const inline = rows.find((r) => r.id === 'inline');
    assert(inline.utf16 === 4 && inline.codePoints === 3 && inline.bytes === 6,
        `"a😀b" is 4 UTF-16 units / 3 code points / 6 UTF-8 bytes, got ` +
        `${inline.utf16} / ${inline.codePoints} / ${inline.bytes}`);
    assert(inline.clusters === 3,
        `and shapes to 3 clusters — the emoji is ONE of them despite spanning 4 bytes. Got ${inline.clusters}`);

    const map = clusterMap('a😀b', { family: 'Arial', size: 48 });
    const emoji = map.logical[1];
    assert(emoji.byteStart === 1 && emoji.byteEnd === 5,
        `the emoji's cluster spans bytes 1–5, got ${emoji.byteStart}–${emoji.byteEnd}`);
    assert(emoji.u16Start === 1 && emoji.u16End === 3,
        'which is UTF-16 1–3 — 2 units for 4 bytes, the two offset systems disagreeing in ' +
        `opposite directions. Got ${emoji.u16Start}–${emoji.u16End}`);
    for (const b of [1, 2, 3, 4]) {
        const span = bro.text.clusterRange('a😀b', { family: 'Arial', size: 48 }, b);
        assert(span.start === 1 && span.end === 5,
            `byte ${b} (inside the surrogate-pair emoji) resolves to the whole cluster 1–5, got ${span.start}–${span.end}`);
    }
    const skin = rows.find((r) => r.id === 'skin');
    assert(skin.bytes === 8 && skin.codePoints === 2, 'the skin-tone sequence is 2 astral code points / 8 UTF-8 bytes');
    assert(skin.fused, `and fuses to ONE cluster — the modifier is not separately selectable. Got ${skin.clusters}`);
});

test('clusters: caret stepping over astral text', () => {
    const s = steppingReport('a😀b');
    assert(eq(s.forward, [0, 1, 5, 6]),
        'caret stops in "a😀b" are bytes [0,1,5,6] — it steps OVER the emoji as one unit and ' +
        `never lands on bytes 2, 3 or 4. Got [${s.forward}]`);
    assert(eq(s.forwardU16, [0, 1, 3, 4]),
        `which in UTF-16 is [0,1,3,4] — never index 2, which would split the surrogate pair. Got [${s.forwardU16}]`);
    assert(s.symmetric, `stepping backward retraces exactly the same stops: [${s.backward}]`);
    assert(s.allOnCodePointBoundaries, 'no stop lands mid-code-point');
    assert(s.noSplitSurrogates, 'no stop splits a surrogate pair');

    const o = { family: 'Arial', size: 48 };
    assert(stepForward('a😀b', o, 1) === 5, 'stepForward from before the emoji jumps to after it');
    assert(stepForward('a😀b', o, 3) === 5, 'and from INSIDE it also lands after it — never mid-glyph');
    assert(stepBackward('a😀b', o, 5) === 1, 'stepBackward from after the emoji lands before it');
    assert(stepBackward('a😀b', o, 3) === 1, 'and from inside it also lands before it');
    assert(stepForward('a😀b', o, 6) === 6, 'stepping forward at the end is a fixed point');
    assert(stepBackward('a😀b', o, 0) === 0, 'and backward at the start');

    // "office" in Calibri is FEWER caret stops than 6, because the ffi fused.
    const ligStops = caretStops('office', { family: LIGATURE_FAMILY, size: 48 });
    assert(ligStops.length - 1 < 6,
        `"office" in ${LIGATURE_FAMILY} has ${ligStops.length - 1} caret stops for 6 characters — ` +
        'the ligature is one stop. This is the documented cluster-stepping behaviour and ' +
        'differs from Chromium, which subdivides a ligature by grapheme (shaped_run.h)');
});

test('clusters: canvas fillText and bro.text.shape are ONE shaping path', () => {
    for (const r of alignmentCheck(document.getElementById('clusterCanvas'))) {
        assert(r.identical,
            `"${r.text}" (${r.size}px ${r.family}): canvas measureText ${r.canvasW} === ` +
            `bro.text.shape width ${r.shapedW}. These are two readings of the SAME ShapedRun, ` +
            'so anything but exact equality means a second shaping path exists. Δ=' + r.delta);
    }
});

// Every sample repaints, including RTL and Devanagari where the drawing code
// walks reordered clusters; the table and the select follow.
test('clusters: every sample draws, and the table and select follow it', () => {
    for (let i = 0; i < CLUSTER_SAMPLES.length; i++) {
        const m = selectSample(i);
        assert(m.clusters.length > 0, `sample ${i} (${CLUSTER_SAMPLES[i].label}) drew clusters`);
        assert(clusterState.current === CLUSTER_SAMPLES[i], `sample ${i} is current`);
    }
    selectSample(0);
    frames(1);
    assert(q('#clusterSample').value === '0', 'the sample select shows the current sample');
});

test('clusters: picking a sample in the select redraws it', () => {
    const sel = q('#clusterSample');
    const last = CLUSTER_SAMPLES.length - 1;
    sel.value = String(last);
    sel.dispatchEvent(new Event('change'));
    frames(1);
    assert(clusterState.current === CLUSTER_SAMPLES[last], 'the change event selected the last sample');
    selectSample(0);
});

done('text-lab scripts + clusters');
