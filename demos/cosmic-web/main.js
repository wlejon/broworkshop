// DESI DR1 — 11-Billion-Light-Year Cosmic Web, 64^3 GPU Void Sculptor & BAO Acoustic Radar.
// Connects bro.table mmap/AVX2/RangeIndex/SpatialIndex, bro.kernel HDR splat + 64^3 atomic_add volume,
// and BAO standing-wave SpatialSonifier.

import { boot, $, $$, h, bindControl, fpsMeter, frameLoop, toggleButton } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { createEngineProofPanel } from "/lib/sci-atlas/table-proof.js";

import {
    COSMO_PACK_SHADER,
    COSMO_SHADER,
    MANIFOLDS,
    VOL_DIM,
    VOL_TOTAL,
} from "/app/manifolds.js";
import {
    GPU_COLS,
    SPEC_COLORS,
    SPEC_LABELS,
    discoverProbesFromSnap,
    loadCosmoDataset,
    lookbackGyr,
    redshiftFromChi,
} from "/app/data.js";
import {
    buildRedshiftHistogram,
    drawCharts,
    drawOverlay,
    evalGalaxyManifold,
} from "/app/charts.js";

const app = boot();
app.status.busy('loading DESI DR1 cosmic web catalog…');

const dataset = loadCosmoDataset();
const snap = dataset.snap;
const totalRows = snap.rowCount;
const tableStats = snap.stats();
const probes = discoverProbesFromSnap(snap);

const viewCanvas = $('#view');
const overlayCanvas = $('#overlay');
const baoCanvas = $('#chart-bao');
const zCanvas = $('#chart-redshift');

const view = new OrbitView(viewCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.45,
    maxDist: 18.0,
    fovScale: 0.92,
}));

const densScale = Math.min(1.0, Math.pow(150000 / Math.max(150000, totalRows), 0.66));

const engine = new HdrSplatEngine(viewCanvas, COSMO_SHADER, {
    shaderFile: 'cosmo_manifolds.bk',
    exposure: 1.10 * densScale,
    bloomAmt: totalRows > 500000 ? 0.16 : 0.28,
    radiusMode: 0,
});
engine.uploadColumns(snap, GPU_COLS);

let gpuState = null;
if (engine.gpuReady) {
    const cb = engine.colBuffers;
    const packMod = bro.kernel.compile(COSMO_PACK_SHADER, { file: 'cosmo_pack.bk' });
    const kPackS0 = packMod.kernel('k_pack_s0');
    const kPackS1 = packMod.kernel('k_pack_s1');
    const kVolClear = packMod.kernel('k_vol_clear');
    const kVolDeposit = packMod.kernel('k_vol_deposit');
    const kVolSculpt = packMod.kernel('k_vol_sculpt');

    const s0 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const s1 = bro.kernel.createBuffer(totalRows * 16, { residency: 'gpu' });
    const volRaw = bro.kernel.createBuffer(VOL_TOTAL * 4, { residency: 'gpu' });
    const volSculpt = bro.kernel.createBuffer(VOL_TOTAL * 4, { residency: 'gpu' });

    const packStride = Math.min(totalRows, 1048576);
    kPackS0.dispatch(packStride, cb.cx, cb.cy, cb.cz, cb.z, s0, totalRows, packStride);
    kPackS1.dispatch(packStride, cb.g_r, cb.r_z, cb.flux_r, cb.void_score, cb.spectype, s1, totalRows, packStride);
    engine.destroyColumns();

    gpuState = {
        s0, s1, volRaw, volSculpt,
        kVolClear, kVolDeposit, kVolSculpt,
    };
}

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const fps = fpsMeter();

const state = {
    manifold: 0,
    zMin: 0.0,
    zMax: 3.5,
    grMin: -0.5,
    grMax: 2.5,
    specFilter: -1,
    voidThresh: 0.46,
    voidGlow: 1.15,
    baoProbe: null,
    zHist: buildRedshiftHistogram(snap, null),
    summaryReady: false,
    workerStats: null,
    shellStats: null,
    volBuilds: 0,
    volBuildMs: 0,
};

let filamentIdx = 0;
let voidIdx = 0;

