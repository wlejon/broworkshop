// Market Microstructure Observatory headless integration test.
// Run sequentially via: scripts/validate.sh demos/market-microstructure

import { check, test, frames, waitFor, clickOn, shot, text, q, done } from "/lib/kit/test.js";

const fs = require('fs');

waitFor(() => {
    const app = globalThis.__marketMicro;
    return app &&
        /ready/.test(text('#status')) &&
        app.state.sectorRows.length === 5 &&
        app.state.deskRows.length === 5 &&
        app.state.feeRows.length === 5;
}, 'market-microstructure ready with worker analytics', 25000);

const app = globalThis.__marketMicro;
const { agents, instruments, venues, view, splat, sonifier, state } = app;

frames(12);

test('boot: 4 linked tables, nullable venue_id, Hash/Range/Spatial indexes & GPU splat pixels', () => {
    const qApi = bro.table;
    check(app.orders.rowCount === 131072, 'orders rowCount === 131072 (got ' + app.orders.rowCount + ')');
    check(app.orders.chunkCount === 32, 'orders chunkCount === 32 (got ' + app.orders.chunkCount + ')');
    check(agents.rowCount === 4096, 'agents rowCount === 4096');
    check(instruments.rowCount === 16, 'instruments rowCount === 16');
    check(venues.rowCount === 16, 'venues rowCount === 16');

    check(app.orders.hasIndex('order_id'), 'orders has HashIndex order_id');
    check(app.orders.hasRangeIndex('notional'), 'orders has RangeIndex notional');
    check(app.orders.hasSpatialIndex('book3d'), 'orders has SpatialIndex book3d');
    check(agents.hasIndex('agent_id'), 'agents has HashIndex agent_id');
    check(agents.hasRangeIndex('leverage'), 'agents has RangeIndex leverage');
    check(instruments.hasIndex('sym_id'), 'instruments has HashIndex sym_id');
    check(venues.hasIndex('venue_id'), 'venues has HashIndex venue_id');

    const nullVenues = app.orders.query().where(qApi.isNull('venue_id')).count();
    check(nullVenues > 26000 && nullVenues < 40000, 'nullable OTC venue_id (~25% NULL): ' + nullVenues);

    check(splat.gpuReady, 'HdrSplatEngine Vulkan GPU active');
    const gRect = q('#gpu-canvas').getBoundingClientRect();
    const img = getPixels(
        Math.round(gRect.left + gRect.width * 0.18),
        Math.round(gRect.top + gRect.height * 0.18),
        Math.round(gRect.width * 0.64),
        Math.round(gRect.height * 0.64)
    );
    let lit = 0;
    let saturated = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i];
        const g = img.data[i + 1];
        const b = img.data[i + 2];
        if (r + g + b > 32) lit++;
        if (r >= 252 && g >= 252 && b >= 252) saturated++;
    }
    check(lit > 600, 'GPU splat canvas rendered orderbook wall pixels: lit=' + lit);
    check(saturated < lit * 0.35, `HDR highlights balanced (saturated=${saturated}/${lit})`);

    shot('microstructure-wall');
});

