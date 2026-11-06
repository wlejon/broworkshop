// lib/kit/look.js — headless look capture, image diffing, crop sheets, and
// in-process A/B GPU timing harness.
//
//   import { captureViews, compareLookSets, abMeasure } from "/lib/kit/look.js";
//
// Works in bro-headless scripts using headless globals (`screenshot`,
// `frameImage`, `writeFile`, `advanceTime`, `flush`, `perf`) and `bro.image`.

const fs = require('fs');

function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function readBytes(path) {
    const raw = fs.readFileSync(path);
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

function writeOut(path, data) {
    if (typeof writeFile === 'function') {
        return writeFile(path, data);
    }
    const dir = normPath(path).slice(0, normPath(path).lastIndexOf('/'));
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, data);
    return data.length || data.byteLength || 0;
}

function savePng(path, pixels, width, height, channels = 4) {
    const u8 = pixels instanceof Uint8Array
        ? pixels
        : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const png = bro.image.encodePng(u8, width, height, channels);
    if (!png) throw new Error('look.js: encodePng failed for ' + path);
    writeOut(path, png);
}

// --- statistics helpers -------------------------------------------------------

export function summarizeSamples(samples) {
    const valid = samples.filter((x) => Number.isFinite(x) && x >= 0);
    if (!valid.length) {
        return { count: 0, mean: 0, median: 0, p25: 0, p75: 0, p95: 0, iqr: 0, min: 0, max: 0, samples: [] };
    }
    const sorted = [...valid].sort((a, b) => a - b);
    const q = (p) => {
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx), hi = Math.ceil(idx);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
    const p25 = q(0.25), median = q(0.5), p75 = q(0.75), p95 = q(0.95);
    return {
        count: sorted.length,
        mean,
        median,
        p25,
        p75,
        p95,
        iqr: p75 - p25,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        samples: valid,
    };
}

function quantileFromHist(hist, total, p) {
    if (total <= 0) return 0;
    const target = total * p;
    let acc = 0;
    for (let i = 0; i < hist.length; i++) {
        acc += hist[i];
        if (acc >= target) return i;
    }
    return hist.length - 1;
}

/**
 * Compute luminance, RGB mean, clipping, and dynamic-range statistics for an
 * RGBA8 buffer (`Uint8Array` or `Uint8ClampedArray`).
 */
export function computeImageStats(pixels, width, height, channels = 4) {
    const n = width * height;
    if (n <= 0) {
        return {
            width, height, pixels: 0,
            rgbMean: [0, 0, 0], rgbMean01: [0, 0, 0],
            luminance: { mean: 0, mean01: 0, p05: 0, p50: 0, p95: 0, min: 0, max: 0, dynamicRange: 0 },
            clippedLowShare: 0, clippedHighShare: 0, nonFiniteShare: 0,
        };
    }
    const hist = new Uint32Array(256);
    let rSum = 0, gSum = 0, bSum = 0, lumaSum = 0;
    let lumaMin = 255, lumaMax = 0;
    let clippedLow = 0, clippedHigh = 0, nonFinite = 0;
    for (let i = 0; i < n; i++) {
        const off = i * channels;
        const r = pixels[off], g = channels > 1 ? pixels[off + 1] : r, b = channels > 2 ? pixels[off + 2] : r;
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
            nonFinite++;
            continue;
        }
        rSum += r; gSum += g; bSum += b;
        if (r === 0 && g === 0 && b === 0) clippedLow++;
        if (r >= 255 || g >= 255 || b >= 255) clippedHigh++;
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumaSum += y;
        if (y < lumaMin) lumaMin = y;
        if (y > lumaMax) lumaMax = y;
        const bin = Math.max(0, Math.min(255, Math.round(y)));
        hist[bin]++;
    }
    const valid = Math.max(1, n - nonFinite);
    const p05 = quantileFromHist(hist, valid, 0.05);
    const p50 = quantileFromHist(hist, valid, 0.50);
    const p95 = quantileFromHist(hist, valid, 0.95);
    const lumaMean = lumaSum / valid;
    const rgbMean = [rSum / valid, gSum / valid, bSum / valid];
    return {
        width,
        height,
        pixels: n,
        rgbMean: rgbMean.map((x) => Number(x.toFixed(2))),
        rgbMean01: rgbMean.map((x) => Number((x / 255).toFixed(4))),
        luminance: {
            mean: Number(lumaMean.toFixed(2)),
            mean01: Number((lumaMean / 255).toFixed(4)),
            p05,
            p50,
            p95,
            min: Number(lumaMin.toFixed(2)),
            max: Number(lumaMax.toFixed(2)),
            dynamicRange: p95 - p05,
        },
        clippedLowShare: Number((clippedLow / n).toFixed(5)),
        clippedHighShare: Number((clippedHigh / n).toFixed(5)),
        nonFiniteShare: Number((nonFinite / n).toFixed(5)),
    };
}

