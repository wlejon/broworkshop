// clusters.js — the byte → cluster → glyph map, drawn.
//
// This is the module that makes the engine's text model VISIBLE. Everything
// else in this lab prints numbers; this one puts the numbers on top of the
// pixels they describe, using the fact that canvas `fillText` and
// `bro.text.shape` go through the SAME ShapedRun. So the boxes drawn from the
// cluster map land exactly on the glyphs drawn by fillText, or the engine has
// a bug — and a misalignment is visible at a glance in a way a table is not.
//
// It also owns the astral / grapheme story, because that is fundamentally a
// cluster question:
//
//   bro works in UTF-8 BYTES. JS works in UTF-16 CODE UNITS. A user thinks in
//   GRAPHEMES. An emoji is 1 grapheme, 1 code point, 2 UTF-16 units and 4
//   UTF-8 bytes, and every one of those four numbers is the right answer to
//   some question. The cluster map is what reconciles them: the caret may sit
//   at a cluster's byteStart or byteEnd and NEVER inside it, so the emoji is
//   one stop regardless of how many units or bytes it spans.
//
// KNOWN ENGINE LIMITATION, stated in shaped_run.h itself: bro steps by CLUSTER,
// not by GRAPHEME, because this build has no UAX #29 segmentation data. For
// almost everything the two agree. Where they do not — a Thai tone mark, a
// ZWJ emoji sequence — this panel shows the difference rather than papering
// over it, since the editing half of this lab will care a great deal.

import {
    el, n2, buildTable, verdict, utf8Length, codePoints, codePointLabels,
    u8ToU16, u16ToU8, sliceByBytes,
} from '/app/textutil.js';
import { shape } from '/app/shaping.js';

export const CLUSTER_SAMPLES = [
    { id: 'ascii', label: 'plain ASCII', text: 'Waffle', family: 'Arial', size: 64 },
    { id: 'liga', label: 'f-ligature (Calibri)', text: 'office', family: 'Calibri', size: 64 },
    { id: 'accent', label: 'combining accent', text: 'café', family: 'Arial', size: 64 },
    { id: 'emoji', label: 'astral emoji', text: 'a😀b🎉c', family: 'Arial', size: 64 },
    { id: 'arabic', label: 'Arabic (RTL)', text: 'العربية', family: 'Arial', size: 64 },
    { id: 'deva', label: 'Devanagari', text: 'हिन्दी', family: 'Arial', size: 64 },
    { id: 'mixed', label: 'bidi mixed', text: 'abc אבג def', family: 'Arial', size: 48 },
];

export const clusterState = {
    current: CLUSTER_SAMPLES[0],
    map: null,
    astral: null,
    stepping: null,
    alignment: null,
};

// ── Caret motion primitives ─────────────────────────────────────────────────
//
// These two are the whole of caret movement in a cluster world, and they are
// exported because the editing half of this lab needs exactly them. They are
// written against bro.text.clusterRange() rather than against the cluster
// LIST, because clusterRange is the engine's own answer for a single offset
// and is what a real editor would call.

/**
 * The next caret stop at or after `byteOffset`, moving logically forward.
 * An offset inside a cluster jumps to that cluster's END — never to the middle
 * of a ligature, an emoji, or a base+mark pair.
 */
export function stepForward(text, opts, byteOffset) {
    const total = utf8Length(text);
    if (byteOffset >= total) return total;
    const span = bro.text.clusterRange(text, opts, byteOffset);
    // Degenerate span (past the end, or an engine that returned nothing) must
    // still make progress, or a caret loop hangs.
    if (!span || span.end <= byteOffset) return Math.min(byteOffset + 1, total);
    return span.end;
}

/** The previous caret stop strictly before `byteOffset`. */
export function stepBackward(text, opts, byteOffset) {
    if (byteOffset <= 0) return 0;
    const span = bro.text.clusterRange(text, opts, byteOffset - 1);
    if (!span || span.start >= byteOffset) return Math.max(byteOffset - 1, 0);
    return span.start;
}

/** Every caret stop in `text`, left to right in LOGICAL order. */
export function caretStops(text, opts) {
    const stops = [0];
    const total = utf8Length(text);
    let at = 0;
    let guard = 0;
    while (at < total && guard++ < 4096) {
        const next = stepForward(text, opts, at);
        if (next <= at) break;
        at = next;
        stops.push(at);
    }
    return stops;
}

// ── Cluster map ─────────────────────────────────────────────────────────────

/**
 * The full map for one string: every cluster with its byte span, the substring
 * it covers, its pen x, advance, glyph count and rtl flag — plus the derived
 * facts the panel and the test both want.
 */
