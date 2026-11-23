// FlyWire Connectome — Whole-Brain 3D Synaptic Organ & Live Spiking Cascade

import { boot, $, h, statusLine, fpsMeter, frameLoop, segmented, foldPanels } from "/lib/kit/index.js";
import { workerClient } from "/lib/kit/worker-rpc.js";
import { fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { OrbitView } from "/lib/sci-atlas/orbit-view.js";
import { SpatialSonifier } from "/lib/sci-atlas/sonifier.js";
import { HdrSplatEngine } from "/lib/sci-atlas/splat-engine.js";
import { createEngineProofPanel } from "/lib/sci-atlas/table-proof.js";
import {
    MANIFOLDS,
    CONNECTOME_PACK_SHADER,
    CONNECTOME_SHADER,
    CONNECTOME_EDGE_PACK_SHADER,
    CONNECTOME_EDGE_SHADER,
} from "./manifolds.js";
import {
    loadConnectomeData,
    NT_NAMES,
    NT_HEX,
    FLOW_NAMES,
    REGIONS,
    STIM_SITES,
} from "./data.js";

boot();
foldPanels(document.querySelector('.k-side'));

const status = statusLine('#status');
status.busy('initializing connectome tables…');

// 1. Populate UI options & legend
const regionSel = $('#filter-region');
for (const r of REGIONS) regionSel.appendChild(h('option', { value: r }, r));

const ntSel = $('#filter-nt');
for (let i = 0; i < NT_NAMES.length; i++) {
    ntSel.appendChild(h('option', { value: String(i) }, `${NT_NAMES[i]} (${i})`));
}

const flowSel = $('#filter-flow');
for (let i = 0; i < FLOW_NAMES.length; i++) {
    flowSel.appendChild(h('option', { value: String(i) }, `${FLOW_NAMES[i]} (${i})`));
}

const legendEl = $('#nt-legend');
for (let i = 0; i < NT_NAMES.length; i++) {
    legendEl.appendChild(
        h('span.swatch', null, h('i.dot', { style: { background: NT_HEX[i] } }), NT_NAMES[i])
    );
}
legendEl.appendChild(h('span.swatch', null, h('i.dot', { style: { background: '#fff1b8' } }), 'Spike HDR'));

// 2. Load real .brotable mmap OR instant synthetic connectome (120k neurons, 800k edges)
const ds = loadConnectomeData();
const { neuronsSnap, edgesSnap, isReal, loadMs } = ds;
const N = neuronsSnap.rowCount;
const E = edgesSnap.rowCount;

const badge = $('#dataset-badge');
badge.className = 'k-badge ' + (isReal ? 'ok' : 'warn');
badge.textContent = isReal ? 'REAL DATA (MMAP)' : 'SYNTHETIC SAMPLE';

const fiberLabel = E >= 1e6 ? `Fibers: ${(E / 1e6).toFixed(1)}M` : `Fibers: ${Math.round(E / 1e3)}k`;
$('#btn-fibers').textContent = fiberLabel;
$('#hud-ncount').textContent = fmtInt(N);
$('#hud-ecount').textContent = fmtInt(E);
$('#st-neurons').textContent = fmtInt(N);
$('#st-edges').textContent = fmtInt(E);

// Contiguous host column arrays for O(1) wave telemetry, overlay projection & sonification
const xArr = neuronsSnap.columnArray('x');
const yArr = neuronsSnap.columnArray('y');
const zArr = neuronsSnap.columnArray('z');
const ntArr = neuronsSnap.columnArray('nt_id');
const flowArr = neuronsSnap.columnArray('flow_id');
const outSynArr = neuronsSnap.columnArray('out_syn');

let actHost = new Float32Array(N);
let nextActHost = new Float32Array(N);
let refracHost = new Float32Array(N);
let showFibers = true;
let fiberPhase = 0.0;

// 3. HDR Splat Engine + Per-neuron activation + 16.8M GPU synaptic fibers
const gpuCanvas = $('#gpu-canvas');
const overlayCanvas = $('#overlay-canvas');
const splat = new HdrSplatEngine(gpuCanvas, CONNECTOME_SHADER, {
    shaderFile: 'connectome_manifolds.bk',
    exposure: 0.78,
    bloomAmt: 0.34,
    radiusMode: 0,
});
splat.uploadColumns(neuronsSnap, ['x', 'y', 'z', 'flow_id', 'nt_id', 'out_syn']);
const actKernelBuf = splat.gpuReady ? bro.kernel.createBuffer(actHost, { residency: 'gpu' }) : null;
let pos4Buf = null;
let attrBuf = null;
let edgeVecBuf = null;
let kSplatEdges = null;
if (splat.gpuReady) {
    pos4Buf = bro.kernel.createBuffer(N * 16, { residency: 'gpu' });
    attrBuf = bro.kernel.createBuffer(N * 4, { residency: 'gpu' });
    const kPack = bro.kernel.compile(CONNECTOME_PACK_SHADER, { file: 'connectome_pack.bk' }).kernel('k_pack');
    const c = splat.colBuffers;
    const packStride = Math.min(N, 1048576);
    kPack.dispatch(packStride, c.x, c.y, c.z, c.flow_id, c.nt_id, c.out_syn, pos4Buf, attrBuf, N, packStride);
    splat.destroyColumns();

    if (E > 0) {
        const bPre = edgesSnap.toKernelBuffer('pre_idx', { residency: 'gpu' });
        const bPost = edgesSnap.toKernelBuffer('post_idx', { residency: 'gpu' });
        const bNt = edgesSnap.toKernelBuffer('nt_id', { residency: 'gpu' });
        const bSyn = edgesSnap.toKernelBuffer('syn_count', { residency: 'gpu' });
        edgeVecBuf = bro.kernel.createBuffer(E * 16, { residency: 'gpu' });
        const kPackEdges = bro.kernel.compile(CONNECTOME_EDGE_PACK_SHADER, { file: 'connectome_edge_pack.bk' }).kernel('k_pack_edges');
        const edgeStride = Math.min(E, 1048576);
        kPackEdges.dispatch(edgeStride, bPre, bPost, bNt, bSyn, edgeVecBuf, E, edgeStride);
        bPre.destroy();
        bPost.destroy();
        bNt.destroy();
        bSyn.destroy();
        kSplatEdges = bro.kernel.compile(CONNECTOME_EDGE_SHADER, { file: 'connectome_edges.bk' }).kernel('k_splat_edges');
    }
}
$('#st-gpu').textContent = splat.gpuReady ? 'Vulkan HDR' : '2D Fallback';

function syncActGpu() {
    if (actKernelBuf) actKernelBuf.write(actHost);
}

// 4. Camera + Sonifier + Engine Proof
const view = new OrbitView(gpuCanvas, {
    yaw: 0.12,
    pitch: 0.14,
    dist: 2.15,
    minDist: 0.55,
    maxDist: 12.0,
    fovScale: 0.92,
    onProbe(pt) {
        seedCascadeAt(pt, 'Canvas Probe');
    },
});

const sonifier = new SpatialSonifier({ cooldownMs: 100 });

const proof = createEngineProofPanel($('#proof-panel'));
proof.setProvenance(
    isReal,
    neuronsSnap.stats(),
    'bro-headless --grant files,spawn demos/connectome-atlas demos/connectome-atlas/ingest.js'
);

// 5. Manifold Switcher (synced toolbar + sidebar cards)
const descEl = $('#manifold-desc');
let manifoldBar = null;
const sideBtns = [];
let cascadeReady = false;

function setManifold(mIdx) {
    const id = Math.max(0, Math.min(MANIFOLDS.length - 1, mIdx | 0));
    view.setManifold(id);
    if (manifoldBar) manifoldBar.value = id;
    for (let i = 0; i < sideBtns.length; i++) {
        sideBtns[i].classList.toggle('active', i === id);
    }
    descEl.textContent = MANIFOLDS[id].desc;
    if (cascadeReady) updateCascadeUI();
}

manifoldBar = segmented('#manifold-bar', MANIFOLDS.map((m) => [m.id, m.short]), {
    value: 0,
    onChange: (v) => setManifold(Number(v)),
});

const sideList = $('#manifold-list');
for (const m of MANIFOLDS) {
    const b = h('button.sci-manifold-btn', {
        dataset: { manifold: String(m.id) },
        onclick: () => setManifold(m.id),
    }, m.short);
    sideBtns.push(b);
    sideList.appendChild(b);
}
setManifold(0);

// 6. Live Whole-Brain Spiking Cascade
const cascade = {
    running: false,
    fading: false,
    hop: 0,
    maxHops: 10,
    accumMs: 0,
    stepPeriodMs: 190, // ~5.2 Hz biological wave propagation
    seedLabel: 'idle',
    seedPt: [0, 0, 0],
    seedOrd: -1,
    activeCount: 0,
    topOrds: [],
    leftEnergy: 0,
    rightEnergy: 0,
    lastLookupMs: 0,
    lastEdgeHits: 0,
    history: [],
};

function updateProbeDisplay(row, dist) {
    if (!row) return;
    const ntName = NT_NAMES[row.nt_id] || String(row.nt_id);
    const flowName = FLOW_NAMES[row.flow_id] || String(row.flow_id);
    $('#probe-box').textContent =
        `ord #${row.ord} · root ${row.root_id}\n` +
        `region: ${row.region ?? 'null'} · type: ${row.cell_type ?? 'null'}\n` +
        `NT: ${ntName} · flow: ${flowName} · d=${dist != null ? dist.toFixed(3) : '0.000'}\n` +
        `out_syn: ${fmtInt(row.out_syn)} · in_syn: ${fmtInt(row.in_syn)}`;
}

const NT_RATIOS = [1.0, 1.125, 1.25, 1.5, 1.667, 1.875];
function playHemisphericHop(hop, leftE, rightE, leftNt, rightNt) {
    if (!sonifier.enabled) return;
    const scaleStep = Math.pow(2, (hop % 6) / 12);
    const notes = [];
    if (leftE > 0.02) {
        notes.push({
            waveform: leftNt === 1 ? 'triangle' : 'sine',
            freq: 220 * NT_RATIOS[leftNt % 6] * scaleStep,
            gain: Math.min(0.22, 0.06 + leftE * 0.02),
            pos: [-5.0, 0.6, 0.0],
            dur: 0.36,
        });
    }
    if (rightE > 0.02) {
        notes.push({
            waveform: rightNt === 1 ? 'triangle' : 'sine',
            freq: 293.66 * NT_RATIOS[rightNt % 6] * scaleStep,
            gain: Math.min(0.22, 0.06 + rightE * 0.02),
            pos: [5.0, 0.6, 0.0],
            dur: 0.36,
        });
    }
    if (notes.length > 0) {
        notes.push({
            waveform: 'sine',
            freq: 110 * (1 + hop * 0.06),
            gain: 0.08,
            pos: [0.0, -0.5, 0.0],
            dur: 0.42,
        });
        sonifier.playChord(notes);
    }
}

function summarizeActivity(arr) {
    let activeCount = 0;
    let leftE = 0, rightE = 0;
    const leftNtBins = new Float32Array(6);
    const rightNtBins = new Float32Array(6);
    const topOrds = [];
    const topVals = [];
    const TOP_K = 8;

    for (let i = 0; i < N; i++) {
        const a = arr[i];
        if (a <= 0.08) continue;
        activeCount++;
        const nt = ntArr[i] | 0;
        if (xArr[i] < 0) {
            leftE += a;
            if (nt >= 0 && nt < 6) leftNtBins[nt] += a;
        } else {
            rightE += a;
            if (nt >= 0 && nt < 6) rightNtBins[nt] += a;
        }
        if (topVals.length < TOP_K || a > topVals[topVals.length - 1]) {
            let pos = topVals.length;
            while (pos > 0 && a > topVals[pos - 1]) pos--;
            topVals.splice(pos, 0, a);
            topOrds.splice(pos, 0, i);
            if (topVals.length > TOP_K) {
                topVals.pop();
                topOrds.pop();
            }
        }
    }
    let leftDom = 0, rightDom = 0;
    for (let k = 1; k < 6; k++) {
        if (leftNtBins[k] > leftNtBins[leftDom]) leftDom = k;
        if (rightNtBins[k] > rightNtBins[rightDom]) rightDom = k;
    }
    return { activeCount, leftE, rightE, leftDom, rightDom, topOrds };
}

function updateCascadeUI() {
    $('#st-active').textContent = fmtInt(cascade.activeCount);
    $('#st-hop').textContent = `${cascade.hop}/${cascade.maxHops}`;
    $('#st-lookup').textContent = cascade.lastLookupMs > 0 ? fmtMs(cascade.lastLookupMs) : '—';
    const hud = $('#hud-cascade');
    const info = MANIFOLDS[view.toManifold] || MANIFOLDS[0];
    const stateTxt = cascade.running ? 'propagating' : (cascade.fading ? 'fading' : 'settled');
    const head = (cascade.activeCount === 0 && !cascade.running && !cascade.fading)
        ? `<b>${info.short}</b> · click brain or Stimulate to fire a live 10-hop signal`
        : `<b>Cascade</b> ${cascade.seedLabel} · hop ${cascade.hop}/${cascade.maxHops} (${stateTxt}) · <b>${fmtInt(cascade.activeCount)}</b> spiking`;
    hud.innerHTML = `${head}<div class="sci-guide">${info.desc}</div>`;
    drawCascadeChart();
}
cascadeReady = true;
updateCascadeUI();

export function seedCascadeAt(pt, label = 'Probe') {
    const t0 = Date.now();
    let near = neuronsSnap.nearest('brain3d', pt, 24, 0.35);
    if (near.rowCount === 0) {
        near = neuronsSnap.nearest('brain3d', pt, 24);
    }
    const seedMs = Date.now() - t0;

    actHost.fill(0);
    refracHost.fill(0);
    const ordView = near.chunkCount > 0 ? near.chunkColumnView(0, 'ord') : null;
    const nSeeds = near.rowCount;
    for (let i = 0; i < nSeeds; i++) {
        const ord = ordView ? (ordView[i] >>> 0) : near.get(i, 'ord');
        if (ord < N) actHost[ord] = 1.0;
    }
    syncActGpu();

    const firstRow = nSeeds > 0 ? near.row(0) : null;
    if (firstRow) updateProbeDisplay(firstRow, firstRow._distance);

    const sum = summarizeActivity(actHost);
    cascade.running = nSeeds > 0;
    cascade.fading = false;
    cascade.hop = 0;
    cascade.accumMs = 0;
    cascade.seedLabel = label;
    cascade.seedPt = firstRow ? [firstRow.x, firstRow.y, firstRow.z] : pt.slice(0, 3);
    cascade.seedOrd = firstRow ? firstRow.ord : -1;
    cascade.activeCount = sum.activeCount;
    cascade.topOrds = sum.topOrds;
    cascade.leftEnergy = sum.leftE;
    cascade.rightEnergy = sum.rightE;
    cascade.lastLookupMs = seedMs;
    cascade.lastEdgeHits = nSeeds;
    cascade.history = [{
        hop: 0,
        activeCount: sum.activeCount,
        leftE: sum.leftE,
        rightE: sum.rightE,
    }];

    playHemisphericHop(0, sum.leftE, sum.rightE, sum.leftDom, sum.rightDom);
    updateCascadeUI();
    status.ok(`seeded ${nSeeds} neurons at ${label} (${fmtMs(seedMs)} spatial kNN)`);
}

export function stepCascadeHop() {
    if (cascade.activeCount === 0 && cascade.hop === 0) {
        seedCascadeAt(STIM_SITES.ol.pt, STIM_SITES.ol.label);
        return;
    }
    if (cascade.hop >= cascade.maxHops) {
        cascade.running = false;
        cascade.fading = cascade.activeCount > 0;
        updateCascadeUI();
        return;
    }

    const isDense = E > 2000000;
    // Pick top strongest active sources in single O(N) pass
    const TOP_SRC = isDense ? 64 : 64;
    const srcOrds = [];
    const srcActs = [];
    for (let i = 0; i < N; i++) {
        const a = actHost[i];
        if (a <= 0.11) continue;
        if (srcActs.length < TOP_SRC || a > srcActs[srcActs.length - 1]) {
            let pos = srcActs.length;
            while (pos > 0 && a > srcActs[pos - 1]) pos--;
            srcActs.splice(pos, 0, a);
            srcOrds.splice(pos, 0, i);
            if (srcActs.length > TOP_SRC) {
                srcActs.pop();
                srcOrds.pop();
            }
        }
    }

    // Leaky membrane decay + 2-hop refractory period keeps wave as a localized moving ring
    const decay = isDense ? 0.34 : 0.36;
    for (let i = 0; i < N; i++) {
        const prevA = actHost[i];
        let rf = refracHost[i] > 0 ? Math.max(0, refracHost[i] - 1.0) : 0;
        if (prevA >= 0.32) rf = Math.max(rf, 2.0);
        refracHost[i] = rf;
        nextActHost[i] = prevA * decay;
    }

    const q = bro.table;
    const t0 = Date.now();
    let edgeHits = 0;
    const minSyn = isDense ? 4 : 1;
    const gain = isDense ? 0.54 : 1.15;
    for (let s = 0; s < srcOrds.length; s++) {
        const srcOrd = srcOrds[s];
        const srcA = srcActs[s];
        const res = edgesSnap.query().where(q.eq('pre_idx', srcOrd)).run();
        const nc = res.chunkCount;
        for (let ci = 0; ci < nc; ci++) {
            const rc = res.chunkRowCount(ci);
            const postV = res.chunkColumnView(ci, 'post_idx');
            const synV = res.chunkColumnView(ci, 'syn_count');
            const polV = res.chunkColumnView(ci, 'polarity');
            edgeHits += rc;
            for (let r = 0; r < rc; r++) {
                const syn = synV[r];
                if (syn < minSyn) continue;
                const post = postV[r] >>> 0;
                if (post < N && refracHost[post] <= 0.01) {
                    const weight = Math.min(1.0, Math.log1p(syn) * 0.28);
                    nextActHost[post] += srcA * weight * polV[r] * gain;
                }
            }
        }
    }
    const lookupMs = Date.now() - t0;

    const fireThresh = isDense ? 0.12 : 0.08;
    for (let i = 0; i < N; i++) {
        const v = nextActHost[i];
        nextActHost[i] = v < fireThresh ? 0.0 : (v >= 1.0 ? 1.0 : v);
    }

    const tmp = actHost;
    actHost = nextActHost;
    nextActHost = tmp;
    syncActGpu();

    const sum = summarizeActivity(actHost);
    cascade.hop++;
    cascade.activeCount = sum.activeCount;
    cascade.topOrds = sum.topOrds;
    cascade.leftEnergy = sum.leftE;
    cascade.rightEnergy = sum.rightE;
    cascade.lastLookupMs = lookupMs;
    cascade.lastEdgeHits = edgeHits;
    cascade.history.push({
        hop: cascade.hop,
        activeCount: sum.activeCount,
        leftE: sum.leftE,
        rightE: sum.rightE,
    });
    if (cascade.hop >= cascade.maxHops || sum.activeCount === 0) {
        cascade.running = false;
        cascade.fading = sum.activeCount > 0;
    }

    playHemisphericHop(cascade.hop, sum.leftE, sum.rightE, sum.leftDom, sum.rightDom);
    updateCascadeUI();
}

function clearCascade() {
    actHost.fill(0);
    refracHost.fill(0);
    syncActGpu();
    cascade.running = false;
    cascade.fading = false;
    cascade.hop = 0;
    cascade.activeCount = 0;
    cascade.topOrds = [];
    cascade.history = [];
    updateCascadeUI();
    status.ok('cascade cleared');
}

// 7. Worker Analytics, Filters, Charts & Engine Proof
const tableWorker = workerClient('../../lib/sci-atlas/table-worker.js', { type: 'module' });
let ntGroups = [];
let totalNtGroups = [];
let lastFilterCount = N;

function buildPredicates() {
    const preds = [];
    if (regionSel.value) preds.push({ col: 'region', op: 'eq', val: regionSel.value });
    if (ntSel.value !== '') preds.push({ col: 'nt_id', op: 'eq', val: Number(ntSel.value) });
    if (flowSel.value !== '') preds.push({ col: 'flow_id', op: 'eq', val: Number(flowSel.value) });
    const minOut = Number($('#filter-outsyn').value) | 0;
    if (minOut > 0) preds.push({ col: 'out_syn', op: 'ge', val: minOut });
    return preds;
}

async function refreshSummary(preds) {
    const res = await tableWorker.request({
        type: 'querySummary',
        filters: preds,
        groupBy: 'nt_id',
        aggCol: 'out_syn',
        sumCols: ['out_syn'],
        avgCols: ['out_syn'],
    });
    if (res && res.ok) {
        ntGroups = res.groups || [];
        if (preds.length === 0 && !$('#filter-celltype').value.trim()) {
            totalNtGroups = ntGroups;
        }
        proof.setQueryStats(res.ms, res.rowCount, res.execStats);
        drawNtChart();
    }
}

async function applyFilters() {
    const preds = buildPredicates();
    const ctQuery = $('#filter-celltype').value.trim();
    const hasFilter = preds.length > 0 || ctQuery.length > 0;

    if (!hasFilter) {
        splat.uploadMask(null);
        lastFilterCount = N;
        $('#filter-match').textContent = `all (${fmtInt(N)})`;
        await refreshSummary([]);
        return;
    }

    const res = await tableWorker.request({
        type: 'filterMask',
        predicates: preds,
        ordCol: 'ord',
    });
    let bits = new Uint32Array(res.bitsBuffer);
    let matched = res.matched;
    let totalMs = res.ms;

    if (ctQuery.length > 0) {
        const t0 = performance.now();
        const q = bro.table;
        const ctTbl = neuronsSnap.query()
            .where(q.contains('cell_type', ctQuery))
            .select({ ord: 'ord' })
            .run();
        const ctBits = new Uint32Array(bits.length);
        for (let ci = 0; ci < ctTbl.chunkCount; ci++) {
            const ov = ctTbl.chunkColumnView(ci, 'ord');
            const rc = ctTbl.chunkRowCount(ci);
            for (let r = 0; r < rc; r++) {
                const idx = ov[r] >>> 0;
                if (idx < N) ctBits[idx >>> 5] |= (1 << (idx & 31));
            }
        }
        let nextMatched = 0;
        for (let w = 0; w < bits.length; w++) {
            const v = (bits[w] & ctBits[w]) >>> 0;
            bits[w] = v;
            // Fast popcount
            let x = v;
            x -= (x >>> 1) & 0x55555555;
            x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
            nextMatched += (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
        }
        matched = nextMatched;
        totalMs += performance.now() - t0;
    }

    splat.uploadMask(bits);
    lastFilterCount = matched;
    $('#filter-match').textContent = `${fmtInt(matched)} / ${fmtInt(N)}`;
    if (res.stats) proof.setQueryStats(totalMs, N, res.stats);
    await refreshSummary(preds);
}

// 8. 2D Telemetry Charts & 3D Overlay Projection
function fitCanvas(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(16, Math.round(canvas.clientWidth || canvas.width || 16));
    const cssH = Math.max(16, Math.round(canvas.clientHeight || canvas.height || 16));
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: cssW, h: cssH };
}

function drawNtChart() {
    const canvas = $('#chart-nt');
    const { w, h: ch } = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, ch);

    const mapCnt = new Map();
    for (const g of ntGroups) mapCnt.set(g.nt_id, g.cnt);
    const totMap = new Map();
    for (const g of totalNtGroups) totMap.set(g.nt_id, g.cnt);

    let maxVal = 1;
    for (let i = 0; i < 6; i++) {
        const c = Math.max(mapCnt.get(i) || 0, totMap.get(i) || 0);
        if (c > maxVal) maxVal = c;
    }

    const padL = 14, padR = 14, padT = 34, padB = 22;
    const plotW = w - padL - padR;
    const plotH = Math.max(10, ch - padT - padB);
    const slotW = plotW / 6;
    const barW = Math.max(14, slotW * 0.56);

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < 6; i++) {
        const cx = padL + slotW * (i + 0.5);
        const tot = totMap.get(i) || 0;
        const cur = mapCnt.get(i) || 0;

        if (tot > 0) {
            const th = (tot / maxVal) * plotH;
            ctx.fillStyle = 'rgba(130, 150, 190, 0.16)';
            ctx.fillRect(cx - barW / 2, padT + plotH - th, barW, th);
        }
        const bh = (cur / maxVal) * plotH;
        ctx.fillStyle = NT_HEX[i];
        ctx.fillRect(cx - barW / 2, padT + plotH - bh, barW, bh);

        ctx.fillStyle = '#cfe0ff';
        ctx.fillText(NT_NAMES[i], cx, ch - 6);
        ctx.fillStyle = '#9db1d4';
        ctx.fillText(cur >= 1000 ? (cur / 1000).toFixed(1) + 'k' : String(cur), cx, padT + plotH - bh - 4);
    }
}

