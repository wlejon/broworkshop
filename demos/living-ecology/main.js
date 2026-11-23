// Living Biosphere — Closed-Loop Artificial Ecology on Mutable bro.table + Vulkan GPU.
// Connects mutable multi-table bro.table (organisms, species, zones), Vulkan GPU advection &
// rotating chunk writeback (readFromKernelBuffer), ReactiveQuery incremental chunk tracking,
// spatial brushes (whereInRadius / whereInAABB), O(1) COW Worker joins/tensor, and .brotable v3 mmap.

import { boot, $, $$, h, bindControl, fpsMeter, frameLoop, segmented, toggleButton } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { createLivingVitalsPanel } from "/lib/living-table/living-hud.js";

import {
    GPU_COLS,
    SPECIES_DEFS,
    buildAnalyticsBatch,
    createEcologyTables,
    makeOffspringBatch,
    resolveCheckpointPath,
} from "/app/data.js";
import {
    ECO_COMPUTE_SHADER,
    ECO_SPLAT_SHADER,
    MANIFOLDS,
    evalOrganismManifold,
} from "/app/manifolds.js";
import {
    buildPhaseGrid,
    drawOverlay,
    drawPhaseAndReuseChart,
    drawSpeciesChart,
} from "/app/charts.js";

const app = boot();
app.status.busy('generating 131,072 biosphere organisms across 64 habitat zones…');

const world = createEcologyTables();
let organisms = world.organisms;
const species = world.species;
const zones = world.zones;

const viewCanvas = $('#view');
const overlayCanvas = $('#overlay');
const speciesCanvas = $('#chart-species');
const phaseCanvas = $('#chart-phase');

const view = new OrbitView(viewCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.45,
    maxDist: 12.0,
    fovScale: 0.92,
}));

const engine = new HdrSplatEngine(viewCanvas, ECO_SPLAT_SHADER, {
    shaderFile: 'eco_manifolds.bk',
    exposure: 0.64,
    bloomAmt: 0.22,
    radiusMode: 0,
});
engine.uploadMask(null);

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const vitals = createLivingVitalsPanel($('#vitals-panel'));
const fps = fpsMeter();

const REEF_ANCHORS = [
    [0.74, 0.0, 0.0],
    [-0.74, 0.05, 0.0],
    [0.0, 0.08, 0.74],
    [0.36, -0.35, 0.36],
    [-0.45, 0.42, 0.32],
];
let anchorCursor = 0;

const state = {
    manifold: 0,
    simPlaying: true,
    simTime: 0.0,
    flowAmp: 1.0,
    metabRate: 1.0,
    brushMode: 'probe',
    probePt: REEF_ANCHORS[0].slice(),
    probeHits: null,
    lastActionKind: 'probe',
    nextId: world.nextId,
    frameTick: 0,
    writebackTick: 0,
    snapshotsShipped: 0,
    lastWritebackLabel: 'initializing…',
    lastReactive: { recomputedChunks: 0, reusedChunks: organisms.chunkCount },
    reuseHistory: [],
    trophicRows: [],
    topThriving: [],
    stressZones: null,
    tensorOut: null,
    lastCheckpoint: null,
    lastWorkerPlan: null,
    phaseGrid: buildPhaseGrid(organisms),
};

// GPU compute kernels & coalesced vec4 buffers
let kPackEco = null;
let kSyncEs = null;
let kStepEco = null;
let kExtractChunk = null;
let kExtractFull = null;
let gpuStores = null;
let chunkEnergyKb = null;
let chunkStressKb = null;

if (engine.gpuReady) {
    const compMod = bro.kernel.compile(ECO_COMPUTE_SHADER, { file: 'eco_compute.bk' });
    kPackEco = compMod.kernel('k_pack_eco');
    kSyncEs = compMod.kernel('k_sync_es');
    kStepEco = compMod.kernel('k_step_eco');
    kExtractChunk = compMod.kernel('k_extract_chunk_col');
    kExtractFull = compMod.kernel('k_extract_full_col');
    chunkEnergyKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
    chunkStressKb = bro.kernel.createBuffer(4096 * 4, { residency: 'shared' });
}

