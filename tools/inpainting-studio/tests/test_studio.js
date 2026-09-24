// Inpainting Studio without a model: the pixel helpers (mask bits, fill
// modes, the canny annotator), painting the mask with real mouse input,
// mask ops, outpaint expansion, scenes, view modes, the canny control map
// and the inpaint options a Generate would send. Generation is test_generate.js (ml).
// Run: scripts/validate.sh tools/inpainting-studio

import { check, eq, test, done, frames, clickOn, setValue, text, q, shot } from "/lib/kit/test.js";
import { studio, prefs, buildOpts, setView, loadScene, expand } from "/app/lib/app.js";
import { maskBits, coverage, maskToRgba, fillMasked, edgeMap, FILL_MODES } from "/app/lib/pixels.js";
import { MAX_SIDE } from "/app/lib/mask.js";

const fs = require('fs');
const saved = prefs.snapshot();
const img = (w, h, f) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = f(x, y), i = (y * w + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] == null ? 255 : c[3];
    }
    return { width: w, height: h, data: d };
};
const stage = () => studio.stage;
const cov = () => coverage(stage().maskBits());

try {
    frames(3);

    test('mask bits, coverage and the white-on-black mask', () => {
        const m = img(4, 4, (x) => [0, 0, 0, x < 2 ? 200 : 10]);
        const bits = maskBits(m);
        eq(Array.from(bits.slice(0, 4)), [1, 1, 0, 0], 'row 0');
        eq(coverage(bits), 0.5, 'coverage');
        const rgba = maskToRgba(bits, 4, 4);
        eq([rgba[0], rgba[3], rgba[8], rgba[11]], [255, 255, 0, 255], 'white repaint, black keep, opaque');
    });

    test('fill modes only touch masked pixels', () => {
        const src = img(16, 16, (x) => (x < 8 ? [200, 40, 40] : [40, 40, 200]));
        const bits = new Uint8Array(256);
        for (let y = 4; y < 12; y++) for (let x = 6; x < 10; x++) bits[y * 16 + x] = 1;
        eq(Object.keys(FILL_MODES), ['original', 'blur', 'noise', 'color'], 'modes');
        eq(Array.from(fillMasked(src, bits, 'original').data), Array.from(src.data), 'original is a copy');
        for (const mode of ['blur', 'noise', 'color']) {
            const out = fillMasked(src, bits, mode, 3).data;
            eq([out[0], out[2]], [200, 40], mode + ': unmasked kept');
            const i = (8 * 16 + 7) * 4;
            check(out[i] !== 200 || out[i + 2] !== 40, mode + ': masked pixel changed');
        }
        eq(Array.from(fillMasked(src, bits, 'noise', 9).data), Array.from(fillMasked(src, bits, 'noise', 9).data), 'noise repeats per seed');
        const c = fillMasked(src, bits, 'color').data, i = (8 * 16 + 7) * 4;
        check(Math.abs(c[i] - 120) < 2 && Math.abs(c[i + 2] - 120) < 2, 'color = mean of the border ring: ' + c[i] + ',' + c[i + 2]);
    });

    test('canny annotator marks the step edge only', () => {
        const e = edgeMap(img(16, 16, (x) => (x < 8 ? [0, 0, 0] : [255, 255, 255]))).data;
        eq(e[(8 * 16 + 7) * 4], 255, 'edge column lit');
        eq(e[(8 * 16 + 2) * 4], 0, 'flat area dark');
        eq(e[3], 255, 'opaque');
    });

    test('the page boots with the portrait scene and Generate disabled', () => {
        eq([stage().width, stage().height], [512, 512], 'canvas size');
        eq(q('#presetSelect').value, 'portrait', 'scene select');
        eq(q('#presetSelect').options.length, 3, 'three scenes');
        check(studio.panel.generate.disabled, 'Generate off until a model loads');
        check(q('#views .active') && q('#views .active').dataset.value === 'composite', 'composite view active');
        check(!q('#baseCanvas').hidden && !q('#maskCanvas').hidden && q('#resultCanvas').hidden, 'composite shows base + mask');
        check(/SD 1.5/.test(text('#model')), 'model picker built');
        const r = q('#stage').getBoundingClientRect(), v = q('#viewport').getBoundingClientRect();
        check(r.width > 200 && r.right <= v.right + 1 && r.bottom <= v.bottom + 1, 'stage fits the viewport: ' + r.width + 'x' + r.height);
    });
    shot('boot');

    test('painting with the mouse masks pixels; the eraser removes them', () => {
        stage().mask.clear();
        eq(cov(), 0, 'starts empty');
        const r = q('#maskCanvas').getBoundingClientRect();
        const y = r.top + r.height * 0.5;
        mouseDown(r.left + r.width * 0.3, y, 0);
        for (let i = 1; i <= 8; i++) mouseMove(r.left + r.width * (0.3 + 0.05 * i), y);
        mouseUp(r.left + r.width * 0.7, y, 0);
        flush();
        const painted = cov();
        check(painted > 0.01 && painted < 0.2, 'a stroke of coverage ' + painted.toFixed(3));
        clickOn('#tool [data-value=eraser]');
        eq(stage().mask.tool, 'eraser', 'eraser selected');
        mouseDown(r.left + r.width * 0.5, y, 0);
        mouseUp(r.left + r.width * 0.5, y, 0);
        flush();
        check(cov() < painted, 'eraser dab removed some: ' + cov().toFixed(3));
        clickOn('#tool [data-value=brush]');
    });

    test('brush size + hardness controls drive the painter', () => {
        setValue('#brushSize', 64);
        eq(stage().mask.size, 64, 'size');
        eq(text('#brushSizeVal'), '64px', 'size readout');
        setValue('#brushHardness', 40);
        eq(stage().mask.hardness, 0.4, 'hardness');
    });
    shot('mask');

    test('invert / fill / clear', () => {
        const before = cov();
        clickOn('#invertMaskBtn');
        check(Math.abs(cov() - (1 - before)) < 0.01, 'invert: ' + before.toFixed(3) + ' -> ' + cov().toFixed(3));
        clickOn('#fillMaskBtn');
        eq(cov(), 1, 'fill all');
        clickOn('#clearMaskBtn');
        eq(cov(), 0, 'clear');
    });

    test('outpaint grows the canvas and masks only the new border', () => {
        clickOn('[data-expand=e]');
        eq([stage().width, stage().height], [576, 512], 'east +64');
        const bits = stage().maskBits();
        eq([bits[575], bits[0]], [1, 0], 'new east column masked, old image kept');
        check(Math.abs(coverage(bits) - 64 / 576) < 0.01, 'coverage = border share');
        clickOn('[data-expand=n]');
        eq([stage().width, stage().height], [576, 576], 'north +64');
        eq(stage().maskBits()[0], 1, 'new top-left masked');
        eq([q('#resultCanvas').width, q('#controlCanvas').width], [576, 576], 'result + control follow');
        while (stage().width < MAX_SIDE) expand(64, 0);
        check(!expand(64, 0), 'stops at ' + MAX_SIDE);
        check(/limit/.test(text('#status')), 'says so: ' + text('#status'));
    });

    test('scene switch resets size and mask', () => {
        setValue('#presetSelect', 'room');
        eq([stage().width, stage().height], [512, 512], 'back to 512');
        eq(cov(), 0, 'mask cleared');
        const px = stage().pixels().data;
        check(px[4 * (256 * 512 + 256) + 3] === 255, 'scene drawn');
    });

    test('view modes show the right canvases', () => {
        clickOn('#views [data-value=mask]');
        check(q('#baseCanvas').hidden && !q('#maskCanvas').hidden, 'mask only');
        clickOn('#views [data-value=control]');
        check(!q('#controlCanvas').hidden && q('#maskCanvas').hidden, 'control map');
        clickOn('#views [data-value=result]');
        check(!q('#result-hint').hidden, 'empty result shows the hint');
        check(q('#btn-adopt').disabled, 'nothing to adopt yet');
        setView('composite');
    });

    test('canny guide draws an edge map; none draws black', () => {
        setValue('#controlnetMode', 'canny');
        const e = stage().pixels(stage().control).data;
        let lit = 0;
        for (let i = 0; i < e.length; i += 4) lit += e[i] === 255 ? 1 : 0;
        check(lit > 500 && lit < e.length / 8, 'edge pixels: ' + lit);
        check(/until a model/.test(text('#control-note')), 'note: ' + text('#control-note'));
        setValue('#controlnetMode', 'none');
        const n = stage().pixels(stage().control).data;
        eq([n[0], n[n.length - 4]], [0, 0], 'black');
        check(q('#control-note').hidden, 'no note for none');
        setValue('#controlnetMode', 'canny');
    });
    setView('control');
    shot('control');
    setView('composite');

    test('buildOpts writes init / mask PNGs and carries strength + size', () => {
        loadScene('landscape');
        stage().mask.fill();
        setValue('#fillModeSelect', 'noise');
        setValue('[data-field=strength] input', '0.6');
        const { opts, coverage: c } = buildOpts();
        eq(c, 1, 'full coverage');
        eq([opts.width, opts.height, opts.strength], [512, 512, 0.6], 'size + strength');
        check(fs.existsSync(opts.initImagePath) && fs.existsSync(opts.maskImagePath), 'PNGs written');
        check(opts.controls === undefined, 'no controls before a model registers nets');
        eq(prefs.data.fill, 'noise', 'fill mode persisted');
    });

    test('Generate without a model does nothing', () => {
        check(!studio.run && !studio.loaded, 'idle');
    });
} finally {
    prefs.restore(saved);
}
done();