function drawCascadeChart() {
    const canvas = $('#chart-cascade');
    const { w, h: ch } = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, ch);

    const padL = 30, padR = 14, padT = 24, padB = 20;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(10, ch - padT - padB);

    ctx.strokeStyle = 'rgba(120, 150, 200, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + plotH);
    ctx.lineTo(w - padR, padT + plotH);
    ctx.stroke();

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#73829c';
    ctx.textAlign = 'center';
    for (let hop = 0; hop <= 10; hop++) {
        const xPx = padL + (hop / 10) * plotW;
        ctx.fillText(String(hop), xPx, ch - 5);
    }

    if (cascade.history.length === 0) {
        ctx.fillStyle = '#6b7686';
        ctx.fillText('Click brain or Stimulate to trigger live 10-hop cascade', w * 0.5, padT + plotH * 0.52);
        return;
    }

    let maxCnt = 10, maxE = 1;
    for (const pt of cascade.history) {
        if (pt.activeCount > maxCnt) maxCnt = pt.activeCount;
        if (pt.leftE > maxE) maxE = pt.leftE;
        if (pt.rightE > maxE) maxE = pt.rightE;
    }

    const barW = Math.max(6, (plotW / 11) * 0.45);
    for (const pt of cascade.history) {
        const xPx = padL + (pt.hop / 10) * plotW;
        const bh = (pt.activeCount / maxCnt) * plotH;
        ctx.fillStyle = 'rgba(255, 224, 128, 0.24)';
        ctx.fillRect(xPx - barW * 0.5, padT + plotH - bh, barW, bh);
    }

    const drawTrace = (key, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < cascade.history.length; i++) {
            const pt = cascade.history[i];
            const xPx = padL + (pt.hop / 10) * plotW;
            const yPx = padT + plotH - (pt[key] / maxE) * plotH;
            if (i === 0) ctx.moveTo(xPx, yPx);
            else ctx.lineTo(xPx, yPx);
        }
        ctx.stroke();
    };
    drawTrace('leftE', '#29d8ff');
    drawTrace('rightE', '#ffe13a');

    ctx.textAlign = 'right';
    ctx.fillStyle = '#29d8ff';
    ctx.fillText('L-Hem', w - 62, 14);
    ctx.fillStyle = '#ffe13a';
    ctx.fillText('R-Hem', w - 14, 14);
}

