// Shared O(1) COW snapshot Worker for all sci-atlas demos.
// Receives an immutable TableSnapshot via postMessage, runs parallel GroupBy / AVX2 SIMD
// aggregations / filter mask scans / optional bro.tensor clustering off the page thread.

import { serveWorker } from "/lib/kit/worker-rpc.js";

let snap = null;
let ordinalFilterCache = null;

function buildMaskBitsForFilter(s, filterSpec) {
    // Expects column ordinals or passes rowFilterIndices; simplest zero-copy strategy:
    // if `ordinalCol` is present in schema (uint32 0..N-1) we run an AVX2/JIT query selecting ONLY `ord`,
    // then scatter matched row ordinals into a packed Uint32Array bitset in O(matches).
    const total = s.rowCount;
    const words = Math.ceil(total / 32) || 1;
    const bits = new Uint32Array(words);
    if (!filterSpec || !filterSpec.predicates || filterSpec.predicates.length === 0) {
        bits.fill(0xFFFFFFFF);
        return { bits, matched: total, explain: null };
    }

    const q = bro.table;
    const preds = [];
    for (const p of filterSpec.predicates) {
        if (p.op === 'gt') preds.push(q.gt(p.col, p.val));
        else if (p.op === 'ge') preds.push(q.ge(p.col, p.val));
        else if (p.op === 'lt') preds.push(q.lt(p.col, p.val));
        else if (p.op === 'le') preds.push(q.le(p.col, p.val));
        else if (p.op === 'eq') preds.push(q.eq(p.col, p.val));
        else if (p.op === 'ne') preds.push(q.ne(p.col, p.val));
    }
    let qb = s.query();
    if (preds.length === 1) qb = qb.where(preds[0]);
    else if (preds.length > 1) qb = qb.where(q.and(...preds));

    if (filterSpec.spatial) {
        const sp = filterSpec.spatial;
        if (sp.kind === 'radius') qb = qb.whereInRadius(sp.indexName, sp.center, sp.radius);
        else if (sp.kind === 'aabb') qb = qb.whereInAABB(sp.indexName, sp.min, sp.max);
    }

    const ex = qb.select({ ord: filterSpec.ordCol || 'ord' }).explain();
    const res = qb.select({ ord: filterSpec.ordCol || 'ord' }).runWithStats();
    const outSnap = res.table.snapshot();
    const nChunks = outSnap.chunkCount;
    let matched = outSnap.rowCount;
    for (let ci = 0; ci < nChunks; ci++) {
        const view = outSnap.chunkColumnView(ci, 'ord');
        const rc = outSnap.chunkRowCount(ci);
        for (let r = 0; r < rc; r++) {
            const idx = view[r] >>> 0;
            if (idx < total) bits[idx >>> 5] |= (1 << (idx & 31));
        }
    }
    return {
        bits,
        matched,
        stats: {
            usedJit: res.usedJit,
            usedSimd: res.usedSimd,
            simdWidth: res.simdWidth,
            usedIndex: res.usedIndex,
            usedRangeIndex: res.usedRangeIndex,
            usedSpatialIndex: res.usedSpatialIndex,
            strategy: ex.strategy,
        },
    };
}

