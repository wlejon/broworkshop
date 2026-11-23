// Evolutionary Biosphere — Living Genomes, Bitwise Selection & Timeline Branching.
// Closed-loop bro.table <-> bro.kernel GPU compute & HDR splat + ReactiveQuery + COW Worker + .brotable v3 mmap.

import { boot, $, $$, h, bindControl, fpsMeter, frameLoop, toggleButton, readout, foldPanels } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { createLivingVitalsPanel } from "/lib/living-table/living-hud.js";

import { MANIFOLDS, EVO_COMPUTE_SHADER, EVO_SPLAT_SHADER } from "/app/manifolds.js";
import {
    NICHES,
    TRAIT_FLAGS,
    createBiosphereTables,
    buildSpeciationBatch,
    decodeTraits,
    resolveBranchDir,
} from "/app/data.js";
import {
    buildFitnessHistogram,
    drawTraitsChart,
    drawPhenotypeChart,
    drawOverlay,
} from "/app/charts.js";

const app = boot();
app.status.busy('synthesizing 131,072 living genomes across 32 chunks…');
foldPanels(document.querySelector('.k-side'));

const q = bro.table;
const ds = createBiosphereTables();
let creatures = ds.creatures;
const clades = ds.clades;
const niches = ds.niches;
const cladeMeta = ds.cladeMeta;
const cladesSnap = clades.snapshot();
const nichesSnap = niches.snapshot();

const viewCanvas = $('#view');
const overlayCanvas = $('#overlay');
const traitsCanvas = $('#chart-traits');
const phenoCanvas = $('#chart-phenotype');

const view = new OrbitView(viewCanvas, Object.assign({}, MANIFOLDS[0].preset, {
    immediate: true,
    minDist: 0.55,
    maxDist: 14.0,
    fovScale: 0.92,
    onProbe(pt) {
        onViewportClick(pt);
    },
}));

const engine = new HdrSplatEngine(viewCanvas, EVO_SPLAT_SHADER, {
    shaderFile: 'evo_splat.bk',
    exposure: 0.65,
    bloomAmt: 0.22,
    radiusMode: 0,
});

const sonifier = new SpatialSonifier({ cooldownMs: 110 });
const fps = fpsMeter();
const vitalsPanel = createLivingVitalsPanel($('#vitals-panel'));

const analyticsKv = readout('#analytics-kv', {
    joinPerf: 'leftJoin clades',
    founders: 'founders (parent=NULL)',
    avgDist: 'mean trait dist',
    tensorScore: 'bro.tensor score',
    rangeTopK: 'RangeIndex Top-8',
});

const state = {
    manifold: 0,
    simRunning: true,
    simTime: 0,
    selPressure: 1.05,
    driftAmp: 0.045,
    brushMode: 'probe',
    activeTraitBit: 0,
    nextId: ds.nextId,
    maxGen: ds.maxGen,
    lastHabitatPt: NICHES[0].center.slice(),
    probePt: NICHES[0].center.slice(),
    probeHits: [],
    brushFlash: null,
    snapshotsShipped: 0,
    writeCursor: 0,
    totalWritebacks: 0,
    lastReactive: { recomputedChunks: 0, reusedChunks: creatures.chunkCount, matchCount: 0 },
    phylumRows: [],
    traitCounts: {},
    eliteRows: [],
    founderCount: 0,
    tensorInfo: null,
    workerStats: null,
    liveHist: null,
    auditedBranchHist: null,
    auditInfo: null,
    branches: [],
    branchSeq: 1,
    workerReady: false,
    workerBusy: false,
    lastBrushRes: null,
};

// ReactiveQuery monitoring endangered or hyper-mutating lineages across 32 chunks
let endangeredRq = null;
function bindEndangeredReactive() {
    if (endangeredRq) { try { endangeredRq.dispose(); } catch (_) {} }
    endangeredRq = creatures.query()
        .where(q.or(q.lt('fitness', 0.25), q.gt('mutation_rate', 0.55)))
        .reactive();
    state.lastReactive = {
        recomputedChunks: creatures.chunkCount,
        reusedChunks: 0,
        matchCount: endangeredRq.table ? endangeredRq.table.rowCount : 0,
    };
}
bindEndangeredReactive();

function refreshEndangered() {
    if (!endangeredRq) return null;
    const ev = endangeredRq.refresh();
    state.lastReactive = {
        recomputedChunks: ev.recomputedChunks,
        reusedChunks: ev.reusedChunks,
        matchCount: ev.table ? ev.table.rowCount : 0,
    };
    return ev;
}

// GPU compute buffers & kernels
let kPackEvo = null, kStepEvo = null, kExtractCols = null;
let s0 = null, s1 = null, cladeOptBuf = null;
let exX = null, exY = null, exZ = null, exFit = null, exGa = null, exGb = null;
let gpuCap = 0;
let chunkOffsets = [];

