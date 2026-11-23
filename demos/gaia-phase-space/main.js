// Gaia DR3 — 6D Galactic Phase-Space & Stellar Time-Machine.
// Connects bro.table mmap/AVX2/Range/SpatialIndex, bro.kernel HDR atomic splatting,
// bro.tensor K-means stream clustering, and 3D SpatialSonifier.

import { boot, $, $$, h, bindControl, fpsMeter, frameLoop, toggleButton } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { createEngineProofPanel } from "/lib/sci-atlas/table-proof.js";

import { GAIA_PACK_SHADER, GAIA_SHADER, MANIFOLDS } from "/app/manifolds.js";
import { GPU_COLS, POP_COLORS, POP_LABELS, SUN_POS, loadGaiaDataset } from "/app/data.js";
import { buildDensityGrids, drawCharts, drawOverlay, evalStarManifold } from "/app/charts.js";

const app = boot();
app.status.busy('loading Gaia DR3 phase-space catalog…');

const dataset = loadGaiaDataset();
const snap = dataset.snap;
const totalRows = snap.rowCount;
const tableStats = snap.stats();

const viewCanvas = $('#view');
const overlayCanvas = $('#overlay');
const hrCanvas = $('#chart-hr');
const toomreCanvas = $('#chart-toomre');

const view = new OrbitView(viewCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.35,
    maxDist: 16.0,
    fovScale: 0.92,
}));

const densScale = Math.min(1.0, Math.pow(150000 / Math.max(150000, totalRows), 0.66));

const engine = new HdrSplatEngine(viewCanvas, GAIA_SHADER, {
    shaderFile: 'gaia_manifolds.bk',
    exposure: 1.05 * densScale,
    bloomAmt: totalRows > 500000 ? 0.14 : 0.24,
    radiusMode: totalRows > 500000 ? 0 : 1,
});
engine.uploadColumns(snap, GPU_COLS);

let packedStores = null;
if (engine.gpuReady) {
    const cb = engine.colBuffers;
    const packMod = bro.kernel.compile(GAIA_PACK_SHADER, { file: 'gaia_pack.bk' });
    const kPack4 = packMod.kernel('k_pack4');
    const kPackPhot = packMod.kernel('k_pack_phot');
    const s0 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const s1 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const s2 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const packStride = Math.min(totalRows, 1048576);
    kPack4.dispatch(packStride, cb.gx, cb.gy, cb.gz, cb.mg, s0, totalRows, packStride);
    kPack4.dispatch(packStride, cb.vx, cb.vy, cb.vz, cb.fe_h, s1, totalRows, packStride);
    kPackPhot.dispatch(packStride, cb.v_phi, cb.v_perp, cb.bp_rp, cb.teff, cb.pop, s2, totalRows, packStride);
    // Free individual unpacked column KernelBuffers now that s0..s2 hold coalesced vec4s
    engine.destroyColumns();
    packedStores = { s0, s1, s2 };
}

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const fps = fpsMeter();

const state = {
    manifold: 0,
    timeMyr: 0.0,
    timeDir: 1,
    timePlaying: false,
    fehMin: -2.5,
    fehMax: 0.6,
    mgMin: -6.0,
    mgMax: 15.0,
    popFilter: -1,
    probePt: SUN_POS.slice(),
    probeHits: null,
    clusters: null,
    densityGrids: buildDensityGrids(snap, null),
    summaryReady: false,
    workerStats: null,
};

const LANDMARKS = [
    { name: 'Solar Neighborhood (Sol)', pt: [-8.122, 0.0, 0.021] },
    { name: 'M67 Old Open Cluster', pt: [-8.74, -0.42, 0.44] },
    { name: 'Gaia-Sausage-Enceladus Halo', pt: [-6.4, 2.2, 3.1] },
    { name: 'Pleiades (M45) Cluster', pt: [-8.24, -0.02, -0.05] },
    { name: 'Galactic Bar Core', pt: [0.4, 0.2, 0.02] },
];
let landmarkIdx = 0;

