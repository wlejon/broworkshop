// Evolutionary Biosphere headless end-to-end showcase test.
// Run: scripts/validate.sh demos/evo-biosphere

import {
    check, test, frames, waitFor, clickOn, shot, text, q, done,
} from "/lib/kit/test.js";

const fs = require('fs');

waitFor(() => {
    const app = globalThis.__evoApp;
    return app && app.state.workerReady && app.state.lastBatch && app.state.branches.length >= 1 && /ready/.test(text('#status'));
}, 'evo-biosphere boot + worker + initial .brotable v3 branch', 30000);

const app = globalThis.__evoApp;
frames(10);

test('boot: 131,072 rows (32 chunks), ~12% NULL parent_id, Hash/Range/Spatial indexes, clades & niches, GPU splat', () => {
    const creatures = app.getCreatures();
    check(creatures.rowCount === 131072, 'creatures rowCount === 131072: ' + creatures.rowCount);
    check(creatures.chunkCount === 32, 'creatures chunkCount === 32');
    check(creatures.hasIndex('id'), 'HashIndex on id');
    check(creatures.hasRangeIndex('fitness'), 'RangeIndex on fitness');
    check(creatures.hasSpatialIndex('hab3d'), 'SpatialIndex on hab3d');
    check(app.clades.rowCount === 32 && app.clades.hasIndex('clade_id'), '32 clades indexed');
    check(app.niches.rowCount === 8 && app.niches.hasIndex('niche_id'), '8 niches indexed');

    const qApi = bro.table;
    const nullParents = creatures.query().where(qApi.isNull('parent_id')).count();
    check(nullParents > 14000 && nullParents < 18000, '~12.5% NULL parent_id founders: ' + nullParents);
    check(app.state.founderCount === nullParents, 'Worker coalesce(parent_id, -1) matches founder count: ' + app.state.founderCount);

    check(app.engine.gpuReady, 'HdrSplatEngine Vulkan GPU active');
    const vRect = q('#view').getBoundingClientRect();
    const img = getPixels(
        Math.round(vRect.left + vRect.width * 0.15),
        Math.round(vRect.top + vRect.height * 0.15),
        Math.round(vRect.width * 0.7),
        Math.round(vRect.height * 0.7)
    );
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 32) lit++;
    }
    check(lit > 500, 'GPU splat canvas rendered biosphere pixels: lit=' + lit);

    shot('evo-habitat');
});

test('manifolds: smooth transitions across all 4 GPU manifolds + phenotype shot', () => {
    clickOn('#manifold-list [data-manifold="1"]');
    frames(32);
    check(app.state.manifold === 1 && app.view.smoothMorph > 0.96, 'manifold 1 (Phenotype Space) settled');
    shot('evo-phenotype');

    clickOn('#manifold-list [data-manifold="2"]');
    frames(32);
    check(app.state.manifold === 2 && app.view.smoothMorph > 0.96, 'manifold 2 (Fitness Mountain) settled');

    clickOn('#manifold-list [data-manifold="3"]');
    frames(32);
    check(app.state.manifold === 3 && app.view.smoothMorph > 0.96, 'manifold 3 (Phylogenetic Spire) settled');

    clickOn('#manifold-list [data-manifold="0"]');
    frames(32);
    check(app.state.manifold === 0 && app.view.smoothMorph > 0.96, 'returned to manifold 0');
});

