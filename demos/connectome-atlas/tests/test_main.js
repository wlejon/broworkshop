// FlyWire Connectome Atlas headless integration test.
// Run: scripts/validate.sh demos/connectome-atlas

import { check, test, frames, waitFor, simUntil, clickOn, setValue, shot, text, q, done } from "/lib/kit/test.js";

waitFor(() => {
    const app = globalThis.__connectomeAtlas;
    return app && /ready/.test(text('#status'));
}, 'connectome ready', 20000);

const app = globalThis.__connectomeAtlas;
const { neuronsSnap, edgesSnap, view, splat, sonifier, cascade } = app;

frames(12);

test('boot: linked neurons & edges tables, Hash/Range/Spatial indexes, nullable Dict/String', () => {
    check(neuronsSnap.rowCount >= 100000, 'neurons count >= 100k: ' + neuronsSnap.rowCount);
    check(edgesSnap.rowCount >= 500000, 'edges count >= 500k: ' + edgesSnap.rowCount);
    check(neuronsSnap.hasSpatialIndex('brain3d'), 'neurons has SpatialIndex brain3d');
    check(neuronsSnap.hasRangeIndex('out_syn'), 'neurons has RangeIndex out_syn');
    check(edgesSnap.hasRangeIndex('syn_count'), 'edges has RangeIndex syn_count');

    const qApi = bro.table;
    const exNeuronHash = neuronsSnap.query().where(qApi.eq('ord', 42)).explain();
    check(exNeuronHash.willUseIndex && exNeuronHash.strategy === 'hash_index',
        'neurons ord HashIndex active: ' + exNeuronHash.strategy);

    const exEdgeHash = edgesSnap.query().where(qApi.eq('pre_idx', 42)).explain();
    check(exEdgeHash.willUseIndex && exEdgeHash.strategy === 'hash_index',
        'edges pre_idx HashIndex active: ' + exEdgeHash.strategy);

    const nn = neuronsSnap.nearest('brain3d', [-0.90, 0.04, 0.04], 24, 0.35);
    check(nn.rowCount > 0 && nn.rowCount <= 24, 'SpatialIndex nearest returned ' + nn.rowCount + ' neurons');

    const olCount = neuronsSnap.query().where(qApi.eq('region', 'OL_L')).count();
    check(olCount > 0, 'Dict region=OL_L query matched ' + olCount);
    if (!neuronsSnap.isMapped) {
        const nullRegCount = neuronsSnap.query().where(qApi.isNull('region')).count();
        const nullCtCount = neuronsSnap.query().where(qApi.isNull('cell_type')).count();
        check(nullRegCount > 0 && nullCtCount > 0, 'nullable Dict + String columns verified');
    }

    const gRect = q('#gpu-canvas').getBoundingClientRect();
    const img = getPixels(
        Math.round(gRect.left + gRect.width * 0.25),
        Math.round(gRect.top + gRect.height * 0.25),
        Math.round(gRect.width * 0.5),
        Math.round(gRect.height * 0.5)
    );
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 36) lit++;
    }
    check(lit > 500, 'GPU splat canvas painted brain pixels: lit=' + lit);

    shot('connectome-3d');
});

test('manifolds: smooth transitions across all 4 GPU manifolds', () => {
    for (let m = 1; m <= 3; m++) {
        clickOn(`#manifold-list [data-manifold="${m}"]`);
        frames(28);
        check(view.toManifold === m && view.smoothMorph > 0.95, `manifold ${m} active & morphed`);
    }
    clickOn('#manifold-list [data-manifold="0"]');
    frames(28);
    check(view.toManifold === 0 && view.smoothMorph > 0.95, 'returned to manifold 0');
});

test('cascade: canvas probe + Stimulate Optic + spatialized sonifier + multi-hop propagation', () => {
    // Verify clicking directly on brain canvas triggers SpatialIndex probe
    const gRect = q('#gpu-canvas').getBoundingClientRect();
    click(gRect.left + gRect.width * 0.5, gRect.top + gRect.height * 0.5, 0);
    frames(2);
    check(cascade.activeCount > 0, 'canvas click seeded cascade: ' + cascade.activeCount);

    clickOn('#btn-sonify');
    check(sonifier.enabled === true, 'sonifier enabled cleanly');

    clickOn('#btn-stim-ol');
    frames(2);
    check(cascade.activeCount > 0, 'Stimulate Optic seeded ' + cascade.activeCount + ' neurons');
    check(/ord #/.test(text('#probe-box')), 'probe readout updated: ' + text('#probe-box'));

    clickOn('#btn-step-hop');
    frames(24);
    check(cascade.hop >= 2, 'cascade propagated to hop ' + cascade.hop);
    check(cascade.history.length >= 3, 'cascade history recorded hops: ' + cascade.history.length);
    check(cascade.activeCount > 120 && cascade.activeCount < 12000,
        'wave localized cleanly without saturation: ' + cascade.activeCount);

    check(q('#btn-fibers').classList.contains('active'), 'GPU synaptic fibers active');
    check(/Fibers:/.test(text('#btn-fibers')), 'Fibers button shows edge count: ' + text('#btn-fibers'));
    clickOn('#btn-fibers');
    frames(2);
    check(!q('#btn-fibers').classList.contains('active'), 'Fibers toggle disabled cleanly');
    clickOn('#btn-fibers');
    frames(2);

    shot('connectome-spike');

    const decayed = simUntil(() => !cascade.running && !cascade.fading && cascade.activeCount === 0, 8000, 16);
    check(decayed && cascade.activeCount === 0, 'cascade faded smoothly back to resting brain');
});

test('worker: circuit filters (Dict + NT + out_syn) & Engine Proof telemetry', () => {
    const olCount = neuronsSnap.query().where(bro.table.eq('region', 'OL_L')).count();
    setValue('#filter-region', 'OL_L');
    waitFor(() => splat.hasMask === 1 && app.lastFilterCount < neuronsSnap.rowCount, 'region filter mask applied', 10000);
    check(app.lastFilterCount === olCount, 'worker filter count matches OL_L count: ' + app.lastFilterCount);

    setValue('#filter-nt', '1');
    waitFor(() => app.lastFilterCount < olCount, 'NT filter narrowed further', 10000);

    clickOn('#btn-reset-filters');
    waitFor(() => splat.hasMask === 0 && app.lastFilterCount === neuronsSnap.rowCount, 'filters reset cleanly', 10000);

    const panelTxt = text('#proof-panel');
    check(!/vs JS|Compare vs JS/i.test(panelTxt), 'no vs JS UI remains in Engine Proof');
    check(/rows/.test(panelTxt) && /throughput/.test(panelTxt), 'Engine Proof telemetry populated');
});

done('connectome-atlas');