// --- default adapters & timing ------------------------------------------------

function normalizeViews(views) {
    if (Array.isArray(views)) return views;
    if (views && typeof views === 'object') {
        return Object.entries(views).map(([name, spec]) => ({ name, ...spec }));
    }
    throw new Error('look.js: views must be an array or object map');
}

function defaultApplyView(view) {
    if (typeof view.setup === 'function') view.setup(view);
    const p = globalThis.planet;
    if (p && p.cam) {
        for (const k of ['lat', 'lon', 'alt', 'pitch', 'heading']) {
            if (view[k] != null) p.cam[k] = view[k];
        }
        if (view.hour != null && typeof p.setHour === 'function') p.setHour(view.hour);
        if (typeof p.frame === 'function') p.frame();
    }
}

function defaultSettle(view, options = {}) {
    const maxFrames = view.settleFrames ?? options.settleFrames ?? 1200;
    const held = view.held ?? options.held ?? true;
    if (typeof perf !== 'undefined' && typeof perf.settle === 'function') {
        return perf.settle({ maxFrames, held });
    }
    for (let i = 0; i < maxFrames; i++) advanceTime(16);
    flush();
    return { settled: true, frames: maxFrames };
}

function defaultTileStats() {
    const p = globalThis.planet;
    if (!p || !p.cache) return null;
    const s = p.cache.stats || {};
    return {
        visible: p.stats ? p.stats.visible : p.cache.drawCount,
        selected: p.stats ? p.stats.selected : p.cache.wanted,
        resident: p.cache.resident,
        pending: p.cache.pending,
        capacity: p.cache.capacity,
        produced: s.produced || 0,
        evicted: s.evicted || 0,
    };
}

function collectTiming(timingFrames, stepFrame) {
    const n = Math.max(1, timingFrames || 8);
    const hasPerf = typeof perf !== 'undefined';
    if (hasPerf) {
        if (typeof perf.gpuPasses === 'function') perf.gpuPasses();
        if (typeof perf.kernelTimes === 'function') perf.kernelTimes();
        if (typeof perf.gpuFrameMs === 'function') perf.gpuFrameMs();
    }
    const frameSamples = [];
    const passAccum = Object.create(null);
    let passCount = 0;
    for (let i = 0; i < n; i++) {
        stepFrame(i);
        if (hasPerf && typeof perf.gpuFrameMs === 'function') {
            const ms = perf.gpuFrameMs();
            if (ms >= 0) frameSamples.push(ms);
        }
        if (hasPerf && typeof perf.gpuPasses === 'function') {
            const p = perf.gpuPasses() || {};
            let any = false;
            for (const [k, v] of Object.entries(p)) {
                if (typeof v === 'number') {
                    passAccum[k] = (passAccum[k] || 0) + v;
                    any = true;
                } else if (k === 'compute' && v && typeof v === 'object') {
                    for (const [ck, cv] of Object.entries(v)) {
                        if (typeof cv === 'number') passAccum['compute:' + ck] = (passAccum['compute:' + ck] || 0) + cv;
                    }
                }
            }
            if (any) passCount++;
        }
    }
    const passTimes = Object.create(null);
    if (passCount > 0) {
        for (const [k, sum] of Object.entries(passAccum)) {
            passTimes[k] = Number((sum / passCount).toFixed(4));
        }
    }
    let kernelTimes = {};
    if (hasPerf && typeof perf.kernelTimes === 'function') {
        const raw = perf.kernelTimes() || {};
        kernelTimes = {};
        for (const [k, info] of Object.entries(raw)) {
            if (info && typeof info === 'object') {
                kernelTimes[k] = {
                    ms: Number((info.ms / n).toFixed(4)),
                    totalMs: Number(info.ms.toFixed(4)),
                    dispatches: info.dispatches,
                    ...(info.background ? { background: true } : {}),
                };
            }
        }
    }
    return {
        frameTimes: summarizeSamples(frameSamples),
        passTimes,
        kernelTimes,
    };
}

