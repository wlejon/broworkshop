// Headless end-to-end integration test for Living Biosphere (demos/living-ecology).
// Covers: 3 relational bro.tables & Hash/Range/Spatial indexes, GPU HDR splatting,
// 4-manifold morphing, GPU->Table rotating chunk readFromKernelBuffer + ReactiveQuery chunk reuse,
// spatial brushes (whereInRadius.update, whereInAABB.remove, canvas click), insertMany/deleteWhere/compact,
// O(1) COW Worker join + fused JIT + RangeIndex Top-8 + bro.tensor, Sonifier, Auto-Orbit, & .brotable v3 mmap.

import {
    check, test, done, frames, waitFor, clickOn, q, text, shot,
} from "/lib/kit/test.js";

const fs = require('fs');

waitFor(() => {
    const app = globalThis.__livingEco;
    return app &&
        app.state.trophicRows.length === 12 &&
        app.state.topThriving.length === 8 &&
        /organisms/.test(text('#status'));
}, 'living-ecology worker analytics ready', 25000);

const app = globalThis.__livingEco;
frames(10);

test('boot: 3 relational tables, Hash/Range/Spatial indexes, nullable mutant_note, GPU splat pixels', () => {
    check(app.organisms.rowCount === 131072, 'organisms rowCount === 131072 (got ' + app.organisms.rowCount + ')');
    check(app.organisms.chunkCount === 32, 'organisms chunkCount === 32');
    check(app.species.rowCount === 12, 'species rowCount === 12');
    check(app.zones.rowCount === 64, 'zones rowCount === 64');

    check(app.organisms.hasIndex('id'), 'HashIndex(id) active');
    check(app.organisms.hasRangeIndex('energy'), 'RangeIndex(energy) active');
    check(app.organisms.hasSpatialIndex('bio3d'), 'SpatialIndex(bio3d) active');
    check(app.species.hasIndex('species_id'), 'species HashIndex(species_id) active');
    check(app.zones.hasIndex('zone_id'), 'zones HashIndex(zone_id) active');

    const nullNotes = app.organisms.query().where(bro.table.isNull('mutant_note')).count();
    check(nullNotes > 4000 && nullNotes < 9000, 'nullable mutant_note (~5%) verified: ' + nullNotes);

    check(app.engine.gpuReady, 'HdrSplatEngine Vulkan GPU compute active');
    const gRect = q('#view').getBoundingClientRect();
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
    check(lit > 600, 'GPU splat canvas rendered bioluminescent pixels: lit=' + lit);
    shot('ecology-3d');
});

test('manifolds: smooth morph across all 4 GPU manifolds', () => {
    for (let m = 1; m <= 3; m++) {
        clickOn(`#manifold-btns [data-manifold="${m}"]`);
        frames(30);
        check(app.state.manifold === m && app.view.smoothMorph > 0.95, `manifold ${m} settled cleanly`);
        if (m === 1) shot('ecology-trophic');
    }
    clickOn('#manifold-btns [data-manifold="0"]');
    frames(30);
    check(app.state.manifold === 0 && app.view.smoothMorph > 0.95, 'returned to manifold 0');
});

test('GPU -> Table readFromKernelBuffer: version advances, structureVersion stable, ReactiveQuery reuses chunks', () => {
    // Pause auto-step briefly so we observe a single explicit writeback step cleanly
    if (app.state.simPlaying) {
        clickOn('#btn-sim-play');
        frames(2);
    }
    const verBefore = app.organisms.version;
    const structBefore = app.organisms.structureVersion;

    clickOn('#btn-gpu-step');
    frames(4);

    check(app.organisms.version > verBefore,
        'table version incremented after GPU readFromKernelBuffer (' + verBefore + ' -> ' + app.organisms.version + ')');
    check(app.organisms.structureVersion === structBefore,
        'structureVersion preserved (' + structBefore + ' === ' + app.organisms.structureVersion + ')');
    check(app.state.lastReactive.reusedChunks > 0 && app.state.lastReactive.reusedChunks >= 28,
        'ReactiveQuery reused untouched chunks: ' + JSON.stringify(app.state.lastReactive));
    check(/reused/.test(text('#vitals-panel')), 'Living Vitals HUD displays reactive chunk reuse');
});

