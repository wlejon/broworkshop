// Image Kernels — bro.image's composable typed-array kernels, live. Six verbs
// work on whole TypedArray buffers from C++ (JS never enters the per-pixel
// loop), op behaviour is a small struct, and every buffer is caller-allocated
// and reused across frames:
//
//   bro.image.alloc      every reusable buffer              (pipeline.js)
//   bro.image.map        affine / abs / log / sqrt / exp / pow stage
//   bro.image.combine    blend with a second source (add .. wsum)
//   bro.image.stencil    box / gaussian / sobel / edge-mag / sharpen / emboss
//   bro.image.resample   downsample → upsample (nearest vs bilinear)
//   bro.image.reduce     minmax (auto range) / mean / sum / histogram (chart + eq LUT)
//   bro.image.gradient   six LUTs incl. stepped / threshold / cyclic   (kernels.js)
//   bro.image.lookup     CPU colorize into ImageData.data
//   bro.image.gpu.colormap  GPU colorize: autoRange + a scrolling viewRect
//
// This file owns the view: controls, the CPU/GPU colorize, the histogram and
// the frame loop.

import { boot } from "/lib/kit/app.js";
import { $, ids } from "/lib/kit/dom.js";
import { stats, fpsMeter, toggleButton, frameLoop } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";
import { buildGradient, buildEqLut } from "/app/kernels.js";
import { stages, field, allocField, applyPipeline } from "/app/pipeline.js";
import { buildCards, paintTimes } from "/app/cards.js";

/** View state; tests read and drive it. */
export const view = {
    source: 'fbm', gradient: 'viridis', rangeMode: 'auto', lo: 0, hi: 1,
    gpu: true, animate: true,
    time: 0, scroll: 0,
    lut: null, eqLut: new Uint8Array(256 * 4),
    range: { min: 0, max: 1 },
    cpuMs: 0, gpuMs: 0,
    drawn: { cpu: 0, gpu: 0 },   // frames colorized per path (headless ms read 0)
    cards: null,
};

let el = null, gl = null, cpuCtx = null, histCtx = null, imgData = null, cpuResampled = null;

function colorizeCPU(buf, eqActive) {
    const cw = el.cpu.width, ch = el.cpu.height;
    if (!imgData || imgData.width !== cw || imgData.height !== ch) imgData = cpuCtx.createImageData(cw, ch);
    // Resample the field to canvas size so the colorize is a single lookup.
    let src = buf;
    if (cw !== field.w || ch !== field.h) {
        if (!cpuResampled || cpuResampled.length !== cw * ch) cpuResampled = bro.image.alloc(cw, ch, 1);
        bro.image.resample(cpuResampled, buf, { srcW: field.w, srcH: field.h, dstW: cw, dstH: ch, channels: 1, filter: 'bilinear' });
        src = cpuResampled;
    }
    const t0 = performance.now();
    let lut = view.lut, edge = view.gradient === 'cyclic' ? 'wrap' : 'clamp';
    if (eqActive) { lut = buildEqLut(src, view.range.min, view.range.max, view.eqLut); edge = 'clamp'; }
    bro.image.lookup(imgData.data, src, lut, { lo: view.range.min, hi: view.range.max, edge });
    cpuCtx.putImageData(imgData, 0, 0);
    view.cpuMs = performance.now() - t0;
    view.drawn.cpu++;
}

function colorizeGPU(buf, eqActive) {
    if (!gl) gl = el.gpu.getContext('webgl2');
    const lut = eqActive ? buildEqLut(buf, view.range.min, view.range.max, view.eqLut) : view.lut;
    const t0 = performance.now();
    const params = { srcW: field.w, srcH: field.h };
    if (view.rangeMode === 'auto') { params.autoRange = true; params.ema = 0.15; }
    else { params.lo = view.range.min; params.hi = view.range.max; }
    // Slide a window across the field so the viewRect path is exercised.
    const winW = Math.max(8, field.w - 48);
    params.viewRect = { x: Math.floor((Math.sin(view.scroll) * 0.5 + 0.5) * (field.w - winW)), y: 0, w: winW, h: field.h };
    bro.image.gpu.colormap(el.gpu, buf, lut, params);
    if (gl) gl.finish();          // time the GPU work, not just its submission
    view.gpuMs = performance.now() - t0;
    view.drawn.gpu++;
}