test('gpu writeback & ReactiveQuery: rotating 2-chunk writebacks keep reusedChunks >= 28', () => {
    const creatures = app.getCreatures();
    const structBefore = creatures.structureVersion;
    const verBefore = creatures.version;
    const wbBefore = app.state.totalWritebacks;

    frames(18);
    check(app.state.totalWritebacks > wbBefore, 'GPU rotating 2-chunk writebacks advanced');
    check(creatures.version > verBefore, 'table version incremented by GPU writeback');
    check(creatures.structureVersion === structBefore, 'structureVersion preserved across GPU writeback');
    check(app.state.lastReactive.reusedChunks >= 28,
        'ReactiveQuery reusedChunks >= 28: ' + app.state.lastReactive.reusedChunks);
    check(app.state.lastReactive.recomputedChunks > 0 && app.state.lastReactive.recomputedChunks <= 4,
        'ReactiveQuery recomputed only dirty chunks: ' + app.state.lastReactive.recomputedChunks);
    const vitalsTxt = text('#vitals-panel');
    check(/reused/.test(vitalsTxt) && /O\(1\) COW/.test(vitalsTxt), 'Living Vitals HUD populated');
});

test('brushes & lifecycle: Mutagen XOR ^5, Asteroid AABB remove, Speciation Burst insertMany, Compact', () => {
    const cBefore = app.getCreatures();
    const idSample = cBefore.nearest('hab3d', app.state.lastHabitatPt, 1, 2.0).toArray()[0];
    const origMask = idSample.traits_mask;
    const origGa = idSample.gene_a;

    clickOn('#btn-mutagen-blast');
    frames(2);
    check(app.state.lastBrushRes && app.state.lastBrushRes.kind === 'mutagen' &&
          app.state.lastBrushRes.usedSpatialIndex === true && app.state.lastBrushRes.affectedRows > 100,
        'Mutagen whereInRadius.update hit ' + (app.state.lastBrushRes && app.state.lastBrushRes.affectedRows) + ' rows via SpatialIndex');
    const mutatedRow = app.getCreatures().where({ id: idSample.id }).toArray()[0];
    check(mutatedRow.traits_mask === ((origMask ^ 5) >>> 0), 'bitwise XOR ^5 updated traits_mask');
    check(Math.abs(mutatedRow.gene_a - (origGa + 0.35)) < 0.08, 'Mutagen shifted gene_a by +0.35');
    check(app.state.lastReactive.reusedChunks > 0, 'Mutagen preserved untouched ReactiveQuery chunks: ' + app.state.lastReactive.reusedChunks);

    const aliveBeforeAsteroid = app.getCreatures().rowCount;
    clickOn('#btn-asteroid-strike');
    frames(2);
    check(app.state.lastBrushRes && app.state.lastBrushRes.kind === 'asteroid' &&
          app.state.lastBrushRes.usedSpatialIndex === true && app.state.lastBrushRes.affectedRows > 50,
        'Asteroid whereInAABB.remove deleted ' + (app.state.lastBrushRes && app.state.lastBrushRes.affectedRows) + ' rows');
    check(app.getCreatures().rowCount < aliveBeforeAsteroid && app.getCreatures().stats().tombstoneCount > 0,
        'Asteroid left measurable tombstones: ' + app.getCreatures().stats().tombstoneCount);

    const aliveBeforeBurst = app.getCreatures().rowCount;
    clickOn('#btn-speciate');
    frames(2);
    check(app.getCreatures().rowCount === aliveBeforeBurst + 2048, 'Speciation Burst inserted 2,048 rows');

    clickOn('#btn-compact');
    frames(2);
    check(app.getCreatures().stats().tombstoneCount === 0, 'Compact reclaimed all tombstones cleanly');
});