function ensureGpuStoreCapacity(rowCount) {
    const need = Math.max(4096, rowCount);
    if (gpuStores && gpuStores.capacity >= need) return;
    if (gpuStores) {
        try { gpuStores.basePos.destroy(); } catch (_) {}
        try { gpuStores.s0.destroy(); } catch (_) {}
        try { gpuStores.s1.destroy(); } catch (_) {}
    }
    const cap = Math.ceil(need / 4096) * 4096;
    gpuStores = {
        capacity: cap,
        basePos: bro.kernel.createBuffer(cap * 16, { residency: 'gpu' }),
        s0: bro.kernel.createBuffer(cap * 16, { residency: 'gpu' }),
        s1: bro.kernel.createBuffer(cap * 16, { residency: 'gpu' }),
    };
}

function packEcoFromTable() {
    const n = organisms.rowCount;
    engine.rowCount = n;
    if (!engine.gpuReady || n <= 0) return;
    ensureGpuStoreCapacity(n);
    const kbs = {};
    for (const c of GPU_COLS) {
        kbs[c] = organisms.toKernelBuffer(c, { residency: 'gpu' });
    }
    const stride = Math.min(n, 1048576);
    kPackEco.dispatch(
        stride,
        kbs.x, kbs.y, kbs.z, kbs.energy, kbs.stress, kbs.nutrient, kbs.age, kbs.species_id,
        gpuStores.basePos, gpuStores.s0, gpuStores.s1,
        n, stride
    );
    for (const c of GPU_COLS) {
        try { kbs[c].destroy(); } catch (_) {}
    }
}

function syncEnergyStressToGpu() {
    const n = organisms.rowCount;
    if (!engine.gpuReady || n <= 0 || !gpuStores) return;
    if (n > gpuStores.capacity) {
        packEcoFromTable();
        return;
    }
    const kbE = organisms.toKernelBuffer('energy', { residency: 'gpu' });
    const kbS = organisms.toKernelBuffer('stress', { residency: 'gpu' });
    const stride = Math.min(n, 1048576);
    kSyncEs.dispatch(stride, kbE, kbS, gpuStores.s0, gpuStores.s1, n, stride);
    try { kbE.destroy(); } catch (_) {}
    try { kbS.destroy(); } catch (_) {}
}

packEcoFromTable();

// ReactiveQuery live monitor on critical organisms
let criticalRq = null;

function updateCriticalDisplay(critCount) {
    $('#st-crit').textContent = fmtInt(critCount);
    $('#crit-badge').textContent = `${fmtInt(critCount)} flagged`;
}

function initReactiveCritical() {
    if (criticalRq) {
        try { criticalRq.dispose(); } catch (_) {}
    }
    const q = bro.table;
    criticalRq = organisms.query()
        .where(q.or(q.gt('stress', 0.72), q.lt('energy', 0.22)))
        .reactive();
    criticalRq.onChange((ev) => {
        const rec = ev.recomputedChunks | 0;
        const reu = ev.reusedChunks | 0;
        const tot = Math.max(1, rec + reu);
        state.lastReactive = { recomputedChunks: rec, reusedChunks: reu };
        state.reuseHistory.push({ recomputed: rec, reused: reu, total: tot, ratio: reu / tot });
        if (state.reuseHistory.length > 48) state.reuseHistory.shift();
    });
    const initCnt = criticalRq.table ? criticalRq.table.rowCount : 0;
    const chunks = Math.max(1, organisms.chunkCount);
    state.lastReactive = { recomputedChunks: chunks, reusedChunks: 0 };
    state.reuseHistory.push({ recomputed: chunks, reused: 0, total: chunks, ratio: 0 });
    updateCriticalDisplay(initCnt);
}

function refreshReactiveCritical() {
    if (!criticalRq) return null;
    if (criticalRq.dirty()) {
        const rr = criticalRq.refresh();
        updateCriticalDisplay(rr.table ? rr.table.rowCount : 0);
        return rr;
    }
    return {
        table: criticalRq.table,
        changed: false,
        version: criticalRq.version,
        recomputedChunks: 0,
        reusedChunks: organisms.chunkCount,
    };
}

