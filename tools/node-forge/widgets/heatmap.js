// A z-scored latent heatmap (kokoro-lab's heat view) for a row-major
// { h, w, data } grid, with the rows orderable natively, by variance, or by
// correlation with any named reference contour (opts.refs = { label: array }).

import { h } from "/lib/kit/dom.js";

// Diverging colormap: blue (negative) -> dark (0) -> amber (positive).
function divColor(t) {
    t = t < -1 ? -1 : t > 1 ? 1 : t;
    const base = [14, 18, 24], to = t >= 0 ? [235, 150, 70] : [90, 175, 255], m = Math.abs(t);
    return [base[0] + (to[0] - base[0]) * m, base[1] + (to[1] - base[1]) * m, base[2] + (to[2] - base[2]) * m];
}

function resampleTo(ref, w) {
    const out = new Float32Array(w);
    for (let x = 0; x < w; x++) out[x] = ref[Math.floor(x * ref.length / w)];
    return out;
}

function rowOrder(stage, mode, refs) {
    const { h: rows, w, data } = stage;
    const idx = Array.from({ length: rows }, (_, i) => i);
    if (mode === 'native') return idx;
    const score = new Float64Array(rows);
    const rowMean = (base) => { let m = 0; for (let x = 0; x < w; x++) m += data[base + x]; return m / w; };
    if (mode === 'variance') {
        for (let c = 0; c < rows; c++) {
            const base = c * w, m = rowMean(base);
            let v = 0; for (let x = 0; x < w; x++) { const d = data[base + x] - m; v += d * d; }
            score[c] = v;
        }
    } else {
        if (!refs || !refs[mode]) return idx;
        const ref = resampleTo(refs[mode], w);
        let rm = 0; for (let x = 0; x < w; x++) rm += ref[x]; rm /= w;
        let rv = 0; for (let x = 0; x < w; x++) { const d = ref[x] - rm; rv += d * d; }
        rv = Math.sqrt(rv) || 1;
        for (let c = 0; c < rows; c++) {
            const base = c * w, m = rowMean(base);
            let cov = 0, sv = 0;
            for (let x = 0; x < w; x++) { const a = data[base + x] - m; cov += a * (ref[x] - rm); sv += a * a; }
            score[c] = cov / ((Math.sqrt(sv) || 1) * rv);
        }
    }
    return idx.sort((a, b) => score[b] - score[a]);
}

export function mountHeatmap(container, stage, opts) {
    const o = opts || {};
    while (container.firstChild) container.removeChild(container.firstChild);
    const n = stage.data.length;
    let m = 0; for (let i = 0; i < n; i++) m += stage.data[i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) { const d = stage.data[i] - m; v += d * d; }
    const sd = Math.sqrt(v / n) || 1;
    const W = Math.min(stage.w, 1100), H = Math.max(90, Math.min(stage.h, 340));

    const sel = h('select.form-input', null, h('option', { value: 'native' }, 'native'), h('option', { value: 'variance' }, 'by variance'),
        Object.keys(o.refs || {}).map((label) => h('option', { value: label }, 'by ' + label)));
    const cv = h('canvas.heat-canvas', { width: W, height: H });
    const note = h('div.axis-note');
    container.append(h('div.heat-ctrl', null, h('span', null, 'rows:'), sel), cv, note);

    const ctx = cv.getContext('2d');
    function draw(mode) {
        const order = rowOrder(stage, mode, o.refs);
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
            const base = order[Math.floor(y * stage.h / H)] * stage.w;
            for (let x = 0; x < W; x++) {
                const c = divColor((stage.data[base + Math.floor(x * stage.w / W)] - m) / (3 * sd));
                const p = (y * W + x) * 4;
                img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        note.textContent = 'rows = ' + stage.h + (mode === 'native' ? '' : ' (' + mode + '-ordered)') +
            '  ·  cols = ' + stage.w + '  ·  z-scored (μ ' + m.toFixed(2) + ' σ ' + sd.toFixed(2) + ')';
    }
    sel.addEventListener('change', () => draw(sel.value));
    draw('native');
    return container;
}