if (engine.gpuReady) {
    const cMod = bro.kernel.compile(EVO_COMPUTE_SHADER, { file: 'evo_compute.bk' });
    kPackEvo = cMod.kernel('k_pack_evo');
    kStepEvo = cMod.kernel('k_step_evo');
    kExtractCols = cMod.kernel('k_extract_chunk_cols');

    const optArr = new Float32Array(32 * 4);
    for (let c = 0; c < cladeMeta.length && c < 32; c++) {
        optArr[c * 4] = cladeMeta[c].opt_a;
        optArr[c * 4 + 1] = cladeMeta[c].opt_b;
        optArr[c * 4 + 2] = cladeMeta[c].extinct ? 1.0 : 0.0;
    }
    cladeOptBuf = bro.kernel.createBuffer(optArr, { residency: 'gpu' });

    const cBytes = q.CHUNK_ROWS * 4;
    exX = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
    exY = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
    exZ = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
    exFit = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
    exGa = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
    exGb = bro.kernel.createBuffer(cBytes, { residency: 'gpu' });
}

function syncChunkOffsets() {
    const n = creatures.chunkCount;
    chunkOffsets = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
        chunkOffsets[i] = acc;
        acc += creatures.chunkRowCount(i);
    }
}

function rebuildGpuFromTable() {
    syncChunkOffsets();
    const N = creatures.rowCount;
    engine.rowCount = N;
    if (!engine.gpuReady || N <= 0) return;

    if (N > gpuCap) {
        if (s0) { try { s0.destroy(); } catch (_) {} }
        if (s1) { try { s1.destroy(); } catch (_) {} }
        gpuCap = Math.max(N + 8192, Math.ceil(N * 1.15));
        s0 = bro.kernel.createBuffer(gpuCap * 16, { residency: 'gpu' });
        s1 = bro.kernel.createBuffer(gpuCap * 16, { residency: 'gpu' });
    }

    const colNames = ['x', 'y', 'z', 'fitness', 'gene_a', 'gene_b', 'traits_mask', 'clade_id', 'niche_id', 'generation'];
    const cb = {};
    for (const c of colNames) cb[c] = creatures.toKernelBuffer(c, { residency: 'gpu' });

    const stride = Math.min(N, 1048576);
    kPackEvo.dispatch(
        stride,
        cb.x, cb.y, cb.z, cb.fitness, cb.gene_a, cb.gene_b,
        cb.traits_mask, cb.clade_id, cb.niche_id, cb.generation,
        s0, s1, N, stride
    );
    for (const c of colNames) { try { cb[c].destroy(); } catch (_) {} }

    if (state.activeTraitBit > 0) applyTraitFilter(state.activeTraitBit, false);
    else engine.uploadMask(null);
}

rebuildGpuFromTable();
$('#hud-backend').textContent = engine.gpuReady ? 'Vulkan HDR' : '2D Fallback';

function applyTraitFilter(bit, refreshUi = true) {
    state.activeTraitBit = bit | 0;
    for (const btn of $$('#trait-chips [data-trait]')) {
        btn.classList.toggle('active', (btn.dataset.trait | 0) === state.activeTraitBit);
    }
    const N = creatures.rowCount;
    if (state.activeTraitBit === 0) {
        engine.uploadMask(null);
        $('#trait-matched').textContent = `all (${fmtInt(N)})`;
        return;
    }
    const masks = creatures.columnArray('traits_mask');
    const words = new Uint32Array(Math.ceil(Math.max(1, N) / 32));
    let matched = 0;
    const b = state.activeTraitBit >>> 0;
    for (let i = 0; i < masks.length; i++) {
        if ((masks[i] & b) !== 0) {
            words[i >>> 5] |= (1 << (i & 31)) >>> 0;
            matched++;
        }
    }
    engine.uploadMask(words);
    $('#trait-matched').textContent = `${fmtInt(matched)} matched`;
    if (refreshUi) redrawAllCharts();
}

for (const btn of $$('#trait-chips [data-trait]')) {
    btn.addEventListener('click', () => applyTraitFilter(btn.dataset.trait | 0, true));
}