function updateVitalsUI(writebackLabel = null) {
    if (writebackLabel != null) state.lastWritebackLabel = writebackLabel;
    const st = organisms.stats();
    $('#hud-count').textContent = fmtInt(st.rowCount);
    $('#st-rows').textContent = fmtInt(st.rowCount);
    $('#st-ver').textContent = `v${organisms.version} / s${organisms.structureVersion}`;
    $('#st-dead').textContent = fmtInt(st.tombstoneCount);
    vitals.update({
        tableStats: st,
        version: organisms.version,
        structureVersion: organisms.structureVersion,
        reactive: state.lastReactive,
        gpuWriteback: state.lastWritebackLabel,
        workerPlan: state.lastWorkerPlan,
        snapshotsShipped: state.snapshotsShipped,
        checkpoint: state.lastCheckpoint,
    });
}

function extractGpuToTableStep(forceAll = false) {
    const st = organisms.stats();
    if (!engine.gpuReady || !gpuStores || st.rowCount <= 0) return;
    const t0 = performance.now();

    if (st.tombstoneCount === 0 && !forceAll) {
        const nChunks = organisms.chunkCount;
        if (nChunks <= 0) return;
        const ci0 = state.writebackTick % nChunks;
        const ci1 = (state.writebackTick + 1) % nChunks;
        state.writebackTick = (state.writebackTick + 2) % nChunks;
        const targets = (nChunks >= 2 && ci1 !== ci0) ? [ci0, ci1] : [ci0];

        for (const ci of targets) {
            const rc = organisms.chunkRowCount(ci);
            if (rc <= 0) continue;
            const off = ci * 4096;
            const stride = Math.min(rc, 4096);
            kExtractChunk.dispatch(stride, gpuStores.s0, gpuStores.s1, chunkEnergyKb, off, rc, st.rowCount, 0, stride);
            kExtractChunk.dispatch(stride, gpuStores.s0, gpuStores.s1, chunkStressKb, off, rc, st.rowCount, 1, stride);
            organisms.readFromKernelBuffer(ci, 'energy', chunkEnergyKb);
            organisms.readFromKernelBuffer(ci, 'stress', chunkStressKb);
        }
        const dt = performance.now() - t0;
        refreshReactiveCritical();
        updateVitalsUI(`chunks [${targets.join(',')}] (${fmtMs(dt)})`);
    } else {
        const fullE = bro.kernel.createBuffer(st.rowCount * 4, { residency: 'shared' });
        const fullS = bro.kernel.createBuffer(st.rowCount * 4, { residency: 'shared' });
        const stride = Math.min(st.rowCount, 1048576);
        kExtractFull.dispatch(stride, gpuStores.s0, gpuStores.s1, fullE, st.rowCount, 0, stride);
        kExtractFull.dispatch(stride, gpuStores.s0, gpuStores.s1, fullS, st.rowCount, 1, stride);
        organisms.readFromKernelBuffer('energy', fullE);
        organisms.readFromKernelBuffer('stress', fullS);
        try { fullE.destroy(); } catch (_) {}
        try { fullS.destroy(); } catch (_) {}
        const dt = performance.now() - t0;
        refreshReactiveCritical();
        updateVitalsUI(`tomb-aware full sync (${fmtMs(dt)})`);
    }
}

initReactiveCritical();
updateVitalsUI('ready');

// Sonifier chord mapped from local reef energy & stress
function playEcologyChord(rows, centerPt) {
    if (!sonifier.enabled || !rows || rows.length === 0) return;
    const pentatonic = [
        130.81, 146.83, 164.81, 196.00, 220.00,
        261.63, 293.66, 329.63, 392.00, 440.00,
        523.25, 587.33, 659.25,
    ];
    const notes = rows.slice(0, 6).map((r) => {
        const eNorm = Math.max(0, Math.min(1, r.energy / 1.5));
        const pitchIdx = Math.min(pentatonic.length - 1, Math.floor(eNorm * pentatonic.length));
        const stressed = r.stress > 0.65;
        return {
            freq: pentatonic[pitchIdx],
            waveform: stressed ? 'triangle' : 'sine',
            gain: 0.08 + 0.12 * eNorm,
            dur: 0.55,
            release: 0.75,
            pos: [
                (r.x - centerPt[0]) * 4.5,
                (r.y - centerPt[1]) * 4.5,
                (r.z - centerPt[2]) * 4.5,
            ],
        };
    });
    sonifier.playChord(notes);
}

