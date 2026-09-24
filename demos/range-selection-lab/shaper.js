// shaper.js — the text shaper tab: bro.text.shape()'s cluster map for any
// string, drawn over canvas fillText (lib/kit/text.js), as a table, and a
// kerning check. Offsets from bro.text are UTF-8 bytes; the table shows the
// UTF-16 span beside them.

import { $, h, clear } from '/lib/kit/dom.js';
import { stats as statsView } from '/lib/kit/ui.js';
import { shape, drawClusterMap } from '/lib/kit/text.js';

export const PRESETS = {
    office: 'office fluffy',
    difficult: 'difficult affine',
    kerning: 'AV AW To Yo LT P.',
    astral: 'a😀b🎉c',
    hindi: 'हिन्दी',
    arabic: 'العربية',
};

export const KERN_PAIRS = ['AV', 'AW', 'To', 'Yo', 'LT', 'P,'];

export const shaperState = { map: null, kerning: [], opts: null, ligatures: 0 };

const n2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

/** width(pair) − (width(a) + width(b)): negative when the font kerns the pair tighter. */
export function kerning(pair, opts) {
    const w = (s) => shape(s, opts).width;
    const a = w(pair[0]), b = w(pair[1]), both = w(pair);
    return { pair, a, b, sum: a + b, both, delta: both - (a + b) };
}

/** What kind of cluster this is, for the table. */
export function clusterKind(c) {
    return c.ligature ? 'ligature' : c.glyphs > 1 ? 'multi' : c.rtl ? 'rtl' : '';
}

let readouts = null;

export function initShaper() {
    readouts = statsView('#shaperStats', { engine: 'engine', width: 'width', glyphs: 'glyphs',
        clusters: 'clusters', ligatures: 'ligatures' });
    readouts.set('engine', 'bro.text (HarfBuzz)');
    $('#shaperSize').addEventListener('input', runShaper);
    $('#shaperPreset').addEventListener('change', () => {
        const v = PRESETS[$('#shaperPreset').value];
        if (v) { $('#shaperText').value = v; runShaper(); }
    });
    $('#shaperFamily').addEventListener('change', runShaper);
    $('#btnShape').addEventListener('click', runShaper);
    $('#shaperText').addEventListener('keydown', (e) => { if (e.key === 'Enter') runShaper(); });
    runShaper();
}

export function runShaper() {
    const text = $('#shaperText').value;
    const size = Number($('#shaperSize').value);
    const opts = shaperState.opts = { family: $('#shaperFamily').value, size };
    $('#shaperSizeV').textContent = size + 'px';

    // Size the canvas to the run before drawing: the map draws at canvas.width.
    const canvas = $('#shaperCanvas');
    const width = text ? shape(text, opts).width : 0;
    canvas.width = Math.max(1200, Math.ceil(width) + 120);
    canvas.height = Math.round(size * 2.1 + 60);
    const map = shaperState.map = drawClusterMap(canvas, text, opts, { baseline: Math.round(size * 1.35 + 30) });

    shaperState.ligatures = map.clusters.filter((c) => c.ligature).length;
    readouts.set({ width: n2(map.width) + 'px', glyphs: map.glyphCount, clusters: map.clusters.length,
                   ligatures: shaperState.ligatures });
    renderClusters(map);
    renderKerning(opts);
    return map;
}

function renderClusters(map) {
    const t = $('#clusterTable');
    clear(t);
    t.appendChild(h('tr', null, ['#', 'text', 'UTF-8 bytes', 'UTF-16', 'x', 'advance', 'glyphs', 'kind']
        .map((s) => h('th', null, s))));
    if (map.clusters.length === 0) {
        t.appendChild(h('tr', null, h('td', { colSpan: 8 }, 'nothing to shape')));
        return;
    }
    map.clusters.forEach((c, i) => {
        const kind = clusterKind(c);
        t.appendChild(h('tr', { class: kind === 'ligature' ? 'ligature' : null },
            h('td', null, 'v' + i),
            h('td.glyph', null, c.text === ' ' ? '␠' : c.text),
            h('td', null, `${c.byteStart}–${c.byteEnd} (${c.byteLen} B)`),
            h('td', null, `${c.u16Start}–${c.u16End}`),
            h('td', null, n2(c.x)),
            h('td', null, n2(c.advance)),
            h('td', null, String(c.glyphs)),
            h('td', { class: kind || null }, kind === 'multi' ? 'multi-glyph' : kind || 'standard')));
    });
}

function renderKerning(opts) {
    const t = $('#kernTable');
    clear(t);
    t.appendChild(h('tr', null, ['pair', 'width a', 'width b', 'a + b', 'shaped pair', 'delta']
        .map((s) => h('th', null, s))));
    shaperState.kerning = KERN_PAIRS.map((p) => kerning(p, opts));
    for (const k of shaperState.kerning) {
        const cls = k.delta < -0.05 ? 'tight' : k.delta > 0.05 ? 'loose' : null;
        t.appendChild(h('tr', null,
            h('td.glyph', null, k.pair),
            h('td', null, `${n2(k.a)} ('${k.pair[0]}')`),
            h('td', null, `${n2(k.b)} ('${k.pair[1]}')`),
            h('td', null, n2(k.sum)),
            h('td', null, n2(k.both)),
            h('td', { class: cls }, (k.delta > 0 ? '+' : '') + n2(k.delta))));
    }
}