function updateHudAndVitals() {
    const st = creatures.stats();
    const info = MANIFOLDS[state.manifold] || MANIFOLDS[0];
    $('#hud-count').textContent = fmtInt(st.rowCount);
    $('#st-rows').textContent = fmtInt(st.rowCount);
    $('#st-manifold').textContent = String(state.manifold);
    $('#st-gen').textContent = String(state.maxGen);
    $('#st-endangered').textContent = fmtInt(state.lastReactive.matchCount);
    $('#st-reused').textContent = `${state.lastReactive.reusedChunks}/${state.lastReactive.recomputedChunks + state.lastReactive.reusedChunks}`;
    $('#st-branches').textContent = String(state.branches.length);

    $('#hud-manifold').innerHTML =
        `<b>${info.short}</b> · ${fmtInt(st.rowCount)} alive · max gen ${state.maxGen}` +
        `<div class="sci-guide">${info.guide}</div>` +
        `<div class="sci-formula">${info.formula}</div>`;

    const wbLabel = st.tombstoneCount > 0
        ? `paused (${fmtInt(st.tombstoneCount)} dead)`
        : `${fmtInt(state.totalWritebacks)} steps (2 chunks/cadence)`;

    vitalsPanel.update({
        tableStats: st,
        version: creatures.version,
        structureVersion: creatures.structureVersion,
        reactive: state.lastReactive,
        gpuWriteback: wbLabel,
        workerPlan: state.workerStats,
        snapshotsShipped: state.snapshotsShipped,
        checkpoint: state.auditInfo,
    });
}

function redrawAllCharts() {
    const snap = creatures.snapshot();
    state.liveHist = buildFitnessHistogram(snap, 16, 49152);
    drawTraitsChart(traitsCanvas, state.phylumRows, state.traitCounts, snap.rowCount);
    drawPhenotypeChart(phenoCanvas, state.liveHist, state.auditedBranchHist, state.auditInfo);
}

// Manifold switching
const sideManifoldBtns = [];
const sideHost = $('#manifold-list');
for (const m of MANIFOLDS) {
    const b = h('button.sci-manifold-btn', {
        dataset: { manifold: String(m.id) },
        onclick: () => setManifold(m.id),
    }, m.short);
    sideManifoldBtns.push(b);
    sideHost.appendChild(b);
}

const manifoldBar = h('div.k-row');
$('#manifold-bar').appendChild(manifoldBar);
const barBtns = MANIFOLDS.map((m) => {
    const b = h('button.small', {
        dataset: { manifoldBar: String(m.id) },
        onclick: () => setManifold(m.id),
    }, m.short);
    manifoldBar.appendChild(b);
    return b;
});

function setManifold(idx) {
    const m = Math.max(0, Math.min(MANIFOLDS.length - 1, idx | 0));
    state.manifold = m;
    for (let i = 0; i < sideManifoldBtns.length; i++) {
        sideManifoldBtns[i].classList.toggle('active', i === m);
        barBtns[i].classList.toggle('active', i === m);
    }
    const expSlider = parseFloat($('#opt-exposure').value) || 0.65;
    engine.exposure = (m === 1 ? 0.58 : (m === 2 ? 0.62 : 0.65)) * (expSlider / 0.65);
    view.setManifold(m);
    view.setView(MANIFOLDS[m].preset);
    updateHudAndVitals();
}
setManifold(0);