// Worker RPC (shared O(1) COW TableSnapshot)
const rpc = workerClient('../../lib/sci-atlas/table-worker.js', { type: 'module' });

const proof = createEngineProofPanel($('#proof-panel'));
proof.setProvenance(
    dataset.isReal,
    tableStats,
    'bro-headless --grant files,net,spawn demos/gaia-phase-space demos/gaia-phase-space/ingest.js'
);

$('#st-rows').textContent = fmtInt(totalRows);
$('#hud-backend').textContent = engine.gpuReady ? 'Vulkan HDR' : '2D';
$('#hud-count').textContent = fmtInt(totalRows);

function updateHudTexts() {
    const info = MANIFOLDS[state.manifold] || MANIFOLDS[0];
    const tStr = (state.timeMyr >= 0 ? '+' : '') + state.timeMyr.toFixed(1);
    $('#hud-manifold').innerHTML =
        `<b>${info.short}</b> · Epoch ${tStr} Myr` +
        `<div class="sci-guide">${info.guide}</div>` +
        `<div class="sci-formula">${info.formula}</div>`;
    $('#st-manifold').textContent = String(state.manifold);
    $('#st-epoch').textContent = `${tStr} Myr`;
}

function setManifold(idx) {
    const m = Math.max(0, Math.min(3, idx | 0));
    state.manifold = m;
    for (const btn of $$('[data-manifold]')) {
        btn.classList.toggle('active', (btn.dataset.manifold | 0) === m);
    }
    const dense = totalRows > 500000;
    const mGain = dense
        ? (m === 3 ? 0.26 : (m === 2 ? 0.36 : (m === 1 ? 0.42 : 1.05)))
        : (m === 3 ? 0.42 : (m === 1 ? 0.95 : 1.15));
    engine.exposure = mGain * densScale;
    engine.bloomAmt = dense ? (m === 3 ? 0.08 : 0.14) : (m === 3 ? 0.14 : 0.24);
    view.setManifold(m);
    view.setView(MANIFOLDS[m].preset);
    updateHudTexts();
}

for (const btn of $$('[data-manifold]')) {
    btn.addEventListener('click', () => setManifold(btn.dataset.manifold | 0));
}

const timeCtrl = bindControl('#time-myr', {
    out: '#time-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: 0,
    onChange(v) {
        state.timeMyr = v;
        updateHudTexts();
    },
});

const timePlayBtn = toggleButton('#btn-time-play', {
    on: false,
    labels: ['Orbit Play', 'Orbit Pause'],
    onChange(on) { state.timePlaying = on; },
});

$('#btn-time-reset').addEventListener('click', () => {
    state.timePlaying = false;
    timePlayBtn.on = false;
    state.timeMyr = 0.0;
    timeCtrl.value = 0.0;
    updateHudTexts();
});

toggleButton('#btn-autorotate', {
    on: false,
    labels: ['Auto-Orbit', 'Auto-Orbit: On'],
    onChange(on) { view.autoRotate = on; },
});

toggleButton('#btn-sound', {
    on: false,
    labels: ['Sonify: Off', 'Sonify: On'],
    onChange(on) {
        sonifier.setEnabled(on);
        if (on && state.probeHits) playStarsChord(state.probeHits, state.probePt);
    },
});

function playStarsChord(stars, centerPt) {
    if (!sonifier.enabled || !stars || stars.length === 0) return;
    // Lydian cosmic scale degrees mapped from stellar Teff
    const scale = [130.81, 146.83, 164.81, 185.00, 196.00, 220.00, 246.94,
                   261.63, 293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 523.25, 659.25, 783.99];
    const notes = stars.slice(0, 6).map((s) => {
        const u = Math.max(0, Math.min(1, (s.teff - 2800.0) / 11000.0));
        const freq = scale[Math.min(scale.length - 1, Math.floor(u * scale.length))];
        const wf = s.pop === 2 ? 'triangle' : (s.pop === 3 ? 'sine' : 'sine');
        return {
            freq,
            waveform: wf,
            gain: s.pop === 3 ? 0.20 : 0.14,
            dur: 0.65,
            release: 0.8,
            pos: [
                (s.gx - centerPt[0]) * 5.0,
                (s.gz - centerPt[2]) * 5.0,
                (s.gy - centerPt[1]) * 5.0,
            ],
        };
    });
    sonifier.playChord(notes);
}