function runTensorKMeans(s, cols, k, maxSamples = 65536) {
    // Runs mini-batch k-means on GpuTensor if bro.tensor is available (or JS fallback).
    const nRows = s.rowCount;
    const dims = cols.length;
    const step = Math.max(1, Math.floor(nRows / maxSamples));
    const take = Math.min(maxSamples, Math.floor(nRows / step));
    const data = new Float32Array(take * dims);
    const views = new Array(dims);

    let out = 0;
    const nChunks = s.chunkCount;
    for (let ci = 0; ci < nChunks && out < take; ci++) {
        const rc = s.chunkRowCount(ci);
        for (let d = 0; d < dims; d++) views[d] = s.chunkColumnView(ci, cols[d]);
        for (let r = 0; r < rc && out < take; r += step) {
            for (let d = 0; d < dims; d++) data[out * dims + d] = views[d][r];
            out++;
        }
    }

    // Standardize z-score across sampled points on CPU
    const means = new Float32Array(dims);
    const invStd = new Float32Array(dims);
    for (let i = 0; i < out; i++) {
        for (let d = 0; d < dims; d++) means[d] += data[i * dims + d];
    }
    for (let d = 0; d < dims; d++) means[d] /= Math.max(1, out);
    for (let i = 0; i < out; i++) {
        for (let d = 0; d < dims; d++) {
            const v = data[i * dims + d] - means[d];
            invStd[d] += v * v;
        }
    }
    for (let d = 0; d < dims; d++) {
        const sd = Math.sqrt(invStd[d] / Math.max(1, out));
        invStd[d] = sd > 1e-6 ? 1.0 / sd : 1.0;
    }
    for (let i = 0; i < out; i++) {
        for (let d = 0; d < dims; d++) {
            data[i * dims + d] = (data[i * dims + d] - means[d]) * invStd[d];
        }
    }

    // Initialize centroids from evenly spaced points
    const cent = new Float32Array(k * dims);
    for (let c = 0; c < k; c++) {
        const si = Math.min(out - 1, Math.floor((c + 0.5) * out / k));
        for (let d = 0; d < dims; d++) cent[c * dims + d] = data[si * dims + d];
    }

    const t0 = performance.now();
    let backend = 'cpu-js';
    const assigns = new Int32Array(out);
    const sums = new Float64Array(k * dims);
    const counts = new Int32Array(k);

    if (bro.tensor && bro.tensor.available && bro.tensor.backend !== 'cpu') {
        backend = bro.tensor.backend;
        // Distance via GpuTensor: -2 * X @ C^T + ||C||^2 on GPU!
        const X = bro.tensor.createTensor(out, dims, 'fp32');
        X.upload(data);
        const C = bro.tensor.createTensor(k, dims, 'fp32');
        const Ct = bro.tensor.createTensor(dims, k, 'fp32');
        const scores = bro.tensor.createTensor(out, k, 'fp32');
        const centT = new Float32Array(dims * k);

        for (let iter = 0; iter < 8; iter++) {
            for (let c = 0; c < k; c++) {
                for (let d = 0; d < dims; d++) centT[d * k + c] = cent[c * dims + d];
            }
            Ct.upload(centT);
            bro.tensor.matmul(X, Ct, scores);
            const dotArr = scores.download(); // [out * k]
            const cNorm2 = new Float32Array(k);
            for (let c = 0; c < k; c++) {
                let s2 = 0;
                for (let d = 0; d < dims; d++) s2 += cent[c * dims + d] * cent[c * dims + d];
                cNorm2[c] = 0.5 * s2;
            }
            counts.fill(0);
            sums.fill(0);
            for (let i = 0; i < out; i++) {
                let bestC = 0, bestVal = -Infinity;
                const base = i * k;
                for (let c = 0; c < k; c++) {
                    const obj = dotArr[base + c] - cNorm2[c];
                    if (obj > bestVal) { bestVal = obj; bestC = c; }
                }
                assigns[i] = bestC;
                counts[bestC]++;
                for (let d = 0; d < dims; d++) sums[bestC * dims + d] += data[i * dims + d];
            }
            for (let c = 0; c < k; c++) {
                if (counts[c] > 0) {
                    const inv = 1.0 / counts[c];
                    for (let d = 0; d < dims; d++) cent[c * dims + d] = sums[c * dims + d] * inv;
                }
            }
        }
        try { X.free?.(); C.free?.(); Ct.free?.(); scores.free?.(); } catch (_) {}
    } else {
        for (let iter = 0; iter < 8; iter++) {
            counts.fill(0);
            sums.fill(0);
            for (let i = 0; i < out; i++) {
                let bestC = 0, bestD2 = Infinity;
                for (let c = 0; c < k; c++) {
                    let d2 = 0;
                    for (let d = 0; d < dims; d++) {
                        const df = data[i * dims + d] - cent[c * dims + d];
                        d2 += df * df;
                    }
                    if (d2 < bestD2) { bestD2 = d2; bestC = c; }
                }
                assigns[i] = bestC;
                counts[bestC]++;
                for (let d = 0; d < dims; d++) sums[bestC * dims + d] += data[i * dims + d];
            }
            for (let c = 0; c < k; c++) {
                if (counts[c] > 0) {
                    const inv = 1.0 / counts[c];
                    for (let d = 0; d < dims; d++) cent[c * dims + d] = sums[c * dims + d] * inv;
                }
            }
        }
    }

    // Denormalize centroids for display
    const clusters = [];
    for (let c = 0; c < k; c++) {
        const obj = { id: c, count: counts[c], center: {} };
        for (let d = 0; d < dims; d++) {
            obj.center[cols[d]] = cent[c * dims + d] / invStd[d] + means[d];
        }
        clusters.push(obj);
    }
    return {
        type: 'clusterResult',
        backend,
        ms: performance.now() - t0,
        sampled: out,
        clusters,
    };
}