// Spatial Probe + Sonifier
function playBiosphereChord(rows, centerPt, mode = 'probe') {
    if (!sonifier.enabled || !rows || rows.length === 0) return;
    const scale = [130.81, 146.83, 164.81, 196.00, 220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
    const notes = rows.slice(0, 5).map((r, i) => {
        const u = Math.max(0, Math.min(1, r.fitness || 0.5));
        const freq = mode === 'asteroid'
            ? 90 + i * 28
            : scale[Math.min(scale.length - 1, Math.floor(u * scale.length))];
        return {
            freq: mode === 'mutagen' ? freq * 1.25 : freq,
            waveform: mode === 'asteroid' ? 'sawtooth' : (r.traits_mask & 1 ? 'sine' : 'triangle'),
            gain: 0.14,
            dur: 0.55,
            pos: [(r.x - centerPt[0]) * 4.5, (r.y - centerPt[1]) * 4.5, (r.z - centerPt[2]) * 4.5],
        };
    });
    sonifier.playChord(notes);
}

function probeHabitat(pt, label = 'Spatial Probe') {
    const t0 = performance.now();
    const nn = creatures.nearest('hab3d', pt, 8, 2.5);
    const rows = nn.toArray();
    const dt = performance.now() - t0;

    state.probePt = pt.slice(0, 3);
    state.lastHabitatPt = pt.slice(0, 3);
    state.probeHits = rows;

    if (rows.length > 0) {
        const r0 = rows[0];
        const pStr = r0.parent_id == null ? 'NULL (founder)' : `#${r0.parent_id}`;
        $('#probe-box').textContent =
            `${label} · hab3d.nearest(8) in ${fmtMs(dt)}\n` +
            `#${r0.id} ${r0.taxon_name} · parent=${pStr}\n` +
            `traits=${decodeTraits(r0.traits_mask)} · fit=${r0.fitness.toFixed(3)}`;
        playBiosphereChord(rows, pt, 'probe');
    } else {
        $('#probe-box').textContent = `${label} · 0 organisms nearby (${fmtMs(dt)})`;
    }

    const tbody = $('#probe-list');
    tbody.innerHTML = '';
    for (const r of rows) {
        tbody.appendChild(h('tr', null,
            h('td', null, (r._distance || 0).toFixed(2)),
            h('td', null, String(r.lineage || '—')),
            h('td', null, String(r.generation)),
            h('td', null, decodeTraits(r.traits_mask).slice(0, 14)),
            h('td', null, r.fitness.toFixed(2))
        ));
    }
}

// Brushes & Evolutionary Mutations
function setBrushMode(mode) {
    state.brushMode = mode;
    for (const b of $$('#brush-mode-row [data-brush]')) {
        b.classList.toggle('active', b.dataset.brush === mode);
    }
}
for (const b of $$('#brush-mode-row [data-brush]')) {
    b.addEventListener('click', () => setBrushMode(b.dataset.brush));
}

function applyMutagenAt(pt) {
    const t0 = performance.now();
    const res = creatures.query().whereInRadius('hab3d', pt, 0.48).update({
        traits_mask: q.bitXor('traits_mask', 5),
        gene_a: q.col('gene_a').add(0.35),
        mutation_rate: q.col('mutation_rate').mul(1.8),
    });
    const dt = performance.now() - t0;
    state.lastBrushRes = { kind: 'mutagen', ...res, ms: dt };

    rebuildGpuFromTable();
    refreshEndangered();
    probeHabitat(pt, `Mutagen XOR ^5 (${fmtInt(res.affectedRows)} rows)`);
    if (state.probeHits.length > 0) {
        state.brushFlash = { kind: 'mutagen', ttl: 1.0, anchorRow: state.probeHits[0] };
        playBiosphereChord(state.probeHits, pt, 'mutagen');
    }
    updateHudAndVitals();
    redrawAllCharts();
    syncWorkerAndRunBatch();
    app.status.ok(`Mutagen XOR ^5 mutated ${fmtInt(res.affectedRows)} organisms in ${fmtMs(dt)}`);
    return res;
}

function applyAsteroidAt(pt) {
    const t0 = performance.now();
    const minP = [pt[0] - 0.38, pt[1] - 0.38, pt[2] - 0.38];
    const maxP = [pt[0] + 0.38, pt[1] + 0.38, pt[2] + 0.38];
    const res = creatures.query().whereInAABB('hab3d', minP, maxP).remove();
    const dt = performance.now() - t0;
    state.lastBrushRes = { kind: 'asteroid', ...res, ms: dt };

    state.brushFlash = {
        kind: 'asteroid',
        ttl: 1.0,
        anchorRow: { x: pt[0], y: pt[1], z: pt[2], fitness: 0.5, gene_a: 0, gene_b: 0, clade_id: 0, generation: 1 },
    };
    playBiosphereChord([{ x: pt[0], y: pt[1], z: pt[2], fitness: 0.2, traits_mask: 2 }], pt, 'asteroid');

    rebuildGpuFromTable();
    refreshEndangered();
    updateHudAndVitals();
    redrawAllCharts();
    syncWorkerAndRunBatch();
    app.status.warn(`Asteroid AABB removed ${fmtInt(res.affectedRows)} organisms (${creatures.stats().tombstoneCount} tombstones)`);
    return res;
}

function onViewportClick(pt) {
    const habPt = state.manifold === 0 ? pt : state.lastHabitatPt;
    if (state.brushMode === 'mutagen') return applyMutagenAt(habPt);
    if (state.brushMode === 'asteroid') return applyAsteroidAt(habPt);
    return probeHabitat(habPt, 'Canvas Probe');
}

function triggerSpeciationBurst() {
    const t0 = performance.now();
    const count = 2048;
    const nextGen = state.maxGen + 1;
    const batch = buildSpeciationBatch(state.nextId, count, nextGen, (Date.now() ^ state.nextId) >>> 0, cladeMeta);
    creatures.insertMany(batch);
    state.nextId += count;
    state.maxGen = nextGen;
    const dt = performance.now() - t0;

    rebuildGpuFromTable();
    refreshEndangered();
    updateHudAndVitals();
    redrawAllCharts();
    syncWorkerAndRunBatch();
    app.status.ok(`Speciation Burst: +${fmtInt(count)} Gen-${nextGen} organisms in ${fmtMs(dt)}`);
    return count;
}

function triggerCompact() {
    const beforeTombs = creatures.stats().tombstoneCount;
    const t0 = performance.now();
    creatures.compact();
    const dt = performance.now() - t0;

    rebuildGpuFromTable();
    refreshEndangered();
    updateHudAndVitals();
    redrawAllCharts();
    syncWorkerAndRunBatch();
    app.status.ok(`Compacted ${fmtInt(beforeTombs)} tombstones -> ${creatures.chunkCount} chunks in ${fmtMs(dt)}`);
}

// Worker RPC (O(1) COW snapshots + leftJoin + fused JIT + RangeIndex Top-8 + bro.tensor + v3 mmap)
const rpc = workerClient('../../lib/living-table/living-worker.js', { type: 'module' });

const DIST_EXPR = {
    op: 'sqrt',
    a: {
        op: 'add',
        a: {
            op: 'mul',
            a: { op: 'sub', a: { col: 'left.gene_a' }, b: { col: 'right.opt_a' } },
            b: { op: 'sub', a: { col: 'left.gene_a' }, b: { col: 'right.opt_a' } },
        },
        b: {
            op: 'mul',
            a: { op: 'sub', a: { col: 'left.gene_b' }, b: { col: 'right.opt_b' } },
            b: { op: 'sub', a: { col: 'left.gene_b' }, b: { col: 'right.opt_b' } },
        },
    },
};

function renderAnalyticsUi(batch) {
    const r = batch.results || {};
    const td = r.traitDistance;
    if (td && td.ok) {
        state.phylumRows = td.rows || [];
        state.workerStats = Object.assign({ ms: td.ms }, td.stats || {});
    }

    const tc = r.traitCounts;
    if (tc && tc.ok && tc.rows && tc.rows[0]) {
        const row = tc.rows[0];
        state.traitCounts = {
            1: row.t1 || 0,
            2: row.t2 || 0,
            4: row.t4 || 0,
            8: row.t8 || 0,
            16: row.t16 || 0,
            32: row.t32 || 0,
        };
    }

    const fa = r.founderAgg;
    if (fa && fa.ok && fa.rows && fa.rows[0]) {
        state.founderCount = fa.rows[0].cnt || 0;
    }

    const ea = r.eliteApex;
    if (ea && ea.ok) {
        state.eliteRows = ea.rows || [];
        const tbody = $('#elite-list');
        tbody.innerHTML = '';
        for (const row of state.eliteRows) {
            const pStr = row.parent_id === -1 || row.parent_id == null ? '-1' : String(row.parent_id);
            tbody.appendChild(h('tr', null,
                h('td', null, String(row.id)),
                h('td', null, String(row.taxon_name || '').slice(0, 12)),
                h('td', null, pStr),
                h('td', null, decodeTraits(row.traits_mask).slice(0, 10)),
                h('td', null, row.fitness.toFixed(3))
            ));
        }
    }

    let meanDist = 0;
    if (state.phylumRows.length > 0) {
        let sumW = 0, sumD = 0;
        for (const p of state.phylumRows) {
            sumD += (p.avgDist || 0) * (p.cnt || 1);
            sumW += (p.cnt || 1);
        }
        meanDist = sumW > 0 ? sumD / sumW : 0;
    }

    state.tensorInfo = batch.tensor || null;
    const tStr = state.tensorInfo && state.tensorInfo.ok
        ? `${state.tensorInfo.meanScore.toFixed(3)} (${state.tensorInfo.backend})`
        : '—';
    const rangeTag = ea && ea.stats && ea.stats.usedRangeIndex ? `RangeIdx · ${fmtMs(ea.ms)}` : fmtMs(ea ? ea.ms : 0);

    analyticsKv.set({
        joinPerf: td ? `${state.phylumRows.length} phyla · ${fmtMs(td.ms)}` : '—',
        founders: `${fmtInt(state.founderCount)} (coalesce)`,
        avgDist: meanDist.toFixed(3) + ' (sqrt JIT)',
        tensorScore: tStr,
        rangeTopK: rangeTag,
    });

    updateHudAndVitals();
    redrawAllCharts();
}

let workerResyncQueued = false;
async function syncWorkerAndRunBatch() {
    if (!state.workerReady) return null;
    if (state.workerBusy) {
        workerResyncQueued = true;
        return null;
    }
    state.workerBusy = true;
    try {
        const snap = creatures.snapshot();
        state.snapshotsShipped++;
        await rpc.request({
            type: 'attachTables',
            tables: { creatures: snap, clades: cladesSnap, niches: nichesSnap },
        });
        const batch = await rpc.request({
            type: 'runBatch',
            queries: {
                traitDistance: {
                    table: 'creatures',
                    join: { kind: 'left', table: 'clades', leftKeys: 'clade_id', rightKeys: 'clade_id' },
                    groupBy: 'right.phylum',
                    agg: {
                        cnt: { fn: 'count' },
                        avgDist: { fn: 'avg', expr: DIST_EXPR },
                        avgFitness: { fn: 'avg', expr: { col: 'left.fitness' } },
                        biolumSum: { fn: 'sum', expr: { op: 'bitAnd', a: { col: 'left.traits_mask' }, b: 1 } },
                    },
                    orderBy: { expr: 'avgFitness', desc: true },
                },
                lineageSample: {
                    table: 'creatures',
                    join: { kind: 'left', table: 'clades', leftKeys: 'clade_id', rightKeys: 'clade_id' },
                    where: { op: 'gt', a: { col: 'left.fitness' }, b: 0.72 },
                    select: {
                        id: 'left.id',
                        phylum: 'right.phylum',
                        parent: { op: 'coalesce', a: { col: 'left.parent_id' }, b: -1 },
                        biolum: { op: 'bitAnd', a: { col: 'left.traits_mask' }, b: 1 },
                        traitDist: DIST_EXPR,
                    },
                    orderBy: { expr: 'left.fitness', desc: true },
                    limit: 6,
                },
                founderAgg: {
                    table: 'creatures',
                    where: { op: 'eq', a: { op: 'coalesce', a: { col: 'parent_id' }, b: -1 }, b: -1 },
                    agg: { cnt: { fn: 'count' } },
                },
                traitCounts: {
                    table: 'creatures',
                    agg: {
                        t1:  { fn: 'sum', expr: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 1 } },
                        t2:  { fn: 'sum', expr: { op: 'ushr', a: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 2 }, b: 1 } },
                        t4:  { fn: 'sum', expr: { op: 'ushr', a: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 4 }, b: 2 } },
                        t8:  { fn: 'sum', expr: { op: 'ushr', a: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 8 }, b: 3 } },
                        t16: { fn: 'sum', expr: { op: 'ushr', a: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 16 }, b: 4 } },
                        t32: { fn: 'sum', expr: { op: 'ushr', a: { op: 'bitAnd', a: { col: 'traits_mask' }, b: 32 }, b: 5 } },
                    },
                },
                eliteApex: {
                    table: 'creatures',
                    where: { op: 'gt', a: { col: 'fitness' }, b: 0.1 },
                    select: {
                        id: 'id',
                        taxon_name: 'taxon_name',
                        parent_id: { op: 'coalesce', a: { col: 'parent_id' }, b: -1 },
                        traits_mask: 'traits_mask',
                        fitness: 'fitness',
                    },
                    orderBy: { expr: 'fitness', desc: true },
                    limit: 8,
                },
            },
            tensor: {
                table: 'creatures',
                cols: ['gene_a', 'gene_b', 'fitness', 'mutation_rate'],
                weights: [0.16, 0.16, 0.78, -0.32],
                bias: 0.05,
                maxRows: 65536,
            },
        });
        state.lastBatch = batch;
        renderAnalyticsUi(batch);
        return batch;
    } finally {
        state.workerBusy = false;
        if (workerResyncQueued) {
            workerResyncQueued = false;
            syncWorkerAndRunBatch();
        }
    }
}

