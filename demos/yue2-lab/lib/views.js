// Canvas views of the pipeline's three products: semantic codec ids, latent
// frames, and the decoded stereo waveform. Each keeps its data and redraws on
// demand (a run calls draw() at most once a frame).

import { fitCanvas } from "/lib/kit/gauges.js";

const BG = '#0d1117', GRID = '#252b36', WAVE = '#7fb4ff', CURSOR = '#ffcc66';

// A code id -> a stable hue, so repeated ids read as repeated colours.
function codeColor(code) {
    const h = (code * 137.508) % 360;
    return 'hsl(' + h.toFixed(1) + ', 62%, ' + (42 + (code % 5) * 5) + '%)';
}

/** Semantic ids as a strip: one column per token, wrapping into rows when long. */
export function semanticView(canvas) {
    let ids = new Int32Array(0), dirty = true;
    const rowsMax = 4;
    return {
        set(all) { ids = all; dirty = true; },
        append(batch) {
            const next = new Int32Array(ids.length + batch.length);
            next.set(ids); next.set(batch, ids.length);
            ids = next; dirty = true;
        },
        get ids() { return ids; },
        draw() {
            if (!dirty) return;
            dirty = false;
            const { ctx, w, h } = fitCanvas(canvas, { height: 40 });
            ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
            if (!ids.length) return;
            const perRow = Math.max(w, Math.ceil(ids.length / rowsMax));
            const rows = Math.ceil(ids.length / perRow), rh = h / rows, cw = w / perRow;
            for (let i = 0; i < ids.length; i++) {
                const r = Math.floor(i / perRow), c = i % perRow;
                ctx.fillStyle = codeColor(ids[i]);
                ctx.fillRect(c * cw, r * rh, Math.max(cw, 1), rh - (rows > 1 ? 1 : 0));
            }
        },
    };
}

/** Latents as a heatmap: 64 rows (dims) x frames (time), diverging colour around 0. */
export function latentView(canvas) {
    let data = new Float32Array(0), frames = 0, dirty = true, scale = 1;
    function rescale() {
        let s = 0;
        for (let i = 0; i < data.length; i++) s = Math.max(s, Math.abs(data[i]));
        scale = s > 0 ? s : 1;
    }
    return {
        set(lat, n) { data = lat; frames = n; rescale(); dirty = true; },
        append(frame0, n, lat) {
            const total = Math.max(frames, frame0 + n);
            if (total * 64 > data.length) {
                const next = new Float32Array(Math.max(total * 64, data.length * 2));
                next.set(data.subarray(0, frames * 64));
                data = next;
            }
            data.set(lat, frame0 * 64);
            frames = total;
            rescale();
            dirty = true;
        },
        get frames() { return frames; },
        latents() { return data.slice(0, frames * 64); },
        draw() {
            if (!dirty) return;
            dirty = false;
            const { ctx, w, h } = fitCanvas(canvas, { height: 96 });
            ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
            if (!frames) return;
            // One image pixel per (frame, dim), scaled to fit.
            const off = document.createElement('canvas');
            off.width = frames; off.height = 64;
            const octx = off.getContext('2d');
            const img = octx.createImageData(frames, 64);
            const px = img.data;
            for (let f = 0; f < frames; f++)
                for (let d = 0; d < 64; d++) {
                    const v = Math.max(-1, Math.min(1, data[f * 64 + d] / scale));
                    const k = (d * frames + f) * 4;
                    const a = Math.abs(v);
                    if (v >= 0) { px[k] = 40 + 215 * a; px[k + 1] = 40 + 120 * a; px[k + 2] = 50; }
                    else { px[k] = 40; px[k + 1] = 60 + 120 * a; px[k + 2] = 60 + 195 * a; }
                    px[k + 3] = 255;
                }
            octx.putImageData(img, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(off, 0, 0, w, h);
        },
    };
}

/** One channel's min/max envelope with a playhead. */
export function waveView(canvas, opts) {
    const o = Object.assign({ height: 56 }, opts);
    let pcm = null, n = 0, cursor = -1, dirty = true;
    return {
        set(samples, count) { pcm = samples; n = count == null ? samples.length : count; dirty = true; },
        cursor(sample) { if (sample !== cursor) { cursor = sample; dirty = true; } },
        draw() {
            if (!dirty) return;
            dirty = false;
            const { ctx, w, h } = fitCanvas(canvas, { height: o.height });
            ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
            const mid = h / 2;
            ctx.strokeStyle = GRID;
            ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
            if (!pcm || !n) return;
            const span = Math.max(n, o.minSamples || 0);
            ctx.strokeStyle = WAVE;
            ctx.beginPath();
            for (let x = 0; x < w; x++) {
                const a = Math.floor(x / w * span), b = Math.min(n, Math.floor((x + 1) / w * span));
                if (a >= n) break;
                let mn = 1, mx = -1;
                for (let i = a; i < Math.max(a + 1, b); i++) { const v = pcm[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
                ctx.moveTo(x + 0.5, mid - mx * mid * 0.95);
                ctx.lineTo(x + 0.5, mid - mn * mid * 0.95);
            }
            ctx.stroke();
            if (cursor >= 0) {
                ctx.fillStyle = CURSOR;
                ctx.fillRect(cursor / span * w - 0.5, 0, 1.5, h);
            }
        },
        set minSamples(v) { o.minSamples = v; dirty = true; },
    };
}