const LANDMARKS = [
    { label: 'OL_L', pos: [-1.02, 0.44, 0.05] },
    { label: 'OL_R', pos: [1.02, 0.44, 0.05] },
    { label: 'MB_L', pos: [-0.36, 0.46, 0.02] },
    { label: 'MB_R', pos: [0.36, 0.46, 0.02] },
    { label: 'CX', pos: [0.0, 0.46, -0.05] },
    { label: 'AL', pos: [0.0, -0.09, 0.42] },
    { label: 'SEZ', pos: [0.0, -0.64, 0.14] },
];

function drawOverlay() {
    const { w, h: ch } = fitCanvas(overlayCanvas);
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, w, ch);

    ctx.font = '10px ui-monospace, Consolas, monospace';
    if (view.toManifold === 0 && view.smoothMorph > 0.7) {
        ctx.fillStyle = 'rgba(176, 208, 255, 0.58)';
        ctx.textAlign = 'center';
        for (const lm of LANDMARKS) {
            const p = view.project(lm.pos[0], lm.pos[1], lm.pos[2], w, ch);
            if (p) ctx.fillText(lm.label, p.x, p.y);
        }
    }

    if (cascade.seedOrd >= 0 && view.toManifold === 0) {
        const sp = view.project(cascade.seedPt[0], cascade.seedPt[1], cascade.seedPt[2], w, ch);
        if (sp) {
            ctx.strokeStyle = 'rgba(255, 232, 130, 0.90)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    if (view.toManifold === 0 && cascade.topOrds.length > 0) {
        ctx.strokeStyle = 'rgba(255, 244, 175, 0.72)';
        ctx.lineWidth = 1;
        for (let i = 0; i < cascade.topOrds.length; i++) {
            const ord = cascade.topOrds[i];
            const p = view.project(xArr[ord], yArr[ord], zArr[ord], w, ch);
            if (p) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }
}

// 9. Controls Wiring
$('#btn-stim-ol').addEventListener('click', () => seedCascadeAt(STIM_SITES.ol.pt, STIM_SITES.ol.label));
$('#btn-stim-al').addEventListener('click', () => seedCascadeAt(STIM_SITES.al.pt, STIM_SITES.al.label));
$('#btn-stim-cx').addEventListener('click', () => seedCascadeAt(STIM_SITES.cx.pt, STIM_SITES.cx.label));
$('#btn-step-hop').addEventListener('click', () => stepCascadeHop());
$('#btn-clear-wave').addEventListener('click', () => clearCascade());

$('#btn-autorotate').addEventListener('click', (e) => {
    view.autoRotate = !view.autoRotate;
    e.currentTarget.classList.toggle('active', view.autoRotate);
});

$('#btn-sonify').addEventListener('click', (e) => {
    sonifier.setEnabled(!sonifier.enabled);
    e.currentTarget.textContent = sonifier.enabled ? 'Sonify: On' : 'Sonify: Off';
    e.currentTarget.classList.toggle('active', sonifier.enabled);
});

$('#btn-fibers').addEventListener('click', (e) => {
    showFibers = !showFibers;
    e.currentTarget.classList.toggle('active', showFibers);
});

regionSel.addEventListener('change', () => applyFilters());
ntSel.addEventListener('change', () => applyFilters());
flowSel.addEventListener('change', () => applyFilters());
$('#filter-outsyn').addEventListener('input', (e) => {
    $('#filter-outsyn-val').textContent = e.target.value;
});
$('#filter-outsyn').addEventListener('change', () => applyFilters());
$('#filter-celltype').addEventListener('change', () => applyFilters());
$('#btn-reset-filters').addEventListener('click', () => {
    regionSel.value = '';
    ntSel.value = '';
    flowSel.value = '';
    $('#filter-outsyn').value = '0';
    $('#filter-outsyn-val').textContent = '0';
    $('#filter-celltype').value = '';
    applyFilters();
});

$('#opt-exposure').addEventListener('input', (e) => {
    splat.exposure = Number(e.target.value);
    $('#opt-exposure-val').textContent = splat.exposure.toFixed(2);
});
$('#opt-bloom').addEventListener('input', (e) => {
    splat.bloomAmt = Number(e.target.value);
    $('#opt-bloom-val').textContent = splat.bloomAmt.toFixed(2);
});
$('#opt-radius').addEventListener('change', (e) => {
    splat.radiusMode = Number(e.target.value) | 0;
});

// 10. Render Loop
const fps = fpsMeter();
const chartNtEl = $('#chart-nt');
const chartCascadeEl = $('#chart-cascade');
let lastChartSizeKey = '';
window.addEventListener('resize', () => {
    lastChartSizeKey = '';
});

const renderFrame = () => {
    const extraEdgeSplat = (showFibers && kSplatEdges && edgeVecBuf && E > 0)
        ? (accR, accG, accB, accC, cam, meta) => {
            const edgeStride = Math.min(E, 1048576);
            const restMinSyn = E > 2000000 ? 35.0 : 26.0;
            const fireMinSyn = E > 2000000 ? 4.0 : 2.0;
            kSplatEdges.dispatch(
                edgeStride,
                accR, accG, accB, accC,
                pos4Buf, attrBuf, edgeVecBuf, actKernelBuf,
                E, edgeStride, meta.w, meta.h,
                cam.camR, cam.camU, cam.camF, cam.camT,
                meta.fromManifold, meta.toManifold, meta.morph, fiberPhase,
                restMinSyn, fireMinSyn
            );
        }
        : null;

    splat.render(view, (cols, cam, meta) => [
        pos4Buf, attrBuf,
        actKernelBuf,
        meta.maskBuffer,
        meta.count, meta.stride, meta.w, meta.h,
        cam.camR, cam.camU, cam.camF, cam.camT,
        meta.fromManifold, meta.toManifold, meta.morph,
        meta.hasMask, meta.radiusMode,
    ], extraEdgeSplat);
    drawOverlay();
};

let lastFpsStr = '';
frameLoop((dt) => {
    view.step(dt);
    const stepDt = Math.min(0.05, Math.max(0.0005, dt));
    fiberPhase = (fiberPhase + stepDt * 0.45) % 1.0;
    if (cascade.running) {
        cascade.accumMs += stepDt * 1000;
        while (cascade.accumMs >= cascade.stepPeriodMs && cascade.running) {
            cascade.accumMs -= cascade.stepPeriodMs;
            stepCascadeHop();
        }
    } else if (cascade.fading) {
        const damp = Math.exp(-stepDt * 2.8);
        let maxA = 0;
        let active = 0;
        for (let i = 0; i < N; i++) {
            let a = actHost[i] * damp;
            if (a < 0.012) a = 0;
            actHost[i] = a;
            if (a > maxA) maxA = a;
            if (a > 0.08) active++;
        }
        syncActGpu();
        if (active !== cascade.activeCount) {
            cascade.activeCount = active;
            $('#st-active').textContent = fmtInt(active);
        }
        if (maxA === 0) {
            cascade.fading = false;
            cascade.activeCount = 0;
            cascade.topOrds = [];
            updateCascadeUI();
        }
    }
    renderFrame();

    const chartKey = `${chartNtEl.clientWidth}x${chartNtEl.clientHeight}|${chartCascadeEl.clientWidth}x${chartCascadeEl.clientHeight}|${window.devicePixelRatio || 1}`;
    if (chartKey !== lastChartSizeKey) {
        lastChartSizeKey = chartKey;
        drawNtChart();
        drawCascadeChart();
    }

    const curFps = fps.tick();
    const fpsStr = curFps > 0 ? String(Math.round(curFps)) : '—';
    if (fpsStr !== lastFpsStr) {
        lastFpsStr = fpsStr;
        $('#st-fps').textContent = fpsStr;
    }
});

// 11. Attach Worker Snapshot & Populate Initial Charts
(async () => {
    await tableWorker.ready;
    await tableWorker.request({ type: 'attachSnapshot', snap: neuronsSnap });
    await applyFilters();
    drawCascadeChart();
    status.ok(`ready (${fmtInt(N)} neurons, ${fmtInt(E)} edges in ${fmtMs(loadMs)})`);
})();

globalThis.__connectomeAtlas = {
    neuronsSnap,
    edgesSnap,
    view,
    splat,
    sonifier,
    cascade,
    tableWorker,
    seedCascadeAt,
    stepCascadeHop,
    clearCascade,
    setManifold,
    applyFilters,
    renderFrame,
    get actHost() { return actHost; },
    get lastFilterCount() { return lastFilterCount; },
};
