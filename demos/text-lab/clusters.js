// clusters.js — the byte → cluster → glyph map, drawn on the glyphs it describes.
//
// canvas fillText and bro.text.shape go through the SAME ShapedRun, so the
// boxes drawn from the cluster map land exactly on the painted glyphs, or two
// shaping paths exist. alignmentCheck() turns that claim into a number.
//
// It also owns the astral / grapheme story. An emoji is 1 grapheme, 1 code
// point, 2 UTF-16 units and 4 UTF-8 bytes; the cluster map reconciles them:
// a caret sits on a cluster edge and NEVER inside one. bro steps by CLUSTER,
// not by GRAPHEME (no UAX #29 data in this build, see shaped_run.h), so a
// sequence the font does not fuse shows up here as several stops.
//
// The map itself and the caret-stop primitives are lib/kit/text.js.

import { clusterMap, caretStops, stepForward, stepBackward, drawClusterMap as drawMap,
         codePoints, codePointLabels, utf8Length, u8ToU16, u16ToU8 } from '/lib/kit/text.js';
import { h, clear } from '/lib/kit/dom.js';
import { shape, LIGATURE_FAMILY } from '/app/shaping.js';
import { n2, table, verdict, result, glyphCell } from '/app/report.js';

export { clusterMap, caretStops, stepForward, stepBackward };

export const CLUSTER_SAMPLES = [
    { id: 'ascii', label: 'plain ASCII', text: 'Waffle', family: 'Arial', size: 64 },
    { id: 'liga', label: 'f-ligature (' + LIGATURE_FAMILY + ')', text: 'office', family: LIGATURE_FAMILY, size: 64 },
    { id: 'accent', label: 'combining accent', text: 'café', family: 'Arial', size: 64 },
    { id: 'emoji', label: 'astral emoji', text: 'a😀b🎉c', family: 'Arial', size: 64 },
    { id: 'arabic', label: 'Arabic (RTL)', text: 'العربية', family: 'Arial', size: 64 },
    { id: 'deva', label: 'Devanagari', text: 'हिन्दी', family: 'Arial', size: 64 },
    { id: 'mixed', label: 'bidi mixed', text: 'abc אבג def', family: 'Arial', size: 48 },
];

// expectFused is what a grapheme-correct implementation does. 'inline' is
// legitimately 3 clusters (a, the emoji, b) and never counts as a failure.
export const ASTRAL_SAMPLES = [
    { id: 'grin', label: 'lone astral emoji', text: '😀', expectFused: true },
    { id: 'inline', label: 'astral emoji between letters', text: 'a😀b', expectFused: false },
    { id: 'skin', label: 'emoji + skin-tone modifier', text: '👍🏽', expectFused: true },
    { id: 'zwj', label: 'ZWJ family sequence', text: '👨‍👩‍👧', expectFused: true },
    { id: 'keycap', label: 'keycap sequence', text: '1️⃣', expectFused: true },
    { id: 'flag', label: 'regional-indicator flag', text: '🇯🇵', expectFused: true },
];

export const clusterState = {
    current: CLUSTER_SAMPLES[0],
    map: null,
    astral: null,
    stepping: null,
    alignment: null,
};

const sampleOpts = (s) => ({ family: s.family, size: s.size });

/**
 * Every byte offset mapped through clusterRange(): for ANY offset inside a
 * cluster, including mid-code-point ones, the engine must return the WHOLE
 * cluster, so a caret asked for at a nonsense offset still has geometry.
 */
export function offsetProbe(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 64 }, opts || {});
    const map = clusterMap(text, o);
    const out = [];
    for (let b = 0; b <= map.bytes; b++) {
        const span = bro.text.clusterRange(text, o, b);
        const owner = map.logical.find((c) => b >= c.byteStart && b < c.byteEnd);
        out.push({
            byte: b, u16: u8ToU16(text, b),
            spanStart: span.start, spanEnd: span.end,
            correct: owner ? span.start === owner.byteStart && span.end === owner.byteEnd
                           : span.start >= map.bytes || span.end >= map.bytes,
            atEnd: b === map.bytes,
        });
    }
    return out;
}

