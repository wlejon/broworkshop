// Headless end-to-end test for Planetary Thermodynamic Memory — 125 Years of Earth's Atmosphere.
// Run: scripts/validate.sh demos/planetary-thermo

import {
    check, test, done, frames, waitFor, clickOn, setValue, q, text, shot,
} from "/lib/kit/test.js";

waitFor(() => globalThis.__thermoApp && globalThis.__thermoApp.state.summaryReady, 'initial worker summary', 30000);
frames(15);

const app = globalThis.__thermoApp;

test('boot: 150k+ obs, companion SpatialIndex(earth3d), Vulkan HDR splat, parallel groupBy(decade)', () => {
    check(app.snap.rowCount >= 120000, 'rowCount >= 120000 (got ' + app.snap.rowCount + ')');
    check(app.dataset.stationsSnap && app.dataset.stationsSnap.hasSpatialIndex('earth3d'),
        'SpatialIndex(earth3d) active on station catalog');
    check(app.engine.gpuReady, 'HdrSplatEngine Vulkan GPU compute active');
    check(document.querySelectorAll('#decade-breakdown .thermo-decade-row').length >= 12,
        'decade warming rows rendered from groupBy(decade)');

    const vRect = q('#view').getBoundingClientRect();
    const img = getPixels(
        Math.round(vRect.left + vRect.width * 0.25),
        Math.round(vRect.top + vRect.height * 0.25),
        Math.round(vRect.width * 0.5),
        Math.round(vRect.height * 0.5)
    );
    let lit = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 32) lit++;
    }
    check(lit > 500, 'GPU splat canvas painted Earth pixels: lit=' + lit);
});

shot('earth-shell');

test('manifolds: smooth transitions across Earth Shell, Climate Helix, Phase-Space, and Hovmöller', () => {
    clickOn('[data-manifold="1"]');
    frames(35);
    check(app.state.manifold === 1 && app.view.smoothMorph > 0.98, 'manifold 1 (Climate Helix) settled');
    shot('climate-helix');

    clickOn('[data-manifold="2"]');
    frames(35);
    check(app.state.manifold === 2 && app.view.smoothMorph > 0.98, 'manifold 2 (Phase-Space) settled');
    shot('phase-space');

    clickOn('[data-manifold="3"]');
    frames(35);
    check(app.state.manifold === 3 && app.view.smoothMorph > 0.98, 'manifold 3 (Hovmöller) settled');
    shot('hovmoller');

    clickOn('[data-manifold="0"]');
    frames(35);
    check(app.state.manifold === 0 && app.view.smoothMorph > 0.98, 'returned to manifold 0');
});

test('century scrubber & year-slice AVX2 SIMD filter', () => {
    setValue('#year-lo', 1990);
    setValue('#year-hi', 2020);
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 1 && app.state.lastFilterMatched < app.snap.rowCount,
        'year-slice mask applied', 30000);
    frames(6);
    check(text('#st-window') === '1990–2020', 'status bar displays 1990–2020 window');
    const qApi = bro.table;
    const cntDirect = app.snap.query().where(qApi.and(qApi.ge('year', 1990), qApi.le('year', 2020))).count();
    check(app.state.lastFilterMatched === cntDirect,
        'year-slice mask count matches table count: ' + cntDirect);

    clickOn('#btn-century-reset');
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 0 && app.state.lastFilterMatched === app.snap.rowCount,
        'century window reset cleanly', 30000);
    frames(4);
});

test('AVX2 SIMD extremes engine: Heatwaves, Polar Blasts, Arctic Amplification, Reset', () => {
    clickOn('#extreme-chips [data-preset="heat"]');
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 1 && app.state.anomMin === 4.0,
        'Heatwaves filter applied', 30000);
    frames(5);
    check(app.state.lastFilterMatched > 0 && app.state.lastFilterMatched < app.snap.rowCount,
        'Heatwaves matched subset: ' + app.state.lastFilterMatched);
    check(app.state.latProfile.activeMeanAll > 4.0, 'Heatwaves mean anomaly > +4.0°C');

    clickOn('#extreme-chips [data-preset="cold"]');
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 1 && app.state.anomMax === -4.0,
        'Polar Blasts filter applied', 30000);
    frames(5);
    check(app.state.latProfile.activeMeanAll < -4.0, 'Polar Blasts mean anomaly < -4.0°C');

    clickOn('#extreme-chips [data-preset="arctic"]');
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 1 && app.state.latMin === 60.0,
        'Arctic filter applied', 30000);
    frames(5);
    check(app.state.workerStats && app.state.workerStats.simdWidth > 0,
        'AVX2 SIMD used on lat > 60° (simdWidth=' + (app.state.workerStats && app.state.workerStats.simdWidth) + ')');

    clickOn('#btn-filter-reset');
    waitFor(() => !app.state.filterBusy && app.engine.hasMask === 0 && app.state.lastFilterMatched === app.snap.rowCount,
        'extreme filters reset cleanly', 30000);
    frames(4);
});

test('Engine Proof telemetry (no vs JS clutter) & zero-flicker Auto-Rotate stability', () => {
    const panelTxt = text('#proof-panel');
    check(!/vs JS|Compare vs JS/i.test(panelTxt), 'removed vs JS benchmark UI cleanly');
    check(/rows/.test(panelTxt) && /throughput/.test(panelTxt), 'Engine Proof telemetry populated');

    const beforeResizes = app.engine.resizeCount;
    clickOn('#btn-autorotate');
    frames(60);
    check(app.engine.resizeCount === beforeResizes,
        'zero unexpected canvas resizes during 60 Auto-Rotate frames');
    clickOn('#btn-autorotate');
    frames(2);
});

test('Spatial Probe (canvas click & button) + SpatialSonifier', () => {
    const vRect = q('#view').getBoundingClientRect();
    click(vRect.left + vRect.width * 0.5, vRect.top + vRect.height * 0.5, 0);
    frames(3);
    check(document.querySelectorAll('#probe-list tr').length === 10,
        'canvas click SpatialIndex.nearest returned 10 stations');

    clickOn('#btn-sound');
    frames(2);
    check(q('#btn-sound').classList.contains('active'), 'Sonify toggle enabled');

    clickOn('#btn-probe');
    frames(4);
    check(document.querySelectorAll('#probe-list tr').length === 10,
        'Spatial Probe button returned 10 stations');
    check(/SpatialIndex/.test(text('#probe-box')), 'probe box shows SpatialIndex telemetry');

    clickOn('#btn-sound');
    frames(2);
});

done('planetary-thermo');