// Worker RPC (shared /lib/living-table/living-worker.js)
const rpc = workerClient('../../lib/living-table/living-worker.js', { type: 'module' });
let workerReady = false;
let workerBusy = false;
let workerQueued = false;
let speciesZonesAttached = false;

function renderTopThriving(rows) {
    const tbody = $('#top-thriving-list');
    tbody.innerHTML = '';
    for (const r of (rows || [])) {
        const sp = SPECIES_DEFS[r.species_id | 0] || SPECIES_DEFS[0];
        const zName = (r.zone_id < 24) ? 'Reef' : (r.zone_id < 40 ? 'Vent' : (r.zone_id < 56 ? 'Gyre' : 'Abyss'));
        tbody.appendChild(h('tr', null,
            h('td', null, String(r.id)),
            h('td', { style: `color:${sp.hex_col}` }, sp.code),
            h('td', null, r.energy.toFixed(2)),
            h('td', null, r.stress.toFixed(2)),
            h('td', null, zName),
        ));
    }
}

function renderStressZoneAlerts(stressRes, tensorOut) {
    const critCount = criticalRq && criticalRq.table ? criticalRq.table.rowCount : 0;
    const rows = (stressRes && stressRes.rows) || [];
    const lines = [
        `ReactiveQuery critical: ${fmtInt(critCount)} rows`,
    ];
    if (rows.length > 0) {
        const r0 = rows[0];
        lines.push(`Peak alert: #${r0.id} ${r0.alert} · ${r0.biome} · strain=${r0.strain}`);
        if (rows[1]) {
            const r1 = rows[1];
            lines.push(`Next alert: #${r1.id} ${r1.alert} · stress=${r1.stress.toFixed(2)} · ${r1.strain}`);
        }
    } else {
        lines.push('No high-stress or toxic zone alerts.');
    }
    $('#critical-summary').textContent = lines.join('\n');

    if (tensorOut && tensorOut.ok) {
        const tStr = `${tensorOut.meanScore.toFixed(3)} (${tensorOut.backend})`;
        $('#st-tensor').textContent = tensorOut.meanScore.toFixed(3);
        if (state.lastActionKind === 'probe' && !state.probeHits) {
            $('#probe-box').textContent = `Tensor stress index: ${tStr}\nPeak: ${tensorOut.peakScore.toFixed(3)} · High: ${(tensorOut.highFraction * 100).toFixed(1)}%`;
        }
    }
}

async function runWorkerAnalytics(forceRefreshPhase = false) {
    if (!workerReady) return;
    if (workerBusy) {
        if (!forceRefreshPhase) return;
    }
    workerBusy = true;
    try {
        const attachPayload = { organisms: organisms.snapshot() };
        if (!speciesZonesAttached) {
            attachPayload.species = species.snapshot();
            attachPayload.zones = zones.snapshot();
            speciesZonesAttached = true;
            state.snapshotsShipped += 2;
        }
        await rpc.request({ type: 'attachTables', tables: attachPayload });
        state.snapshotsShipped += 1;

        const batch = await rpc.request(buildAnalyticsBatch());
        const rJoin = batch.results && batch.results.trophicJoin;
        const rTop = batch.results && batch.results.topThriving;
        const rStress = batch.results && batch.results.stressZones;

        if (rJoin && rJoin.ok) state.trophicRows = rJoin.rows;
        if (rTop && rTop.ok) state.topThriving = rTop.rows;
        if (rStress && rStress.ok) state.stressZones = rStress;
        if (batch.tensor) state.tensorOut = batch.tensor;

        const totMs = ((rJoin && rJoin.ms) || 0) + ((rTop && rTop.ms) || 0) + ((rStress && rStress.ms) || 0);
        const simdW = (rTop && rTop.stats && rTop.stats.simdWidth) || 256;
        state.lastWorkerPlan = {
            strategy: (rTop && rTop.stats && rTop.stats.usedRangeIndex) ? 'join+rangeIdx' : 'join+jit',
            simdWidth: simdW,
            ms: totMs,
        };

        renderTopThriving(state.topThriving);
        renderStressZoneAlerts(state.stressZones, state.tensorOut);
        if (forceRefreshPhase || (state.frameTick % 30 === 0)) {
            state.phaseGrid = buildPhaseGrid(organisms);
        }
        drawSpeciesChart(speciesCanvas, state.trophicRows);
        drawPhaseAndReuseChart(phaseCanvas, state.phaseGrid, state.reuseHistory);
        updateVitalsUI();
    } finally {
        workerBusy = false;
    }
}

