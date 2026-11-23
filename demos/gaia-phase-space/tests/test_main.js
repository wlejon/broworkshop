// Headless end-to-end test for Gaia DR3 — 6D Galactic Phase-Space Observatory.
// Run: scripts/validate.sh demos/gaia-phase-space

import {
    check, test, done, frames, waitFor, clickOn, setValue, q, text, shot,
} from "/lib/kit/test.js";

waitFor(() => globalThis.__gaiaApp && globalThis.__gaiaApp.state.summaryReady, 'initial worker summary', 20000);
frames(15);

const app = globalThis.__gaiaApp;

test('boot: 150k+ rows, RangeIndex & SpatialIndex, AVX2 SIMD worker summary', () => {
    check(app.snap.rowCount >= 120000, 'rowCount >= 120000 (got ' + app.snap.rowCount + ')');
    check(app.snap.hasRangeIndex('mg'), 'RangeIndex(mg) active');
    check(app.snap.hasSpatialIndex('gal3d'), 'SpatialIndex(gal3d) active');
    check(app.state.workerStats && app.state.workerStats.simdWidth > 0,
        'worker AVX2 simdWidth > 0 (got ' + (app.state.workerStats && app.state.workerStats.simdWidth) + ')');
    check(app.engine.gpuReady, 'HdrSplatEngine Vulkan GPU compute active');
    check(document.querySelectorAll('#pop-breakdown .gaia-pop-row').length === 4, '4 population rows rendered');
});

// Capture Manifold 0 (3D Galactic Disk)
shot('gaia-galaxy');

test('time-machine: scrubbing epoch updates simulation cleanly', () => {
    setValue('#time-myr', 25);
    frames(6);
    check(Math.abs(app.state.timeMyr - 25) < 0.01, 'timeMyr updated to 25');
    check(text('#st-epoch').includes('+25.0'), 'status bar reflects +25.0 Myr');
    clickOn('#btn-time-reset');
    frames(4);
    check(Math.abs(app.state.timeMyr) < 0.01, 'timeMyr reset to 0');
});

test('manifolds: morph cleanly across all 4 phase-space projections', () => {
    // 1: 3D HR Evolutionary Relief
    clickOn('[data-manifold="1"]');
    frames(35);
    check(app.state.manifold === 1 && app.view.smoothMorph > 0.99, 'manifold 1 settled');
    shot('gaia-hr');

    // 2: Toomre Galactic Archaeology
    clickOn('[data-manifold="2"]');
    frames(35);
    check(app.state.manifold === 2 && app.view.smoothMorph > 0.99, 'manifold 2 settled');
    shot('gaia-toomre');

    // 3: Vertical Phase-Space Snail
    clickOn('[data-manifold="3"]');
    frames(35);
    check(app.state.manifold === 3 && app.view.smoothMorph > 0.99, 'manifold 3 settled');
    shot('gaia-snail');

    // Return to 0
    clickOn('[data-manifold="0"]');
    frames(35);
    check(app.state.manifold === 0 && app.view.smoothMorph > 0.99, 'returned to manifold 0');
});

test('AVX2 filter mask: Halo/GSE chip + metallicity range + reset', () => {
    clickOn('#pop-chips [data-pop="2"]');
    waitFor(() => app.engine.hasMask === 1, 'mask uploaded for Halo/GSE', 10000);
    frames(6);
    check(app.state.workerStats && app.state.workerStats.simdWidth > 0,
        'AVX2 filter mask used SIMD (simdWidth=' + (app.state.workerStats && app.state.workerStats.simdWidth) + ')');
    check(/\/ /.test(text('#filter-matched')), 'matched filter readout updates: ' + text('#filter-matched'));
    setValue('#feh-max', -0.8);
    frames(4);
    waitFor(() => app.engine.hasMask === 1, 'metallicity range mask updated', 10000);
    clickOn('#btn-filter-reset');
    waitFor(() => app.engine.hasMask === 0, 'mask cleared on reset', 10000);
    frames(4);
});

test('Engine Proof telemetry (no vs JS clutter) & zero-flicker Auto-Orbit stability', () => {
    const panelTxt = text('#proof-panel');
    check(!/vs JS|Compare vs JS/i.test(panelTxt), 'removed vs JS benchmark UI cleanly');
    check(/rows/.test(panelTxt) && /throughput/.test(panelTxt), 'Engine Proof telemetry populated');

    const beforeResizes = app.engine.resizeCount;
    clickOn('#btn-autorotate');
    frames(60);
    check(app.engine.resizeCount === beforeResizes,
        'zero unexpected canvas resizes during 60 Auto-Orbit frames (delta=' + (app.engine.resizeCount - beforeResizes) + ')');
    clickOn('#btn-autorotate');
    frames(2);
});

test('Spatial Probe & Sonifier toggle', () => {
    clickOn('#btn-probe');
    frames(4);
    check(document.querySelectorAll('#probe-list tr').length === 8, 'SpatialIndex.nearest returned 8 stars');
    check(/SpatialIndex/.test(text('#probe-box')), 'probe box shows SpatialIndex telemetry');

    clickOn('#btn-sound');
    frames(3);
    check(q('#btn-sound').classList.contains('active'), 'Sonify toggle activated cleanly');
    clickOn('#btn-probe');
    frames(3);
    clickOn('#btn-sound');
    frames(2);
});

test('bro.tensor K-means stream clustering', () => {
    clickOn('#btn-cluster');
    waitFor(() => app.state.clusters && app.state.clusters.length === 5, 'tensor K-means clusters', 20000);
    frames(4);
    check(/C1:/.test(text('#cluster-box')) && /C5:/.test(text('#cluster-box')),
        'cluster box lists 5 kinematic/chemical clusters');
});

done('gaia-phase-space');