test('manifolds: smooth morph across all 4 GPU manifolds + shots', () => {
    clickOn('#manifold-list [data-manifold="1"]');
    frames(32);
    check(view.toManifold === 1 && view.smoothMorph > 0.95, 'manifold 1 Liquidity Torus active & morphed');
    shot('microstructure-torus');

    for (const m of [2, 3, 0]) {
        clickOn(`#manifold-list [data-manifold="${m}"]`);
        frames(32);
        check(view.toManifold === m && view.smoothMorph > 0.95, `manifold ${m} active & morphed`);
    }
    check(/What You're Seeing/.test(text('#hud-manifold')), 'plain-English What You\'re Seeing guide present');
});

test('closed-loop: rotating GPU readFromKernelBuffer writeback & ReactiveQuery chunk reuse', () => {
    const beforeTicks = state.writebackTicks;
    const beforeVer = app.orders.version;
    const beforeStruct = app.orders.structureVersion;
    const ok = app.stepWritebackChunks(2);
    check(ok === true, 'rotating 2-chunk GPU writeback executed');
    check(state.writebackTicks > beforeTicks, 'writebackTicks incremented');
    check(app.orders.version > beforeVer, 'table version advanced on GPU writeback');
    check(app.orders.structureVersion === beforeStruct, 'structureVersion preserved on GPU writeback');
    check(state.lastReactive.recomputedChunks === 2,
        'ReactiveQuery recomputed 2 dirty chunks: ' + state.lastReactive.recomputedChunks);
    check(state.lastReactive.reusedChunks > 0 && state.lastReactive.reusedChunks >= 28,
        'ReactiveQuery reused clean chunks: ' + state.lastReactive.reusedChunks);
    frames(4);
    check(/reused/.test(text('#vitals-panel')), 'Living Vitals HUD displays reactive chunk reuse');
});

test('brushes & lifecycle: Probe Tape, Flash Crash, Liquidity Sweep, Whale Wall, Margin Squeeze & Compact', () => {
    const gRect = q('#gpu-canvas').getBoundingClientRect();
    click(gRect.left + gRect.width * 0.5, gRect.top + gRect.height * 0.5, 0);
    frames(2);
    check(/ord #/.test(text('#probe-box')), 'canvas Probe Tape populated #probe-box');
    check(/idx=\[true,true\]/.test(text('#probe-box')),
        'Probe Tape verified HashIndex(agent_id) & HashIndex(sym_id)');

    // Test canvas crash brush toggle too
    clickOn('#btn-brush-crash');
    frames(1);
    clickOn('#btn-brush-probe');

    const crashRes = app.triggerFlashCrash();
    check(crashRes.usedSpatialIndex === true && crashRes.affectedRows > 0,
        'Flash Crash whereInRadius.update used SpatialIndex, hit=' + crashRes.affectedRows);
    check(state.lastReactive.reusedChunks > 0,
        'ReactiveQuery reused untouched chunks after Flash Crash: ' + state.lastReactive.reusedChunks);

    const rowsBeforeSweep = app.orders.rowCount;
    const sweepRes = app.triggerLiquiditySweep();
    check(sweepRes.usedSpatialIndex === true && sweepRes.affectedRows > 0,
        'Liquidity Sweep whereInAABB.remove hit=' + sweepRes.affectedRows);
    check(app.orders.rowCount === rowsBeforeSweep - sweepRes.affectedRows,
        'orders rowCount decreased after Liquidity Sweep');
    check(app.orders.stats().tombstoneCount === sweepRes.affectedRows,
        'tombstones recorded cleanly after Liquidity Sweep');
    check(state.lastReactive.reusedChunks > 0,
        'ReactiveQuery reused clean chunks after AABB Liquidity Sweep: ' + state.lastReactive.reusedChunks);

    const rowsBeforeWhale = app.orders.rowCount;
    clickOn('#btn-whale-wall');
    frames(2);
    check(app.orders.rowCount === rowsBeforeWhale + 512,
        'Whale Wall insertMany inserted +512 iceberg block orders');

    const rowsBeforeSqueeze = app.orders.rowCount;
    clickOn('#btn-margin-squeeze');
    frames(3);
    check(app.orders.rowCount < rowsBeforeSqueeze, 'Margin Squeeze deleteWhere liquidated distressed orders');
    check(app.orders.stats().tombstoneCount === 0, 'Margin Squeeze compact cleared all tombstones');
    check(app.orders.hasSpatialIndex('book3d') && app.orders.hasRangeIndex('notional'),
        'indexes preserved after compact');

    clickOn('#btn-compact');
    frames(2);
    check(app.stepWritebackChunks(2) === true, 'rotating GPU writeback resumed cleanly after compact');
});

test('worker: join instruments/agents, leftJoin venues (coalesce), JIT expressions, Top-K & bro.tensor', () => {
    waitFor(() => !app.state.workerBusy, 'prior worker batch settled', 15000);
    let batch = null;
    app.runWorkerAnalytics(true).then((r) => { batch = r; });
    waitFor(() => batch !== null, 'worker analytics batch resolved', 15000);

    const res = batch.results;
    check(res.sectorDepth && res.sectorDepth.ok && res.sectorDepth.rows.length === 5,
        'join instruments grouped by sector returned 5 rows');
    check(res.symbolDepth && res.symbolDepth.ok && res.symbolDepth.rows.length === 16,
        'join instruments grouped by symbol returned 16 rows');
    check(res.deskStress && res.deskStress.ok && res.deskStress.rows.length === 5,
        'join agents grouped by desk_type returned 5 rows');

    const sec0 = res.sectorDepth.rows[0];
    check(Number.isFinite(sec0.netSignedQty) && Number.isFinite(sec0.avgMidImpact) && sec0.avgMidImpact > 0,
        'fused JIT abs/sqrt/cond expressions computed cleanly: ' + JSON.stringify(sec0));

    const feeRows = res.venueFeeAttribution.rows;
    check(res.venueFeeAttribution.ok && feeRows.length === 5,
        'leftJoin venues grouped by strategy returned 5 rows');
    let sumLit = 0, sumDark = 0, sumFee = 0;
    for (const r of feeRows) {
        sumLit += r.litCnt;
        sumDark += r.darkCnt;
        sumFee += r.totalFeeUsd;
        check(Math.abs((r.litCnt + r.darkCnt) - r.orderCnt) < 0.5,
            'lit + dark === orderCnt for ' + r.strategy);
    }
    check(sumDark > 20000 && sumFee > 1000, `leftJoin dark=${sumDark}, totalFeeUsd=$${Math.round(sumFee)}`);

    const topW = res.topWhales;
    check(topW && topW.ok && topW.rows.length === 5, 'RangeIndex Top-5 whales returned 5 rows');
    check(topW.stats.usedRangeIndex === true, 'topWhales used RangeIndex(notional)');
    for (let i = 1; i < topW.rows.length; i++) {
        check(topW.rows[i].notional <= topW.rows[i - 1].notional + 1e-3, 'topWhales sorted descending');
    }

    const topA = res.topLeveragedAgents;
    check(topA && topA.ok && topA.rows.length === 5, 'RangeIndex Top-5 leveraged agents returned 5 rows');
    check(topA.stats.usedRangeIndex === true, 'topLeveragedAgents used RangeIndex(leverage)');
    for (let i = 1; i < topA.rows.length; i++) {
        check(topA.rows[i].leverage <= topA.rows[i - 1].leverage + 1e-4, 'topAgents sorted descending');
    }

    check(document.querySelectorAll('#topk-whales-wrap tbody tr').length === 5, 'rendered 5 whale rows');
    check(document.querySelectorAll('#topk-agents-wrap tbody tr').length === 5, 'rendered 5 agent rows');

    check(batch.tensor && batch.tensor.ok && batch.tensor.sampled > 0,
        'bro.tensor systemic stress score computed via ' + (batch.tensor && batch.tensor.backend));
});

test('persistence: .brotable v3 snapshot.save, mmap audit (mappedIndexes >= 2), Restore Checkpoint & cleanup', () => {
    try { if (fs.existsSync(app.ckptPath)) fs.unlinkSync(app.ckptPath); } catch (_) {}

    q('#btn-save-ckpt').scrollIntoView({ block: 'center' });
    frames(1);
    clickOn('#btn-save-ckpt');
    frames(2);
    check(fs.existsSync(app.ckptPath), 'v3 checkpoint file created: ' + app.ckptPath);

    let cmp = null;
    app.auditCheckpoint().then((r) => { cmp = r; });
    waitFor(() => cmp !== null, 'v3 mmap checkpoint audit finished', 15000);

    check(cmp.ok === true && cmp.isMapped === true, 'mmap snapshot mapped cleanly (isMapped === true)');
    check(cmp.mappedIndexes >= 2, 'mappedIndexes >= 2 (got ' + cmp.mappedIndexes + ')');
    check(/v3 mmap idx: [23456789]/.test(text('#vitals-panel')), 'Living Vitals badge updated with mmap index count');

    const savedRows = cmp.chkAgg.cnt;
    clickOn('#btn-whale-wall');
    frames(2);
    check(app.orders.rowCount === savedRows + 512, 'mutated orders (+512 whales) prior to restore');

    q('#btn-load-ckpt').scrollIntoView({ block: 'center' });
    frames(1);
    clickOn('#btn-load-ckpt');
    waitFor(() => app.orders.rowCount === savedRows && !app.state.workerBusy, 'Restore Checkpoint completed', 15000);
    frames(3);
    check(app.orders.hasIndex('order_id') && app.orders.hasRangeIndex('notional') && app.orders.hasSpatialIndex('book3d'),
        'restored v3 checkpoint preserved Hash, Range, and Spatial indexes');

    try { if (fs.existsSync(app.ckptPath)) fs.unlinkSync(app.ckptPath); } catch (_) {}
});

test('optics & UI: Sonifier, Auto-Orbit zero unexpected resizes, zero forbidden strings', () => {
    clickOn('#btn-sonify');
    check(sonifier.enabled === true && q('#btn-sonify').classList.contains('active'), 'Sonifier enabled cleanly');
    clickOn('#btn-sonify');

    const beforeResizes = splat.resizeCount;
    const beforeYaw = view.yaw;
    clickOn('#btn-autorotate');
    frames(60);
    check(splat.resizeCount === beforeResizes,
        'zero unexpected canvas resizes during 60 Auto-Orbit frames (delta=' + (splat.resizeCount - beforeResizes) + ')');
    check(Math.abs(view.yaw - beforeYaw) > 0.02, 'Auto-Orbit rotated camera smoothly');
    clickOn('#btn-autorotate');

    const fullTxt = document.body.textContent || '';
    const forbidRe = new RegExp('compare\\s+vs\\s+js|\\bvs\\s+js\\b', 'i');
    check(!forbidRe.test(fullTxt), 'no forbidden comparison phrasing in UI');
});

done('market-microstructure');