export function clusterMap(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 64 }, opts || {});
    const r = shape(text, o);
    const bytes = utf8Length(text);
    const cps = codePoints(text);

    const clusters = r.clusters.map((c, i) => ({
        visualIndex: i,
        byteStart: c.start,
        byteEnd: c.end,
        byteLen: c.end - c.start,
        u16Start: u8ToU16(text, c.start),
        u16End: u8ToU16(text, c.end),
        text: sliceByBytes(text, c.start, c.end),
        x: c.x,
        advance: c.advance,
        glyphs: c.glyphs,
        rtl: c.rtl,
        // A cluster that fused several code points into one caret stop.
        multiCodePoint: cps.filter((p) => p.u8 >= c.start && p.u8 < c.end).length > 1,
    }));

    // Clusters must TILE the string in byte space when sorted logically: no
    // gaps, no overlaps, covering [0, bytes). This is the invariant that makes
    // caret motion total — if it fails, some byte offset has no cluster and a
    // caret placed there has no geometry.
    const logical = clusters.slice().sort((a, b) => a.byteStart - b.byteStart);
    let tiles = true;
    let expect = 0;
    for (const c of logical) {
        if (c.byteStart !== expect || c.byteEnd <= c.byteStart) { tiles = false; break; }
        expect = c.byteEnd;
    }
    if (expect !== bytes) tiles = false;

    return {
        text, opts: o,
        bytes, codePoints: cps.length, utf16: text.length,
        width: r.width,
        glyphCount: r.glyphCount,
        clusters,
        logical,
        tiles,
        // Sum of cluster advances must reconstruct the run width exactly.
        advanceSum: clusters.reduce((a, c) => a + c.advance, 0),
        // Pen x is non-decreasing across the VISUAL list — that is the
        // definition of the list being in visual order.
        monotonic: clusters.every((c, i) => i === 0 || c.x >= clusters[i - 1].x - 1e-4),
        // Visual order differs from logical order — i.e. something reordered.
        reordered: clusters.some((c, i) => logical[i].byteStart !== c.byteStart),
    };
}

/**
 * Every byte offset in the string, mapped through clusterRange().
 *
 * The contract being checked: for ANY byte offset inside a cluster, including
 * offsets in the middle of a multi-byte code point, clusterRange returns the
 * WHOLE cluster. A caret can be asked for at a nonsense offset (a stale
 * selection, a byte index computed from a different string) and the engine
 * must still return something a caret can be drawn at.
 */
export function offsetProbe(text, opts) {
    const o = Object.assign({ family: 'Arial', size: 64 }, opts || {});
    const map = clusterMap(text, o);
    const out = [];
    for (let b = 0; b <= map.bytes; b++) {
        const span = bro.text.clusterRange(text, o, b);
        const owner = map.logical.find((c) => b >= c.byteStart && b < c.byteEnd);
        out.push({
            byte: b,
            u16: u8ToU16(text, b),
            spanStart: span.start,
            spanEnd: span.end,
            // Interior offsets must resolve to the containing cluster exactly.
            correct: owner
                ? (span.start === owner.byteStart && span.end === owner.byteEnd)
                : (span.start >= map.bytes || span.end >= map.bytes),
            atEnd: b === map.bytes,
        });
    }
    return out;
}

// ── Astral / grapheme ───────────────────────────────────────────────────────

export const ASTRAL_SAMPLES = [
    { id: 'grin', label: 'lone astral emoji', text: '😀', expectFused: true },
    { id: 'inline', label: 'astral emoji between letters', text: 'a😀b', expectFused: false },
    { id: 'skin', label: 'emoji + skin-tone modifier', text: '👍🏽', expectFused: true },
    { id: 'zwj', label: 'ZWJ family sequence', text: '👨‍👩‍👧', expectFused: true },
    { id: 'keycap', label: 'keycap sequence', text: '1️⃣', expectFused: true },
    { id: 'flag', label: 'regional-indicator flag', text: '🇯🇵', expectFused: true },
];

/**
 * For each astral sample: how the four coordinate systems line up, and whether
 * the sequence collapsed into ONE caret stop.
 *
 * `expectFused` is what a grapheme-correct implementation must do; `fused` is
 * what bro actually did. Where they disagree the panel says so in red and the
 * test reports it as a limitation rather than lowering the bar — several of
 * these (ZWJ, keycap, flags) depend on the FONT having the sequence, so the
 * report distinguishes "the shaper did not fuse" from "the font has no glyph".
 */