// Spatial Probes & Brushes
function runSpatialProbe(pt, label = 'Spatial Probe') {
    const t0 = performance.now();
    const nearTbl = organisms.nearest('bio3d', pt, 8);
    const dt = performance.now() - t0;
    const rows = nearTbl.toArray();
    state.probePt = pt.slice(0, 3);
    state.probeHits = rows;
    state.lastActionKind = 'probe';

    const tScore = state.tensorOut && state.tensorOut.ok
        ? `Tensor stress: ${state.tensorOut.meanScore.toFixed(3)} (${state.tensorOut.backend})`
        : 'Tensor stress: pending…';
    const lines = [
        `${label} (${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}, ${pt[2].toFixed(2)})`,
        `SpatialIndex('bio3d').nearest(8): ${rows.length} hits in ${fmtMs(dt)}`,
        tScore,
    ];
    if (rows[0]) {
        const sp = SPECIES_DEFS[rows[0].species_id | 0] || SPECIES_DEFS[0];
        lines.push(`#1 ${sp.code} E=${rows[0].energy.toFixed(2)} S=${rows[0].stress.toFixed(2)}`);
    }
    $('#probe-box').textContent = lines.join('\n');
    playEcologyChord(rows, pt);
}

function applyNutrientBloom(pt, label = 'Nutrient Bloom') {
    const q = bro.table;
    const t0 = performance.now();
    const res = organisms.query()
        .whereInRadius('bio3d', pt, 0.45)
        .update({
            energy: q.col('energy').add(0.45),
            stress: q.col('stress').mul(0.5),
        });
    const dt = performance.now() - t0;
    state.probePt = pt.slice(0, 3);
    state.lastActionKind = 'bloom';
    syncEnergyStressToGpu();
    refreshReactiveCritical();
    const nearRows = organisms.nearest('bio3d', pt, 6).toArray();
    state.probeHits = nearRows;
    playEcologyChord(nearRows, pt);

    $('#probe-box').textContent =
        `${label} (r=0.45)\n` +
        `whereInRadius.update: ${fmtInt(res.affectedRows)} rows in ${fmtMs(dt)}\n` +
        `SpatialIndex=${res.usedSpatialIndex}`;
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI(`bloom (${fmtInt(res.affectedRows)} rows)`);
    runWorkerAnalytics(true);
    return res;
}

function applyToxinCull(pt, label = 'Toxin Cull Box', allowFallback = false) {
    let targetPt = pt.slice(0, 3);
    const runBox = (p) => organisms.query()
        .whereInAABB('bio3d', [p[0] - 0.35, p[1] - 0.35, p[2] - 0.35], [p[0] + 0.35, p[1] + 0.35, p[2] + 0.35])
        .remove();

    const t0 = performance.now();
    let res = runBox(targetPt);
    if (allowFallback && res.affectedRows === 0 && organisms.rowCount > 0) {
        const sample = organisms.row(Math.floor(organisms.rowCount * 0.25));
        if (sample) {
            targetPt = [sample.x, sample.y, sample.z];
            res = runBox(targetPt);
        }
    }
    const dt = performance.now() - t0;
    state.probePt = targetPt;
    state.probeHits = null;
    state.lastActionKind = 'toxin';

    packEcoFromTable();
    refreshReactiveCritical();
    $('#probe-box').textContent =
        `${label} (±0.35 AABB)\n` +
        `whereInAABB.remove: ${fmtInt(res.affectedRows)} tombstones in ${fmtMs(dt)}\n` +
        `SpatialIndex=${res.usedSpatialIndex}`;
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI(`toxin (-${fmtInt(res.affectedRows)} dead)`);
    runWorkerAnalytics(true);
    return res;
}