function rebuildGpuVoidVolume() {
    if (!engine.gpuReady || !gpuState) return;
    const t0 = performance.now();
    const stride = Math.min(totalRows, 1048576);
    gpuState.kVolClear.dispatch(VOL_TOTAL, gpuState.volRaw, VOL_TOTAL);
    gpuState.kVolDeposit.dispatch(
        stride,
        gpuState.s0,
        engine.maskBuffer,
        gpuState.volRaw,
        totalRows,
        stride,
        engine.hasMask
    );
    gpuState.kVolSculpt.dispatch(
        [VOL_DIM, VOL_DIM, VOL_DIM],
        gpuState.volRaw,
        gpuState.volSculpt
    );
    state.volBuilds++;
    state.volBuildMs = performance.now() - t0;
    updateShellReadout();
}

function updateShellReadout() {
    const lb0 = lookbackGyr(state.zMin);
    const lb1 = lookbackGyr(state.zMax);
    const sh = state.shellStats;
    const lines = [
        `Redshift shell: z ∈ [${state.zMin.toFixed(2)}, ${state.zMax.toFixed(2)}]`,
        `Lookback age:   ${lb0.toFixed(2)} – ${lb1.toFixed(2)} Gyr`,
    ];
    if (sh) {
        lines.push(`RangeIndex('z'): ${fmtInt(sh.cnt)} objs (${fmtMs(sh.ms)})`);
        lines.push(`Mean void_score: ${sh.avgVoid.toFixed(3)} · avg age ${sh.avgLb.toFixed(2)} Gyr`);
    }
    lines.push(`64³ GPU volume: ${fmtInt(VOL_TOTAL)} voxels (${state.volBuilds} pass, ${fmtMs(state.volBuildMs)})`);
    $('#shell-box').textContent = lines.join('\n');
}

function queryRedshiftShellStats() {
    const q = bro.table;
    const t0 = performance.now();
    const res = snap.query()
        .where(q.and(q.ge('z', state.zMin), q.le('z', state.zMax)))
        .agg({
            cnt: q.count(),
            avgLb: q.avg('lookback_gyr'),
            avgVoid: q.avg('void_score'),
        })
        .runWithStats();
    const dt = performance.now() - t0;
    const row = res.table.rowCount > 0 ? res.table.row(0) : { cnt: 0, avgLb: 0, avgVoid: 0 };
    state.shellStats = {
        cnt: row.cnt || 0,
        avgLb: row.avgLb || 0,
        avgVoid: row.avgVoid || 0,
        usedRange: res.usedRangeIndex,
        ms: dt,
    };
    updateShellReadout();
}

const rpc = workerClient('../../lib/sci-atlas/table-worker.js', { type: 'module' });

const proof = createEngineProofPanel($('#proof-panel'));
proof.setProvenance(
    dataset.isReal,
    tableStats,
    'bro-headless --grant files,spawn demos/cosmic-web demos/cosmic-web/ingest.js'
);

$('#st-rows').textContent = fmtInt(totalRows);
$('#hud-backend').textContent = engine.gpuReady ? 'Vulkan HDR' : '2D';
$('#hud-count').textContent = fmtInt(totalRows);

function updateHudTexts() {
    const info = MANIFOLDS[state.manifold] || MANIFOLDS[0];
    const lb0 = lookbackGyr(state.zMin).toFixed(1);
    const lb1 = lookbackGyr(state.zMax).toFixed(1);
    $('#hud-manifold').innerHTML =
        `<b>${info.short}</b> · z ∈ [${state.zMin.toFixed(2)}, ${state.zMax.toFixed(2)}] (${lb0}–${lb1} Gyr)` +
        `<div class="sci-guide">${info.guide}</div>` +
        `<div class="sci-formula">${info.formula}</div>`;
    $('#st-manifold').textContent = String(state.manifold);
    $('#st-zshell').textContent = `${state.zMin.toFixed(2)}..${state.zMax.toFixed(2)}`;
}

function setManifold(idx) {
    const m = Math.max(0, Math.min(3, idx | 0));
    state.manifold = m;
    for (const btn of $$('[data-manifold]')) {
        btn.classList.toggle('active', (btn.dataset.manifold | 0) === m);
    }
    const dense = totalRows > 500000;
    const mGain = m === 3 ? 0.95 : (m === 2 ? 0.52 : (m === 1 ? 0.78 : 1.10));
    engine.exposure = mGain * densScale;
    engine.bloomAmt = m === 3 ? 0.32 : (dense ? 0.16 : 0.25);
    engine.radiusMode = 0;
    view.setManifold(m);
    view.setView(MANIFOLDS[m].preset);
    updateHudTexts();
}