// --- 1. captureViews ----------------------------------------------------------

/**
 * Capture a set of named views to `<outDir>/<setName>/`, extracting any named
 * crops, computing image statistics and GPU timings, and writing `manifest.json`.
 *
 * @param {Array|Object} views array or map of `{ name, lat, lon, alt, pitch, heading, hour, fov, settleFrames, setup, crops }`
 * @param {Object} [options]
 * @param {string} [options.outDir='tests/out/look']
 * @param {string} [options.setName='default']
 * @param {string[]} [options.only] optional list of view names to capture
 * @param {number} [options.settleFrames=1200]
 * @param {number} [options.timingFrames=8]
 * @param {Function} [options.applyView]
 * @param {Function} [options.settle]
 * @param {Function} [options.stepFrame]
 * @param {Function} [options.getTileStats]
 */
export function captureViews(views, options = {}) {
    const outDir = normPath(options.outDir || 'tests/out/look');
    const setName = options.setName || 'default';
    const setDir = outDir + '/' + setName;
    const applyView = options.applyView || defaultApplyView;
    const settle = options.settle || ((v) => defaultSettle(v, options));
    const stepFrame = options.stepFrame || (() => { advanceTime(16); flush(); });
    const getTileStats = options.getTileStats || defaultTileStats;
    const timingFrames = options.timingFrames ?? 8;

    let list = normalizeViews(views);
    if (options.only && options.only.length) {
        const allow = new Set(options.only);
        list = list.filter((v) => allow.has(v.name));
    }

    const manifest = {
        setName,
        createdAt: new Date().toISOString(),
        outDir: setDir,
        views: {},
    };

    console.log(`look: capturing ${list.length} view(s) into ${setDir}`);
    for (const view of list) {
        const t0 = Date.now();
        applyView(view);
        const settleInfo = settle(view);
        const timing = collectTiming(timingFrames, stepFrame);
        const tileStats = getTileStats(view);

        flush();
        const imgPath = `${setDir}/${view.name}.png`;
        const frame = frameImage();
        const frameU8 = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
        if (typeof screenshot === 'function') {
            screenshot(imgPath);
        } else {
            savePng(imgPath, frameU8, frame.width, frame.height, 4);
        }

        const stats = computeImageStats(frameU8, frame.width, frame.height, 4);
        const cropEntries = {};
        if (Array.isArray(view.crops)) {
            for (const c of view.crops) {
                const x = Math.max(0, Math.min(frame.width - 1, Math.round(c.x)));
                const y = Math.max(0, Math.min(frame.height - 1, Math.round(c.y)));
                const w = Math.max(1, Math.min(frame.width - x, Math.round(c.w)));
                const h = Math.max(1, Math.min(frame.height - y, Math.round(c.h)));
                const cropPixels = new Uint8Array(w * h * 4);
                bro.image.cropU8(cropPixels, frameU8, {
                    srcW: frame.width, srcH: frame.height, channels: 4, x, y, w, h,
                });
                const cropFile = `${view.name}__${c.name}.png`;
                savePng(`${setDir}/${cropFile}`, cropPixels, w, h, 4);
                cropEntries[c.name] = {
                    name: c.name,
                    file: cropFile,
                    rect: { x, y, w, h },
                    stats: computeImageStats(cropPixels, w, h, 4),
                };
            }
        }

        const wallMs = Date.now() - t0;
        manifest.views[view.name] = {
            name: view.name,
            file: `${view.name}.png`,
            spec: {
                lat: view.lat, lon: view.lon, alt: view.alt,
                pitch: view.pitch, heading: view.heading, hour: view.hour, fov: view.fov,
            },
            settle: settleInfo,
            wallMs,
            stats,
            frameTimes: timing.frameTimes,
            passTimes: timing.passTimes,
            kernelTimes: timing.kernelTimes,
            tileStats,
            crops: cropEntries,
        };
        console.log(
            `  ${view.name.padEnd(14)} gpu ${timing.frameTimes.median.toFixed(2)} ms ` +
            `(iqr ${timing.frameTimes.iqr.toFixed(2)})  luma ${stats.luminance.mean.toFixed(1)} ` +
            `(p50 ${stats.luminance.p50}, p95 ${stats.luminance.p95})  [${wallMs} ms]`
        );
    }

    const manifestPath = `${setDir}/manifest.json`;
    writeOut(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}

// --- 2. compareLookSets -------------------------------------------------------

function decodePng(path) {
    let img;
    try {
        img = bro.image.decodeOriented(readBytes(path));
    } catch (_) {
        img = bro.image.decodeOriented(path);
    }
    if (!img || !img.width || !img.height) {
        throw new Error('look.js: failed to decode ' + path + (img && img.error ? ' (' + img.error + ')' : ''));
    }
    return img;
}

function diffMetricsAndMap(pixelsA, pixelsB, width, height, amplify = 6) {
    const n = width * height;
    const diffImg = new Uint8Array(n * 4);
    const hist = new Uint32Array(256);
    let absSum = 0, sqSum = 0, maxDiff = 0;

    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const dr = Math.abs(pixelsB[o] - pixelsA[o]);
        const dg = Math.abs(pixelsB[o + 1] - pixelsA[o + 1]);
        const db = Math.abs(pixelsB[o + 2] - pixelsA[o + 2]);
        absSum += dr + dg + db;
        sqSum += dr * dr + dg * dg + db * db;
        const m = Math.max(dr, dg, db);
        if (m > maxDiff) maxDiff = m;
        hist[m]++;

        // Amplified false-color/RGB diff visualization
        diffImg[o] = Math.min(255, Math.round(dr * amplify));
        diffImg[o + 1] = Math.min(255, Math.round(dg * amplify));
        diffImg[o + 2] = Math.min(255, Math.round(db * amplify));
        diffImg[o + 3] = 255;
    }

    const channels = Math.max(1, n * 3);
    const mae = absSum / channels;
    const rmse = Math.sqrt(sqSum / channels);
    const p95Diff = quantileFromHist(hist, n, 0.95);
    const p99Diff = quantileFromHist(hist, n, 0.99);

    let ssim = null, psnr = null;
    if (typeof bro.image.compare === 'function') {
        const cmp = bro.image.compare(pixelsA, pixelsB, { width, height, channels: 4 });
        ssim = Number(cmp.ssim.toFixed(5));
        psnr = Number.isFinite(cmp.psnr) ? Number(cmp.psnr.toFixed(2)) : null;
    }

    return {
        metrics: {
            mae: Number(mae.toFixed(4)),
            mae01: Number((mae / 255).toFixed(6)),
            rmse: Number(rmse.toFixed(4)),
            rmse01: Number((rmse / 255).toFixed(6)),
            maxDiff,
            p95Diff,
            p99Diff,
            ...(ssim != null ? { ssim } : {}),
            ...(psnr != null ? { psnr } : {}),
        },
        diffPixels: diffImg,
    };
}