function applyBirthWave() {
    const batch = makeOffspringBatch(512, state.nextId, (state.frameTick + 1) | 0);
    state.nextId += 512;
    const t0 = performance.now();
    organisms.insertMany(batch);
    const dt = performance.now() - t0;
    packEcoFromTable();
    refreshReactiveCritical();
    $('#probe-box').textContent = `Birth Wave: inserted +512 offspring in ${fmtMs(dt)} (structure s${organisms.structureVersion})`;
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI('birth +512');
    runWorkerAnalytics(true);
}

function applyStarveCull() {
    const q = bro.table;
    const t0 = performance.now();
    const res = organisms.deleteWhere(q.lt('energy', 0.08));
    const dt = performance.now() - t0;
    packEcoFromTable();
    refreshReactiveCritical();
    $('#probe-box').textContent = `Starve Cull (energy < 0.08): removed ${fmtInt(res.affectedRows)} in ${fmtMs(dt)}`;
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI(`cull -${fmtInt(res.affectedRows)}`);
    runWorkerAnalytics(true);
    return res;
}

function applyCompact() {
    const beforeDead = organisms.stats().tombstoneCount;
    const t0 = performance.now();
    organisms.compact();
    const dt = performance.now() - t0;
    packEcoFromTable();
    refreshReactiveCritical();
    $('#probe-box').textContent = `Compact Table: reclaimed ${fmtInt(beforeDead)} tombstones in ${fmtMs(dt)} (indexes rebuilt)`;
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI('compacted');
    runWorkerAnalytics(true);
}

async function saveCheckpointV3() {
    const ckptPath = resolveCheckpointPath();
    const t0 = performance.now();
    organisms.save(ckptPath);
    const saveMs = performance.now() - t0;

    if (workerReady) {
        await rpc.request({ type: 'attachTables', tables: { organisms: organisms.snapshot() } });
        state.snapshotsShipped += 1;
        const audit = await rpc.request({
            type: 'compareMappedCheckpoint',
            path: ckptPath,
            tableName: 'organisms',
            col: 'energy',
            verify: true,
        });
        state.lastCheckpoint = audit;
        if (audit.ok) {
            $('#ckpt-info').textContent =
                `Saved v3 (${fmtMs(saveMs)}) -> mmap ${audit.mappedIndexes} idx in ${fmtMs(audit.ms)}\n` +
                `rows=${fmtInt(audit.chkAgg.cnt)} · Δavg=${audit.deltaAvg.toFixed(5)} · isMapped=${audit.isMapped}`;
        } else {
            $('#ckpt-info').textContent = `Checkpoint audit error: ${audit.error}`;
        }
    } else {
        $('#ckpt-info').textContent = `Saved v3 checkpoint in ${fmtMs(saveMs)}: ${ckptPath}`;
    }
    updateVitalsUI('v3 saved');
    return ckptPath;
}

async function loadCheckpointV3() {
    const ckptPath = resolveCheckpointPath();
    const t0 = performance.now();
    const loaded = bro.table.load(ckptPath);
    const loadMs = performance.now() - t0;
    organisms = loaded;
    const maxRow = organisms.query().agg({ m: bro.table.max('id') }).toArray()[0];
    state.nextId = ((maxRow && maxRow.m) ? (maxRow.m | 0) : organisms.rowCount) + 1;
    initReactiveCritical();
    packEcoFromTable();
    state.phaseGrid = buildPhaseGrid(organisms);
    updateVitalsUI(`rewound v3 (${fmtMs(loadMs)})`);
    $('#ckpt-info').textContent = `Rewound mutable table from v3 checkpoint in ${fmtMs(loadMs)} (${fmtInt(organisms.rowCount)} rows)`;
    await runWorkerAnalytics(true);
}