function probeGalactocentric(pt, label = 'Cursor Probe') {
    const t0 = performance.now();
    const resTbl = snap.nearest('gal3d', pt, 8);
    const dt = performance.now() - t0;
    const rows = resTbl.toArray();
    state.probePt = pt.slice(0, 3);
    state.probeHits = rows;

    const pBox = $('#probe-box');
    pBox.textContent =
        `${label}\n` +
        `Gal (x,y,z) = (${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}, ${pt[2].toFixed(2)}) kpc\n` +
        `SpatialIndex('gal3d').nearest(8): ${rows.length}★ in ${fmtMs(dt)}`;

    const tbody = $('#probe-list');
    tbody.innerHTML = '';
    for (const r of rows) {
        const pc = Math.round((r._distance || 0) * 1000);
        const popShort = (POP_LABELS[r.pop] || '?').split(' ')[0];
        tbody.appendChild(h('tr', null,
            h('td', null, String(pc)),
            h('td', { style: `color:${POP_COLORS[r.pop] || '#fff'}` }, popShort),
            h('td', null, r.mg.toFixed(1)),
            h('td', null, r.bp_rp.toFixed(2)),
            h('td', null, r.fe_h.toFixed(2)),
            h('td', null, String(Math.round(r.v_phi))),
        ));
    }

    $('#st-probe').textContent = `${rows.length}★ (${fmtMs(dt)})`;
    drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
    playStarsChord(rows, pt);
}

function findNearestStarInManifold(m, clickPt) {
    let best = null;
    let bestD2 = Infinity;
    const nChunks = snap.chunkCount;
    const stride = Math.max(1, Math.floor(totalRows / 25000));
    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const gx = snap.chunkColumnView(ci, 'gx');
        const gy = snap.chunkColumnView(ci, 'gy');
        const gz = snap.chunkColumnView(ci, 'gz');
        const vz = snap.chunkColumnView(ci, 'vz');
        const vp = snap.chunkColumnView(ci, 'v_phi');
        const vpp = snap.chunkColumnView(ci, 'v_perp');
        const bp = snap.chunkColumnView(ci, 'bp_rp');
        const mg = snap.chunkColumnView(ci, 'mg');
        const feh = snap.chunkColumnView(ci, 'fe_h');
        for (let r = 0; r < rc; r += stride) {
            const p = evalStarManifold(m, {
                gx: gx[r], gy: gy[r], gz: gz[r], vz: vz[r],
                v_phi: vp[r], v_perp: vpp[r], bp_rp: bp[r], mg: mg[r], fe_h: feh[r],
            }, 0.0);
            const dx = p[0] - clickPt[0];
            const dy = p[1] - clickPt[1];
            const dz = p[2] - clickPt[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [gx[r], gy[r], gz[r]];
            }
        }
    }
    return best || SUN_POS.slice();
}

view.onProbe = (pt) => {
    const m = view.toManifold | 0;
    if (m === 0) {
        probeGalactocentric([pt[0] / 0.14, pt[2] / 0.14, pt[1] / 0.14], 'Galactic Disk Pick');
    } else {
        const galPt = findNearestStarInManifold(m, pt);
        probeGalactocentric(galPt, `${MANIFOLDS[m].name} Pick`);
    }
};

$('#btn-probe').addEventListener('click', () => {
    const lm = LANDMARKS[landmarkIdx % LANDMARKS.length];
    landmarkIdx++;
    probeGalactocentric(lm.pt, lm.name);
});