function buildHorizontalStrip(panels, panelW, panelH, gap = 4, bg = [24, 24, 28, 255]) {
    return copyPanelsHorizontally(panels, panelW, panelH, gap, bg);
}

function copyPanelsHorizontally(panels, panelW, panelH, gap = 4, bg = [24, 24, 28, 255]) {
    const totalW = panels.length * panelW + (panels.length - 1) * gap;
    const out = new Uint8Array(totalW * panelH * 4);
    for (let i = 0; i < totalW * panelH; i++) {
        out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = bg[3];
    }
    for (let p = 0; p < panels.length; p++) {
        const src = panels[p];
        const offX = p * (panelW + gap);
        for (let y = 0; y < panelH; y++) {
            const srcRow = y * panelW * 4;
            const dstRow = (y * totalW + offX) * 4;
            out.set(src.subarray(srcRow, srcRow + panelW * 4), dstRow);
        }
    }
    return { pixels: out, width: totalW, height: panelH };
}

function stackRowsVertically(rows, gap = 6, bg = [24, 24, 28, 255]) {
    const totalW = Math.max(...rows.map((r) => r.width));
    const totalH = rows.reduce((s, r) => s + r.height, 0) + (rows.length - 1) * gap;
    const out = new Uint8Array(totalW * totalH * 4);
    for (let i = 0; i < totalW * totalH; i++) {
        out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = bg[3];
    }
    let offY = 0;
    for (const r of rows) {
        for (let y = 0; y < r.height; y++) {
            const srcRow = y * r.width * 4;
            const dstRow = ((offY + y) * totalW) * 4;
            out.set(r.pixels.subarray(srcRow, srcRow + r.width * 4), dstRow);
        }
        offY += r.height + gap;
    }
    return { pixels: out, width: totalW, height: totalH };
}