// Manifold switching & HUD
function updateHudTexts() {
    const info = MANIFOLDS[state.manifold] || MANIFOLDS[0];
    $('#hud-manifold').innerHTML =
        `<b>${info.short}</b>` +
        `<div class="sci-guide">${info.guide}</div>` +
        `<div class="sci-formula">${info.formula}</div>`;
}

function setManifold(idx) {
    const m = Math.max(0, Math.min(MANIFOLDS.length - 1, idx | 0));
    state.manifold = m;
    for (const btn of $$('[data-manifold]')) {
        btn.classList.toggle('active', (btn.dataset.manifold | 0) === m);
    }
    engine.exposure = m === 0 ? 0.64 : (m === 2 ? 0.60 : 0.56);
    engine.bloomAmt = m === 0 ? 0.22 : 0.18;
    view.setManifold(m);
    view.setView(MANIFOLDS[m].preset);
    updateHudTexts();
}

for (const btn of $$('[data-manifold]')) {
    btn.addEventListener('click', () => setManifold(btn.dataset.manifold | 0));
}

// Controls
bindControl('#flow-amp', {
    out: '#flow-amp-val',
    fmt: (v) => v.toFixed(1),
    reset: 1.0,
    onChange(v) { state.flowAmp = v; },
});
bindControl('#metab-rate', {
    out: '#metab-rate-val',
    fmt: (v) => v.toFixed(1),
    reset: 1.0,
    onChange(v) { state.metabRate = v; },
});

toggleButton('#btn-sim-play', {
    on: true,
    labels: ['Sim: Paused', 'Sim: Live'],
    onChange(on) { state.simPlaying = on; },
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
        if (on && state.probeHits) playEcologyChord(state.probeHits, state.probePt);
    },
});

segmented('#brush-mode', [
    ['probe', 'Probe'],
    ['bloom', 'Bloom (r)'],
    ['toxin', 'Toxin (box)'],
], {
    value: 'probe',
    onChange(v) { state.brushMode = v; },
});

$('#btn-gpu-step').addEventListener('click', () => {
    if (engine.gpuReady && gpuStores && organisms.rowCount > 0) {
        kStepEco.dispatch(
            Math.min(organisms.rowCount, 1048576),
            gpuStores.basePos, gpuStores.s0, gpuStores.s1,
            organisms.rowCount, Math.min(organisms.rowCount, 1048576),
            0.032, state.simTime, state.flowAmp, state.metabRate
        );
    }
    extractGpuToTableStep(false);
    runWorkerAnalytics(true);
});

$('#btn-bloom').addEventListener('click', () => {
    const pt = REEF_ANCHORS[anchorCursor % REEF_ANCHORS.length];
    anchorCursor++;
    applyNutrientBloom(pt, 'Nutrient Bloom');
});

$('#btn-toxin').addEventListener('click', () => {
    const pt = REEF_ANCHORS[anchorCursor % REEF_ANCHORS.length];
    anchorCursor++;
    applyToxinCull(pt, 'Toxin Cull Box', true);
});

$('#btn-birth').addEventListener('click', applyBirthWave);
$('#btn-cull').addEventListener('click', applyStarveCull);
$('#btn-compact').addEventListener('click', applyCompact);
$('#btn-save-v3').addEventListener('click', () => saveCheckpointV3());
$('#btn-load-v3').addEventListener('click', () => loadCheckpointV3());