for (const btn of $$('[data-manifold]')) {
    btn.addEventListener('click', () => setManifold(btn.dataset.manifold | 0));
}

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
        if (on && state.baoProbe) playBaoAcousticChord(state.baoProbe);
    },
});

function playBaoAcousticChord(probe) {
    if (!sonifier.enabled || !probe) return;
    // Primordial baryon-photon fluid standing-wave harmonics modulated by BAO shell ξ(r)
    const f0 = 98.0 + 46.0 * Math.max(0, Math.min(1, 1.0 - probe.centerZ / 2.2));
    const peakGain = Math.max(0.08, Math.min(0.24, 0.14 + probe.peakR2Xi * 0.05));
    const ratios = probe.isVoid ? [1.0, 1.5, 2.25, 3.0, 3.75] : [1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
    const shellIndices = [2, 6, 10, 12, 15, 19];
    const p = probe.center;
    const notes = ratios.map((r, i) => {
        const s = probe.shells[shellIndices[i] || 10];
        const amp = s ? Math.max(0.05, Math.min(0.22, peakGain * (0.65 + 0.35 * Math.max(-0.5, s.xi)))) : 0.12;
        return {
            freq: f0 * r,
            waveform: (!probe.isVoid && i % 2 === 1) ? 'triangle' : 'sine',
            gain: amp,
            dur: probe.isVoid ? 0.85 : 0.72,
            release: 0.90,
            pos: [p[0] * 0.002, p[2] * 0.002, p[1] * 0.002],
        };
    });
    sonifier.playChord(notes);
}

function probeBaoSphere(pt, label = 'BAO Acoustic Probe') {
    const R_QUERY = 220.0;
    const N_BINS = 22;
    const DR = 10.0;

    const t0 = performance.now();
    const res = snap.query()
        .whereInRadius('cosmo3d', pt, R_QUERY)
        .select({
            cx: 'cx', cy: 'cy', cz: 'cz',
            z: 'z', spectype: 'spectype', void_score: 'void_score',
        })
        .runWithStats();
    const dt = performance.now() - t0;

    const bins = new Int32Array(N_BINS);
    const outTbl = res.table;
    const nChunks = outTbl.chunkCount;
    const totalNeighbors = outTbl.rowCount;
    let sumVoid = 0.0;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = outTbl.chunkRowCount(ci);
        const cx = outTbl.chunkColumnView(ci, 'cx');
        const cy = outTbl.chunkColumnView(ci, 'cy');
        const cz = outTbl.chunkColumnView(ci, 'cz');
        const vs = outTbl.chunkColumnView(ci, 'void_score');
        for (let r = 0; r < rc; r++) {
            const dist = Math.hypot(cx[r] - pt[0], cy[r] - pt[1], cz[r] - pt[2]);
            const b = Math.floor(dist / DR);
            if (b >= 0 && b < N_BINS) bins[b]++;
            sumVoid += vs[r];
        }
    }

    // Outer annulus (140..220 Mpc/h) baseline density for normalized radial excess ξ(r)
    let outerObs = 0;
    let outerVol = 0;
    const fourThirdsPi = (4.0 / 3.0) * Math.PI;
    for (let b = 14; b < N_BINS; b++) {
        const r0 = b * DR, r1 = (b + 1) * DR;
        outerObs += bins[b];
        outerVol += fourThirdsPi * (r1 * r1 * r1 - r0 * r0 * r0);
    }
    const sphereVol = fourThirdsPi * R_QUERY * R_QUERY * R_QUERY;
    const rhoBg = Math.max(1e-7, 0.7 * (outerObs / Math.max(1.0, outerVol)) + 0.3 * (totalNeighbors / sphereVol));

    const shells = [];
    let baoPeakBin = 10;
    let baoPeakR2Xi = -Infinity;
    let coreObs = 0, coreExp = 0;

    for (let b = 0; b < N_BINS; b++) {
        const r0 = b * DR;
        const r1 = (b + 1) * DR;
        const rMid = 0.5 * (r0 + r1);
        const dV = fourThirdsPi * (r1 * r1 * r1 - r0 * r0 * r0);
        const expN = rhoBg * dV;
        const obsN = bins[b];
        const xi = expN > 1e-6 ? (obsN / expN) - 1.0 : 0.0;
        const r2xi = ((rMid / 100.0) * (rMid / 100.0)) * xi;
        shells.push({ bin: b, r0, r1, rMid, obsN, expN, xi, r2xi });

        if (b < 5) { coreObs += obsN; coreExp += expN; }
        if (b >= 8 && b <= 12 && r2xi > baoPeakR2Xi) {
            baoPeakR2Xi = r2xi;
            baoPeakBin = b;
        }
    }

    const chiCenter = Math.hypot(pt[0], pt[1], pt[2]);
    const centerZ = redshiftFromChi(chiCenter);
    const centerLb = lookbackGyr(centerZ);
    const isVoid = (totalNeighbors < 16) || (coreObs < coreExp * 0.55);

    state.baoProbe = {
        label,
        center: pt.slice(0, 3),
        centerZ,
        centerLb,
        totalNeighbors,
        usedSpatial: res.usedSpatialIndex,
        ms: dt,
        shells,
        baoPeakBin,
        peakR2Xi: Number.isFinite(baoPeakR2Xi) ? baoPeakR2Xi : 0.0,
        meanVoidScore: totalNeighbors > 0 ? (sumVoid / totalNeighbors) : 1.0,
        isVoid,
    };

    const peakS = shells[baoPeakBin] || shells[10];
    $('#probe-box').textContent =
        `${label} (z=${centerZ.toFixed(2)}, ${centerLb.toFixed(1)} Gyr)\n` +
        `cx,cy,cz = (${Math.round(pt[0])}, ${Math.round(pt[1])}, ${Math.round(pt[2])}) Mpc/h\n` +
        `whereInRadius(220): ${fmtInt(totalNeighbors)} objs in ${fmtMs(dt)} · BAO peak @ ${Math.round(peakS.rMid)} Mpc/h`;

    const displayBins = Array.from(new Set([0, 3, 6, 8, 9, 10, 11, 12, 15, 19, baoPeakBin])).sort((a, b) => a - b);
    const tbody = $('#probe-list');
    tbody.innerHTML = '';
    for (const b of displayBins) {
        const s = shells[b];
        if (!s) continue;
        const tr = h('tr', { class: b === baoPeakBin ? 'bao-peak' : null },
            h('td', null, `${s.r0}–${s.r1}`),
            h('td', null, fmtInt(s.obsN)),
            h('td', null, s.expN.toFixed(1)),
            h('td', null, (s.xi >= 0 ? '+' : '') + s.xi.toFixed(2)),
            h('td', null, (s.r2xi >= 0 ? '+' : '') + s.r2xi.toFixed(2)),
        );
        tbody.appendChild(tr);
    }

    $('#st-probe').textContent = `${isVoid ? 'Void' : 'BAO'} ${Math.round(peakS.rMid)} Mpc/h (${fmtMs(dt)})`;
    drawCharts(baoCanvas, zCanvas, state.zHist, state);
    playBaoAcousticChord(state.baoProbe);
}