$('#btn-cluster').addEventListener('click', async () => {
    const box = $('#cluster-box');
    box.textContent = 'Running bro.tensor K-means (k=5) on (v_φ, v_⊥, [Fe/H], v_z)…';
    const res = await rpc.request({
        type: 'clusterTensor',
        cols: ['v_phi', 'v_perp', 'fe_h', 'vz'],
        k: 5,
        maxSamples: 65536,
    });
    const sorted = (res.clusters || []).slice().sort((a, b) => b.count - a.count);
    state.clusters = sorted;
    const lines = [
        `backend: ${res.backend} · ${fmtMs(res.ms)} · ${fmtInt(res.sampled)} samples`,
    ];
    for (const c of sorted) {
        lines.push(
            `C${c.id + 1}: n=${fmtInt(c.count)}  v_φ=${Math.round(c.center.v_phi)}  v_⊥=${Math.round(c.center.v_perp)}  [Fe/H]=${c.center.fe_h.toFixed(2)}`
        );
    }
    box.textContent = lines.join('\n');
    drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
});

// AVX2 SIMD Filter Controls
let filterSeq = 0;

function collectFilterPredicates() {
    const preds = [];
    if (state.fehMin > -2.49) preds.push({ col: 'fe_h', op: 'ge', val: state.fehMin });
    if (state.fehMax < 0.59) preds.push({ col: 'fe_h', op: 'le', val: state.fehMax });
    if (state.mgMin > -5.9) preds.push({ col: 'mg', op: 'ge', val: state.mgMin });
    if (state.mgMax < 14.9) preds.push({ col: 'mg', op: 'le', val: state.mgMax });
    if (state.popFilter >= 0) preds.push({ col: 'pop', op: 'eq', val: state.popFilter });
    return preds;
}

async function applyFilters() {
    const seq = ++filterSeq;
    const preds = collectFilterPredicates();
    if (preds.length === 0) {
        engine.uploadMask(null);
        $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;
        $('#st-mask').textContent = 'all';
        state.densityGrids = buildDensityGrids(snap, null);
        drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
        return;
    }

    const res = await rpc.request({ type: 'filterMask', predicates: preds, ordCol: 'ord' });
    if (seq !== filterSeq) return;
    const bits = new Uint32Array(res.bitsBuffer);
    engine.uploadMask(bits);
    state.workerStats = res.stats;
    proof.setQueryStats(res.ms, res.total, res.stats);
    $('#filter-matched').textContent = `${fmtInt(res.matched)} / ${fmtInt(res.total)}`;
    $('#st-mask').textContent = fmtInt(res.matched);
    state.densityGrids = buildDensityGrids(snap, bits);
    drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
}

const fehMinCtrl = bindControl('#feh-min', {
    out: '#feh-min-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: -2.5,
    onChange(v) { state.fehMin = v; applyFilters(); },
});
const fehMaxCtrl = bindControl('#feh-max', {
    out: '#feh-max-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: 0.6,
    onChange(v) { state.fehMax = v; applyFilters(); },
});
const mgMinCtrl = bindControl('#mg-min', {
    out: '#mg-min-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: -6.0,
    onChange(v) { state.mgMin = v; applyFilters(); },
});
const mgMaxCtrl = bindControl('#mg-max', {
    out: '#mg-max-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: 15.0,
    onChange(v) { state.mgMax = v; applyFilters(); },
});

for (const chip of $$('#pop-chips [data-pop]')) {
    chip.addEventListener('click', () => {
        state.popFilter = parseInt(chip.dataset.pop, 10);
        for (const c of $$('#pop-chips [data-pop]')) {
            c.classList.toggle('active', parseInt(c.dataset.pop, 10) === state.popFilter);
        }
        applyFilters();
    });
}