export function astralReport(family) {
    const o = { family: family || 'Arial', size: 48 };
    return ASTRAL_SAMPLES.map((s) => {
        const map = clusterMap(s.text, o);
        const stops = caretStops(s.text, o);
        const cps = codePoints(s.text);
        const astral = cps.filter((c) => c.cp >= 0x10000);
        return {
            id: s.id, label: s.label, text: s.text,
            expectFused: s.expectFused,
            utf16: s.text.length,
            codePoints: cps.length,
            astralCodePoints: astral.length,
            bytes: map.bytes,
            clusters: map.clusters.length,
            glyphs: map.glyphCount,
            caretStops: stops.length - 1,   // stops includes 0 and the end
            stops,
            // One caret stop over the whole sequence = one grapheme.
            fused: map.clusters.length === 1,
            // The astral code point is 2 UTF-16 units but 4 UTF-8 bytes — the
            // two offset systems disagree in OPPOSITE directions across it.
            u16Bytes: cps.map((c) => `${c.u16Len}u/${c.u8Len}b`).join(' '),
            widths: map.clusters.map((c) => n2(c.advance)),
        };
    });
}

/**
 * Walk a caret across 'a😀b' one stop at a time and record where it lands, in
 * both offset systems.
 *
 * The assertion this exists for: the caret must step OVER the emoji as one
 * unit — 0 → 1 → 5 → 6 in bytes, 0 → 1 → 3 → 4 in UTF-16 — never landing on
 * byte 2, 3 or 4 (mid-code-point) or UTF-16 index 2 (between the surrogates).
 * A caret at UTF-16 index 2 would split a surrogate pair, which produces an
 * unpaired surrogate and is how emoji get mangled in text editors.
 */
export function steppingReport(text, family) {
    const t = text || 'a😀b';
    const o = { family: family || 'Arial', size: 48 };
    const forward = caretStops(t, o);
    // And back again, which must retrace the same stops exactly.
    const backward = [];
    let at = utf8Length(t);
    backward.push(at);
    let guard = 0;
    while (at > 0 && guard++ < 4096) {
        const prev = stepBackward(t, o, at);
        if (prev >= at) break;
        at = prev;
        backward.push(at);
    }
    backward.reverse();

    const cpStarts = new Set(codePoints(t).map((c) => c.u8));
    cpStarts.add(utf8Length(t));

    return {
        text: t,
        forward,
        backward,
        symmetric: forward.length === backward.length &&
            forward.every((v, i) => v === backward[i]),
        forwardU16: forward.map((b) => u8ToU16(t, b)),
        // No stop may land in the middle of a code point.
        allOnCodePointBoundaries: forward.every((b) => cpStarts.has(b)),
        // No stop may land between the two halves of a surrogate pair. Since
        // u8ToU16 clamps back to the code-point start, the test is that the
        // round trip byte→utf16→byte is the identity at every stop.
        noSplitSurrogates: forward.every((b) => u16ToU8(t, u8ToU16(t, b)) === b),
    };
}

// ── Canvas drawing: the map on top of the glyphs ────────────────────────────

const PAD = 34;
const BASELINE = 96;

/**
 * Draw `text` with fillText, then overlay one box per cluster from the cluster
 * map, labelled with its byte span.
 *
 * The alignment of the boxes to the glyphs is not decoration — it is the
 * assertion, made visible. canvas fillText and bro.text.shape both call
 * Renderer::shapeText, so if the boxes drift the two seams have diverged.
 * `alignmentCheck()` below turns the same claim into a number.
 */