/** Per astral sample: the four coordinate systems and whether it fused into ONE caret stop. */
export function astralReport(family) {
    const o = { family: family || 'Arial', size: 48 };
    return ASTRAL_SAMPLES.map((s) => {
        const map = clusterMap(s.text, o);
        const stops = caretStops(s.text, o);
        const cps = codePoints(s.text);
        return {
            id: s.id, label: s.label, text: s.text, expectFused: s.expectFused,
            utf16: s.text.length,
            codePoints: cps.length,
            astralCodePoints: cps.filter((c) => c.cp >= 0x10000).length,
            bytes: map.bytes,
            clusters: map.clusters.length,
            glyphs: map.glyphCount,
            caretStops: stops.length - 1,
            stops,
            fused: map.clusters.length === 1,
            u16Bytes: cps.map((c) => `${c.u16Len}u/${c.u8Len}b`).join(' '),
            widths: map.clusters.map((c) => n2(c.advance)),
        };
    });
}

/**
 * Walk a caret across 'a😀b' and back. It must step OVER the emoji as one
 * unit — bytes 0 → 1 → 5 → 6, UTF-16 0 → 1 → 3 → 4 — never landing mid
 * code point or between the surrogates (which mangles emoji in editors).
 */
export function steppingReport(text, family) {
    const t = text || 'a😀b';
    const o = { family: family || 'Arial', size: 48 };
    const forward = caretStops(t, o);
    const backward = [utf8Length(t)];
    for (let at = backward[0], guard = 0; at > 0 && guard < 4096; guard++) {
        const prev = stepBackward(t, o, at);
        if (prev >= at) break;
        backward.push(at = prev);
    }
    backward.reverse();
    const cpStarts = new Set(codePoints(t).map((c) => c.u8));
    cpStarts.add(utf8Length(t));
    return {
        text: t, forward, backward,
        symmetric: forward.length === backward.length && forward.every((v, i) => v === backward[i]),
        forwardU16: forward.map((b) => u8ToU16(t, b)),
        allOnCodePointBoundaries: forward.every((b) => cpStarts.has(b)),
        // u8ToU16 clamps back to the code-point start, so a stop between
        // surrogates would not survive the byte→utf16→byte round trip.
        noSplitSurrogates: forward.every((b) => u16ToU8(t, u8ToU16(t, b)) === b),
    };
}

/** Draw one sample's cluster map on the panel canvas. */
export function drawClusterMap(canvas, sample) {
    const s = sample || clusterState.current;
    return drawMap(canvas, s.text, sampleOpts(s), { x: 34, baseline: 96 });
}

/**
 * canvas measureText vs bro.text.shape for the same string and font. These
 * are two readings of ONE ShapedRun, so the bar is exact equality.
 */
export function alignmentCheck(canvas, samples) {
    const g = canvas.getContext('2d');
    return (samples || CLUSTER_SAMPLES).map((s) => {
        g.font = `${s.size}px ${s.family}`;
        const canvasW = g.measureText(s.text).width;
        const shapedW = shape(s.text, sampleOpts(s)).width;
        return {
            id: s.id, text: s.text, family: s.family, size: s.size,
            canvasW, shapedW, delta: canvasW - shapedW,
            identical: Math.abs(canvasW - shapedW) < 1e-4,
        };
    });
}

// --- panel ---------------------------------------------------------------------

let ui = null;

export function initClusters() {
    const $ = (id) => document.getElementById(id);
    const sel = $('clusterSample');
    CLUSTER_SAMPLES.forEach((s, i) => sel.appendChild(h('option', { value: String(i) }, `${s.label} — ${s.text}`)));
    sel.addEventListener('change', () => selectSample(Number(sel.value)));
    // Sized for the largest sample: rows are never created on selection.
    const maxClusters = Math.max(...CLUSTER_SAMPLES.map((s) => clusterMap(s.text, sampleOpts(s)).clusters.length));
    ui = {
        canvas: $('clusterCanvas'), select: sel,
        map: table($('clusterTable'), ['visual #', 'bytes', 'utf16', 'text', 'pen x', 'advance', 'glyphs', 'rtl'],
            maxClusters),
        summary: $('clusterSummary'), codePoints: $('clusterCodePoints'),
        astral: table($('clusterAstral'),
            ['sequence', 'utf16', 'code pts', 'utf8 bytes', 'clusters', 'glyphs', 'caret stops', 'one grapheme?'],
            ASTRAL_SAMPLES.length),
        stepping: $('clusterStepping'), alignment: $('clusterAlignment'),
    };
    selectSample(0);
    refreshAstral();
}