function findNearestGalaxyInManifold(m, clickPt) {
    let best = null;
    let bestD2 = Infinity;
    const nChunks = snap.chunkCount;
    const stride = Math.max(1, Math.floor(totalRows / 25000));
    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const cx = snap.chunkColumnView(ci, 'cx');
        const cy = snap.chunkColumnView(ci, 'cy');
        const cz = snap.chunkColumnView(ci, 'cz');
        const zc = snap.chunkColumnView(ci, 'z');
        const gr = snap.chunkColumnView(ci, 'g_r');
        const rz = snap.chunkColumnView(ci, 'r_z');
        for (let r = 0; r < rc; r += stride) {
            const p = evalGalaxyManifold(m, {
                cx: cx[r], cy: cy[r], cz: cz[r],
                z: zc[r], g_r: gr[r], r_z: rz[r],
            });
            const d2 = (p[0] - clickPt[0]) ** 2 + (p[1] - clickPt[1]) ** 2 + (p[2] - clickPt[2]) ** 2;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [cx[r], cy[r], cz[r]];
            }
        }
    }
    return best || probes.filamentLandmarks[0].pt;
}

view.onProbe = (pt) => {
    const m = view.toManifold | 0;
    if (m === 0) {
        const rawPt = [pt[0] / 0.0008, pt[2] / 0.0008, pt[1] / 0.0008];
        const near = snap.nearest('cosmo3d', rawPt, 1, 240.0);
        if (near.rowCount > 0) {
            const r0 = near.row(0);
            probeBaoSphere([r0.cx, r0.cy, r0.cz], 'Cosmic Web Pick');
        } else {
            probeBaoSphere(rawPt, 'Cosmic Web Void Pick');
        }
    } else if (m === 3) {
        const rawPt = [pt[0] / 0.0008, pt[2] / 0.0008, pt[1] / 0.0008];
        probeBaoSphere(rawPt, 'Void Sculptor Pick');
    } else {
        const galPt = findNearestGalaxyInManifold(m, pt);
        probeBaoSphere(galPt, `${MANIFOLDS[m].name} Pick`);
    }
};