test('spatial brushes (whereInRadius.update, canvas click, whereInAABB.remove) & lifecycle (insertMany, deleteWhere, compact)', () => {
    const verBeforeBloom = app.organisms.version;
    clickOn('#btn-bloom');
    waitFor(() => app.organisms.version > verBeforeBloom, 'Nutrient Bloom updated table', 10000);
    check(/whereInRadius\.update/.test(text('#probe-box')), 'Nutrient Bloom executed whereInRadius.update');

    // Switch click brush to Bloom and click directly on 3D biosphere canvas
    clickOn('#brush-mode [data-value="bloom"]');
    frames(2);
    const vRect = q('#view').getBoundingClientRect();
    const verBeforeClick = app.organisms.version;
    click(vRect.left + vRect.width * 0.5, vRect.top + vRect.height * 0.5, 0);
    frames(4);
    check(app.organisms.version >= verBeforeClick, 'canvas click handled active brush cleanly');
    clickOn('#brush-mode [data-value="probe"]');
    frames(2);

    // Toxin Cull -> creates real tombstones via whereInAABB.remove()
    const rowsBeforeToxin = app.organisms.rowCount;
    clickOn('#btn-toxin');
    frames(4);
    const deadAfterToxin = app.organisms.stats().tombstoneCount;
    check(app.organisms.rowCount < rowsBeforeToxin && deadAfterToxin > 0,
        'Toxin Cull created tombstones: dead=' + deadAfterToxin);

    // Birth Wave (+512 offspring via insertMany) + Starve Cull (deleteWhere energy < 0.08)
    const rowsBeforeBirth = app.organisms.rowCount;
    clickOn('#btn-birth');
    frames(4);
    check(app.organisms.rowCount === rowsBeforeBirth + 512, 'Birth Wave inserted +512 offspring');

    const rowsBeforeCull = app.organisms.rowCount;
    clickOn('#btn-cull');
    frames(4);
    check(app.organisms.rowCount < rowsBeforeCull, 'Starve Cull removed low-energy organisms');

    // Compact -> clears tombstones back to 0 and rebuilds indexes
    clickOn('#btn-compact');
    frames(4);
    check(app.organisms.stats().tombstoneCount === 0, 'compact() reclaimed all tombstones (tombstoneCount === 0)');
    check(app.organisms.hasSpatialIndex('bio3d') && app.organisms.hasRangeIndex('energy'),
        'indexes preserved after compact()');

    // Re-enable live sim & verify GPU->Table chunk reuse resumes cleanly after compact
    clickOn('#btn-sim-play');
    frames(8);
    check(app.state.lastReactive.reusedChunks > 0,
        'ReactiveQuery chunk reuse resumed after compact(): ' + app.state.lastReactive.reusedChunks);
});