export function selectSample(index) {
    const s = clusterState.current = CLUSTER_SAMPLES[index] || CLUSTER_SAMPLES[0];
    ui.select.value = String(CLUSTER_SAMPLES.indexOf(s));
    const map = clusterState.map = drawClusterMap(ui.canvas, s);

    ui.map.forEach((row, i) => {
        const c = map.clusters[i];
        row.forEach((td) => { td.className = ''; td.textContent = ''; });
        if (!c) return;
        [`v${c.visualIndex}`, `${c.byteStart}–${c.byteEnd}`, `${c.u16Start}–${c.u16End}`, c.text,
         n2(c.x), n2(c.advance), c.glyphs, c.rtl ? 'rtl' : ''].forEach((v, k) => { row[k].textContent = v; });
        if (c.multiCodePoint) row[1].className = 'ok';
        if (c.glyphs > 1) row[6].className = 'ok';
        if (c.rtl) row[7].className = 'ok';
    });

    const exact = Math.abs(map.advanceSum - map.width) < 1e-3;
    result(ui.summary, exact && map.tiles && map.monotonic,
        `"${s.text}" in ${s.family} ${s.size}px — ${s.text.length} UTF-16 units, ${map.codePoints} code points, ` +
        `${map.bytes} UTF-8 bytes → ${map.clusters.length} clusters → ${map.glyphCount} glyphs. ` +
        `Width ${n2(map.width)}px, cluster advances re-sum to ${n2(map.advanceSum)}px ` +
        `(${exact ? 'exact' : 'MISMATCH'}). Clusters tile the byte range with no gaps: ${map.tiles ? 'yes' : 'NO'}. ` +
        `Pen x monotonic in visual order: ${map.monotonic ? 'yes' : 'NO'}. ` +
        `Visual order differs from logical: ${map.reordered ? 'yes — reordered' : 'no'}.`);

    clear(ui.codePoints);
    for (const lbl of codePointLabels(s.text)) {
        ui.codePoints.appendChild(glyphCell(
            'cp' + (lbl.astral ? ' astral' : '') + (lbl.combining ? ' combining' : '') + (lbl.rtlChar ? ' rtlchar' : ''),
            lbl.char, lbl.hex,
            `utf16 ${lbl.u16} · utf8 ${lbl.u8}` + (lbl.astral ? ' · astral (2 UTF-16 units, 4 UTF-8 bytes)' : '') +
            (lbl.combining ? ' · combining mark' : '')));
    }
    return map;
}

export function refreshAstral() {
    const rows = clusterState.astral = astralReport();
    rows.forEach((r, i) => {
        const c = ui.astral[i];
        [`${r.text}  ${r.label}`, r.utf16, r.codePoints, r.bytes, r.clusters, r.glyphs, r.caretStops]
            .forEach((v, k) => { c[k].textContent = v; });
        verdict(c[7], r.fused ? true : r.expectFused ? false : null,
            r.fused ? 'yes — one caret stop'
                    : r.expectFused ? `no — ${r.clusters} stops (font lacks the sequence)` : `${r.clusters} graphemes`);
    });

    const step = clusterState.stepping = steppingReport();
    result(ui.stepping, step.symmetric && step.allOnCodePointBoundaries && step.noSplitSurrogates,
        `"${step.text}" — caret stops forward, in bytes: [${step.forward.join(' → ')}], ` +
        `in UTF-16: [${step.forwardU16.join(' → ')}]. Backward retraces them exactly: ${step.symmetric ? 'yes' : 'NO'}. ` +
        `Every stop is on a code-point boundary: ${step.allOnCodePointBoundaries ? 'yes' : 'NO'}. ` +
        `No stop splits a surrogate pair: ${step.noSplitSurrogates ? 'yes' : 'NO'}. ` +
        `The emoji is 2 UTF-16 units and 4 UTF-8 bytes and exactly ONE step.`);

    const align = clusterState.alignment = alignmentCheck(ui.canvas);
    const bad = align.filter((a) => !a.identical);
    result(ui.alignment, bad.length === 0,
        `canvas measureText() vs bro.text.shape().width over ${align.length} samples: ` +
        (bad.length === 0 ? 'byte-identical in every case — one shaping path, two readings of it.'
                          : `${bad.length} disagreement(s): ` + bad.map((a) => `${a.id} Δ${n2(a.delta)}`).join(', ')));
}