/**
 * Compare two look capture directories (`dirA` and `dirB`), writing diff strips,
 * crop comparison sheets, and `comparison.json` to `outDir`.
 */
export function compareLookSets(dirA, dirB, outDir, options = {}) {
    const aRoot = normPath(dirA);
    const bRoot = normPath(dirB);
    const dstRoot = normPath(outDir || (bRoot + '-vs-' + aRoot.split('/').pop()));
    const amplify = options.amplify ?? 6;
    const stripScale = options.stripScale ?? 0.5;

    const manA = readJson(`${aRoot}/manifest.json`);
    const manB = readJson(`${bRoot}/manifest.json`);
    const names = Object.keys(manA.views || {}).filter((k) => manB.views && k in manB.views);

    const comparison = {
        dirA: aRoot,
        dirB: bRoot,
        outDir: dstRoot,
        createdAt: new Date().toISOString(),
        views: {},
    };

    const tableRows = [];
    for (const name of names) {
        const va = manA.views[name];
        const vb = manB.views[name];
        const imgA = decodePng(`${aRoot}/${va.file}`);
        let imgB = decodePng(`${bRoot}/${vb.file}`);
        if (imgB.width !== imgA.width || imgB.height !== imgA.height) {
            const resized = new Uint8Array(imgA.width * imgA.height * 4);
            bro.image.resizeU8(resized, imgB.pixels, {
                srcW: imgB.width, srcH: imgB.height,
                dstW: imgA.width, dstH: imgA.height,
                channels: 4, filter: 'area',
            });
            imgB = { width: imgA.width, height: imgA.height, channels: 4, pixels: resized };
        }

        const { metrics, diffPixels } = diffMetricsAndMap(imgA.pixels, imgB.pixels, imgA.width, imgA.height, amplify);

        // Write side-by-side + amplified diff strip: [A | B | Diff]
        const pw = Math.max(1, Math.round(imgA.width * stripScale));
        const ph = Math.max(1, Math.round(imgA.height * stripScale));
        const panels = [imgA.pixels, imgB.pixels, diffPixels].map((src) => {
            if (pw === imgA.width && ph === imgA.height) return src;
            const dst = new Uint8Array(pw * ph * 4);
            bro.image.resizeU8(dst, src, {
                srcW: imgA.width, srcH: imgA.height, dstW: pw, dstH: ph, channels: 4, filter: 'area',
            });
            return dst;
        });
        const strip = buildHorizontalStrip(panels, pw, ph, 4);
        const diffFile = `${name}-diff.png`;
        savePng(`${dstRoot}/${diffFile}`, strip.pixels, strip.width, strip.height, 4);

        // Build crop sheet if view has crops
        const cropDiffs = {};
        const cropSheetRows = [];
        const cropsA = va.crops || {};
        const cropsB = vb.crops || {};
        for (const cropName of Object.keys(cropsA)) {
            const ca = cropsA[cropName];
            const rect = ca.rect;
            if (!rect) continue;
            const cA = new Uint8Array(rect.w * rect.h * 4);
            const cB = new Uint8Array(rect.w * rect.h * 4);
            bro.image.cropU8(cA, imgA.pixels, { srcW: imgA.width, srcH: imgA.height, channels: 4, ...rect });
            bro.image.cropU8(cB, imgB.pixels, { srcW: imgA.width, srcH: imgA.height, channels: 4, ...rect });
            const cDiff = diffMetricsAndMap(cA, cB, rect.w, rect.h, amplify);
            cropDiffs[cropName] = {
                rect,
                metrics: cDiff.metrics,
                statsA: ca.stats,
                statsB: cropsB[cropName] ? cropsB[cropName].stats : computeImageStats(cB, rect.w, rect.h, 4),
            };
            cropSheetRows.push(copyPanelsHorizontally([cA, cB, cDiff.diffPixels], rect.w, rect.h, 4));
        }
        let cropsFile = null;
        if (cropSheetRows.length > 0) {
            const sheet = stackRowsVertically(cropSheetRows, 6);
            cropsFile = `${name}-crops.png`;
            savePng(`${dstRoot}/${cropsFile}`, sheet.pixels, sheet.width, sheet.height, 4);
        }

        // Timing delta
        const msA = va.frameTimes ? va.frameTimes.median : 0;
        const msB = vb.frameTimes ? vb.frameTimes.median : 0;
        const deltaMs = msB - msA;
        const deltaPct = msA > 0 ? (deltaMs / msA) * 100 : 0;

        comparison.views[name] = {
            name,
            diffFile,
            cropsFile,
            metrics,
            timing: {
                medianMsA: Number(msA.toFixed(4)),
                medianMsB: Number(msB.toFixed(4)),
                deltaMs: Number(deltaMs.toFixed(4)),
                deltaPct: Number(deltaPct.toFixed(2)),
            },
            luma: {
                meanA: va.stats?.luminance?.mean ?? 0,
                meanB: vb.stats?.luminance?.mean ?? 0,
                delta: Number(((vb.stats?.luminance?.mean ?? 0) - (va.stats?.luminance?.mean ?? 0)).toFixed(2)),
            },
            crops: cropDiffs,
        };

        tableRows.push(
            `| ${name.padEnd(14)} | ${metrics.mae.toFixed(2).padStart(6)} | ${metrics.rmse.toFixed(2).padStart(6)} | ` +
            `${String(metrics.p95Diff).padStart(4)} | ${String(metrics.p99Diff).padStart(4)} | ${String(metrics.maxDiff).padStart(4)} | ` +
            `${msA.toFixed(2).padStart(6)} -> ${msB.toFixed(2).padStart(6)} (${(deltaMs >= 0 ? '+' : '') + deltaMs.toFixed(2)} ms, ${(deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(1)}%) |`
        );
    }

    writeOut(`${dstRoot}/comparison.json`, JSON.stringify(comparison, null, 2) + '\n');

    console.log(`\n### Look Comparison: ${aRoot} vs ${bRoot}`);
    console.log(`| View           |    MAE |   RMSE |  p95 |  p99 |  max | GPU Frame Median (A -> B) |`);
    console.log(`|----------------|--------|--------|------|------|------|---------------------------|`);
    for (const row of tableRows) console.log(row);
    console.log(`Saved diff strips and comparison.json to ${dstRoot}\n`);

    return comparison;
}

