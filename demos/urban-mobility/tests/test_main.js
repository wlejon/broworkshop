// Urban Mobility Twin headless integration test.
// Run sequentially via: scripts/validate.sh demos/urban-mobility

import { check, test, frames, waitFor, clickOn, shot, text, q, done } from "/lib/kit/test.js";

const fs = require('fs');

waitFor(() => {
    const app = globalThis.__urbanMobility;
    return app && /ready/.test(text('#status')) && app.state.revenueRows.length === 4;
}, 'urban-mobility ready with worker analytics', 25000);

const app = globalThis.__urbanMobility;
const { roads, orders, hubs, view, splat, sonifier, state } = app;

frames(12);

test('boot: 4 relational tables, Hash/Range/Spatial indexes, nullable order_id & GPU pixels', () => {
    const qApi = bro.table;
    check(app.vehicles.rowCount === 131072, 'vehicles rowCount === 131072: ' + app.vehicles.rowCount);
    check(app.vehicles.chunkCount === 32, 'vehicles chunkCount === 32: ' + app.vehicles.chunkCount);
    check(roads.rowCount === 256, 'roads rowCount === 256');
    check(orders.rowCount === 32768, 'orders rowCount === 32768');
    check(hubs.rowCount === 24, 'hubs rowCount === 24');

    check(app.vehicles.hasIndex('vid'), 'vehicles has HashIndex vid');
    check(app.vehicles.hasRangeIndex('delay_min'), 'vehicles has RangeIndex delay_min');
    check(app.vehicles.hasSpatialIndex('city3d'), 'vehicles has SpatialIndex city3d');
    check(roads.hasIndex('road_id'), 'roads has HashIndex road_id');
    check(orders.hasIndex('order_id'), 'orders has HashIndex order_id');
    check(hubs.hasIndex('hub_id'), 'hubs has HashIndex hub_id');

    const nullOrders = app.vehicles.query().where(qApi.isNull('order_id')).count();
    check(nullOrders > 38000 && nullOrders < 54000, 'nullable order_id ~35% NULL: ' + nullOrders);

    const gRect = q('#gpu-canvas').getBoundingClientRect();
    const img = getPixels(
        Math.round(gRect.left + gRect.width * 0.2),
        Math.round(gRect.top + gRect.height * 0.2),
        Math.round(gRect.width * 0.6),
        Math.round(gRect.height * 0.6)
    );
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 32) lit++;
    }
    check(lit > 500, 'GPU splat canvas painted city pixels: lit=' + lit);

    shot('mobility-grid');
});