// Timeline Branching (.brotable v3 Save / Fork / Rewind / Audit mmap)
function renderBranchList() {
    const host = $('#branch-list');
    host.innerHTML = '';
    for (const br of state.branches) {
        const auditBtn = br.kind === 'file'
            ? h('button.small', { dataset: { auditBranch: br.id }, onclick: () => auditBranch(br) }, 'Audit mmap')
            : null;
        const rewindBtn = h('button.small', {
            dataset: { rewindBranch: br.id },
            onclick: () => rewindBranch(br),
        }, 'Rewind');

        host.appendChild(h('div.living-ckpt-item', { dataset: { branchId: br.id } },
            h('div.evo-ckpt-meta', null,
                h('span.evo-ckpt-title', null, br.label),
                h('span.evo-ckpt-sub', null, `${fmtInt(br.rowCount)} rows · μ=${br.meanFitness.toFixed(3)} · ${br.kind === 'file' ? '.brotable v3' : 'toBytes()'}`)
            ),
            h('div.evo-ckpt-actions', null, auditBtn, rewindBtn)
        ));
    }
    $('#st-branches').textContent = String(state.branches.length);
}

function saveBranchFile(labelOverride = null) {
    const idx = state.branchSeq++;
    const label = labelOverride || `Branch ${String.fromCharCode(64 + ((idx - 1) % 26) + 1)} · Gen ${state.maxGen}`;
    const dir = resolveBranchDir();
    const filePath = `${dir}/evo-branch-${idx}-${Date.now()}.brotable`;

    const t0 = performance.now();
    creatures.save(filePath);
    const dt = performance.now() - t0;

    const snap = creatures.snapshot();
    const hist = buildFitnessHistogram(snap, 16, 49152);
    const br = {
        id: `br-${idx}`,
        kind: 'file',
        label,
        path: filePath,
        rowCount: snap.rowCount,
        meanFitness: hist.mean,
        hist,
        maxGen: state.maxGen,
        nextId: state.nextId,
    };
    state.branches.unshift(br);
    renderBranchList();
    updateHudAndVitals();
    app.status.ok(`Saved ${label} (.brotable v3) in ${fmtMs(dt)}`);
    return br;
}

