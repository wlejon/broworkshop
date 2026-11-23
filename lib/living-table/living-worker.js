// Shared multi-table O(1) COW snapshot Worker for Living Table demos.
// Accepts fresh TableSnapshots via attachTables(), runs relational join / leftJoin +
// fused brass JIT expressions + RangeIndex Top-K + groupBy + bro.tensor analytics,
// and audits saved .brotable v3 checkpoints directly via zero-copy bro.table.mmap().

import { serveWorker } from "/lib/kit/worker-rpc.js";

const tables = new Map();

function getSnap(name) {
    return tables.get(name) || null;
}

function buildExpr(spec) {
    const q = bro.table;
    if (spec == null) return null;
    if (typeof spec !== 'object') return q.lit(spec);
    if (spec.col !== undefined) return q.col(spec.col, spec.side | 0);
    if (spec.lit !== undefined) return q.lit(spec.lit);

    const op = spec.op;
    if (op === 'cond') {
        const c = buildExpr(spec.c);
        const t = buildExpr(spec.t);
        const e = buildExpr(spec.e);
        return q.cond(c, t, e);
    }
    if (op === 'and' || op === 'or') {
        const parts = [];
        for (const arg of (spec.args || [])) {
            parts.push(buildExpr(arg));
        }
        return op === 'and' ? q.and(...parts) : q.or(...parts);
    }

    const a = buildExpr(spec.a);
    switch (op) {
        case 'neg': return q.neg(a);
        case 'abs': return q.abs(a);
        case 'sqrt': return q.sqrt(a);
        case 'floor': return q.floor(a);
        case 'ceil': return q.ceil(a);
        case 'bitNot': return q.bitNot(a);
        case 'not': return q.not(a);
        case 'strLen': return q.strLen(a);
        case 'isNull': return q.isNull(a);
        case 'isNotNull': return q.isNotNull(a);
        default: break;
    }

    const b = buildExpr(spec.b);
    switch (op) {
        case 'add': return q.add(a, b);
        case 'sub': return q.sub(a, b);
        case 'mul': return q.mul(a, b);
        case 'div': return q.div(a, b);
        case 'mod': return q.mod(a, b);
        case 'bitAnd': return q.bitAnd(a, b);
        case 'bitOr': return q.bitOr(a, b);
        case 'bitXor': return q.bitXor(a, b);
        case 'shl': return q.shl(a, b);
        case 'shr': return q.shr(a, b);
        case 'ushr': return q.ushr(a, b);
        case 'eq': return q.eq(a, b);
        case 'ne': return q.ne(a, b);
        case 'lt': return q.lt(a, b);
        case 'le': return q.le(a, b);
        case 'gt': return q.gt(a, b);
        case 'ge': return q.ge(a, b);
        case 'strEq': return q.strEq(a, b);
        case 'strNe': return q.strNe(a, b);
        case 'contains': return q.contains(a, b);
        case 'startsWith': return q.startsWith(a, b);
        case 'endsWith': return q.endsWith(a, b);
        case 'coalesce': return q.coalesce(a, b);
        default: throw new Error('living-worker: unsupported op ' + op);
    }
}

function runQuerySpec(spec) {
    const t0 = performance.now();
    const q = bro.table;
    const leftSnap = getSnap(spec.table);
    if (!leftSnap) return { ok: false, error: 'missing table ' + spec.table, rows: [], ms: 0 };

    let qb = leftSnap.query();
    if (spec.join) {
        const rightSnap = getSnap(spec.join.table);
        if (!rightSnap) return { ok: false, error: 'missing join table ' + spec.join.table, rows: [], ms: 0 };
        const fn = spec.join.kind === 'left' ? 'leftJoin' : 'join';
        qb = qb[fn](rightSnap, spec.join.leftKeys, spec.join.rightKeys);
    }
    if (spec.where) {
        qb = qb.where(buildExpr(spec.where));
    }
    if (spec.spatial) {
        const sp = spec.spatial;
        if (sp.kind === 'radius') qb = qb.whereInRadius(sp.indexName, sp.center, sp.radius);
        else if (sp.kind === 'aabb') qb = qb.whereInAABB(sp.indexName, sp.min, sp.max);
    }
    if (spec.groupBy) {
        qb = qb.groupBy(spec.groupBy);
    }
    if (spec.agg) {
        const aggObj = {};
        for (const [alias, def] of Object.entries(spec.agg)) {
            if (def.fn === 'count') {
                aggObj[alias] = def.expr ? q.count(buildExpr(def.expr)) : q.count();
            } else {
                aggObj[alias] = q[def.fn](buildExpr(def.expr));
            }
        }
        qb = qb.agg(aggObj);
    }
    if (spec.select) {
        const selObj = {};
        for (const [alias, exprDef] of Object.entries(spec.select)) {
            selObj[alias] = typeof exprDef === 'string' ? exprDef : buildExpr(exprDef);
        }
        qb = qb.select(selObj);
    }
    if (spec.orderBy) {
        const ob = spec.orderBy;
        qb = qb.orderBy(typeof ob.expr === 'string' ? ob.expr : buildExpr(ob.expr), ob.desc ? 'desc' : 'asc');
    }
    if (spec.limit != null) qb = qb.limit(spec.limit);

    const ex = qb.explain();
    const res = qb.runWithStats();
    const rows = res.table.toArray();
    return {
        ok: true,
        ms: performance.now() - t0,
        rows,
        rowCount: res.table.rowCount,
        scannedRows: leftSnap.rowCount,
        explain: ex,
        stats: {
            usedJit: res.usedJit,
            usedSimd: res.usedSimd,
            simdWidth: res.simdWidth,
            usedJitAgg: res.usedJitAgg,
            usedIndex: res.usedIndex,
            usedRangeIndex: res.usedRangeIndex,
            usedSpatialIndex: res.usedSpatialIndex,
            strategy: ex.strategy,
        },
    };
}