$('#btn-probe').addEventListener('click', () => {
    const lm = probes.filamentLandmarks[filamentIdx % probes.filamentLandmarks.length];
    filamentIdx++;
    probeBaoSphere(lm.pt, lm.name);
});

$('#btn-probe-void').addEventListener('click', () => {
    const vm = probes.voidLandmarks[voidIdx % probes.voidLandmarks.length];
    voidIdx++;
    probeBaoSphere(vm.pt, vm.name);
});

$('#btn-revox').addEventListener('click', () => {
    rebuildGpuVoidVolume();
});

const voidThreshCtrl = bindControl('#void-thresh', {
    out: '#void-thresh-val',
    fmt: (v) => v.toFixed(2),
    reset: 0.46,
    onChange(v) { state.voidThresh = v; },
});

const voidGlowCtrl = bindControl('#void-glow', {
    out: '#void-glow-val',
    fmt: (v) => v.toFixed(2),
    reset: 1.15,
    onChange(v) { state.voidGlow = v; },
});
void voidThreshCtrl;
void voidGlowCtrl;

// AVX2 SIMD Filter & Redshift Shell Slicer
let filterSeq = 0;

function collectFilterPredicates() {
    const preds = [];
    if (state.zMin > 0.01) preds.push({ col: 'z', op: 'ge', val: state.zMin });
    if (state.zMax < 3.49) preds.push({ col: 'z', op: 'le', val: state.zMax });
    if (state.grMin > -0.49) preds.push({ col: 'g_r', op: 'ge', val: state.grMin });
    if (state.grMax < 2.49) preds.push({ col: 'g_r', op: 'le', val: state.grMax });
    if (state.specFilter >= 0) preds.push({ col: 'spectype', op: 'eq', val: state.specFilter });
    return preds;
}

async function applyFilters() {
    const seq = ++filterSeq;
    updateHudTexts();
    queryRedshiftShellStats();

    const preds = collectFilterPredicates();
    if (preds.length === 0) {
        engine.uploadMask(null);
        rebuildGpuVoidVolume();
        $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;
        $('#st-mask').textContent = 'all';
        state.zHist = buildRedshiftHistogram(snap, null);
        drawCharts(baoCanvas, zCanvas, state.zHist, state);
        return;
    }

    const res = await rpc.request({ type: 'filterMask', predicates: preds, ordCol: 'ord' });
    if (seq !== filterSeq) return;
    const bits = new Uint32Array(res.bitsBuffer);
    engine.uploadMask(bits);
    rebuildGpuVoidVolume();
    state.workerStats = res.stats;
    proof.setQueryStats(res.ms, res.total, res.stats);
    $('#filter-matched').textContent = `${fmtInt(res.matched)} / ${fmtInt(res.total)}`;
    $('#st-mask').textContent = fmtInt(res.matched);
    state.zHist = buildRedshiftHistogram(snap, bits);
    drawCharts(baoCanvas, zCanvas, state.zHist, state);
}

const zMinCtrl = bindControl('#z-min', {
    out: '#z-min-val',
    fmt: (v) => v.toFixed(2),
    reset: 0.0,
    onChange(v) { state.zMin = v; applyFilters(); },
});
const zMaxCtrl = bindControl('#z-max', {
    out: '#z-max-val',
    fmt: (v) => v.toFixed(2),
    reset: 3.5,
    onChange(v) { state.zMax = v; applyFilters(); },
});
const grMinCtrl = bindControl('#gr-min', {
    out: '#gr-min-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: -0.5,
    onChange(v) { state.grMin = v; applyFilters(); },
});
const grMaxCtrl = bindControl('#gr-max', {
    out: '#gr-max-val',
    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(1),
    reset: 2.5,
    onChange(v) { state.grMax = v; applyFilters(); },
});

