// analysis.js — page side of the bro.media analysis: runs peaks + thumbnails
// in analysis-worker.js and summarises the results for the diagnostics panel.

import { workerClient } from "/lib/kit/worker-rpc.js";

export const DEFAULT_OPTS = { buckets: 1024, count: 16, height: 72 };

/**
 * Handle: analyze(path, { buckets, count, height, from, to }) ->
 * Promise<{ peaks, strip, from, to, ms }>, where from/to is the span asked
 * for (to 0 = the end). A newer analyze() supersedes an older one: the older
 * promise rejects with err.abandoned so a slow decode cannot land late.
 */
export function createAnalyzer() {
    const rpc = workerClient('analysis-worker.js', { type: 'module' });
    return {
        rpc,
        async analyze(path, o) {
            const opts = Object.assign({}, DEFAULT_OPTS, o);
            const span = {};
            if (opts.from > 0) span.from = opts.from;
            if (opts.to > 0) span.to = opts.to;
            rpc.abandon();
            await rpc.ready;
            const t0 = Date.now();
            const r = await rpc.request({
                type: 'analyze', path,
                peaks: Object.assign({ buckets: opts.buckets }, span),
                thumbs: Object.assign({ count: opts.count, height: opts.height }, span),
            });
            return { peaks: r.peaks, strip: r.strip, from: opts.from || 0, to: opts.to || 0, ms: Date.now() - t0 };
        },
    };
}

/** Envelope extremes and mean loudness of a peaks result: { max, min, rmsAvg } (null for none). */
export function peakStats(peaks) {
    if (!peaks || !peaks.buckets) return null;
    let max = -Infinity, min = Infinity, sum = 0;
    for (let i = 0; i < peaks.buckets; i++) {
        if (peaks.max[i] > max) max = peaks.max[i];
        if (peaks.min[i] < min) min = peaks.min[i];
        sum += peaks.rms[i];
    }
    return { max, min, rmsAvg: sum / peaks.buckets };
}

/** "16:9", "4:3", or "1.85:1" for a picture size. */
export function aspectRatio(w, h) {
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h), nw = w / d, nh = h / d;
    if (nw <= 24 && nh <= 24) return nw + ':' + nh;
    const r = w / h;
    for (const [name, v] of [['16:9', 16 / 9], ['4:3', 4 / 3], ['21:9', 21 / 9], ['1:1', 1]]) {
        if (Math.abs(r - v) < 0.05) return name;
    }
    return r.toFixed(2) + ':1';
}

/** "mm:ss.mmm". */
export function timecode(sec) {
    const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
    const ms = Math.floor((s % 1) * 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0') +
        '.' + String(ms).padStart(3, '0');
}