test('worker: leftJoin + sqrt/bitAnd/coalesce JIT, RangeIndex Top-8, & bro.tensor score', () => {
    const beforeShipped = app.state.snapshotsShipped;
    app.syncWorkerAndRunBatch();
    waitFor(() => app.state.snapshotsShipped > beforeShipped && !app.state.workerBusy && !app.rpc.pending,
        'worker runBatch completed', 15000);
    frames(2);

    const batch = app.state.lastBatch;
    check(batch && batch.results, 'Worker runBatch result present');

    const td = batch.results.traitDistance;
    check(td && td.ok && td.rows.length === 6, 'leftJoin clades grouped into 6 phyla');
    check(td.rows[0].avgDist > 0 && Number.isFinite(td.rows[0].avgFitness), 'fused sqrt phenotype distance computed');

    const ls = batch.results.lineageSample;
    check(ls && ls.ok && ls.rows.length === 6 && Number.isFinite(ls.rows[0].traitDist),
        'leftJoin select verified fused sqrt + coalesce + bitAnd');

    const ea = batch.results.eliteApex;
    check(ea && ea.ok && ea.rows.length === 8 && ea.stats.usedRangeIndex === true,
        'RangeIndex(fitness) Top-8 accelerated: usedRangeIndex=' + (ea && ea.stats && ea.stats.usedRangeIndex));

    check(batch.tensor && batch.tensor.ok && Number.isFinite(batch.tensor.meanScore),
        'bro.tensor evolutionary score computed (' + (batch.tensor && batch.tensor.backend) + ')');
});

test('timeline branching: .brotable v3 save(), Worker mmap() (>=2 idx), & branch rewind', () => {
    const countBeforeSave = app.state.branches.length;
    clickOn('#btn-save-branch');
    frames(4);
    check(app.state.branches.length === countBeforeSave + 1, 'Saved mutated branch to .brotable v3');

    const genesisBranch = app.state.branches.find((b) => /Genesis/.test(b.label));
    check(genesisBranch && genesisBranch.kind === 'file', 'Genesis .brotable v3 branch available');

    app.state.auditInfo = null;
    clickOn(`[data-audit-branch="${genesisBranch.id}"]`);
    waitFor(() => app.state.auditInfo && app.state.auditInfo.ok, 'Worker mmap() audit completed', 15000);
    frames(2);

    const audit = app.state.auditInfo;
    check(audit && audit.ok && audit.isMapped === true, 'Worker mmap() opened branch zero-copy');
    check(audit.mappedIndexes >= 2, 'mmap mappedIndexes >= 2 (got ' + audit.mappedIndexes + ')');
    check(/v3 mmap idx:\s*[2-9]/.test(text('#vitals-panel')), 'Living Vitals HUD updated mmap index badge');

    clickOn(`[data-rewind-branch="${genesisBranch.id}"]`);
    waitFor(() => app.getCreatures().rowCount === 131072 && !app.state.workerBusy, 'Branch rewound to Genesis', 15000);
    frames(4);
    check(app.getCreatures().rowCount === 131072 && app.getCreatures().stats().tombstoneCount === 0,
        'Rewound active biosphere back to Genesis 131,072 rows');
    check(app.getCreatures().hasIndex('id') && app.getCreatures().hasRangeIndex('fitness') &&
          app.getCreatures().hasSpatialIndex('hab3d'), 'Rewound branch restored all 3 indexes');

    // Clean up temporary .brotable checkpoint files created during headless validation
    for (const br of app.state.branches) {
        if (br.kind === 'file' && br.path) {
            try { if (fs.existsSync(br.path)) fs.unlinkSync(br.path); } catch (_) {}
        }
    }
});

test('sonifier, auto-orbit stability, & zero forbidden benchmark phrasing', () => {
    clickOn('#btn-sound');
    frames(2);
    check(app.sonifier.enabled === true, 'SpatialSonifier enabled');
    clickOn('#btn-sound');

    const resizesBefore = app.engine.resizeCount;
    clickOn('#btn-autorotate');
    frames(60);
    check(app.engine.resizeCount === resizesBefore, 'zero canvas resizes during 60 Auto-Orbit frames');
    clickOn('#btn-autorotate');
    frames(2);

    const fullBody = document.body.textContent || '';
    const forbidRe = new RegExp('compare\\s+vs\\s+js|\\bvs\\s+js\\b', 'i');
    check(!forbidRe.test(fullBody), 'zero forbidden benchmark phrasing in UI');
});

done('evo-biosphere');