for (const chip of $$('#spec-chips [data-spec]')) {
    chip.addEventListener('click', () => {
        state.specFilter = parseInt(chip.dataset.spec, 10);
        for (const c of $$('#spec-chips [data-spec]')) {
            c.classList.toggle('active', parseInt(c.dataset.spec, 10) === state.specFilter);
        }
        applyFilters();
    });
}

$('#btn-filter-reset').addEventListener('click', () => {
    state.zMin = 0.0; zMinCtrl.value = 0.0;
    state.zMax = 3.5; zMaxCtrl.value = 3.5;
    state.grMin = -0.5; grMinCtrl.value = -0.5;
    state.grMax = 2.5; grMaxCtrl.value = 2.5;
    state.specFilter = -1;
    for (const c of $$('#spec-chips [data-spec]')) {
        c.classList.toggle('active', parseInt(c.dataset.spec, 10) === -1);
    }
    applyFilters();
});

function renderSpecBreakdown(groups) {
    const host = $('#spec-breakdown');
    host.innerHTML = '';
    if (!groups || groups.length === 0) return;
    const maxCnt = Math.max(1, ...groups.map((g) => g.cnt));
    for (const g of groups.slice().sort((a, b) => a.spectype - b.spectype)) {
        const label = SPEC_LABELS[g.spectype] || ('Type ' + g.spectype);
        const col = SPEC_COLORS[g.spectype] || '#8cc4ff';
        const pct = ((g.cnt / totalRows) * 100).toFixed(1);
        const w = ((g.cnt / maxCnt) * 100).toFixed(1);
        host.appendChild(h('div.cosmo-spec-row', null,
            h('span.cosmo-spec-dot', { style: `background:${col}` }),
            h('span', { style: 'min-width:118px' }, label),
            h('div.cosmo-spec-bar', null, h('i', { style: `width:${w}%; background:${col}` })),
            h('span.dim', null, `${pct}%`),
        ));
    }
}

(async () => {
    await rpc.ready;
    await rpc.request({ type: 'attachSnapshot', snap });
    const summary = await rpc.request({
        type: 'querySummary',
        groupBy: 'spectype',
        aggCol: 'z',
        minCols: ['z', 'g_r'],
        maxCols: ['z', 'g_r'],
    });
    state.summaryReady = true;
    state.workerStats = summary.execStats;
    proof.setQueryStats(summary.ms, summary.rowCount, summary.execStats);
    renderSpecBreakdown(summary.groups);
    $('#filter-matched').textContent = `all (${fmtInt(totalRows)})`;

    rebuildGpuVoidVolume();
    queryRedshiftShellStats();
    probeBaoSphere(probes.filamentLandmarks[0].pt, probes.filamentLandmarks[0].name);
    updateHudTexts();
    app.status.ok(`${fmtInt(totalRows)} objs · ${engine.gpuReady ? 'Vulkan 64³ Void + HDR Splat' : '2D fallback'} · ${dataset.isReal ? 'mmap' : 'synthetic'}`);
})();

drawCharts(baoCanvas, zCanvas, state.zHist, state);
updateHudTexts();

const splatArgs = (cols, cam, meta) => [
    gpuState.s0, gpuState.s1, gpuState.volSculpt,
    meta.maskBuffer,
    meta.count, meta.stride, meta.w, meta.h,
    cam.camR, cam.camU, cam.camF, cam.camT,
    meta.fromManifold, meta.toManifold, meta.morph,
    meta.hasMask, meta.radiusMode,
    state.voidThresh,
    state.voidGlow * Math.min(8.5, 1.0 / Math.max(0.11, densScale * 1.15)),
    (state.zMin > 0.01 || state.zMax < 3.49) ? 0.5 * (state.zMin + state.zMax) : -1.0,
];

let lastFpsStr = '';
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

frameLoop((dt) => {
    view.step(dt);
    engine.render(view, splatArgs);
    drawOverlay(overlayCanvas, view, state);

    const chartKey = `${baoCanvas.clientWidth}x${baoCanvas.clientHeight}|${zCanvas.clientWidth}x${zCanvas.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        drawCharts(baoCanvas, zCanvas, state.zHist, state);
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
        $('#hud-fps').textContent = fpsStr;
    }
});

globalThis.__cosmicApp = {
    state,
    view,
    engine,
    dataset,
    snap,
    probes,
    applyFilters,
    setManifold,
    probeBaoSphere,
    rebuildGpuVoidVolume,
    rpc,
};