function runTensorScoring(snapName, cols, weights, bias = 0.0, maxRows = 65536) {
    const s = getSnap(snapName);
    if (!s || s.rowCount === 0) return { ok: false, meanScore: 0, peakScore: 0, ms: 0, backend: 'none' };
    const t0 = performance.now();
    const dims = cols.length;
    const step = Math.max(1, Math.floor(s.rowCount / maxRows));
    const take = Math.min(maxRows, Math.floor(s.rowCount / step));
    const buf = new Float32Array(take * dims);
    const views = new Array(dims);
    let out = 0;
    for (let ci = 0; ci < s.chunkCount && out < take; ci++) {
        const rc = s.chunkRowCount(ci);
        for (let d = 0; d < dims; d++) views[d] = s.chunkColumnView(ci, cols[d]);
        for (let r = 0; r < rc && out < take; r += step) {
            for (let d = 0; d < dims; d++) buf[out * dims + d] = views[d][r];
            out++;
        }
    }

    let scores = new Float32Array(out);
    let backend = 'cpu-js';
    if (bro.tensor && bro.tensor.available) {
        backend = bro.tensor.backend || 'tensor';
        const X = bro.tensor.createTensor(out, dims, 'fp32');
        const W = bro.tensor.createTensor(dims, 1, 'fp32');
        const Y = bro.tensor.createTensor(out, 1, 'fp32');
        X.upload(buf.subarray(0, out * dims));
        W.upload(Float32Array.from(weights));
        bro.tensor.matmul(X, W, Y);
        scores = Y.download();
        try { X.free?.(); W.free?.(); Y.free?.(); } catch (_) {}
    } else {
        for (let i = 0; i < out; i++) {
            let acc = 0;
            for (let d = 0; d < dims; d++) acc += buf[i * dims + d] * weights[d];
            scores[i] = acc;
        }
    }

    let sum = 0;
    let peak = -Infinity;
    let highCount = 0;
    for (let i = 0; i < out; i++) {
        const v = scores[i] + bias;
        sum += v;
        if (v > peak) peak = v;
        if (v > 0.75) highCount++;
    }
    return {
        ok: true,
        backend,
        ms: performance.now() - t0,
        sampled: out,
        meanScore: out > 0 ? sum / out : 0,
        peakScore: Number.isFinite(peak) ? peak : 0,
        highFraction: out > 0 ? highCount / out : 0,
    };
}

serveWorker({
    attachTables(msg) {
        if (msg.tables) {
            for (const [name, snap] of Object.entries(msg.tables)) {
                if (snap) tables.set(name, snap);
            }
        }
        const meta = {};
        for (const [k, s] of tables.entries()) {
            meta[k] = s ? s.stats() : null;
        }
        return { type: 'tablesAttached', meta };
    },

    runBatch(msg) {
        const results = {};
        for (const [key, spec] of Object.entries(msg.queries || {})) {
            results[key] = runQuerySpec(spec);
        }
        const tensorOut = msg.tensor
            ? runTensorScoring(msg.tensor.table, msg.tensor.cols, msg.tensor.weights, msg.tensor.bias || 0, msg.tensor.maxRows || 65536)
            : null;
        return { type: 'batchResult', results, tensor: tensorOut };
    },

    compareMappedCheckpoint(msg) {
        const t0 = performance.now();
        let mSnap = null;
        try {
            mSnap = bro.table.mmap(msg.path, { verify: !!msg.verify });
            const st = mSnap.stats();
            const q = bro.table;
            const liveSnap = getSnap(msg.tableName);

            const chkAgg = mSnap.query().agg({
                cnt: q.count(),
                avgVal: q.avg(msg.col),
                sumVal: q.sum(msg.col),
            }).toArray()[0] || { cnt: 0, avgVal: 0, sumVal: 0 };

            const liveAgg = liveSnap
                ? (liveSnap.query().agg({
                    cnt: q.count(),
                    avgVal: q.avg(msg.col),
                    sumVal: q.sum(msg.col),
                }).toArray()[0] || { cnt: 0, avgVal: 0, sumVal: 0 })
                : null;

            return {
                type: 'checkpointCompared',
                ok: true,
                ms: performance.now() - t0,
                isMapped: mSnap.isMapped,
                stats: st,
                mappedIndexes: st.mappedIndexes || 0,
                chkAgg,
                liveAgg,
                deltaAvg: liveAgg ? (liveAgg.avgVal - chkAgg.avgVal) : 0,
            };
        } catch (err) {
            return {
                type: 'checkpointCompared',
                ok: false,
                error: err && err.message ? err.message : String(err),
            };
        } finally {
            try { mSnap?.close?.(); } catch (_) {}
        }
    },
});