function forkMemoryBranch() {
    const idx = state.branchSeq++;
    const t0 = performance.now();
    const bytes = creatures.toBytes();
    const dt = performance.now() - t0;
    const snap = creatures.snapshot();
    const hist = buildFitnessHistogram(snap, 16, 49152);
    const br = {
        id: `br-${idx}`,
        kind: 'mem',
        label: `Fork M${idx} · Gen ${state.maxGen}`,
        bytes,
        rowCount: snap.rowCount,
        meanFitness: hist.mean,
        hist,
        maxGen: state.maxGen,
        nextId: state.nextId,
    };
    state.branches.unshift(br);
    renderBranchList();
    updateHudAndVitals();
    app.status.ok(`Forked ${br.label} (${(bytes.byteLength / 1048576).toFixed(1)} MB) in ${fmtMs(dt)}`);
    return br;
}

async function auditBranch(br) {
    if (!br || br.kind !== 'file' || !state.workerReady) return null;
    const snap = creatures.snapshot();
    state.snapshotsShipped++;
    await rpc.request({ type: 'attachTables', tables: { creatures: snap } });
    const res = await rpc.request({
        type: 'compareMappedCheckpoint',
        path: br.path,
        tableName: 'creatures',
        col: 'fitness',
        verify: true,
    });
    state.auditInfo = res;
    if (res && res.ok) {
        state.auditedBranchHist = br.hist;
        const dSign = res.deltaAvg >= 0 ? '+' : '';
        $('#branch-audit-box').textContent =
            `${br.label}: mmap=${res.isMapped} · ${res.mappedIndexes} idx mmapped in ${fmtMs(res.ms)} · ΔFit=${dSign}${res.deltaAvg.toFixed(4)}`;
    } else {
        $('#branch-audit-box').textContent = `Audit failed: ${(res && res.error) || 'unknown'}`;
    }
    updateHudAndVitals();
    redrawAllCharts();
    return res;
}