function findNearestInManifold(m, clickPt) {
    let best = null;
    let bestD2 = Infinity;
    const stride = Math.max(1, Math.floor(organisms.rowCount / 16000));
    for (let ci = 0; ci < organisms.chunkCount; ci++) {
        const rc = organisms.chunkRowCount(ci);
        const xV = organisms.chunkColumnView(ci, 'x');
        const yV = organisms.chunkColumnView(ci, 'y');
        const zV = organisms.chunkColumnView(ci, 'z');
        const eV = organisms.chunkColumnView(ci, 'energy');
        const sV = organisms.chunkColumnView(ci, 'stress');
        const nV = organisms.chunkColumnView(ci, 'nutrient');
        const aV = organisms.chunkColumnView(ci, 'age');
        const spV = organisms.chunkColumnView(ci, 'species_id');
        for (let r = 0; r < rc; r += stride) {
            const p = evalOrganismManifold(m, {
                x: xV[r], y: yV[r], z: zV[r],
                energy: eV[r], stress: sV[r], nutrient: nV[r], age: aV[r], species_id: spV[r],
            });
            const dx = p[0] - clickPt[0];
            const dy = p[1] - clickPt[1];
            const dz = p[2] - clickPt[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = [xV[r], yV[r], zV[r]];
            }
        }
    }
    return best || REEF_ANCHORS[0].slice();
}

view.onProbe = (pt) => {
    const m = view.toManifold | 0;
    const worldPt = (m === 0) ? pt : findNearestInManifold(m, pt);
    if (state.brushMode === 'bloom') applyNutrientBloom(worldPt, 'Canvas Bloom');
    else if (state.brushMode === 'toxin') applyToxinCull(worldPt, 'Canvas Toxin', false);
    else runSpatialProbe(worldPt, 'Canvas Probe');
};

// Boot worker & initial analytics
(async () => {
    await rpc.ready;
    workerReady = true;
    await runWorkerAnalytics(true);
    updateHudTexts();
    $('#hud-backend').textContent = engine.gpuReady ? 'Vulkan HDR' : '2D';
    app.status.ok(`${fmtInt(organisms.rowCount)} organisms · 3 mutable tables · ${engine.gpuReady ? 'Vulkan GPU closed-loop' : '2D fallback'}`);
})();

updateHudTexts();
drawSpeciesChart(speciesCanvas, state.trophicRows);
drawPhaseAndReuseChart(phaseCanvas, state.phaseGrid, state.reuseHistory);

const splatArgs = (cols, cam, meta) => [
    gpuStores.s0, gpuStores.s1, meta.maskBuffer,
    meta.count, meta.stride, meta.w, meta.h,
    cam.camR, cam.camU, cam.camF, cam.camT,
    meta.fromManifold, meta.toManifold, meta.morph,
    meta.hasMask, meta.radiusMode, state.simTime,
];

let lastFpsStr = '';
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

frameLoop((dt) => {
    state.frameTick++;
    if (state.simPlaying) {
        state.simTime += dt;
        if (engine.gpuReady && gpuStores && organisms.rowCount > 0) {
            const stride = Math.min(organisms.rowCount, 1048576);
            kStepEco.dispatch(
                stride,
                gpuStores.basePos, gpuStores.s0, gpuStores.s1,
                organisms.rowCount, stride,
                dt, state.simTime, state.flowAmp, state.metabRate
            );
        }
        if (state.frameTick % 6 === 0) {
            extractGpuToTableStep(false);
        }
        if (state.frameTick % 18 === 0) {
            runWorkerAnalytics(false);
        }
    }

    view.step(dt);
    engine.render(view, splatArgs);
    drawOverlay(overlayCanvas, view, state);

    const chartKey = `${speciesCanvas.clientWidth}x${speciesCanvas.clientHeight}|${phaseCanvas.clientWidth}x${phaseCanvas.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        drawSpeciesChart(speciesCanvas, state.trophicRows);
        drawPhaseAndReuseChart(phaseCanvas, state.phaseGrid, state.reuseHistory);
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
        $('#hud-fps').textContent = fpsStr;
    }
});

globalThis.__livingEco = {
    get organisms() { return organisms; },
    species,
    zones,
    get criticalRq() { return criticalRq; },
    state,
    view,
    engine,
    sonifier,
    rpc,
    setManifold,
    extractGpuToTableStep,
    applyNutrientBloom,
    applyToxinCull,
    applyBirthWave,
    applyStarveCull,
    applyCompact,
    saveCheckpointV3,
    loadCheckpointV3,
    resolveCheckpointPath,
};
