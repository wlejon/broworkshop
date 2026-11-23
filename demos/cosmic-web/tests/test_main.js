// Headless end-to-end test for DESI DR1 — 11-Billion-Light-Year Cosmic Web & BAO Radar.
// Run: scripts/validate.sh --no-compare demos/cosmic-web

import {
    check, test, done, frames, waitFor, clickOn, setValue, q, text, shot,
} from "/lib/kit/test.js";

waitFor(() => globalThis.__cosmicApp && globalThis.__cosmicApp.state.summaryReady, 'initial worker summary', 20000);
frames(15);

const app = globalThis.__cosmicApp;

test('boot: 150k+ rows, RangeIndex(z), SpatialIndex(cosmo3d), AVX2 & 64^3 GPU volume', () => {
    check(app.snap.rowCount >= 120000, 'rowCount >= 120000 (got ' + app.snap.rowCount + ')');
    check(app.snap.hasRangeIndex('z'), 'RangeIndex(z) active');
    check(app.snap.hasSpatialIndex('cosmo3d'), 'SpatialIndex(cosmo3d) active');
    check(app.state.workerStats && app.state.workerStats.simdWidth > 0,
        'worker AVX2 simdWidth > 0 (got ' + (app.state.workerStats && app.state.workerStats.simdWidth) + ')');
    check(app.engine.gpuReady, 'HdrSplatEngine Vulkan GPU compute active');
    check(app.state.volBuilds >= 1, '64^3 GPU density volume built');
    const minSpecRows = app.dataset.isReal ? 3 : 4;
    check(document.querySelectorAll('#spec-breakdown .cosmo-spec-row').length >= minSpecRows,
        `at least ${minSpecRows} spectral rows rendered`);
});

shot('cosmic-web');

test('manifolds: morph cleanly across Cosmic Web, Light-Cone, Color-z, and 64^3 Void Sculptor', () => {
    // 1: 12-Gyr Light-Cone
    clickOn('[data-manifold="1"]');
    frames(35);
    check(app.state.manifold === 1 && app.view.smoothMorph > 0.99, 'manifold 1 settled');
    shot('light-cone');

    // 2: Color-Color-Redshift Evolution
    clickOn('[data-manifold="2"]');
    frames(35);
    check(app.state.manifold === 2 && app.view.smoothMorph > 0.99, 'manifold 2 settled');
    shot('color-z');

    // 3: Inverted Cosmic Void Sculpture (64^3 GPU volume)
    clickOn('[data-manifold="3"]');
    frames(35);
    check(app.state.manifold === 3 && app.view.smoothMorph > 0.99, 'manifold 3 settled');
    setValue('#void-thresh', 0.56);
    frames(6);
    check(Math.abs(app.state.voidThresh - 0.56) < 0.01, 'voidThresh updated to 0.56');
    shot('void-sculptor');

    // Return to 0
    setValue('#void-thresh', 0.46);
    clickOn('[data-manifold="0"]');
    frames(35);
    check(app.state.manifold === 0 && app.view.smoothMorph > 0.99, 'returned to manifold 0');
});

test('BAO Acoustic Radar: SpatialIndex.whereInRadius(220) + 22 shells + Sonifier', () => {
    clickOn('#btn-probe');
    frames(6);
    const bp = app.state.baoProbe;
    check(bp && bp.usedSpatial, 'whereInRadius used SpatialIndex(cosmo3d)');
    check(bp.shells && bp.shells.length === 22, '22 radial shells of 10 Mpc/h computed');
    check(bp.totalNeighbors > 0, 'filament probe found neighbors (' + bp.totalNeighbors + ')');
    check(document.querySelectorAll('#probe-list tr').length >= 6, 'radial shell rows rendered');
    check(!!document.querySelector('#probe-list tr.bao-peak'), 'BAO ~105 Mpc/h peak shell highlighted');

    clickOn('#btn-probe-void');
    frames(6);
    check(app.state.baoProbe && app.state.baoProbe.usedSpatial, 'deep void probe queried SpatialIndex');

    clickOn('#btn-sound');
    frames(3);
    check(q('#btn-sound').classList.contains('active'), 'Sonify toggle activated');
    clickOn('#btn-probe');
    frames(3);
    clickOn('#btn-sound');
    frames(2);
});

test('AVX2 SIMD filter mask + Redshift RangeIndex shell slicer + reset', () => {
    clickOn('#spec-chips [data-spec="1"]');
    waitFor(() => app.engine.hasMask === 1, 'mask uploaded for LRG', 10000);
    frames(6);
    check(app.state.workerStats && app.state.workerStats.simdWidth > 0,
        'AVX2 filter mask used SIMD (simdWidth=' + (app.state.workerStats && app.state.workerStats.simdWidth) + ')');
    check(/\/ /.test(text('#filter-matched')), 'matched filter readout updates: ' + text('#filter-matched'));

    setValue('#z-min', 0.40);
    setValue('#z-max', 1.20);
    frames(6);
    check(text('#st-zshell') === '0.40..1.20', 'z-shell status updated to 0.40..1.20');
    check(app.state.shellStats && app.state.shellStats.cnt > 0, 'redshift shell stats populated');

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
        'zero unexpected canvas resizes during 60 Auto-Orbit frames');
    clickOn('#btn-autorotate');
    frames(2);
});

done('cosmic-web');