function drawHistogram(buf) {
    const w = el.hist.width, hgt = el.hist.height, BINS = 96;
    histCtx.fillStyle = '#0b0e14';
    histCtx.fillRect(0, 0, w, hgt);
    const hist = bro.image.reduce(buf, 'histogram', { bins: BINS, lo: view.range.min, hi: view.range.max });
    let peak = 1;
    for (let i = 0; i < BINS; i++) if (hist[i] > peak) peak = hist[i];
    const bw = w / BINS;
    for (let i = 0; i < BINS; i++) {
        // Bars tinted by the active LUT, so the chart reads as the tone map.
        const li = Math.min(255, Math.floor(i / (BINS - 1) * 255)) * 4;
        histCtx.fillStyle = 'rgb(' + view.lut[li] + ',' + view.lut[li + 1] + ',' + view.lut[li + 2] + ')';
        const barH = Math.pow(hist[i] / peak, 0.6) * (hgt - 10);
        histCtx.fillRect(i * bw, hgt - barH, Math.max(1, bw - 0.5), barH);
    }
}

/** One frame: pipeline → range → colorize → histogram. Returns the pipeline result. */
export function renderFrame() {
    const p0 = performance.now();
    const r = applyPipeline({ source: view.source, animate: view.animate, time: view.time });
    const pipeMs = performance.now() - p0;

    // Auto range reduces on the CPU for the HUD, the histogram and the CPU path;
    // the GPU autoRange computes its own on-device.
    if (view.rangeMode === 'auto') {
        const mm = bro.image.reduce(r.buf, 'minmax');
        view.range.min = mm.min; view.range.max = mm.max;
    } else {
        view.range.min = view.lo; view.range.max = view.hi;
    }
    if (view.range.max - view.range.min < 1e-6) view.range.max = view.range.min + 1e-6;

    const c0 = performance.now();
    if (view.gpu) colorizeGPU(r.buf, r.eqActive);
    else colorizeCPU(r.buf, r.eqActive);
    const colorMs = performance.now() - c0;
    drawHistogram(r.buf);

    return Object.assign(r, { pipeMs, colorMs,
        mean: bro.image.reduce(r.buf, 'mean'), sum: bro.image.reduce(r.buf, 'sum') });
}

function resize() {
    const box = el.cpu.parentElement;
    el.cpu.width = el.gpu.width = box.clientWidth;
    el.cpu.height = el.gpu.height = box.clientHeight;
    el.hist.width = el.hist.clientWidth;
    el.hist.height = el.hist.clientHeight;
    imgData = null;
}

export function setRenderer(gpu) {
    view.gpu = !!gpu;
    el.cpu.hidden = view.gpu;
    el.gpu.hidden = !view.gpu;
    el.renderer.textContent = 'renderer: ' + (view.gpu ? 'GPU' : 'CPU');
}

export function init() {
    boot();
    el = ids('cpu', 'gpu', 'hist', 'renderer', 'lo-wrap', 'hi-wrap', 'pipeline');
    cpuCtx = el.cpu.getContext('2d');
    histCtx = el.hist.getContext('2d');

    bindControl('#source', { onChange: (v) => { view.source = v; field.sourceDirty = true; } });
    bindControl('#field-size', { onChange: (v) => allocField(+v, +v) });
    bindControl('#gradient', { onChange: (v) => { view.gradient = v; view.lut = buildGradient(v); } });
    bindControl('#range-mode', { onChange: (v) => {
        view.rangeMode = v;
        el.loWrap.hidden = el.hiWrap.hidden = v !== 'manual';
    } });
    bindControl('#lo', { out: '#lo-val', onChange: (v) => { view.lo = v; } });
    bindControl('#hi', { out: '#hi-val', onChange: (v) => { view.hi = v; } });
    el.renderer.addEventListener('click', () => setRenderer(!view.gpu));
    toggleButton('#animate', { on: true, onChange: (on) => { view.animate = on; } });

    resize();
    window.addEventListener('resize', resize);
    allocField(+$('#field-size').value, +$('#field-size').value);
    view.lut = buildGradient(view.gradient);
    setRenderer(true);
    view.cards = buildCards(el.pipeline, stages);

    const hud = stats('#stats');
    const fps = fpsMeter();
    frameLoop((dt) => {
        if (view.animate) { view.time += dt; view.scroll += dt * 0.6; }
        const r = renderFrame();
        paintTimes(view.cards, stages);
        hud.set({
            fps: fps.tick().toFixed(0),
            csize: el.cpu.width + '×' + el.cpu.height, fsize: field.w + '×' + field.h,
            rmode: view.gpu ? 'GPU' : 'CPU',
            tcolor: r.colorMs.toFixed(2), tpipe: r.pipeMs.toFixed(2),
            tcpu: view.cpuMs > 0 ? view.cpuMs.toFixed(2) + ' ms' : '—',
            tgpu: view.gpuMs > 0 ? view.gpuMs.toFixed(2) + ' ms' : '—',
            rmin: view.range.min.toFixed(3), rmax: view.range.max.toFixed(3),
            rmean: r.mean.toFixed(3), rsum: r.sum.toExponential(2),
        });
    });
}