function rewindBranch(br) {
    if (!br) return;
    const t0 = performance.now();
    const nextTbl = br.kind === 'file' ? q.load(br.path) : q.fromBytes(br.bytes);
    creatures = nextTbl;
    state.maxGen = br.maxGen;
    state.nextId = Math.max(state.nextId, br.nextId);
    bindEndangeredReactive();
    rebuildGpuFromTable();
    const dt = performance.now() - t0;

    updateHudAndVitals();
    redrawAllCharts();
    probeHabitat(state.lastHabitatPt, `Rewound -> ${br.label}`);
    syncWorkerAndRunBatch();
    app.status.ok(`Rewound active biosphere to ${br.label} in ${fmtMs(dt)}`);
}

// Toolbar & Sidebar Controls
const simPlayBtn = toggleButton('#btn-sim-play', {
    on: true,
    labels: ['Evolve: Off', 'Evolve: On'],
    onChange(on) { state.simRunning = on; },
});

const autoRotateBtn = toggleButton('#btn-autorotate', {
    on: false,
    labels: ['Auto-Orbit', 'Auto-Orbit: On'],
    onChange(on) { view.autoRotate = on; },
});

const soundBtn = toggleButton('#btn-sound', {
    on: false,
    labels: ['Sonify: Off', 'Sonify: On'],
    onChange(on) {
        sonifier.setEnabled(on);
        if (on && state.probeHits.length > 0) playBiosphereChord(state.probeHits, state.probePt, 'probe');
    },
});

$('#btn-speciate').addEventListener('click', triggerSpeciationBurst);
$('#btn-compact').addEventListener('click', triggerCompact);
$('#btn-mutagen-blast').addEventListener('click', () => applyMutagenAt(state.lastHabitatPt));
$('#btn-asteroid-strike').addEventListener('click', () => applyAsteroidAt(state.lastHabitatPt));
$('#btn-save-branch').addEventListener('click', () => saveBranchFile());
$('#btn-fork-branch').addEventListener('click', () => forkMemoryBranch());