test('manifolds: smooth transitions across all 4 GPU manifolds + shots', () => {
    clickOn('#manifold-list [data-manifold="1"]');
    frames(32);
    check(view.toManifold === 1 && view.smoothMorph > 0.95, 'manifold 1 active & morphed');
    shot('mobility-congestion');

    for (const m of [2, 3, 0]) {
        clickOn(`#manifold-list [data-manifold="${m}"]`);
        frames(32);
        check(view.toManifold === m && view.smoothMorph > 0.95, `manifold ${m} active & morphed`);
    }
    check(/What You're Seeing/.test(text('#hud-manifold')), 'plain-English What You\'re Seeing guide present');
});

test('closed-loop: rotating GPU readFromKernelBuffer writeback & ReactiveQuery chunk reuse', () => {
    const beforeTicks = state.writebackTicks;
    const beforeVer = app.vehicles.version;
    const ok = app.stepWritebackChunks(2);
    check(ok === true, 'rotating 2-chunk GPU writeback executed');
    check(state.writebackTicks > beforeTicks, 'writebackTicks incremented');
    check(app.vehicles.version > beforeVer, 'table version advanced on GPU writeback');
    check(state.lastReactive.recomputedChunks === 2,
        'ReactiveQuery recomputed 2 dirty chunks: ' + state.lastReactive.recomputedChunks);
    check(state.lastReactive.reusedChunks > 0,
        'ReactiveQuery reused clean chunks: ' + state.lastReactive.reusedChunks);
    frames(4);
    check(/reused/.test(text('#vitals-panel')), 'Living Vitals HUD displays reactive chunk reuse');
});

test('brushes & lifecycle: probe, incident update, corridor, cull AABB remove, insertMany & compact', () => {
    const gRect = q('#gpu-canvas').getBoundingClientRect();
    click(gRect.left + gRect.width * 0.5, gRect.top + gRect.height * 0.5, 0);
    frames(2);
    check(/vid #/.test(text('#probe-box')), 'canvas kNN probe populated #probe-box');

    const incRes = app.triggerIncidentAt();
    check(incRes.usedSpatialIndex === true && incRes.affectedRows > 0,
        'incident whereInRadius.update used SpatialIndex, hit=' + incRes.affectedRows);
    check(state.lastReactive.reusedChunks > 0,
        'ReactiveQuery reused untouched chunks after localized incident: ' + state.lastReactive.reusedChunks);

    const corRes = app.triggerCorridorAt();
    check(corRes.usedSpatialIndex === true && corRes.affectedRows > 0,
        'corridor whereInRadius.update hit=' + corRes.affectedRows);

    const rowsBeforeCull = app.vehicles.rowCount;
    const cullRes = app.triggerCullZone();
    check(cullRes.usedSpatialIndex === true && cullRes.affectedRows > 0,
        'cull whereInAABB.remove hit=' + cullRes.affectedRows);
    check(app.vehicles.rowCount === rowsBeforeCull - cullRes.affectedRows, 'vehicles rowCount decreased after cull');
    check(app.vehicles.stats().tombstoneCount === cullRes.affectedRows, 'tombstones recorded cleanly');
    check(state.lastReactive.reusedChunks > 0,
        'ReactiveQuery reused clean chunks after AABB cull: ' + state.lastReactive.reusedChunks);

    clickOn('#btn-spawn');
    frames(2);
    check(app.vehicles.rowCount === rowsBeforeCull - cullRes.affectedRows + 512,
        'insertMany spawned +512 vehicles');

    clickOn('#btn-compact');
    frames(3);
    check(app.vehicles.stats().tombstoneCount === 0, 'compact cleared all tombstones');
    check(app.stepWritebackChunks(2) === true, 'rotating GPU writeback resumed cleanly after compact');
});

test('worker: join roads + leftJoin orders (coalesce) + RangeIndex Top-K + bro.tensor', () => {
    let batch = null;
    app.runWorkerAnalytics(true).then((r) => { batch = r; });
    waitFor(() => batch !== null, 'worker analytics batch resolved', 15000);

    const res = batch.results;
    check(res.congestionByMode && res.congestionByMode.ok && res.congestionByMode.rows.length === 4,
        'join roads grouped by mode returned 4 rows');
    check(res.congestionByDistrict && res.congestionByDistrict.ok && res.congestionByDistrict.rows.length === 4,
        'join roads grouped by district returned 4 rows');

    const revRows = res.revenueWithIdle.rows;
    check(res.revenueWithIdle.ok && revRows.length === 4, 'leftJoin orders returned 4 mode rows');
    let sumPaid = 0, sumIdle = 0, sumRev = 0;
    for (const r of revRows) {
        sumPaid += r.paidCnt;
        sumIdle += r.idleCnt;
        sumRev += r.activeRevenue;
        check(Math.abs((r.paidCnt + r.idleCnt) - r.fleetCnt) < 0.5, 'paid + idle === fleetCnt for ' + r.mode);
    }
    check(sumIdle > 35000 && sumRev > 100000, `leftJoin idle=${sumIdle}, revenue=$${Math.round(sumRev)}`);

    const top = res.topDelayed;
    check(top && top.ok && top.rows.length === 8, 'RangeIndex Top-K returned 8 rows');
    check(top.stats.usedRangeIndex === true, 'topDelayed used RangeIndex(delay_min)');
    for (let i = 1; i < top.rows.length; i++) {
        check(top.rows[i].delay_min <= top.rows[i - 1].delay_min + 1e-5, 'topDelayed sorted descending');
    }

    check(batch.tensor && batch.tensor.ok && batch.tensor.sampled > 0,
        'bro.tensor fleet anomaly scoring succeeded via ' + (batch.tensor && batch.tensor.backend));
});

test('persistence: .brotable v3 save, mmap audit (mappedIndexes >= 2), load & cleanup', () => {
    clickOn('#btn-save-ckpt');
    frames(2);
    check(fs.existsSync(app.ckptPath), 'v3 checkpoint file created: ' + app.ckptPath);

    let cmp = null;
    app.auditCheckpoint().then((r) => { cmp = r; });
    waitFor(() => cmp !== null, 'v3 mmap checkpoint audit finished', 15000);

    check(cmp.ok === true && cmp.isMapped === true, 'mmap snapshot mapped cleanly');
    check(cmp.mappedIndexes >= 2, 'mappedIndexes >= 2 (got ' + cmp.mappedIndexes + ')');
    check(/v3 mmap idx: [23456789]/.test(text('#vitals-panel')), 'Living Vitals badge updated with mmap index count');

    const loaded = app.loadCheckpoint();
    check(loaded === true, 'loadCheckpoint restored table');
    check(app.vehicles.hasIndex('vid') && app.vehicles.hasRangeIndex('delay_min') && app.vehicles.hasSpatialIndex('city3d'),
        'loaded v3 checkpoint restored Hash, Range, and Spatial indexes');

    try { fs.unlinkSync(app.ckptPath); } catch (_) {}
});

test('optics & UI: Sonifier, Auto-Orbit zero unexpected resizes, zero vs JS strings', () => {
    clickOn('#btn-sonify');
    check(sonifier.enabled === true && q('#btn-sonify').classList.contains('active'), 'Sonifier enabled cleanly');

    const beforeResizes = splat.resizeCount;
    const beforeYaw = view.yaw;
    clickOn('#btn-autorotate');
    frames(60);
    check(splat.resizeCount === beforeResizes,
        'zero unexpected canvas resizes during 60 Auto-Orbit frames (delta=' + (splat.resizeCount - beforeResizes) + ')');
    check(Math.abs(view.yaw - beforeYaw) > 0.02, 'Auto-Orbit rotated camera smoothly');
    clickOn('#btn-autorotate');

    const fullTxt = document.body.textContent || '';
    check(!/vs JS|Compare vs JS/i.test(fullTxt), 'zero "vs JS" text in UI');
});

done('urban-mobility');