test('worker COW analytics (join, fused JIT, RangeIndex Top-8, tensor), Sonifier & Auto-Orbit stability', async () => {
    // Force fresh worker batch
    const beforeShipped = app.state.snapshotsShipped;
    clickOn('#btn-gpu-step');
    waitFor(() => app.state.snapshotsShipped > beforeShipped && !app.rpc.pending, 'worker batch completed', 15000);
    frames(4);

    check(app.state.trophicRows.length === 12, 'trophicJoin returned all 12 species');
    const r0 = app.state.trophicRows[0];
    check(Number.isFinite(r0.avgFitness) && r0.totalBiomass > 0 && r0.cnt > 0,
        'fused JIT fitness & biomass computed: ' + JSON.stringify(r0));

    check(app.state.topThriving.length === 8, 'RangeIndex Top-8 returned 8 rows');
    check(app.state.topThriving[0].energy >= app.state.topThriving[7].energy, 'Top-8 sorted descending by energy');
    check(document.querySelectorAll('#top-thriving-list tr').length === 8, 'Top-8 table rendered 8 DOM rows');

    check(app.state.stressZones && app.state.stressZones.ok && app.state.stressZones.rows.length > 0,
        'stressZones join + cond + coalesce succeeded');
    const sz0 = app.state.stressZones.rows[0];
    check((sz0.alert === 'CRITICAL' || sz0.alert === 'TOXIC_ZONE') && typeof sz0.strain === 'string',
        'cond & coalesce output verified: ' + JSON.stringify(sz0));

    check(app.state.tensorOut && app.state.tensorOut.ok && Number.isFinite(app.state.tensorOut.meanScore),
        'bro.tensor metabolic stress score computed: ' + JSON.stringify(app.state.tensorOut));

    // Sonifier toggle
    clickOn('#btn-sound');
    frames(2);
    check(app.sonifier.enabled === true && q('#btn-sound').classList.contains('active'), 'Sonifier enabled cleanly');
    clickOn('#btn-sound');
    frames(2);

    // Auto-Orbit 60-frame resize stability
    const beforeResizes = app.engine.resizeCount;
    clickOn('#btn-autorotate');
    frames(60);
    check(app.engine.resizeCount === beforeResizes,
        'zero unexpected canvas resizes during 60 Auto-Orbit frames (delta=' + (app.engine.resizeCount - beforeResizes) + ')');
    clickOn('#btn-autorotate');
    frames(2);
});

test('.brotable v3 save + worker mmap audit (isMapped & mappedIndexes >= 2) + rewind load + cleanup', () => {
    const ckptPath = app.resolveCheckpointPath();
    try { if (fs.existsSync(ckptPath)) fs.unlinkSync(ckptPath); } catch (_) {}

    app.state.lastCheckpoint = null;
    clickOn('#btn-save-v3');
    waitFor(() => app.state.lastCheckpoint && app.state.lastCheckpoint.ok, 'v3 checkpoint saved & mmapped in worker', 20000);
    frames(4);

    const cp = app.state.lastCheckpoint;
    check(cp.isMapped === true, 'worker opened .brotable v3 via zero-copy mmap (isMapped === true)');
    check(cp.mappedIndexes >= 2, 'v3 mmap mapped >= 2 indexes directly (got ' + cp.mappedIndexes + ')');
    check(cp.chkAgg && cp.chkAgg.cnt === app.organisms.rowCount, 'checkpoint row count matches live table');
    check(/v3 mmap idx:\s*[2-9]/.test(text('#vitals-panel')), 'Living Vitals HUD updated mmap index badge');

    const countAtSave = app.organisms.rowCount;
    clickOn('#btn-birth');
    frames(4);
    check(app.organisms.rowCount === countAtSave + 512, 'mutated table (+512 rows) before rewind');

    clickOn('#btn-load-v3');
    waitFor(() => app.organisms.rowCount === countAtSave, 'Rewind / Load v3 restored checkpoint state', 15000);
    frames(4);
    check(app.organisms.hasIndex('id') && app.organisms.hasRangeIndex('energy') && app.organisms.hasSpatialIndex('bio3d'),
        'bro.table.load restored Hash, Range, and Spatial indexes');

    try { if (fs.existsSync(ckptPath)) fs.unlinkSync(ckptPath); } catch (_) {}

    // Verify no forbidden comparison UI text exists anywhere in DOM
    const bodyTxt = document.body.innerText || '';
    const forbidRe = new RegExp('compare\\s+vs\\s+js|\\bvs\\s+js\\b', 'i');
    check(!forbidRe.test(bodyTxt), 'no forbidden benchmark phrasing in UI');
});

done('living-ecology');