// --- 3. abMeasure (Wishlist 2.2) ----------------------------------------------

function makeCallback(setup) {
    if (typeof setup === 'function') return setup;
    if (typeof setup === 'string' && typeof perf !== 'undefined' && typeof perf.useShaderSet === 'function') {
        if (setup === 'a' || setup === 'b') return () => perf.useShaderSet(setup);
        return () => { perf.loadShaderSet(setup); perf.useShaderSet('b'); };
    }
    return () => {};
}

/**
 * In-process interleaved A/B GPU timing harness.
 * Alternates rounds of `setupA` and `setupB` in the same headless process so
 * GPU clock/thermal drift affects both equally.
 *
 * @param {Function|string} setupA function called to activate state A (or 'a')
 * @param {Function|string} setupB function called to activate state B (or 'b' / shader dir)
 * @param {Object} [options]
 * @param {number} [options.warmup=4] warmup frames per state before measurement
 * @param {number} [options.rounds=16] number of interleaved A/B pairs
 * @param {number} [options.framesPerRound=2] timed frames per state in each round
 * @param {number} [options.switchSettleFrames=0] untimed frames after switching state
 * @param {boolean} [options.randomizeOrder=true] randomize A/B vs B/A order per round
 * @param {Function} [options.stepFrame]
 * @param {string} [options.labelA='A']
 * @param {string} [options.labelB='B']
 */