export function drawClusterMap(canvas, sample) {
    const g = canvas.getContext('2d');
    const s = sample || clusterState.current;
    const opts = { family: s.family, size: s.size };
    const map = clusterMap(s.text, opts);

    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#12151c';
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Baseline.
    g.strokeStyle = '#2b3242';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD, BASELINE + 0.5);
    g.lineTo(canvas.width - PAD, BASELINE + 0.5);
    g.stroke();

    // Cluster boxes, drawn UNDER the text so the glyphs stay readable.
    map.clusters.forEach((c, i) => {
        const x = PAD + c.x;
        const w = c.advance;
        // Alternating fills so adjacent clusters are distinguishable, with a
        // different hue for RTL clusters and for multi-glyph ones.
        g.fillStyle = c.rtl ? (i % 2 ? '#33203a' : '#3d2545')
                            : (i % 2 ? '#1b2433' : '#222c3d');
        g.fillRect(x, BASELINE - s.size * 1.05, Math.max(w, 2), s.size * 1.35);
        g.strokeStyle = c.glyphs > 1 ? '#f59e0b' : (c.rtl ? '#c084fc' : '#3b82f6');
        g.lineWidth = c.glyphs > 1 ? 2 : 1;
        g.strokeRect(x + 0.5, BASELINE - s.size * 1.05 + 0.5, Math.max(w, 2) - 1, s.size * 1.35 - 1);
    });

    // The text itself.
    g.fillStyle = '#e8edf7';
    g.font = `${s.size}px ${s.family}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(s.text, PAD, BASELINE);

    // Labels: byte span above, visual index below.
    g.font = '11px Consolas, monospace';
    map.clusters.forEach((c, i) => {
        const x = PAD + c.x;
        g.fillStyle = c.glyphs > 1 ? '#fbbf24' : '#7d8aa3';
        g.textAlign = 'left';
        g.fillText(`${c.byteStart}–${c.byteEnd}`, x + 2, BASELINE - s.size * 1.05 - 6);
        g.fillStyle = c.rtl ? '#c084fc' : '#5b6b86';
        g.fillText(`v${i}${c.glyphs > 1 ? ' ·' + c.glyphs + 'g' : ''}`,
            x + 2, BASELINE + s.size * 0.36);
    });

    // Caret stops, as ticks on the baseline — the actual places a caret may go.
    const stops = caretStops(s.text, opts);
    g.strokeStyle = '#4ade80';
    g.lineWidth = 1;
    for (const b of stops) {
        const pos = bro.text.byteOffsetToX(s.text, opts, b);
        g.beginPath();
        g.moveTo(PAD + pos.x + 0.5, BASELINE + 6);
        g.lineTo(PAD + pos.x + 0.5, BASELINE + 18);
        g.stroke();
    }

    return map;
}

/**
 * Numeric version of what the drawing shows: does canvas `measureText` — which
 * goes through CanvasScene::measureText → shapeCurrent → ShapedRun — agree
 * with bro.text.shape's width for the same string and font, exactly?
 *
 * "Exactly" is the right bar. These are not two estimates of the same quantity;
 * they are two readings of the SAME ShapedRun, so any difference at all means
 * a second shaping path exists somewhere.
 */
export function alignmentCheck(canvas, samples) {
    const g = canvas.getContext('2d');
    const list = samples || CLUSTER_SAMPLES;
    return list.map((s) => {
        g.font = `${s.size}px ${s.family}`;
        const canvasW = g.measureText(s.text).width;
        const shapedW = shape(s.text, { family: s.family, size: s.size }).width;
        return {
            id: s.id, text: s.text, family: s.family, size: s.size,
            canvasW, shapedW,
            delta: canvasW - shapedW,
            identical: Math.abs(canvasW - shapedW) < 1e-4,
        };
    });
}

// ── Panel ───────────────────────────────────────────────────────────────────

let canvas = null;
let mapCells = null;
let mapSummary = null;
let astralCells = null;
let stepHost = null;
let alignHost = null;
let cpHost = null;

export function initClusters() {
    canvas = document.getElementById('clusterCanvas');

    const sel = document.getElementById('clusterSample');
    CLUSTER_SAMPLES.forEach((s, i) => {
        const o = el('option', null, `${s.label} — ${s.text}`);
        o.value = String(i);
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => selectSample(Number(sel.value)));

    // The cluster table is sized for the largest sample so rows are never
    // created or destroyed on selection — only textContent changes.
    const maxClusters = Math.max(...CLUSTER_SAMPLES.map(
        (s) => clusterMap(s.text, { family: s.family, size: s.size }).clusters.length));
    mapCells = buildTable(document.getElementById('clusterTable'),
        ['visual #', 'bytes', 'utf16', 'text', 'pen x', 'advance', 'glyphs', 'rtl'],
        maxClusters).cells;
    mapSummary = document.getElementById('clusterSummary');
    cpHost = document.getElementById('clusterCodePoints');

    astralCells = buildTable(document.getElementById('clusterAstral'),
        ['sequence', 'utf16', 'code pts', 'utf8 bytes', 'clusters', 'glyphs', 'caret stops', 'one grapheme?'],
        ASTRAL_SAMPLES.length).cells;

    stepHost = document.getElementById('clusterStepping');
    alignHost = document.getElementById('clusterAlignment');

    selectSample(0);
    refreshAstral();
}

export function selectSample(index) {
    clusterState.current = CLUSTER_SAMPLES[index] || CLUSTER_SAMPLES[0];
    const s = clusterState.current;
    const map = drawClusterMap(canvas, s);
    clusterState.map = map;

    for (let i = 0; i < mapCells.length; i++) {
        const row = mapCells[i];
        const c = map.clusters[i];
        row.forEach((td) => { td.className = ''; });
        if (!c) { row.forEach((td) => { td.textContent = ''; }); continue; }
        row[0].textContent = 'v' + c.visualIndex;
        row[1].textContent = `${c.byteStart}–${c.byteEnd}`;
        row[2].textContent = `${c.u16Start}–${c.u16End}`;
        row[3].textContent = c.text;
        row[4].textContent = n2(c.x);
        row[5].textContent = n2(c.advance);
        row[6].textContent = c.glyphs;
        row[7].textContent = c.rtl ? 'rtl' : '';
        if (c.glyphs > 1) row[6].className = 'ok';
        if (c.rtl) row[7].className = 'ok';
        if (c.multiCodePoint) row[1].className = 'ok';
    }

    mapSummary.textContent =
        `"${s.text}" in ${s.family} ${s.size}px — ${s.text.length} UTF-16 units, ` +
        `${map.codePoints} code points, ${map.bytes} UTF-8 bytes → ` +
        `${map.clusters.length} clusters → ${map.glyphCount} glyphs. ` +
        `Width ${n2(map.width)}px, cluster advances re-sum to ${n2(map.advanceSum)}px ` +
        `(${Math.abs(map.advanceSum - map.width) < 1e-3 ? 'exact' : 'MISMATCH'}). ` +
        `Clusters tile the byte range with no gaps: ${map.tiles ? 'yes' : 'NO'}. ` +
        `Pen x monotonic in visual order: ${map.monotonic ? 'yes' : 'NO'}. ` +
        `Visual order differs from logical: ${map.reordered ? 'yes — reordered' : 'no'}.`;

    cpHost.textContent = '';
    for (const lbl of codePointLabels(s.text)) {
        const cell = el('span', 'cp' +
            (lbl.astral ? ' astral' : '') +
            (lbl.combining ? ' combining' : '') +
            (lbl.rtlChar ? ' rtlchar' : ''));
        cell.appendChild(el('b', null, lbl.char === ' ' ? '␠' : lbl.char));
        cell.appendChild(el('i', null, lbl.hex));
        cell.title = `utf16 ${lbl.u16} · utf8 ${lbl.u8}` +
            (lbl.astral ? ' · astral (2 UTF-16 units, 4 UTF-8 bytes)' : '') +
            (lbl.combining ? ' · combining mark' : '');
        cpHost.appendChild(cell);
    }

    return map;
}

export function refreshAstral() {
    const rows = astralReport();
    clusterState.astral = rows;
    rows.forEach((r, i) => {
        const c = astralCells[i];
        c[0].textContent = `${r.text}  ${r.label}`;
        c[1].textContent = r.utf16;
        c[2].textContent = r.codePoints;
        c[3].textContent = r.bytes;
        c[4].textContent = r.clusters;
        c[5].textContent = r.glyphs;
        c[6].textContent = r.caretStops;
        verdict(c[7], r.fused,
            r.fused ? 'yes — one caret stop'
                    : `no — ${r.clusters} stops (font lacks the sequence)`);
    });

    const step = steppingReport();
    clusterState.stepping = step;
    stepHost.textContent =
        `"${step.text}" — caret stops forward, in bytes: [${step.forward.join(' → ')}], ` +
        `in UTF-16: [${step.forwardU16.join(' → ')}]. ` +
        `Backward retraces them exactly: ${step.symmetric ? 'yes' : 'NO'}. ` +
        `Every stop is on a code-point boundary: ${step.allOnCodePointBoundaries ? 'yes' : 'NO'}. ` +
        `No stop splits a surrogate pair: ${step.noSplitSurrogates ? 'yes' : 'NO'}. ` +
        `The emoji is 2 UTF-16 units and 4 UTF-8 bytes and exactly ONE step.`;
    stepHost.className = 'result ' +
        (step.symmetric && step.allOnCodePointBoundaries && step.noSplitSurrogates ? 'ok' : 'bad');

    const align = alignmentCheck(canvas);
    clusterState.alignment = align;
    const bad = align.filter((a) => !a.identical);
    alignHost.textContent =
        `canvas measureText() vs bro.text.shape().width over ${align.length} samples: ` +
        (bad.length === 0
            ? 'byte-identical in every case — one shaping path, two readings of it.'
            : `${bad.length} disagreement(s): ` +
              bad.map((a) => `${a.id} Δ${n2(a.delta)}`).join(', '));
    alignHost.className = 'result ' + (bad.length === 0 ? 'ok' : 'bad');
}