$('#btn-filter-reset').addEventListener('click', () => {
    state.fehMin = -2.5; fehMinCtrl.value = -2.5;
    state.fehMax = 0.6; fehMaxCtrl.value = 0.6;
    state.mgMin = -6.0; mgMinCtrl.value = -6.0;
    state.mgMax = 15.0; mgMaxCtrl.value = 15.0;
    state.popFilter = -1;
    for (const c of $$('#pop-chips [data-pop]')) {
        c.classList.toggle('active', parseInt(c.dataset.pop, 10) === -1);
    }
    applyFilters();
});

function renderPopBreakdown(groups) {
    const host = $('#pop-breakdown');
    host.innerHTML = '';
    if (!groups || groups.length === 0) return;
    const maxCnt = Math.max(1, ...groups.map((g) => g.cnt));
    for (const g of groups.slice().sort((a, b) => a.pop - b.pop)) {
        const label = POP_LABELS[g.pop] || ('Pop ' + g.pop);
        const col = POP_COLORS[g.pop] || '#8cc4ff';
        const pct = ((g.cnt / totalRows) * 100).toFixed(1);
        const w = ((g.cnt / maxCnt) * 100).toFixed(1);
        host.appendChild(h('div.gaia-pop-row', null,
            h('span.gaia-pop-dot', { style: `background:${col}` }),
            h('span', { style: 'min-width:110px' }, label),
            h('div.gaia-pop-bar', null, h('i', { style: `width:${w}%; background:${col}` })),
            h('span.dim', null, `${pct}%`),
        ));
    }
}

// Worker boot + initial AVX2 summary & initial Solar probe
(async () => {
    await rpc.ready;
    await rpc.request({ type: 'attachSnapshot', snap });
    const summary = await rpc.request({
        type: 'querySummary',
        groupBy: 'pop',
        aggCol: 'fe_h',
        minCols: ['fe_h', 'mg'],
        maxCols: ['fe_h', 'mg'],
    });
    state.summaryReady = true;
    state.workerStats = summary.execStats;
    proof.setQueryStats(summary.ms, summary.rowCount, summary.execStats);
    renderPopBreakdown(summary.groups);
    $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;
    probeGalactocentric(SUN_POS, LANDMARKS[0].name);
    updateHudTexts();
    app.status.ok(`${fmtInt(totalRows)} stars · ${engine.gpuReady ? 'Vulkan HDR splat' : '2D fallback'} · ${dataset.isReal ? 'mmap' : 'synthetic'}`);
})();

drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
updateHudTexts();

const splatArgs = (cols, cam, meta) => [
    packedStores.s0, packedStores.s1, packedStores.s2,
    meta.maskBuffer,
    meta.count, meta.stride, meta.w, meta.h,
    cam.camR, cam.camU, cam.camF, cam.camT,
    meta.fromManifold, meta.toManifold, meta.morph,
    meta.hasMask, meta.radiusMode, state.timeMyr,
];

let lastFpsStr = '';
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

frameLoop((dt) => {
    if (state.timePlaying) {
        let next = state.timeMyr + state.timeDir * dt * 12.0;
        if (next >= 50.0) { next = 50.0; state.timeDir = -1; }
        else if (next <= -50.0) { next = -50.0; state.timeDir = 1; }
        state.timeMyr = next;
        timeCtrl.value = next;
        updateHudTexts();
    }
    view.step(dt);
    engine.render(view, splatArgs);
    drawOverlay(overlayCanvas, view, state);

    const chartKey = `${hrCanvas.clientWidth}x${hrCanvas.clientHeight}|${toomreCanvas.clientWidth}x${toomreCanvas.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        drawCharts(hrCanvas, toomreCanvas, state.densityGrids, state);
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
        $('#hud-fps').textContent = fpsStr;
    }
});

globalThis.__gaiaApp = {
    state,
    view,
    engine,
    dataset,
    snap,
    applyFilters,
    setManifold,
    probeGalactocentric,
    rpc,
};