export function abMeasure(setupA, setupB, options = {}) {
    const fnA = makeCallback(setupA);
    const fnB = makeCallback(setupB);
    const warmup = options.warmup ?? 4;
    const rounds = options.rounds ?? 16;
    const framesPerRound = options.framesPerRound ?? 2;
    const switchSettleFrames = options.switchSettleFrames ?? 0;
    const randomize = options.randomizeOrder ?? true;
    const stepFrame = options.stepFrame || (() => { advanceTime(16); flush(); });
    const labelA = options.labelA || 'A';
    const labelB = options.labelB || 'B';

    const hasPerf = typeof perf !== 'undefined';
    if (hasPerf) {
        if (typeof perf.gpuPasses === 'function') perf.gpuPasses();
        if (typeof perf.kernelTimes === 'function') perf.kernelTimes();
    }

    // Warmup both paths
    for (const fn of [fnA, fnB]) {
        fn(-1);
        for (let i = 0; i < warmup; i++) {
            stepFrame(i);
            if (hasPerf && typeof perf.gpuFrameMs === 'function') perf.gpuFrameMs();
        }
    }
    if (hasPerf && typeof perf.kernelTimes === 'function') perf.kernelTimes();

    const samplesA = [], samplesB = [], pairDeltas = [];
    const passesA = Object.create(null), passesB = Object.create(null);
    let passCountA = 0, passCountB = 0;

    let seed = 1337;
    const nextBit = () => { seed = (seed * 16807) % 2147483647; return seed & 1; };

    function runSlot(fn, r, samplesOut, passAccum) {
        fn(r);
        for (let s = 0; s < switchSettleFrames; s++) {
            stepFrame(s);
            if (hasPerf && typeof perf.gpuFrameMs === 'function') perf.gpuFrameMs();
        }
        let slotSum = 0, slotCount = 0, gotPasses = 0;
        for (let f = 0; f < framesPerRound; f++) {
            stepFrame(f);
            if (hasPerf && typeof perf.gpuFrameMs === 'function') {
                const ms = perf.gpuFrameMs();
                if (ms >= 0) {
                    samplesOut.push(ms);
                    slotSum += ms;
                    slotCount++;
                }
            }
            if (hasPerf && typeof perf.gpuPasses === 'function') {
                const p = perf.gpuPasses() || {};
                for (const [k, v] of Object.entries(p)) {
                    if (typeof v === 'number') passAccum[k] = (passAccum[k] || 0) + v;
                }
                gotPasses++;
            }
        }
        if (hasPerf && typeof perf.kernelTimes === 'function') perf.kernelTimes();
        return { mean: slotCount > 0 ? slotSum / slotCount : 0, gotPasses };
    }

    for (let r = 0; r < rounds; r++) {
        const bFirst = randomize && nextBit() === 1;
        let resA, resB;
        if (bFirst) {
            resB = runSlot(fnB, r, samplesB, passesB);
            resA = runSlot(fnA, r, samplesA, passesA);
        } else {
            resA = runSlot(fnA, r, samplesA, passesA);
            resB = runSlot(fnB, r, samplesB, passesB);
        }
        passCountA += resA.gotPasses;
        passCountB += resB.gotPasses;
        pairDeltas.push(resB.mean - resA.mean);
    }

    const statA = summarizeSamples(samplesA);
    const statB = summarizeSamples(samplesB);
    const deltaMs = statB.median - statA.median;
    const deltaPct = statA.median > 0 ? (deltaMs / statA.median) * 100 : 0;

    const pairMean = pairDeltas.reduce((s, x) => s + x, 0) / Math.max(1, pairDeltas.length);
    const pairVar = pairDeltas.reduce((s, x) => s + (x - pairMean) ** 2, 0) / Math.max(1, pairDeltas.length - 1);
    const pairSe = Math.sqrt(pairVar / Math.max(1, pairDeltas.length));

    const passBreakdown = {};
    const allPassNames = new Set([...Object.keys(passesA), ...Object.keys(passesB)]);
    for (const k of allPassNames) {
        const aMs = passCountA > 0 ? (passesA[k] || 0) / passCountA : 0;
        const bMs = passCountB > 0 ? (passesB[k] || 0) / passCountB : 0;
        passBreakdown[k] = {
            a: Number(aMs.toFixed(4)),
            b: Number(bMs.toFixed(4)),
            deltaMs: Number((bMs - aMs).toFixed(4)),
        };
    }

    console.log(
        `abMeasure [${labelA} vs ${labelB}] (${rounds} rounds x ${framesPerRound} frames):\n` +
        `  ${labelA}: median ${statA.median.toFixed(3)} ms (iqr ${statA.iqr.toFixed(3)}, mean ${statA.mean.toFixed(3)})\n` +
        `  ${labelB}: median ${statB.median.toFixed(3)} ms (iqr ${statB.iqr.toFixed(3)}, mean ${statB.mean.toFixed(3)})\n` +
        `  delta (${labelB} - ${labelA}): ${(deltaMs >= 0 ? '+' : '') + deltaMs.toFixed(3)} ms ` +
        `(${(deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(2)}%, paired mean ${(pairMean >= 0 ? '+' : '') + pairMean.toFixed(3)} ± ${pairSe.toFixed(3)} ms)`
    );

    return {
        a: statA,
        b: statB,
        deltaMs: Number(deltaMs.toFixed(4)),
        deltaPct: Number(deltaPct.toFixed(2)),
        paired: {
            meanMs: Number(pairMean.toFixed(4)),
            seMs: Number(pairSe.toFixed(4)),
            rounds,
            framesPerRound,
        },
        passes: passBreakdown,
    };
}
