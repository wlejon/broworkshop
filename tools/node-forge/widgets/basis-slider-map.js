// A k-dimensional basis editor: a slider per axis plus a 2D map of two axes
// where dragging moves the crosshair and clicking a preset landmark snaps
// every coordinate to it (the qwen-tts-lab voice map).
//
// cfg (node-scoped functions; only coords() is edited):
//   dim(node)             k
//   axisName(node, i)     slider label
//   axisRange(node, i)    [lo, hi]
//   coords(node)          the LIVE plain number[k] (mutated in place)
//   presets(node)         [{ name, coords }] (optional)
//   mapAxes(node)         [i, j] plotted on the map (default [0, 1])
//   mapExtent(node)       the map's ± range (default: from the two ranges)
//   snapPx                snap radius in canvas px (default 11)
// ctx.onEdit() fires on every slider / map / preset change.

import { h, trackDrag } from "/lib/kit/dom.js";

const MAP_W = 280, MAP_H = 280, MAP_PAD = 26;

export function mountBasisSliderMap(node, cfg, ctx) {
    const k = cfg.dim(node), coords = cfg.coords(node);
    const [ai, aj] = cfg.mapAxes ? cfg.mapAxes(node) : [0, 1];
    const presets = cfg.presets ? cfg.presets(node) : [];
    let ext = 6;
    if (cfg.mapExtent) ext = cfg.mapExtent(node);
    else {
        const ri = cfg.axisRange(node, ai), rj = cfg.axisRange(node, aj);
        ext = Math.max(Math.abs(ri[0]), Math.abs(ri[1]), Math.abs(rj[0]), Math.abs(rj[1])) || 6;
    }

    const cv = h('canvas.basis-map', { width: MAP_W, height: MAP_H });
    const mctx = cv.getContext('2d');
    const toPx = (x, y) => [MAP_PAD + (x + ext) / (2 * ext) * (MAP_W - 2 * MAP_PAD), MAP_PAD + (ext - y) / (2 * ext) * (MAP_H - 2 * MAP_PAD)];
    const cl = (v) => Math.max(-ext, Math.min(ext, v));
    const toSig = (px, py) => [cl((px - MAP_PAD) / (MAP_W - 2 * MAP_PAD) * 2 * ext - ext), cl(ext - (py - MAP_PAD) / (MAP_H - 2 * MAP_PAD) * 2 * ext)];

    function drawMap() {
        mctx.fillStyle = '#0a0d12'; mctx.fillRect(0, 0, MAP_W, MAP_H);
        mctx.strokeStyle = '#1d2433'; mctx.lineWidth = 1; mctx.strokeRect(0.5, 0.5, MAP_W - 1, MAP_H - 1);
        const [ox, oy] = toPx(0, 0);
        mctx.strokeStyle = '#232c3d';
        mctx.beginPath(); mctx.moveTo(MAP_PAD, oy); mctx.lineTo(MAP_W - MAP_PAD, oy);
        mctx.moveTo(ox, MAP_PAD); mctx.lineTo(ox, MAP_H - MAP_PAD); mctx.stroke();
        mctx.font = '10px sans-serif';
        for (const p of presets) {
            const [px, py] = toPx(p.coords[ai] || 0, p.coords[aj] || 0);
            mctx.fillStyle = '#6b8fd8';
            mctx.beginPath(); mctx.arc(px, py, 4, 0, 7); mctx.fill();
            mctx.fillStyle = '#8b97ac'; mctx.fillText(p.name, px + 6, py + 4);
        }
        const [hx, hy] = toPx(coords[ai] || 0, coords[aj] || 0);
        mctx.strokeStyle = '#c4b5ff'; mctx.fillStyle = 'rgba(179,157,255,0.18)'; mctx.lineWidth = 2;
        mctx.beginPath(); mctx.arc(hx, hy, 8, 0, 7); mctx.fill(); mctx.stroke();
        mctx.beginPath(); mctx.moveTo(hx - 12, hy); mctx.lineTo(hx + 12, hy);
        mctx.moveTo(hx, hy - 12); mctx.lineTo(hx, hy + 12); mctx.stroke();
    }
    function edited() { syncSliders(); drawMap(); ctx.onEdit(); }
    function localPx(e) {
        const r = cv.getBoundingClientRect();
        return [(e.clientX - r.left) * MAP_W / (r.width || MAP_W), (e.clientY - r.top) * MAP_H / (r.height || MAP_H)];
    }
    function placeAt(e) {
        const [x, y] = toSig(...localPx(e));
        coords[ai] = x; coords[aj] = y;
        edited();
    }
    function snapTo(p) {
        for (let d = 0; d < k; d++) coords[d] = p.coords[d] != null ? p.coords[d] : 0;
        edited();
    }
    cv.addEventListener('mousedown', (e) => {
        const [px, py] = localPx(e), snap = cfg.snapPx || 11;
        let best = null, bd = snap * snap;
        for (const p of presets) {
            const [x, y] = toPx(p.coords[ai] || 0, p.coords[aj] || 0);
            const d = (x - px) * (x - px) + (y - py) * (y - py);
            if (d < bd) { bd = d; best = p; }
        }
        if (best) { snapTo(best); return; }
        placeAt(e);
        trackDrag(placeAt, null);
    });

    const mapSec = h('div.basis-map-wrap', null, cv);
    if (presets.length) {
        const sel = h('select.form-input.basis-preset', null,
            h('option', { value: '' }, 'Pick a preset…'),
            presets.map((p) => h('option', { value: p.name }, p.name)));
        sel.addEventListener('change', () => { const p = presets.find((x) => x.name === sel.value); if (p) snapTo(p); });
        mapSec.appendChild(sel);
    }

    const cells = [];
    const sliders = h('div.basis-sliders');
    for (let i = 0; i < k; i++) {
        const [lo, hi] = cfg.axisRange(node, i);
        const val = h('span.pc-val', null, (coords[i] || 0).toFixed(2));
        const range = h('input', { type: 'range', min: String(lo), max: String(hi), step: '0.01', value: String(coords[i] || 0) });
        range.addEventListener('input', () => {
            coords[i] = parseFloat(range.value);
            val.textContent = coords[i].toFixed(2);
            if (i === ai || i === aj) drawMap();
            ctx.onEdit();
        });
        cells.push({ range, val });
        sliders.appendChild(h('div.pc', null, h('div.pc-head', null, h('span.pc-name', null, cfg.axisName(node, i)), val), range));
    }
    function syncSliders() {
        for (let i = 0; i < k; i++) { cells[i].range.value = String(coords[i]); cells[i].val.textContent = (+coords[i]).toFixed(2); }
    }

    drawMap();
    return h('div.basis-panel', null, mapSec, sliders);
}