serveWorker({
    attachSnapshot(msg) {
        snap = msg.snap;
        ordinalFilterCache = null;
        return {
            type: 'snapshotAttached',
            rowCount: snap ? snap.rowCount : 0,
            chunkCount: snap ? snap.chunkCount : 0,
            stats: snap ? snap.stats() : null,
        };
    },

    querySummary(msg) {
        if (!snap) return { type: 'summary', ok: false };
        const t0 = performance.now();
        const q = bro.table;
        let qb = snap.query();
        if (msg.filters && msg.filters.length > 0) {
            const preds = [];
            for (const p of msg.filters) {
                if (p.op === 'gt') preds.push(q.gt(p.col, p.val));
                else if (p.op === 'ge') preds.push(q.ge(p.col, p.val));
                else if (p.op === 'lt') preds.push(q.lt(p.col, p.val));
                else if (p.op === 'le') preds.push(q.le(p.col, p.val));
                else if (p.op === 'eq') preds.push(q.eq(p.col, p.val));
                else if (p.op === 'ne') preds.push(q.ne(p.col, p.val));
            }
            qb = preds.length === 1 ? qb.where(preds[0]) : qb.where(q.and(...preds));
        }

        let groups = null;
        if (msg.groupBy) {
            const aggSpec = { cnt: q.count() };
            if (msg.aggCol) aggSpec.avgVal = q.avg(msg.aggCol);
            const gqb = qb.groupBy(msg.groupBy).agg(aggSpec).orderBy('cnt', 'desc');
            groups = gqb.toArray();
        }

        const totalAgg = {};
        totalAgg.cnt = q.count();
        for (const ac of (msg.sumCols || [])) totalAgg['sum_' + ac] = q.sum(ac);
        for (const ac of (msg.avgCols || [])) totalAgg['avg_' + ac] = q.avg(ac);
        for (const ac of (msg.minCols || [])) totalAgg['min_' + ac] = q.min(ac);
        for (const ac of (msg.maxCols || [])) totalAgg['max_' + ac] = q.max(ac);

        const aggEx = qb.agg(totalAgg).explain();
        const aggRes = qb.agg(totalAgg).runWithStats();
        const dt = performance.now() - t0;

        return {
            type: 'summary',
            ok: true,
            ms: dt,
            rowCount: snap.rowCount,
            agg: aggRes.table.rowCount > 0 ? aggRes.table.row(0) : null,
            groups,
            execStats: {
                usedJit: aggRes.usedJit,
                usedSimd: aggRes.usedSimd,
                simdWidth: aggRes.simdWidth,
                usedJitAgg: aggRes.usedJitAgg,
                strategy: aggEx.strategy,
            },
        };
    },

    filterMask(msg) {
        if (!snap) return { type: 'mask', matched: 0 };
        const t0 = performance.now();
        const res = buildMaskBitsForFilter(snap, msg);
        const dt = performance.now() - t0;
        return {
            type: 'mask',
            ms: dt,
            matched: res.matched,
            total: snap.rowCount,
            stats: res.stats,
            bitsBuffer: res.bits.buffer,
            transfer: [res.bits.buffer],
        };
    },

    clusterTensor(msg) {
        if (!snap) return { type: 'clusterResult', clusters: [] };
        return runTensorKMeans(snap, msg.cols, msg.k || 5, msg.maxSamples || 65536);
    },
});