bindControl('#sel-pressure', {
    out: '#sel-pressure-val',
    fmt: (v) => v.toFixed(2),
    reset: 1.05,
    onChange(v) { state.selPressure = v; },
});
bindControl('#drift-amp', {
    out: '#drift-amp-val',
    fmt: (v) => v.toFixed(3),
    reset: 0.045,
    onChange(v) { state.driftAmp = v; },
});
bindControl('#opt-exposure', {
    out: '#opt-exposure-val',
    fmt: (v) => v.toFixed(2),
    reset: 0.65,
    onChange(v) { engine.exposure = v; },
});
bindControl('#opt-bloom', {
    out: '#opt-bloom-val',
    fmt: (v) => v.toFixed(2),
    reset: 0.22,
    onChange(v) { engine.bloomAmt = v; },
});

// Boot Worker, Initial Probe, Initial Branch A (.brotable v3), & Initial Batch
(async () => {
    await rpc.ready;
    state.workerReady = true;
    probeHabitat(NICHES[0].center, `Niche 0 · ${NICHES[0].name}`);
    await syncWorkerAndRunBatch();
    saveBranchFile('Branch A · Genesis');
    app.status.ok(`${fmtInt(creatures.rowCount)} organisms (32 chunks) · ${engine.gpuReady ? 'Vulkan HDR' : '2D'} · ready`);
})();

// Frame Loop: GPU compute step + rotating 2-chunk GPU->Table writeback + ReactiveQuery refresh
const splatArgs = (cols, cam, meta) => [
    s0, s1, meta.maskBuffer,
    meta.count, meta.stride, meta.w, meta.h,
    cam.camR, cam.camU, cam.camF, cam.camT,
    meta.fromManifold, meta.toManifold, meta.morph,
    meta.hasMask, meta.radiusMode, state.simTime,
];

let frameTick = 0;
let lastFpsStr = '';
let lastChartSizeKey = '';
window.addEventListener('resize', () => { lastChartSizeKey = ''; });

function performRotatingWriteback() {
    if (!engine.gpuReady || !s0 || !s1) return;
    const st = creatures.stats();
    if (st.tombstoneCount > 0 || creatures.chunkCount === 0) return;

    const nChunks = creatures.chunkCount;
    const c0 = state.writeCursor % nChunks;
    const c1 = (state.writeCursor + 1) % nChunks;
    state.writeCursor = (state.writeCursor + 2) % nChunks;
    const targets = c1 !== c0 ? [c0, c1] : [c0];

    for (const ci of targets) {
        const rc = creatures.chunkRowCount(ci);
        if (rc <= 0) continue;
        const base = chunkOffsets[ci] || 0;
        kExtractCols.dispatch(rc, s0, s1, exX, exY, exZ, exFit, exGa, exGb, base, rc);
        creatures.readFromKernelBuffer(ci, 'fitness', exFit);
        creatures.readFromKernelBuffer(ci, 'gene_a', exGa);
        creatures.readFromKernelBuffer(ci, 'gene_b', exGb);
    }
    state.totalWritebacks++;
    refreshEndangered();
    updateHudAndVitals();
}

frameLoop((dt) => {
    frameTick++;
    if (state.simRunning && engine.gpuReady && s0 && s1 && creatures.rowCount > 0) {
        state.simTime += dt;
        const stride = Math.min(creatures.rowCount, 1048576);
        kStepEvo.dispatch(
            stride,
            s0, s1, cladeOptBuf,
            creatures.rowCount, stride,
            dt, state.simTime, state.selPressure, state.driftAmp
        );

        if (frameTick % 8 === 0) {
            performRotatingWriteback();
        }
        if (frameTick % 64 === 0 && state.workerReady && !state.workerBusy) {
            syncWorkerAndRunBatch();
        }
    }

    if (state.brushFlash) {
        state.brushFlash.ttl -= dt * 1.4;
        if (state.brushFlash.ttl <= 0) state.brushFlash = null;
    }

    view.step(dt);
    engine.render(view, splatArgs);
    drawOverlay(overlayCanvas, view, state);

    const chartKey = `${traitsCanvas.clientWidth}x${traitsCanvas.clientHeight}|${phenoCanvas.clientWidth}x${phenoCanvas.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        redrawAllCharts();
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
        $('#hud-fps').textContent = fpsStr;
    }
});

globalThis.__evoApp = {
    state,
    getCreatures: () => creatures,
    getEndangeredRq: () => endangeredRq,
    clades,
    niches,
    view,
    engine,
    sonifier,
    rpc,
    setManifold,
    probeHabitat,
    applyMutagenAt,
    applyAsteroidAt,
    triggerSpeciationBurst,
    triggerCompact,
    saveBranchFile,
    forkMemoryBranch,
    auditBranch,
    rewindBranch,
    performRotatingWriteback,
    syncWorkerAndRunBatch,
    simPlayBtn,
    autoRotateBtn,
    soundBtn,
};
